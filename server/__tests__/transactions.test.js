const { getHeldQuantity } = require('../routes/transactions');

describe('Transaction validation', () => {
  test('getHeldQuantity returns correct quantity after buys', () => {
    const transactions = [
      { ticker: 'AAPL', type: 'buy', quantity: 10 },
      { ticker: 'AAPL', type: 'buy', quantity: 5 },
    ];
    expect(getHeldQuantity(transactions, 'AAPL')).toBe(15);
  });

  test('getHeldQuantity returns correct quantity after buys and sells', () => {
    const transactions = [
      { ticker: 'AAPL', type: 'buy', quantity: 10 },
      { ticker: 'AAPL', type: 'sell', quantity: 3 },
      { ticker: 'AAPL', type: 'buy', quantity: 5 },
    ];
    expect(getHeldQuantity(transactions, 'AAPL')).toBe(12);
  });

  test('getHeldQuantity returns 0 for unknown ticker', () => {
    const transactions = [
      { ticker: 'AAPL', type: 'buy', quantity: 10 },
    ];
    expect(getHeldQuantity(transactions, 'MSFT')).toBe(0);
  });

  test('getHeldQuantity returns 0 when all shares sold', () => {
    const transactions = [
      { ticker: 'AAPL', type: 'buy', quantity: 10 },
      { ticker: 'AAPL', type: 'sell', quantity: 10 },
    ];
    expect(getHeldQuantity(transactions, 'AAPL')).toBe(0);
  });

  test('getHeldQuantity handles mixed tickers', () => {
    const transactions = [
      { ticker: 'AAPL', type: 'buy', quantity: 10 },
      { ticker: 'MSFT', type: 'buy', quantity: 20 },
      { ticker: 'AAPL', type: 'sell', quantity: 3 },
    ];
    expect(getHeldQuantity(transactions, 'AAPL')).toBe(7);
    expect(getHeldQuantity(transactions, 'MSFT')).toBe(20);
  });
});
