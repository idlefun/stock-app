import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { formatEUR, formatDate } from '../lib/format';

const currentYear = new Date().getFullYear();

function SalesTable({ sales, label, expectedTax, taxPaid }) {
  if (sales.length === 0) return <p className="empty">No {label.toLowerCase()} sales in this year.</p>;

  const totalGains = sales.filter(s => s.gainEUR > 0).reduce((sum, s) => sum + s.gainEUR, 0);
  const salesWithTax = sales.map(s => {
    const allocatedExpected = s.gainEUR > 0 && totalGains > 0
      ? (s.gainEUR / totalGains) * expectedTax : 0;
    const allocatedPaid = s.gainEUR > 0 && totalGains > 0
      ? (s.gainEUR / totalGains) * taxPaid : 0;
    return { ...s, allocatedExpected, allocatedPaid, netAfterTax: s.gainEUR - allocatedPaid };
  });
  const totalAllocatedExpected = salesWithTax.reduce((sum, s) => sum + s.allocatedExpected, 0);
  const totalAllocatedPaid = salesWithTax.reduce((sum, s) => sum + s.allocatedPaid, 0);
  const totalNet = salesWithTax.reduce((sum, s) => sum + s.netAfterTax, 0);
  const totalProceeds = sales.reduce((s, t) => s + t.proceedsEUR, 0);
  const totalCostBasis = sales.reduce((s, t) => s + t.costBasisEUR, 0);
  const totalGain = sales.reduce((s, t) => s + t.gainEUR, 0);

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
          <td><strong>{formatEUR(totalProceeds)}</strong></td>
          <td><strong>{formatEUR(totalCostBasis)}</strong></td>
          <td className={totalGain >= 0 ? 'positive' : 'negative'}>
            <strong>{formatEUR(totalGain)}</strong>
          </td>
          <td><strong>{totalAllocatedExpected > 0 ? formatEUR(totalAllocatedExpected) : '—'}</strong></td>
          <td><strong>{totalAllocatedPaid > 0 ? formatEUR(totalAllocatedPaid) : '—'}</strong></td>
          <td className={totalNet >= 0 ? 'positive' : 'negative'}><strong>{formatEUR(totalNet)}</strong></td>
        </tr>
      </tbody>
    </table>
  );
}

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

  const stockSales = data ? data.sales.filter(s => s.assetType !== 'etf') : [];
  const etfSales = data ? data.sales.filter(s => s.assetType === 'etf') : [];

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
            {/* Stock CGT */}
            <div className={`summary-card ${(data.totals.stockGainEUR || 0) >= 0 ? 'positive' : 'negative'}`}>
              <span className="label">Stock Capital Gains</span>
              <span className="value">{formatEUR(data.totals.stockGainEUR)}</span>
              <span className="secondary">Taxable: {formatEUR(data.expected.stockTaxableGain)}</span>
              <span className="secondary">(after {formatEUR(data.expected.cgtExemption)} exemption)</span>
            </div>
            {/* ETF Capital Gains */}
            <div className={`summary-card ${(data.totals.etfGainEUR || 0) >= 0 ? 'positive' : 'negative'}`}>
              <span className="label">ETF Capital Gains</span>
              <span className="value">{formatEUR(data.totals.etfGainEUR)}</span>
              <span className="secondary">No exemption</span>
            </div>

            {/* Expected Total + Tax Paid */}
            <div className="summary-card">
              <span className="label">Expected Total Tax</span>
              <span className="value">{formatEUR(data.expected.cgt)}</span>
              <span className="label" style={{ marginTop: '8px' }}>Tax Paid</span>
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
            </div>

            {/* Dividends */}
            <div className="summary-card">
              <span className="label">Dividend Income</span>
              <span className="value">{formatEUR(data.totals.divGrossEUR)}</span>
              {data.totals.divTaxPaid > 0 && <span className="secondary">WHT paid {formatEUR(data.totals.divTaxPaid)}</span>}
            </div>
            <div className={`summary-card ${data.expected.isPenaltyRate ? 'penalty' : ''}`}>
              <span className="label">
                Expected Dividend Tax
                {data.expected.isPenaltyRate && <span className="penalty-badge">Penalty</span>}
              </span>
              <span className="value">{formatEUR(data.expected.dividendTax)}</span>
              <span className="secondary">@ {(data.expected.dividendTaxRate * 100).toFixed(3)}% on {formatEUR(data.totals.divGrossEUR)}</span>
              {data.totals.divTaxPaid > 0 && <span className="secondary">WHT credit {formatEUR(data.totals.divTaxPaid)}</span>}
            </div>
            <div className="summary-card">
              <span className="label">Dividend Tax Paid</span>
              <span className="value">{formatEUR(data.totals.divTaxPaid)}</span>
              <span className="secondary">WHT at source</span>
            </div>
          </div>

          {stockSales.length > 0 && (
            <>
              <h3>Stock Sales ({stockSales.length})</h3>
              <SalesTable
                sales={stockSales}
                label="Stock"
                expectedTax={data.expected.stockCgt}
                taxPaid={cgtTaxPaid > 0 && (data.expected.stockCgt + data.expected.etfTax) > 0
                  ? cgtTaxPaid * (data.expected.stockCgt / (data.expected.stockCgt + data.expected.etfTax))
                  : 0}
              />
            </>
          )}

          {etfSales.length > 0 && (
            <>
              <h3 style={{ marginTop: '24px' }}>ETF Sales ({etfSales.length})</h3>
              <SalesTable
                sales={etfSales}
                label="ETF"
                expectedTax={data.expected.etfTax}
                taxPaid={cgtTaxPaid > 0 && (data.expected.stockCgt + data.expected.etfTax) > 0
                  ? cgtTaxPaid * (data.expected.etfTax / (data.expected.stockCgt + data.expected.etfTax))
                  : 0}
              />
            </>
          )}

          {stockSales.length === 0 && etfSales.length === 0 && (
            <p className="empty">No sales in {year}.</p>
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
