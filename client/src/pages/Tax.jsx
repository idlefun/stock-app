import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { formatEUR, formatDate } from '../lib/format';

const currentYear = new Date().getFullYear();

export default function Tax() {
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [years, setYears] = useState([currentYear]);

  useEffect(() => {
    api.getTransactions().then(txns => {
      if (txns.length === 0) return;
      const minYear = Math.min(...txns.map(t => parseInt(t.date.split('-')[0])));
      const ys = [];
      for (let y = currentYear; y >= minYear; y--) ys.push(y);
      setYears(ys);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    api.getTax(year).then(setData).catch(console.error).finally(() => setLoading(false));
  }, [year]);

  return (
    <div className="tax-page">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <h2 style={{ margin: 0 }}>Tax Report</h2>
        <select value={year} onChange={e => setYear(Number(e.target.value))} className="year-select">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {loading ? <p>Loading...</p> : !data ? <p>No data.</p> : (
        <>
          <div className="portfolio-summary" style={{ marginBottom: '24px' }}>
            <div className={`summary-card ${data.totals.salesGainEUR >= 0 ? 'positive' : 'negative'}`}>
              <span className="label">Capital Gains</span>
              <span className="value">{formatEUR(data.totals.salesGainEUR)}</span>
              <span className="secondary">Taxable: {formatEUR(data.expected.taxableGain)}</span>
              <span className="secondary">(after {formatEUR(data.expected.cgtExemption)} exemption)</span>
            </div>
            <div className="summary-card">
              <span className="label">Dividend Income</span>
              <span className="value">{formatEUR(data.totals.divGrossEUR)}</span>
              {data.totals.divTaxPaid > 0 && <span className="secondary">WHT paid {formatEUR(data.totals.divTaxPaid)}</span>}
            </div>
            <div className="summary-card">
              <span className="label">Tax Paid</span>
              <span className="value">{formatEUR(data.totals.totalTaxPaid)}</span>
              {data.totals.salesTaxPaid > 0 && <span className="secondary">CGT {formatEUR(data.totals.salesTaxPaid)}</span>}
              {data.totals.divTaxPaid > 0 && <span className="secondary">WHT {formatEUR(data.totals.divTaxPaid)}</span>}
            </div>
            <div className="summary-card">
              <span className="label">Expected Tax Due</span>
              <span className="value">{formatEUR(data.expected.totalExpected)}</span>
              <span className="secondary">CGT @ {(data.expected.cgtRate * 100).toFixed(0)}%: {formatEUR(data.expected.cgt)}</span>
              <span className="secondary">Div @ {(data.expected.dividendTaxRate * 100).toFixed(0)}%: {formatEUR(data.expected.dividendTax)}</span>
            </div>
          </div>

          <h3>Sales ({data.sales.length})</h3>
          {data.sales.length === 0 ? (
            <p className="empty">No sales in {year}.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Ticker</th>
                  <th>Qty</th>
                  <th>Proceeds</th>
                  <th>Cost Basis</th>
                  <th>Net Profit</th>
                  <th>Tax Paid</th>
                </tr>
              </thead>
              <tbody>
                {data.sales.map(s => (
                  <tr key={s.id}>
                    <td>{formatDate(s.date)}</td>
                    <td className="ticker">{s.ticker}</td>
                    <td>{s.quantity}</td>
                    <td>{formatEUR(s.proceedsEUR)}</td>
                    <td>{formatEUR(s.costBasisEUR)}</td>
                    <td className={s.gainEUR >= 0 ? 'positive' : 'negative'}>{formatEUR(s.gainEUR)}</td>
                    <td>{s.taxPaid > 0 ? formatEUR(s.taxPaid) : '—'}</td>
                  </tr>
                ))}
                <tr className="totals-row">
                  <td colSpan="3"><strong>Total</strong></td>
                  <td><strong>{formatEUR(data.sales.reduce((s, t) => s + t.proceedsEUR, 0))}</strong></td>
                  <td><strong>{formatEUR(data.sales.reduce((s, t) => s + t.costBasisEUR, 0))}</strong></td>
                  <td className={data.totals.salesGainEUR >= 0 ? 'positive' : 'negative'}>
                    <strong>{formatEUR(data.totals.salesGainEUR)}</strong>
                  </td>
                  <td><strong>{data.totals.salesTaxPaid > 0 ? formatEUR(data.totals.salesTaxPaid) : '—'}</strong></td>
                </tr>
              </tbody>
            </table>
          )}

          <h3 style={{ marginTop: '24px' }}>Dividends ({data.dividends.length})</h3>
          {data.dividends.length === 0 ? (
            <p className="empty">No dividends in {year}.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Ticker</th>
                  <th>Gross</th>
                  <th>Tax Paid</th>
                  <th>Net</th>
                </tr>
              </thead>
              <tbody>
                {data.dividends.map(d => (
                  <tr key={d.id}>
                    <td>{formatDate(d.date)}</td>
                    <td className="ticker">{d.ticker}</td>
                    <td>{formatEUR(d.grossEUR)}</td>
                    <td>{d.taxPaid > 0 ? formatEUR(d.taxPaid) : '—'}</td>
                    <td>{formatEUR(d.netEUR)}</td>
                  </tr>
                ))}
                <tr className="totals-row">
                  <td colSpan="2"><strong>Total</strong></td>
                  <td><strong>{formatEUR(data.totals.divGrossEUR)}</strong></td>
                  <td><strong>{data.totals.divTaxPaid > 0 ? formatEUR(data.totals.divTaxPaid) : '—'}</strong></td>
                  <td><strong>{formatEUR(data.totals.divNetEUR)}</strong></td>
                </tr>
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
