const { toEUR, toUSD } = require('../lib/currency');

describe('toEUR', () => {
  test('returns amount unchanged for EUR currency', () => {
    expect(toEUR(100, 'EUR', 1.1)).toBe(100);
  });

  test('converts USD to EUR by dividing by rate', () => {
    // rate = what 1 EUR is worth in USD (e.g. 1.1)
    // $110 / 1.1 = €100
    expect(toEUR(110, 'USD', 1.1)).toBeCloseTo(100, 2);
  });

  test('converts with real-world rate', () => {
    // $49.57 * 49 shares at rate 1.2647
    const usdAmount = 49.57 * 49;
    const eurAmount = toEUR(usdAmount, 'USD', 1.2647);
    expect(eurAmount).toBeCloseTo(usdAmount / 1.2647, 2);
  });

  test('handles rate of 1', () => {
    expect(toEUR(100, 'USD', 1)).toBe(100);
  });

  test('handles zero amount', () => {
    expect(toEUR(0, 'USD', 1.1)).toBe(0);
  });
});

describe('toUSD', () => {
  test('returns amount unchanged for USD currency', () => {
    expect(toUSD(100, 'USD', 1.1)).toBe(100);
  });

  test('converts EUR to USD by multiplying by rate', () => {
    // €100 * 1.1 = $110
    expect(toUSD(100, 'EUR', 1.1)).toBeCloseTo(110, 2);
  });

  test('handles rate of 1', () => {
    expect(toUSD(100, 'EUR', 1)).toBe(100);
  });

  test('handles zero amount', () => {
    expect(toUSD(0, 'EUR', 1.1)).toBe(0);
  });
});
