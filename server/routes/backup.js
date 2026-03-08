const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const dataDir = path.join(__dirname, '..', '..', 'data');

const BACKUP_FILES = ['transactions.json', 'manual-prices.json', 'hist-prices.json'];

// GET /api/backup — download all user data as JSON
router.get('/', (req, res) => {
  const backup = {};
  for (const file of BACKUP_FILES) {
    const filePath = path.join(dataDir, file);
    try {
      backup[file] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      backup[file] = file === 'transactions.json' ? [] : {};
    }
  }
  backup._meta = { version: 1, createdAt: new Date().toISOString() };

  const filename = `stock-backup-${new Date().toISOString().split('T')[0]}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json(backup);
});

// POST /api/backup/restore — restore from backup JSON
router.post('/restore', (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Invalid backup data' });
  }

  const restored = [];
  const errors = [];

  for (const file of BACKUP_FILES) {
    if (data[file] != null) {
      const filePath = path.join(dataDir, file);
      try {
        fs.writeFileSync(filePath, JSON.stringify(data[file], null, 2));
        restored.push(file);
      } catch (err) {
        errors.push({ file, error: err.message });
      }
    }
  }

  if (errors.length > 0) {
    return res.status(500).json({ restored, errors });
  }
  res.json({ restored, message: `Restored ${restored.length} file(s)` });
});

module.exports = router;
