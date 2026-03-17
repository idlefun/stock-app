const fs = require('fs');
const path = require('path');

const taxPaidPath = path.join(__dirname, '..', '..', 'data', 'tax-paid.json');

function loadTaxPaid() {
  try { return JSON.parse(fs.readFileSync(taxPaidPath, 'utf8')); } catch { return {}; }
}

module.exports = { loadTaxPaid };
