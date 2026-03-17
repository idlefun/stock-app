const express = require('express');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ validation: { logErrors: false } });
const { createCache } = require('../lib/cache');

const router = express.Router();
const cache = createCache('splits.json', 24 * 60 * 60 * 1000);

async function loadCache() {
  return cache.load();
}

async function getSplits(ticker) {
  const fresh = cache.get(ticker);
  if (fresh) return fresh.splits;

  try {
    const result = await yahooFinance.chart(ticker, {
      period1: '2000-01-01',
      period2: new Date().toISOString().split('T')[0],
      events: 'split',
    });

    const splitEvents = result.events?.splits || [];
    const splits = splitEvents
      .map(s => ({
        date: s.date.toISOString().split('T')[0],
        numerator: s.numerator,
        denominator: s.denominator,
        ratio: s.numerator / s.denominator,
        description: `${s.numerator}:${s.denominator} Split`,
      }))
      .filter(s => Number.isInteger(s.numerator) && Number.isInteger(s.denominator)
        && (s.denominator === 1 || s.numerator === 1));

    await cache.set(ticker, { splits });
    return splits;
  } catch (err) {
    const stale = cache.getStale(ticker);
    if (stale) return stale.splits;
    throw err;
  }
}

/**
 * Calculate the cumulative split multiplier for a transaction
 * dated `txnDate` — i.e., how many current shares does 1 original share equal?
 */
function splitMultiplier(splits, txnDate) {
  let multiplier = 1;
  for (const s of splits) {
    if (s.date > txnDate) {
      multiplier *= s.ratio;
    }
  }
  return multiplier;
}

// GET /api/splits?ticker=NVDA
router.get('/', async (req, res) => {
  try {
    const ticker = req.query.ticker;
    if (!ticker) {
      return res.status(400).json({ error: 'Query parameter "ticker" is required' });
    }

    await loadCache();
    const splits = await getSplits(ticker.toUpperCase());
    res.json(splits);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.getSplits = getSplits;
module.exports.splitMultiplier = splitMultiplier;
module.exports.loadCache = loadCache;
