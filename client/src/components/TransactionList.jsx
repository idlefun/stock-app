import { useState, useEffect, useRef } from 'react';
import { formatUSD, formatEUR, formatDate, calcTotalCostEUR } from '../lib/format';
import { api } from '../lib/api';
import { useTickerSearch } from '../lib/useTickerSearch';

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
  const { searchResults, showDropdown, searching, selectTicker } = useTickerSearch(form.ticker, !isDividend);

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function handleSelectTicker(result) {
    set('ticker', selectTicker(result));
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

  const rowRef = useRef(null);
  useEffect(() => {
    if (rowRef.current) rowRef.current.scrollIntoView({ block: 'nearest' });
  }, []);

  const showRate = isDividend
    ? (form.amountCurrency || 'USD') === 'USD'
    : (form.priceCurrency === 'USD' || form.commissionCurrency === 'USD');

  return (
    <>
      <tr className="edit-row" ref={rowRef}>
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
                <li key={r.ticker} onClick={() => handleSelectTicker(r)}>
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
              <div className="edit-pair">
                <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)} min="0" step="0.01" size="8" />
                <select value={form.amountCurrency || 'USD'} onChange={e => set('amountCurrency', e.target.value)}>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
            </td>
            <td>—</td>
            <td>
              <input type="number" value={form.taxPaid} onChange={e => set('taxPaid', e.target.value)} min="0" step="0.01" size="6" placeholder="EUR" />
            </td>
          </>
        ) : (
          <>
            <td><input type="number" value={form.quantity} onChange={e => set('quantity', e.target.value)} min="1" step="1" size="6" /></td>
            <td>
              <div className="edit-pair">
                <input type="number" value={form.pricePerShare} onChange={e => set('pricePerShare', e.target.value)} min="0" step="0.01" size="8" />
                <select value={form.priceCurrency} onChange={e => set('priceCurrency', e.target.value)}>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
            </td>
            <td>
              <div className="edit-pair">
                <input type="number" value={form.commission} onChange={e => set('commission', e.target.value)} min="0" step="0.01" size="6" />
                <select value={form.commissionCurrency} onChange={e => set('commissionCurrency', e.target.value)}>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
            </td>
            <td>
              {form.type === 'sell'
                ? <input type="number" value={form.taxPaid} onChange={e => set('taxPaid', e.target.value)} min="0" step="0.01" size="6" placeholder="EUR" />
                : '—'}
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
        <tr><td colSpan="11" className="edit-error">{error}</td></tr>
      )}
    </>
  );
}

export default function TransactionList({ transactions, onDelete, onEdit }) {
  const [editingId, setEditingId] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const lastClickedRef = useRef(null);

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
      await api.deleteTransactionsBulk([...selected]);
      setSelected(new Set());
      if (onDelete) onDelete();
    } catch (err) {
      alert(err.message);
    }
    setDeleting(false);
  }

  function toggleSelect(index, e) {
    const id = transactions[index].id;
    if (e.shiftKey && lastClickedRef.current != null) {
      const from = Math.min(lastClickedRef.current, index);
      const to = Math.max(lastClickedRef.current, index);
      setSelected(prev => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) next.add(transactions[i].id);
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    }
    lastClickedRef.current = index;
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
          <th>Tax</th>
          <th>EUR/USD Rate</th>
          <th>Total</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {transactions.map((t, idx) =>
          editingId === t.id ? (
            <EditRow
              key={t.id}
              transaction={t}
              onSave={handleSaved}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <tr key={t.id} className={t.type}>
              <td><input type="checkbox" checked={selected.has(t.id)} onClick={e => { e.stopPropagation(); toggleSelect(idx, e.nativeEvent); }} readOnly /></td>
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
                {t.type === 'dividend' ? '—'
                  : (t.commission > 0
                    ? (t.commissionCurrency === 'USD' ? formatUSD(t.commission) : formatEUR(t.commission))
                    : '—')}
              </td>
              <td>
                {(t.type === 'dividend' || t.type === 'sell') && t.taxPaid > 0
                  ? formatEUR(t.taxPaid) : '—'}
              </td>
              <td className="exchange-rate-cell">
                {hasUSD(t) && t.exchangeRate ? parseFloat(t.exchangeRate.toFixed(7)) : '—'}
              </td>
              <td>{formatEUR(calcTotalCostEUR(t))}</td>
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
