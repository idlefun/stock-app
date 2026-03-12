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

    const q = query.trim();
    const searches = [yahooFinance.search(q)];
    // Also search with .DE suffix for European stocks
    if (!q.includes('.')) {
      searches.push(yahooFinance.search(q + '.DE').catch(() => ({ quotes: [] })));
    }
    const allResults = await Promise.all(searches);
    const seen = new Set();
    const quotes = [];
    for (const results of allResults) {
      for (const item of (results.quotes || [])) {
        if ((item.quoteType === 'EQUITY' || item.quoteType === 'ETF') && !seen.has(item.symbol)) {
          seen.add(item.symbol);
          quotes.push({
            ticker: item.symbol,
            name: item.longname || item.shortname || item.symbol,
            exchange: item.exchDisp || item.exchange,
            quoteType: item.quoteType,
          });
        }
      }
    }

    res.json(quotes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
