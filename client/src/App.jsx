import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import StockDetail from './pages/StockDetail';
import Tax from './pages/Tax';
import Fund from './pages/Fund';
import Backup from './pages/Backup';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <header className="app-header">
          <h1>Aisling is cool</h1>
          <nav>
            <NavLink to="/" end>Dashboard</NavLink>
            <NavLink to="/transactions">Transactions</NavLink>
            <NavLink to="/tax">Tax</NavLink>
            <NavLink to="/fund">Fund</NavLink>
            <NavLink to="/backup">Backup</NavLink>
          </nav>
        </header>
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/stock/:ticker" element={<StockDetail />} />
            <Route path="/tax" element={<Tax />} />
            <Route path="/fund" element={<Fund />} />
            <Route path="/backup" element={<Backup />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
