import { useState, useEffect, useRef } from 'react';
import { formatUSD, formatEUR, formatDate } from '../lib/format';
import { api } from '../lib/api';

function hasUSD(t) {
  if (t.type === 'dividend') return t.amountCurrency === 'USD';
  return t.priceCurrency === 'USD' || t.commissionCurrency === 'USD';
}

function EditRow({ transaction, onSave, onCancel }) {
  const isDividend = transaction.type === 'dividend';
  const [form, setForm] = useState({
    type: transaction.type,
    ticker: transaction.ticker,
    date: transaction.date,
    quantity: transaction.quantity,
    pricePerShare: transaction.pricePerShare,
    priceCurrency: transaction.priceCurrency,
    commission: transaction.commission,
    commissionCurrency: transaction.commissionCurrency,
    exchangeRate: transaction.exchangeRate ?? '',
    amount: transaction.amount,
    amountCurrency: transaction.amountCurrency,
    taxPaid: transaction.taxPaid ?? '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  useEffect(() => {
    if (isDividend) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = form.ticker.trim();
    if (q.length < 1) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await api.searchTicker(q);
        setSearchResults(results);
        setShowDropdown(results.length > 0);
      } catch {
        setSearchResults([]);
      }
      setSearching(false);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [form.ticker]);

  function selectTicker(result) {
    set('ticker', result.ticker);
    setShowDropdown(false);
    setSearchResults([]);
  }

  async function handleSave() {
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
          exchangeRate: form.exchangeRate !== '' ? Number(form.exchangeRate) : null,
        });
      }
      onSave();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  }

  const showRate = isDividend
    ? (form.amountCurrency || 'USD') === 'USD'
    : (form.priceCurrency === 'USD' || form.commissionCurrency === 'USD');

  return (
    <>
      <tr className="edit-row">
        <td></td>
        <td><input type="date" value={form.date} onChange={e => set('date', e.target.value)} /></td>
        <td>
          <select value={form.type} onChange={e => set('type', e.target.value)} disabled>
            <option value="buy">BUY</option>
            <option value="sell">SELL</option>
            <option value="dividend">DIV</option>
          </select>
        </td>
        <td className="ticker-field" style={{ position: 'relative' }}>
          <input type="text" value={form.ticker} onChange={e => set('ticker', e.target.value.toUpperCase())} size="6" />
          {!isDividend && searching && <span className="ticker-status" style={{ fontSize: '0.7rem' }}>...</span>}
          {!isDividend && showDropdown && searchResults.length > 0 && (
            <ul className="ticker-dropdown">
              {searchResults.map(r => (
                <li key={r.ticker} onClick={() => selectTicker(r)}>
                  <strong>{r.ticker}</strong> — {r.name} <span className="exchange">({r.exchange})</span>
                </li>
              ))}
            </ul>
          )}
        </td>
        {isDividend ? (
          <>
            <td>—</td>
            <td>
              <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)} min="0" step="0.01" size="8" />
              <select value={form.amountCurrency || 'USD'} onChange={e => set('amountCurrency', e.target.value)}>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </td>
            <td>
              <input type="number" value={form.taxPaid} onChange={e => set('taxPaid', e.target.value)} min="0" step="0.01" size="6" placeholder="Tax EUR" />
            </td>
          </>
        ) : (
          <>
            <td><input type="number" value={form.quantity} onChange={e => set('quantity', e.target.value)} min="1" step="1" size="6" /></td>
            <td>
              <input type="number" value={form.pricePerShare} onChange={e => set('pricePerShare', e.target.value)} min="0" step="0.01" size="8" />
              <select value={form.priceCurrency} onChange={e => set('priceCurrency', e.target.value)}>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </td>
            <td>
              <input type="number" value={form.commission} onChange={e => set('commission', e.target.value)} min="0" step="0.01" size="6" />
              <select value={form.commissionCurrency} onChange={e => set('commissionCurrency', e.target.value)}>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </td>
          </>
        )}
        <td>
          {showRate ? (
            <input type="number" value={form.exchangeRate} onChange={e => set('exchangeRate', e.target.value)} min="0" step="0.0000001" size="10" placeholder="EUR/USD" />
          ) : '—'}
        </td>
        <td>—</td>
        <td className="edit-actions">
          <button className="btn-save" onClick={handleSave} disabled={saving}>Save</button>
          <button className="btn-cancel" onClick={onCancel}>Cancel</button>
        </td>
      </tr>
      {error && (
        <tr><td colSpan="10" className="edit-error">{error}</td></tr>
      )}
    </>
  );
}

export default function TransactionList({ transactions, onDelete, onEdit }) {
  const [editingId, setEditingId] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(id) {
    if (!confirm('Delete this transaction?')) return;
    try {
      await api.deleteTransaction(id);
      if (onDelete) onDelete();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected transaction(s)?`)) return;
    setDeleting(true);
    try {
      for (const id of selected) {
        await api.deleteTransaction(id);
      }
      setSelected(new Set());
      if (onDelete) onDelete();
    } catch (err) {
      alert(err.message);
    }
    setDeleting(false);
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === transactions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(transactions.map(t => t.id)));
    }
  }

  function handleSaved() {
    setEditingId(null);
    if (onEdit) onEdit();
  }

  if (!transactions || transactions.length === 0) {
    return <p className="empty">No transactions yet.</p>;
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="bulk-actions">
          <span>{selected.size} selected</span>
          <button className="btn-delete-bulk" onClick={handleDeleteSelected} disabled={deleting}>
            {deleting ? 'Deleting...' : `Delete ${selected.size}`}
          </button>
        </div>
      )}
      <table className="transaction-table">
      <thead>
        <tr>
          <th><input type="checkbox" checked={selected.size === transactions.length} onChange={toggleSelectAll} /></th>
          <th>Date</th>
          <th>Type</th>
          <th>Ticker</th>
          <th>Qty</th>
          <th>Price</th>
          <th>Commission</th>
          <th>EUR/USD Rate</th>
          <th>Total Cost</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {transactions.map(t =>
          editingId === t.id ? (
            <EditRow
              key={t.id}
              transaction={t}
              onSave={handleSaved}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <tr key={t.id} className={t.type}>
              <td><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} /></td>
              <td>{formatDate(t.date)}</td>
              <td className={`type-${t.type}`}>{t.type.toUpperCase()}</td>
              <td>{t.ticker}</td>
              <td>{t.type === 'dividend' ? '—' : t.quantity}</td>
              <td>
                {t.type === 'dividend'
                  ? (t.amountCurrency === 'USD' ? formatUSD(t.amount) : formatEUR(t.amount))
                  : (t.priceCurrency === 'USD' ? formatUSD(t.pricePerShare) : formatEUR(t.pricePerShare))}
              </td>
              <td>
                {t.type === 'dividend'
                  ? (t.taxPaid > 0 ? formatEUR(t.taxPaid) : '—')
                  : (t.commission > 0
                    ? (t.commissionCurrency === 'USD' ? formatUSD(t.commission) : formatEUR(t.commission))
                    : '—')}
              </td>
              <td className="exchange-rate-cell">
                {hasUSD(t) && t.exchangeRate ? parseFloat(t.exchangeRate.toFixed(7)) : '—'}
              </td>
              <td>
                {t.type === 'dividend' ? (() => {
                  const rate = t.exchangeRate || 1;
                  const grossEUR = t.amountCurrency === 'EUR' ? t.amount : t.amount / rate;
                  return formatEUR(grossEUR - (t.taxPaid || 0));
                })() : (() => {
                  const rate = t.exchangeRate || 1;
                  let costEUR = t.priceCurrency === 'EUR'
                    ? t.pricePerShare * t.quantity
                    : (t.pricePerShare * t.quantity) / rate;
                  const commEUR = t.commission > 0
                    ? (t.commissionCurrency === 'EUR' ? t.commission : t.commission / rate)
                    : 0;
                  return formatEUR(costEUR + commEUR);
                })()}
              </td>
              <td className="row-actions">
                <button className="btn-edit" onClick={() => setEditingId(t.id)} title="Edit">✎</button>
                <button className="btn-delete" onClick={() => handleDelete(t.id)} title="Delete">×</button>
              </td>
            </tr>
          )
        )}
      </tbody>
    </table>
    </>
  );
}
