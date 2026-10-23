import assert from "node:assert/strict";
import test from "node:test";

import { buildCollectionsReport } from "./secretaryCollections.js";
import {
  answerSecretaryQueryWithContext,
  createSecretarySnapshot,
} from "./secretary.js";

const today = new Date(2026, 9, 18, 10, 0);

test("collections use only saved travel identity and keep years and unassigned records separate", () => {
  const records = [
    { id: "a", tripId: "2026-four", tripYear: 2026, tripNumber: 4, tripCity: "Tucumã", total: 100, amountPaid: 20 },
    { id: "b", tripId: "2027-four", tripYear: 2027, tripNumber: 4, tripCity: "Xinguara", total: 300, amountPaid: 0 },
    { id: "no-trip", saleDate: "2026-10-01", total: 600, amountPaid: 0 },
  ];
  const report = buildCollectionsReport({ sales: records, today, trip: { id: "2026-four" } });
  assert.equal(report.noDueDate.total, 80);
  assert.equal(buildCollectionsReport({ sales: records, today, trip: "unassigned" }).noDueDate.total, 600);
  assert.equal(buildCollectionsReport({ sales: records, today, trip: "all" }).noDueDate.total, 980);
});

const clients = [
  { id: "c1", name: "Ana", city: "Xinguara - PA" },
  { id: "c2", name: "Bia", city: "tucuma" },
  { id: "c3", name: "Clara", city: "" },
  { id: "c4", name: "Dora", city: "Xinguara – PA" },
];

const sale = (id, clientId, total, amountPaid, dueDate, saleDate = "2026-10-05", tripNumber = 4) => ({
  id,
  clientId,
  total,
  amountPaid,
  pendingAmount: Math.max(total - amountPaid, 0),
  dueDate,
  saleDate,
  balanceModel: "per-sale",
  tripNumber,
});

const sales = [
  sale("overdue", "c1", 500, 100, "2026-10-10"),
  sale("today", "c2", 300, 0, "2026-10-18"),
  sale("future", "c4", 200, 0, "2026-10-25"),
  sale("paid", "c1", 400, 400, "2026-10-01"),
  sale("nodate", "c3", 250, 50, null),
  sale("baddate", "c3", 90, 0, "not-a-date"),
  sale("third", "c2", 700, 0, "2026-08-01", "2026-08-02", 3),
];

test("groups by due date and never calls a pending sale late by itself", () => {
  const report = buildCollectionsReport({ clients, sales, today, trip: 4 });

  assert.deepEqual(report.overdue.items.map((i) => i.saleId), ["overdue"]);
  assert.deepEqual(report.today.items.map((i) => i.saleId), ["today"]);
  assert.deepEqual(report.upcoming.items.map((i) => i.saleId), ["future"]);
  assert.deepEqual(
    report.noDueDate.items.map((i) => i.saleId).sort(),
    ["baddate", "nodate"]
  );
  assert.equal(report.noDueDate.items[0].dueLabel, "Vencimento não informado");
  assert.equal(report.noDueDate.items[0].daysLate, 0);
  assert.equal(report.noDueDate.items[0].dueDate, null);
});

test("computes days late and only the unpaid balance after partial payments", () => {
  const report = buildCollectionsReport({ clients, sales, today, trip: 4 });
  const [late] = report.overdue.items;

  assert.equal(late.daysLate, 8);
  assert.equal(late.pending, 400);
  assert.equal(late.city, "Xinguara – PA");
  assert.equal(report.overdue.total, 400);
  assert.equal(report.today.total, 300);
  assert.equal(report.upcoming.total, 200);
  assert.equal(report.noDueDate.total, 290);
});

test("excludes settled sales from every group", () => {
  const report = buildCollectionsReport({ clients, sales, today, trip: "all" });
  const ids = ["overdue", "today", "upcoming", "noDueDate"].flatMap((key) =>
    report[key].items.map((item) => item.saleId)
  );

  assert.ok(!ids.includes("paid"));
});

test("filters by trip without mixing periods", () => {
  const fourth = buildCollectionsReport({ clients, sales, today, trip: 4 });
  const third = buildCollectionsReport({ clients, sales, today, trip: 3 });
  const all = buildCollectionsReport({ clients, sales, today, trip: "all" });

  assert.deepEqual(third.overdue.items.map((i) => i.saleId), ["third"]);
  assert.equal(third.overdue.items[0].daysLate, 78);
  assert.equal(third.today.count + third.upcoming.count, 0);
  assert.ok(!fourth.overdue.items.some((i) => i.saleId === "third"));
  assert.equal(all.overdue.count, 2);
});

test("uses the client's registered city, with a clear fallback", () => {
  const report = buildCollectionsReport({ clients, sales, today, trip: 4 });
  const byId = Object.fromEntries(
    ["overdue", "today", "upcoming", "noDueDate"]
      .flatMap((key) => report[key].items)
      .map((item) => [item.saleId, item.city])
  );

  assert.equal(byId.today, "Tucumã – PA");
  assert.equal(byId.future, "Xinguara – PA");
  assert.equal(byId.nodate, "Cidade não informada");
});

test("orders overdue by most days late first", () => {
  const report = buildCollectionsReport({
    clients,
    sales: [
      sale("a", "c1", 100, 0, "2026-10-15"),
      sale("b", "c2", 50, 0, "2026-10-01"),
    ],
    today,
    trip: 4,
  });

  assert.deepEqual(report.overdue.items.map((i) => i.saleId), ["b", "a"]);
});

test("includes old client-level balances only in the all-trips view", () => {
  const legacyClients = [{ id: "c9", name: "Eva", city: "Tucumã", totalDebt: 120 }];
  const all = buildCollectionsReport({ clients: legacyClients, sales: [], today, trip: "all" });
  const trip = buildCollectionsReport({ clients: legacyClients, sales: [], today, trip: 4 });

  assert.equal(all.noDueDate.items[0].legacy, true);
  assert.equal(all.noDueDate.total, 120);
  assert.equal(trip.noDueDate.count, 0);
});

test("Secretary answers 'Quem devo cobrar hoje na 4ª viagem?' with a structured, provisional report", () => {
  const snapshot = createSecretarySnapshot({ clients, sales }, today);
  const response = answerSecretaryQueryWithContext(
    "Quem devo cobrar hoje na 4ª viagem?",
    snapshot,
    null,
    null
  );

  assert.equal(response.tripContext.id, "legacy-number-4");
  assert.equal(response.collections.focusToday, true);
  assert.equal(response.collections.provisional, true);
  assert.match(response.answer, /provisória/);
  assert.match(response.answer, /Vencidas: 1 cobrança\(s\)/);
  assert.match(response.answer, /apenas para planejamento/);
  assert.equal(response.collections.report.overdue.count, 1);
});

test("Secretary still asks for the trip when none is given and 'hoje' is absent", () => {
  const snapshot = createSecretarySnapshot({ clients, sales }, today);
  const response = answerSecretaryQueryWithContext("Quem devo cobrar?", snapshot, null, null);

  assert.equal(response.collections, undefined);
  assert.match(response.answer, /viagem específica/);
});

test("the report does not change the source sales", () => {
  const original = JSON.stringify(sales);
  buildCollectionsReport({ clients, sales, today, trip: 4 });
  assert.equal(JSON.stringify(sales), original);
});

const legacy = (id, clientId, extra = {}) => ({
  id,
  clientId,
  total: 1000,
  amountPaid: 200,
  pendingAmount: 800,
  paymentMethod: "prazo",
  saleDate: "2026-09-02",
  tripNumber: 3,
  ...extra,
});

const itemOf = (report, id) =>
  ["overdue", "today", "upcoming", "noDueDate"]
    .flatMap((key) => report[key].items)
    .find((item) => item.saleId === id);

test("legacy sale of 02/09/2026 gets an estimated due date of 01/12/2026", () => {
  const report = buildCollectionsReport({
    clients,
    sales: [legacy("old", "c1")],
    today: new Date(2026, 11, 1, 9),
    trip: "all",
  });
  const item = itemOf(report, "old");

  assert.equal(item.dueSource, "estimated");
  assert.equal(item.dueLabel, "01/12/2026");
  assert.equal(item.dueNote, "Vencimento estimado — 90 dias");
  assert.equal(report.today.count, 1);
  assert.equal(item.pending, 800);
});

test("estimated due date becomes overdue only after it passes", () => {
  const sales90 = [legacy("old", "c1")];
  const before = buildCollectionsReport({ clients, sales: sales90, today, trip: 3 });
  const after = buildCollectionsReport({
    clients,
    sales: sales90,
    today: new Date(2026, 11, 11),
    trip: 3,
  });

  assert.equal(itemOf(before, "old").daysUntil, 44);
  assert.equal(before.upcoming.count, 1);
  assert.equal(itemOf(after, "old").daysLate, 10);
});

test("registered due date always wins over the 90-day estimate", () => {
  const report = buildCollectionsReport({
    clients,
    sales: [legacy("old", "c1", { dueDate: "2026-10-30" })],
    today,
    trip: "all",
  });
  const item = itemOf(report, "old");

  assert.equal(item.dueSource, "registered");
  assert.equal(item.dueLabel, "30/10/2026");
  assert.equal(item.dueNote, "");
});

test("no estimate without a reliable original sale date", () => {
  const report = buildCollectionsReport({
    clients,
    sales: [
      legacy("nosale", "c1", { saleDate: undefined, createdAt: "2026-09-02" }),
      legacy("invalid", "c2", { saleDate: "xx" }),
      legacy("wrongyear", "c3", { saleDate: "1970-01-02" }),
    ],
    today,
    trip: "all",
  });

  for (const id of ["nosale", "invalid", "wrongyear"]) {
    const item = itemOf(report, id);
    assert.equal(item.dueLabel, "Vencimento não informado");
    assert.equal(item.dueSource, null);
  }
});

test("no estimate for cash sales, per-sale records or invalid stored dates", () => {
  const report = buildCollectionsReport({
    clients,
    sales: [
      legacy("cash", "c1", { paymentMethod: "avista" }),
      legacy("persale", "c2", { balanceModel: "per-sale" }),
      legacy("baddue", "c3", { dueDate: "not-a-date" }),
    ],
    today,
    trip: "all",
  });

  for (const id of ["cash", "persale", "baddue"]) {
    assert.equal(itemOf(report, id).dueSource, null);
  }
});

test("settled legacy sales never appear, estimated or not", () => {
  const report = buildCollectionsReport({
    clients,
    sales: [legacy("paid", "c1", { amountPaid: 1000, pendingAmount: 0 })],
    today,
    trip: "all",
  });

  assert.equal(itemOf(report, "paid"), undefined);
});

test("estimation does not mutate sales and Secretary exposes the label", () => {
  const input = [legacy("old", "c1")];
  const before = JSON.stringify(input);
  const snapshot = createSecretarySnapshot({ clients, sales: input }, today);
  const response = answerSecretaryQueryWithContext(
    "Quem devo cobrar na 3ª viagem?",
    snapshot,
    null,
    null
  );

  assert.equal(JSON.stringify(input), before);
  assert.equal(
    response.collections.report.upcoming.items[0].dueNote,
    "Vencimento estimado — 90 dias"
  );
});

test("snapshot exposes pending balance per trip from real sales and payments", () => {
  const snapshot = createSecretarySnapshot({ clients, sales }, today);

  // 4th trip: overdue 400 + today 300 + future 200 + nodate 200 + baddate 90
  assert.equal(snapshot.tripPending[4].amount, 1190);
  assert.equal(snapshot.tripPending[4].salesCount, 5);
  assert.equal(snapshot.tripPending[3].amount, 700);
  assert.equal(snapshot.tripPending[3].salesCount, 1);
});

test("per-trip pending ignores settled sales and discounts partial payments", () => {
  const snapshot = createSecretarySnapshot(
    {
      clients,
      sales: [
        sale("p", "c1", 1000, 250, "2026-11-01", "2026-10-02"),
        sale("q", "c1", 500, 500, "2026-11-01", "2026-10-03"),
      ],
    },
    today
  );

  assert.equal(snapshot.tripPending[4].amount, 750);
  assert.equal(snapshot.tripPending[4].salesCount, 1);
  assert.equal(snapshot.tripPending[3].amount, 0);
});
