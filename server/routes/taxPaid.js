const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const filePath = path.join(__dirname, '..', '..', 'data', 'tax-paid.json');

function load() {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return {}; }
}

function save(data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// GET /api/tax-paid — get all yearly tax paid
router.get('/', (req, res) => {
  res.json(load());
});

// PUT /api/tax-paid — set tax paid for a year { year, amount }
router.put('/', (req, res) => {
  const { year, amount } = req.body;
  if (!year) return res.status(400).json({ error: 'year required' });
  const data = load();
  data[year] = Number(amount) || 0;
  save(data);
  res.json(data);
});

module.exports = router;
