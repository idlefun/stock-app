const express = require('express');
const crypto = require('crypto');
const { readOrDefault, writeJSON, withLock } = require('../lib/storage');
const { fetchHistoricalRate } = require('./exchangeRate');
const { getSplits, splitMultiplier, loadCache: loadSplitsCache } = require('./splits');

const router = express.Router();
const FILENAME = 'transactions.json';

async function getTransactions() {
  return readOrDefault(FILENAME, []);
}

async function saveTransactions(transactions) {
  return writeJSON(FILENAME, transactions);
}

function getHeldQuantity(transactions, ticker, splits = []) {
  return transactions
    .filter(t => t.ticker === ticker && t.type !== 'dividend')
    .reduce((sum, t) => {
      const mult = splitMultiplier(splits, t.date);
      const adjQty = t.quantity * mult;
      return t.type === 'buy' ? sum + adjQty : sum - adjQty;
    }, 0);
}

// GET /api/transactions
router.get('/', async (req, res) => {
  try {
    let transactions = await getTransactions();
    if (req.query.ticker) {
      transactions = transactions.filter(t => t.ticker === req.query.ticker);
    }
    transactions.sort((a, b) => {
      const dateDiff = new Date(b.date) - new Date(a.date);
      if (dateDiff !== 0) return dateDiff;
      return a.ticker.localeCompare(b.ticker);
    });
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/transactions
router.post('/', async (req, res) => {
  await withLock(FILENAME, async () => { try {
    const { type, ticker, quantity, pricePerShare, priceCurrency, commission, commissionCurrency, date, companyName, exchangeRate: userRate, dividendAmount, dividendCurrency, taxPaid } = req.body;

    if (!type || !ticker || !date) {
      return res.status(400).json({ error: 'Missing required fields: type, ticker, date' });
    }
    if (!['buy', 'sell', 'dividend'].includes(type)) {
      return res.status(400).json({ error: 'Type must be "buy", "sell", or "dividend"' });
    }

    if (type === 'dividend') {
      if (!dividendAmount || !dividendCurrency) {
        return res.status(400).json({ error: 'Missing required fields for dividend: dividendAmount, dividendCurrency' });
      }
      if (!['USD', 'EUR'].includes(dividendCurrency)) {
        return res.status(400).json({ error: 'dividendCurrency must be "USD" or "EUR"' });
      }
      if (Number(dividendAmount) <= 0) {
        return res.status(400).json({ error: 'Amount must be positive' });
      }
    } else {
      if (!quantity || pricePerShare == null || pricePerShare === '' || !priceCurrency) {
        return res.status(400).json({ error: 'Missing required fields: quantity, pricePerShare, priceCurrency' });
      }
      if (!['USD', 'EUR'].includes(priceCurrency)) {
        return res.status(400).json({ error: 'priceCurrency must be "USD" or "EUR"' });
      }
      if (commissionCurrency && !['USD', 'EUR'].includes(commissionCurrency)) {
        return res.status(400).json({ error: 'commissionCurrency must be "USD" or "EUR"' });
      }
      if (quantity <= 0) {
        return res.status(400).json({ error: 'Quantity must be positive' });
      }
    }

    const transactions = await getTransactions();

    // Sell validation (split-adjusted)
    if (type === 'sell') {
      await loadSplitsCache();
      let splits = [];
      try { splits = await getSplits(ticker); } catch { /* no splits */ }
      const held = getHeldQuantity(transactions, ticker, splits);
      if (quantity > held) {
        return res.status(400).json({
          error: `Cannot sell ${quantity} shares of ${ticker}. Only ${held} shares held.`
        });
      }
    }

    // Fetch historical EUR/USD rate for USD transactions
    let exchangeRate = null;
    const currencyForRate = type === 'dividend' ? dividendCurrency : priceCurrency;
    const commCurrForRate = type === 'dividend' ? null : commissionCurrency;
    const hasCurrencyUSD = currencyForRate === 'USD' || (commCurrForRate && commCurrForRate === 'USD');
    if (hasCurrencyUSD) {
      if (userRate != null && userRate !== '') {
        exchangeRate = Number(userRate);
      } else {
        try {
          exchangeRate = await fetchHistoricalRate(date);
        } catch { /* rate unavailable */ }
      }
    }

    const transaction = {
      id: crypto.randomUUID(),
      type,
      ticker: ticker.toUpperCase(),
      companyName: companyName?.trim() || undefined,
      date,
      exchangeRate,
      createdAt: new Date().toISOString()
    };

    if (type === 'dividend') {
      transaction.dividendAmount = Number(dividendAmount);
      transaction.dividendCurrency = dividendCurrency;
      transaction.taxPaid = Number(taxPaid) || 0;
    } else {
      transaction.quantity = Number(quantity);
      transaction.pricePerShare = Number(pricePerShare);
      transaction.priceCurrency = priceCurrency;
      transaction.commission = Number(commission) || 0;
      transaction.commissionCurrency = commissionCurrency || priceCurrency;
      if (type === 'sell') transaction.taxPaid = Number(taxPaid) || 0;
    }

    transactions.push(transaction);
    await saveTransactions(transactions);
    res.status(201).json(transaction);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } });
});

// PUT /api/transactions/:id
router.put('/:id', async (req, res) => {
  await withLock(FILENAME, async () => { try {
    const transactions = await getTransactions();
    const index = transactions.findIndex(t => t.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const { type, ticker, quantity, pricePerShare, priceCurrency, commission, commissionCurrency, date, exchangeRate, companyName, dividendAmount, dividendCurrency, taxPaid } = req.body;

    if (type && !['buy', 'sell', 'dividend'].includes(type)) {
      return res.status(400).json({ error: 'Type must be "buy", "sell", or "dividend"' });
    }
    if (priceCurrency && !['USD', 'EUR'].includes(priceCurrency)) {
      return res.status(400).json({ error: 'priceCurrency must be "USD" or "EUR"' });
    }
    if (commissionCurrency && !['USD', 'EUR'].includes(commissionCurrency)) {
      return res.status(400).json({ error: 'commissionCurrency must be "USD" or "EUR"' });
    }
    if (quantity !== undefined && quantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be positive' });
    }

    const updated = { ...transactions[index] };
    if (type !== undefined) updated.type = type;
    if (ticker !== undefined) updated.ticker = ticker.toUpperCase();
    if (quantity !== undefined) updated.quantity = Number(quantity);
    if (pricePerShare !== undefined) updated.pricePerShare = Number(pricePerShare);
    if (priceCurrency !== undefined) updated.priceCurrency = priceCurrency;
    if (commission !== undefined) updated.commission = Number(commission);
    if (commissionCurrency !== undefined) updated.commissionCurrency = commissionCurrency;
    if (date !== undefined) updated.date = date;
    if (exchangeRate !== undefined) updated.exchangeRate = exchangeRate !== null ? Number(exchangeRate) : null;
    if (companyName !== undefined) updated.companyName = companyName?.trim() || undefined;
    if (dividendAmount !== undefined) updated.dividendAmount = Number(dividendAmount);
    if (dividendCurrency !== undefined) updated.dividendCurrency = dividendCurrency;
    if (taxPaid !== undefined) updated.taxPaid = Number(taxPaid) || 0;

    // Sell validation for updated transaction (split-adjusted)
    if (updated.type === 'sell') {
      await loadSplitsCache();
      let splits = [];
      try { splits = await getSplits(updated.ticker); } catch { /* no splits */ }
      const otherTxns = transactions.filter((_, i) => i !== index);
      const held = getHeldQuantity(otherTxns, updated.ticker, splits);
      if (updated.quantity > held) {
        return res.status(400).json({
          error: `Cannot sell ${updated.quantity} shares of ${updated.ticker}. Only ${held} shares held.`
        });
      }
    }

    transactions[index] = updated;
    await saveTransactions(transactions);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } });
});

// POST /api/transactions/import
router.post('/import', async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No rows to import' });
  }
  if (rows.length > 1000) {
    return res.status(400).json({ error: 'Maximum 1000 rows per import' });
  }
  await withLock(FILENAME, async () => { try {

    const transactions = await getTransactions();
    const imported = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const { type, ticker, date } = row;
        if (!type || !ticker || !date) {
          errors.push({ row: i + 1, error: 'Missing type, ticker, or date' });
          continue;
        }
        if (!['buy', 'sell', 'dividend'].includes(type)) {
          errors.push({ row: i + 1, error: `Invalid type: ${type}` });
          continue;
        }

        const txn = {
          id: crypto.randomUUID(),
          type,
          ticker: ticker.toUpperCase(),
          date,
          createdAt: new Date().toISOString(),
        };

        if (type === 'dividend') {
          if (!row.dividendAmount || !row.dividendCurrency) {
            errors.push({ row: i + 1, error: 'Dividend missing dividendAmount or dividendCurrency' });
            continue;
          }
          txn.dividendAmount = Number(row.dividendAmount);
          txn.dividendCurrency = row.dividendCurrency;
          txn.taxPaid = Number(row.taxPaid) || 0;
        } else {
          if (!row.quantity || (row.pricePerShare == null || row.pricePerShare === '') || !row.priceCurrency) {
            errors.push({ row: i + 1, error: 'Missing quantity, pricePerShare, or priceCurrency' });
            continue;
          }
          txn.quantity = Number(row.quantity);
          txn.pricePerShare = Number(row.pricePerShare);
          txn.priceCurrency = row.priceCurrency;
          txn.commission = Number(row.commission) || 0;
          txn.commissionCurrency = row.commissionCurrency || row.priceCurrency;
          if (type === 'sell') txn.taxPaid = Number(row.taxPaid) || 0;
        }

        if (row.exchangeRate) txn.exchangeRate = Number(row.exchangeRate);
        if (row.companyName) txn.companyName = row.companyName.trim();

        transactions.push(txn);
        imported.push(txn);
      } catch (err) {
        errors.push({ row: i + 1, error: err.message });
      }
    }

    if (imported.length > 0) {
      await saveTransactions(transactions);
    }

    res.json({ imported: imported.length, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } });
});

// DELETE /api/transactions/bulk
router.delete('/bulk', async (req, res) => {
  await withLock(FILENAME, async () => { try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'No ids provided' });
    }
    const transactions = await getTransactions();
    const idSet = new Set(ids);
    const remaining = transactions.filter(t => !idSet.has(t.id));
    const deleted = transactions.length - remaining.length;
    await saveTransactions(remaining);
    res.json({ deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } });
});

// DELETE /api/transactions/:id
router.delete('/:id', async (req, res) => {
  await withLock(FILENAME, async () => { try {
    const transactions = await getTransactions();
    const index = transactions.findIndex(t => t.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    const removed = transactions.splice(index, 1)[0];
    await saveTransactions(transactions);
    res.json(removed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } });
});

module.exports = router;
module.exports.getTransactions = getTransactions;
module.exports.getHeldQuantity = getHeldQuantity;
