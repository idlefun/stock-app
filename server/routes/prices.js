const express = require('express');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ validation: { logErrors: false } });
const { createCache } = require('../lib/cache');

const router = express.Router();
const cache = createCache('prices.json', 5 * 60 * 1000);

async function loadCache() {
  return cache.load();
}

async function getPrice(ticker) {
  const fresh = cache.get(ticker);
  if (fresh) return fresh;

  try {
    const quote = await yahooFinance.quote(ticker);
    const entry = {
      price: quote.regularMarketPrice,
      currency: quote.currency || 'USD',
      name: quote.longName || quote.shortName || ticker,
    };
    await cache.set(ticker, entry);
    return cache.get(ticker) || entry;
  } catch (err) {
    const stale = cache.getStale(ticker);
    if (stale) return { ...stale, stale: true };
    throw err;
  }
}

// GET /api/prices?tickers=AAPL,MSFT
router.get('/', async (req, res) => {
  try {
    const tickersParam = req.query.tickers;
    if (!tickersParam) {
      return res.status(400).json({ error: 'Query parameter "tickers" is required' });
    }

    await loadCache();

    const tickers = tickersParam.split(',').map(t => t.trim().toUpperCase());
    const results = {};

    for (const ticker of tickers) {
      try {
        results[ticker] = await getPrice(ticker);
      } catch (err) {
        results[ticker] = { error: err.message };
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.getPrice = getPrice;
module.exports.loadCache = loadCache;
