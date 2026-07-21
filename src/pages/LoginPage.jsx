import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";

import { auth } from "../firebase/config";
import "../styles/login-premium.css";

export default function LoginPage() {
  const navigate = useNavigate();

  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const isRegister = mode === "register";

  const buttonText = useMemo(() => {
    if (loading) {
      return isRegister ? "Criando conta..." : "Entrando...";
    }

    return isRegister ? "Cadastrar" : "Entrar";
  }, [isRegister, loading]);

  function updateField(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));

    setError("");
    setMessage("");
  }

  function changeMode(nextMode) {
    setMode(nextMode);
    setError("");
    setMessage("");
    setShowPassword(false);
    setShowConfirmPassword(false);
  }

  function translateAuthError(authError) {
    const code = authError?.code || "";

    const messages = {
      "auth/invalid-email": "Digite um e-mail válido.",
      "auth/missing-password": "Digite sua senha.",
      "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
      "auth/email-already-in-use": "Este e-mail já está cadastrado.",
      "auth/invalid-credential": "E-mail ou senha incorretos.",
      "auth/user-not-found": "Usuário não encontrado.",
      "auth/wrong-password": "E-mail ou senha incorretos.",
      "auth/too-many-requests":
        "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
      "auth/network-request-failed":
        "Falha de conexão. Verifique sua internet.",
    };

    return messages[code] || authError?.message || "Não foi possível concluir.";
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    const email = form.email.trim();
    const password = form.password;

    if (!email) {
      setError("Digite seu e-mail.");
      return;
    }

    if (!password) {
      setError("Digite sua senha.");
      return;
    }

    if (password.length < 6) {
      setError("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }

    if (isRegister) {
      if (!form.name.trim()) {
        setError("Digite seu nome.");
        return;
      }

      if (password !== form.confirmPassword) {
        setError("As senhas não são iguais.");
        return;
      }
    }

    try {
      setLoading(true);

      if (isRegister) {
        const credential = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );

        await updateProfile(credential.user, {
          displayName: form.name.trim(),
        });

        setMessage("Conta criada com sucesso!");
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }

      navigate("/dashboard", { replace: true });
    } catch (authError) {
      console.error("Erro de autenticação:", authError);
      setError(translateAuthError(authError));
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    setError("");
    setMessage("");

    const email = form.email.trim();

    if (!email) {
      setError("Digite seu e-mail primeiro.");
      return;
    }

    try {
      setLoading(true);
      await sendPasswordResetEmail(auth, email);
      setMessage("Enviamos o link de recuperação para seu e-mail.");
    } catch (authError) {
      console.error("Erro ao recuperar senha:", authError);
      setError(translateAuthError(authError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="rc-login-page">
      <div className="rc-login-light rc-login-light-one" />
      <div className="rc-login-light rc-login-light-two" />

      <section className="rc-login-card">
        <header className="rc-login-brand">
          <div className="rc-login-logo-shell">
            <img
              src="/icon-512.png"
              alt="Logo RC Confecções"
              className="rc-login-logo"
            />
          </div>

          <div className="rc-login-title-box">
            <h1>
              <span>RC</span> Manager
            </h1>
            <p>Sistema Inteligente de Gestão da RC Confecções</p>
          </div>
        </header>

        <div className="rc-login-tabs" role="tablist">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => changeMode("login")}
          >
            Entrar
          </button>

          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            onClick={() => changeMode("register")}
          >
            Cadastrar
          </button>
        </div>

        <form onSubmit={handleSubmit} className="rc-login-form">
          {isRegister && (
            <label className="rc-login-field">
              <span>Nome</span>
              <div className="rc-login-input-wrap">
                <span className="rc-login-input-icon">👤</span>
                <input
                  type="text"
                  name="name"
                  value={form.name}
                  onChange={updateField}
                  placeholder="Digite seu nome"
                  autoComplete="name"
                  disabled={loading}
                />
              </div>
            </label>
          )}

          <label className="rc-login-field">
            <span>E-mail</span>
            <div className="rc-login-input-wrap">
              <span className="rc-login-input-icon">✉</span>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={updateField}
                placeholder="Digite seu e-mail"
                autoComplete="email"
                disabled={loading}
              />
            </div>
          </label>

          <label className="rc-login-field">
            <span>Senha</span>
            <div className="rc-login-input-wrap">
              <span className="rc-login-input-icon">🔒</span>
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                value={form.password}
                onChange={updateField}
                placeholder="Digite sua senha"
                autoComplete={isRegister ? "new-password" : "current-password"}
                disabled={loading}
              />

              <button
                type="button"
                className="rc-login-eye"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? "🙈" : "👁"}
              </button>
            </div>
          </label>

          {isRegister && (
            <label className="rc-login-field">
              <span>Confirmar senha</span>
              <div className="rc-login-input-wrap">
                <span className="rc-login-input-icon">🔐</span>
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  name="confirmPassword"
                  value={form.confirmPassword}
                  onChange={updateField}
                  placeholder="Digite novamente sua senha"
                  autoComplete="new-password"
                  disabled={loading}
                />

                <button
                  type="button"
                  className="rc-login-eye"
                  onClick={() =>
                    setShowConfirmPassword((current) => !current)
                  }
                  aria-label={
                    showConfirmPassword
                      ? "Ocultar confirmação"
                      : "Mostrar confirmação"
                  }
                >
                  {showConfirmPassword ? "🙈" : "👁"}
                </button>
              </div>
            </label>
          )}

          {!isRegister && (
            <button
              type="button"
              className="rc-login-forgot"
              onClick={handleForgotPassword}
              disabled={loading}
            >
              Esqueci minha senha
            </button>
          )}

          {error && <div className="rc-login-alert error">{error}</div>}
          {message && <div className="rc-login-alert success">{message}</div>}

          <button
            type="submit"
            className="rc-login-submit"
            disabled={loading}
          >
            <span>{isRegister ? "➕" : "↪"}</span>
            {buttonText}
          </button>
        </form>

        <div className="rc-login-security">
          <span>◇</span>
          <p>Seus dados ficam seguros e protegidos na nuvem.</p>
        </div>

        <footer className="rc-login-footer">
          <img src="/icon-192.png" alt="" />
          <span>© RC Confecções • Todos os direitos reservados</span>
        </footer>
      </section>
    </main>
  );
}
