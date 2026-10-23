import assert from "node:assert/strict";
import test from "node:test";
import { buildTripReviewPlan } from "./tripReviewPlan.js";

function fixture() {
  return {
    trips: [
      { id: "old-a", name: "4 viagem" },
      { id: "old-b", name: "4 viagem" },
      { id: "annual-a", name: "4ª viagem de 2026", tripNumber: 4, tripYear: 2026 },
      { id: "annual-b", name: "4ª viagem de 2026", tripNumber: 4, tripYear: 2026 },
      { id: "next-year", name: "4ª viagem de 2027", tripNumber: 4, tripYear: 2027 },
    ],
    sales: [
      { id: "s1", clientId: "client", tripId: "old-a", tripName: "4 viagem", tripYear: null,
        total: 440, amountPaid: 150, pendingAmount: 290 },
      { id: "s2", tripName: "4 viagem", total: 100, amountPaid: 0, pendingAmount: 100 },
      { id: "s3", total: 200, amountPaid: 50, pendingAmount: 150 },
    ],
    payables: [{ id: "p1", tripId: "next-year", totalAmount: 1000, paidAmount: 100 }],
    expenses: [{ id: "e1", value: 20 }],
  };
}

test("diagnostic exports exact original fields, absent fields and all IDs without writing or guessing years", () => {
  const collections = fixture();
  const before = JSON.stringify(collections);
  const plan = buildTripReviewPlan({ userId: "owner", collections });
  assert.equal(plan.mode, "simulation");
  assert.equal(plan.executable, false);
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.records.length, 10);
  const old = plan.records.find((record) => record.recordId === "s1");
  assert.equal(old.path, "users/owner/sales/s1");
  assert.deepEqual(old.originalTripFields.tripYear, { present: true, value: null });
  assert.deepEqual(old.originalTripFields.tripNumber, { present: false });
  assert.deepEqual(plan.records.find((record) => record.recordId === "s3").originalTripFields.tripId,
    { present: false });
  assert.equal(JSON.stringify(collections), before);
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
});

test("explicit exact destination keeps equal-name IDs and years independent and simulates only reference fields", () => {
  const collections = fixture();
  const before = JSON.stringify(collections);
  const selection = { collection: "sales", recordId: "s1", destinationId: "annual-b" };
  const plan = buildTripReviewPlan({ userId: "owner", collections, selection });
  const [change] = plan.changes;
  assert.equal(change.proposedTripFields.tripId, "annual-b");
  assert.equal(change.proposedTripFields.tripYear, 2026);
  assert.equal(change.expectedOriginalTripFields.tripId.value, "old-a");
  assert.deepEqual(Object.keys(change.proposedTripFields).sort(),
    ["tripId", "tripName", "tripNumber", "tripYear"].sort());
  assert.deepEqual(buildTripReviewPlan({ userId: "owner", collections, selection }), plan);
  const later = buildTripReviewPlan({
    userId: "owner", collections, selection: { ...selection, destinationId: "next-year" },
  });
  assert.equal(later.changes[0].proposedTripFields.tripYear, 2027);
  assert.notEqual(later.changes[0].operationKey, change.operationKey);
  assert.equal(JSON.stringify(collections), before);
});

test("simulation requires authenticated UID, existing source and explicitly complete destination", () => {
  const collections = fixture();
  for (const userId of ["", "invalid/uid"]) {
    assert.throws(() => buildTripReviewPlan({ userId, collections }), /conta/);
  }
  for (const selection of [
    { collection: "trips", recordId: "old-a", destinationId: "annual-a" },
    { collection: "sales", recordId: "missing", destinationId: "annual-a" },
    { collection: "sales", recordId: "s1", destinationId: "" },
    { collection: "sales", recordId: "s1", destinationId: "old-a" },
  ]) assert.throws(() => buildTripReviewPlan({ userId: "owner", collections, selection }));
});
