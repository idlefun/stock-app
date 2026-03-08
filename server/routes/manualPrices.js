const express = require('express');
const { readOrDefault, writeJSON, withLock } = require('../lib/storage');

const router = express.Router();
const FILENAME = 'manual-prices.json';

async function getManualPrices() {
  return readOrDefault(FILENAME, {});
}

function priceKey(ticker, year) {
  return `${ticker}_${year}`;
}

// GET /api/manual-prices
router.get('/', async (req, res) => {
  try {
    const prices = await getManualPrices();
    res.json(prices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/manual-prices
// Body: { ticker, year, price, currency }
router.put('/', async (req, res) => {
  await withLock(FILENAME, async () => {
    try {
      const { ticker, year, price, currency } = req.body;
      if (!ticker || !year || price == null || !currency) {
        return res.status(400).json({ error: 'Missing required fields: ticker, year, price, currency' });
      }
      const prices = await getManualPrices();
      const key = priceKey(ticker.toUpperCase(), year);
      prices[key] = { ticker: ticker.toUpperCase(), year: Number(year), price: Number(price), currency };
      await writeJSON(FILENAME, prices);
      res.json(prices[key]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

// DELETE /api/manual-prices/:ticker/:year
router.delete('/:ticker/:year', async (req, res) => {
  await withLock(FILENAME, async () => {
    try {
      const prices = await getManualPrices();
      const key = priceKey(req.params.ticker.toUpperCase(), req.params.year);
      if (!prices[key]) {
        return res.status(404).json({ error: 'Manual price not found' });
      }
      delete prices[key];
      await writeJSON(FILENAME, prices);
      res.json({ deleted: key });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

module.exports = router;
module.exports.getManualPrices = getManualPrices;
