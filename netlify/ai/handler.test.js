import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import test from "node:test";

import { handleSecretaryRequest } from "./handler.js";
import { createMemoryStore } from "./rateLimit.js";
import { runTool, createToolContext, ToolInputError } from "./tools.js";

const PROJECT = "rc-test";
const NOW = Date.UTC(2026, 9, 18, 15, 0, 0);
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const certificates = { kid1: publicKey.export({ type: "spki", format: "pem" }) };
const getCertificates = async () => certificates;

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function makeToken(overrides = {}, kid = "kid1", key = privateKey) {
  const header = b64({ alg: "RS256", kid, typ: "JWT" });
  const payload = b64({
    aud: PROJECT,
    iss: `https://securetoken.google.com/${PROJECT}`,
    sub: "user-1",
    iat: Math.floor(NOW / 1000) - 60,
    exp: Math.floor(NOW / 1000) + 3600,
    ...overrides,
  });
  const signature = createSign("RSA-SHA256")
    .update(`${header}.${payload}`)
    .sign(key)
    .toString("base64url");
  return `${header}.${payload}.${signature}`;
}

const str = (stringValue) => ({ stringValue });
const num = (doubleValue) => ({ doubleValue });
const docs = {
  clients: [
    {
      id: "c1",
      fields: {
        name: str("Ana Souza"),
        city: str("Xinguara - PA"),
        totalDebt: num(0),
        cpf: str("123.456.789-00"),
        phone: str("(94) 99999-0000"),
        address: str("Rua Secreta 10"),
      },
    },
  ],
  sales: [
    {
      id: "s1",
      fields: {
        clientId: str("c1"),
        total: num(500),
        amountPaid: num(100),
        pendingAmount: num(400),
        tripNumber: num(4),
        saleDate: str("2026-10-05"),
        dueDate: str("2026-10-10"),
        balanceModel: str("per-sale"),
        clientPhone: str("(94) 98888-0000"),
      },
    },
  ],
  products: [],
  expenses: [],
  suppliers: [{ id: "f1", fields: { name: str("Fornecedor X"), cnpj: str("00.000.000/0001-00") } }],
  payables: [],
};

function makeFetch({ openai, firestoreStatus = 200 } = {}) {
  const calls = { firestore: [], openai: [] };
  const script = [...(openai || [])];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith("https://firestore.googleapis.com/")) {
      calls.firestore.push({ url: target, method: options.method });
      if (firestoreStatus !== 200) return new Response("{}", { status: firestoreStatus });
      const name = target.split("?")[0].split("/").pop();
      return new Response(JSON.stringify({ documents: (docs[name] || []).map((d) => ({ name: `x/${d.id}`, fields: d.fields })) }), { status: 200 });
    }
    if (target.startsWith("https://api.openai.com/")) {
      calls.openai.push(JSON.parse(options.body));
      const next = script.shift();
      if (next instanceof Error) throw next;
      if (typeof next === "number") return new Response("{}", { status: next });
      return new Response(JSON.stringify({ choices: [{ message: next }] }), { status: 200 });
    }
    throw new Error(`unexpected url ${target}`);
  };
  return { fetchImpl, calls };
}

const env = {
  SECRETARY_AI_ENABLED: "true",
  OPENAI_API_KEY: "test-key-not-real",
  FIREBASE_PROJECT_ID: PROJECT,
};
const request = (body, { token = makeToken(), method = "POST" } = {}) =>
  new Request("https://example.test/fn", {
    method,
    headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : {},
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
const call = (id, name, args) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const run = (req, extra = {}) =>
  handleSecretaryRequest(req, {
    env,
    store: createMemoryStore(),
    now: () => NOW,
    getCertificates,
    ...extra,
  });

test("rejects missing, malformed, forged and expired tokens without touching Firestore or OpenAI", async () => {
  const { fetchImpl, calls } = makeFetch();
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const cases = [
    null,
    "abc",
    makeToken({}, "kid1", other),
    makeToken({ exp: Math.floor(NOW / 1000) - 10 }),
    makeToken({ aud: "outro-projeto" }),
  ];
  for (const token of cases) {
    const response = await run(request({ question: "oi" }, { token }), { fetchImpl });
    assert.equal(response.status, 401);
  }
  assert.equal(calls.firestore.length + calls.openai.length, 0);
});

test("returns 503 when not configured and 405 for other methods", async () => {
  const { fetchImpl } = makeFetch();
  const unconfigured = await run(request({ question: "oi" }), { fetchImpl, env: {} });
  assert.equal(unconfigured.status, 503);
  assert.equal((await unconfigured.json()).error, "not_configured");
  const disabled = await run(request({ question: "oi" }), {
    fetchImpl,
    env: { ...env, SECRETARY_AI_ENABLED: "false" },
  });
  assert.equal(disabled.status, 503);
  const get = await run(request(null, { method: "GET" }), { fetchImpl });
  assert.equal(get.status, 405);
});

test("validates the body size and shape", async () => {
  const { fetchImpl } = makeFetch();
  assert.equal((await run(request({ question: "" }), { fetchImpl })).status, 400);
  assert.equal((await run(request({ question: "x".repeat(501) }), { fetchImpl })).status, 400);
  assert.equal((await run(request({ question: "oi", history: [{ role: "system", content: "x" }] }), { fetchImpl })).status, 400);
  assert.equal((await run(request({ question: "oi", history: "x" }), { fetchImpl })).status, 400);
  assert.equal((await run(request({ question: "oi", pad: "x".repeat(21000) }), { fetchImpl })).status, 413);
});

test("answers via tool call, reads only the token user's collections with GET, and sends no personal data to OpenAI", async () => {
  const { fetchImpl, calls } = makeFetch({
    openai: [
      { role: "assistant", content: null, tool_calls: [call("t1", "listar_cobrancas", { viagem: "4", foco: "hoje" })] },
      { role: "assistant", content: "Cobre a Ana Souza." },
    ],
  });
  const response = await run(request({ question: "Quem devo cobrar hoje na 4ª viagem?" }), { fetchImpl });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.answer, "Cobre a Ana Souza.");
  assert.equal(body.remainingToday, 59);
  assert.equal(body.collections.report.overdue.count, 1);
  assert.equal(body.collections.focusToday, true);

  assert.ok(calls.firestore.length > 0);
  for (const entry of calls.firestore) {
    assert.equal(entry.method, "GET");
    assert.match(entry.url, /\/users\/user-1\//);
  }

  const sent = JSON.stringify(calls.openai);
  for (const secret of ["123.456.789-00", "99999-0000", "98888-0000", "Rua Secreta", "00.000.000/0001-00", "test-key-not-real"]) {
    assert.ok(!sent.includes(secret), `leaked ${secret}`);
  }
  assert.ok(sent.includes("Ana Souza"));
  assert.ok(!JSON.stringify(body).includes("test-key-not-real"));
});

test("ignores a uid supplied by the model or client", async () => {
  const { fetchImpl, calls } = makeFetch({
    openai: [
      { role: "assistant", content: null, tool_calls: [call("t1", "resumo_pendente_por_viagem", { uid: "victim", path: "users/victim" })] },
      { role: "assistant", content: "ok" },
    ],
  });
  const response = await run(request({ question: "pendente", uid: "victim" }), { fetchImpl });
  assert.equal(response.status, 200);
  assert.ok(calls.firestore.every((c) => !c.url.includes("victim")));
});

test("enforces 5 per minute and 60 per day", async () => {
  const store = createMemoryStore();
  const answer = { role: "assistant", content: "ok" };
  const { fetchImpl } = makeFetch({ openai: Array(10).fill(answer) });
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await run(request({ question: "oi" }), { fetchImpl, store })).status, 200);
  }
  const limited = await run(request({ question: "oi" }), { fetchImpl, store });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);

  const dayStore = createMemoryStore();
  const dayEnv = { ...env, AI_RATE_PER_MINUTE: "100", AI_DAILY_LIMIT: "3" };
  const ok = makeFetch({ openai: Array(10).fill(answer) });
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await run(request({ question: "oi" }), { fetchImpl: ok.fetchImpl, store: dayStore, env: dayEnv })).status, 200);
  }
  const daily = await run(request({ question: "oi" }), { fetchImpl: ok.fetchImpl, store: dayStore, env: dayEnv });
  assert.equal(daily.status, 429);
  assert.match((await daily.json()).message, /diário/);
});

test("fails closed when the usage store is broken", async () => {
  const { fetchImpl, calls } = makeFetch();
  const store = { get: async () => { throw new Error("down"); }, set: async () => {} };
  const response = await run(request({ question: "oi" }), { fetchImpl, store });
  assert.equal(response.status, 503);
  assert.equal(calls.openai.length, 0);
});

test("maps provider, data and timeout failures to safe errors", async () => {
  let r = await run(request({ question: "oi" }), { fetchImpl: makeFetch({ openai: [500] }).fetchImpl });
  assert.equal(r.status, 502);
  r = await run(request({ question: "oi" }), { fetchImpl: makeFetch({ openai: [429] }).fetchImpl });
  assert.equal(r.status, 503);
  r = await run(request({ question: "oi" }), {
    fetchImpl: makeFetch({
      firestoreStatus: 403,
      openai: [{ role: "assistant", content: null, tool_calls: [call("t", "resumo_pendente_por_viagem", {})] }],
    }).fetchImpl,
  });
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error, "data_unavailable");

  const hang = (url, options) =>
    new Promise((_, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
  r = await run(request({ question: "oi" }), { fetchImpl: hang, env: { ...env, AI_TIMEOUT_MS: "30" } });
  assert.equal(r.status, 504);
});

test("stops after the maximum number of tool rounds", async () => {
  const loop = { role: "assistant", content: null, tool_calls: [call("t", "resumo_pendente_por_viagem", {})] };
  const { fetchImpl, calls } = makeFetch({ openai: Array(10).fill(loop) });
  const response = await run(request({ question: "oi" }), { fetchImpl });
  assert.equal(response.status, 502);
  assert.equal(calls.openai.length, 4);
});

test("tools reject invalid arguments and never expose contact data", () => {
  const data = {
    clients: [{ id: "c1", name: "Ana Souza", city: "Xinguara" }],
    sales: [], products: [], expenses: [], suppliers: [], payables: [],
  };
  const context = createToolContext(data, new Date(NOW));
  assert.throws(() => runTool("listar_cobrancas", { viagem: "9" }, context), ToolInputError);
  assert.throws(() => runTool("apagar_tudo", {}, context), ToolInputError);
  assert.throws(() => runTool("listar_cobrancas", "{bad", context), ToolInputError);
  assert.throws(() => runTool("consultar_cliente", { nome: "a" }, context), ToolInputError);
  const { result } = runTool("consultar_cliente", { nome: "ana" }, context);
  assert.equal(result.clientes[0].cliente, "Ana Souza");
  assert.ok(!/cpf|telefone|phone|endereco/i.test(JSON.stringify(result)));
});

test("collections tool matches the system calculation (partial payments, paid sales, estimated due date)", async () => {
  const context = createToolContext(
    {
      clients: [{ id: "c1", name: "Ana", city: "Xinguara - PA" }],
      sales: [
        { id: "a", clientId: "c1", tripNumber: 4, total: 500, amountPaid: 100, pendingAmount: 400, saleDate: "2026-10-05", dueDate: "2026-10-10", balanceModel: "per-sale" },
        { id: "b", clientId: "c1", tripNumber: 4, total: 300, amountPaid: 300, pendingAmount: 0, saleDate: "2026-10-05", dueDate: "2026-10-01", balanceModel: "per-sale" },
      ],
      products: [], expenses: [], suppliers: [], payables: [],
    },
    new Date(NOW)
  );
  const { result } = runTool("listar_cobrancas", { viagem: "4" }, context);
  assert.equal(result.vencidas.quantidade, 1);
  assert.equal(result.vencidas.total, 400);
  assert.equal(result.vencidas.itens[0].dias_de_atraso, 8);
});

test("existing report tools separate annual IDs and refuse ambiguous travel numbers", () => {
  const context = createToolContext({
    clients: [], products: [], expenses: [], suppliers: [], payables: [],
    sales: [
      { id: "a", saleDate: "2026-10-01", tripId: "2026-four", total: 100, amountPaid: 10 },
      { id: "b", saleDate: "2027-10-01", tripId: "2027-four", total: 300, amountPaid: 20 },
      { id: "no-trip", clientId: "c", total: 900, amountPaid: 0 },
    ],
  });
  assert.throws(() => runTool("resumo_vendas", { viagem: "4" }, context), /ambígua/);
  assert.equal(runTool("resumo_vendas", { viagem: "4", ano: 2027 }, context).result.total_vendido, 300);
  assert.equal(runTool("listar_cobrancas", { viagem: "4", ano: 2026 }, context).result.sem_vencimento_confiavel.total, 90);
  assert.equal(runTool("resumo_vendas", { viagem: "todas" }, context).result.total_vendido, 1300);
  assert.equal(runTool("resumo_vendas", { viagem: "todas", ano: 2026 }, context).result.total_vendido, 100);
  assert.equal(runTool("resumo_vendas", { viagem: "todas", ano: 2027 }, context).result.total_vendido, 300);
  assert.equal(runTool("resumo_vendas", { viagem: "todas", ano: 2025 }, context).result.total_vendido, 0);
  assert.throws(() => runTool("resumo_vendas", { viagem: "todas", ano: "2026" }, context), /ano/);
});
