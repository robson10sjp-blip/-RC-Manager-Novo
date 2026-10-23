import assert from "node:assert/strict";
import test from "node:test";
import { getSaleTrip, saleDateInput } from "./saleTrip.js";
import {
  buildTripOptions, filterRecordsByTrip, getRecordTripId, getSaleTripEditFields,
  getTripOptionLabel, tripMatchesRecord,
} from "./tripIdentity.js";

test("every calendar month including its last day belongs to exactly one quarter and year", () => {
  for (const year of [2024, 2026, 2027]) {
    for (let month = 1; month <= 12; month++) {
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      for (const day of [1, lastDay]) {
        const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const trip = getSaleTrip({ saleDate: date });
        assert.equal(trip.tripNumber, Math.ceil(month / 3), date);
        assert.equal(trip.tripYear, year);
        assert.equal(trip.name, `${Math.ceil(month / 3)}ª viagem de ${year}`);
      }
    }
  }
});

test("boundary instants use America/Belem, independent of device timezone and timestamp format", () => {
  for (const [lastDate, nextDate, beforeId, afterId] of [
    ["2026-03-31", "2026-04-01", "trip-2026-1", "trip-2026-2"],
    ["2026-06-30", "2026-07-01", "trip-2026-2", "trip-2026-3"],
    ["2026-09-30", "2026-10-01", "trip-2026-3", "trip-2026-4"],
    ["2026-12-31", "2027-01-01", "trip-2026-4", "trip-2027-1"],
  ]) {
    const before = new Date(`${nextDate}T02:59:59.999Z`);
    const after = new Date(`${nextDate}T03:00:00.000Z`);
    assert.equal(saleDateInput(before), lastDate);
    assert.equal(getSaleTrip({ saleDate: before }).id, beforeId);
    for (const value of [
      after, after.toISOString(), { toDate: () => after },
      { seconds: after.getTime() / 1000, nanoseconds: 0 },
      { _seconds: after.getTime() / 1000, _nanoseconds: 0 },
      { timestampValue: after.toISOString() },
    ]) {
      assert.equal(saleDateInput(value), nextDate);
      assert.equal(getSaleTrip({ saleDate: value }).id, afterId);
    }
    assert.equal(getSaleTrip({ saleDate: `${lastDate}T23:59:59-03:00` }).id, beforeId);
  }
});

test("invalid or missing original sale dates never fall back to payment, due, creation or stored travel", () => {
  for (const value of [undefined, null, "", "bad", "2026-02-30", "2026-04-31",
    "2026-13-01", "2026-10-01T00:00:00", "2026-02-30T03:00:00Z",
    { timestampValue: "2026-02-30T03:00:00Z" }, true, 0]) {
    const sale = {
      clientId: "c", total: 100, saleDate: value, tripId: "old", tripYear: 2026,
      createdAt: "2026-07-01", dueDate: "2026-10-01", paymentDate: "2026-10-01",
    };
    assert.equal(getSaleTrip(sale), null);
    assert.equal(getRecordTripId(sale), "");
    assert.match(getTripOptionLabel(sale), /inválida/);
    assert.deepEqual(filterRecordsByTrip([sale], "all"), [sale]);
    assert.deepEqual(filterRecordsByTrip([sale], "unassigned"), [sale]);
  }
  assert.equal(saleDateInput("31/03/2026"), "2026-03-31");
  assert.equal(saleDateInput("30.06.2026"), "2026-06-30");
  assert.equal(saleDateInput("29/02/2026"), "");
});

test("sales filters replace duplicate historical options without changing any stored data or totals", () => {
  const sales = [
    { id: "a", clientId: "c", tripId: "old-a", tripCity: "Tucumã",
      saleDate: "2026-07-31", total: 440, amountPaid: 150, pendingAmount: 290 },
    { id: "b", clientId: "d", tripId: "old-b", tripName: "4 viagem",
      saleDate: "2026-07-01", total: 100, amountPaid: 100, pendingAmount: 0 },
    { id: "c", clientId: "c", saleDate: "2027-07-01", total: 200, amountPaid: 20, pendingAmount: 180 },
    { id: "d", clientId: "d", saleDate: "bad", total: 50, amountPaid: 0, pendingAmount: 50 },
  ];
  const trips = [{ id: "old-a", name: "4 viagem" }, { id: "old-b", name: "4 viagem" }];
  const before = JSON.stringify({ sales, trips });
  const options = buildTripOptions({ trips, sales, salesOnly: true });
  assert.deepEqual(options.map((trip) => trip.id), ["trip-2026-3", "trip-2027-3"]);
  assert.deepEqual(filterRecordsByTrip(sales, "trip-2026-3", options).map((sale) => sale.id), ["a", "b"]);
  assert.deepEqual(filterRecordsByTrip(sales, "trip-2027-3", options).map((sale) => sale.id), ["c"]);
  assert.equal(filterRecordsByTrip(sales, "trip-2026-3", options).filter((sale) => sale.tripCity === "Tucumã").length, 1);
  assert.deepEqual(filterRecordsByTrip(sales, "unassigned", options).map((sale) => sale.id), ["d"]);
  for (const field of ["total", "amountPaid", "pendingAmount"]) {
    const total = sales.reduce((sum, sale) => sum + sale[field], 0);
    const partition = [...options.map((trip) => trip.id), "unassigned"]
      .flatMap((id) => filterRecordsByTrip(sales, id, options))
      .reduce((sum, sale) => sum + sale[field], 0);
    assert.equal(partition, total);
  }
  assert.deepEqual(getSaleTripEditFields({ ...sales[0], saleDate: "2026-10-01" }, true), {});
  assert.equal(getSaleTrip({ ...sales[0], saleDate: "2026-10-01" }).id, "trip-2026-4");
  assert.equal(JSON.stringify({ sales, trips }), before);
});

test("expenses and supplier purchases retain their own IDs, never their dates' quarters", () => {
  const sale = { saleDate: "2026-07-01", total: 100, clientId: "c" };
  const payable = { id: "p", tripId: "supplier-trip", totalAmount: 1000, purchaseDate: "2026-10-01" };
  const expense = { id: "e", tripId: "expense-trip", value: 10, expenseDate: "2026-01-01" };
  const options = buildTripOptions({
    sales: [sale], payables: [payable], expenses: [expense], report: true,
    trips: [
      { id: "supplier-trip", tripNumber: 3, tripYear: 2026, name: "3 viagem" },
      { id: "expense-trip", tripNumber: 4, tripYear: 2027, name: "4 viagem" },
      { id: "unused-old-trip", name: "4 viagem" },
    ],
  });
  assert.deepEqual(options.map((trip) => trip.id), ["trip-2026-3", "trip-2027-4"]);
  assert.equal(tripMatchesRecord(payable, options[0]), true);
  assert.equal(tripMatchesRecord(expense, options[0]), false);
  assert.equal(tripMatchesRecord(expense, options[1]), true);
  assert.equal(getRecordTripId(payable), "supplier-trip");
  assert.equal(getRecordTripId(expense), "expense-trip");
});
