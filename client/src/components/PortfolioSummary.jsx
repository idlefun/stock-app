import { formatUSD, formatEUR, formatPct } from '../lib/format';

export default function PortfolioSummary({ totals, exchangeRate }) {
  if (!totals) return null;

  return (
    <div className="portfolio-summary">
      <div className="summary-card">
        <span className="label">Total Invested</span>
        <span className="value">{formatEUR(totals.totalInvestedEUR)}</span>
        <span className="value secondary">{formatUSD(totals.totalInvestedUSD)}</span>
      </div>
      <div className="summary-card">
        <span className="label">Holdings Value</span>
        <span className="value">{formatEUR(totals.holdingsValueEUR)}</span>
        <span className="value secondary">{formatUSD(totals.holdingsValueUSD)}</span>
      </div>
      <div className={`summary-card ${(totals.unrealizedEUR || 0) >= 0 ? 'positive' : 'negative'}`}>
        <span className="label">Unrealized</span>
        <span className="value">{formatEUR(totals.unrealizedEUR)}</span>
        <span className="value secondary">{formatUSD(totals.unrealizedUSD)}</span>
      </div>
      <div className={`summary-card ${(totals.realizedEUR || 0) >= 0 ? 'positive' : 'negative'}`}>
        <span className="label">Realized</span>
        <span className="value">{formatEUR(totals.realizedEUR)}</span>
        <span className="value secondary">{formatUSD(totals.realizedUSD)}</span>
      </div>
      <div className={`summary-card ${(totals.netDividendsEUR || 0) > 0 ? 'positive' : ''}`}>
        <span className="label">Dividends (net)</span>
        <span className="value">{formatEUR(totals.netDividendsEUR)}</span>
        {totals.taxPaidEUR > 0 && <span className="value secondary">tax: {formatEUR(totals.taxPaidEUR)}</span>}
      </div>
      <div className={`summary-card ${(totals.totalGainEUR || 0) >= 0 ? 'positive' : 'negative'}`}>
        <span className="label">Total Gain / Loss</span>
        <span className="value">{formatEUR(totals.totalGainEUR)} ({formatPct(totals.pctChange)})</span>
        <span className="value secondary">{formatUSD(totals.totalGainUSD)}</span>
      </div>
      {exchangeRate && (
        <div className="summary-card small">
          <span className="label">EUR/USD Rate</span>
          <span className="value">{exchangeRate.eurToUsd?.toFixed(4)}</span>
          {exchangeRate.stale && <span className="stale-badge">Stale</span>}
        </div>
      )}
    </div>
  );
}
