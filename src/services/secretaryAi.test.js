import assert from "node:assert/strict";
import test from "node:test";

import {
  SecretaryAiError,
  askSecretaryAi,
  resetSecretaryAiAvailability,
} from "./secretaryAi.js";

const respond = (status, body) => async () =>
  new Response(JSON.stringify(body), { status });
const options = (fetchImpl, token = "token-1") => ({
  fetchImpl,
  getIdToken: async () => token,
  endpoint: "/fn",
  enabled: true,
});

test("disabled by default: no token lookup and no network call", async () => {
  resetSecretaryAiAvailability();
  let touched = false;
  await assert.rejects(
    askSecretaryAi("oi", [], {
      fetchImpl: async () => { touched = true; },
      getIdToken: async () => { touched = true; return "t"; },
    }),
    (e) => e.fallback
  );
  assert.equal(touched, false);
});

test("sends the ID token and trimmed history, returns the answer", async () => {
  resetSecretaryAiAvailability();
  let seen;
  const result = await askSecretaryAi(
    "oi",
    Array.from({ length: 9 }, (_, i) => ({ role: "user", content: String(i) })),
    options(async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ answer: "Olá", remainingToday: 5 }), { status: 200 });
    })
  );
  assert.equal(result.answer, "Olá");
  assert.equal(seen.init.headers.Authorization, "Bearer token-1");
  assert.equal(JSON.parse(seen.init.body).history.length, 6);
});

test("falls back locally without a session, offline or on server errors", async () => {
  resetSecretaryAiAvailability();
  await assert.rejects(askSecretaryAi("oi", [], options(respond(200, {}), null)), (e) => e.fallback);
  await assert.rejects(
    askSecretaryAi("oi", [], options(async () => { throw new Error("offline"); })),
    (e) => e instanceof SecretaryAiError && e.fallback
  );
  for (const status of [502, 504]) {
    await assert.rejects(askSecretaryAi("oi", [], options(respond(status, {}))), (e) => e.fallback);
  }
});

test("shows messages (no fallback) for 401 and 429", async () => {
  resetSecretaryAiAvailability();
  await assert.rejects(askSecretaryAi("oi", [], options(respond(401, {}))), (e) => !e.fallback && e.status === 401);
  await assert.rejects(
    askSecretaryAi("oi", [], options(respond(429, { message: "Limite diário de perguntas atingido." }))),
    (e) => !e.fallback && /Limite/.test(e.message)
  );
});

test("remembers an unconfigured backend and skips further requests", async () => {
  resetSecretaryAiAvailability();
  let count = 0;
  const fetchImpl = async () => {
    count += 1;
    return new Response(JSON.stringify({ error: "not_configured" }), { status: 503 });
  };
  await assert.rejects(askSecretaryAi("oi", [], options(fetchImpl)), (e) => e.fallback);
  await assert.rejects(askSecretaryAi("oi", [], options(fetchImpl)), (e) => e.fallback);
  assert.equal(count, 1);
  resetSecretaryAiAvailability();
});
