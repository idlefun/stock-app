const express = require('express');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();
const { getTransactions } = require('./transactions');
const { fetchRate, loadCache: loadRateCache } = require('./exchangeRate');
const { getSplits, splitMultiplier, loadCache: loadSplitsCache } = require('./splits');
const { getPrice, loadCache: loadPriceCache } = require('./prices');
const { createCache } = require('../lib/cache');

const router = express.Router();
const histPriceCache = createCache('hist-prices.json', 24 * 60 * 60 * 1000);

function toEUR(amount, currency, rate) {
  if (currency === 'EUR') return amount;
  return amount / rate;
}

async function getHistoricalPrice(ticker, dateStr) {
  const cacheKey = `${ticker}_${dateStr}`;
  await histPriceCache.load();
  const cached = histPriceCache.get(cacheKey);
  if (cached) return cached;

  try {
    // Fetch a window around the target date to find closest trading day
    const target = new Date(dateStr);
    const from = new Date(target);
    from.setDate(from.getDate() - 10);
    const to = new Date(target);
    to.setDate(to.getDate() + 5);

    const result = await yahooFinance.chart(ticker, {
      period1: from.toISOString().split('T')[0],
      period2: to.toISOString().split('T')[0],
    });

    const quotes = result.quotes || [];
    if (quotes.length === 0) return null;

    // Find the closest quote on or before the target date
    let best = null;
    for (const q of quotes) {
      const qDate = new Date(q.date);
      if (qDate <= target) best = q;
    }
    if (!best && quotes.length > 0) best = quotes[0];

    const entry = {
      price: best.close,
      currency: result.meta?.currency || 'USD',
      date: new Date(best.date).toISOString().split('T')[0],
    };
    await histPriceCache.set(cacheKey, entry);
    return entry;
  } catch {
    return null;
  }
}

// GET /api/fund-history?startCash=200000&startYear=2012
router.get('/', async (req, res) => {
  try {
    const startCash = Number(req.query.startCash) || 200000;
    const startYear = Number(req.query.startYear) || 2012;

    const allTxns = await getTransactions();
    await loadRateCache();
    await loadSplitsCache();
    await loadPriceCache();

    let fallbackRate;
    try { fallbackRate = await fetchRate(); } catch { fallbackRate = 1; }

    // Sort transactions chronologically
    const sorted = [...allTxns].sort((a, b) => new Date(a.date) - new Date(b.date));

    // Determine year range
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let y = startYear; y <= currentYear; y++) years.push(y);

    // Get all unique tickers
    const allTickers = [...new Set(allTxns.map(t => t.ticker))];

    // Fetch splits for all tickers
    const splitsMap = {};
    for (const ticker of allTickers) {
      try { splitsMap[ticker] = await getSplits(ticker); } catch { splitsMap[ticker] = []; }
    }

    // Process transactions to get year-end snapshots
    const snapshots = [];
    let cash = startCash;
    const holdings = {}; // ticker -> { quantity (original, pre-split) }

    let txnIdx = 0;

    for (const year of years) {
      const yearEnd = `${year}-12-31`;

      // Process all transactions up to year-end
      while (txnIdx < sorted.length && sorted[txnIdx].date <= yearEnd) {
        const t = sorted[txnIdx];
        const rate = t.exchangeRate || fallbackRate;

        if (t.type === 'buy') {
          const costEUR = toEUR(t.pricePerShare * t.quantity, t.priceCurrency, rate);
          const commEUR = t.commission > 0 ? toEUR(t.commission, t.commissionCurrency, rate) : 0;
          cash -= costEUR + commEUR;

          if (!holdings[t.ticker]) holdings[t.ticker] = { quantity: 0 };
          const splits = splitsMap[t.ticker] || [];
          const mult = splitMultiplier(splits, t.date);
          holdings[t.ticker].quantity += t.quantity * mult;
        } else if (t.type === 'sell') {
          const proceedsEUR = toEUR(t.pricePerShare * t.quantity, t.priceCurrency, rate);
          const commEUR = t.commission > 0 ? toEUR(t.commission, t.commissionCurrency, rate) : 0;
          const taxEUR = t.taxPaid || 0;
          cash += proceedsEUR - commEUR - taxEUR;

          if (holdings[t.ticker]) {
            const splits = splitsMap[t.ticker] || [];
            const mult = splitMultiplier(splits, t.date);
            holdings[t.ticker].quantity -= t.quantity * mult;
            if (holdings[t.ticker].quantity <= 0.001) delete holdings[t.ticker];
          }
        } else if (t.type === 'dividend') {
          const grossEUR = toEUR(t.amount, t.amountCurrency, rate);
          cash += grossEUR - (t.taxPaid || 0);
        }

        txnIdx++;
      }

      // Get year-end values for held stocks
      const stockValues = {};
      const heldTickers = Object.keys(holdings);

      for (const ticker of heldTickers) {
        const qty = holdings[ticker].quantity;
        if (qty <= 0) continue;

        let priceData;
        if (year === currentYear) {
          // Use current price for current year
          try { priceData = await getPrice(ticker); } catch { priceData = null; }
        } else {
          priceData = await getHistoricalPrice(ticker, yearEnd);
        }

        if (priceData) {
          const valueInCurrency = priceData.price * qty;
          const valueEUR = toEUR(valueInCurrency, priceData.currency, fallbackRate);
          stockValues[ticker] = { quantity: qty, price: priceData.price, currency: priceData.currency, valueEUR };
        } else {
          stockValues[ticker] = { quantity: qty, price: null, currency: null, valueEUR: 0 };
        }
      }

      const stocksTotalEUR = Object.values(stockValues).reduce((s, v) => s + v.valueEUR, 0);

      snapshots.push({
        year,
        cash,
        stocks: stockValues,
        stocksTotalEUR,
        totalEUR: cash + stocksTotalEUR,
      });
    }

    res.json({ startCash, startYear, snapshots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
