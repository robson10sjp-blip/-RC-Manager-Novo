import { Routes, Route, Navigate } from "react-router-dom";

import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ClientsPage from "./pages/ClientsPage";
import ProductsPage from "./pages/ProductsPage";
import SalesPage from "./pages/SalesPage";
import StockPage from "./pages/StockPage";
import FinancePage from "./pages/FinancePage";
import IntelligencePage from "./pages/IntelligencePage";

import Layout from "./components/Layout";

function App() {
  return (
    <Routes>
      {/* Login */}
      <Route path="/" element={<LoginPage />} />

      {/* Área interna */}
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/clientes" element={<ClientsPage />} />
        <Route path="/produtos" element={<ProductsPage />} />
        <Route path="/vendas" element={<SalesPage />} />
        <Route path="/estoque" element={<StockPage />} />
        <Route path="/financeiro" element={<FinancePage />} />
        <Route path="/inteligencia" element={<IntelligencePage />} />
      </Route>

      {/* Qualquer outra rota */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default App;