import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { formatEUR } from '../lib/format';

export default function PerformanceChart({ stocks }) {
  if (!stocks || stocks.length === 0) return null;

  const data = stocks
    .filter(s => s.quantityHeld > 0 && s.currentValueEUR != null)
    .map(s => ({
      name: s.ticker,
      cost: s.totalCostEUR,
      value: s.currentValueEUR,
    }));

  if (data.length === 0) return null;

  return (
    <div className="chart-container">
      <h3>Cost vs Current Value</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} />
          <Tooltip formatter={v => formatEUR(v)} />
          <Legend />
          <Line type="monotone" dataKey="cost" stroke="#8884d8" name="Cost Basis" />
          <Line type="monotone" dataKey="value" stroke="#82ca9d" name="Current Value" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
