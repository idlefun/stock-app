const API_BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

export const api = {
  getPortfolio: () => request('/portfolio'),
  getStockDetail: (ticker) => request(`/portfolio/${ticker}`),
  getTransactions: (ticker) => request(`/transactions${ticker ? `?ticker=${ticker}` : ''}`),
  createTransaction: (txn) => request('/transactions', { method: 'POST', body: JSON.stringify(txn) }),
  updateTransaction: (id, txn) => request(`/transactions/${id}`, { method: 'PUT', body: JSON.stringify(txn) }),
  deleteTransaction: (id) => request(`/transactions/${id}`, { method: 'DELETE' }),
  deleteTransactionsBulk: (ids) => request('/transactions/bulk', { method: 'DELETE', body: JSON.stringify({ ids }) }),
  importTransactions: (rows) => request('/transactions/import', { method: 'POST', body: JSON.stringify({ rows }) }),
  searchTicker: (q) => request(`/search?q=${encodeURIComponent(q)}`),
  getExchangeRate: () => request('/exchange-rate'),
  getSplits: (ticker) => request(`/splits?ticker=${encodeURIComponent(ticker)}`),
  getTax: (year) => request(`/tax?year=${year}`),
  getFundHistory: (opts = {}) => {
    const params = new URLSearchParams();
    if (opts.startCash != null) params.set('startCash', opts.startCash);
    if (opts.startYear) params.set('startYear', opts.startYear);
    if (opts.exclude) params.set('exclude', opts.exclude);
    if (opts.only) params.set('only', opts.only);
    if (opts.noCashOnBuy) params.set('noCashOnBuy', 'true');
    return request(`/fund-history?${params}`);
  },
};
