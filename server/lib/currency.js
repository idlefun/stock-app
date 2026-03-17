function toEUR(amount, currency, rate) {
  if (currency === 'EUR') return amount;
  return amount / rate;
}

function toUSD(amount, currency, rate) {
  if (currency === 'USD') return amount;
  return amount * rate;
}

module.exports = { toEUR, toUSD };
