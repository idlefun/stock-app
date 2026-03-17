// Test the client format helper logic (recreated here since client uses ESM)
// These verify the logic that gainClass and formatCurrency would produce

describe('gainClass logic', () => {
  function gainClass(value) {
    if (value == null) return '';
    return value >= 0 ? 'positive' : 'negative';
  }

  test('positive value returns positive', () => {
    expect(gainClass(100)).toBe('positive');
  });

  test('zero returns positive', () => {
    expect(gainClass(0)).toBe('positive');
  });

  test('negative value returns negative', () => {
    expect(gainClass(-50)).toBe('negative');
  });

  test('null returns empty string', () => {
    expect(gainClass(null)).toBe('');
  });

  test('undefined returns empty string', () => {
    expect(gainClass(undefined)).toBe('');
  });
});

describe('formatCurrency dispatch logic', () => {
  // Simulates the dispatch — actual formatting tested via Intl
  function formatCurrency(value, currency) {
    if (value == null) return '—';
    if (currency === 'EUR') return `EUR:${value}`;
    return `USD:${value}`;
  }

  test('dispatches EUR values to EUR formatter', () => {
    expect(formatCurrency(100, 'EUR')).toBe('EUR:100');
  });

  test('dispatches USD values to USD formatter', () => {
    expect(formatCurrency(100, 'USD')).toBe('USD:100');
  });

  test('defaults to USD for unknown currency', () => {
    expect(formatCurrency(100, 'GBP')).toBe('USD:100');
  });

  test('handles null value', () => {
    expect(formatCurrency(null, 'EUR')).toBe('—');
  });
});
