import { useState, useRef } from 'react';
import { api } from '../lib/api';

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (const ch of lines[i]) {
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    values.push(current.trim());

    if (values.length !== headers.length) continue;

    const row = {};
    headers.forEach((h, j) => { row[h] = values[j]; });
    rows.push(row);
  }

  return rows;
}

export default function CsvImport({ onImport }) {
  const [rows, setRows] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError('');
    setResult(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = parseCSV(ev.target.result);
        if (parsed.length === 0) {
          setError('No valid rows found in CSV');
          setRows(null);
          return;
        }
        setRows(parsed);
      } catch {
        setError('Failed to parse CSV file');
        setRows(null);
      }
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    setImporting(true);
    setError('');
    setResult(null);
    try {
      const normalized = rows.map(row => {
        if (row.date && /^\d{2}\/\d{2}\/\d{4}$/.test(row.date)) {
          const [d, m, y] = row.date.split('/');
          return { ...row, date: `${y}-${m}-${d}` };
        }
        return row;
      });
      const res = await api.importTransactions(normalized);
      setResult(res);
      if (res.imported > 0) {
        setRows(null);
        if (fileRef.current) fileRef.current.value = '';
        if (onImport) onImport();
      }
    } catch (err) {
      setError(err.message);
    }
    setImporting(false);
  }

  function handleCancel() {
    setRows(null);
    setResult(null);
    setError('');
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="csv-import">
      <h3>Import CSV</h3>
      <div className="csv-import-info">
        <details>
          <summary>CSV Format</summary>
          <p>Buy/Sell columns: <code>type, ticker, date, quantity, pricePerShare, priceCurrency, commission, commissionCurrency, exchangeRate, companyName</code></p>
          <p>Dividend columns: <code>type, ticker, date, amount, amountCurrency, taxPaid, exchangeRate</code></p>
          <p>Date format: <code>dd/mm/yyyy</code> (e.g. 15/03/2025). YYYY-MM-DD also accepted.</p>
          <p>Mixed types can share all columns — unused fields are ignored.</p>
        </details>
      </div>

      <div className="csv-import-controls">
        <input type="file" accept=".csv,text/csv" onChange={handleFile} ref={fileRef} />
        {rows && (
          <>
            <button className="btn-save" onClick={handleImport} disabled={importing}>
              {importing ? 'Importing...' : `Import ${rows.length} rows`}
            </button>
            <button className="btn-cancel" onClick={handleCancel}>Cancel</button>
          </>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {result && (
        <div className={result.imported > 0 ? 'csv-result success' : 'csv-result'}>
          <p>Imported: {result.imported} transactions</p>
          {result.errors.length > 0 && (
            <ul className="csv-errors">
              {result.errors.map((e, i) => (
                <li key={i}>Row {e.row}: {e.error}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {rows && (
        <div className="csv-preview">
          <h4>Preview ({rows.length} rows)</h4>
          <table>
            <thead>
              <tr>
                <th>#</th>
                {Object.keys(rows[0]).map(h => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 20).map((row, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  {Object.values(row).map((v, j) => <td key={j}>{v}</td>)}
                </tr>
              ))}
              {rows.length > 20 && (
                <tr><td colSpan={Object.keys(rows[0]).length + 1} className="secondary">...and {rows.length - 20} more rows</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
