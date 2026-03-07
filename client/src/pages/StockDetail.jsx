import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatUSD, formatEUR, formatPct, formatDate } from '../lib/format';

export default function StockDetail() {
  const { ticker } = useParams();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await api.getStockDetail(ticker);
        setDetail(data);
      } catch (err) {
        setError(err.message);
      }
      setLoading(false);
    }
    load();
  }, [ticker]);

  if (loading) return <p>Loading...</p>;
  if (error) return <p className="error">Error: {error}</p>;
  if (!detail) return null;

  const hasSplits = detail.splits && detail.splits.length > 0;

  return (
    <div className="stock-detail">
      <Link to="/" className="back-link">&larr; Back to Dashboard</Link>
      <h2>{detail.ticker} — {detail.name}</h2>

      <div className="detail-summary">
        <div className="summary-card">
          <span className="label">Shares Held (adjusted)</span>
          <span className="value">{detail.quantityHeld}</span>
        </div>
        <div className="summary-card">
          <span className="label">Avg Cost / Share (adjusted)</span>
          <span className="value">{formatUSD(detail.avgCostPerShareUSD)}</span>
          <span className="value secondary">{formatEUR(detail.avgCostPerShareEUR)}</span>
        </div>
        <div className="summary-card">
          <span className="label">Current Price</span>
          <span className="value">{formatUSD(detail.currentPriceUSD)}</span>
          <span className="value secondary">{formatEUR(detail.currentPriceEUR)}</span>
          {detail.priceStale && <span className="stale-badge">Stale</span>}
        </div>
      </div>

      {hasSplits && (
        <div className="splits-info">
          <h3>Stock Splits</h3>
          <div className="splits-list">
            {detail.splits.map((s, i) => (
              <span key={i} className="split-badge">
                {formatDate(s.date)}: {s.description}
              </span>
            ))}
          </div>
        </div>
      )}

      <h3>Transactions</h3>
      <table className="transaction-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Original Qty</th>
            {hasSplits && <th>Adjusted Qty</th>}
            <th>Original Price</th>
            {hasSplits && <th>Adjusted Price</th>}
            <th>Commission</th>
            <th>EUR/USD Rate</th>
            <th>Realized Gain/Loss</th>
          </tr>
        </thead>
        <tbody>
          {detail.transactions.map(t => (
            <tr key={t.id} className={t.type}>
              <td>{formatDate(t.date)}</td>
              <td className={`type-${t.type}`}>{t.type.toUpperCase()}</td>
              <td>{t.quantity}</td>
              {hasSplits && (
                <td>
                  {t.adjustedQuantity !== t.quantity ? (
                    <span className="split-adjusted">{t.adjustedQuantity} <span className="split-mult">({t.splitMultiplier}x)</span></span>
                  ) : t.quantity}
                </td>
              )}
              <td>
                {t.priceCurrency === 'USD' ? formatUSD(t.pricePerShare) : formatEUR(t.pricePerShare)}
              </td>
              {hasSplits && (
                <td>
                  {t.adjustedQuantity !== t.quantity ? (
                    <span className="split-adjusted">{formatUSD(t.adjustedPricePerShare)}</span>
                  ) : (t.priceCurrency === 'USD' ? formatUSD(t.pricePerShare) : formatEUR(t.pricePerShare))}
                </td>
              )}
              <td>
                {t.commission > 0
                  ? (t.commissionCurrency === 'USD' ? formatUSD(t.commission) : formatEUR(t.commission))
                  : '—'}
              </td>
              <td className="exchange-rate-cell">
                {(t.priceCurrency === 'USD' || t.commissionCurrency === 'USD') && t.exchangeRate
                  ? t.exchangeRate.toFixed(4)
                  : '—'}
              </td>
              <td>
                {t.realizedGainLossUSD != null ? (
                  <span className={t.realizedGainLossUSD >= 0 ? 'positive' : 'negative'}>
                    {formatUSD(t.realizedGainLossUSD)} / {formatEUR(t.realizedGainLossEUR)}
                  </span>
                ) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
