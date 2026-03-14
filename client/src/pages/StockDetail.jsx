import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatUSD, formatEUR, formatPct, formatDate, calcTotalCostEUR } from '../lib/format';
import EditModal from '../components/EditModal';

export default function StockDetail() {
  const { ticker } = useParams();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingTxn, setEditingTxn] = useState(null);

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

  useEffect(() => { load(); }, [ticker]);

  function handleSaved() {
    setEditingTxn(null);
    load();
  }

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
          <span className="value">{formatEUR(detail.avgCostPerShareEUR)}</span>
        </div>
        <div className="summary-card">
          <span className="label">Current Price</span>
          <span className="value">{formatEUR(detail.currentPriceEUR)}</span>
          {detail.priceStale && <span className="stale-badge">Stale</span>}
        </div>
        <div className={`summary-card ${detail.totalProfitEUR >= 0 ? 'positive' : 'negative'}`}>
          <span className="label">Total Profit (incl. dividends)</span>
          <span className="value">
            {formatEUR(detail.totalProfitEUR)}
            {detail.pctReturn != null && ` (${formatPct(detail.pctReturn)})`}
          </span>
        </div>
        {detail.allocatedTaxEUR > 0 && (
          <div className={`summary-card ${detail.totalProfitAfterTaxEUR >= 0 ? 'positive' : 'negative'}`}>
            <span className="label">Profit After Tax</span>
            <span className="value">{formatEUR(detail.totalProfitAfterTaxEUR)}</span>
            <span className="value secondary">CGT allocated: {formatEUR(detail.allocatedTaxEUR)}</span>
          </div>
        )}
      </div>

      <div className="detail-summary">
        <div className="summary-card">
          <span className="label">Total Purchases</span>
          <span className="value">{formatEUR(detail.totalPurchasesEUR)}</span>
        </div>
        {detail.totalSalesProceedsEUR > 0 && (
          <div className="summary-card">
            <span className="label">Total Sales</span>
            <span className="value">{formatEUR(detail.totalSalesProceedsEUR)}</span>
            <span className={`value secondary ${detail.totalSalesGainEUR >= 0 ? 'positive' : 'negative'}`}>gain: {formatEUR(detail.totalSalesGainEUR)}</span>
            {detail.allocatedTaxEUR > 0 && <span className="value secondary">after tax: {formatEUR(detail.totalSalesAfterTaxEUR)}</span>}
          </div>
        )}
        {detail.totalDividendsGrossEUR > 0 && (
          <div className="summary-card">
            <span className="label">Total Dividends</span>
            <span className="value">{formatEUR(detail.totalDividendsGrossEUR)}</span>
            {detail.totalDividendsTaxEUR > 0 && (
              <>
                <span className="value secondary">WHT: {formatEUR(detail.totalDividendsTaxEUR)}</span>
                <span className="value secondary">after tax: {formatEUR(detail.totalDividendsNetEUR)}</span>
              </>
            )}
          </div>
        )}
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
            <th>Qty</th>
            {hasSplits && <th>Adjusted Qty</th>}
            <th>Price</th>
            {hasSplits && <th>Adjusted Price</th>}
            <th>Commission</th>
            <th>WHT</th>
            <th>EUR/USD Rate</th>
            <th>Total</th>
            <th>Realised Gain/Loss</th>
            <th></th>
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
              <td>
                {t.type === 'dividend' && t.taxPaid > 0
                  ? formatEUR(t.taxPaid) : '—'}
              </td>
              <td className="exchange-rate-cell">
                {(t.priceCurrency === 'USD' || t.commissionCurrency === 'USD') && t.exchangeRate
                  ? parseFloat(t.exchangeRate.toFixed(7))
                  : '—'}
              </td>
              <td>{formatEUR(calcTotalCostEUR(t))}</td>
              <td>
                {t.realizedGainLossEUR != null ? (
                  <span className={t.realizedGainLossEUR >= 0 ? 'positive' : 'negative'}>
                    {formatEUR(t.realizedGainLossEUR)}
                  </span>
                ) : '—'}
              </td>
              <td className="row-actions">
                <button className="btn-edit" onClick={() => setEditingTxn(t)} title="Edit">✎</button>
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
    </div>
  );
}
