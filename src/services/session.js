// Decide o que a área protegida deve fazer, sem depender do React (testável em Node).
export function resolveAccess({ checking, user }) {
  if (checking) return "wait";
  return user?.uid ? "allow" : "login";
}

export const SIGN_OUT_ERROR_MESSAGE =
  "Não foi possível encerrar a sessão agora. Verifique sua conexão e tente novamente.";

// Encerra a sessão apenas no Firebase Authentication; nunca toca no Firestore.
export async function signOutSafely(signOutFn) {
  try {
    await signOutFn();
    return { ok: true };
  } catch {
    return { ok: false, message: SIGN_OUT_ERROR_MESSAGE };
  }
}
