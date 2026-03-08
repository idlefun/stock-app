import { useState, useRef } from 'react';
import { api } from '../lib/api';

export default function Backup() {
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const fileRef = useRef();

  async function handleDownload() {
    setError('');
    setStatus('');
    setDownloading(true);
    try {
      await api.downloadBackup();
      setStatus('Backup downloaded.');
    } catch (err) {
      setError(err.message);
    }
    setDownloading(false);
  }

  async function handleRestore() {
    const file = fileRef.current?.files[0];
    if (!file) { setError('Select a backup file first.'); return; }

    setError('');
    setStatus('');
    setRestoring(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data['transactions.json'] && !data['manual-prices.json']) {
        throw new Error('Invalid backup file — no recognized data found.');
      }
      const result = await api.restoreBackup(data);
      setStatus(`Restored: ${result.restored.join(', ')}. Reload the page to see updated data.`);
      fileRef.current.value = '';
    } catch (err) {
      setError(err.message);
    }
    setRestoring(false);
  }

  return (
    <div className="backup-page">
      <h2>Backup & Restore</h2>

      <div className="backup-section">
        <h3>Export Backup</h3>
        <p className="secondary">Download all transactions and manual prices as a JSON file.</p>
        <button className="btn-export" onClick={handleDownload} disabled={downloading}>
          {downloading ? 'Downloading...' : 'Download Backup'}
        </button>
      </div>

      <div className="backup-section">
        <h3>Import Backup</h3>
        <p className="secondary">Restore from a previously exported backup file. This will overwrite existing data.</p>
        <div className="backup-controls">
          <input type="file" accept=".json" ref={fileRef} />
          <button className="btn-restore" onClick={handleRestore} disabled={restoring}>
            {restoring ? 'Restoring...' : 'Restore'}
          </button>
        </div>
      </div>

      {status && <div className="backup-status success">{status}</div>}
      {error && <div className="backup-status error">{error}</div>}
    </div>
  );
}
