import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import TransactionForm from '../components/TransactionForm';
import CsvImport from '../components/CsvImport';
import TransactionList from '../components/TransactionList';

function exportCSV(transactions) {
  const headers = ['type','ticker','date','quantity','pricePerShare','priceCurrency','commission','commissionCurrency','dividendAmount','dividendCurrency','taxPaid','exchangeRate','companyName'];
  const rows = transactions.map(t => headers.map(h => {
    let val = t[h];
    if (val == null) return '';
    if (h === 'date' && val) {
      const [y, m, d] = val.split('-');
      val = `${d}/${m}/${y}`;
    }
    let str = String(val);
    if (/^[=+\-@]/.test(str)) str = "'" + str;
    return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
  }).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transactions-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Transactions() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load(showLoading = true) {
    if (showLoading) setLoading(true);
    try {
      const data = await api.getTransactions();
      setTransactions(data);
    } catch (err) {
      console.error(err);
    }
    if (showLoading) setLoading(false);
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="transactions-page">
      <TransactionForm onSubmit={load} />
      <CsvImport onImport={load} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
        <h3 style={{ margin: 0 }}>Transaction History</h3>
        {transactions.length > 0 && (
          <button className="btn-export" onClick={() => exportCSV(transactions)}>Export CSV</button>
        )}
      </div>
      {loading ? <p>Loading...</p> : <TransactionList transactions={transactions} onDelete={() => load(false)} onEdit={() => load(false)} />}
    </div>
  );
}
