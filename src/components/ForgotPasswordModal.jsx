import { useEffect, useRef, useState } from "react";
import { sendPasswordResetEmail } from "firebase/auth";

import { auth } from "../firebase/config";
import { PHONE_RECOVERY, requestPasswordReset } from "../services/passwordReset";

export default function ForgotPasswordModal({ initialEmail = "", onClose }) {
  const [method, setMethod] = useState("email");
  const [email, setEmail] = useState(initialEmail);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const lastSentAt = useRef(0);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setFeedback(null);
    const result = await requestPasswordReset(email, {
      send: (address) => sendPasswordResetEmail(auth, address),
      lastSentAt: lastSentAt.current,
    });
    if (result.sentAt) lastSentAt.current = result.sentAt;
    setFeedback(result);
    setSending(false);
  }

  return (
    <div className="rc-reset-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="rc-reset-modal" role="dialog" aria-modal="true" aria-labelledby="rc-reset-title">
        <button type="button" className="rc-reset-close" onClick={onClose} aria-label="Fechar">
          ×
        </button>
        <h2 id="rc-reset-title">Recuperar acesso</h2>
        <p className="rc-reset-lead">
          Enviaremos um link seguro para você criar uma nova senha. Nenhuma senha é enviada por e-mail.
        </p>

        <div className="rc-reset-methods" role="tablist" aria-label="Forma de recuperação">
          <button type="button" role="tab" aria-selected={method === "email"} className={method === "email" ? "active" : ""} onClick={() => setMethod("email")}>
            ✉ E-mail
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={method === "phone"}
            className={method === "phone" ? "active" : ""}
            onClick={() => setMethod("phone")}
          >
            📱 Celular
          </button>
        </div>

        {method === "email" ? (
          <form onSubmit={handleSubmit} className="rc-reset-form" noValidate>
            <label className="rc-login-field">
              <span>E-mail da conta</span>
              <div className="rc-login-input-wrap">
                <span className="rc-login-input-icon">✉</span>
                <input
                  ref={inputRef}
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setFeedback(null);
                  }}
                  placeholder="Digite seu e-mail"
                  autoComplete="email"
                  inputMode="email"
                  disabled={sending}
                />
              </div>
            </label>

            {feedback && (
              <div className={`rc-login-alert ${feedback.ok ? "success" : "error"}`} role="status">
                {feedback.message}
              </div>
            )}

            <button type="submit" className="rc-login-submit" disabled={sending}>
              {sending ? "Enviando..." : "Enviar link de recuperação"}
            </button>
          </form>
        ) : (
          <div className="rc-reset-phone">
            <div className="rc-login-alert error rc-reset-neutral">
              Recuperação por celular indisponível no momento.
            </div>
            <p>{PHONE_RECOVERY.reason}</p>
            <button type="button" className="rc-login-submit" disabled>
              Enviar código por SMS
            </button>
            <button type="button" className="rc-reset-back" onClick={() => setMethod("email")}>
              Usar recuperação por e-mail
            </button>
          </div>
        )}

        <button type="button" className="rc-reset-back" onClick={onClose}>
          Voltar ao login
        </button>
      </section>
    </div>
  );
}
