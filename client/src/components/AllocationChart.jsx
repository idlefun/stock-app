import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { formatEUR } from '../lib/format';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D', '#FFC658', '#FF6B6B'];

export default function AllocationChart({ stocks }) {
  if (!stocks || stocks.length === 0) return null;

  const data = stocks
    .filter(s => s.quantityHeld > 0 && s.currentValueEUR != null)
    .map(s => ({
      name: s.ticker,
      value: s.currentValueEUR,
    }));

  if (data.length === 0) return null;

  return (
    <div className="chart-container">
      <h3>Portfolio Allocation</h3>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={100}
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={v => formatEUR(v)} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
