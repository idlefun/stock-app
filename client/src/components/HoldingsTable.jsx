import { useNavigate } from 'react-router-dom';
import { formatUSD, formatEUR, formatPct } from '../lib/format';

export default function HoldingsTable({ stocks }) {
  const navigate = useNavigate();

  if (!stocks || stocks.length === 0) {
    return <p className="empty">No holdings yet. Add a buy transaction to get started.</p>;
  }

  return (
    <table className="holdings-table">
      <thead>
        <tr>
          <th>Ticker</th>
          <th>Name</th>
          <th>Qty</th>
          <th>Invested</th>
          <th>Holdings Value</th>
          <th>Unrealized</th>
          <th>Realized</th>
          <th>Total Gain</th>
          <th>Alloc</th>
        </tr>
      </thead>
      <tbody>
        {stocks.map(s => (
          <tr key={s.ticker} onClick={() => navigate(`/stock/${s.ticker}`)} className="clickable">
            <td className="ticker">{s.ticker}</td>
            <td>{s.name}</td>
            <td>{s.quantityHeld > 0 ? s.quantityHeld : '—'}</td>
            <td>
              <div>{formatEUR(s.totalInvestedEUR)}</div>
              <div className="secondary">{formatUSD(s.totalInvestedUSD)}</div>
            </td>
            <td>
              {s.quantityHeld > 0 ? (
                <>
                  <div>{formatEUR(s.currentValueEUR)}</div>
                  <div className="secondary">{formatUSD(s.currentValueUSD)}</div>
                  {s.priceStale && <span className="stale-badge">Stale</span>}
                </>
              ) : '—'}
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
            <td className={s.totalGainEUR >= 0 ? 'positive' : 'negative'}>
              <div>{formatEUR(s.totalGainEUR)}</div>
              <div>{formatPct(s.pctChange)}</div>
            </td>
            <td>{s.allocationPct?.toFixed(1)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
