import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateGiftCost,
  buildClientVisitSummary,
  createVisitRecordId,
  hasGiftForTrip,
  resolveClientTripVisitStatus,
  validateGiftQuantity,
  validateActionDate,
} from "./clientRecords.js";

test("calendar visit status separates dates and never infers travel or purchases by date", () => {
  const client = { id: "a", city: "Tucumã" };
  const input = { client, city: client.city, actionDate: "2026-10-20",
    visitRecords: [{ clientId: "a", city: "Tucumã", actionDate: "2026-10-20", status: "not_purchased" }],
    sales: [{ clientId: "a", tripName: "3ª viagem", saleDate: "2026-10-20" }] };
  assert.equal(resolveClientTripVisitStatus(input), "not_purchased");
  assert.equal(resolveClientTripVisitStatus({ ...input, actionDate: "2026-10-21" }), "unvisited");
  assert.equal(validateActionDate("2028-02-29"), "2028-02-29");
  for (const value of ["2026-02-29", "2026-13-01", "", "20/10/2026"]) {
    assert.throws(() => validateActionDate(value), /data válida/);
  }
});

test("visit record identifiers use the stable client ID and trip key", () => {
  assert.equal(createVisitRecordId("client-123", "trip-123", "Tucumã – PA"), "trip-123~tucuma~client-123");
  assert.throws(() => createVisitRecordId("", "Viagem A", "Tucumã"), /obrigatórios/);
  assert.notEqual(createVisitRecordId("client-123", "trip-123", "Tucumã"),
    createVisitRecordId("client-123", "trip-123", "Xinguara"));
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

test("a sale's calendar trip takes precedence as purchased", () => {
  assert.equal(
    resolveClientTripVisitStatus({
      client: { id: "client-1", city: "Tucumã – PA" },
      city: "Tucumã – PA",
      tripId: "trip-2026-3",
      visitRecords: [{
        clientId: "client-1",
        city: "Tucumã – PA",
        tripName: "Rota Sul 2026",
        status: "not_purchased",
      }],
      sales: [{
        clientId: "client-1",
        saleDate: "2026-08-15",
        tripName: "Rota Sul 2026",
        tripCity: "Tucumã – PA",
      }],
    }),
    "bought"
  );
});

test("visit counts isolate cities, client IDs, equal-name trips and cancelled sales", () => {
  const clients = [
    { id: "a", name: "Maria", city: "Tucumã – PA" },
    { id: "b", name: "Maria", city: "Tucumã – PA" },
    { id: "c", city: "Xinguara – PA" },
  ];
  const records = [{ clientId: "a", city: "Tucumã", tripId: "trip-one", status: "not_purchased" }];
  const input = {
    clients, city: "Tucumã", tripId: "trip-2026-3",
    visitRecords: records.map((record) => ({ ...record, tripId: "trip-2026-3" })),
    sales: [
      { clientId: "b", saleDate: "2026-08-15", tripId: "trip-one", tripCity: "Tucumã" },
      { clientId: "a", saleDate: "2026-10-23", tripId: "trip-other", tripCity: "Tucumã" },
      { clientId: "a", saleDate: "2026-08-15", tripId: "trip-one", tripCity: "Xinguara" },
      { clientId: "a", saleDate: "2026-08-15", tripId: "trip-one", status: "cancelled" },
    ],
  };
  assert.deepEqual(buildClientVisitSummary(input).counts, { unvisited: 0, not_purchased: 1, bought: 1 });
  assert.deepEqual(buildClientVisitSummary({ ...input, tripId: "trip-new", sales: [] }).counts,
    { unvisited: 2, not_purchased: 0, bought: 0 });
  assert.deepEqual(buildClientVisitSummary({ ...input, city: "Xinguara" }).counts,
    { unvisited: 1, not_purchased: 0, bought: 0 });
  assert.deepEqual(buildClientVisitSummary({ ...input, tripId: "" }).counts,
    { unvisited: 0, not_purchased: 0, bought: 0 });
});

test("canonical undo overrides a legacy marker but undated sales never invent a trip", () => {
  const client = { id: "a", city: "Tucumã" };
  const visitRecords = [
    { clientId: "a", city: "Tucumã", tripName: "3", status: "not_purchased" },
    { clientId: "a", city: "Tucumã", tripId: "legacy-number-3", status: "unvisited" },
  ];
  const input = { client, city: "Tucumã", tripId: "legacy-number-3", visitRecords };
  assert.equal(resolveClientTripVisitStatus(input), "unvisited");
  assert.equal(resolveClientTripVisitStatus({
    ...input, sales: [{ clientId: "a", tripName: "3ª viagem" }],
  }), "unvisited");
  assert.equal(resolveClientTripVisitStatus({
    ...input, tripId: "trip-new-same-name", tripName: "3",
    sales: [{ clientId: "a", tripName: "3ª viagem" }],
  }), "unvisited");
});

test("client purchases follow only each sale's date and client ID, never its stale travel link", () => {
  const client = { id: "a", city: "Tucumã" };
  const sales = [
    { clientId: "a", saleDate: "15/08/2026", tripId: "trip-2026-4" },
    { clientId: "a", saleDate: "10/01/2027", tripId: "trip-2026-3" },
    { clientId: "b", saleDate: "23/10/2026", tripId: "trip-2026-4" },
    { clientId: "a", createdAt: "2026-10-23", tripId: "trip-2026-4" },
  ];
  const input = { client, city: client.city, sales };
  for (const tripId of ["trip-2026-3", "trip-2027-1"]) {
    assert.equal(resolveClientTripVisitStatus({ ...input, tripId }), "bought");
  }
  for (const tripId of ["trip-2026-4", "trip-2027-3"]) {
    assert.equal(resolveClientTripVisitStatus({ ...input, tripId }), "unvisited");
  }
  assert.equal(resolveClientTripVisitStatus({ ...input, tripId: "trip-2026-3", city: "Xinguara" }), "unvisited");
});

test("registered legacy visit IDs resolve their explicit year/number without reclassifying the sale", () => {
  const input = {
    client: { id: "c", city: "Tucumã" }, city: "Tucumã", tripId: "old-third",
    tripOptions: [
      { id: "old-third", tripNumber: 3, tripYear: 2026 },
      { id: "old-fourth", tripNumber: 4, tripYear: 2026 },
    ],
    sales: [{ clientId: "c", saleDate: "2026-08-15", tripId: "old-fourth" }],
  };
  assert.equal(resolveClientTripVisitStatus(input), "bought");
  assert.equal(resolveClientTripVisitStatus({ ...input, tripId: "old-fourth" }), "unvisited");
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

test("gift duplicate warnings use shared trip IDs and do not merge new same-name trips", () => {
  const gifts = [{ tripId: "trip-one", tripName: "3", tripCity: "Tucumã", status: "active" }];
  assert.equal(hasGiftForTrip(gifts, "3", "Tucumã", "trip-one"), true);
  assert.equal(hasGiftForTrip(gifts, "3", "Tucumã", "trip-two"), false);
  assert.equal(hasGiftForTrip(gifts, "3", "Xinguara", "trip-one"), false);
  assert.equal(hasGiftForTrip([{ tripName: "3ª viagem", tripCity: "Tucumã", status: "active" }],
    "3", "Tucumã", "legacy-number-3"), true);
});
