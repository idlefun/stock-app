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

async function computeFundHistory(txns, startCash, startYear, splitsMap, fallbackRate) {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = startYear; y <= currentYear; y++) years.push(y);

  const sorted = [...txns].sort((a, b) => new Date(a.date) - new Date(b.date));

  const snapshots = [];
  let cash = startCash;
  const holdings = {};
  let txnIdx = 0;

  for (const year of years) {
    const yearEnd = `${year}-12-31`;

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

    const stockValues = {};
    for (const ticker of Object.keys(holdings)) {
      const qty = holdings[ticker].quantity;
      if (qty <= 0) continue;

      let priceData;
      if (year === currentYear) {
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

  return snapshots;
}

// GET /api/fund-history?startCash=200000&startYear=2012&exclude=GWRE
router.get('/', async (req, res) => {
  try {
    const startCash = Number(req.query.startCash) || 200000;
    const startYear = Number(req.query.startYear) || 2012;
    const exclude = req.query.exclude ? req.query.exclude.split(',').map(t => t.trim().toUpperCase()) : [];
    const only = req.query.only ? req.query.only.split(',').map(t => t.trim().toUpperCase()) : [];

    const allTxns = await getTransactions();
    await loadRateCache();
    await loadSplitsCache();
    await loadPriceCache();

    let fallbackRate;
    try { fallbackRate = await fetchRate(); } catch { fallbackRate = 1; }

    let filtered;
    if (only.length > 0) {
      filtered = allTxns.filter(t => only.includes(t.ticker));
    } else if (exclude.length > 0) {
      filtered = allTxns.filter(t => !exclude.includes(t.ticker));
    } else {
      filtered = allTxns;
    }

    const tickers = [...new Set(filtered.map(t => t.ticker))];
    const splitsMap = {};
    for (const ticker of tickers) {
      try { splitsMap[ticker] = await getSplits(ticker); } catch { splitsMap[ticker] = []; }
    }

    const snapshots = await computeFundHistory(filtered, startCash, startYear, splitsMap, fallbackRate);

    res.json({ startCash, startYear, exclude, only, snapshots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
