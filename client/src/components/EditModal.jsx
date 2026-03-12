import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useTickerSearch } from '../lib/useTickerSearch';

export default function EditModal({ transaction, onSave, onCancel }) {
  const isDividend = transaction.type === 'dividend';
  const [form, setForm] = useState({
    type: transaction.type,
    ticker: transaction.ticker,
    date: transaction.date,
    quantity: transaction.quantity ?? '',
    pricePerShare: transaction.pricePerShare ?? '',
    priceCurrency: transaction.priceCurrency || 'USD',
    commission: transaction.commission ?? '',
    commissionCurrency: transaction.commissionCurrency || 'USD',
    exchangeRate: transaction.exchangeRate ?? '',
    amount: transaction.amount ?? '',
    amountCurrency: transaction.amountCurrency || 'USD',
    taxPaid: transaction.taxPaid ?? '',
    companyName: transaction.companyName || '',
  });
  const [tickerValid, setTickerValid] = useState(true);
  const [tickerName, setTickerName] = useState(transaction.companyName || transaction.ticker);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [holdings, setHoldings] = useState([]);

  const searchEnabled = form.type !== 'sell' && form.type !== 'dividend';
  const { searchResults, showDropdown, searching, selectTicker: doSelectTicker } = useTickerSearch(form.ticker, searchEnabled);

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  useEffect(() => {
    if (form.type === 'sell' || form.type === 'dividend') {
      api.getPortfolio().then(data => {
        const held = data.stocks.filter(s => s.quantityHeld > 0);
        // Ensure the transaction's ticker is in the list even if holdings are zero
        if (!held.find(s => s.ticker === transaction.ticker)) {
          const orig = data.stocks.find(s => s.ticker === transaction.ticker);
          if (orig) held.push(orig);
          else held.push({ ticker: transaction.ticker, name: transaction.companyName || transaction.ticker, quantityHeld: 0 });
        }
        setHoldings(held);
      }).catch(() => setHoldings([]));
    }
  }, [form.type]);

  useEffect(() => {
    if (form.type === 'sell' || form.type === 'dividend') return;
    const q = form.ticker.trim();
    if (q.length < 1) { setTickerValid(false); setTickerName(''); return; }
    if (searchResults.length === 1 && searchResults[0].ticker.toUpperCase() === q.toUpperCase()) {
      setTickerValid(true);
      setTickerName(searchResults[0].name);
    }
  }, [searchResults, form.ticker, form.type]);

  function selectTicker(result) {
    set('ticker', doSelectTicker(result));
    setTickerValid(true);
    setTickerName(result.name);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (isDividend) {
        await api.updateTransaction(transaction.id, {
          type: form.type,
          ticker: form.ticker,
          date: form.date,
          amount: Number(form.amount),
          amountCurrency: form.amountCurrency,
          taxPaid: Number(form.taxPaid) || 0,
          exchangeRate: form.exchangeRate !== '' ? Number(form.exchangeRate) : null,
        });
      } else {
        await api.updateTransaction(transaction.id, {
          ...form,
          quantity: Number(form.quantity),
          pricePerShare: Number(form.pricePerShare),
          commission: Number(form.commission) || 0,
          taxPaid: form.type === 'sell' ? (Number(form.taxPaid) || 0) : undefined,
          exchangeRate: form.exchangeRate !== '' ? Number(form.exchangeRate) : null,
        });
      }
      onSave();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onCancel();
  }

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <form className="transaction-form modal-form" onSubmit={handleSubmit}>
        <h3>Edit Transaction</h3>
        {error && <div className="form-error">{error}</div>}

        <div className="form-row">
          <label className="narrow">
            Type
            <select value={form.type} disabled>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
              <option value="dividend">Dividend</option>
            </select>
          </label>

          {(form.type === 'sell' || form.type === 'dividend') ? (
            <label className="ticker-field">
              Ticker
              <select
                value={form.ticker}
                onChange={e => {
                  const ticker = e.target.value;
                  set('ticker', ticker);
                  const held = holdings.find(h => h.ticker === ticker);
                  if (held) { setTickerValid(true); setTickerName(`${held.name} (${held.quantityHeld} held)`); }
                  else { setTickerValid(false); setTickerName(''); }
                }}
                required
              >
                <option value="">Select stock...</option>
                {[...holdings].sort((a, b) => a.ticker.localeCompare(b.ticker)).map(h => (
                  <option key={h.ticker} value={h.ticker}>
                    {h.ticker} — {h.name} ({h.quantityHeld} shares)
                  </option>
                ))}
              </select>
              {tickerValid && <span className="ticker-status valid">{tickerName}</span>}
            </label>
          ) : (
            <label className="ticker-field">
              Ticker
              <div className="ticker-input-row">
                <input
                  type="text"
                  value={form.ticker}
                  onChange={e => set('ticker', e.target.value.toUpperCase())}
                  placeholder="e.g. AAPL"
                  required
                />
              </div>
              {searching && <span className="ticker-status">Searching...</span>}
              {tickerValid && <span className="ticker-status valid">{tickerName}</span>}
              {showDropdown && searchResults.length > 0 && (
                <ul className="ticker-dropdown">
                  {searchResults.map(r => (
                    <li key={r.ticker} onClick={() => selectTicker(r)}>
                      <strong>{r.ticker}</strong> — {r.name} <span className="exchange">({r.exchange})</span>
                    </li>
                  ))}
                </ul>
              )}
            </label>
          )}

          <label className="narrow-date">
            Date
            <input type="date" value={form.date} onChange={e => set('date', e.target.value)} required />
          </label>
        </div>

        {form.type === 'dividend' ? (
          <div className="form-row">
            <label className="input-pair">
              Amount
              <div className="pair-row">
                <input type="number" step="0.01" min="0" value={form.amount} onChange={e => set('amount', e.target.value)} required />
                <select value={form.amountCurrency || 'USD'} onChange={e => set('amountCurrency', e.target.value)}>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
            </label>
            {(form.amountCurrency || 'USD') === 'USD' && (
              <label>
                EUR/USD Rate
                <input type="number" step="0.0000001" min="0" value={form.exchangeRate} onChange={e => set('exchangeRate', e.target.value)} placeholder="e.g. 1.0870" />
              </label>
            )}
            <label>
              Tax Paid (EUR)
              <input type="number" step="0.01" min="0" value={form.taxPaid} onChange={e => set('taxPaid', e.target.value)} placeholder="0.00" />
            </label>
          </div>
        ) : (
          <div className="form-row">
            <label>
              Quantity
              <input type="number" step="1" min="1" value={form.quantity} onChange={e => set('quantity', e.target.value)} required />
            </label>
            <label className="input-pair">
              Price
              <div className="pair-row">
                <input type="number" step="0.01" min="0" value={form.pricePerShare} onChange={e => set('pricePerShare', e.target.value)} required />
                <select value={form.priceCurrency} onChange={e => set('priceCurrency', e.target.value)}>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
            </label>
            <label className="input-pair">
              Commission
              <div className="pair-row">
                <input type="number" step="0.01" min="0" value={form.commission} onChange={e => set('commission', e.target.value)} />
                <select value={form.commissionCurrency} onChange={e => set('commissionCurrency', e.target.value)}>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
            </label>
            {form.type === 'sell' && (
              <label>
                Tax (EUR)
                <input type="number" step="0.01" min="0" value={form.taxPaid} onChange={e => set('taxPaid', e.target.value)} placeholder="0.00" />
              </label>
            )}
            {(form.priceCurrency === 'USD' || form.commissionCurrency === 'USD') && (
              <label>
                EUR/USD Rate
                <input type="number" step="0.0000001" min="0" value={form.exchangeRate} onChange={e => set('exchangeRate', e.target.value)} placeholder="1.0870" />
              </label>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button type="submit" disabled={saving || !tickerValid}>
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button type="button" className="btn-cancel" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
