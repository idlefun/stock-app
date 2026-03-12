import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { formatEUR, formatDate } from '../lib/format';

const currentYear = new Date().getFullYear();

export default function Tax() {
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [years, setYears] = useState([currentYear]);
  const [taxPaidByYear, setTaxPaidByYear] = useState({});
  const [editingTaxPaid, setEditingTaxPaid] = useState(false);
  const [taxPaidInput, setTaxPaidInput] = useState('');

  useEffect(() => {
    api.getTransactions().then(txns => {
      if (txns.length === 0) return;
      const minYear = Math.min(...txns.map(t => parseInt(t.date.split('-')[0])));
      const ys = [];
      for (let y = currentYear; y >= minYear; y--) ys.push(y);
      setYears(ys);
    }).catch(() => {});
    api.getTaxPaid().then(setTaxPaidByYear).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    api.getTax(year).then(setData).catch(console.error).finally(() => setLoading(false));
  }, [year]);

  const cgtTaxPaid = taxPaidByYear[year] || 0;

  function startEditTaxPaid() {
    setTaxPaidInput(cgtTaxPaid || '');
    setEditingTaxPaid(true);
  }

  async function saveTaxPaid() {
    const amount = Number(taxPaidInput) || 0;
    const updated = await api.setTaxPaid(year, amount);
    setTaxPaidByYear(updated);
    setEditingTaxPaid(false);
  }

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
              <span className="label">CGT Paid</span>
              {editingTaxPaid ? (
                <span className="value" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input type="number" step="0.01" min="0" value={taxPaidInput}
                    onChange={e => setTaxPaidInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveTaxPaid(); if (e.key === 'Escape') setEditingTaxPaid(false); }}
                    style={{ width: '120px', fontSize: '1rem', padding: '4px 8px' }}
                    autoFocus
                  />
                  <button onClick={saveTaxPaid} style={{ fontSize: '0.8rem', padding: '4px 8px' }}>Save</button>
                </span>
              ) : (
                <span className="value" style={{ cursor: 'pointer' }} onClick={startEditTaxPaid} title="Click to edit">
                  {formatEUR(cgtTaxPaid)} ✎
                </span>
              )}
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
          ) : (() => {
            const totalGains = data.sales.filter(s => s.gainEUR > 0).reduce((sum, s) => sum + s.gainEUR, 0);
            const expectedCGT = data.expected.cgt;
            const salesWithTax = data.sales.map(s => {
              const allocatedExpected = s.gainEUR > 0 && totalGains > 0
                ? (s.gainEUR / totalGains) * expectedCGT : 0;
              const allocatedPaid = s.gainEUR > 0 && totalGains > 0
                ? (s.gainEUR / totalGains) * cgtTaxPaid : 0;
              return { ...s, allocatedExpected, allocatedPaid, netAfterTax: s.gainEUR - allocatedPaid };
            });
            const totalAllocatedExpected = salesWithTax.reduce((sum, s) => sum + s.allocatedExpected, 0);
            const totalAllocatedPaid = salesWithTax.reduce((sum, s) => sum + s.allocatedPaid, 0);
            const totalNet = salesWithTax.reduce((sum, s) => sum + s.netAfterTax, 0);
            return (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Ticker</th>
                  <th>Qty</th>
                  <th>Proceeds</th>
                  <th>Cost Basis</th>
                  <th>Gain/Loss</th>
                  <th>Expected Tax</th>
                  <th>Tax Paid</th>
                  <th>Net After Tax</th>
                </tr>
              </thead>
              <tbody>
                {salesWithTax.map(s => (
                  <tr key={s.id}>
                    <td>{formatDate(s.date)}</td>
                    <td className="ticker">{s.ticker}</td>
                    <td>{s.quantity}</td>
                    <td>{formatEUR(s.proceedsEUR)}</td>
                    <td>{formatEUR(s.costBasisEUR)}</td>
                    <td className={s.gainEUR >= 0 ? 'positive' : 'negative'}>{formatEUR(s.gainEUR)}</td>
                    <td>{s.allocatedExpected > 0 ? formatEUR(s.allocatedExpected) : '—'}</td>
                    <td>{s.allocatedPaid > 0 ? formatEUR(s.allocatedPaid) : '—'}</td>
                    <td className={s.netAfterTax >= 0 ? 'positive' : 'negative'}>{formatEUR(s.netAfterTax)}</td>
                  </tr>
                ))}
                <tr className="totals-row">
                  <td colSpan="3"><strong>Total</strong></td>
                  <td><strong>{formatEUR(data.sales.reduce((s, t) => s + t.proceedsEUR, 0))}</strong></td>
                  <td><strong>{formatEUR(data.sales.reduce((s, t) => s + t.costBasisEUR, 0))}</strong></td>
                  <td className={data.totals.salesGainEUR >= 0 ? 'positive' : 'negative'}>
                    <strong>{formatEUR(data.totals.salesGainEUR)}</strong>
                  </td>
                  <td><strong>{totalAllocatedExpected > 0 ? formatEUR(totalAllocatedExpected) : '—'}</strong></td>
                  <td><strong>{totalAllocatedPaid > 0 ? formatEUR(totalAllocatedPaid) : '—'}</strong></td>
                  <td className={totalNet >= 0 ? 'positive' : 'negative'}><strong>{formatEUR(totalNet)}</strong></td>
                </tr>
              </tbody>
            </table>
            );
          })()}

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
