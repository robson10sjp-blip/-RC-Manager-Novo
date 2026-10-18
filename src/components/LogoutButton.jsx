import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LuLogOut } from "react-icons/lu";
import { signOut } from "firebase/auth";

import { auth } from "../firebase/config";
import { signOutSafely } from "../services/session";

export default function LogoutButton({ onSignedOut }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus();
    const onKey = (event) => event.key === "Escape" && !busy && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  async function confirmSignOut() {
    if (busy) return;
    setBusy(true);
    setError("");
    const result = await signOutSafely(() => signOut(auth));
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setOpen(false);
    onSignedOut();
  }

  return (
    <>
      <button type="button" className="sidebar-logout" onClick={() => setOpen(true)}>
        <span className="sidebar-icon">
          <LuLogOut aria-hidden="true" />
        </span>
        <span className="sidebar-label">Sair do sistema</span>
      </button>

      {open &&
        createPortal(
          <div className="logout-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && setOpen(false)}>
            <div className="logout-dialog" role="alertdialog" aria-modal="true" aria-labelledby="logout-title">
              <span className="logout-dialog-icon" aria-hidden="true">
                <LuLogOut />
              </span>
              <h2 id="logout-title">Deseja realmente sair do sistema?</h2>
              {error && (
                <p className="logout-dialog-error" role="alert">
                  {error}
                </p>
              )}
              <div className="logout-dialog-actions">
                <button type="button" ref={cancelRef} className="logout-cancel" onClick={() => setOpen(false)} disabled={busy}>
                  Cancelar
                </button>
                <button type="button" className="logout-confirm" onClick={confirmSignOut} disabled={busy}>
                  {busy ? "Saindo..." : "Sair"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
