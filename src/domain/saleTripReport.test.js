import assert from "node:assert/strict";
import test from "node:test";
import { buildSaleTripAudit, getSalesSummary, groupSalesByTrip, selectSaleRows } from "./saleTripReport.js";
import { getSaleTrip } from "./saleTrip.js";
import { buildSaleDateUpdate, createSaleEditForm, prepareSaleReceipt } from "./sales.js";
import { buildTripOptions, filterRecordsByTrip } from "./tripIdentity.js";
import { buildCollectionsReport } from "./secretaryCollections.js";
import { createSecretarySnapshot } from "./secretary.js";
import { resolveClientTripVisitStatus } from "./clientRecords.js";

function legacySale(index, date = "2026-08-15") {
  return {
    id: `sale-private-${index}`, clientId: "client-private", clientName: "Private Name",
    items: [{ productId: "p", quantity: 1, unitPrice: 100, subtotal: 100 }],
    total: 100, amountPaid: 20, pendingAmount: 80, paymentMethod: "prazo",
    createdAt: { seconds: Date.parse(`${date}T15:00:00Z`) / 1000 },
    updatedAt: "2027-01-01", tripId: "wrong-old-id", tripName: "4 viagem",
  };
}

test("146 synthetic sales reproduce the missing-saleDate symptom and reconcile without any migration", () => {
  const sales = [
    ...Array.from({ length: 130 }, (_, index) => ({ ...legacySale(index), saleDate: index % 2 ? "" : undefined })),
    ...Array.from({ length: 16 }, (_, index) => ({
      ...legacySale(index + 130), balanceModel: "per-sale", saleDate: "23/10/2026",
    })),
  ];
  const before = JSON.stringify(sales);
  const report = buildSaleTripAudit(sales);
  assert.deepEqual(report.sources, { saleDate: 16, createdAt: 130, missing: 0, invalid: 0 });
  assert.deepEqual(report.groups.map(({ id, count }) => [id, count]), [["trip-2026-4", 16], ["trip-2026-3", 130]]);
  assert.deepEqual(report.totals, { count: 146, sold: 14600, received: 2920, pending: 11680 });
  assert.equal(report.reconciled, true);
  const serialized = JSON.stringify(report);
  for (const secret of ["sale-private", "client-private", "Private Name", "wrong-old-id", "2026-08-15"]) {
    assert.ok(!serialized.includes(secret));
  }
  assert.equal(JSON.stringify(sales), before);
});

test("legacy and explicit sale dates agree in editing, cards, clients, finance, dashboard and collections", () => {
  const clients = [{ id: "client-private", name: "Client", city: "Tucumã" }];
  const sales = [2026, 2027].flatMap((year) => Array.from({ length: 12 }, (_, month) =>
    legacySale(`${year}-${month}`, `${year}-${String(month + 1).padStart(2, "0")}-15`)));
  const options = buildTripOptions({ sales, salesOnly: true });
  const snapshot = createSecretarySnapshot({ clients, sales }, new Date("2028-10-20T15:00:00Z"));
  assert.equal(options.length, 8);
  for (const sale of sales) {
    const form = createSaleEditForm(sale);
    const trip = getSaleTrip(sale);
    assert.equal(getSaleTrip({ saleDate: form.saleDate }).id, trip.id);
    assert.equal(getSaleTrip(prepareSaleReceipt(sale)).id, trip.id);
    assert.equal(selectSaleRows([sale])[0].originalSaleDate, form.saleDate);
    assert.deepEqual(buildSaleDateUpdate(sale, form), {});
    const update = buildSaleDateUpdate(sale, { ...form, saleDate: "2027-01-10" });
    assert.deepEqual(Object.keys(update), ["saleDate"]);
    assert.equal(getSaleTrip({ ...sale, ...update }).id, "trip-2027-1");
    assert.equal(resolveClientTripVisitStatus({
      client: clients[0], city: "Tucumã", tripId: trip.id, sales: [sale],
    }), "bought");
  }
  for (const trip of options) {
    const subset = filterRecordsByTrip(sales, trip.id, options);
    assert.equal(subset.length, 3);
    assert.equal(snapshot.tripFinancials[trip.id].sold, getSalesSummary(subset).sold);
    const collection = buildCollectionsReport({ clients, sales, trip: trip.id, today: new Date("2028-10-20T15:00:00Z") });
    assert.equal(collection.overdue.total, getSalesSummary(subset).pending);
  }
});

test("groups are newest year/trip first while ordering within a group honors the selector", () => {
  const sales = [
    { ...legacySale(1), saleDate: "2026-08-15" },
    { ...legacySale(2), saleDate: "2026-07-01" },
    { ...legacySale(3), saleDate: "2026-10-23" },
    { ...legacySale(4), saleDate: "2027-01-10" },
    { id: "missing", total: 0.1, amountPaid: 0, pendingAmount: 0.1 },
    { ...legacySale(5), saleDate: "2026-02-30" },
  ];
  for (const order of ["newest", "oldest"]) {
    const groups = groupSalesByTrip(selectSaleRows(sales, { order }));
    assert.deepEqual(groups.map((group) => group.id), ["trip-2027-1", "trip-2026-4", "trip-2026-3", "unassigned"]);
    assert.deepEqual(groups[2].sales.map((sale) => sale.id),
      order === "oldest" ? ["sale-private-2", "sale-private-1"] : ["sale-private-1", "sale-private-2"]);
  }
  assert.equal(buildSaleTripAudit(sales).reconciled, true);
  assert.deepEqual(buildSaleTripAudit(sales).sources, { saleDate: 4, createdAt: 0, missing: 1, invalid: 1 });
});

test("combined city, client search and travel filters keep each client's sale and money separate", () => {
  const clients = [
    { id: "client-private", name: "Maria", city: "Tucumã – PA" },
    { id: "other", name: "Maria", city: "Xinguara" },
  ];
  const sales = [
    legacySale(1),
    { ...legacySale(2), clientId: "other" },
    { ...legacySale(3), saleDate: "2026-10-01" },
    { ...legacySale(4), tripCity: "Xinguara" },
  ];
  const result = selectSaleRows(sales, { clients, city: "tucuma", search: "maria", trip: "trip-2026-3" });
  assert.deepEqual(result.map((sale) => sale.id), ["sale-private-1"]);
  assert.deepEqual(getSalesSummary(result), { count: 1, sold: 100, received: 20, pending: 80 });
});

test("missing and corrupt dates remain repairable one sale at a time without editing its other fields", () => {
  for (const sale of [
    { ...legacySale(1), saleDate: "invalid" },
    { ...legacySale(2), createdAt: null },
    { id: "no-client", total: 100, amountPaid: 0, pendingAmount: 100, tripId: "trip-2026-4" },
    { id: "incomplete", clientId: "client-private", items: [], total: 0, pendingAmount: 0 },
  ]) {
    assert.equal(getSaleTrip(sale), null);
    assert.deepEqual(filterRecordsByTrip([sale], "unassigned"), [sale]);
    const form = createSaleEditForm(sale);
    const edited = { ...form, saleDate: "2026-08-15" };
    if (!edited.items.length) edited.items = [{ productId: "", quantity: 1, price: "" }];
    const update = buildSaleDateUpdate(sale, edited);
    assert.deepEqual(Object.keys(update), ["saleDate"]);
    assert.equal(getSaleTrip({ ...sale, ...update }).id, "trip-2026-3");
  }
});

test("an October payment stays on the August sale's third trip while receipt periods use the payment date", () => {
  const sale = { ...legacySale(1), amountPaid: 40, pendingAmount: 60 };
  const payment = { id: "payment-private", saleId: sale.id, value: 40, createdAt: "2026-10-23T15:00:00Z" };
  const input = { sales: [sale], payments: [payment] };
  const before = JSON.stringify(input);
  const october = createSecretarySnapshot(input, new Date("2026-10-24T15:00:00Z"));
  const august = createSecretarySnapshot(input, new Date("2026-08-24T15:00:00Z"));
  assert.equal(october.receivedThisMonth, 40);
  assert.equal(august.receivedThisMonth, 0);
  assert.equal(october.tripFinancials["trip-2026-3"].received, 40);
  assert.equal(october.tripPending["trip-2026-3"].amount, 60);
  assert.equal(october.tripFinancials["trip-2026-4"], undefined);
  assert.equal(JSON.stringify(input), before);
});
