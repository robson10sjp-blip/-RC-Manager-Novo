import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_GIFT_WRITES_ENABLED,
  CLIENT_VISIT_WRITES_ENABLED,
  cancelClientGift,
  recordClientGift,
  recordClientVisit,
} from "./clientRecords.js";

test("visits and gifts enabled with explicit scope validation before any write", async () => {
  assert.equal(CLIENT_GIFT_WRITES_ENABLED, true);
  assert.equal(CLIENT_VISIT_WRITES_ENABLED, true);
  await assert.rejects(
    recordClientVisit({
      db: {},
      userId: "fake-user",
      clientId: "fake-client",
      city: "Tucumã",
      tripName: "Viagem de teste",
      status: "not_purchased",
    }),
    /Selecione uma viagem confirmada/
  );
  await assert.rejects(
    recordClientGift({
      db: {},
      userId: "fake-user",
      operationId: "test-operation",
      clientId: "fake-client",
      productId: "fake-product",
      quantity: 1,
      tripName: "Viagem de teste",
      tripCity: "Tucumã",
    }),
    /Selecione a cidade e uma viagem confirmada/
  );
  await assert.rejects(
    cancelClientGift({
      db: {},
      userId: "",
      gift: { id: "fake-gift" },
    }),
    /Usuário e identificador/
  );
});
