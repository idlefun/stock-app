import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import TransactionForm from '../components/TransactionForm';
import TransactionList from '../components/TransactionList';

export default function Transactions() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await api.getTransactions();
      setTransactions(data);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="transactions-page">
      <TransactionForm onSubmit={load} />
      <h3>Transaction History</h3>
      {loading ? <p>Loading...</p> : <TransactionList transactions={transactions} onDelete={load} onEdit={load} />}
    </div>
  );
}
