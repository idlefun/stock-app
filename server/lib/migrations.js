const { readJSON, writeJSON } = require('./storage');

async function runMigrations() {
  await migrateDividendFields();
}

// Rename amount -> dividendAmount, amountCurrency -> dividendCurrency
async function migrateDividendFields() {
  const txns = await readJSON('transactions.json');
  if (!txns || !Array.isArray(txns)) return;

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

  if (changed) {
    await writeJSON('transactions.json', txns);
    console.log('Migration: renamed dividend amount/amountCurrency -> dividendAmount/dividendCurrency');
  }
}

module.exports = { runMigrations };
