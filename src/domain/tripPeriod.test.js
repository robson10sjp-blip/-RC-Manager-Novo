import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPeriodOptions, buildTripOptions, changeTripScopeYear, filterRecordsByTrip,
  getTripScopeLabel, normalizeTripScopeSelection, sameTripPeriod,
} from "./tripIdentity.js";
import { getSalesSummary, selectSaleRows } from "./saleTripReport.js";
import { calculateTripFinancialSummary, buildSaleDateUpdate, createSaleEditForm } from "./sales.js";
import { answerSecretaryQueryWithContext, createSecretarySnapshot } from "./secretary.js";
import { buildCollectionsReport } from "./secretaryCollections.js";
import { buildExpenseTripCorrection } from "./expenseTripCorrection.js";
import { findClientTripVisit, hasGiftForTrip, resolveClientTripVisitStatus } from "./clientRecords.js";

// Synthetic allocation of the user-reported capture totals, not a production export.
function capturedTotalsFixture() {
  const allocate = (count, sold, received, month) => Array.from({ length: count }, (_, index) => {
    const cents = Math.floor(sold * 100 / count) + (index < sold * 100 % count ? 1 : 0);
    const paid = Math.floor(received * 100 / count) + (index < received * 100 % count ? 1 : 0);
    return {
      id: `${month}-${index}`, clientId: "client", items: [{ productId: "p", quantity: 1 }],
      total: cents / 100, amountPaid: paid / 100, pendingAmount: (cents - paid) / 100,
      ...(month === "08" ? { createdAt: `2026-${month}-15T15:00:00Z` } : { saleDate: `2026-${month}-15` }),
      dueDate: "2026-10-20", tripId: "wrong-old-link", tripName: "4 viagem",
    };
  });
  return [...allocate(117, 89065, 14975, "08"), ...allocate(29, 26065, 1335, "10")];
}

test("capture reference totals reconcile across shared sales, dashboard/finance and secretary calculations", () => {
  const sales = capturedTotalsFixture();
  const clients = [{ id: "client", name: "Cliente de teste", city: "Tucumã", totalDebt: 0 }];
  const before = JSON.stringify(sales);
  const snapshot = createSecretarySnapshot({ clients, sales }, new Date("2026-10-24T15:00:00Z"));
  for (const [selection, expected] of [
    ["trip-2026-3", { count: 117, sold: 89065, received: 14975, pending: 74090 }],
    ["trip-2026-4", { count: 29, sold: 26065, received: 1335, pending: 24730 }],
    ["year-2026", { count: 146, sold: 115130, received: 16310, pending: 98820 }],
  ]) {
    const selected = filterRecordsByTrip(sales, selection);
    assert.deepEqual(getSalesSummary(selected), expected);
    assert.deepEqual(getSalesSummary(selectSaleRows(sales, { trip: selection, clients, city: "tucuma", search: "teste" })), expected);
    const financial = calculateTripFinancialSummary(selected, [], []);
    assert.equal(financial.salesCount, expected.count);
    for (const key of ["sold", "received", "pending"]) {
      assert.ok(Math.abs(financial[key] - expected[key]) < 0.005, key);
      if (snapshot.tripFinancials[selection]) {
        assert.ok(Math.abs(snapshot.tripFinancials[selection][key] - expected[key]) < 0.005, key);
      }
    }
    const collections = buildCollectionsReport({ clients, sales, trip: selection, today: new Date("2026-11-24T15:00:00Z") });
    assert.equal(collections.overdue.total, expected.pending);
  }
  for (const selection of ["trip-2026-1", "trip-2026-2", "year-2027", "trip-2027-4"]) {
    assert.equal(filterRecordsByTrip(sales, selection).length, 0);
  }
  for (const sale of sales) {
    assert.deepEqual(buildSaleDateUpdate(sale, createSaleEditForm(sale)), {});
  }
  assert.equal(JSON.stringify(sales), before);
});

test("changing year keeps travel number and makes annual/general semantics explicit", () => {
  assert.equal(changeTripScopeYear("trip-2026-4", 2027), "trip-2027-4");
  assert.equal(changeTripScopeYear("all", 2027), "year-2027");
  assert.equal(changeTripScopeYear("review", 2027), "year-2027");
  assert.match(getTripScopeLabel("all", 2026), /todos os anos/);
  assert.equal(getTripScopeLabel("year-2026", 2026), "Todas as viagens de 2026");
  assert.equal(buildPeriodOptions([], 2027).length, 4);
  for (const oldSelection of ["unassigned", "review", "legacy-number-4", ""]) {
    assert.equal(normalizeTripScopeSelection(oldSelection), "all");
  }
  assert.equal(normalizeTripScopeSelection("trip-2026-4"), "trip-2026-4");
});

test("general and annual filters preserve incomplete records with known years", () => {
  const trips = [{ id: "year-known", name: "Rota antiga", tripYear: 2026 }];
  const expenses = [
    { id: "year-only", tripId: "year-known", value: 50 },
    { id: "metadata-only", tripYear: 2026, value: 25 },
    { id: "unknown", tripId: "legacy-trip", tripName: "4 viagem", value: 1579 },
    { id: "without-trip", value: 10 },
  ];
  const before = JSON.stringify(expenses);
  const references = buildTripOptions({ trips, expenses, report: true });
  const options = [...buildPeriodOptions(references, 2026), ...references];

  assert.deepEqual(filterRecordsByTrip(expenses, "all", options), expenses);
  assert.equal(filterRecordsByTrip(expenses, "all", options)
    .reduce((total, expense) => total + expense.value, 0), 1664);
  assert.deepEqual(filterRecordsByTrip(expenses, "year-2026", options).map(({ id }) => id),
    ["year-only", "metadata-only"]);
  assert.deepEqual(filterRecordsByTrip(expenses, "trip-2026-4", options), []);
  assert.equal(JSON.stringify(expenses), before);
});

test("conflicting registered metadata remains in review instead of leaking into an annual period", () => {
  const trips = [{ id: "trip-2026-4", tripNumber: 4, tripYear: 2026, name: "4 viagem de 2026" }];
  const expenses = [{ id: "conflict", tripId: "trip-2026-4", tripNumber: 4, tripYear: 2027, value: 10 }];
  const references = buildTripOptions({ trips, expenses, report: true });
  const options = [...buildPeriodOptions(references, 2026), ...references];
  assert.equal(filterRecordsByTrip(expenses, "trip-2026-4", options).length, 0);
  assert.equal(filterRecordsByTrip(expenses, "year-2026", options).length, 0);
  assert.equal(filterRecordsByTrip(expenses, "review", options).length, 1);
});

test("secretary annual questions explicitly exclude other years", () => {
  const sales = [
    { id: "a", clientId: "c", saleDate: "2026-08-01", total: 100, amountPaid: 20, pendingAmount: 80 },
    { id: "b", clientId: "c", saleDate: "2027-08-01", total: 300, amountPaid: 30, pendingAmount: 270 },
  ];
  const snapshot = createSecretarySnapshot({ sales }, new Date("2027-10-01T15:00:00Z"));
  const response = answerSecretaryQueryWithContext("Quanto vendi em todas as viagens de 2026?", snapshot);
  assert.equal(response.tripContext.id, "year-2026");
  assert.equal(snapshot.tripFinancials["year-2026"].sold, 100);
  assert.match(response.answer, /2026/);
  assert.match(response.answer, /100,00/);
  assert.doesNotMatch(response.answer, /400,00/);
});

test("registered historical IDs bridge to annual periods without using payment dates or creating documents", () => {
  const trips = [
    { id: "original", tripNumber: 4, tripYear: 2026, name: "4 viagem" },
    { id: "future", tripNumber: 1, tripYear: 2027, name: "1 viagem de 2027" },
    { id: "unknown-year", name: "4 viagem" },
  ];
  const expenses = [
    { id: "known", tripId: "original", value: 10 },
    { id: "incomplete", tripId: "unknown-year", value: 1579, expenseDate: "2026-10-01" },
    { id: "none", value: 20 },
  ];
  const payables = [{ id: "p", tripId: "future", totalAmount: 1000, paidAmount: 200, purchaseDate: "2026-10-01" }];
  const input = { trips, expenses, payables };
  const before = JSON.stringify(input);
  const references = buildTripOptions({ ...input, report: true });
  const options = [...buildPeriodOptions(references, 2026), ...references];
  assert.deepEqual(filterRecordsByTrip(expenses, "trip-2026-4", options).map((entry) => entry.id), ["known"]);
  assert.deepEqual(filterRecordsByTrip(expenses, "review", options).map((entry) => entry.id), ["incomplete"]);
  assert.deepEqual(filterRecordsByTrip(expenses, "unassigned", options).map((entry) => entry.id), ["none"]);
  assert.equal(filterRecordsByTrip(payables, "year-2026", options).length, 0);
  assert.equal(filterRecordsByTrip(payables, "year-2027", options).length, 1);
  assert.equal(JSON.stringify(input), before);
});

test("confirmed expense link correction backs up exact fields and changes neither money nor counts", () => {
  const expense = { id: "old", tripName: "4 viagem", value: 1579, expenseDate: "2026-01-01", category: "hotel" };
  const destination = { id: "real-document-id", tripNumber: 4, tripYear: 2026, name: "4 viagem de 2026" };
  const before = JSON.stringify(expense);
  const patch = buildExpenseTripCorrection({ expense, expected: expense, destination, userId: "owner" });
  assert.deepEqual(Object.keys(patch).sort(), ["tripId", "tripName", "tripNumber", "tripYear", "tripLinkHistory"].sort());
  const corrected = { ...expense, ...patch };
  assert.equal(corrected.id, expense.id);
  assert.equal(corrected.value, expense.value);
  assert.equal(corrected.expenseDate, expense.expenseDate);
  assert.deepEqual(patch.tripLinkHistory[0].before.tripId, { present: false });
  assert.deepEqual(patch.tripLinkHistory[0].before.tripName, { present: true, value: "4 viagem" });
  const options = buildTripOptions({ trips: [destination], expenses: [corrected], report: true });
  assert.equal(filterRecordsByTrip([corrected], "review", options).length, 0);
  assert.equal(filterRecordsByTrip([corrected], "trip-2026-4", options).length, 1);
  assert.equal(filterRecordsByTrip([corrected], "all", options).length, 1);
  assert.equal(JSON.stringify(expense), before);
  assert.throws(() => buildExpenseTripCorrection({ expense: { ...expense, value: 1600 }, expected: expense, destination }), /mudou/);
  assert.throws(() => buildExpenseTripCorrection({ expense, expected: expense, destination: { id: "unknown", name: "4 viagem" } }), /ano/);
});

test("historical visits and gift warnings recognize the same proven period, never another year", () => {
  const options = [
    { id: "a", tripNumber: 4, tripYear: 2026 },
    { id: "b", tripNumber: 4, tripYear: 2026 },
    { id: "c", tripNumber: 4, tripYear: 2027 },
  ];
  assert.equal(sameTripPeriod({ tripId: "a" }, { tripId: "b" }, options), true);
  assert.equal(sameTripPeriod({ tripId: "a" }, { tripId: "c" }, options), false);
  assert.equal(sameTripPeriod({ tripName: "4 viagem" }, { tripId: "b" }, options), false);
  const visits = [{ id: "visit", clientId: "client", tripId: "a", city: "Tucumã", status: "not_purchased" }];
  assert.equal(resolveClientTripVisitStatus({
    client: { id: "client", city: "Tucumã" }, city: "Tucumã", tripId: "b",
    tripOptions: options, visitRecords: visits,
  }), "not_purchased");
  assert.equal(hasGiftForTrip([{ tripId: "a", tripCity: "Tucumã" }], "", "Tucumã", "b", options), true);
  const history = [...visits, { ...visits[0], id: "undo", tripId: "b", status: "unvisited" }];
  const query = {
    client: { id: "client", city: "Tucumã" }, city: "Tucumã", tripId: "b",
    tripOptions: options, visitRecords: history,
  };
  assert.equal(findClientTripVisit(query).id, "undo");
  assert.equal(resolveClientTripVisitStatus(query), "unvisited");
});
