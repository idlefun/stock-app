const { FifoTracker } = require('../lib/fifo');

describe('FifoTracker', () => {
  describe('single currency (EUR)', () => {
    test('single buy and full sell', () => {
      const fifo = new FifoTracker(['EUR']);
      fifo.addBuy(10, { EUR: 1000 }); // 10 shares @ €100 each
      const result = fifo.consumeSell(10);
      expect(result.EUR).toBeCloseTo(1000, 2);
    });

    test('single buy and partial sell', () => {
      const fifo = new FifoTracker(['EUR']);
      fifo.addBuy(10, { EUR: 1000 }); // 10 @ €100
      const result = fifo.consumeSell(3);
      expect(result.EUR).toBeCloseTo(300, 2);
    });

    test('FIFO ordering — sells consume earliest lots first', () => {
      const fifo = new FifoTracker(['EUR']);
      fifo.addBuy(10, { EUR: 1000 }); // 10 @ €100
      fifo.addBuy(10, { EUR: 2000 }); // 10 @ €200

      // Sell 15: first 10 from lot 1 (€1000) + 5 from lot 2 (€1000)
      const result = fifo.consumeSell(15);
      expect(result.EUR).toBeCloseTo(2000, 2);
    });

    test('multiple sells deplete lots correctly', () => {
      const fifo = new FifoTracker(['EUR']);
      fifo.addBuy(10, { EUR: 1000 }); // 10 @ €100
      fifo.addBuy(10, { EUR: 2000 }); // 10 @ €200

      // First sell: 10 from lot 1
      const sell1 = fifo.consumeSell(10);
      expect(sell1.EUR).toBeCloseTo(1000, 2);

      // Second sell: 10 from lot 2
      const sell2 = fifo.consumeSell(10);
      expect(sell2.EUR).toBeCloseTo(2000, 2);
    });

    test('sell more than available returns available cost basis', () => {
      const fifo = new FifoTracker(['EUR']);
      fifo.addBuy(5, { EUR: 500 });
      const result = fifo.consumeSell(10);
      expect(result.EUR).toBeCloseTo(500, 2);
    });

    test('sell with no lots returns 0', () => {
      const fifo = new FifoTracker(['EUR']);
      const result = fifo.consumeSell(10);
      expect(result.EUR).toBe(0);
    });
  });

  describe('dual currency (EUR + USD)', () => {
    test('tracks both currencies independently', () => {
      const fifo = new FifoTracker(['EUR', 'USD']);
      fifo.addBuy(10, { EUR: 900, USD: 1000 }); // 10 shares, €90/share, $100/share
      fifo.addBuy(10, { EUR: 1800, USD: 2200 }); // 10 shares, €180/share, $220/share

      const result = fifo.consumeSell(15);
      // EUR: 10 * 90 + 5 * 180 = 900 + 900 = 1800
      expect(result.EUR).toBeCloseTo(1800, 2);
      // USD: 10 * 100 + 5 * 220 = 1000 + 1100 = 2100
      expect(result.USD).toBeCloseTo(2100, 2);
    });

    test('partial sell tracks both currencies', () => {
      const fifo = new FifoTracker(['EUR', 'USD']);
      fifo.addBuy(100, { EUR: 5000, USD: 5500 });

      const result = fifo.consumeSell(25);
      expect(result.EUR).toBeCloseTo(1250, 2);
      expect(result.USD).toBeCloseTo(1375, 2);
    });
  });

  describe('remainingCost', () => {
    test('returns total remaining cost after buys', () => {
      const fifo = new FifoTracker(['EUR']);
      fifo.addBuy(10, { EUR: 1000 });
      fifo.addBuy(5, { EUR: 750 });
      expect(fifo.remainingCost('EUR')).toBeCloseTo(1750, 2);
    });

    test('returns remaining cost after partial sell', () => {
      const fifo = new FifoTracker(['EUR']);
      fifo.addBuy(10, { EUR: 1000 }); // 10 @ €100
      fifo.addBuy(10, { EUR: 2000 }); // 10 @ €200
      fifo.consumeSell(5); // sells 5 @ €100 = 500 consumed
      expect(fifo.remainingCost('EUR')).toBeCloseTo(2500, 2); // 5*100 + 10*200
    });

    test('returns 0 after all sold', () => {
      const fifo = new FifoTracker(['EUR']);
      fifo.addBuy(10, { EUR: 1000 });
      fifo.consumeSell(10);
      expect(fifo.remainingCost('EUR')).toBe(0);
    });

    test('returns 0 for unknown currency', () => {
      const fifo = new FifoTracker(['EUR']);
      expect(fifo.remainingCost('GBP')).toBe(0);
    });
  });

  describe('real-world scenario', () => {
    test('buy at rate 1.2647, sell at rate 1.1225', () => {
      // Buy 49 shares at $49.57, commission $29.95, rate 1.2647
      const buyPriceEUR = (49.57 * 49) / 1.2647;
      const buyCommEUR = 29.95 / 1.2647;
      const totalBuyCostEUR = buyPriceEUR + buyCommEUR;

      const fifo = new FifoTracker(['EUR']);
      fifo.addBuy(49, { EUR: totalBuyCostEUR });

      // Sell 49 shares at $78.78, commission $29.95, rate 1.1225
      const sellPriceEUR = (78.78 * 49) / 1.1225;
      const sellCommEUR = 29.95 / 1.1225;
      const proceedsEUR = sellPriceEUR - sellCommEUR;

      const { EUR: costBasis } = fifo.consumeSell(49);
      const gain = proceedsEUR - costBasis;

      // The gain should be positive (sold at higher price)
      expect(gain).toBeGreaterThan(0);
      // Cost basis should equal what we put in
      expect(costBasis).toBeCloseTo(totalBuyCostEUR, 2);
    });

    test('FIFO gives different result than average cost', () => {
      const fifo = new FifoTracker(['EUR']);
      // Buy 10 @ €50
      fifo.addBuy(10, { EUR: 500 });
      // Buy 10 @ €100
      fifo.addBuy(10, { EUR: 1000 });

      // Sell 10 — FIFO uses first lot (€50/share)
      const result = fifo.consumeSell(10);
      expect(result.EUR).toBeCloseTo(500, 2);

      // Average cost would be (500 + 1000) / 20 = 75/share => 10 * 75 = 750
      // FIFO gives 500, which is different
      expect(result.EUR).not.toBeCloseTo(750, 0);
    });
  });
});
