# Stock Portfolio Tracker

A browser-based stock portfolio tracker with dual currency support (USD/EUR). Track your stock purchases and sales, view live prices, and analyze portfolio performance with charts.

## Features

- Record buy/sell transactions with ticker validation via Yahoo Finance
- Live stock prices and USD/EUR exchange rates
- Portfolio dashboard with total cost, value, and gain/loss in both USD and EUR
- Per-stock detail view with realized gain/loss on sales
- Performance chart and allocation pie chart
- Simple JSON file storage (no database required)

## Prerequisites

- Node.js 20+
- npm

## Setup

### Backend

```bash
cd server
npm install
npm run dev    # starts on port 3001
```

### Frontend

```bash
cd client
npm install
npm run dev    # starts on port 5173, proxies API to 3001
```

Open http://localhost:5173 in your browser.

### Production

```bash
cd client && npm run build
cd ../server && npm start
```

The server serves the built frontend at http://localhost:3001.

## Running Tests

```bash
cd server
npm test
```

## Data Storage

All data is stored as JSON files in the `data/` directory:
- `transactions.json` — your buy/sell transactions
- `prices.json` — cached stock prices
- `exchange-rate.json` — cached USD/EUR exchange rate

## Tech Stack

- **Frontend**: React, React Router, Recharts, Vite
- **Backend**: Node.js, Express
- **Data**: Yahoo Finance API, Frankfurter API (exchange rates), JSON files
