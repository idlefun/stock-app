const express = require('express');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

const router = express.Router();

// GET /api/search?q=AAPL
router.get('/', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const results = await yahooFinance.search(query.trim());
    const quotes = (results.quotes || [])
      .filter(q => q.quoteType === 'EQUITY')
      .map(q => ({
        ticker: q.symbol,
        name: q.longname || q.shortname || q.symbol,
        exchange: q.exchDisp || q.exchange
      }));

    res.json(quotes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
