// FIFO buy-lot tracker supporting one or more currencies.
// Each currency maintains an independent queue of { adjQty, costPerShare } lots.
class FifoTracker {
  constructor(currencies = ['EUR']) {
    this.lots = {};
    for (const c of currencies) this.lots[c] = [];
  }

  addBuy(adjQty, costs) {
    // costs: { EUR: totalCost, USD: totalCost, ... }
    for (const [cur, cost] of Object.entries(costs)) {
      if (this.lots[cur]) {
        this.lots[cur].push({ adjQty, costPerShare: cost / adjQty });
      }
    }
  }

  consumeSell(adjQty) {
    // Returns { EUR: costBasis, USD: costBasis, ... }
    const result = {};
    for (const cur of Object.keys(this.lots)) {
      let remaining = adjQty;
      let costBasis = 0;
      while (remaining > 0 && this.lots[cur].length > 0) {
        const lot = this.lots[cur][0];
        const used = Math.min(remaining, lot.adjQty);
        costBasis += used * lot.costPerShare;
        lot.adjQty -= used;
        remaining -= used;
        if (lot.adjQty <= 0) this.lots[cur].shift();
      }
      result[cur] = costBasis;
    }
    return result;
  }

  remainingCost(currency) {
    return (this.lots[currency] || []).reduce((s, lot) => s + lot.adjQty * lot.costPerShare, 0);
  }
}

module.exports = { FifoTracker };
