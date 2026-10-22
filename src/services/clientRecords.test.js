import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_RECORD_WRITES_ENABLED,
  cancelClientGift,
  recordClientGift,
  recordClientVisit,
} from "./clientRecords.js";

test("new client-record writes stay blocked pending Firestore rules review", async () => {
  assert.equal(CLIENT_RECORD_WRITES_ENABLED, false);
  await assert.rejects(
    recordClientVisit({
      db: {},
      userId: "fake-user",
      clientId: "fake-client",
      city: "Tucumã",
      tripName: "Viagem de teste",
      status: "not_purchased",
    }),
    /aguardam revisão das regras Firestore/
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
    /aguardam revisão das regras Firestore/
  );
  await assert.rejects(
    cancelClientGift({
      db: {},
      userId: "fake-user",
      gift: { id: "fake-gift", productId: "fake-product" },
    }),
    /aguardam revisão das regras Firestore/
  );
});
