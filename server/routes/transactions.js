const express = require('express');
const crypto = require('crypto');
const { readOrDefault, writeJSON } = require('../lib/storage');
const { fetchHistoricalRate } = require('./exchangeRate');

const router = express.Router();
const FILENAME = 'transactions.json';

async function getTransactions() {
  return readOrDefault(FILENAME, []);
}

async function saveTransactions(transactions) {
  return writeJSON(FILENAME, transactions);
}

function getHeldQuantity(transactions, ticker) {
  return transactions
    .filter(t => t.ticker === ticker && t.type !== 'dividend')
    .reduce((sum, t) => {
      return t.type === 'buy' ? sum + t.quantity : sum - t.quantity;
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
  try {
    const { type, ticker, quantity, pricePerShare, priceCurrency, commission, commissionCurrency, date, companyName, exchangeRate: userRate, amount, amountCurrency } = req.body;

    if (!type || !ticker || !date) {
      return res.status(400).json({ error: 'Missing required fields: type, ticker, date' });
    }
    if (!['buy', 'sell', 'dividend'].includes(type)) {
      return res.status(400).json({ error: 'Type must be "buy", "sell", or "dividend"' });
    }

    if (type === 'dividend') {
      if (!amount || !amountCurrency) {
        return res.status(400).json({ error: 'Missing required fields for dividend: amount, amountCurrency' });
      }
      if (!['USD', 'EUR'].includes(amountCurrency)) {
        return res.status(400).json({ error: 'amountCurrency must be "USD" or "EUR"' });
      }
      if (Number(amount) <= 0) {
        return res.status(400).json({ error: 'Amount must be positive' });
      }
    } else {
      if (!quantity || !pricePerShare || !priceCurrency) {
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

    // Sell validation
    if (type === 'sell') {
      const held = getHeldQuantity(transactions, ticker);
      if (quantity > held) {
        return res.status(400).json({
          error: `Cannot sell ${quantity} shares of ${ticker}. Only ${held} shares held.`
        });
      }
    }

    // Fetch historical EUR/USD rate for USD transactions
    let exchangeRate = null;
    const currencyForRate = type === 'dividend' ? amountCurrency : priceCurrency;
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
      transaction.amount = Number(amount);
      transaction.amountCurrency = amountCurrency;
    } else {
      transaction.quantity = Number(quantity);
      transaction.pricePerShare = Number(pricePerShare);
      transaction.priceCurrency = priceCurrency;
      transaction.commission = Number(commission) || 0;
      transaction.commissionCurrency = commissionCurrency || priceCurrency;
    }

    transactions.push(transaction);
    await saveTransactions(transactions);
    res.status(201).json(transaction);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/transactions/:id
router.put('/:id', async (req, res) => {
  try {
    const transactions = await getTransactions();
    const index = transactions.findIndex(t => t.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const { type, ticker, quantity, pricePerShare, priceCurrency, commission, commissionCurrency, date, exchangeRate, companyName } = req.body;

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

    // Sell validation for updated transaction
    if (updated.type === 'sell') {
      const otherTxns = transactions.filter((_, i) => i !== index);
      const held = getHeldQuantity(otherTxns, updated.ticker);
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
  }
});

// DELETE /api/transactions/:id
router.delete('/:id', async (req, res) => {
  try {
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
  }
});

module.exports = router;
module.exports.getTransactions = getTransactions;
module.exports.getHeldQuantity = getHeldQuantity;
