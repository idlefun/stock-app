import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';

const INITIAL = {
  type: 'buy',
  ticker: '',
  date: new Date().toISOString().split('T')[0],
  pricePerShare: '',
  priceCurrency: 'USD',
  quantity: '',
  commission: '',
  commissionCurrency: 'USD',
};

export default function TransactionForm({ onSubmit }) {
  const [form, setForm] = useState(INITIAL);
  const [searchResults, setSearchResults] = useState([]);
  const [tickerValid, setTickerValid] = useState(false);
  const [tickerName, setTickerName] = useState('');
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [manualTicker, setManualTicker] = useState(false);
  const debounceRef = useRef(null);

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = form.ticker.trim();

    if (manualTicker) {
      setSearchResults([]);
      setShowDropdown(false);
      setTickerValid(q.length > 0);
      setTickerName(q.length > 0 ? 'Manual entry' : '');
      return;
    }

    if (q.length < 1) {
      setSearchResults([]);
      setTickerValid(false);
      setTickerName('');
      setShowDropdown(false);
      return;
    }

    setTickerValid(false);
    setTickerName('');
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await api.searchTicker(q);
        setSearchResults(results);
        if (results.length === 1 && results[0].ticker.toUpperCase() === q.toUpperCase()) {
          setTickerValid(true);
          setTickerName(results[0].name);
          setShowDropdown(false);
        } else if (results.length > 0) {
          setShowDropdown(true);
        } else {
          setShowDropdown(false);
          setError(`No stocks found for "${q}"`);
        }
      } catch {
        setSearchResults([]);
      }
      setSearching(false);
    }, 400);
  }, [form.ticker, manualTicker]);

  function selectTicker(result) {
    set('ticker', result.ticker);
    setTickerValid(true);
    setTickerName(result.name);
    setShowDropdown(false);
    setSearchResults([]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!tickerValid) {
      setError('Please select a valid ticker');
      return;
    }

    setSubmitting(true);
    try {
      const txn = {
        ...form,
        quantity: Number(form.quantity),
        pricePerShare: Number(form.pricePerShare),
        commission: Number(form.commission) || 0,
        exchangeRate: form.exchangeRate ? Number(form.exchangeRate) : undefined,
      };
      if (!manualTicker || !form.companyName?.trim()) {
        delete txn.companyName;
      }
      await api.createTransaction(txn);
      setForm(INITIAL);
      setTickerValid(false);
      setTickerName('');
      setManualTicker(false);
      if (onSubmit) onSubmit();
    } catch (err) {
      setError(err.message);
    }
    setSubmitting(false);
  }

  return (
    <form className="transaction-form" onSubmit={handleSubmit}>
      <h3>Add Transaction</h3>
      {error && <div className="form-error">{error}</div>}

      <div className="form-row">
        <label>
          Type
          <select value={form.type} onChange={e => set('type', e.target.value)}>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </label>

        <label className="ticker-field">
          Ticker
          <input
            type="text"
            value={form.ticker}
            onChange={e => set('ticker', e.target.value.toUpperCase())}
            placeholder="e.g. AAPL"
            required
          />
          {!manualTicker && searching && <span className="ticker-status">Searching...</span>}
          {tickerValid && <span className="ticker-status valid">{tickerName}</span>}
          {!manualTicker && showDropdown && searchResults.length > 0 && (
            <ul className="ticker-dropdown">
              {searchResults.map(r => (
                <li key={r.ticker} onClick={() => selectTicker(r)}>
                  <strong>{r.ticker}</strong> — {r.name} <span className="exchange">({r.exchange})</span>
                </li>
              ))}
            </ul>
          )}
          <label className="manual-ticker-toggle">
            <input
              type="checkbox"
              checked={manualTicker}
              onChange={e => {
                setManualTicker(e.target.checked);
                setTickerValid(false);
                setTickerName('');
                setShowDropdown(false);
                setSearchResults([]);
              }}
            />
            Historical / delisted
          </label>
        </label>

        {manualTicker && (
          <label>
            Company Name
            <input
              type="text"
              value={form.companyName || ''}
              onChange={e => set('companyName', e.target.value)}
              placeholder="e.g. Altera Corporation"
            />
          </label>
        )}

        <label>
          Date
          <input type="date" value={form.date} onChange={e => set('date', e.target.value)} required />
        </label>
      </div>

      <div className="form-row">
        <label>
          Price per Share
          <input type="number" step="0.01" min="0" value={form.pricePerShare} onChange={e => set('pricePerShare', e.target.value)} required />
        </label>
        <label>
          Price Currency
          <select value={form.priceCurrency} onChange={e => set('priceCurrency', e.target.value)}>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </label>
        <label>
          Quantity
          <input type="number" step="1" min="1" value={form.quantity} onChange={e => set('quantity', e.target.value)} required />
        </label>
      </div>

      <div className="form-row">
        <label>
          Commission
          <input type="number" step="0.01" min="0" value={form.commission} onChange={e => set('commission', e.target.value)} />
        </label>
        <label>
          Commission Currency
          <select value={form.commissionCurrency} onChange={e => set('commissionCurrency', e.target.value)}>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </label>
        {(form.priceCurrency === 'USD' || form.commissionCurrency === 'USD') && (
          <label>
            EUR/USD Rate
            <input type="number" step="0.0000001" min="0" value={form.exchangeRate || ''} onChange={e => set('exchangeRate', e.target.value)} placeholder="e.g. 1.0870" />
          </label>
        )}
        <label className="submit-label">
          &nbsp;
          <button type="submit" disabled={submitting || !tickerValid}>
            {submitting ? 'Saving...' : 'Add Transaction'}
          </button>
        </label>
      </div>
    </form>
  );
}
