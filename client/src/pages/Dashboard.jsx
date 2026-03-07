import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import PortfolioSummary from '../components/PortfolioSummary';
import HoldingsTable from '../components/HoldingsTable';
import PerformanceChart from '../components/PerformanceChart';
import AllocationChart from '../components/AllocationChart';

export default function Dashboard() {
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.getPortfolio();
      setPortfolio(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  if (loading) return <p>Loading portfolio...</p>;
  if (error) return <p className="error">Error: {error}</p>;
  if (!portfolio) return null;

  return (
    <div className="dashboard">
      <PortfolioSummary totals={portfolio.totals} exchangeRate={portfolio.exchangeRate} />
      <HoldingsTable stocks={portfolio.stocks} />
      <div className="charts-row">
        <PerformanceChart stocks={portfolio.stocks} />
        <AllocationChart stocks={portfolio.stocks} />
      </div>
    </div>
  );
}
