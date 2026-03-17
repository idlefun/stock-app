const express = require('express');
const { getTransactions } = require('./transactions');
const { getPrice, loadCache: loadPriceCache } = require('./prices');
const { fetchRate, loadCache: loadRateCache } = require('./exchangeRate');
const { getSplits, splitMultiplier, loadCache: loadSplitsCache } = require('./splits');
const { toEUR, toUSD } = require('../lib/currency');
const { FifoTracker } = require('../lib/fifo');
const { loadTaxPaid } = require('../lib/taxPaid');
const { CGT_RATE, CGT_EXEMPTION, ETF_TAX_RATE } = require('../lib/taxConstants');

const router = express.Router();

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

function getAssetType(holding) {
  const txns = [...holding.buys, ...holding.sells, ...holding.dividends];
  return txns.find(t => t.assetType)?.assetType || 'stock';
}

function buildAssetTypeMap(holdings) {
  const types = {};
  for (const [tk, h] of Object.entries(holdings)) {
    types[tk] = getAssetType(h);
  }
  return types;
}

function filterSplitsForPosition(splits, holding) {
  if (holding.sells.length > 0) {
    const lastSellDate = [...holding.sells].sort((a, b) => new Date(b.date) - new Date(a.date))[0].date;
    return splits.filter(s => s.date <= lastSellDate);
  }
  return splits;
}

// Compute sell gains by year by ticker using FIFO cost basis
function computeGainsByYear(holdings, splitsMap, eurToUsd) {
  const gainsByYear = {};
  for (const [ticker, holding] of Object.entries(holdings)) {
    const splits = splitsMap[ticker] || [];
    const buySells = [...holding.buys, ...holding.sells]
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const fifo = new FifoTracker(['EUR']);
    for (const t of buySells) {
      const rate = t.exchangeRate || eurToUsd;
      const mult = splitMultiplier(splits, t.date);
      const adjQty = t.quantity * mult;
      const costEUR = toEUR(t.pricePerShare * t.quantity, t.priceCurrency, rate) +
        (t.commission > 0 ? toEUR(t.commission, t.commissionCurrency, rate) : 0);
      if (t.type === 'buy') {
        fifo.addBuy(adjQty, { EUR: costEUR });
      } else {
        const { EUR: costBasis } = fifo.consumeSell(adjQty);
        const proceeds = toEUR(t.pricePerShare * t.quantity, t.priceCurrency, rate) -
          (t.commission > 0 ? toEUR(t.commission, t.commissionCurrency, rate) : 0);
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

    const expectedStockCGT = Math.max(0, totalStockGain - CGT_EXEMPTION) * CGT_RATE;
    const expectedEtfTax = totalEtfGain * ETF_TAX_RATE;
    const totalExpected = expectedStockCGT + expectedEtfTax;
    if (totalExpected <= 0) continue;

    const stockShare = (expectedStockCGT / totalExpected) * actualPaid;
    const etfShare = (expectedEtfTax / totalExpected) * actualPaid;

    if (stockShare > 0 && totalStockGain > 0) {
      for (const [tk, gain] of Object.entries(tickerGains)) {
        if (gain > 0 && assetTypes[tk] !== 'etf') {
          allocated[tk] = (allocated[tk] || 0) + (gain / totalStockGain) * stockShare;
        }
      }
    }

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

// Average cost summary for the portfolio list endpoint
function calcStockSummary(holding, eurToUsd, splits) {
  const { ticker, buys, sells, dividends } = holding;
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
    const txnValueUSD = toUSD(t.pricePerShare * t.quantity, t.priceCurrency, eurToUsd);
    const txnCommUSD = toUSD(t.commission, t.commissionCurrency, eurToUsd);
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

  let dividendsUSD = 0;
  let dividendsEUR = 0;
  let taxPaidEUR = 0;
  for (const d of dividends) {
    const rate = d.exchangeRate || eurToUsd;
    dividendsUSD += toUSD(d.dividendAmount, d.dividendCurrency, eurToUsd);
    dividendsEUR += toEUR(d.dividendAmount, d.dividendCurrency, rate);
    taxPaidEUR += d.taxPaid || 0;
  }
  const taxPaidUSD = toUSD(taxPaidEUR, 'EUR', eurToUsd);

  return {
    ticker,
    quantityHeld: totalAdjQty,
    totalCostUSD,
    totalCostEUR,
    avgCostPerShareUSD: totalAdjQty > 0 ? totalCostUSD / totalAdjQty : 0,
    avgCostPerShareEUR: totalAdjQty > 0 ? totalCostEUR / totalAdjQty : 0,
    realizedGainUSD,
    realizedGainEUR,
    dividendsUSD,
    dividendsEUR,
    taxPaidEUR,
    taxPaidUSD,
    netDividendsUSD: dividendsUSD - taxPaidUSD,
    netDividendsEUR: dividendsEUR - taxPaidEUR,
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
    let totalCostUSD = 0, totalCostEUR = 0;
    let totalValueUSD = 0, totalValueEUR = 0;
    let totalRealizedUSD = 0, totalRealizedEUR = 0;
    let totalDividendsUSD = 0, totalDividendsEUR = 0;
    let totalTaxPaidEUR = 0;
    let totalNetDividendsUSD = 0, totalNetDividendsEUR = 0;
    let totalInvestedUSD = 0, totalInvestedEUR = 0;

    for (const [ticker, holding] of Object.entries(holdings)) {
      const splits = splitsMap[ticker];
      const summary = calcStockSummary(holding, eurToUsd, splits);
      if (summary.quantityHeld === 0 && holding.sells.length === 0 && holding.dividends.length === 0) continue;

      let currentPrice = null;
      let priceStale = false;
      const assetType = getAssetType(holding);
      const allTxns = [...holding.buys, ...holding.sells, ...holding.dividends];
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
        ? toUSD(currentPrice, priceCurrency, eurToUsd) * summary.quantityHeld : null;
      const currentValueEUR = currentPrice && summary.quantityHeld > 0
        ? toEUR(currentPrice, priceCurrency, eurToUsd) * summary.quantityHeld : null;

      const unrealizedUSD = currentValueUSD !== null ? currentValueUSD - summary.totalCostUSD : null;
      const unrealizedEUR = currentValueEUR !== null ? currentValueEUR - summary.totalCostEUR : null;
      const totalGainUSD = summary.realizedGainUSD + (unrealizedUSD || 0) + summary.netDividendsUSD;
      const totalGainEUR = summary.realizedGainEUR + (unrealizedEUR || 0) + summary.netDividendsEUR;
      const totalPct = summary.totalInvestedEUR > 0
        ? (totalGainEUR / summary.totalInvestedEUR) * 100 : null;

      const stock = {
        ticker, name, assetType,
        quantityHeld: summary.quantityHeld,
        totalCostUSD: summary.totalCostUSD,
        totalCostEUR: summary.totalCostEUR,
        currentPrice, priceCurrency,
        currentPriceEUR: currentPrice ? toEUR(currentPrice, priceCurrency, eurToUsd) : null,
        currentValueUSD, currentValueEUR,
        unrealizedUSD, unrealizedEUR,
        realizedUSD: summary.realizedGainUSD,
        realizedEUR: summary.realizedGainEUR,
        dividendsUSD: summary.dividendsUSD,
        dividendsEUR: summary.dividendsEUR,
        taxPaidEUR: summary.taxPaidEUR,
        taxPaidUSD: summary.taxPaidUSD,
        netDividendsUSD: summary.netDividendsUSD,
        netDividendsEUR: summary.netDividendsEUR,
        totalGainUSD, totalGainEUR,
        totalInvestedUSD: summary.totalInvestedUSD,
        totalInvestedEUR: summary.totalInvestedEUR,
        pctChange: totalPct,
        priceStale,
        splitRatio: (() => {
          const earliestDate = allTxns.reduce((earliest, t) => t.date < earliest ? t.date : earliest, allTxns[0].date);
          const relevantSplits = summary.quantityHeld === 0 && holding.sells.length > 0
            ? filterSplitsForPosition(splits, holding) : splits;
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

    // Allocate actual tax paid per ticker using FIFO gains
    const taxPaidData = loadTaxPaid();
    const totalCgtPaidEUR = Object.values(taxPaidData).reduce((sum, v) => sum + (Number(v) || 0), 0);
    const gainsByYear = computeGainsByYear(holdings, splitsMap, eurToUsd);
    const assetTypes = buildAssetTypeMap(holdings);
    const allocatedTaxByTicker = computeAllocatedTax(gainsByYear, assetTypes, taxPaidData);

    for (const stock of stocks) {
      stock.allocationPct = totalValueUSD > 0 && stock.currentValueUSD !== null
        ? (stock.currentValueUSD / totalValueUSD) * 100 : 0;
      stock.allocatedTaxEUR = allocatedTaxByTicker[stock.ticker] || 0;
      stock.totalGainAfterTaxEUR = stock.totalGainEUR - stock.allocatedTaxEUR;
    }

    const totalUnrealizedUSD = totalValueUSD - totalCostUSD;
    const totalUnrealizedEUR = totalValueEUR - totalCostEUR;
    const totalGainUSD = totalRealizedUSD + totalUnrealizedUSD + totalNetDividendsUSD;
    const totalGainEUR = totalRealizedEUR + totalUnrealizedEUR + totalNetDividendsEUR;

    res.json({
      stocks,
      totals: {
        totalInvestedUSD, totalInvestedEUR,
        holdingsCostUSD: totalCostUSD, holdingsCostEUR: totalCostEUR,
        holdingsValueUSD: totalValueUSD, holdingsValueEUR: totalValueEUR,
        unrealizedUSD: totalUnrealizedUSD, unrealizedEUR: totalUnrealizedEUR,
        realizedUSD: totalRealizedUSD, realizedEUR: totalRealizedEUR,
        dividendsUSD: totalDividendsUSD, dividendsEUR: totalDividendsEUR,
        taxPaidEUR: totalTaxPaidEUR, taxPaidUSD: toUSD(totalTaxPaidEUR, 'EUR', eurToUsd),
        netDividendsUSD: totalNetDividendsUSD, netDividendsEUR: totalNetDividendsEUR,
        totalGainUSD, totalGainEUR,
        cgtPaidEUR: totalCgtPaidEUR,
        totalGainAfterTaxEUR: totalGainEUR - totalCgtPaidEUR,
        pctChange: totalInvestedEUR > 0 ? (totalGainEUR / totalInvestedEUR) * 100 : 0,
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
    await loadPriceCache();
    await loadRateCache();
    await loadSplitsCache();
    const rateData = await fetchRate();
    const eurToUsd = rateData.rate;

    // Build holdings for all tickers (needed for tax allocation)
    const allHoldings = buildHoldings(transactions);
    const holding = allHoldings[ticker];
    if (!holding) {
      return res.status(404).json({ error: `No transactions found for ${ticker}` });
    }

    const allTickers = Object.keys(allHoldings);
    const splitsResults = await Promise.allSettled(allTickers.map(t => getSplits(t)));
    const allSplitsMap = {};
    allTickers.forEach((t, i) => {
      allSplitsMap[t] = splitsResults[i].status === 'fulfilled' ? splitsResults[i].value : [];
    });
    const splits = allSplitsMap[ticker];

    const summary = calcStockSummary(holding, eurToUsd, splits);

    const tickerTxns = [...holding.buys, ...holding.sells, ...holding.dividends]
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Build per-transaction detail with FIFO realized gains
    const detail = [];
    const fifo = new FifoTracker(['EUR', 'USD']);
    let totalRealizedUSD = 0;
    let totalRealizedEUR = 0;
    let totalDividendsEUR = 0;
    let totalDividendsGrossEUR = 0;
    let totalDividendsTaxEUR = 0;
    let totalPurchasesEUR = 0;
    let totalSalesProceedsEUR = 0;
    let totalSalesGainEUR = 0;

    for (const t of tickerTxns) {
      const txnRate = t.exchangeRate || eurToUsd;

      if (t.type === 'dividend') {
        const grossEUR = toEUR(t.dividendAmount, t.dividendCurrency, txnRate);
        const taxEUR = t.taxPaid || 0;
        totalDividendsEUR += grossEUR - taxEUR;
        totalDividendsGrossEUR += grossEUR;
        totalDividendsTaxEUR += taxEUR;
        detail.push({ ...t, splitMultiplier: 1, adjustedQuantity: 0, adjustedPricePerShare: 0, realizedGainLossUSD: null, realizedGainLossEUR: null });
        continue;
      }

      const mult = splitMultiplier(splits, t.date);
      const adjQty = t.quantity * mult;
      const adjPricePerShare = t.pricePerShare / mult;
      const txnCostUSD = toUSD(t.pricePerShare * t.quantity, t.priceCurrency, eurToUsd);
      const txnCommUSD = toUSD(t.commission, t.commissionCurrency, eurToUsd);
      const txnCostEUR = toEUR(t.pricePerShare * t.quantity, t.priceCurrency, txnRate);
      const txnCommEUR = t.commission > 0 ? toEUR(t.commission, t.commissionCurrency, txnRate) : 0;

      if (t.type === 'buy') {
        fifo.addBuy(adjQty, { EUR: txnCostEUR + txnCommEUR, USD: txnCostUSD + txnCommUSD });
        totalPurchasesEUR += txnCostEUR + txnCommEUR;
        detail.push({ ...t, splitMultiplier: mult, adjustedQuantity: adjQty, adjustedPricePerShare: adjPricePerShare, realizedGainLossUSD: null, realizedGainLossEUR: null });
      } else {
        const basis = fifo.consumeSell(adjQty);
        const proceedsUSD = txnCostUSD - txnCommUSD;
        const proceedsEUR = txnCostEUR - txnCommEUR;
        const realizedUSD = proceedsUSD - basis.USD;
        const realizedEUR = proceedsEUR - basis.EUR;
        totalRealizedUSD += realizedUSD;
        totalRealizedEUR += realizedEUR;
        totalSalesProceedsEUR += proceedsEUR;
        totalSalesGainEUR += realizedEUR;
        detail.push({ ...t, splitMultiplier: mult, adjustedQuantity: adjQty, adjustedPricePerShare: adjPricePerShare, realizedGainLossUSD: realizedUSD, realizedGainLossEUR: realizedEUR });
      }
    }

    // Current price
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

    const remainingCostUSD = fifo.remainingCost('USD');
    const remainingCostEUR = fifo.remainingCost('EUR');

    const currentValueUSD = currentPrice && summary.quantityHeld > 0
      ? toUSD(currentPrice, priceCurrency, eurToUsd) * summary.quantityHeld : null;
    const currentValueEUR = currentPrice && summary.quantityHeld > 0
      ? toEUR(currentPrice, priceCurrency, eurToUsd) * summary.quantityHeld : null;
    const unrealizedUSD = currentValueUSD !== null ? currentValueUSD - remainingCostUSD : null;
    const unrealizedEUR = currentValueEUR !== null ? currentValueEUR - remainingCostEUR : null;

    // Allocate actual tax paid
    const taxPaidData = loadTaxPaid();
    const gainsByYear = computeGainsByYear(allHoldings, allSplitsMap, eurToUsd);
    const assetTypes = buildAssetTypeMap(allHoldings);
    const allAllocatedTax = computeAllocatedTax(gainsByYear, assetTypes, taxPaidData);
    const allocatedTaxEUR = allAllocatedTax[ticker] || 0;

    const totalProfitUSD = totalRealizedUSD + (unrealizedUSD || 0) + summary.netDividendsUSD;
    const totalProfitEUR = totalRealizedEUR + (unrealizedEUR || 0) + totalDividendsEUR;
    const totalProfitAfterTaxEUR = totalProfitEUR - allocatedTaxEUR;
    const pctReturn = summary.totalInvestedEUR > 0 ? (totalProfitEUR / summary.totalInvestedEUR) * 100 : null;

    const responseSplits = summary.quantityHeld === 0 && holding.sells.length > 0
      ? filterSplitsForPosition(splits, holding) : splits;

    res.json({
      ticker, name,
      quantityHeld: summary.quantityHeld,
      avgCostPerShareUSD: summary.avgCostPerShareUSD,
      avgCostPerShareEUR: summary.avgCostPerShareEUR,
      currentPriceUSD: currentPrice ? toUSD(currentPrice, priceCurrency, eurToUsd) : null,
      currentPriceEUR: currentPrice ? toEUR(currentPrice, priceCurrency, eurToUsd) : null,
      priceCurrency, priceStale,
      splits: responseSplits,
      transactions: detail,
      realizedUSD: totalRealizedUSD,
      realizedEUR: totalRealizedEUR,
      unrealizedUSD, unrealizedEUR,
      netDividendsUSD: summary.netDividendsUSD,
      netDividendsEUR: summary.netDividendsEUR,
      totalPurchasesEUR,
      totalSalesProceedsEUR,
      totalSalesGainEUR,
      totalSalesAfterTaxEUR: totalSalesProceedsEUR - allocatedTaxEUR,
      totalDividendsGrossEUR,
      totalDividendsTaxEUR,
      totalDividendsNetEUR: totalDividendsGrossEUR - totalDividendsTaxEUR,
      totalProfitUSD, totalProfitEUR,
      allocatedTaxEUR,
      totalProfitAfterTaxEUR,
      pctReturn,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports._test = { buildHoldings, getAssetType, buildAssetTypeMap, computeGainsByYear, computeAllocatedTax, calcStockSummary };
