const express = require('express');
const { getTransactions } = require('./transactions');
const { getPrice, loadCache: loadPriceCache } = require('./prices');
const { fetchRate, loadCache: loadRateCache } = require('./exchangeRate');
const { getSplits, splitMultiplier, loadCache: loadSplitsCache } = require('./splits');

const router = express.Router();

function convertToUSD(amount, currency, usdToEur) {
  if (currency === 'USD') return amount;
  return amount / usdToEur;
}

function convertToEUR(amount, currency, usdToEur) {
  if (currency === 'EUR') return amount;
  return amount * usdToEur;
}

function buildHoldings(transactions) {
  const holdings = {};
  for (const t of transactions) {
    if (!holdings[t.ticker]) {
      holdings[t.ticker] = { ticker: t.ticker, buys: [], sells: [] };
    }
    if (t.type === 'buy') {
      holdings[t.ticker].buys.push(t);
    } else {
      holdings[t.ticker].sells.push(t);
    }
  }
  return holdings;
}

function calcStockSummary(holding, usdToEur, splits) {
  const { ticker, buys, sells } = holding;

  // Process all transactions in date order to track running avg cost
  const allTxns = [...buys, ...sells].sort((a, b) => new Date(a.date) - new Date(b.date));

  let totalAdjQty = 0;
  let totalCostUSD = 0;
  let realizedGainUSD = 0;
  let totalInvestedUSD = 0; // total ever spent on buys (for overall return calc)

  for (const t of allTxns) {
    const mult = splitMultiplier(splits, t.date);
    const adjQty = t.quantity * mult;
    const txnValueUSD = convertToUSD(t.pricePerShare * t.quantity, t.priceCurrency, usdToEur);
    const txnCommUSD = convertToUSD(t.commission, t.commissionCurrency, usdToEur);

    if (t.type === 'buy') {
      totalCostUSD += txnValueUSD + txnCommUSD;
      totalAdjQty += adjQty;
      totalInvestedUSD += txnValueUSD + txnCommUSD;
    } else {
      const avgCost = totalAdjQty > 0 ? totalCostUSD / totalAdjQty : 0;
      const costBasis = avgCost * adjQty;
      const proceeds = txnValueUSD - txnCommUSD;
      realizedGainUSD += proceeds - costBasis;
      totalCostUSD -= costBasis;
      totalAdjQty -= adjQty;
    }
  }

  const avgCostPerShareUSD = totalAdjQty > 0 ? totalCostUSD / totalAdjQty : 0;

  return {
    ticker,
    quantityHeld: totalAdjQty,
    totalCostUSD: totalCostUSD,
    totalCostEUR: convertToEUR(totalCostUSD, 'USD', usdToEur),
    avgCostPerShareUSD,
    avgCostPerShareEUR: convertToEUR(avgCostPerShareUSD, 'USD', usdToEur),
    realizedGainUSD,
    realizedGainEUR: convertToEUR(realizedGainUSD, 'USD', usdToEur),
    totalInvestedUSD,
    totalInvestedEUR: convertToEUR(totalInvestedUSD, 'USD', usdToEur),
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
    const usdToEur = rateData.rate;
    const rateStale = rateData.stale || false;

    const holdings = buildHoldings(transactions);
    const stocks = [];
    let totalCostUSD = 0;
    let totalValueUSD = 0;
    let totalRealizedUSD = 0;
    let totalInvestedUSD = 0;

    for (const [ticker, holding] of Object.entries(holdings)) {
      let splits = [];
      try {
        splits = await getSplits(ticker);
      } catch { /* no splits data */ }

      const summary = calcStockSummary(holding, usdToEur, splits);
      if (summary.quantityHeld === 0 && holding.sells.length === 0) continue;

      let currentPrice = null;
      let priceStale = false;
      // Use companyName from transactions as fallback for delisted stocks
      const allTxns = [...holding.buys, ...holding.sells];
      const txnName = allTxns.find(t => t.companyName)?.companyName;
      let name = txnName || ticker;

      // Fetch price for stocks we hold or have held (for name resolution)
      try {
        const priceData = await getPrice(ticker);
        currentPrice = priceData.price;
        priceStale = priceData.stale || false;
        name = priceData.name || name;
      } catch {
        priceStale = true;
      }

      const currentValueUSD = currentPrice && summary.quantityHeld > 0
        ? convertToUSD(currentPrice, 'USD', usdToEur) * summary.quantityHeld
        : null;

      // Unrealized gain on current holdings
      const unrealizedUSD = currentValueUSD !== null ? currentValueUSD - summary.totalCostUSD : null;
      // Total gain = realized + unrealized
      const totalGainUSD = summary.realizedGainUSD + (unrealizedUSD || 0);
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
        currentPriceEUR: currentPrice ? convertToEUR(currentPrice, 'USD', usdToEur) : null,
        currentValueUSD,
        currentValueEUR: currentValueUSD !== null ? convertToEUR(currentValueUSD, 'USD', usdToEur) : null,
        unrealizedUSD,
        unrealizedEUR: unrealizedUSD !== null ? convertToEUR(unrealizedUSD, 'USD', usdToEur) : null,
        realizedUSD: summary.realizedGainUSD,
        realizedEUR: summary.realizedGainEUR,
        totalGainUSD,
        totalGainEUR: convertToEUR(totalGainUSD, 'USD', usdToEur),
        totalInvestedUSD: summary.totalInvestedUSD,
        totalInvestedEUR: summary.totalInvestedEUR,
        pctChange: totalPct,
        priceStale,
      };

      stocks.push(stock);
      totalInvestedUSD += summary.totalInvestedUSD;
      totalRealizedUSD += summary.realizedGainUSD;
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
    const totalGainUSD = totalRealizedUSD + totalUnrealizedUSD;
    const totalPctChange = totalInvestedUSD > 0 ? (totalGainUSD / totalInvestedUSD) * 100 : 0;

    res.json({
      stocks,
      totals: {
        totalInvestedUSD,
        totalInvestedEUR: convertToEUR(totalInvestedUSD, 'USD', usdToEur),
        holdingsCostUSD: totalCostUSD,
        holdingsCostEUR: convertToEUR(totalCostUSD, 'USD', usdToEur),
        holdingsValueUSD: totalValueUSD,
        holdingsValueEUR: convertToEUR(totalValueUSD, 'USD', usdToEur),
        unrealizedUSD: totalUnrealizedUSD,
        unrealizedEUR: convertToEUR(totalUnrealizedUSD, 'USD', usdToEur),
        realizedUSD: totalRealizedUSD,
        realizedEUR: convertToEUR(totalRealizedUSD, 'USD', usdToEur),
        totalGainUSD: totalGainUSD,
        totalGainEUR: convertToEUR(totalGainUSD, 'USD', usdToEur),
        pctChange: totalPctChange,
      },
      exchangeRate: { usdToEur, stale: rateStale },
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
    const usdToEur = rateData.rate;

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

    // Calculate realized gain/loss per sell using split-adjusted average cost
    const detail = [];
    let totalAdjQty = 0;
    let totalCostUSD = 0;

    for (const t of tickerTxns) {
      const mult = splitMultiplier(splits, t.date);
      const adjQty = t.quantity * mult;
      const adjPricePerShare = t.pricePerShare / mult;
      const txnCostUSD = convertToUSD(t.pricePerShare * t.quantity, t.priceCurrency, usdToEur);
      const txnCommUSD = convertToUSD(t.commission, t.commissionCurrency, usdToEur);

      if (t.type === 'buy') {
        totalCostUSD += txnCostUSD + txnCommUSD;
        totalAdjQty += adjQty;
        detail.push({
          ...t,
          splitMultiplier: mult,
          adjustedQuantity: adjQty,
          adjustedPricePerShare: adjPricePerShare,
          realizedGainLossUSD: null,
          realizedGainLossEUR: null,
        });
      } else {
        const avgCost = totalAdjQty > 0 ? totalCostUSD / totalAdjQty : 0;
        const costBasis = avgCost * adjQty;
        const proceeds = txnCostUSD - txnCommUSD;
        const realizedUSD = proceeds - costBasis;

        totalCostUSD -= costBasis;
        totalAdjQty -= adjQty;

        detail.push({
          ...t,
          splitMultiplier: mult,
          adjustedQuantity: adjQty,
          adjustedPricePerShare: adjPricePerShare,
          realizedGainLossUSD: realizedUSD,
          realizedGainLossEUR: convertToEUR(realizedUSD, 'USD', usdToEur),
        });
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

    const avgCostPerShare = totalAdjQty > 0 ? totalCostUSD / totalAdjQty : 0;

    res.json({
      ticker,
      name,
      quantityHeld: totalAdjQty,
      avgCostPerShareUSD: avgCostPerShare,
      avgCostPerShareEUR: convertToEUR(avgCostPerShare, 'USD', usdToEur),
      currentPriceUSD: currentPrice,
      currentPriceEUR: currentPrice ? convertToEUR(currentPrice, 'USD', usdToEur) : null,
      priceStale,
      splits,
      transactions: detail,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
