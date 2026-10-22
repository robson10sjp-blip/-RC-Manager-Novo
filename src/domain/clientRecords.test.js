import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateGiftCost,
  createVisitRecordId,
  hasGiftForTrip,
  resolveClientTripVisitStatus,
  validateGiftQuantity,
} from "./clientRecords.js";

test("visit record identifiers use the stable client ID and trip key", () => {
  assert.equal(createVisitRecordId("client-123", "Viagem Araguaia 2026"), "viagem-araguaia-2026_client-123");
  assert.throws(() => createVisitRecordId("", "Viagem A"), /obrigatórios/);
});

test("visit status is isolated by client, city and explicitly named trip", () => {
  const client = { id: "client-1", city: "Tucumã – PA" };
  const visitRecords = [{
    clientId: client.id,
    city: client.city,
    tripName: "Rota Sul 2026",
    status: "not_purchased",
  }];

  assert.equal(
    resolveClientTripVisitStatus({
      client,
      city: client.city,
      tripName: "Rota Sul 2026",
      visitRecords,
    }),
    "not_purchased"
  );
  assert.equal(
    resolveClientTripVisitStatus({
      client: { ...client, id: "other-client" },
      city: client.city,
      tripName: "Rota Sul 2026",
      visitRecords,
    }),
    "unvisited"
  );
  assert.equal(
    resolveClientTripVisitStatus({
      client,
      city: client.city,
      tripName: "Outra viagem",
      visitRecords,
    }),
    "unvisited"
  );
});

test("an explicitly linked sale takes precedence as purchased", () => {
  assert.equal(
    resolveClientTripVisitStatus({
      client: { id: "client-1", city: "Tucumã – PA" },
      city: "Tucumã – PA",
      tripName: "Rota Sul 2026",
      visitRecords: [{
        clientId: "client-1",
        city: "Tucumã – PA",
        tripName: "Rota Sul 2026",
        status: "not_purchased",
      }],
      sales: [{
        clientId: "client-1",
        tripName: "Rota Sul 2026",
        tripCity: "Tucumã – PA",
      }],
    }),
    "bought"
  );
});

test("gift quantities respect available stock and record separate cost", () => {
  assert.equal(validateGiftQuantity("2", 4), 2);
  assert.equal(calculateGiftCost(12.35, 2), 24.7);
  assert.throws(() => validateGiftQuantity("0", 4), /inteiro maior que zero/);
  assert.throws(() => validateGiftQuantity("5", 4), /superar o estoque/);
});

test("cancelled gifts do not trigger same-trip duplicate warnings", () => {
  assert.equal(
    hasGiftForTrip([
      { tripName: "Rota Sul", tripCity: "Tucumã", status: "cancelled" },
    ], "Rota Sul", "Tucumã"),
    false
  );
  assert.equal(
    hasGiftForTrip([
      { tripName: "Rota Sul", tripCity: "Tucumã", status: "active" },
    ], "Rota Sul", "Tucumã"),
    true
  );
});
