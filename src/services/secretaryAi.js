const DEFAULT_ENDPOINT = "/.netlify/functions/secretary-ai";
const FALLBACK_STATUSES = [404, 405, 502, 503, 504];

export class SecretaryAiError extends Error {
  constructor(message, { fallback = false, status = 0 } = {}) {
    super(message);
    this.name = "SecretaryAiError";
    this.fallback = fallback;
    this.status = status;
  }
}

// A IA fica desligada por padrão; só ativa com VITE_SECRETARY_AI_ENABLED=true.
export const isSecretaryAiEnabled = () =>
  import.meta.env?.VITE_SECRETARY_AI_ENABLED === "true";

let unavailable = false;

export function resetSecretaryAiAvailability() {
  unavailable = false;
}

async function defaultGetIdToken() {
  const { auth } = await import("../firebase/config.js");
  const user = auth?.currentUser;
  return user ? user.getIdToken() : null;
}

export async function askSecretaryAi(
  question,
  history = [],
  {
    fetchImpl = fetch,
    getIdToken = defaultGetIdToken,
    endpoint = DEFAULT_ENDPOINT,
    enabled = isSecretaryAiEnabled(),
  } = {}
) {
  if (!enabled || unavailable) throw new SecretaryAiError("IA indisponível", { fallback: true });

  const token = await getIdToken();
  if (!token) {
    throw new SecretaryAiError("Faça login para usar a assistente com IA.", {
      fallback: true,
    });
  }

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ question, history: history.slice(-6) }),
    });
  } catch {
    throw new SecretaryAiError("Sem conexão com a IA", { fallback: true });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.ok && payload?.answer) {
    return {
      answer: payload.answer,
      collections: payload.collections || null,
      remainingToday: payload.remainingToday,
    };
  }

  if (response.status === 404 || payload?.error === "not_configured") {
    unavailable = true;
  }
  if (response.status === 401) {
    throw new SecretaryAiError("Sua sessão expirou. Entre novamente para usar a IA.", {
      status: 401,
    });
  }
  if (response.status === 429) {
    throw new SecretaryAiError(
      payload?.message || "Limite de perguntas atingido. Tente mais tarde.",
      { status: 429 }
    );
  }
  throw new SecretaryAiError("A IA não respondeu", {
    fallback: FALLBACK_STATUSES.includes(response.status) || response.status >= 500,
    status: response.status,
  });
}
