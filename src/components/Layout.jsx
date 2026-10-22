import { useEffect, useState } from "react";
import { Navigate, NavLink, Outlet, useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import {
  LuLayoutDashboard,
  LuUsers,
  LuPackage,
  LuShoppingBag,
  LuWallet,
  LuBuilding2,
  LuSparkles,
  LuClipboardList,
  LuEye,
  LuEyeOff,
} from "react-icons/lu";
import { auth } from "../firebase/config";
import { isFirestoreReadOnly } from "../firebase/writePolicy";
import { resolveAccess } from "../services/session";
import LogoutButton from "./LogoutButton.jsx";
import { useFinancialPrivacy } from "../context/financialPrivacy.js";

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
  const navigate = useNavigate();
  const { hidden, setHidden } = useFinancialPrivacy();
  const [session, setSession] = useState({ checking: true, user: null });

  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => setSession({ checking: false, user })),
    []
  );

  const access = resolveAccess(session);
  if (access === "wait") {
    return <div className="auth-checking" role="status">Verificando acesso...</div>;
  }
  if (access === "login") {
    return <Navigate to="/" replace />;
  }

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
          <button
            type="button"
            className="sidebar-link privacy-toggle"
            onClick={() => setHidden((current) => !current)}
            aria-pressed={!hidden}
            aria-label={hidden ? "Mostrar totais financeiros" : "Ocultar totais financeiros"}
            title={hidden ? "Mostrar totais financeiros" : "Ocultar totais financeiros"}
          >
            <span className="sidebar-icon">
              {hidden ? <LuEye aria-hidden="true" /> : <LuEyeOff aria-hidden="true" />}
            </span>
            <span className="sidebar-label">
              {hidden ? "Mostrar valores" : "Ocultar valores"}
            </span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <LogoutButton onSignedOut={() => navigate("/", { replace: true })} />
        </div>
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