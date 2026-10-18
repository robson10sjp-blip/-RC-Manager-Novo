import { NavLink, Outlet } from "react-router-dom";
import {
  LuLayoutDashboard,
  LuUsers,
  LuPackage,
  LuShoppingBag,
  LuWallet,
  LuBuilding2,
  LuSparkles,
  LuClipboardList,
} from "react-icons/lu";
import { isFirestoreReadOnly } from "../firebase/writePolicy";

const menuItems = [
  { path: "/dashboard", icon: LuLayoutDashboard, label: "Dashboard" },
  { path: "/clientes", icon: LuUsers, label: "Clientes" },
  { path: "/produtos", icon: LuPackage, label: "Produtos" },
  { path: "/vendas", icon: LuShoppingBag, label: "Vendas" },
  { path: "/financeiro", icon: LuWallet, label: "Financeiro" },
  { path: "/fornecedores", icon: LuBuilding2, label: "Fornecedores" },
  { path: "/inteligencia", icon: LuSparkles, label: "Secretária RC" },
  { path: "/estoque", icon: LuClipboardList, label: "Estoque" },
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
            <strong>RC Confecções</strong>
            <span>Premium</span>
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
              <span className="sidebar-icon">
                <item.icon aria-hidden="true" />
              </span>
              <span className="sidebar-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="app-main">
        {readOnly && (
          <div role="status" className="readonly-banner">
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