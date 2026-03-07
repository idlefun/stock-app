const express = require('express');
const { readOrDefault, writeJSON } = require('../lib/storage');

const router = express.Router();
const CACHE_FILE = 'exchange-rate.json';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let rateCache = null;

async function loadCache() {
  rateCache = await readOrDefault(CACHE_FILE, null);
  return rateCache;
}

async function saveCache() {
  await writeJSON(CACHE_FILE, rateCache);
}

function isFresh() {
  if (!rateCache || !rateCache.fetchedAt) return false;
  return Date.now() - new Date(rateCache.fetchedAt).getTime() < CACHE_TTL;
}

async function fetchRate() {
  if (rateCache && isFresh()) {
    return rateCache;
  }

  try {
    const response = await fetch('https://api.frankfurter.app/latest?from=EUR&to=USD');
    if (!response.ok) throw new Error(`Exchange rate API returned ${response.status}`);
    const data = await response.json();

    rateCache = {
      rate: data.rates.USD,
      from: 'EUR',
      to: 'USD',
      fetchedAt: new Date().toISOString()
    };
    await saveCache();
    return rateCache;
  } catch (err) {
    // Return stale cache if available
    if (rateCache) {
      return { ...rateCache, stale: true };
    }
    throw err;
  }
}

async function fetchHistoricalRate(dateStr) {
  try {
    const response = await fetch(`https://api.frankfurter.app/${dateStr}?from=EUR&to=USD`);
    if (!response.ok) throw new Error(`Exchange rate API returned ${response.status}`);
    const data = await response.json();
    return data.rates.USD;
  } catch (err) {
    // Fall back to current rate if historical not available
    const current = await fetchRate();
    return current.rate;
  }
}

// GET /api/exchange-rate
router.get('/', async (req, res) => {
  try {
    await loadCache();
    const rate = await fetchRate();
    res.json(rate);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.fetchRate = fetchRate;
module.exports.fetchHistoricalRate = fetchHistoricalRate;
module.exports.loadCache = loadCache;
