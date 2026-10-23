import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { chooseDraftProduct, chooseDraftTrip, markDraftConfirming, startAdminCommand } from "../domain/adminCommands.js";
import {
  AdminOperationError,
  executeAdminOperation,
  resetProcessedOperations,
} from "./adminOperationsService.js";

const products = [
  { id: "a", code: "V001", name: "Vestido Floral", size: "M", color: "Azul", quantity: 5, costPrice: 30, salePrice: 70, category: "feminino" },
  { id: "c", code: "C010", name: "Camisa Polo", size: "M", color: "Preto", quantity: 7, costPrice: 20, salePrice: 50, category: "masculino" },
];
const now = new Date("2026-10-15T10:00:00");
const user = { uid: "user-1" };
const trips = [{ id: "trip-2026-4", name: "4ª viagem de 2026", tripNumber: 4, tripYear: 2026 }];

function fakeApi(stored = { quantity: 7, name: "Camisa Polo", code: "C010" }) {
  const calls = { addDoc: [], update: [], set: [] };
  return {
    calls,
    db: "db",
    collection: (_db, ...path) => ({ path: path.join("/") }),
    doc: (target, ...path) => ({ path: target.path ? `${target.path}/auto` : path.join("/") }),
    serverTimestamp: () => "TS",
    addDoc: async (ref, data) => calls.addDoc.push({ path: ref.path, data }),
    runTransaction: async (_db, fn) =>
      fn({
        get: async () => ({ exists: () => true, data: () => stored }),
        update: (ref, data) => calls.update.push({ path: ref.path, data }),
        set: (ref, data) => calls.set.push({ path: ref.path, data }),
      }),
  };
}

const confirmed = (text, productId) => {
  let draft = startAdminCommand(text, { products, trips, now, readOnly: false }).draft;
  if (draft.type === "expense" && draft.pending === "tripNumber") {
    draft = chooseDraftTrip(draft, trips[0], { products, trips, now, readOnly: false }).draft;
  }
  if (productId) draft = chooseDraftProduct(draft, productId, { products, now, readOnly: false }).draft;
  return markDraftConfirming(draft, { trusted: true });
};

beforeEach(() => resetProcessedOperations());

test("prévia somente leitura simula e nunca chama gravação", async () => {
  const api = fakeApi();
  for (const text of [
    "registrar despesa de 80 reais em hotel na 4ª viagem hoje",
    "adicionar 10 unidades ao C010",
  ]) {
    const result = await executeAdminOperation(confirmed(text), { user, readOnly: true, products, api });
    assert.equal(result.simulated, true);
    assert.match(result.message, /Nada foi gravado/);
  }
  assert.deepEqual(api.calls, { addDoc: [], update: [], set: [] });
});

test("rascunho não confirmado por clique não é executado", async () => {
  const draft = startAdminCommand("registrar despesa de 80 reais em hotel na 4ª viagem hoje", { products, now, readOnly: false }).draft;
  await assert.rejects(executeAdminOperation(draft, { user, readOnly: false, products, api: fakeApi() }), { code: "not_confirmed" });
});

test("exige usuário autenticado", async () => {
  const draft = confirmed("registrar despesa de 80 reais em hotel na 4ª viagem hoje");
  await assert.rejects(executeAdminOperation(draft, { user: null, readOnly: false, products, api: fakeApi() }), { code: "unauthenticated" });
});

test("despesa grava no formato da página Financeiro, só em users/{uid}", async () => {
  const api = fakeApi();
  const draft = confirmed("registrar despesa de R$ 80,50 em hotel na 4ª viagem hoje");
  const result = await executeAdminOperation(draft, { user, readOnly: false, products, api });
  assert.equal(result.simulated, false);
  assert.equal(api.calls.addDoc.length, 1);
  const [{ path, data }] = api.calls.addDoc;
  assert.equal(path, "users/user-1/expenses");
  assert.equal(data.value, 80.5);
  assert.equal(data.tripNumber, 4);
  assert.equal(data.expenseDate.getHours(), 12);
  assert.equal(data.tripId, "trip-2026-4");
  assert.equal(data.tripYear, 2026);
  assert.deepEqual(Object.keys(data).sort(), ["category", "createdAt", "description", "expenseDate", "tripId", "tripName", "tripNumber", "tripYear", "updatedAt", "value"]);
});

test("entrada de estoque atualiza quantidade e registra movimentação", async () => {
  const api = fakeApi();
  await executeAdminOperation(confirmed("adicionar 10 unidades ao C010"), { user, readOnly: false, products, api });
  assert.equal(api.calls.update[0].data.quantity, 17);
  const movement = api.calls.set[0].data;
  assert.equal(movement.type, "entrada");
  assert.equal(movement.previousQuantity, 7);
  assert.equal(movement.newQuantity, 17);
  assert.equal(api.calls.addDoc.length, 0);
});

test("estoque alterado desde a prévia aborta a gravação", async () => {
  const api = fakeApi({ quantity: 9, name: "Camisa Polo", code: "C010" });
  await assert.rejects(
    executeAdminOperation(confirmed("adicionar 10 unidades ao C010"), { user, readOnly: false, products, api }),
    { code: "stale" }
  );
  assert.equal(api.calls.update.length, 0);
  assert.equal(api.calls.set.length, 0);
});

test("novo produto grava uma vez; produto duplicado é recusado", async () => {
  const api = fakeApi();
  const text = "cadastrar produto código V100 descrição Saia Midi quantidade 5 custo 40 venda 90 categoria feminino";
  await executeAdminOperation(confirmed(text), { user, readOnly: false, products, api });
  assert.equal(api.calls.addDoc[0].path, "users/user-1/products");
  assert.equal(api.calls.addDoc[0].data.quantity, 5);

  const duplicate = { ...confirmed(text), id: "outro", fields: { ...confirmed(text).fields, code: "V001" } };
  await assert.rejects(executeAdminOperation(duplicate, { user, readOnly: false, products, api }), { code: "duplicate_product" });
  assert.equal(api.calls.addDoc.length, 1);
});

test("clique duplo não grava duas vezes", async () => {
  const api = fakeApi();
  const draft = confirmed("registrar despesa de 80 reais em hotel na 4ª viagem hoje");
  await executeAdminOperation(draft, { user, readOnly: false, products, api });
  await assert.rejects(executeAdminOperation(draft, { user, readOnly: false, products, api }), { code: "duplicate_submit" });
  assert.equal(api.calls.addDoc.length, 1);
});

test("falha de gravação libera nova tentativa e não vaza detalhes", async () => {
  const api = { ...fakeApi(), addDoc: async () => { throw new Error("segredo interno"); } };
  const draft = confirmed("registrar despesa de 80 reais em hotel na 4ª viagem hoje");
  await assert.rejects(executeAdminOperation(draft, { user, readOnly: false, products, api }), (error) => {
    assert.ok(error instanceof AdminOperationError);
    assert.doesNotMatch(error.message, /segredo/);
    return true;
  });
  const retry = await executeAdminOperation(draft, { user, readOnly: false, products, api: fakeApi() });
  assert.equal(retry.ok, true);
});
