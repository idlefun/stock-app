import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useTickerSearch } from '../lib/useTickerSearch';

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
  const [tickerValid, setTickerValid] = useState(false);
  const [tickerName, setTickerName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [manualTicker, setManualTicker] = useState(false);
  const [holdings, setHoldings] = useState([]);
  const searchEnabled = form.type !== 'sell' && form.type !== 'dividend' && !manualTicker;
  const { searchResults, showDropdown, searching, selectTicker: doSelectTicker, clearSearch } = useTickerSearch(form.ticker, searchEnabled);

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  // Fetch holdings for sell/dividend mode
  useEffect(() => {
    if (form.type === 'sell' || form.type === 'dividend') {
      api.getPortfolio().then(data => {
        setHoldings(data.stocks.filter(s => s.quantityHeld > 0));
      }).catch(() => setHoldings([]));
    }
  }, [form.type]);

  // Validate ticker based on search results
  useEffect(() => {
    if (form.type === 'sell' || form.type === 'dividend') return;
    const q = form.ticker.trim();

    if (manualTicker) {
      setTickerValid(q.length > 0);
      setTickerName(q.length > 0 ? 'Manual entry' : '');
      return;
    }

    if (q.length < 1) {
      setTickerValid(false);
      setTickerName('');
      return;
    }

    if (searchResults.length === 1 && searchResults[0].ticker.toUpperCase() === q.toUpperCase()) {
      setTickerValid(true);
      setTickerName(searchResults[0].name);
    } else if (searchResults.length === 0 && !searching) {
      setTickerValid(false);
      setTickerName('');
    } else {
      setTickerValid(false);
      setTickerName('');
    }
  }, [searchResults, form.ticker, form.type, manualTicker, searching]);

  function selectTicker(result) {
    set('ticker', doSelectTicker(result));
    setTickerValid(true);
    setTickerName(result.name);
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
      let txn;
      if (form.type === 'dividend') {
        txn = {
          type: form.type,
          ticker: form.ticker,
          date: form.date,
          amount: Number(form.amount),
          amountCurrency: form.amountCurrency || 'USD',
          taxPaid: Number(form.taxPaid) || 0,
          exchangeRate: form.exchangeRate ? Number(form.exchangeRate) : undefined,
        };
      } else {
        txn = {
          ...form,
          quantity: Number(form.quantity),
          pricePerShare: Number(form.pricePerShare),
          commission: Number(form.commission) || 0,
          taxPaid: form.type === 'sell' ? (Number(form.taxPaid) || 0) : undefined,
          exchangeRate: form.exchangeRate ? Number(form.exchangeRate) : undefined,
        };
        if (!manualTicker || !form.companyName?.trim()) {
          delete txn.companyName;
        }
      }
      await api.createTransaction(txn);
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
        <label className="narrow">
          Type
          <select value={form.type} onChange={e => {
            const newType = e.target.value;
            set('type', newType);
            if (newType === 'sell' || newType === 'dividend') {
              set('ticker', '');
              setTickerValid(false);
              setTickerName('');
              setManualTicker(false);
              clearSearch();
            }
          }}>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
            <option value="dividend">Dividend</option>
          </select>
        </label>

        {(form.type === 'sell' || form.type === 'dividend') ? (
          <label>
            Ticker
            <select
              value={form.ticker}
              onChange={e => {
                const ticker = e.target.value;
                set('ticker', ticker);
                const held = holdings.find(h => h.ticker === ticker);
                if (held) {
                  setTickerValid(true);
                  setTickerName(`${held.name} (${held.quantityHeld} held)`);
                } else {
                  setTickerValid(false);
                  setTickerName('');
                }
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
              <label className="manual-ticker-toggle">
                <input
                  type="checkbox"
                  checked={manualTicker}
                  onChange={e => {
                    setManualTicker(e.target.checked);
                    setTickerValid(false);
                    setTickerName('');
                    clearSearch();
                  }}
                />
                Historical
              </label>
            </div>
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
          </label>
        )}

        {form.type === 'buy' && manualTicker && (
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

      {form.type === 'dividend' ? (
        <div className="form-row">
          <label className="input-pair">
            Amount
            <div className="pair-row">
              <input type="number" step="0.01" min="0" value={form.amount || ''} onChange={e => set('amount', e.target.value)} required />
              <select value={form.amountCurrency || 'USD'} onChange={e => set('amountCurrency', e.target.value)}>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
          </label>
          <label>
            Tax Paid (EUR)
            <input type="number" step="0.01" min="0" value={form.taxPaid || ''} onChange={e => set('taxPaid', e.target.value)} placeholder="0.00" />
          </label>
          {(form.amountCurrency || 'USD') === 'USD' && (
            <label>
              EUR/USD Rate
              <input type="number" step="0.0000001" min="0" value={form.exchangeRate || ''} onChange={e => set('exchangeRate', e.target.value)} placeholder="e.g. 1.0870" />
            </label>
          )}
          <label className="submit-label">
            &nbsp;
            <button type="submit" disabled={submitting || !tickerValid}>
              {submitting ? 'Saving...' : 'Add Dividend'}
            </button>
          </label>
        </div>
      ) : (
        <div className="form-row">
          <label>
            Quantity
            <input type="number" step="1" min="1"
              max={form.type === 'sell' ? (holdings.find(h => h.ticker === form.ticker)?.quantityHeld || '') : ''}
              value={form.quantity} onChange={e => set('quantity', e.target.value)} required />
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
              <input type="number" step="0.01" min="0" value={form.taxPaid || ''} onChange={e => set('taxPaid', e.target.value)} placeholder="0.00" />
            </label>
          )}
          {(form.priceCurrency === 'USD' || form.commissionCurrency === 'USD') && (
            <label>
              EUR/USD Rate
              <input type="number" step="0.0000001" min="0" value={form.exchangeRate || ''} onChange={e => set('exchangeRate', e.target.value)} placeholder="1.0870" />
            </label>
          )}
          <label className="submit-label">
            &nbsp;
            <button type="submit" disabled={submitting || !tickerValid}>
              {submitting ? 'Saving...' : form.type === 'sell' ? 'Sell' : 'Buy'}
            </button>
          </label>
        </div>
      )}
    </form>
  );
}
