import assert from "node:assert/strict";
import test from "node:test";
import { COLLECTION_SPECS, createFirestoreReader, projectDocument } from "./firestoreRest.js";
import { createSecretarySnapshot } from "../../src/domain/secretary.js";
import { buildSaleTripAudit } from "../../src/domain/saleTripReport.js";

test("the server keeps commercial dates and independent travel links, matching local summaries", () => {
  const data = {
    clients: [{ id: "c", name: "Client", city: "Tucumã" }],
    sales: [{
      id: "sale", clientId: "c", total: 100, amountPaid: 20, pendingAmount: 80,
      paymentMethod: "prazo", createdAt: new Date("2026-08-15T15:00:00Z"),
      saleDate: "", tripId: "wrong-fourth-trip", tripYear: 2025,
      items: [{ productId: "p", quantity: 1, unitPrice: 100 }],
    }],
    trips: [{ id: "old-trip", name: "3ª viagem de 2026", tripNumber: 3, tripYear: 2026 }],
    expenses: [{ id: "expense", tripId: "old-trip", value: 10, expenseDate: "2026-12-01" }],
    payables: [{ id: "purchase", tripId: "old-trip", totalAmount: 50, paidAmount: 5, purchaseType: "stock" }],
    products: [], suppliers: [],
  };
  const projected = Object.fromEntries(Object.entries(data).map(([collection, records]) => [
    collection, records.map(({ id, ...fields }) => projectDocument(id, fields, COLLECTION_SPECS[collection])),
  ]));
  const now = new Date("2026-10-24T15:00:00Z");
  const local = createSecretarySnapshot(data, now);
  const server = createSecretarySnapshot(projected, now);
  assert.deepEqual(buildSaleTripAudit(projected.sales), buildSaleTripAudit(data.sales));
  assert.deepEqual(server.tripFinancials["trip-2026-3"], local.tripFinancials["trip-2026-3"]);
  assert.equal(server.tripFinancials["trip-2026-3"].sold, 100);
  assert.equal(server.tripFinancials["trip-2026-3"].expenses, 10);
  assert.equal(server.tripFinancials["trip-2026-3"].supplierPayments, 5);
  assert.equal(server.tripFinancials["trip-2026-3"].cashFlow, 5);
  assert.ok(server.tripOptions[0].linkedTripIds.includes("old-trip"));
});

test("registered travel identities are fetched read-only through the authenticated user's path", async () => {
  const calls = [];
  const reader = createFirestoreReader({
    projectId: "demo-rc", uid: "fake-user", idToken: "fake-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method });
      return new Response(JSON.stringify({ documents: [] }));
    },
  });
  const data = await reader.readAll();
  assert.deepEqual(data.trips, []);
  assert.ok(calls.some((call) => call.url.includes("/users/fake-user/trips?")));
  assert.ok(calls.every((call) => call.method === "GET"));
});
