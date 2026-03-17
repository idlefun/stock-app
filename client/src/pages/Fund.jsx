import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../lib/api';
import { formatEUR } from '../lib/format';

function FundChart({ data, startCash }) {
  if (!data || data.snapshots.length === 0) return null;

  const initial = startCash ?? 0;
  const chartData = data.snapshots.map(s => ({
    year: s.year,
    Change: s.totalEUR - initial,
  }));

  const formatAxis = (v) => {
    const sign = v >= 0 ? '+' : '';
    if (Math.abs(v) >= 1000000) return `${sign}€${(v / 1000000).toFixed(1)}M`;
    if (Math.abs(v) >= 1000) return `${sign}€${(v / 1000).toFixed(0)}k`;
    return `${sign}€${v}`;
  };

  return (
    <div className="chart-container" style={{ marginBottom: '24px' }}>
      <ResponsiveContainer width="100%" height={350}>
        <AreaChart data={chartData}>
          <XAxis dataKey="year" />
          <YAxis tickFormatter={formatAxis} width={80} />
          <Tooltip formatter={(v) => formatEUR(v)} />
          <Legend />
          <Area type="monotone" dataKey="Change" fill="#6366f1" stroke="#4f46e5" fillOpacity={0.6} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function EditableCell({ ticker, year, stock, onSave }) {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setPrice(stock.price ?? '');
    setCurrency(stock.currency || 'USD');
    setEditing(true);
  }

  async function handleSave() {
    if (!price && price !== 0) {
      // Delete manual price
      setSaving(true);
      try {
        await api.deleteManualPrice(ticker, year);
        onSave();
      } catch { /* ignore */ }
      setSaving(false);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await api.setManualPrice(ticker, year, Number(price), currency);
      onSave();
    } catch { /* ignore */ }
    setSaving(false);
    setEditing(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') setEditing(false);
  }

  if (editing) {
    return (
      <td className="editable-cell editing">
        <div className="edit-pair">
          <input
            type="number"
            value={price}
            onChange={e => setPrice(e.target.value)}
            onKeyDown={handleKeyDown}
            step="0.01"
            min="0"
            size="8"
            autoFocus
            disabled={saving}
          />
          <select value={currency} onChange={e => setCurrency(e.target.value)} disabled={saving}>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
          <button className="btn-save" onClick={handleSave} disabled={saving} style={{ fontSize: '0.7rem', padding: '2px 6px' }}>OK</button>
          <button className="btn-cancel" onClick={() => setEditing(false)} style={{ fontSize: '0.7rem', padding: '2px 6px' }}>✕</button>
        </div>
      </td>
    );
  }

  const isMissing = stock.missing;
  const isManual = stock.manual;

  return (
    <td
      className={`editable-cell ${isMissing ? 'missing-price' : ''} ${isManual ? 'manual-price' : ''}`}
      onClick={startEdit}
      title={isMissing ? 'Click to set price' : isManual ? 'Manual price — click to edit' : 'Click to override'}
    >
      {isMissing ? <span className="missing-indicator">✎ No price</span> : formatEUR(stock.valueEUR)}
      {isManual && <span className="manual-indicator"> ✎</span>}
    </td>
  );
}

function FundTable({ data, startCash, onPriceChange }) {
  if (!data || data.snapshots.length === 0) return null;

  const allTickers = [...new Set(data.snapshots.flatMap(s => Object.keys(s.stocks)))].sort();

  return (
    <table>
      <thead>
        <tr>
          <th>Year</th>
          <th>Total</th>
          <th>Change</th>
          <th>Cash</th>
          <th>Shares</th>
          {allTickers.map(t => <th key={t}>{t}</th>)}
        </tr>
      </thead>
      <tbody>
        {[...data.snapshots].reverse().map((s) => {
          const i = data.snapshots.indexOf(s);
          const prev = i > 0 ? data.snapshots[i - 1].totalEUR : startCash;
          const change = s.totalEUR - prev;
          const changePct = prev !== 0 ? (change / prev) * 100 : 0;
          return (
            <tr key={s.year}>
              <td><strong>{s.year}</strong></td>
              <td><strong>{formatEUR(s.totalEUR)}</strong></td>
              <td className={change >= 0 ? 'positive' : 'negative'}>
                {i === 0 && startCash === 0 ? '—' : `${change >= 0 ? '+' : ''}${formatEUR(change)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%)`}
              </td>
              <td>{formatEUR(s.cash)}</td>
              <td>{formatEUR(s.stocksTotalEUR)}</td>
              {allTickers.map(t => {
                const stock = s.stocks[t];
                if (!stock) return <td key={t}>—</td>;
                return (
                  <EditableCell
                    key={t}
                    ticker={t}
                    year={s.year}
                    stock={stock}
                    onSave={onPriceChange}
                  />
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function Fund() {
  const [mainFund, setMainFund] = useState(null);
  const [gwreFund, setGwreFund] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    Promise.all([
      api.getFundHistory({ startCash: 200000, startYear: 2012, exclude: 'GWRE' }),
      api.getFundHistory({ startCash: 0, startYear: 2012, only: 'GWRE', noCashOnBuy: true }),
    ])
      .then(([main, gwre]) => { setMainFund(main); setGwreFund(gwre); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  if (loading) return <p>Loading fund history...</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div className="fund-page">
      <h2>Main Fund</h2>
      <p className="secondary" style={{ marginBottom: '16px' }}>Starting cash: {formatEUR(200000)} (2012) — excludes GWRE
        {mainFund && mainFund.snapshots.length > 1 && (() => {
          const snaps = mainFund.snapshots;
          const endValue = snaps[snaps.length - 1].totalEUR;
          const years = snaps[snaps.length - 1].year - snaps[0].year;
          if (years > 0 && endValue > 0) {
            const cagr = (Math.pow(endValue / 200000, 1 / years) - 1) * 100;
            return ` — CAGR: ${cagr >= 0 ? '+' : ''}${cagr.toFixed(1)}% (Compound Annual Growth Rate)`;
          }
          return null;
        })()}
      </p>
      <FundChart data={mainFund} startCash={200000} />
      <FundTable data={mainFund} startCash={200000} onPriceChange={load} />

      <h2 style={{ marginTop: '40px' }}>GWRE Fund</h2>
      <p className="secondary" style={{ marginBottom: '16px' }}>Shares received as salary — cash from sales and dividends only</p>
      <FundChart data={gwreFund} startCash={0} />
      <FundTable data={gwreFund} startCash={0} onPriceChange={load} />
    </div>
  );
}
