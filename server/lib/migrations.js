const { readJSON, writeJSON } = require('./storage');

async function runMigrations() {
  const txns = await readJSON('transactions.json');
  if (!txns || !Array.isArray(txns)) return;

  let changed = false;
  changed = migrateDividendFields(txns) || changed;
  changed = await migrateAssetType(txns) || changed;

  if (changed) {
    await writeJSON('transactions.json', txns);
  }
}

// Rename amount -> dividendAmount, amountCurrency -> dividendCurrency
function migrateDividendFields(txns) {
  let changed = false;
  for (const t of txns) {
    if (t.type === 'dividend') {
      if ('amount' in t && !('dividendAmount' in t)) {
        t.dividendAmount = t.amount;
        delete t.amount;
        changed = true;
      }
      if ('amountCurrency' in t && !('dividendCurrency' in t)) {
        t.dividendCurrency = t.amountCurrency;
        delete t.amountCurrency;
        changed = true;
      }
    }
  }
  if (changed) console.log('Migration: renamed dividend amount/amountCurrency -> dividendAmount/dividendCurrency');
  return changed;
}

// Add assetType to transactions missing it, using Yahoo Finance lookup
async function migrateAssetType(txns) {
  const tickersMissing = new Set();
  for (const t of txns) {
    if (!t.assetType) tickersMissing.add(t.ticker);
  }
  if (tickersMissing.size === 0) return false;

  // Look up each ticker via Yahoo Finance
  const YahooFinance = require('yahoo-finance2').default;
  const yahooFinance = new YahooFinance({ validation: { logErrors: false } });
  const typeMap = {};

  for (const ticker of tickersMissing) {
    try {
      const result = await yahooFinance.search(ticker);
      const match = (result.quotes || []).find(q => q.symbol === ticker);
      if (match) {
        typeMap[ticker] = match.quoteType === 'ETF' ? 'etf' : 'stock';
      } else {
        typeMap[ticker] = 'stock';
      }
    } catch {
      typeMap[ticker] = 'stock';
    }
  }

  let changed = false;
  for (const t of txns) {
    if (!t.assetType && typeMap[t.ticker]) {
      t.assetType = typeMap[t.ticker];
      changed = true;
    }
  }
  if (changed) console.log('Migration: added assetType to transactions:', Object.entries(typeMap).map(([k, v]) => `${k}=${v}`).join(', '));
  return changed;
}

module.exports = { runMigrations };
