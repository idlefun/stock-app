const express = require('express');
const { createCache } = require('../lib/cache');

const router = express.Router();
const cache = createCache('exchange-rate.json', 5 * 60 * 1000);

async function loadCache() {
  return cache.load();
}

async function fetchRate() {
  const fresh = cache.get(null);
  if (fresh) return fresh;

  try {
    const response = await fetch('https://api.frankfurter.app/latest?from=EUR&to=USD');
    if (!response.ok) throw new Error(`Exchange rate API returned ${response.status}`);
    const data = await response.json();

    await cache.set(null, {
      rate: data.rates.USD,
      from: 'EUR',
      to: 'USD',
    });
    return cache.get(null);
  } catch (err) {
    const stale = cache.getStale(null);
    if (stale) return { ...stale, stale: true };
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
