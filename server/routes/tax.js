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

      // Determine asset type from transactions
      const assetType = txns.find(t => t.assetType)?.assetType || 'stock';

      // Process buys and sells in date order using FIFO cost basis
      const buySells = txns.filter(t => t.type === 'buy' || t.type === 'sell')
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      // FIFO queue of buy lots: { adjQty, costPerShareEUR }
      const buyLots = [];

      for (const t of buySells) {
        const rate = t.exchangeRate || fallbackRate;
        const mult = splitMultiplier(splits, t.date);
        const adjQty = t.quantity * mult;

        if (t.type === 'buy') {
          const costEUR = toEUR(t.pricePerShare * t.quantity, t.priceCurrency, rate);
          const commEUR = t.commission > 0 ? toEUR(t.commission, t.commissionCurrency, rate) : 0;
          const costPerShareEUR = (costEUR + commEUR) / adjQty;
          buyLots.push({ adjQty, costPerShareEUR });
        } else {
          // Sell — consume earliest buy lots first (FIFO)
          let remaining = adjQty;
          let costBasis = 0;
          while (remaining > 0 && buyLots.length > 0) {
            const lot = buyLots[0];
            const used = Math.min(remaining, lot.adjQty);
            costBasis += used * lot.costPerShareEUR;
            lot.adjQty -= used;
            remaining -= used;
            if (lot.adjQty <= 0) buyLots.shift();
          }

          const proceedsEUR = toEUR(t.pricePerShare * t.quantity, t.priceCurrency, rate);
          const commEUR = t.commission > 0 ? toEUR(t.commission, t.commissionCurrency, rate) : 0;
          const netProceeds = proceedsEUR - commEUR;
          const gainEUR = netProceeds - costBasis;

          // Only include sells in the requested year
          if (t.date.startsWith(year)) {
            sales.push({
              id: t.id,
              ticker,
              assetType,
              date: t.date,
              quantity: t.quantity,
              pricePerShare: t.pricePerShare,
              priceCurrency: t.priceCurrency,
              proceedsEUR: netProceeds,
              costBasisEUR: costBasis,
              gainEUR,
            });
          }
        }
      }

      // Dividends for the requested year
      const divs = txns.filter(t => t.type === 'dividend' && t.date.startsWith(year));
      for (const d of divs) {
        const rate = d.exchangeRate || fallbackRate;
        const grossEUR = toEUR(d.dividendAmount, d.dividendCurrency, rate);
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

    // Split sales by asset type
    const stockSales = sales.filter(s => s.assetType !== 'etf');
    const etfSales = sales.filter(s => s.assetType === 'etf');

    // Stock totals
    const stockGainEUR = stockSales.reduce((s, t) => s + t.gainEUR, 0);
    const stockLossEUR = stockSales.filter(s => s.gainEUR < 0).reduce((s, t) => s + t.gainEUR, 0);

    // ETF totals
    const etfGainEUR = etfSales.reduce((s, t) => s + t.gainEUR, 0);
    const etfLossEUR = etfSales.filter(s => s.gainEUR < 0).reduce((s, t) => s + t.gainEUR, 0);

    // Combined totals
    const totalGainEUR = sales.reduce((s, t) => s + t.gainEUR, 0);
    const totalLossEUR = sales.filter(s => s.gainEUR < 0).reduce((s, t) => s + t.gainEUR, 0);
    const totalSalesTax = 0; // Now tracked via /api/tax-paid per year
    const totalDivGrossEUR = dividends.reduce((s, t) => s + t.grossEUR, 0);
    const totalDivTax = dividends.reduce((s, t) => s + t.taxPaid, 0);
    const totalDivNetEUR = dividends.reduce((s, t) => s + t.netEUR, 0);

    // Irish tax calculations — Stocks
    // CGT: 33% on net gains after €1,270 annual exemption. Losses offset gains.
    const CGT_RATE = 0.33;
    const CGT_EXEMPTION = 1270;
    const stockTaxableGain = Math.max(0, stockGainEUR - CGT_EXEMPTION);
    const expectedStockCGT = Math.floor(stockTaxableGain * CGT_RATE);

    // Irish tax calculations — ETFs
    // Exit tax: 41% on gains, no annual exemption
    const ETF_TAX_RATE = 0.41;
    const etfTaxableGain = Math.max(0, etfGainEUR);
    const expectedETFTax = Math.floor(etfTaxableGain * ETF_TAX_RATE);

    // Dividends: Irish income tax on foreign dividends
    // Standard rate: 52% (40% IT + 8% USC + 4% PRSI)
    // Penalty rates applied for years where dividends were not declared on time
    const PENALTY_RATES = {
      '2012': 0.70081,
      '2013': 0.66244,
      '2014': 0.62407,
      '2015': 0.5735,
    };
    const STANDARD_DIV_RATE = 0.52;
    const DIVIDEND_TAX_RATE = PENALTY_RATES[year] || STANDARD_DIV_RATE;
    const isPenaltyRate = !!PENALTY_RATES[year];
    const US_WHT_RATE = 0.15;
    let expectedDivTax = 0;
    for (const d of dividends) {
      const irishTax = d.grossEUR * DIVIDEND_TAX_RATE;
      // Credit for WHT already deducted at source (only for USD dividends)
      const whtCredit = d.taxPaid > 0 ? Math.min(d.taxPaid, d.grossEUR * US_WHT_RATE) : 0;
      expectedDivTax += Math.max(0, irishTax - whtCredit);
    }

    res.json({
      year,
      sales,
      dividends,
      totals: {
        salesGainEUR: totalGainEUR,
        salesLossEUR: totalLossEUR,
        stockGainEUR,
        stockLossEUR,
        etfGainEUR,
        etfLossEUR,
        salesTaxPaid: totalSalesTax,
        divGrossEUR: totalDivGrossEUR,
        divTaxPaid: totalDivTax,
        divNetEUR: totalDivNetEUR,
        totalTaxPaid: totalSalesTax + totalDivTax,
      },
      expected: {
        // Stocks
        cgtRate: CGT_RATE,
        cgtExemption: CGT_EXEMPTION,
        stockTaxableGain,
        stockCgt: expectedStockCGT,
        // ETFs
        etfTaxRate: ETF_TAX_RATE,
        etfTaxableGain,
        etfTax: expectedETFTax,
        // Combined CGT (backwards compat)
        taxableGain: stockTaxableGain + etfTaxableGain,
        cgt: expectedStockCGT + expectedETFTax,
        // Dividends
        dividendTaxRate: DIVIDEND_TAX_RATE,
        isPenaltyRate,
        dividendTax: expectedDivTax,
        totalExpected: expectedStockCGT + expectedETFTax + expectedDivTax,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
