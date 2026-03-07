import { useState } from 'react';
import { formatUSD, formatEUR, formatDate } from '../lib/format';
import { api } from '../lib/api';

function hasUSD(t) {
  return t.priceCurrency === 'USD' || t.commissionCurrency === 'USD';
}

function EditRow({ transaction, onSave, onCancel }) {
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
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      await api.updateTransaction(transaction.id, {
        ...form,
        quantity: Number(form.quantity),
        pricePerShare: Number(form.pricePerShare),
        commission: Number(form.commission) || 0,
        exchangeRate: form.exchangeRate !== '' ? Number(form.exchangeRate) : null,
      });
      onSave();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  }

  const showRate = form.priceCurrency === 'USD' || form.commissionCurrency === 'USD';

  return (
    <>
      <tr className="edit-row">
        <td><input type="date" value={form.date} onChange={e => set('date', e.target.value)} /></td>
        <td>
          <select value={form.type} onChange={e => set('type', e.target.value)}>
            <option value="buy">BUY</option>
            <option value="sell">SELL</option>
          </select>
        </td>
        <td><input type="text" value={form.ticker} onChange={e => set('ticker', e.target.value.toUpperCase())} size="6" /></td>
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
        <td>
          {showRate ? (
            <input type="number" value={form.exchangeRate} onChange={e => set('exchangeRate', e.target.value)} min="0" step="0.0001" size="8" placeholder="EUR/USD" />
          ) : '—'}
        </td>
        <td className="edit-actions">
          <button className="btn-save" onClick={handleSave} disabled={saving}>Save</button>
          <button className="btn-cancel" onClick={onCancel}>Cancel</button>
        </td>
      </tr>
      {error && (
        <tr><td colSpan="8" className="edit-error">{error}</td></tr>
      )}
    </>
  );
}

export default function TransactionList({ transactions, onDelete, onEdit }) {
  const [editingId, setEditingId] = useState(null);

  async function handleDelete(id) {
    if (!confirm('Delete this transaction?')) return;
    try {
      await api.deleteTransaction(id);
      if (onDelete) onDelete();
    } catch (err) {
      alert(err.message);
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
    <table className="transaction-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Type</th>
          <th>Ticker</th>
          <th>Qty</th>
          <th>Price</th>
          <th>Commission</th>
          <th>EUR/USD Rate</th>
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
              <td>{formatDate(t.date)}</td>
              <td className={`type-${t.type}`}>{t.type.toUpperCase()}</td>
              <td>{t.ticker}</td>
              <td>{t.quantity}</td>
              <td>
                {t.priceCurrency === 'USD' ? formatUSD(t.pricePerShare) : formatEUR(t.pricePerShare)}
              </td>
              <td>
                {t.commission > 0
                  ? (t.commissionCurrency === 'USD' ? formatUSD(t.commission) : formatEUR(t.commission))
                  : '—'}
              </td>
              <td className="exchange-rate-cell">
                {hasUSD(t) && t.exchangeRate ? t.exchangeRate.toFixed(4) : '—'}
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
  );
}
