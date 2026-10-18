import assert from "node:assert/strict";
import test from "node:test";
import {
  NEUTRAL_SUCCESS_MESSAGE,
  PHONE_RECOVERY,
  RESET_COOLDOWN_MS,
  requestPasswordReset,
  validateResetEmail,
} from "./passwordReset.js";

const okSender = () => {
  const sent = [];
  return { sent, send: async (email) => sent.push(email) };
};

test("valida o e-mail antes de qualquer envio", async () => {
  for (const bad of ["", "   ", "abc", "a@b", "a b@c.com", "@x.com"]) {
    const { send, sent } = okSender();
    const result = await requestPasswordReset(bad, { send });
    assert.equal(result.ok, false, bad);
    assert.equal(sent.length, 0, bad);
  }
  assert.equal(validateResetEmail(" ana@exemplo.com ").email, "ana@exemplo.com");
});

test("envia o e-mail de redefinição e mostra mensagem neutra", async () => {
  const { send, sent } = okSender();
  const result = await requestPasswordReset(" ana@exemplo.com ", { send });
  assert.deepEqual(sent, ["ana@exemplo.com"]);
  assert.equal(result.ok, true);
  assert.equal(result.message, NEUTRAL_SUCCESS_MESSAGE);
  assert.doesNotMatch(result.message, /senha é|sua senha:/i);
});

test("conta inexistente tem a mesma resposta de uma conta existente", async () => {
  const existing = await requestPasswordReset("a@b.com", { send: async () => {} });
  const missing = await requestPasswordReset("a@b.com", {
    send: async () => {
      throw { code: "auth/user-not-found" };
    },
  });
  assert.equal(missing.ok, true);
  assert.equal(missing.message, existing.message);
});

test("erros de rede, limite e desconhecidos têm mensagem clara sem detalhes internos", async () => {
  for (const [code, pattern] of [
    ["auth/network-request-failed", /conexão/],
    ["auth/too-many-requests", /Muitas tentativas/],
    ["auth/internal-error", /Não foi possível enviar/],
  ]) {
    const result = await requestPasswordReset("a@b.com", {
      send: async () => {
        throw { code, message: "detalhe interno secreto" };
      },
    });
    assert.equal(result.ok, false, code);
    assert.match(result.message, pattern);
    assert.doesNotMatch(result.message, /secreto/);
  }
});

test("impede reenvios em sequência (intervalo mínimo)", async () => {
  const { send, sent } = okSender();
  const now = 1_000_000;
  const blocked = await requestPasswordReset("a@b.com", { send, lastSentAt: now - 5_000, now });
  assert.equal(blocked.cooldown, true);
  assert.equal(sent.length, 0);
  const allowed = await requestPasswordReset("a@b.com", { send, lastSentAt: now - RESET_COOLDOWN_MS - 1, now });
  assert.equal(allowed.ok, true);
  assert.equal(sent.length, 1);
});

test("recuperação por celular permanece desativada sem fluxo verificado", () => {
  assert.equal(PHONE_RECOVERY.enabled, false);
  assert.match(PHONE_RECOVERY.reason, /verificado/);
});
