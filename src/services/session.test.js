import assert from "node:assert/strict";
import test from "node:test";
import { SIGN_OUT_ERROR_MESSAGE, resolveAccess, signOutSafely } from "./session.js";

test("área protegida só libera com usuário autenticado", () => {
  assert.equal(resolveAccess({ checking: true, user: null }), "wait");
  assert.equal(resolveAccess({ checking: false, user: null }), "login");
  assert.equal(resolveAccess({ checking: false, user: {} }), "login");
  assert.equal(resolveAccess({ checking: false, user: { uid: "u1" } }), "allow");
});

test("após sair (usuário nulo) qualquer página protegida redireciona ao login", () => {
  const before = resolveAccess({ checking: false, user: { uid: "u1" } });
  const afterSignOut = resolveAccess({ checking: false, user: null });
  assert.equal(before, "allow");
  assert.equal(afterSignOut, "login");
});

test("signOutSafely chama apenas o signOut informado", async () => {
  let calls = 0;
  const result = await signOutSafely(async () => {
    calls += 1;
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 1);
});

test("falha ao sair devolve mensagem clara sem detalhes internos", async () => {
  const result = await signOutSafely(async () => {
    throw new Error("detalhe interno");
  });
  assert.equal(result.ok, false);
  assert.equal(result.message, SIGN_OUT_ERROR_MESSAGE);
});
