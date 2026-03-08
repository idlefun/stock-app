const express = require('express');
const { getTransactions } = require('./transactions');
const { fetchRate, loadCache: loadRateCache } = require('./exchangeRate');
const { getSplits, splitMultiplier, loadCache: loadSplitsCache } = require('./splits');

const router = express.Router();

function toEUR(amount, currency, rate) {
  if (currency === 'EUR') return amount;
  return amount / rate;
}

// GET /api/tax?year=2025
router.get('/', async (req, res) => {
  try {
    const year = req.query.year;
    if (!year) return res.status(400).json({ error: 'year query parameter required' });

    const allTxns = await getTransactions();
    await loadRateCache();
    await loadSplitsCache();

    // Get current EUR/USD rate as fallback
    let fallbackRate;
    try { fallbackRate = await fetchRate(); } catch { fallbackRate = 1; }

    // Group by ticker
    const byTicker = {};
    for (const t of allTxns) {
      if (!byTicker[t.ticker]) byTicker[t.ticker] = [];
      byTicker[t.ticker].push(t);
    }

    const sales = [];
    const dividends = [];

    for (const [ticker, txns] of Object.entries(byTicker)) {
      // Get splits for this ticker
      let splits = [];
      try { splits = await getSplits(ticker); } catch { /* no splits */ }

      // Process buys and sells in date order to compute avg cost basis
      const buySells = txns.filter(t => t.type === 'buy' || t.type === 'sell')
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      let totalAdjQty = 0;
      let totalCostEUR = 0;

      for (const t of buySells) {
        const rate = t.exchangeRate || fallbackRate;
        const mult = splitMultiplier(splits, t.date);
        const adjQty = t.quantity * mult;

        if (t.type === 'buy') {
          const costEUR = toEUR(t.pricePerShare * t.quantity, t.priceCurrency, rate);
          const commEUR = t.commission > 0 ? toEUR(t.commission, t.commissionCurrency, rate) : 0;
          totalCostEUR += costEUR + commEUR;
          totalAdjQty += adjQty;
        } else {
          // Sell
          const avgCostPerShare = totalAdjQty > 0 ? totalCostEUR / totalAdjQty : 0;
          const costBasis = avgCostPerShare * adjQty;
          const proceedsEUR = toEUR(t.pricePerShare * t.quantity, t.priceCurrency, rate);
          const commEUR = t.commission > 0 ? toEUR(t.commission, t.commissionCurrency, rate) : 0;
          const netProceeds = proceedsEUR - commEUR;
          const gainEUR = netProceeds - costBasis;

          totalCostEUR -= costBasis;
          totalAdjQty -= adjQty;

          // Only include sells in the requested year
          if (t.date.startsWith(year)) {
            sales.push({
              id: t.id,
              ticker,
              date: t.date,
              quantity: t.quantity,
              pricePerShare: t.pricePerShare,
              priceCurrency: t.priceCurrency,
              proceedsEUR: netProceeds,
              costBasisEUR: costBasis,
              gainEUR,
              taxPaid: t.taxPaid || 0,
            });
          }
        }
      }

      // Dividends for the requested year
      const divs = txns.filter(t => t.type === 'dividend' && t.date.startsWith(year));
      for (const d of divs) {
        const rate = d.exchangeRate || fallbackRate;
        const grossEUR = toEUR(d.amount, d.amountCurrency, rate);
        dividends.push({
          id: d.id,
          ticker,
          date: d.date,
          grossEUR,
          taxPaid: d.taxPaid || 0,
          netEUR: grossEUR - (d.taxPaid || 0),
        });
      }
    }

    // Sort by date
    sales.sort((a, b) => new Date(a.date) - new Date(b.date));
    dividends.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Totals
    const totalGainEUR = sales.reduce((s, t) => s + t.gainEUR, 0);
    const totalSalesTax = sales.reduce((s, t) => s + t.taxPaid, 0);
    const totalDivGrossEUR = dividends.reduce((s, t) => s + t.grossEUR, 0);
    const totalDivTax = dividends.reduce((s, t) => s + t.taxPaid, 0);
    const totalDivNetEUR = dividends.reduce((s, t) => s + t.netEUR, 0);

    res.json({
      year,
      sales,
      dividends,
      totals: {
        salesGainEUR: totalGainEUR,
        salesTaxPaid: totalSalesTax,
        divGrossEUR: totalDivGrossEUR,
        divTaxPaid: totalDivTax,
        divNetEUR: totalDivNetEUR,
        totalTaxPaid: totalSalesTax + totalDivTax,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
