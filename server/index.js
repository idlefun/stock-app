const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/portfolio', require('./routes/portfolio'));
app.use('/api/prices', require('./routes/prices'));
app.use('/api/search', require('./routes/search'));
app.use('/api/exchange-rate', require('./routes/exchangeRate'));
app.use('/api/splits', require('./routes/splits'));
app.use('/api/tax', require('./routes/tax'));
app.use('/api/fund-history', require('./routes/fundHistory'));

// Serve React frontend in production
const clientBuildPath = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientBuildPath));
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
