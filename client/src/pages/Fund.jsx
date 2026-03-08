import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../lib/api';
import { formatEUR } from '../lib/format';

const COLORS = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
  '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#06b6d4',
  '#84cc16', '#a855f7', '#e11d48', '#0ea5e9', '#22c55e',
];

function FundChart({ data, startCash }) {
  if (!data) return null;

  const allTickers = [...new Set(data.snapshots.flatMap(s => Object.keys(s.stocks)))].sort();

  const chartData = data.snapshots.map(s => {
    const point = { year: s.year, Cash: s.cash };
    for (const ticker of allTickers) {
      point[ticker] = s.stocks[ticker]?.valueEUR || 0;
    }
    return point;
  });

  const stackKeys = ['Cash', ...allTickers];

  const formatAxis = (v) => {
    if (Math.abs(v) >= 1000000) return `€${(v / 1000000).toFixed(1)}M`;
    if (Math.abs(v) >= 1000) return `€${(v / 1000).toFixed(0)}k`;
    return `€${v}`;
  };

  return (
    <div className="chart-container" style={{ marginBottom: '24px' }}>
      <ResponsiveContainer width="100%" height={350}>
        <AreaChart data={chartData}>
          <XAxis dataKey="year" />
          <YAxis tickFormatter={formatAxis} width={70} />
          <Tooltip formatter={(v) => formatEUR(v)} />
          <Legend />
          {stackKeys.map((key, i) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              stackId="1"
              fill={key === 'Cash' ? '#94a3b8' : COLORS[i % COLORS.length]}
              stroke={key === 'Cash' ? '#64748b' : COLORS[i % COLORS.length]}
              fillOpacity={0.8}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function FundTable({ data, startCash }) {
  if (!data) return null;

  const allTickers = [...new Set(data.snapshots.flatMap(s => Object.keys(s.stocks)))].sort();

  return (
    <table>
      <thead>
        <tr>
          <th>Year</th>
          <th>Cash</th>
          {allTickers.map(t => <th key={t}>{t}</th>)}
          <th>Total</th>
          <th>Change</th>
        </tr>
      </thead>
      <tbody>
        {data.snapshots.map((s, i) => {
          const prev = i > 0 ? data.snapshots[i - 1].totalEUR : startCash;
          const change = s.totalEUR - prev;
          const changePct = prev !== 0 ? (change / prev) * 100 : 0;
          return (
            <tr key={s.year}>
              <td><strong>{s.year}</strong></td>
              <td>{formatEUR(s.cash)}</td>
              {allTickers.map(t => (
                <td key={t}>{s.stocks[t] ? formatEUR(s.stocks[t].valueEUR) : '—'}</td>
              ))}
              <td><strong>{formatEUR(s.totalEUR)}</strong></td>
              <td className={change >= 0 ? 'positive' : 'negative'}>
                {i === 0 ? '—' : `${change >= 0 ? '+' : ''}${formatEUR(change)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%)`}
              </td>
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

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getFundHistory({ startCash: 200000, startYear: 2012, exclude: 'GWRE' }),
      api.getFundHistory({ startCash: 0, startYear: 2012, only: 'GWRE' }),
    ])
      .then(([main, gwre]) => { setMainFund(main); setGwreFund(gwre); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading fund history...</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div className="fund-page">
      <h2>Main Fund</h2>
      <p className="secondary" style={{ marginBottom: '16px' }}>Starting cash: {formatEUR(200000)} (2012) — excludes GWRE</p>
      <FundChart data={mainFund} startCash={200000} />
      <FundTable data={mainFund} startCash={200000} />

      <h2 style={{ marginTop: '40px' }}>GWRE Fund</h2>
      <p className="secondary" style={{ marginBottom: '16px' }}>Separate tracking for Guidewire (GWRE)</p>
      <FundChart data={gwreFund} startCash={0} />
      <FundTable data={gwreFund} startCash={0} />
    </div>
  );
}
