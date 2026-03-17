const express = require('express');
const fs = require('fs');
const path = require('path');
const { getTransactions } = require('./transactions');
const { getPrice, loadCache: loadPriceCache } = require('./prices');
const { fetchRate, loadCache: loadRateCache } = require('./exchangeRate');
const { getSplits, splitMultiplier, loadCache: loadSplitsCache } = require('./splits');

const taxPaidPath = path.join(__dirname, '..', '..', 'data', 'tax-paid.json');
function loadTaxPaid() {
  try { return JSON.parse(fs.readFileSync(taxPaidPath, 'utf8')); } catch { return {}; }
}

const router = express.Router();

function convertToUSD(amount, currency, eurToUsd) {
  if (currency === 'USD') return amount;
  return amount * eurToUsd;
}

function convertToEUR(amount, currency, eurToUsd) {
  if (currency === 'EUR') return amount;
  return amount / eurToUsd;
}

function buildHoldings(transactions) {
  const holdings = {};
  for (const t of transactions) {
    if (!holdings[t.ticker]) {
      holdings[t.ticker] = { ticker: t.ticker, buys: [], sells: [], dividends: [] };
    }
    if (t.type === 'buy') {
      holdings[t.ticker].buys.push(t);
    } else if (t.type === 'sell') {
      holdings[t.ticker].sells.push(t);
    } else if (t.type === 'dividend') {
      holdings[t.ticker].dividends.push(t);
    }
  }
  return holdings;
}

function toEUR(amount, currency, rate) {
  if (currency === 'EUR') return amount;
  return amount / rate;
}

// Compute sell gains by year by ticker using FIFO cost basis (matches tax.js)
function computeGainsByYear(holdings, splitsMap, eurToUsd) {
  const gainsByYear = {}; // { year: { ticker: gainEUR } }
  for (const [ticker, holding] of Object.entries(holdings)) {
    const splits = splitsMap[ticker] || [];
    const buySells = [...holding.buys, ...holding.sells]
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const buyLots = []; // FIFO queue: { adjQty, costPerShareEUR }
    for (const t of buySells) {
      const rate = t.exchangeRate || eurToUsd;
      const mult = splitMultiplier(splits, t.date);
      const adjQty = t.quantity * mult;
      const toE = (amt, cur) => cur === 'EUR' ? amt : amt / rate;
      if (t.type === 'buy') {
        const costEUR = toE(t.pricePerShare * t.quantity, t.priceCurrency) +
          (t.commission > 0 ? toE(t.commission, t.commissionCurrency) : 0);
        buyLots.push({ adjQty, costPerShareEUR: costEUR / adjQty });
      } else {
        let remaining = adjQty;
        let costBasis = 0;
        while (remaining > 0 && buyLots.length > 0) {
          const lot = buyLots[0];
          const used = Math.min(remaining, lot.adjQty);
          costBasis += used * lot.costPerShareEUR;
          lot.adjQty -= used;
          remaining -= used;
          if (lot.adjQty <= 0) buyLots.shift();
        }
        const proceeds = toE(t.pricePerShare * t.quantity, t.priceCurrency) -
          (t.commission > 0 ? toE(t.commission, t.commissionCurrency) : 0);
        const gain = proceeds - costBasis;
        const yr = t.date.substring(0, 4);
        if (!gainsByYear[yr]) gainsByYear[yr] = {};
        gainsByYear[yr][ticker] = (gainsByYear[yr][ticker] || 0) + gain;
      }
    }
  }
  return gainsByYear;
}

// Allocate actual tax paid per ticker, splitting between stocks and ETFs by expected tax ratio
function computeAllocatedTax(gainsByYear, assetTypes, taxPaidData) {
  const CGT_RATE = 0.33;
  const CGT_EXEMPTION = 1270;
  const ETF_TAX_RATE = 0.41;
  const allocated = {};

  for (const [yr, tickerGains] of Object.entries(gainsByYear)) {
    const actualPaid = taxPaidData[yr] || 0;
    if (actualPaid <= 0) continue;

    let totalStockGain = 0;
    let totalEtfGain = 0;
    for (const [tk, gain] of Object.entries(tickerGains)) {
      if (gain <= 0) continue;
      if (assetTypes[tk] === 'etf') {
        totalEtfGain += gain;
      } else {
        totalStockGain += gain;
      }
    }

    // Compute expected tax for each group to determine split ratio
    const expectedStockCGT = Math.max(0, totalStockGain - CGT_EXEMPTION) * CGT_RATE;
    const expectedEtfTax = totalEtfGain * ETF_TAX_RATE;
    const totalExpected = expectedStockCGT + expectedEtfTax;
    if (totalExpected <= 0) continue;

    // Split actual tax paid between stocks and ETFs by expected ratio
    const stockShare = (expectedStockCGT / totalExpected) * actualPaid;
    const etfShare = (expectedEtfTax / totalExpected) * actualPaid;

    // Allocate stock share proportionally among stocks with positive gains
    if (stockShare > 0 && totalStockGain > 0) {
      for (const [tk, gain] of Object.entries(tickerGains)) {
        if (gain > 0 && assetTypes[tk] !== 'etf') {
          allocated[tk] = (allocated[tk] || 0) + (gain / totalStockGain) * stockShare;
        }
      }
    }

    // Allocate ETF share proportionally among ETFs with positive gains
    if (etfShare > 0 && totalEtfGain > 0) {
      for (const [tk, gain] of Object.entries(tickerGains)) {
        if (gain > 0 && assetTypes[tk] === 'etf') {
          allocated[tk] = (allocated[tk] || 0) + (gain / totalEtfGain) * etfShare;
        }
      }
    }
  }

  return allocated;
}

function calcStockSummary(holding, eurToUsd, splits) {
  const { ticker, buys, sells, dividends } = holding;

  // Process buy/sell transactions in date order to track running avg cost
  const allTxns = [...buys, ...sells].sort((a, b) => new Date(a.date) - new Date(b.date));

  let totalAdjQty = 0;
  let totalCostUSD = 0;
  let totalCostEUR = 0;
  let realizedGainUSD = 0;
  let realizedGainEUR = 0;
  let totalInvestedUSD = 0;
  let totalInvestedEUR = 0;

  for (const t of allTxns) {
    const mult = splitMultiplier(splits, t.date);
    const adjQty = t.quantity * mult;
    const rate = t.exchangeRate || eurToUsd;
    const txnValueUSD = convertToUSD(t.pricePerShare * t.quantity, t.priceCurrency, eurToUsd);
    const txnCommUSD = convertToUSD(t.commission, t.commissionCurrency, eurToUsd);
    const txnValueEUR = toEUR(t.pricePerShare * t.quantity, t.priceCurrency, rate);
    const txnCommEUR = t.commission > 0 ? toEUR(t.commission, t.commissionCurrency, rate) : 0;

    if (t.type === 'buy') {
      totalCostUSD += txnValueUSD + txnCommUSD;
      totalCostEUR += txnValueEUR + txnCommEUR;
      totalAdjQty += adjQty;
      totalInvestedUSD += txnValueUSD + txnCommUSD;
      totalInvestedEUR += txnValueEUR + txnCommEUR;
    } else {
      const avgCostUSD = totalAdjQty > 0 ? totalCostUSD / totalAdjQty : 0;
      const avgCostEUR = totalAdjQty > 0 ? totalCostEUR / totalAdjQty : 0;
      const costBasisUSD = avgCostUSD * adjQty;
      const costBasisEUR = avgCostEUR * adjQty;
      const proceedsUSD = txnValueUSD - txnCommUSD;
      const proceedsEUR = txnValueEUR - txnCommEUR;
      realizedGainUSD += proceedsUSD - costBasisUSD;
      realizedGainEUR += proceedsEUR - costBasisEUR;
      totalCostUSD -= costBasisUSD;
      totalCostEUR -= costBasisEUR;
      totalAdjQty -= adjQty;
    }
  }

  // Sum dividends (net of tax) using per-transaction rates
  let dividendsUSD = 0;
  let dividendsEUR = 0;
  let taxPaidEUR = 0;
  for (const d of dividends) {
    const rate = d.exchangeRate || eurToUsd;
    dividendsUSD += convertToUSD(d.dividendAmount, d.dividendCurrency, eurToUsd);
    dividendsEUR += toEUR(d.dividendAmount, d.dividendCurrency, rate);
    taxPaidEUR += d.taxPaid || 0;
  }
  const taxPaidUSD = convertToUSD(taxPaidEUR, 'EUR', eurToUsd);
  const netDividendsUSD = dividendsUSD - taxPaidUSD;
  const netDividendsEUR = dividendsEUR - taxPaidEUR;

  const avgCostPerShareUSD = totalAdjQty > 0 ? totalCostUSD / totalAdjQty : 0;
  const avgCostPerShareEUR = totalAdjQty > 0 ? totalCostEUR / totalAdjQty : 0;

  return {
    ticker,
    quantityHeld: totalAdjQty,
    totalCostUSD,
    totalCostEUR,
    avgCostPerShareUSD,
    avgCostPerShareEUR,
    realizedGainUSD,
    realizedGainEUR,
    dividendsUSD,
    dividendsEUR,
    taxPaidEUR,
    taxPaidUSD,
    netDividendsUSD,
    netDividendsEUR,
    totalInvestedUSD,
    totalInvestedEUR,
  };
}

// GET /api/portfolio
router.get('/', async (req, res) => {
  try {
    const transactions = await getTransactions();
    await loadPriceCache();
    await loadRateCache();
    await loadSplitsCache();
    const rateData = await fetchRate();
    const eurToUsd = rateData.rate;
    const rateStale = rateData.stale || false;

    const holdings = buildHoldings(transactions);
    const tickers = Object.keys(holdings);

    // Fetch splits and prices in parallel for all tickers
    const [splitsResults, priceResults] = await Promise.all([
      Promise.allSettled(tickers.map(t => getSplits(t))),
      Promise.allSettled(tickers.map(t => getPrice(t))),
    ]);
    const splitsMap = {};
    const priceMap = {};
    tickers.forEach((t, i) => {
      splitsMap[t] = splitsResults[i].status === 'fulfilled' ? splitsResults[i].value : [];
      priceMap[t] = priceResults[i].status === 'fulfilled' ? priceResults[i].value : null;
    });

    const stocks = [];
    let totalCostUSD = 0;
    let totalCostEUR = 0;
    let totalValueUSD = 0;
    let totalValueEUR = 0;
    let totalRealizedUSD = 0;
    let totalRealizedEUR = 0;
    let totalDividendsUSD = 0;
    let totalDividendsEUR = 0;
    let totalTaxPaidEUR = 0;
    let totalNetDividendsUSD = 0;
    let totalNetDividendsEUR = 0;
    let totalInvestedUSD = 0;
    let totalInvestedEUR = 0;

    for (const [ticker, holding] of Object.entries(holdings)) {
      const splits = splitsMap[ticker];

      const summary = calcStockSummary(holding, eurToUsd, splits);
      if (summary.quantityHeld === 0 && holding.sells.length === 0 && holding.dividends.length === 0) continue;

      let currentPrice = null;
      let priceStale = false;
      const allTxns = [...holding.buys, ...holding.sells, ...holding.dividends];
      const assetType = allTxns.find(t => t.assetType)?.assetType || 'stock';
      const txnName = allTxns.find(t => t.companyName)?.companyName;
      let name = txnName || ticker;

      let priceCurrency = 'USD';
      const priceData = priceMap[ticker];
      if (priceData) {
        currentPrice = priceData.price;
        priceCurrency = priceData.currency || 'USD';
        priceStale = priceData.stale || false;
        name = priceData.name || name;
      } else {
        priceStale = true;
      }

      const currentValueUSD = currentPrice && summary.quantityHeld > 0
        ? convertToUSD(currentPrice, priceCurrency, eurToUsd) * summary.quantityHeld
        : null;
      const currentValueEUR = currentPrice && summary.quantityHeld > 0
        ? convertToEUR(currentPrice, priceCurrency, eurToUsd) * summary.quantityHeld
        : null;

      // Unrealized gain on current holdings
      const unrealizedUSD = currentValueUSD !== null ? currentValueUSD - summary.totalCostUSD : null;
      const unrealizedEUR = currentValueEUR !== null ? currentValueEUR - summary.totalCostEUR : null;
      // Total gain = realized + unrealized + net dividends (EUR uses per-transaction rates)
      const totalGainUSD = summary.realizedGainUSD + (unrealizedUSD || 0) + summary.netDividendsUSD;
      const totalGainEUR = summary.realizedGainEUR + (unrealizedEUR || 0) + summary.netDividendsEUR;
      const totalPct = summary.totalInvestedEUR > 0
        ? (totalGainEUR / summary.totalInvestedEUR) * 100
        : null;

      const stock = {
        ticker,
        name,
        assetType,
        quantityHeld: summary.quantityHeld,
        totalCostUSD: summary.totalCostUSD,
        totalCostEUR: summary.totalCostEUR,
        currentPrice,
        priceCurrency,
        currentPriceEUR: currentPrice ? convertToEUR(currentPrice, priceCurrency, eurToUsd) : null,
        currentValueUSD,
        currentValueEUR,
        unrealizedUSD,
        unrealizedEUR,
        realizedUSD: summary.realizedGainUSD,
        realizedEUR: summary.realizedGainEUR,
        dividendsUSD: summary.dividendsUSD,
        dividendsEUR: summary.dividendsEUR,
        taxPaidEUR: summary.taxPaidEUR,
        taxPaidUSD: summary.taxPaidUSD,
        netDividendsUSD: summary.netDividendsUSD,
        netDividendsEUR: summary.netDividendsEUR,
        totalGainUSD,
        totalGainEUR,
        totalInvestedUSD: summary.totalInvestedUSD,
        totalInvestedEUR: summary.totalInvestedEUR,
        pctChange: totalPct,
        priceStale,
        splitRatio: (() => {
          const earliestDate = allTxns.reduce((earliest, t) => t.date < earliest ? t.date : earliest, allTxns[0].date);
          const relevantSplits = summary.quantityHeld === 0 && holding.sells.length > 0
            ? splits.filter(s => s.date <= [...holding.sells].sort((a, b) => new Date(b.date) - new Date(a.date))[0].date)
            : splits;
          return splitMultiplier(relevantSplits, earliestDate);
        })(),
      };

      stocks.push(stock);
      totalInvestedUSD += summary.totalInvestedUSD;
      totalInvestedEUR += summary.totalInvestedEUR;
      totalRealizedUSD += summary.realizedGainUSD;
      totalRealizedEUR += summary.realizedGainEUR;
      totalDividendsUSD += summary.dividendsUSD;
      totalDividendsEUR += summary.dividendsEUR;
      totalTaxPaidEUR += summary.taxPaidEUR;
      totalNetDividendsUSD += summary.netDividendsUSD;
      totalNetDividendsEUR += summary.netDividendsEUR;
      if (summary.quantityHeld > 0) {
        totalCostUSD += summary.totalCostUSD;
        totalCostEUR += summary.totalCostEUR;
        if (currentValueUSD !== null) totalValueUSD += currentValueUSD;
        if (currentValueEUR !== null) totalValueEUR += currentValueEUR;
      }
    }

    // Compute per-ticker expected tax using FIFO, separating stocks from ETFs
    const taxPaidData = loadTaxPaid();
    const totalCgtPaidEUR = Object.values(taxPaidData).reduce((sum, v) => sum + (Number(v) || 0), 0);

    const gainsByYear = computeGainsByYear(holdings, splitsMap, eurToUsd);

    // Build asset type map for all tickers
    const assetTypes = {};
    for (const [tk, holding] of Object.entries(holdings)) {
      const allTkTxns = [...holding.buys, ...holding.sells, ...holding.dividends];
      assetTypes[tk] = allTkTxns.find(t => t.assetType)?.assetType || 'stock';
    }

    const allocatedTaxByTicker = computeAllocatedTax(gainsByYear, assetTypes, taxPaidData);

    // Apply allocated tax and allocation percentages to stocks
    for (const stock of stocks) {
      stock.allocationPct = totalValueUSD > 0 && stock.currentValueUSD !== null
        ? (stock.currentValueUSD / totalValueUSD) * 100
        : 0;
      stock.allocatedTaxEUR = allocatedTaxByTicker[stock.ticker] || 0;
      stock.totalGainAfterTaxEUR = stock.totalGainEUR - stock.allocatedTaxEUR;
    }

    const totalUnrealizedUSD = totalValueUSD - totalCostUSD;
    const totalUnrealizedEUR = totalValueEUR - totalCostEUR;
    const totalGainUSD = totalRealizedUSD + totalUnrealizedUSD + totalNetDividendsUSD;
    const totalGainEUR = totalRealizedEUR + totalUnrealizedEUR + totalNetDividendsEUR;
    const totalPctChange = totalInvestedEUR > 0 ? (totalGainEUR / totalInvestedEUR) * 100 : 0;

    res.json({
      stocks,
      totals: {
        totalInvestedUSD,
        totalInvestedEUR,
        holdingsCostUSD: totalCostUSD,
        holdingsCostEUR: totalCostEUR,
        holdingsValueUSD: totalValueUSD,
        holdingsValueEUR: totalValueEUR,
        unrealizedUSD: totalUnrealizedUSD,
        unrealizedEUR: totalUnrealizedEUR,
        realizedUSD: totalRealizedUSD,
        realizedEUR: totalRealizedEUR,
        dividendsUSD: totalDividendsUSD,
        dividendsEUR: totalDividendsEUR,
        taxPaidEUR: totalTaxPaidEUR,
        taxPaidUSD: convertToUSD(totalTaxPaidEUR, 'EUR', eurToUsd),
        netDividendsUSD: totalNetDividendsUSD,
        netDividendsEUR: totalNetDividendsEUR,
        totalGainUSD,
        totalGainEUR,
        cgtPaidEUR: totalCgtPaidEUR,
        totalGainAfterTaxEUR: totalGainEUR - totalCgtPaidEUR,
        pctChange: totalPctChange,
      },
      exchangeRate: { eurToUsd, stale: rateStale },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/portfolio/:ticker
router.get('/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const transactions = await getTransactions();
    await loadRateCache();
    await loadSplitsCache();
    const rateData = await fetchRate();
    const eurToUsd = rateData.rate;

    let splits = [];
    try {
      splits = await getSplits(ticker);
    } catch { /* no splits data */ }

    const tickerTxns = transactions
      .filter(t => t.ticker === ticker)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (tickerTxns.length === 0) {
      return res.status(404).json({ error: `No transactions found for ${ticker}` });
    }

    // Use shared calcStockSummary for cost/gain calculations
    const holding = buildHoldings(tickerTxns)[ticker];
    const summary = calcStockSummary(holding, eurToUsd, splits);

    // Build per-transaction detail with split info and realized gains (FIFO cost basis)
    const detail = [];
    const buyLotsUSD = []; // FIFO queue: { adjQty, costPerShareUSD }
    const buyLotsEUR = []; // FIFO queue: { adjQty, costPerShareEUR }
    let totalRealizedEUR = 0;
    let totalDividendsEUR = 0;
    let totalDividendsGrossEUR = 0;
    let totalDividendsTaxEUR = 0;
    let totalPurchasesEUR = 0;
    let totalSalesProceedsEUR = 0;
    let totalSalesGainEUR = 0;

    const toEUR = (amount, currency, rate) => currency === 'EUR' ? amount : amount / rate;

    for (const t of tickerTxns) {
      const txnRate = t.exchangeRate || eurToUsd;

      if (t.type === 'dividend') {
        const grossEUR = toEUR(t.dividendAmount, t.dividendCurrency, txnRate);
        const taxEUR = t.taxPaid || 0;
        const netEUR = grossEUR - taxEUR;
        totalDividendsEUR += netEUR;
        totalDividendsGrossEUR += grossEUR;
        totalDividendsTaxEUR += taxEUR;
        detail.push({ ...t, splitMultiplier: 1, adjustedQuantity: 0, adjustedPricePerShare: 0, realizedGainLossUSD: null, realizedGainLossEUR: null });
        continue;
      }
      const mult = splitMultiplier(splits, t.date);
      const adjQty = t.quantity * mult;
      const adjPricePerShare = t.pricePerShare / mult;
      const txnCostUSD = convertToUSD(t.pricePerShare * t.quantity, t.priceCurrency, eurToUsd);
      const txnCommUSD = convertToUSD(t.commission, t.commissionCurrency, eurToUsd);
      const txnCostEUR = toEUR(t.pricePerShare * t.quantity, t.priceCurrency, txnRate);
      const txnCommEUR = t.commission > 0 ? toEUR(t.commission, t.commissionCurrency, txnRate) : 0;

      if (t.type === 'buy') {
        const totalCostUSD = txnCostUSD + txnCommUSD;
        const totalCostEUR = txnCostEUR + txnCommEUR;
        buyLotsUSD.push({ adjQty, costPerShare: totalCostUSD / adjQty });
        buyLotsEUR.push({ adjQty, costPerShare: totalCostEUR / adjQty });
        totalPurchasesEUR += totalCostEUR;
        detail.push({ ...t, splitMultiplier: mult, adjustedQuantity: adjQty, adjustedPricePerShare: adjPricePerShare, realizedGainLossUSD: null, realizedGainLossEUR: null });
      } else {
        // FIFO: consume earliest buy lots
        let remainingUSD = adjQty;
        let costBasisUSD = 0;
        while (remainingUSD > 0 && buyLotsUSD.length > 0) {
          const lot = buyLotsUSD[0];
          const used = Math.min(remainingUSD, lot.adjQty);
          costBasisUSD += used * lot.costPerShare;
          lot.adjQty -= used;
          remainingUSD -= used;
          if (lot.adjQty <= 0) buyLotsUSD.shift();
        }

        let remainingEUR = adjQty;
        let costBasisEUR = 0;
        while (remainingEUR > 0 && buyLotsEUR.length > 0) {
          const lot = buyLotsEUR[0];
          const used = Math.min(remainingEUR, lot.adjQty);
          costBasisEUR += used * lot.costPerShare;
          lot.adjQty -= used;
          remainingEUR -= used;
          if (lot.adjQty <= 0) buyLotsEUR.shift();
        }

        const proceedsUSD = txnCostUSD - txnCommUSD;
        const proceedsEUR = txnCostEUR - txnCommEUR;
        const realizedUSD = proceedsUSD - costBasisUSD;
        const realizedEUR = proceedsEUR - costBasisEUR;
        totalRealizedEUR += realizedEUR;
        totalSalesProceedsEUR += proceedsEUR;
        totalSalesGainEUR += realizedEUR;
        detail.push({ ...t, splitMultiplier: mult, adjustedQuantity: adjQty, adjustedPricePerShare: adjPricePerShare, realizedGainLossUSD: realizedUSD, realizedGainLossEUR: realizedEUR });
      }
    }

    // Current holding summary
    await loadPriceCache();
    let currentPrice = null;
    let priceCurrency = 'USD';
    const txnName = tickerTxns.find(t => t.companyName)?.companyName;
    let name = txnName || ticker;
    let priceStale = false;

    try {
      const priceData = await getPrice(ticker);
      currentPrice = priceData.price;
      priceCurrency = priceData.currency || 'USD';
      name = priceData.name || name;
      priceStale = priceData.stale || false;
    } catch {
      priceStale = true;
    }

    // Remaining cost from FIFO lots
    const remainingCostUSD = buyLotsUSD.reduce((s, lot) => s + lot.adjQty * lot.costPerShare, 0);
    const remainingCostEUR = buyLotsEUR.reduce((s, lot) => s + lot.adjQty * lot.costPerShare, 0);

    const currentValueUSD = currentPrice && summary.quantityHeld > 0
      ? convertToUSD(currentPrice, priceCurrency, eurToUsd) * summary.quantityHeld
      : null;
    const currentValueEUR = currentPrice && summary.quantityHeld > 0
      ? convertToEUR(currentPrice, priceCurrency, eurToUsd) * summary.quantityHeld
      : null;
    const unrealizedUSD = currentValueUSD !== null ? currentValueUSD - remainingCostUSD : null;
    const unrealizedEURVal = currentValueEUR !== null ? currentValueEUR - remainingCostEUR : null;

    // Allocate actual tax paid to this stock using FIFO gains, separating stocks from ETFs
    const taxPaidData = loadTaxPaid();
    const allHoldings = buildHoldings(transactions);
    const allSplitsMap = {};
    for (const tk of Object.keys(allHoldings)) {
      try { allSplitsMap[tk] = await getSplits(tk); } catch { allSplitsMap[tk] = []; }
    }
    const gainsByYear = computeGainsByYear(allHoldings, allSplitsMap, eurToUsd);

    // Build asset type map
    const assetTypes = {};
    for (const [tk, h] of Object.entries(allHoldings)) {
      const allTkTxns = [...h.buys, ...h.sells, ...h.dividends];
      assetTypes[tk] = allTkTxns.find(t => t.assetType)?.assetType || 'stock';
    }

    const allAllocatedTax = computeAllocatedTax(gainsByYear, assetTypes, taxPaidData);
    const allocatedTaxEUR = allAllocatedTax[ticker] || 0;

    const totalProfitUSD = summary.realizedGainUSD + (unrealizedUSD || 0) + summary.netDividendsUSD;
    const totalProfitEUR = totalRealizedEUR + (unrealizedEURVal || 0) + totalDividendsEUR;
    const totalProfitAfterTaxEUR = totalProfitEUR - allocatedTaxEUR;
    const pctReturn = summary.totalInvestedEUR > 0 ? (totalProfitEUR / summary.totalInvestedEUR) * 100 : null;

    // Filter splits for closed positions
    const responseSplits = summary.quantityHeld === 0 && holding.sells.length > 0
      ? splits.filter(s => {
          const lastSellDate = [...holding.sells].sort((a, b) => new Date(b.date) - new Date(a.date))[0].date;
          return s.date <= lastSellDate;
        })
      : splits;

    res.json({
      ticker,
      name,
      quantityHeld: summary.quantityHeld,
      avgCostPerShareUSD: summary.avgCostPerShareUSD,
      avgCostPerShareEUR: summary.avgCostPerShareEUR,
      currentPriceUSD: currentPrice ? convertToUSD(currentPrice, priceCurrency, eurToUsd) : null,
      currentPriceEUR: currentPrice ? convertToEUR(currentPrice, priceCurrency, eurToUsd) : null,
      priceCurrency,
      priceStale,
      splits: responseSplits,
      transactions: detail,
      realizedUSD: summary.realizedGainUSD,
      realizedEUR: summary.realizedGainEUR,
      unrealizedUSD,
      unrealizedEUR: unrealizedEURVal,
      netDividendsUSD: summary.netDividendsUSD,
      netDividendsEUR: summary.netDividendsEUR,
      totalPurchasesEUR,
      totalSalesProceedsEUR,
      totalSalesGainEUR,
      totalSalesAfterTaxEUR: totalSalesProceedsEUR - allocatedTaxEUR,
      totalDividendsGrossEUR,
      totalDividendsTaxEUR,
      totalDividendsNetEUR: totalDividendsGrossEUR - totalDividendsTaxEUR,
      totalProfitUSD,
      totalProfitEUR,
      allocatedTaxEUR,
      totalProfitAfterTaxEUR,
      pctReturn,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
