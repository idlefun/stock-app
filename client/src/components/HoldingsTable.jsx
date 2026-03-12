import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatUSD, formatEUR, formatPct } from '../lib/format';

const COLUMNS = [
  { key: 'ticker', label: 'Ticker', getValue: s => s.ticker },
  { key: 'name', label: 'Name', getValue: s => s.name },
  { key: 'quantityHeld', label: 'Qty', getValue: s => s.quantityHeld },
  { key: 'currentPrice', label: 'Price', getValue: s => s.currentPrice ?? 0 },
  { key: 'currentValueEUR', label: 'Holdings Value', getValue: s => s.currentValueEUR ?? 0 },
  { key: 'unrealizedEUR', label: 'Unrealised', getValue: s => s.unrealizedEUR ?? 0 },
  { key: 'realizedEUR', label: 'Realised', getValue: s => s.realizedEUR ?? 0 },
  { key: 'netDividendsEUR', label: 'Dividends', getValue: s => s.netDividendsEUR ?? 0 },
  { key: 'totalGainAfterTaxEUR', label: 'Net Gain', getValue: s => s.totalGainAfterTaxEUR ?? 0 },
  { key: 'allocationPct', label: 'Alloc', getValue: s => s.allocationPct ?? 0 },
];

export default function HoldingsTable({ stocks }) {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState('ticker');
  const [sortAsc, setSortAsc] = useState(true);

  if (!stocks || stocks.length === 0) {
    return <p className="empty">No holdings yet. Add a buy transaction to get started.</p>;
  }

  function handleSort(key) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  const col = COLUMNS.find(c => c.key === sortKey);
  const sorted = [...stocks].sort((a, b) => {
    const av = col.getValue(a);
    const bv = col.getValue(b);
    let cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    return sortAsc ? cmp : -cmp;
  });

  return (
    <table className="holdings-table">
      <thead>
        <tr>
          {COLUMNS.map(c => (
            <th key={c.key} onClick={() => handleSort(c.key)} className="sortable">
              {c.label} {sortKey === c.key ? (sortAsc ? '▲' : '▼') : ''}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map(s => (
          <tr key={s.ticker} onClick={() => navigate(`/stock/${s.ticker}`)} className="clickable">
            <td className="ticker">
              {s.ticker}
              {s.assetType === 'etf' && <span className="etf-badge">ETF</span>}
              {s.splitRatio > 1 && <span className="split-badge">{s.splitRatio}:1</span>}
            </td>
            <td>{s.name}</td>
            <td>{s.quantityHeld > 0 ? s.quantityHeld : '—'}</td>
            <td>
              {s.quantityHeld > 0 && s.currentPrice ? (
                <>
                  <div>{s.priceCurrency === 'USD' ? formatUSD(s.currentPrice) : formatEUR(s.currentPrice)}</div>
                  {s.priceStale && <span className="stale-badge">Stale</span>}
                </>
              ) : '—'}
            </td>
            <td>
              {s.quantityHeld > 0 ? formatEUR(s.currentValueEUR) : '—'}
            </td>
            <td className={s.unrealizedEUR != null && s.unrealizedEUR >= 0 ? 'positive' : 'negative'}>
              {s.unrealizedEUR != null ? (
                <div>{formatEUR(s.unrealizedEUR)}</div>
              ) : '—'}
            </td>
            <td className={s.realizedEUR >= 0 ? 'positive' : 'negative'}>
              {s.realizedEUR !== 0 ? (
                <div>{formatEUR(s.realizedEUR)}</div>
              ) : '—'}
            </td>
            <td className={s.netDividendsEUR > 0 ? 'positive' : ''}>
              {s.dividendsEUR > 0 ? (
                <>
                  <div>{formatEUR(s.netDividendsEUR)}</div>
                  {s.taxPaidEUR > 0 && <div className="secondary">tax: {formatEUR(s.taxPaidEUR)}</div>}
                </>
              ) : '—'}
            </td>
            <td className={s.totalGainAfterTaxEUR >= 0 ? 'positive' : 'negative'}>
              <div>{formatEUR(s.totalGainAfterTaxEUR)}</div>
              <div>{formatPct(s.pctChange)}</div>
            </td>
            <td>{s.allocationPct?.toFixed(1)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
