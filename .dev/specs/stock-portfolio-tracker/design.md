# stock-portfolio-tracker - Design

## Overview

A client-server web application with a React SPA frontend and a Node.js/Express REST API backend. The backend handles data persistence (JSON files), proxies external API calls for stock prices and exchange rates, and serves the built frontend. All values are displayed in both USD and EUR using live exchange rates.

## Architecture

```
┌─────────────────────────────────┐
│         React Frontend          │
│  (SPA served by Express)        │
│                                 │
│  ┌───────────┐ ┌──────────────┐ │
│  │ Portfolio  │ │ Transaction  │ │
│  │ Dashboard  │ │ Form         │ │
│  ├───────────┤ ├──────────────┤ │
│  │ Line Chart │ │ Transaction  │ │
│  │ Pie Chart  │ │ List         │ │
│  └───────────┘ └──────────────┘ │
└──────────────┬──────────────────┘
               │ REST API
┌──────────────▼──────────────────┐
│       Express Backend           │
│                                 │
│  /api/transactions  (CRUD)      │
│  /api/portfolio     (summary)   │
│  /api/prices        (quotes)    │
│  /api/exchange-rate (USD/EUR)   │
└──────┬──────────┬───────────────┘
       │          │
  ┌────▼───┐ ┌───▼────────────┐
  │ JSON   │ │ External APIs  │
  │ Files  │ │ - Yahoo Finance│
  │        │ │ - Exchange Rate│
  └────────┘ └────────────────┘
```

### Component Responsibilities

- **React Frontend**: SPA with dashboard (portfolio summary, charts) and transaction management (add/view transactions)
- **Express Backend**: REST API, file I/O, external API proxy with caching
- **JSON Files**: Persistent storage for transactions and cached market data

## Implementation Details

### Frontend

- **Charting library**: Recharts (React-native charting, supports line and pie charts)
- **HTTP client**: fetch API (built-in, no extra dependency)
- **Routing**: React Router for dashboard vs. transaction views
- **Styling**: CSS modules or plain CSS — keep it simple

### Backend

- **Framework**: Express.js
- **File storage**: `fs/promises` with write-to-temp-then-rename for atomic writes
- **Price API**: Yahoo Finance via `yahoo-finance2` npm package
- **Exchange rate API**: Free endpoint (e.g. frankfurter.app or exchangerate.host)
- **Caching**: Price data cached in memory + JSON file, refreshed at most every 5 minutes

### Key Design Decisions

1. **No database**: JSON files keep the project simple and portable. Sufficient for a single-user app.
2. **Backend proxies all external APIs**: Frontend never calls Yahoo Finance or exchange rate APIs directly. This avoids CORS issues and allows server-side caching.
3. **Average cost basis**: All gain/loss calculations use average cost per share across all buy transactions.
4. **Dual currency everywhere**: Backend computes and returns both USD and EUR values. Frontend simply displays both.

## API Endpoints

### `GET /api/portfolio`
Returns portfolio summary: holdings, current prices, gain/loss per stock, totals, allocation percentages. All values in both USD and EUR.

### `GET /api/transactions`
Returns all transactions sorted by date (newest first). Supports optional `?ticker=AAPL` query param to filter by stock.

### `GET /api/portfolio/:ticker`
Returns detail for a single stock: all transactions, realized gain/loss per sell, and current holding summary.

### `POST /api/transactions`
Create a new buy or sell transaction.
Body: `{ type, ticker, quantity, pricePerShare, priceCurrency, commission, commissionCurrency, date }`

### `DELETE /api/transactions/:id`
Delete a transaction by ID.

### `GET /api/search?q=AAPL`
Searches Yahoo Finance for matching tickers. Returns array of `{ ticker, name, exchange }`. Used for ticker validation/autocomplete in the transaction form.

### `GET /api/prices?tickers=AAPL,MSFT`
Returns current prices for given tickers (proxied from Yahoo Finance).

### `GET /api/splits?ticker=NVDA`
Returns historical split events for a ticker from Yahoo Finance. Each split has `{ date, numerator, denominator, ratio, description }`. Cached in `data/splits.json`.

### `GET /api/exchange-rate`
Returns current USD/EUR exchange rate.

## Data Model

### Transaction (stored in `data/transactions.json`)
```json
{
  "id": "uuid",
  "type": "buy | sell",
  "ticker": "AAPL",
  "quantity": 10,
  "pricePerShare": 150.00,
  "priceCurrency": "USD",
  "commission": 4.95,
  "commissionCurrency": "EUR",
  "date": "2024-01-15",
  "createdAt": "2024-01-15T10:30:00Z"
}
```

### Price Cache (stored in `data/prices.json`)
```json
{
  "AAPL": {
    "price": 185.50,
    "currency": "USD",
    "fetchedAt": "2024-01-15T10:30:00Z"
  }
}
```

### Splits Cache (stored in `data/splits.json`)
```json
{
  "NVDA": {
    "splits": [
      { "date": "2021-07-20", "numerator": 4, "denominator": 1, "ratio": 4, "description": "4:1 Split" },
      { "date": "2024-06-10", "numerator": 10, "denominator": 1, "ratio": 10, "description": "10:1 Split" }
    ],
    "fetchedAt": "2024-01-15T10:30:00Z"
  }
}
```

### Exchange Rate Cache (stored in `data/exchange-rate.json`)
```json
{
  "rate": 0.92,
  "from": "USD",
  "to": "EUR",
  "fetchedAt": "2024-01-15T10:30:00Z"
}
```
