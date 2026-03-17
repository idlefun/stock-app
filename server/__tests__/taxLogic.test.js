// Tests for tax calculation logic
// We test the tax computations by verifying expected values against known inputs

const { CGT_RATE, CGT_EXEMPTION, ETF_TAX_RATE, STANDARD_DIV_RATE, US_WHT_RATE, PENALTY_RATES } = require('../lib/taxConstants');

describe('Irish CGT calculations', () => {
  test('stock gain below exemption — no tax', () => {
    const gain = 1000;
    const taxable = Math.max(0, gain - CGT_EXEMPTION);
    expect(taxable).toBe(0);
    expect(Math.floor(taxable * CGT_RATE)).toBe(0);
  });

  test('stock gain at exemption boundary', () => {
    const gain = 1270;
    const taxable = Math.max(0, gain - CGT_EXEMPTION);
    expect(taxable).toBe(0);
  });

  test('stock gain above exemption', () => {
    const gain = 10000;
    const taxable = Math.max(0, gain - CGT_EXEMPTION);
    expect(taxable).toBe(8730);
    expect(Math.floor(taxable * CGT_RATE)).toBe(2880); // 8730 * 0.33 = 2880.9
  });

  test('large stock gain — real-world scenario', () => {
    const gain = 230032.95;
    const taxable = Math.max(0, gain - CGT_EXEMPTION);
    expect(taxable).toBeCloseTo(228762.95, 2);
    expect(Math.floor(taxable * CGT_RATE)).toBe(75491);
  });
});

describe('Irish ETF exit tax calculations', () => {
  test('ETF gain — no exemption, 41% rate', () => {
    const gain = 44565.28;
    const taxable = Math.max(0, gain);
    expect(Math.floor(taxable * ETF_TAX_RATE)).toBe(18271);
  });

  test('ETF loss — no tax', () => {
    const gain = -5000;
    const taxable = Math.max(0, gain);
    expect(taxable).toBe(0);
    expect(Math.floor(taxable * ETF_TAX_RATE)).toBe(0);
  });
});

describe('Irish dividend tax calculations', () => {
  test('standard rate dividend — 52% with WHT credit', () => {
    const grossEUR = 1000;
    const whtPaid = 150; // 15% WHT
    const irishTax = grossEUR * STANDARD_DIV_RATE; // 520
    const whtCredit = Math.min(whtPaid, grossEUR * US_WHT_RATE); // min(150, 150) = 150
    const netTax = Math.max(0, irishTax - whtCredit); // 520 - 150 = 370
    expect(netTax).toBe(370);
  });

  test('WHT credit capped at 15% of gross', () => {
    const grossEUR = 1000;
    const whtPaid = 300; // Overpaid WHT
    const whtCredit = Math.min(whtPaid, grossEUR * US_WHT_RATE); // min(300, 150) = 150
    expect(whtCredit).toBe(150);
  });

  test('no WHT paid — full Irish tax applies', () => {
    const grossEUR = 1000;
    const whtPaid = 0;
    const irishTax = grossEUR * STANDARD_DIV_RATE;
    const whtCredit = whtPaid > 0 ? Math.min(whtPaid, grossEUR * US_WHT_RATE) : 0;
    expect(whtCredit).toBe(0);
    expect(Math.max(0, irishTax - whtCredit)).toBe(520);
  });

  test('penalty rate for 2012 is higher than standard', () => {
    const grossEUR = 1000;
    const penaltyTax = grossEUR * PENALTY_RATES['2012'];
    const standardTax = grossEUR * STANDARD_DIV_RATE;
    expect(penaltyTax).toBeGreaterThan(standardTax);
    expect(penaltyTax).toBeCloseTo(700.81, 2);
  });
});

describe('combined stock + ETF tax scenario', () => {
  test('proportional split of actual tax paid', () => {
    const stockGain = 230032.95;
    const etfGain = 44565.28;

    const expectedStockCGT = Math.max(0, stockGain - CGT_EXEMPTION) * CGT_RATE;
    const expectedEtfTax = etfGain * ETF_TAX_RATE;
    const totalExpected = expectedStockCGT + expectedEtfTax;

    // Check expected values
    expect(Math.floor(expectedStockCGT)).toBe(75491);
    expect(Math.floor(expectedEtfTax)).toBe(18271);
    expect(Math.floor(totalExpected)).toBe(93763);

    // If actual paid = 93762, split proportionally
    const actualPaid = 93762;
    const stockSharePct = expectedStockCGT / totalExpected;
    const etfSharePct = expectedEtfTax / totalExpected;

    expect(stockSharePct + etfSharePct).toBeCloseTo(1, 10);
    expect(stockSharePct * actualPaid + etfSharePct * actualPaid).toBeCloseTo(actualPaid, 1);
  });
});
