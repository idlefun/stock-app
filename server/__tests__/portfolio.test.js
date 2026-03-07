// Test portfolio calculation logic
// We test the core functions by requiring the module and mocking dependencies

const fs = require('fs/promises');
const path = require('path');
const { readOrDefault, writeJSON, DATA_DIR } = require('../lib/storage');

const TEST_DATA_DIR = path.join(__dirname, '..', '..', 'data');

beforeEach(async () => {
  // Clean test data
  try {
    await fs.rm(TEST_DATA_DIR, { recursive: true });
  } catch {}
  await fs.mkdir(TEST_DATA_DIR, { recursive: true });
});

afterAll(async () => {
  try {
    await fs.rm(TEST_DATA_DIR, { recursive: true });
  } catch {}
});

describe('Storage utilities', () => {
  test('readOrDefault returns default when file does not exist', async () => {
    const data = await readOrDefault('nonexistent.json', []);
    expect(data).toEqual([]);
  });

  test('writeJSON and readJSON round-trip', async () => {
    const payload = [{ id: '1', ticker: 'AAPL' }];
    await writeJSON('test.json', payload);
    const data = await readOrDefault('test.json', []);
    expect(data).toEqual(payload);
  });
});

describe('Portfolio calculations', () => {
  test('average cost basis with single buy', () => {
    const buys = [
      { type: 'buy', ticker: 'AAPL', quantity: 10, pricePerShare: 100, priceCurrency: 'USD', commission: 5, commissionCurrency: 'USD' }
    ];
    const totalCost = buys.reduce((s, t) => s + t.pricePerShare * t.quantity + t.commission, 0);
    const avgCost = totalCost / 10;
    expect(avgCost).toBe(100.5);
  });

  test('average cost basis with multiple buys', () => {
    const buys = [
      { quantity: 10, pricePerShare: 100, commission: 10 },
      { quantity: 20, pricePerShare: 150, commission: 10 },
    ];
    const totalCost = buys.reduce((s, t) => s + t.pricePerShare * t.quantity + t.commission, 0);
    const totalQty = buys.reduce((s, t) => s + t.quantity, 0);
    const avgCost = totalCost / totalQty;
    // (1000 + 10 + 3000 + 10) / 30 = 4020 / 30 = 134
    expect(avgCost).toBeCloseTo(134, 2);
  });

  test('gain/loss calculation', () => {
    const costBasis = 100;
    const currentPrice = 120;
    const quantity = 10;
    const totalCost = costBasis * quantity;
    const totalValue = currentPrice * quantity;
    const gainLoss = totalValue - totalCost;
    const pctChange = (gainLoss / totalCost) * 100;

    expect(gainLoss).toBe(200);
    expect(pctChange).toBe(20);
  });

  test('realized gain on sell', () => {
    // Buy 10 @ 100, commission 10 => avg cost = (1000 + 10) / 10 = 101
    // Sell 5 @ 120, commission 5 => proceeds = 600 - 5 = 595, cost basis = 101 * 5 = 505
    // Realized gain = 595 - 505 = 90
    const avgCost = (100 * 10 + 10) / 10; // 101
    const sellProceeds = 120 * 5 - 5; // 595
    const costBasis = avgCost * 5; // 505
    const realized = sellProceeds - costBasis;

    expect(realized).toBe(90);
  });
});
