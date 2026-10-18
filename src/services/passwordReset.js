const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const RESET_COOLDOWN_MS = 60_000;

export const NEUTRAL_SUCCESS_MESSAGE =
  "Se este e-mail estiver cadastrado, você receberá em instantes um link para criar uma nova senha. Verifique também a caixa de spam.";

// Recuperação por celular só pode existir com telefone previamente vinculado e verificado
// no Firebase Authentication (provedor "phone"). Hoje o app usa apenas e-mail e senha;
// o número do perfil não é prova de identidade. Por isso a opção fica desativada.
export const PHONE_RECOVERY = Object.freeze({
  enabled: false,
  reason:
    "Disponível em breve. Exige um telefone previamente vinculado e verificado à sua conta pelo Firebase Authentication.",
});

export function validateResetEmail(value) {
  const email = String(value ?? "").trim();
  if (!email) return { valid: false, message: "Digite seu e-mail." };
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return { valid: false, message: "Digite um e-mail válido." };
  }
  return { valid: true, email };
}

// Nunca revela se a conta existe: usuário inexistente e e-mail inexistente viram o mesmo sucesso.
export function resetOutcomeFromError(error) {
  const code = error?.code || "";
  if (code === "auth/user-not-found") return { ok: true, message: NEUTRAL_SUCCESS_MESSAGE };
  if (code === "auth/invalid-email") return { ok: false, message: "Digite um e-mail válido." };
  if (code === "auth/too-many-requests") {
    return { ok: false, message: "Muitas tentativas. Aguarde alguns minutos e tente novamente." };
  }
  if (code === "auth/network-request-failed") {
    return { ok: false, message: "Falha de conexão. Verifique sua internet e tente novamente." };
  }
  if (code === "auth/unauthorized-continue-uri" || code === "auth/invalid-continue-uri") {
    return { ok: false, message: "Não foi possível enviar agora. Tente novamente mais tarde." };
  }
  return { ok: false, message: "Não foi possível enviar o e-mail agora. Tente novamente em instantes." };
}

/**
 * Envia o e-mail de redefinição pelo Firebase Authentication (link seguro; nenhuma senha é enviada).
 * `send` é injetado (sendPasswordResetEmail já ligado ao auth) para permitir testes sem rede.
 */
export async function requestPasswordReset(rawEmail, { send, lastSentAt = 0, now = Date.now() }) {
  const validation = validateResetEmail(rawEmail);
  if (!validation.valid) return { ok: false, message: validation.message };

  const wait = RESET_COOLDOWN_MS - (now - lastSentAt);
  if (lastSentAt && wait > 0) {
    return {
      ok: false,
      cooldown: true,
      message: `Aguarde ${Math.ceil(wait / 1000)} segundos antes de pedir um novo link.`,
    };
  }

  try {
    await send(validation.email);
    return { ok: true, sentAt: now, message: NEUTRAL_SUCCESS_MESSAGE };
  } catch (error) {
    const outcome = resetOutcomeFromError(error);
    return outcome.ok ? { ...outcome, sentAt: now } : outcome;
  }
}
