const express = require('express');
const { getTransactions } = require('./transactions');
const { fetchRate, loadCache: loadRateCache } = require('./exchangeRate');
const { getSplits, splitMultiplier, loadCache: loadSplitsCache } = require('./splits');
const { toEUR } = require('../lib/currency');
const { FifoTracker } = require('../lib/fifo');
const { CGT_RATE, CGT_EXEMPTION, ETF_TAX_RATE, STANDARD_DIV_RATE, US_WHT_RATE, PENALTY_RATES } = require('../lib/taxConstants');

const router = express.Router();

// GET /api/tax?year=2025
router.get('/', async (req, res) => {
  try {
    const year = req.query.year;
    if (!year) return res.status(400).json({ error: 'year query parameter required' });

    const allTxns = await getTransactions();
    await loadRateCache();
    await loadSplitsCache();

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
      let splits = [];
      try { splits = await getSplits(ticker); } catch { /* no splits */ }

      const assetType = txns.find(t => t.assetType)?.assetType || 'stock';
      const buySells = txns.filter(t => t.type === 'buy' || t.type === 'sell')
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      const fifo = new FifoTracker(['EUR']);

      for (const t of buySells) {
        const rate = t.exchangeRate || fallbackRate;
        const mult = splitMultiplier(splits, t.date);
        const adjQty = t.quantity * mult;

        if (t.type === 'buy') {
          const costEUR = toEUR(t.pricePerShare * t.quantity, t.priceCurrency, rate);
          const commEUR = t.commission > 0 ? toEUR(t.commission, t.commissionCurrency, rate) : 0;
          fifo.addBuy(adjQty, { EUR: costEUR + commEUR });
        } else {
          const { EUR: costBasis } = fifo.consumeSell(adjQty);
          const proceedsEUR = toEUR(t.pricePerShare * t.quantity, t.priceCurrency, rate);
          const commEUR = t.commission > 0 ? toEUR(t.commission, t.commissionCurrency, rate) : 0;
          const netProceeds = proceedsEUR - commEUR;
          const gainEUR = netProceeds - costBasis;

          if (t.date.startsWith(year)) {
            sales.push({
              id: t.id, ticker, assetType, date: t.date,
              quantity: t.quantity, pricePerShare: t.pricePerShare, priceCurrency: t.priceCurrency,
              proceedsEUR: netProceeds, costBasisEUR: costBasis, gainEUR,
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
          id: d.id, ticker, date: d.date,
          grossEUR, taxPaid: d.taxPaid || 0, netEUR: grossEUR - (d.taxPaid || 0),
        });
      }
    }

    sales.sort((a, b) => new Date(a.date) - new Date(b.date));
    dividends.sort((a, b) => new Date(a.date) - new Date(b.date));

    const stockSales = sales.filter(s => s.assetType !== 'etf');
    const etfSales = sales.filter(s => s.assetType === 'etf');

    const stockGainEUR = stockSales.reduce((s, t) => s + t.gainEUR, 0);
    const stockLossEUR = stockSales.filter(s => s.gainEUR < 0).reduce((s, t) => s + t.gainEUR, 0);
    const etfGainEUR = etfSales.reduce((s, t) => s + t.gainEUR, 0);
    const etfLossEUR = etfSales.filter(s => s.gainEUR < 0).reduce((s, t) => s + t.gainEUR, 0);

    const totalGainEUR = sales.reduce((s, t) => s + t.gainEUR, 0);
    const totalLossEUR = sales.filter(s => s.gainEUR < 0).reduce((s, t) => s + t.gainEUR, 0);
    const totalDivGrossEUR = dividends.reduce((s, t) => s + t.grossEUR, 0);
    const totalDivTax = dividends.reduce((s, t) => s + t.taxPaid, 0);
    const totalDivNetEUR = dividends.reduce((s, t) => s + t.netEUR, 0);

    // Stock CGT
    const stockTaxableGain = Math.max(0, stockGainEUR - CGT_EXEMPTION);
    const expectedStockCGT = Math.floor(stockTaxableGain * CGT_RATE);

    // ETF exit tax
    const etfTaxableGain = Math.max(0, etfGainEUR);
    const expectedETFTax = Math.floor(etfTaxableGain * ETF_TAX_RATE);

    // Dividend tax
    const DIVIDEND_TAX_RATE = PENALTY_RATES[year] || STANDARD_DIV_RATE;
    const isPenaltyRate = !!PENALTY_RATES[year];
    let expectedDivTax = 0;
    for (const d of dividends) {
      const irishTax = d.grossEUR * DIVIDEND_TAX_RATE;
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
        stockGainEUR, stockLossEUR,
        etfGainEUR, etfLossEUR,
        salesTaxPaid: 0,
        divGrossEUR: totalDivGrossEUR,
        divTaxPaid: totalDivTax,
        divNetEUR: totalDivNetEUR,
        totalTaxPaid: totalDivTax,
      },
      expected: {
        cgtRate: CGT_RATE, cgtExemption: CGT_EXEMPTION,
        stockTaxableGain, stockCgt: expectedStockCGT,
        etfTaxRate: ETF_TAX_RATE, etfTaxableGain, etfTax: expectedETFTax,
        taxableGain: stockTaxableGain + etfTaxableGain,
        cgt: expectedStockCGT + expectedETFTax,
        dividendTaxRate: DIVIDEND_TAX_RATE, isPenaltyRate,
        dividendTax: expectedDivTax,
        totalExpected: expectedStockCGT + expectedETFTax + expectedDivTax,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
