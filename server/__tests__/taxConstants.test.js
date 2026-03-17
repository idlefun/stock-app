const { CGT_RATE, CGT_EXEMPTION, ETF_TAX_RATE, STANDARD_DIV_RATE, US_WHT_RATE, PENALTY_RATES } = require('../lib/taxConstants');

describe('Tax constants', () => {
  test('CGT rate is 33%', () => {
    expect(CGT_RATE).toBe(0.33);
  });

  test('CGT exemption is €1,270', () => {
    expect(CGT_EXEMPTION).toBe(1270);
  });

  test('ETF exit tax rate is 41%', () => {
    expect(ETF_TAX_RATE).toBe(0.41);
  });

  test('standard dividend rate is 52%', () => {
    expect(STANDARD_DIV_RATE).toBe(0.52);
  });

  test('US WHT rate is 15%', () => {
    expect(US_WHT_RATE).toBe(0.15);
  });

  test('penalty rates exist for 2012-2015', () => {
    expect(PENALTY_RATES['2012']).toBeDefined();
    expect(PENALTY_RATES['2013']).toBeDefined();
    expect(PENALTY_RATES['2014']).toBeDefined();
    expect(PENALTY_RATES['2015']).toBeDefined();
    expect(PENALTY_RATES['2016']).toBeUndefined();
  });

  test('penalty rates are higher than standard rate', () => {
    for (const rate of Object.values(PENALTY_RATES)) {
      expect(rate).toBeGreaterThan(STANDARD_DIV_RATE);
    }
  });
});
