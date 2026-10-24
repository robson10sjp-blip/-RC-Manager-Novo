import assert from "node:assert/strict";
import test from "node:test";
import { getSaleTrip, getSaleYearTrips, saleDateInput, resolveSaleCalendar, getSaleDateInput, getSaleDate } from "./saleTrip.js";
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

test("Dashboard annual options always contain exactly four quarters, including empty quarters", () => {
  for (const year of [2026, 2027, 2028]) {
    const options = getSaleYearTrips(year);
    assert.deepEqual(options.map((trip) => trip.id), [1, 2, 3, 4].map((number) => `trip-${year}-${number}`));
    assert.deepEqual(options.map((trip) => trip.name), [1, 2, 3, 4].map((number) => `${number}ª viagem de ${year}`));
    assert.deepEqual(filterRecordsByTrip([], options[3].id, options), []);
  }
  assert.throws(() => getSaleYearTrips("bad"), /ano válido/);
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
    "2026-13-01", "2026-10-01T24:00:00", "2026-02-30T03:00:00Z",
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

test("the original stored schema recovers its commercial createdAt date, including empty saleDate", () => {
  for (const year of [2026, 2027]) {
    for (let month = 1; month <= 12; month++) {
      const date = `${year}-${String(month).padStart(2, "0")}-15`;
      const instant = new Date(`${date}T15:00:00Z`);
      for (const value of [
        instant, { toDate: () => instant }, { seconds: instant.getTime() / 1000 },
        { _seconds: instant.getTime() / 1000 }, { timestampValue: instant.toISOString() },
      ]) {
        const sale = {
          clientId: "legacy", items: [{ productId: "p", quantity: 1, unitPrice: 100 }],
          total: 100, amountPaid: 20, pendingAmount: 80, paymentMethod: "prazo",
          createdAt: value, updatedAt: "2028-10-23", dueDate: "2028-12-01",
          tripNumber: 4, tripYear: 2025,
        };
        for (const saleDate of [undefined, null, "", " "]) {
          const record = { ...sale, saleDate };
          assert.equal(resolveSaleCalendar(record).source, "createdAt");
          assert.equal(getSaleDateInput(record), date);
          assert.equal(getSaleDate(record).getDate(), 15);
          assert.equal(getSaleTrip(record).id, `trip-${year}-${Math.floor((month - 1) / 3) + 1}`);
        }
        assert.equal(getSaleTrip({ ...sale, saleDate: "23/10/2026" }).id, "trip-2026-4");
        assert.equal(getSaleTrip({ ...sale, saleDate: "invalid" }), null);
        assert.equal(getSaleTrip({ ...sale, balanceModel: "per-sale" }), null);
        assert.equal(getSaleTrip({ ...sale, items: [] }), null);
      }
    }
  }
});

test("legacy date provenance does not depend on mutable balances or payment method", () => {
  const legacy = {
    clientId: "legacy", items: [{ productId: "p", quantity: 1 }], total: 100,
    createdAt: { seconds: Date.parse("2026-08-15T15:00:00Z") / 1000 },
  };
  for (const fields of [
    {}, { amountPaid: "20", pendingAmount: "80", paymentMethod: "dinheiro" },
    { amountPaid: null, pendingAmount: null, paymentMethod: "pix" },
  ]) {
    const sale = { ...legacy, ...fields, saleDate: " " };
    assert.equal(getSaleDateInput(sale), "2026-08-15");
    assert.equal(getSaleTrip(sale).id, "trip-2026-3");
    assert.equal(getSaleTrip({ ...sale, balanceModel: "per-sale" }), null);
    assert.equal(getSaleTrip({ ...sale, saleDate: "invalid" }), null);
  }
  assert.equal(getSaleTrip({ createdAt: legacy.createdAt }), null);
});

test("civil datetime strings preserve their written calendar day without the device timezone", () => {
  for (const date of ["2026-03-31", "2026-04-01", "2026-09-30", "2026-10-01", "2026-12-31", "2027-01-01"]) {
    for (const suffix of ["T00:00:00", " 23:59:59", "T12:30", "T23:59:59.123456789"]) {
      assert.equal(getSaleDateInput({ saleDate: date + suffix }), date);
    }
  }
  for (const value of ["2026-02-30T12:00:00", "2026-10-01T00:60:00", "2026-10-01T00:00:60", {}]) {
    assert.equal(saleDateInput(value), "");
  }
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

test("financial trip options merge canonical and old aliases once, independent of their order", () => {
  const trips = [
    { id: "old-a", name: "3ª viagem de 2026", tripNumber: 3, tripYear: 2026 },
    { id: "trip-2026-3", name: "3ª viagem de 2026", tripNumber: 3, tripYear: 2026 },
    { id: "old-b", name: "3ª viagem de 2026", tripNumber: 3, tripYear: 2026 },
  ];
  const expenses = trips.map((trip) => ({ id: `expense-${trip.id}`, tripId: trip.id, value: 10 }));
  const sales = [{ id: "sale", clientId: "c", saleDate: "15/08/2026", tripId: "old-b", total: 100 }];
  const before = JSON.stringify({ trips, expenses, sales });
  for (const ordered of [trips, [...trips].reverse(), [trips[1], trips[0], trips[2]]]) {
    const options = buildTripOptions({ trips: ordered, expenses, sales, report: true });
    assert.equal(options.length, 1);
    assert.equal(options[0].name, "3ª viagem de 2026");
    assert.deepEqual(new Set(options[0].linkedTripIds), new Set(trips.map((trip) => trip.id)));
    assert.deepEqual(filterRecordsByTrip(expenses, options[0], options), expenses);
    assert.deepEqual(filterRecordsByTrip(sales, options[0], options), sales);
  }
  assert.equal(JSON.stringify({ trips, expenses, sales }), before);
});
