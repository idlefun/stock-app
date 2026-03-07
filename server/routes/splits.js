const express = require('express');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();
const { readOrDefault, writeJSON } = require('../lib/storage');

const router = express.Router();
const CACHE_FILE = 'splits.json';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

let splitsCache = {};

async function loadCache() {
  splitsCache = await readOrDefault(CACHE_FILE, {});
  return splitsCache;
}

async function saveCache() {
  await writeJSON(CACHE_FILE, splitsCache);
}

function isFresh(entry) {
  if (!entry || !entry.fetchedAt) return false;
  return Date.now() - new Date(entry.fetchedAt).getTime() < CACHE_TTL;
}

async function getSplits(ticker) {
  if (splitsCache[ticker] && isFresh(splitsCache[ticker])) {
    return splitsCache[ticker].splits;
  }

  try {
    // Use chart() API with events: 'split' to get split history
    const result = await yahooFinance.chart(ticker, {
      period1: '2000-01-01',
      period2: new Date().toISOString().split('T')[0],
      events: 'split',
    });

    const splitEvents = result.events?.splits || [];
    const splits = splitEvents.map(s => ({
      date: s.date.toISOString().split('T')[0],
      numerator: s.numerator,
      denominator: s.denominator,
      ratio: s.numerator / s.denominator,
      description: `${s.numerator}:${s.denominator} Split`,
    }));

    splitsCache[ticker] = {
      splits,
      fetchedAt: new Date().toISOString(),
    };
    await saveCache();
    return splits;
  } catch (err) {
    if (splitsCache[ticker]) {
      return splitsCache[ticker].splits;
    }
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
