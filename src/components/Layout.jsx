import { NavLink, Outlet } from "react-router-dom";
import { isFirestoreReadOnly } from "../firebase/writePolicy";

const menuItems = [
  { path: "/dashboard", icon: "📊", label: "Dashboard" },
  { path: "/clientes", icon: "👥", label: "Clientes" },
  { path: "/produtos", icon: "📦", label: "Produtos" },
  { path: "/vendas", icon: "💰", label: "Vendas" },
  { path: "/financeiro", icon: "💵", label: "Financeiro" },
  { path: "/fornecedores", icon: "🏢", label: "Fornecedores" },
  { path: "/inteligencia", icon: "👩‍💼", label: "Secretária RC" },
  { path: "/estoque", icon: "📋", label: "Estoque" },
];

export default function Layout() {
  const readOnly = isFirestoreReadOnly();

  return (
    <div className="app-layout">
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <img
            src="/icon-192.png"
            alt="Logo RC"
            className="sidebar-logo"
          />

          <div className="sidebar-brand-text">
            <strong>RC Manager</strong>
            <span>RC Confecções</span>
          </div>
        </div>

        <nav className="sidebar-menu">
          {menuItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `sidebar-link ${isActive ? "sidebar-link-active" : ""}`
              }
            >
              <span className="sidebar-icon">{item.icon}</span>
              <span className="sidebar-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="app-main">
        {readOnly && (
          <div
            role="status"
            style={{
              margin: "1rem 1.5rem 0",
              padding: "0.75rem 1rem",
              border: "1px solid #93c5fd",
              borderRadius: 8,
              background: "#eff6ff",
              color: "#1e3a8a",
            }}
          >
            Prévia somente leitura: operações de gravação no Firestore estão
            bloqueadas neste modo.
          </div>
        )}
        <div className="app-watermark" aria-hidden="true">
          <img src="/icon-512.png" alt="" />
        </div>

        <div className="app-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}