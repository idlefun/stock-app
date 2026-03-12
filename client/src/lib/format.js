export function formatUSD(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

export function formatEUR(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value);
}

export function formatPct(value) {
  if (value == null) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatDate(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

export function calcTotalCostEUR(t) {
  const rate = t.exchangeRate || 1;
  if (t.type === 'dividend') {
    const grossEUR = t.dividendCurrency === 'EUR' ? t.dividendAmount : t.dividendAmount / rate;
    return grossEUR - (t.taxPaid || 0);
  }
  const costEUR = t.priceCurrency === 'EUR'
    ? t.pricePerShare * t.quantity
    : (t.pricePerShare * t.quantity) / rate;
  const commEUR = t.commission > 0
    ? (t.commissionCurrency === 'EUR' ? t.commission : t.commission / rate)
    : 0;
  if (t.type === 'sell') return costEUR - commEUR;
  return costEUR + commEUR;
}
