const express = require('express');
const { getTransactions } = require('./transactions');
const { getPrice, loadCache: loadPriceCache } = require('./prices');
const { fetchRate, loadCache: loadRateCache } = require('./exchangeRate');
const { getSplits, splitMultiplier, loadCache: loadSplitsCache } = require('./splits');

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

function calcStockSummary(holding, eurToUsd, splits) {
  const { ticker, buys, sells, dividends } = holding;

  // Process buy/sell transactions in date order to track running avg cost
  const allTxns = [...buys, ...sells].sort((a, b) => new Date(a.date) - new Date(b.date));

  let totalAdjQty = 0;
  let totalCostUSD = 0;
  let realizedGainUSD = 0;
  let totalInvestedUSD = 0; // total ever spent on buys (for overall return calc)

  for (const t of allTxns) {
    const mult = splitMultiplier(splits, t.date);
    const adjQty = t.quantity * mult;
    const txnValueUSD = convertToUSD(t.pricePerShare * t.quantity, t.priceCurrency, eurToUsd);
    const txnCommUSD = convertToUSD(t.commission, t.commissionCurrency, eurToUsd);

    if (t.type === 'buy') {
      totalCostUSD += txnValueUSD + txnCommUSD;
      totalAdjQty += adjQty;
      totalInvestedUSD += txnValueUSD + txnCommUSD;
    } else {
      const avgCost = totalAdjQty > 0 ? totalCostUSD / totalAdjQty : 0;
      const costBasis = avgCost * adjQty;
      const sellTaxUSD = convertToUSD(t.taxPaid || 0, 'EUR', eurToUsd);
      const proceeds = txnValueUSD - txnCommUSD - sellTaxUSD;
      realizedGainUSD += proceeds - costBasis;
      totalCostUSD -= costBasis;
      totalAdjQty -= adjQty;
    }
  }

  // Sum dividends (net of tax)
  let dividendsUSD = 0;
  let taxPaidEUR = 0;
  for (const d of dividends) {
    dividendsUSD += convertToUSD(d.amount, d.amountCurrency, eurToUsd);
    taxPaidEUR += d.taxPaid || 0;
  }
  const taxPaidUSD = convertToUSD(taxPaidEUR, 'EUR', eurToUsd);
  const netDividendsUSD = dividendsUSD - taxPaidUSD;

  const avgCostPerShareUSD = totalAdjQty > 0 ? totalCostUSD / totalAdjQty : 0;

  return {
    ticker,
    quantityHeld: totalAdjQty,
    totalCostUSD: totalCostUSD,
    totalCostEUR: convertToEUR(totalCostUSD, 'USD', eurToUsd),
    avgCostPerShareUSD,
    avgCostPerShareEUR: convertToEUR(avgCostPerShareUSD, 'USD', eurToUsd),
    realizedGainUSD,
    realizedGainEUR: convertToEUR(realizedGainUSD, 'USD', eurToUsd),
    dividendsUSD,
    dividendsEUR: convertToEUR(dividendsUSD, 'USD', eurToUsd),
    taxPaidEUR,
    taxPaidUSD,
    netDividendsUSD,
    netDividendsEUR: convertToEUR(netDividendsUSD, 'USD', eurToUsd),
    totalInvestedUSD,
    totalInvestedEUR: convertToEUR(totalInvestedUSD, 'USD', eurToUsd),
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
    let totalValueUSD = 0;
    let totalRealizedUSD = 0;
    let totalDividendsUSD = 0;
    let totalTaxPaidEUR = 0;
    let totalNetDividendsUSD = 0;
    let totalInvestedUSD = 0;

    for (const [ticker, holding] of Object.entries(holdings)) {
      const splits = splitsMap[ticker];

      const summary = calcStockSummary(holding, eurToUsd, splits);
      if (summary.quantityHeld === 0 && holding.sells.length === 0 && holding.dividends.length === 0) continue;

      let currentPrice = null;
      let priceStale = false;
      const allTxns = [...holding.buys, ...holding.sells, ...holding.dividends];
      const txnName = allTxns.find(t => t.companyName)?.companyName;
      let name = txnName || ticker;

      const priceData = priceMap[ticker];
      if (priceData) {
        currentPrice = priceData.price;
        priceStale = priceData.stale || false;
        name = priceData.name || name;
      } else {
        priceStale = true;
      }

      const currentValueUSD = currentPrice && summary.quantityHeld > 0
        ? convertToUSD(currentPrice, 'USD', eurToUsd) * summary.quantityHeld
        : null;

      // Unrealized gain on current holdings
      const unrealizedUSD = currentValueUSD !== null ? currentValueUSD - summary.totalCostUSD : null;
      // Total gain = realized + unrealized + net dividends
      const totalGainUSD = summary.realizedGainUSD + (unrealizedUSD || 0) + summary.netDividendsUSD;
      const totalPct = summary.totalInvestedUSD > 0
        ? (totalGainUSD / summary.totalInvestedUSD) * 100
        : null;

      const stock = {
        ticker,
        name,
        quantityHeld: summary.quantityHeld,
        totalCostUSD: summary.totalCostUSD,
        totalCostEUR: summary.totalCostEUR,
        currentPriceUSD: currentPrice,
        currentPriceEUR: currentPrice ? convertToEUR(currentPrice, 'USD', eurToUsd) : null,
        currentValueUSD,
        currentValueEUR: currentValueUSD !== null ? convertToEUR(currentValueUSD, 'USD', eurToUsd) : null,
        unrealizedUSD,
        unrealizedEUR: unrealizedUSD !== null ? convertToEUR(unrealizedUSD, 'USD', eurToUsd) : null,
        realizedUSD: summary.realizedGainUSD,
        realizedEUR: summary.realizedGainEUR,
        dividendsUSD: summary.dividendsUSD,
        dividendsEUR: summary.dividendsEUR,
        taxPaidEUR: summary.taxPaidEUR,
        taxPaidUSD: summary.taxPaidUSD,
        netDividendsUSD: summary.netDividendsUSD,
        netDividendsEUR: summary.netDividendsEUR,
        totalGainUSD,
        totalGainEUR: convertToEUR(totalGainUSD, 'USD', eurToUsd),
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
      totalRealizedUSD += summary.realizedGainUSD;
      totalDividendsUSD += summary.dividendsUSD;
      totalTaxPaidEUR += summary.taxPaidEUR;
      totalNetDividendsUSD += summary.netDividendsUSD;
      if (summary.quantityHeld > 0) {
        totalCostUSD += summary.totalCostUSD;
        if (currentValueUSD !== null) totalValueUSD += currentValueUSD;
      }
    }

    // Allocation percentages
    for (const stock of stocks) {
      stock.allocationPct = totalValueUSD > 0 && stock.currentValueUSD !== null
        ? (stock.currentValueUSD / totalValueUSD) * 100
        : 0;
    }

    const totalUnrealizedUSD = totalValueUSD - totalCostUSD;
    const totalGainUSD = totalRealizedUSD + totalUnrealizedUSD + totalNetDividendsUSD;
    const totalPctChange = totalInvestedUSD > 0 ? (totalGainUSD / totalInvestedUSD) * 100 : 0;

    res.json({
      stocks,
      totals: {
        totalInvestedUSD,
        totalInvestedEUR: convertToEUR(totalInvestedUSD, 'USD', eurToUsd),
        holdingsCostUSD: totalCostUSD,
        holdingsCostEUR: convertToEUR(totalCostUSD, 'USD', eurToUsd),
        holdingsValueUSD: totalValueUSD,
        holdingsValueEUR: convertToEUR(totalValueUSD, 'USD', eurToUsd),
        unrealizedUSD: totalUnrealizedUSD,
        unrealizedEUR: convertToEUR(totalUnrealizedUSD, 'USD', eurToUsd),
        realizedUSD: totalRealizedUSD,
        realizedEUR: convertToEUR(totalRealizedUSD, 'USD', eurToUsd),
        dividendsUSD: totalDividendsUSD,
        dividendsEUR: convertToEUR(totalDividendsUSD, 'USD', eurToUsd),
        taxPaidEUR: totalTaxPaidEUR,
        taxPaidUSD: convertToUSD(totalTaxPaidEUR, 'EUR', eurToUsd),
        netDividendsUSD: totalNetDividendsUSD,
        netDividendsEUR: convertToEUR(totalNetDividendsUSD, 'USD', eurToUsd),
        totalGainUSD: totalGainUSD,
        totalGainEUR: convertToEUR(totalGainUSD, 'USD', eurToUsd),
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
    const detail = [];
    let runningAdjQty = 0;
    let runningCostUSD = 0;

    for (const t of tickerTxns) {
      if (t.type === 'dividend') {
        detail.push({ ...t, splitMultiplier: 1, adjustedQuantity: 0, adjustedPricePerShare: 0, realizedGainLossUSD: null, realizedGainLossEUR: null });
        continue;
      }
      const mult = splitMultiplier(splits, t.date);
      const adjQty = t.quantity * mult;
      const adjPricePerShare = t.pricePerShare / mult;
      const txnCostUSD = convertToUSD(t.pricePerShare * t.quantity, t.priceCurrency, eurToUsd);
      const txnCommUSD = convertToUSD(t.commission, t.commissionCurrency, eurToUsd);

      if (t.type === 'buy') {
        runningCostUSD += txnCostUSD + txnCommUSD;
        runningAdjQty += adjQty;
        detail.push({ ...t, splitMultiplier: mult, adjustedQuantity: adjQty, adjustedPricePerShare: adjPricePerShare, realizedGainLossUSD: null, realizedGainLossEUR: null });
      } else {
        const avgCost = runningAdjQty > 0 ? runningCostUSD / runningAdjQty : 0;
        const costBasis = avgCost * adjQty;
        const sellTaxUSD = convertToUSD(t.taxPaid || 0, 'EUR', eurToUsd);
        const proceeds = txnCostUSD - txnCommUSD - sellTaxUSD;
        const realizedUSD = proceeds - costBasis;
        runningCostUSD -= costBasis;
        runningAdjQty -= adjQty;
        detail.push({ ...t, splitMultiplier: mult, adjustedQuantity: adjQty, adjustedPricePerShare: adjPricePerShare, realizedGainLossUSD: realizedUSD, realizedGainLossEUR: convertToEUR(realizedUSD, 'USD', eurToUsd) });
      }
    }

    // Current holding summary
    await loadPriceCache();
    let currentPrice = null;
    const txnName = tickerTxns.find(t => t.companyName)?.companyName;
    let name = txnName || ticker;
    let priceStale = false;

    try {
      const priceData = await getPrice(ticker);
      currentPrice = priceData.price;
      name = priceData.name || name;
      priceStale = priceData.stale || false;
    } catch {
      priceStale = true;
    }

    const currentValueUSD = currentPrice && summary.quantityHeld > 0 ? currentPrice * summary.quantityHeld : null;
    const unrealizedUSD = currentValueUSD !== null ? currentValueUSD - summary.totalCostUSD : null;
    const totalProfitUSD = summary.realizedGainUSD + (unrealizedUSD || 0) + summary.netDividendsUSD;
    const pctReturn = summary.totalInvestedUSD > 0 ? (totalProfitUSD / summary.totalInvestedUSD) * 100 : null;

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
      currentPriceUSD: currentPrice,
      currentPriceEUR: currentPrice ? convertToEUR(currentPrice, 'USD', eurToUsd) : null,
      priceStale,
      splits: responseSplits,
      transactions: detail,
      realizedUSD: summary.realizedGainUSD,
      realizedEUR: summary.realizedGainEUR,
      unrealizedUSD,
      unrealizedEUR: unrealizedUSD !== null ? convertToEUR(unrealizedUSD, 'USD', eurToUsd) : null,
      netDividendsUSD: summary.netDividendsUSD,
      netDividendsEUR: summary.netDividendsEUR,
      totalProfitUSD,
      totalProfitEUR: convertToEUR(totalProfitUSD, 'USD', eurToUsd),
      pctReturn,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
