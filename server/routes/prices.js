const express = require('express');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();
const { readOrDefault, writeJSON } = require('../lib/storage');

const router = express.Router();
const CACHE_FILE = 'prices.json';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let memoryCache = {};

async function loadCache() {
  const cached = await readOrDefault(CACHE_FILE, {});
  memoryCache = cached;
  return cached;
}

async function saveCache() {
  await writeJSON(CACHE_FILE, memoryCache);
}

function isFresh(entry) {
  if (!entry || !entry.fetchedAt) return false;
  return Date.now() - new Date(entry.fetchedAt).getTime() < CACHE_TTL;
}

async function getPrice(ticker) {
  if (memoryCache[ticker] && isFresh(memoryCache[ticker])) {
    return memoryCache[ticker];
  }

  try {
    const quote = await yahooFinance.quote(ticker);
    const entry = {
      price: quote.regularMarketPrice,
      currency: quote.currency || 'USD',
      name: quote.longName || quote.shortName || ticker,
      fetchedAt: new Date().toISOString()
    };
    memoryCache[ticker] = entry;
    await saveCache();
    return entry;
  } catch (err) {
    // Return stale cache if available
    if (memoryCache[ticker]) {
      return { ...memoryCache[ticker], stale: true };
    }
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
