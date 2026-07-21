import { NavLink, Outlet } from "react-router-dom";

const menuItems = [
  { path: "/dashboard", icon: "📊", label: "Dashboard" },
  { path: "/clientes", icon: "👥", label: "Clientes" },
  { path: "/produtos", icon: "📦", label: "Produtos" },
  { path: "/vendas", icon: "💰", label: "Vendas" },
  { path: "/financeiro", icon: "💵", label: "Financeiro" },
  { path: "/inteligencia", icon: "🧠", label: "Inteligência RC" },
  { path: "/estoque", icon: "📋", label: "Estoque" },
];

export default function Layout() {
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