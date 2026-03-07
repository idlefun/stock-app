# stock-portfolio-tracker - Tasks

## Implementation Tasks

### Backend
- [x] **1.1**: Initialize Node.js project with Express and dependencies
- [x] **1.2**: Create data directory and JSON file utilities (atomic read/write)
- [x] **1.3**: Implement transaction API endpoints (GET, POST, DELETE /api/transactions)
- [x] **1.4**: Implement sell validation (cannot sell more than held)
- [x] **1.5**: Implement ticker search/validation endpoint (/api/search) via Yahoo Finance
- [x] **1.6**: Implement Yahoo Finance price fetching with caching (/api/prices)
- [x] **1.7**: Implement exchange rate fetching with caching (/api/exchange-rate)
- [x] **1.8**: Implement portfolio summary endpoint (/api/portfolio) with gain/loss calculations in USD and EUR
- [x] **1.9**: Serve React frontend static files from Express

### Frontend
- [x] **2.1**: Initialize React app (Vite + React)
- [x] **2.2**: Create app layout and routing (Dashboard, Transactions pages)
- [x] **2.3**: Build transaction entry form (buy/sell, ticker, date, price, price currency, quantity, commission, commission currency) with ticker validation/autocomplete
- [x] **2.4**: Build transaction list view with sorting
- [x] **2.5**: Build portfolio holdings table with current price, cost basis, gain/loss in USD and EUR
- [x] **2.6**: Build stock detail view showing all buy/sell transactions and realized gain/loss per sale
- [x] **2.7**: Build portfolio summary bar (total value, total gain/loss in USD and EUR)
- [x] **2.8**: Build performance-over-time line chart (Recharts)
- [x] **2.9**: Build portfolio allocation pie chart (Recharts)
- [x] **2.10**: Add stale-data indicators when API data is unavailable
- [x] **2.11**: Style the application (clean, functional CSS)

## Testing Tasks

- [x] **3.1**: Write backend unit tests for portfolio calculations (gain/loss, cost basis)
- [x] **3.2**: Write backend unit tests for transaction validation
- [x] **3.3**: Write API integration tests for all endpoints

## Documentation Tasks

- [x] **4.1**: Create README with setup and usage instructions
