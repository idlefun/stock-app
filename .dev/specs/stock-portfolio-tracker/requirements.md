# stock-portfolio-tracker - Requirements

## Introduction

A browser-based stock portfolio tracker for a single user. The application allows the user to record stock purchases and sales, fetches live price data via a free API, and displays performance metrics in both USD and EUR. Data is stored in local text files (JSON). The UI provides charts and allocation views for advanced portfolio analysis.

## Requirements

### Requirement 1: Transaction Management

**User Story:** As a user, I want to enter stock purchases and sales, so that I can keep an accurate record of my portfolio activity.

#### Acceptance Criteria

1. WHEN the user enters a ticker symbol THE SYSTEM SHALL validate it against the Yahoo Finance API
2. IF the ticker matches exactly one stock THEN THE SYSTEM SHALL auto-confirm the ticker and display the stock name
3. IF the ticker matches multiple stocks THEN THE SYSTEM SHALL display the matching options (ticker + company name + exchange) for the user to select
4. IF the ticker matches no stocks THEN THE SYSTEM SHALL display an error indicating the ticker is invalid
5. WHEN the user submits a buy transaction with validated ticker, date, price per share, price currency (USD or EUR), quantity, commission amount, and commission currency (USD or EUR) THE SYSTEM SHALL store the transaction in the local JSON data file
6. WHEN the user submits a sell transaction with ticker symbol, date, price per share, price currency (USD or EUR), quantity, commission amount, and commission currency (USD or EUR) THE SYSTEM SHALL store the transaction and reduce the held quantity for that stock
7. IF the user attempts to sell more shares than currently held THEN THE SYSTEM SHALL display an error and reject the transaction
8. WHEN a transaction is successfully recorded THE SYSTEM SHALL update the portfolio view to reflect the new state
9. WHEN the user views the transaction list THE SYSTEM SHALL display all transactions sorted by date (newest first), with same-date transactions sorted alphabetically by ticker
10. WHEN the user edits a transaction THE SYSTEM SHALL allow updating all fields (type, ticker, date, price, currency, quantity, commission, exchange rate)
11. WHEN the user checks the "Historical / delisted" checkbox THE SYSTEM SHALL allow manual ticker entry without Yahoo Finance validation and optionally accept a company name
12. WHEN a transaction involves USD currency THE SYSTEM SHALL store the EUR/USD exchange rate, either user-provided or auto-fetched for that date from the Frankfurter API
13. WHEN the user views the transaction list THE SYSTEM SHALL display a Total Cost column in EUR (price × quantity + commission, converted using the transaction's exchange rate)

### Requirement 2: Live Price Data

**User Story:** As a user, I want current stock prices fetched automatically, so that I can see up-to-date portfolio performance.

#### Acceptance Criteria

1. WHEN the portfolio view is loaded THE SYSTEM SHALL fetch current prices for all held stocks from a free API (Yahoo Finance)
2. WHEN the API returns price data THE SYSTEM SHALL display the current price alongside the user's cost basis
3. IF the price API is unavailable THEN THE SYSTEM SHALL display the last known price with a stale-data indicator
4. WHEN price data is fetched THE SYSTEM SHALL cache it locally to reduce redundant API calls

### Requirement 3: Dual Currency Display (USD/EUR)

**User Story:** As a user, I want to see all values in both USD and EUR, so that I can understand my portfolio in both currencies.

#### Acceptance Criteria

1. WHEN portfolio values are displayed THE SYSTEM SHALL show amounts in EUR (primary) and USD (secondary)
2. WHEN the portfolio view is loaded THE SYSTEM SHALL fetch the current EUR/USD exchange rate from the Frankfurter API
3. IF the exchange rate API is unavailable THEN THE SYSTEM SHALL use the last known exchange rate with a stale-data indicator
4. WHEN the user enters a transaction THE SYSTEM SHALL allow specifying the transaction currency (USD or EUR)
5. WHEN displaying EUR values THE SYSTEM SHALL use Irish EUR format (en-IE locale)
6. WHEN displaying dates THE SYSTEM SHALL use dd/mm/yyyy format
7. WHEN displaying exchange rates THE SYSTEM SHALL support up to 7 decimal places and strip trailing zeros

### Requirement 4: Portfolio Performance Metrics

**User Story:** As a user, I want to see detailed performance metrics, so that I can evaluate how my investments are doing.

#### Acceptance Criteria

1. WHEN the user views the portfolio THE SYSTEM SHALL display overall portfolio total invested, holdings value, unrealized gains, realized gains, and total gain/loss in EUR (primary) and USD (secondary)
2. WHEN the user views the portfolio THE SYSTEM SHALL display for each stock: ticker, company name, quantity held, invested, holdings value, unrealized, realized, total gain, and allocation percentage
3. WHEN the user clicks on a column header in the holdings table THE SYSTEM SHALL sort the table by that column, toggling between ascending and descending order
4. WHEN the user clicks on a stock in the portfolio view THE SYSTEM SHALL display a detail view showing all buy and sell transactions for that stock, with date, type, quantity, price, commission, and realized gain/loss for each sell transaction in both USD and EUR
5. WHEN the user views the portfolio THE SYSTEM SHALL display a performance-over-time line chart showing portfolio value history
6. WHEN the user views the portfolio THE SYSTEM SHALL display a portfolio allocation pie chart showing the percentage weight of each stock
7. WHEN gain/loss is calculated THE SYSTEM SHALL use the average cost basis method
8. WHEN gain/loss is calculated THE SYSTEM SHALL include commission costs in the cost basis (added to buy cost, subtracted from sell proceeds)

### Requirement 5: Stock Split Adjustments

**User Story:** As a user, I want my historical transactions to automatically account for stock splits, so that my portfolio quantities and cost basis are accurate.

#### Acceptance Criteria

1. WHEN the portfolio is loaded THE SYSTEM SHALL fetch historical stock split data from Yahoo Finance for all held tickers
2. WHEN a transaction predates one or more stock splits THE SYSTEM SHALL calculate a cumulative split multiplier and display the split-adjusted quantity and split-adjusted cost per share
3. WHEN the user views the portfolio holdings THE SYSTEM SHALL display the current (split-adjusted) quantity held
4. WHEN the user views the stock detail THE SYSTEM SHALL display both the original transaction quantity/price and the split-adjusted quantity/price for each transaction
5. WHEN split data is fetched THE SYSTEM SHALL cache it locally to reduce redundant API calls
6. WHEN processing split data THE SYSTEM SHALL filter out non-real splits (spinoff/restructuring adjustments) by only keeping splits where the numerator or denominator is 1
7. WHEN the user views the portfolio holdings THE SYSTEM SHALL display a split badge next to tickers that have splits, showing the cumulative ratio relative to the user's earliest transaction date

### Requirement 6: Text-File Based Storage

**User Story:** As a user, I want my data stored in simple text files, so that the data is portable and easy to back up.

#### Acceptance Criteria

1. THE SYSTEM SHALL store all transaction data in a JSON file on the local filesystem
2. THE SYSTEM SHALL store cached price data in a separate JSON file
3. WHEN the application starts AND no data files exist THE SYSTEM SHALL create empty data files automatically
4. WHILE writing data files THE SYSTEM SHALL use atomic writes to prevent data corruption

### Requirement 7: Non-Functional Requirements

**User Story:** As a user, I want a responsive and reliable application, so that I can manage my portfolio efficiently.

#### Acceptance Criteria

1. THE SYSTEM SHALL render the portfolio view within 2 seconds of page load
2. THE SYSTEM SHALL work in modern browsers (Chrome, Firefox, Edge)
3. WHILE the application is running THE SYSTEM SHALL serve the frontend as a single-page application from the Node.js backend

## Constraints

- Single user, single portfolio — no authentication required
- Data stored as local JSON files (no database)
- Stock prices fetched from free Yahoo Finance API (no paid API keys)
- Exchange rates fetched from Frankfurter API (EUR/USD direction, i.e. what 1 EUR is worth in USD)
- Tech stack: React frontend, Node.js/Express backend
- Must work in modern browsers (Chrome, Firefox, Edge)
