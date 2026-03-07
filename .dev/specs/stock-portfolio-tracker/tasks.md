# stock-portfolio-tracker - Tasks

## Implementation Tasks

### Backend
- [x] **1.1**: Initialize Node.js project with Express and dependencies
- [x] **1.2**: Create data directory and JSON file utilities (atomic read/write)
- [x] **1.3**: Implement transaction API endpoints (GET, POST, PUT, DELETE /api/transactions)
- [x] **1.4**: Implement sell validation (cannot sell more than held)
- [x] **1.4a**: Add transaction sorting (date descending, then ticker alphabetically)
- [x] **1.4b**: Store EUR/USD exchange rate per transaction (user-provided or auto-fetched from Frankfurter API)
- [x] **1.5**: Implement ticker search/validation endpoint (/api/search) via Yahoo Finance
- [x] **1.6**: Implement Yahoo Finance price fetching with caching (/api/prices)
- [x] **1.7**: Implement EUR/USD exchange rate fetching with caching (/api/exchange-rate) via Frankfurter API
- [x] **1.8**: Implement portfolio summary endpoint (/api/portfolio) with gain/loss calculations in USD and EUR
- [x] **1.9**: Serve React frontend static files from Express

### Frontend
- [x] **2.1**: Initialize React app (Vite + React)
- [x] **2.2**: Create app layout and routing (Dashboard, Transactions pages)
- [x] **2.3**: Build transaction entry form (buy/sell, ticker, date, price, price currency, quantity, commission, commission currency, EUR/USD rate) with ticker validation/autocomplete and manual/delisted ticker support
- [x] **2.4**: Build transaction list view with sorting, inline editing, total cost column (EUR), and EUR/USD rate column
- [x] **2.5**: Build portfolio holdings table with current price, cost basis, gain/loss in EUR (primary) and USD (secondary), sortable columns, and split ratio badges
- [x] **2.6**: Build stock detail view showing all buy/sell transactions and realized gain/loss per sale
- [x] **2.7**: Build portfolio summary bar (total invested, holdings value, unrealized, realized, total gain/loss in EUR primary, USD secondary)
- [x] **2.8**: Build performance-over-time line chart (Recharts)
- [x] **2.9**: Build portfolio allocation pie chart (Recharts)
- [x] **2.10**: Add stale-data indicators when API data is unavailable
- [x] **2.11**: Style the application (clean, functional CSS)

## Testing Tasks

- [x] **3.1**: Write backend unit tests for portfolio calculations (gain/loss, cost basis)
- [x] **3.2**: Write backend unit tests for transaction validation
- [x] **3.3**: Write API integration tests for all endpoints

### Post-launch Enhancements
- [x] **5.1**: Change exchange rate direction from USD/EUR to EUR/USD
- [x] **5.2**: Support 7 decimal places for exchange rate input/display, strip trailing zeros
- [x] **5.3**: Add total cost column (including commission) in EUR to transaction list
- [x] **5.4**: Add column sorting to dashboard holdings table
- [x] **5.5**: Filter out fake splits (spinoff/restructuring adjustments) — only keep N:1 or 1:N ratios
- [x] **5.6**: Show cumulative split ratio badge on dashboard (relative to user's earliest transaction date)
- [x] **5.7**: Support editing transactions inline (all fields including exchange rate)
- [x] **5.8**: Support historical/delisted tickers with manual entry and optional company name

## Documentation Tasks

- [x] **4.1**: Create README with setup and usage instructions
