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

    // Compute per-ticker allocated CGT using avg cost basis
    const taxPaidData = loadTaxPaid();
    const totalCgtPaidEUR = Object.values(taxPaidData).reduce((sum, v) => sum + (Number(v) || 0), 0);

    // Compute sell gains by year by ticker for proportional tax allocation
    const gainsByYear = {}; // { year: { ticker: gainEUR } }
    for (const [ticker, holding] of Object.entries(holdings)) {
      const splits = splitsMap[ticker];
      const buySells = [...holding.buys, ...holding.sells]
        .sort((a, b) => new Date(a.date) - new Date(b.date));
      let qty = 0, costEUR = 0;
      for (const t of buySells) {
        const rate = t.exchangeRate || eurToUsd;
        const mult = splitMultiplier(splits, t.date);
        const adjQty = t.quantity * mult;
        const toE = (amt, cur) => cur === 'EUR' ? amt : amt / rate;
        if (t.type === 'buy') {
          costEUR += toE(t.pricePerShare * t.quantity, t.priceCurrency) +
            (t.commission > 0 ? toE(t.commission, t.commissionCurrency) : 0);
          qty += adjQty;
        } else {
          const avg = qty > 0 ? costEUR / qty : 0;
          const basis = avg * adjQty;
          const proceeds = toE(t.pricePerShare * t.quantity, t.priceCurrency) -
            (t.commission > 0 ? toE(t.commission, t.commissionCurrency) : 0);
          const gain = proceeds - basis;
          costEUR -= basis;
          qty -= adjQty;
          const yr = t.date.substring(0, 4);
          if (!gainsByYear[yr]) gainsByYear[yr] = {};
          gainsByYear[yr][ticker] = (gainsByYear[yr][ticker] || 0) + gain;
        }
      }
    }

    // Allocate tax paid to each ticker proportionally per year
    const allocatedTaxByTicker = {};
    for (const [yr, tickerGains] of Object.entries(gainsByYear)) {
      const cgtPaid = taxPaidData[yr] || 0;
      if (cgtPaid <= 0) continue;
      const totalPositiveGains = Object.values(tickerGains).filter(g => g > 0).reduce((s, g) => s + g, 0);
      if (totalPositiveGains <= 0) continue;
      for (const [tk, gain] of Object.entries(tickerGains)) {
        if (gain > 0) {
          allocatedTaxByTicker[tk] = (allocatedTaxByTicker[tk] || 0) + (gain / totalPositiveGains) * cgtPaid;
        }
      }
    }

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

    // Build per-transaction detail with split info and realized gains
    // Track costs in EUR using each transaction's own exchange rate
    const detail = [];
    let runningAdjQty = 0;
    let runningCostUSD = 0;
    let runningCostEUR = 0;
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
        runningCostUSD += txnCostUSD + txnCommUSD;
        runningCostEUR += txnCostEUR + txnCommEUR;
        runningAdjQty += adjQty;
        totalPurchasesEUR += txnCostEUR + txnCommEUR;
        detail.push({ ...t, splitMultiplier: mult, adjustedQuantity: adjQty, adjustedPricePerShare: adjPricePerShare, realizedGainLossUSD: null, realizedGainLossEUR: null });
      } else {
        const avgCostUSD = runningAdjQty > 0 ? runningCostUSD / runningAdjQty : 0;
        const avgCostEUR = runningAdjQty > 0 ? runningCostEUR / runningAdjQty : 0;
        const costBasisUSD = avgCostUSD * adjQty;
        const costBasisEUR = avgCostEUR * adjQty;
        const proceedsUSD = txnCostUSD - txnCommUSD;
        const proceedsEUR = txnCostEUR - txnCommEUR;
        const realizedUSD = proceedsUSD - costBasisUSD;
        const realizedEUR = proceedsEUR - costBasisEUR;
        runningCostUSD -= costBasisUSD;
        runningCostEUR -= costBasisEUR;
        runningAdjQty -= adjQty;
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

    const currentValueUSD = currentPrice && summary.quantityHeld > 0
      ? convertToUSD(currentPrice, priceCurrency, eurToUsd) * summary.quantityHeld
      : null;
    const currentValueEUR = currentPrice && summary.quantityHeld > 0
      ? convertToEUR(currentPrice, priceCurrency, eurToUsd) * summary.quantityHeld
      : null;
    const unrealizedUSD = currentValueUSD !== null ? currentValueUSD - summary.totalCostUSD : null;
    const unrealizedEURVal = currentValueEUR !== null ? currentValueEUR - summary.totalCostEUR : null;

    // Calculate allocated CGT for this stock across all years
    const taxPaidData = loadTaxPaid();

    // Compute per-year gains for ALL stocks using avg cost basis
    const allTxnsByTicker = {};
    for (const t of transactions) {
      if (!allTxnsByTicker[t.ticker]) allTxnsByTicker[t.ticker] = [];
      allTxnsByTicker[t.ticker].push(t);
    }

    // For each ticker, compute sell gains by year
    const gainsByYear = {}; // { year: { ticker: gainEUR } }
    for (const [tk, txns] of Object.entries(allTxnsByTicker)) {
      let tkSplits = [];
      try { tkSplits = await getSplits(tk); } catch {}
      const buySells = txns.filter(t => t.type === 'buy' || t.type === 'sell')
        .sort((a, b) => new Date(a.date) - new Date(b.date));
      let qty = 0, costEUR = 0;
      for (const t of buySells) {
        const rate = t.exchangeRate || eurToUsd;
        const mult = splitMultiplier(tkSplits, t.date);
        const adjQty = t.quantity * mult;
        const toEUR = (amt, cur) => cur === 'EUR' ? amt : amt / rate;
        if (t.type === 'buy') {
          costEUR += toEUR(t.pricePerShare * t.quantity, t.priceCurrency) +
            (t.commission > 0 ? toEUR(t.commission, t.commissionCurrency) : 0);
          qty += adjQty;
        } else {
          const avg = qty > 0 ? costEUR / qty : 0;
          const basis = avg * adjQty;
          const proceeds = toEUR(t.pricePerShare * t.quantity, t.priceCurrency) -
            (t.commission > 0 ? toEUR(t.commission, t.commissionCurrency) : 0);
          const gain = proceeds - basis;
          costEUR -= basis;
          qty -= adjQty;
          const yr = t.date.substring(0, 4);
          if (!gainsByYear[yr]) gainsByYear[yr] = {};
          gainsByYear[yr][tk] = (gainsByYear[yr][tk] || 0) + gain;
        }
      }
    }

    // Allocate tax paid to this ticker proportionally per year
    let allocatedTaxEUR = 0;
    for (const [yr, tickerGains] of Object.entries(gainsByYear)) {
      const cgtPaid = taxPaidData[yr] || 0;
      if (cgtPaid <= 0) continue;
      const totalPositiveGains = Object.values(tickerGains).filter(g => g > 0).reduce((s, g) => s + g, 0);
      if (totalPositiveGains <= 0) continue;
      const thisGain = tickerGains[ticker] || 0;
      if (thisGain > 0) {
        allocatedTaxEUR += (thisGain / totalPositiveGains) * cgtPaid;
      }
    }

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
