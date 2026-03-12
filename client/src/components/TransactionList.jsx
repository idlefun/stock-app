import { useState, useRef } from 'react';
import { formatUSD, formatEUR, formatDate, calcTotalCostEUR } from '../lib/format';
import { api } from '../lib/api';
import EditModal from './EditModal';

function hasUSD(t) {
  if (t.type === 'dividend') return t.amountCurrency === 'USD';
  return t.priceCurrency === 'USD' || t.commissionCurrency === 'USD';
}

export default function TransactionList({ transactions, onDelete, onEdit }) {
  const [editingTxn, setEditingTxn] = useState(null);
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
    setEditingTxn(null);
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
          <th>WHT</th>
          <th>EUR/USD Rate</th>
          <th>Total</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {transactions.map((t, idx) => (
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
              {t.type === 'dividend' && t.taxPaid > 0
                ? formatEUR(t.taxPaid) : '—'}
            </td>
            <td className="exchange-rate-cell">
              {hasUSD(t) && t.exchangeRate ? parseFloat(t.exchangeRate.toFixed(7)) : '—'}
            </td>
            <td>{formatEUR(calcTotalCostEUR(t))}</td>
            <td className="row-actions">
              <button className="btn-edit" onClick={() => setEditingTxn(t)} title="Edit">✎</button>
              <button className="btn-delete" onClick={() => handleDelete(t.id)} title="Delete">×</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    {editingTxn && (
      <EditModal
        transaction={editingTxn}
        onSave={handleSaved}
        onCancel={() => setEditingTxn(null)}
      />
    )}
    </>
  );
}
