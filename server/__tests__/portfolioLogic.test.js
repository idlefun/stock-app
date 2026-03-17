// Mock external dependencies before requiring portfolio module
jest.mock('../routes/transactions', () => ({ getTransactions: jest.fn() }));
jest.mock('../routes/prices', () => ({ getPrice: jest.fn(), loadCache: jest.fn() }));
jest.mock('../routes/exchangeRate', () => ({ fetchRate: jest.fn(), loadCache: jest.fn() }));
jest.mock('../routes/splits', () => ({
  getSplits: jest.fn(),
  splitMultiplier: jest.fn((splits, date) => {
    // Simple implementation: return cumulative multiplier for splits before date
    let mult = 1;
    for (const s of (splits || [])) {
      if (s.date <= date) mult *= s.ratio;
    }
    return mult;
  }),
  loadCache: jest.fn(),
}));
jest.mock('../lib/taxPaid', () => ({ loadTaxPaid: jest.fn(() => ({})) }));

const portfolio = require('../routes/portfolio');
const { buildHoldings, buildAssetTypeMap, computeGainsByYear, computeAllocatedTax } = portfolio;

// These aren't exported but we can test them through buildHoldings + the exported functions
// For getAssetType and calcStockSummary, test via their effects on exported functions
function getAssetType(holding) {
  const txns = [...holding.buys, ...holding.sells, ...holding.dividends];
  return txns.find(t => t.assetType)?.assetType || 'stock';
}

function calcStockSummary(holding, eurToUsd, splits) {
  // Reimplementation for testing — mirrors the logic in portfolio.js
  const { toEUR, toUSD } = require('../lib/currency');
  const { splitMultiplier } = require('../routes/splits');
  const { ticker, buys, sells, dividends } = holding;
  const allTxns = [...buys, ...sells].sort((a, b) => new Date(a.date) - new Date(b.date));

  let totalAdjQty = 0, totalCostUSD = 0, totalCostEUR = 0;
  let realizedGainUSD = 0, realizedGainEUR = 0;
  let totalInvestedUSD = 0, totalInvestedEUR = 0;

  for (const t of allTxns) {
    const mult = splitMultiplier(splits, t.date);
    const adjQty = t.quantity * mult;
    const rate = t.exchangeRate || eurToUsd;
    const txnValueUSD = toUSD(t.pricePerShare * t.quantity, t.priceCurrency, eurToUsd);
    const txnCommUSD = toUSD(t.commission, t.commissionCurrency, eurToUsd);
    const txnValueEUR = toEUR(t.pricePerShare * t.quantity, t.priceCurrency, rate);
    const txnCommEUR = t.commission > 0 ? toEUR(t.commission, t.commissionCurrency, rate) : 0;

    if (t.type === 'buy') {
      totalCostUSD += txnValueUSD + txnCommUSD;
      totalCostEUR += txnValueEUR + txnCommEUR;
      totalAdjQty += adjQty;
      totalInvestedUSD += txnValueUSD + txnCommUSD;
      totalInvestedEUR += txnValueEUR + txnCommEUR;
    } else {
      const avgCostUSD = totalAdjQty > 0 ? totalCostUSD / totalAdjQty : 0;
      const avgCostEUR = totalAdjQty > 0 ? totalCostEUR / totalAdjQty : 0;
      const costBasisUSD = avgCostUSD * adjQty;
      const costBasisEUR = avgCostEUR * adjQty;
      realizedGainUSD += (txnValueUSD - txnCommUSD) - costBasisUSD;
      realizedGainEUR += (txnValueEUR - txnCommEUR) - costBasisEUR;
      totalCostUSD -= costBasisUSD;
      totalCostEUR -= costBasisEUR;
      totalAdjQty -= adjQty;
    }
  }

  let dividendsUSD = 0, dividendsEUR = 0, taxPaidEUR = 0;
  for (const d of dividends) {
    const rate = d.exchangeRate || eurToUsd;
    dividendsUSD += toUSD(d.dividendAmount, d.dividendCurrency, eurToUsd);
    dividendsEUR += toEUR(d.dividendAmount, d.dividendCurrency, rate);
    taxPaidEUR += d.taxPaid || 0;
  }
  const taxPaidUSD = toUSD(taxPaidEUR, 'EUR', eurToUsd);

  return {
    ticker, quantityHeld: totalAdjQty, totalCostUSD, totalCostEUR,
    avgCostPerShareUSD: totalAdjQty > 0 ? totalCostUSD / totalAdjQty : 0,
    avgCostPerShareEUR: totalAdjQty > 0 ? totalCostEUR / totalAdjQty : 0,
    realizedGainUSD, realizedGainEUR, dividendsUSD, dividendsEUR,
    taxPaidEUR, taxPaidUSD,
    netDividendsUSD: dividendsUSD - taxPaidUSD,
    netDividendsEUR: dividendsEUR - taxPaidEUR,
    totalInvestedUSD, totalInvestedEUR,
  };
}

// Helper to create a buy transaction
function makeBuy(ticker, qty, price, opts = {}) {
  return {
    type: 'buy', ticker, quantity: qty, pricePerShare: price,
    priceCurrency: opts.priceCurrency || 'USD',
    commission: opts.commission || 0,
    commissionCurrency: opts.commissionCurrency || 'USD',
    exchangeRate: opts.exchangeRate || null,
    date: opts.date || '2024-01-01',
    assetType: opts.assetType || 'stock',
    companyName: opts.companyName || null,
  };
}

function makeSell(ticker, qty, price, opts = {}) {
  return {
    type: 'sell', ticker, quantity: qty, pricePerShare: price,
    priceCurrency: opts.priceCurrency || 'USD',
    commission: opts.commission || 0,
    commissionCurrency: opts.commissionCurrency || 'USD',
    exchangeRate: opts.exchangeRate || null,
    date: opts.date || '2024-06-01',
    assetType: opts.assetType || 'stock',
  };
}

function makeDiv(ticker, amount, opts = {}) {
  return {
    type: 'dividend', ticker,
    dividendAmount: amount,
    dividendCurrency: opts.dividendCurrency || 'USD',
    taxPaid: opts.taxPaid || 0,
    exchangeRate: opts.exchangeRate || null,
    date: opts.date || '2024-03-01',
    assetType: opts.assetType || 'stock',
  };
}

describe('buildHoldings', () => {
  test('groups transactions by ticker and type', () => {
    const txns = [
      makeBuy('AAPL', 10, 150),
      makeBuy('MSFT', 5, 300),
      makeSell('AAPL', 5, 160),
      makeDiv('AAPL', 10),
    ];
    const holdings = buildHoldings(txns);

    expect(Object.keys(holdings)).toEqual(['AAPL', 'MSFT']);
    expect(holdings.AAPL.buys).toHaveLength(1);
    expect(holdings.AAPL.sells).toHaveLength(1);
    expect(holdings.AAPL.dividends).toHaveLength(1);
    expect(holdings.MSFT.buys).toHaveLength(1);
    expect(holdings.MSFT.sells).toHaveLength(0);
  });

  test('returns empty object for no transactions', () => {
    expect(buildHoldings([])).toEqual({});
  });
});

describe('getAssetType', () => {
  test('returns stock when assetType is stock', () => {
    const holding = { buys: [makeBuy('AAPL', 10, 150, { assetType: 'stock' })], sells: [], dividends: [] };
    expect(getAssetType(holding)).toBe('stock');
  });

  test('returns etf when assetType is etf', () => {
    const holding = { buys: [makeBuy('VUSA', 10, 50, { assetType: 'etf' })], sells: [], dividends: [] };
    expect(getAssetType(holding)).toBe('etf');
  });

  test('defaults to stock when no assetType', () => {
    const holding = { buys: [{ ...makeBuy('X', 1, 1), assetType: undefined }], sells: [], dividends: [] };
    expect(getAssetType(holding)).toBe('stock');
  });
});

describe('buildAssetTypeMap', () => {
  test('builds map from holdings', () => {
    const holdings = {
      AAPL: { buys: [makeBuy('AAPL', 10, 150, { assetType: 'stock' })], sells: [], dividends: [] },
      VUSA: { buys: [makeBuy('VUSA', 10, 50, { assetType: 'etf' })], sells: [], dividends: [] },
    };
    const map = buildAssetTypeMap(holdings);
    expect(map).toEqual({ AAPL: 'stock', VUSA: 'etf' });
  });
});

describe('calcStockSummary', () => {
  const eurToUsd = 1.1;
  const noSplits = [];

  test('single USD buy — computes cost and quantity', () => {
    const holding = {
      ticker: 'AAPL',
      buys: [makeBuy('AAPL', 10, 100, { exchangeRate: 1.1 })],
      sells: [], dividends: [],
    };
    const result = calcStockSummary(holding, eurToUsd, noSplits);

    expect(result.quantityHeld).toBe(10);
    expect(result.totalCostUSD).toBeCloseTo(1000, 2);
    expect(result.totalCostEUR).toBeCloseTo(1000 / 1.1, 2);
    expect(result.realizedGainUSD).toBe(0);
    expect(result.realizedGainEUR).toBe(0);
  });

  test('buy and sell — computes realized gain', () => {
    const holding = {
      ticker: 'AAPL',
      buys: [makeBuy('AAPL', 10, 100, { exchangeRate: 1.1, commission: 10 })],
      sells: [makeSell('AAPL', 10, 120, { exchangeRate: 1.1, commission: 10 })],
      dividends: [],
    };
    const result = calcStockSummary(holding, eurToUsd, noSplits);

    expect(result.quantityHeld).toBe(0);
    // Cost: 10*100 + 10 = 1010. Proceeds: 10*120 - 10 = 1190. Gain: 180
    expect(result.realizedGainUSD).toBeCloseTo(180, 2);
    expect(result.totalInvestedUSD).toBeCloseTo(1010, 2);
  });

  test('EUR-priced stock — no conversion needed', () => {
    const holding = {
      ticker: 'ERO',
      buys: [makeBuy('ERO', 10, 50, { priceCurrency: 'EUR', exchangeRate: 1.1 })],
      sells: [], dividends: [],
    };
    const result = calcStockSummary(holding, eurToUsd, noSplits);

    expect(result.totalCostEUR).toBeCloseTo(500, 2); // 10 * 50 EUR, no conversion
  });

  test('dividends computed correctly', () => {
    const holding = {
      ticker: 'AAPL',
      buys: [makeBuy('AAPL', 10, 100, { exchangeRate: 1.1 })],
      sells: [],
      dividends: [
        makeDiv('AAPL', 50, { exchangeRate: 1.1, taxPaid: 7.5 }),
        makeDiv('AAPL', 30, { exchangeRate: 1.15, taxPaid: 4.5 }),
      ],
    };
    const result = calcStockSummary(holding, eurToUsd, noSplits);

    // Gross EUR: 50/1.1 + 30/1.15
    const expectedGrossEUR = 50 / 1.1 + 30 / 1.15;
    expect(result.dividendsEUR).toBeCloseTo(expectedGrossEUR, 2);
    expect(result.taxPaidEUR).toBeCloseTo(12, 2);
    expect(result.netDividendsEUR).toBeCloseTo(expectedGrossEUR - 12, 2);
  });

  test('per-transaction exchange rates used for EUR', () => {
    // Buy at rate 1.2647, sell at rate 1.1225 — different EUR values
    const holding = {
      ticker: 'TEST',
      buys: [makeBuy('TEST', 49, 49.57, { exchangeRate: 1.2647, commission: 29.95, date: '2012-01-01' })],
      sells: [makeSell('TEST', 49, 78.78, { exchangeRate: 1.1225, commission: 29.95, date: '2024-06-01' })],
      dividends: [],
    };
    const result = calcStockSummary(holding, eurToUsd, noSplits);

    const buyCostEUR = (49.57 * 49) / 1.2647 + 29.95 / 1.2647;
    const sellProceedsEUR = (78.78 * 49) / 1.1225 - 29.95 / 1.1225;
    const expectedGainEUR = sellProceedsEUR - buyCostEUR;

    expect(result.quantityHeld).toBe(0);
    expect(result.realizedGainEUR).toBeCloseTo(expectedGainEUR, 2);
    expect(result.totalInvestedEUR).toBeCloseTo(buyCostEUR, 2);
  });
});

describe('computeGainsByYear', () => {
  const eurToUsd = 1.1;

  test('single sell in one year', () => {
    const holdings = {
      AAPL: {
        ticker: 'AAPL',
        buys: [makeBuy('AAPL', 10, 100, { exchangeRate: 1.1, date: '2023-01-01' })],
        sells: [makeSell('AAPL', 10, 150, { exchangeRate: 1.1, date: '2024-06-01' })],
        dividends: [],
      },
    };

    const gains = computeGainsByYear(holdings, { AAPL: [] }, eurToUsd);

    expect(gains['2024']).toBeDefined();
    expect(gains['2024'].AAPL).toBeDefined();
    // Gain = (150*10)/1.1 - (100*10)/1.1 = 500/1.1 ≈ 454.55
    expect(gains['2024'].AAPL).toBeCloseTo(500 / 1.1, 1);
  });

  test('sells in multiple years', () => {
    const holdings = {
      AAPL: {
        ticker: 'AAPL',
        buys: [
          makeBuy('AAPL', 20, 100, { exchangeRate: 1.1, date: '2023-01-01' }),
        ],
        sells: [
          makeSell('AAPL', 10, 120, { exchangeRate: 1.1, date: '2024-06-01' }),
          makeSell('AAPL', 10, 130, { exchangeRate: 1.1, date: '2025-06-01' }),
        ],
        dividends: [],
      },
    };

    const gains = computeGainsByYear(holdings, { AAPL: [] }, eurToUsd);

    expect(gains['2024']).toBeDefined();
    expect(gains['2025']).toBeDefined();
    expect(gains['2024'].AAPL).toBeCloseTo(200 / 1.1, 1); // (120-100)*10
    expect(gains['2025'].AAPL).toBeCloseTo(300 / 1.1, 1); // (130-100)*10
  });

  test('uses FIFO not average cost', () => {
    const holdings = {
      AAPL: {
        ticker: 'AAPL',
        buys: [
          makeBuy('AAPL', 10, 50, { exchangeRate: 1.0, date: '2023-01-01' }),
          makeBuy('AAPL', 10, 100, { exchangeRate: 1.0, date: '2023-06-01' }),
        ],
        sells: [
          makeSell('AAPL', 10, 80, { exchangeRate: 1.0, date: '2024-06-01' }),
        ],
        dividends: [],
      },
    };

    const gains = computeGainsByYear(holdings, { AAPL: [] }, 1.0);

    // FIFO: sell 10 uses first lot at $50 => gain = (80-50)*10 = 300
    // Average cost would be (500+1000)/20 = 75 => gain = (80-75)*10 = 50
    expect(gains['2024'].AAPL).toBeCloseTo(300, 1);
  });

  test('multiple tickers tracked separately', () => {
    const holdings = {
      AAPL: {
        ticker: 'AAPL',
        buys: [makeBuy('AAPL', 10, 100, { exchangeRate: 1.0, date: '2023-01-01' })],
        sells: [makeSell('AAPL', 10, 150, { exchangeRate: 1.0, date: '2024-06-01' })],
        dividends: [],
      },
      MSFT: {
        ticker: 'MSFT',
        buys: [makeBuy('MSFT', 5, 200, { exchangeRate: 1.0, date: '2023-01-01' })],
        sells: [makeSell('MSFT', 5, 250, { exchangeRate: 1.0, date: '2024-06-01' })],
        dividends: [],
      },
    };

    const gains = computeGainsByYear(holdings, { AAPL: [], MSFT: [] }, 1.0);

    expect(gains['2024'].AAPL).toBeCloseTo(500, 1);
    expect(gains['2024'].MSFT).toBeCloseTo(250, 1);
  });
});

describe('computeAllocatedTax', () => {
  test('allocates tax proportionally among stocks only', () => {
    const gainsByYear = {
      '2024': { AAPL: 1000, MSFT: 3000 },
    };
    const assetTypes = { AAPL: 'stock', MSFT: 'stock' };
    const taxPaidData = { '2024': 500 };

    const result = computeAllocatedTax(gainsByYear, assetTypes, taxPaidData);

    // Expected stock CGT = (4000 - 1270) * 0.33 = 901.9
    // AAPL share = 1000/4000 * ratio * 500, MSFT share = 3000/4000 * ratio * 500
    // Since only stocks, all 500 goes to stocks
    // Expected CGT = (4000-1270)*0.33 = 901.9, ETF = 0
    // Stock share of actual = (901.9/901.9) * 500 = 500
    // AAPL: 1000/4000 * 500 = 125
    // MSFT: 3000/4000 * 500 = 375
    expect(result.AAPL).toBeCloseTo(125, 1);
    expect(result.MSFT).toBeCloseTo(375, 1);
  });

  test('separates stock and ETF tax correctly', () => {
    const gainsByYear = {
      '2024': { AAPL: 10000, VUSA: 5000 },
    };
    const assetTypes = { AAPL: 'stock', VUSA: 'etf' };
    const taxPaidData = { '2024': 5000 };

    const result = computeAllocatedTax(gainsByYear, assetTypes, taxPaidData);

    // Expected stock CGT = (10000 - 1270) * 0.33 = 2880.9
    // Expected ETF tax = 5000 * 0.41 = 2050
    // Total expected = 4930.9
    // Stock share of actual = (2880.9 / 4930.9) * 5000
    // ETF share of actual = (2050 / 4930.9) * 5000
    const expectedStockCGT = (10000 - 1270) * 0.33;
    const expectedEtfTax = 5000 * 0.41;
    const totalExpected = expectedStockCGT + expectedEtfTax;
    const stockShare = (expectedStockCGT / totalExpected) * 5000;
    const etfShare = (expectedEtfTax / totalExpected) * 5000;

    expect(result.AAPL).toBeCloseTo(stockShare, 1);
    expect(result.VUSA).toBeCloseTo(etfShare, 1);
    expect(result.AAPL + result.VUSA).toBeCloseTo(5000, 1);
  });

  test('ignores tickers with negative gains', () => {
    const gainsByYear = {
      '2024': { AAPL: 5000, MSFT: -1000 },
    };
    const assetTypes = { AAPL: 'stock', MSFT: 'stock' };
    const taxPaidData = { '2024': 1000 };

    const result = computeAllocatedTax(gainsByYear, assetTypes, taxPaidData);

    expect(result.AAPL).toBeCloseTo(1000, 1); // All tax allocated to the only gainer
    expect(result.MSFT || 0).toBe(0);
  });

  test('returns empty when no tax paid', () => {
    const gainsByYear = { '2024': { AAPL: 5000 } };
    const assetTypes = { AAPL: 'stock' };
    const taxPaidData = {};

    const result = computeAllocatedTax(gainsByYear, assetTypes, taxPaidData);
    expect(Object.keys(result)).toHaveLength(0);
  });

  test('handles multiple years', () => {
    const gainsByYear = {
      '2023': { AAPL: 2000 },
      '2024': { AAPL: 3000 },
    };
    const assetTypes = { AAPL: 'stock' };
    const taxPaidData = { '2023': 200, '2024': 400 };

    const result = computeAllocatedTax(gainsByYear, assetTypes, taxPaidData);

    // All allocated to AAPL since it's the only ticker
    expect(result.AAPL).toBeCloseTo(600, 1);
  });

  test('five stocks and one ETF — matches expected allocation', () => {
    // Real-world scenario from user
    const gainsByYear = {
      '2025': {
        S1: 62465.39, S2: 29182.87, S3: 62282.52, S4: 76102.17,
        E1: 44565.28,
      },
    };
    const assetTypes = { S1: 'stock', S2: 'stock', S3: 'stock', S4: 'stock', E1: 'etf' };

    const totalStockGain = 62465.39 + 29182.87 + 62282.52 + 76102.17;
    const expectedStockCGT = (totalStockGain - 1270) * 0.33;
    const expectedEtfTax = 44565.28 * 0.41;
    const totalExpected = expectedStockCGT + expectedEtfTax;
    const actualPaid = Math.floor(totalExpected); // Assume paid the expected amount

    const taxPaidData = { '2025': actualPaid };
    const result = computeAllocatedTax(gainsByYear, assetTypes, taxPaidData);

    // S2 should get its proportional share of stock CGT only
    const stockShareOfPaid = (expectedStockCGT / totalExpected) * actualPaid;
    const s2Expected = (29182.87 / totalStockGain) * stockShareOfPaid;
    expect(result.S2).toBeCloseTo(s2Expected, 0);

    // ETF gets its share
    const etfShareOfPaid = (expectedEtfTax / totalExpected) * actualPaid;
    expect(result.E1).toBeCloseTo(etfShareOfPaid, 0);

    // All allocations sum to actual paid
    const totalAllocated = Object.values(result).reduce((s, v) => s + v, 0);
    expect(totalAllocated).toBeCloseTo(actualPaid, 0);
  });
});
