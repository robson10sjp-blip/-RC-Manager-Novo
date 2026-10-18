import assert from "node:assert/strict";
import test from "node:test";

import {
  getSalePendingAmount,
  groupReceivablesByCity,
  summarizeReceivablesByDueDate,
} from "./financeReceivables.js";

test("groups due receivables into non-overlapping date windows using remaining balances", () => {
  const today = new Date(2026, 9, 18, 15);
  const summary = summarizeReceivablesByDueDate(
    [
      { dueDate: "2026-10-17", total: 100, amountPaid: 25, pendingAmount: 90 },
      { dueDate: "2026-10-18", total: 80, amountPaid: 30, pendingAmount: 80 },
      { dueDate: "2026-10-19", total: 60, amountPaid: 10 },
      { dueDate: "2026-10-25", total: 70, amountPaid: 20 },
      { dueDate: "2026-10-26", total: 50, amountPaid: 10 },
      { dueDate: "2026-11-17", total: 45, amountPaid: 5 },
      { dueDate: "2026-10-18", total: 50, amountPaid: 50, pendingAmount: 50 },
      { dueDate: "2026-10-18", pendingAmount: 20 },
    ],
    today
  );

  assert.deepEqual(summary, {
    overdue: { count: 1, amount: 75 },
    today: { count: 2, amount: 70 },
    next7Days: { count: 2, amount: 100 },
    next30Days: { count: 2, amount: 80 },
  });
});

test("uses legacy pending amount only when no sale total is available", () => {
  assert.equal(getSalePendingAmount({ pendingAmount: 80 }), 80);
  assert.equal(
    getSalePendingAmount({ total: 100, amountPaid: 35, pendingAmount: 90 }),
    65
  );
  assert.equal(getSalePendingAmount({ total: 100, amountPaid: 100 }), 0);
  assert.equal(
    getSalePendingAmount({ total: 0, amountPaid: 20, pendingAmount: 5 }),
    0
  );
});

test("groups city balances by registered client city without duplicating clients or sales", () => {
  const cities = groupReceivablesByCity(
    [
      { id: "client-a", name: "Ana", city: "Campinas", totalDebt: 0 },
      { id: "client-b", name: "Bia", city: "Campinas", totalDebt: 25 },
      { id: "client-c", name: "Caio", city: "Santos", totalDebt: 0 },
    ],
    [
      {
        id: "sale-a1",
        clientId: "client-a",
        balanceModel: "per-sale",
        total: 100,
        amountPaid: 40,
        pendingAmount: 1,
        tripCity: "Rio de Janeiro",
      },
      {
        id: "sale-a2",
        clientId: "client-a",
        balanceModel: "per-sale",
        total: 80,
        amountPaid: 20,
        pendingAmount: 1,
      },
      {
        id: "sale-b",
        clientId: "client-b",
        balanceModel: "legacy",
        pendingAmount: 15,
        amountPaid: 10,
      },
      {
        id: "sale-c",
        clientId: "client-c",
        balanceModel: "per-sale",
        total: 30,
        amountPaid: 30,
        pendingAmount: 30,
      },
    ]
  );

  assert.equal(cities.length, 2);
  assert.deepEqual(cities[0], {
    city: "Campinas",
    clientsWithPending: 2,
    totalToReceive: 135,
    received: 70,
    clients: [
      {
        clientId: "client-a",
        clientName: "Ana",
        legacyBalance: 0,
        salesPending: 120,
        totalPending: 120,
        received: 60,
        sales: [
          { id: "sale-a1", clientId: "client-a", balanceModel: "per-sale", total: 100, amountPaid: 40, pendingAmount: 1, tripCity: "Rio de Janeiro" },
          { id: "sale-a2", clientId: "client-a", balanceModel: "per-sale", total: 80, amountPaid: 20, pendingAmount: 1 },
        ],
      },
      {
        clientId: "client-b",
        clientName: "Bia",
        legacyBalance: 0,
        salesPending: 15,
        totalPending: 15,
        received: 10,
        sales: [{ id: "sale-b", clientId: "client-b", balanceModel: "legacy", pendingAmount: 15, amountPaid: 10 }],
      },
    ],
  });
  assert.equal(cities[1].city, "Santos");
  assert.equal(cities[1].clientsWithPending, 0);
  assert.equal(cities[1].totalToReceive, 0);
  assert.equal(cities[1].received, 30);
});

test("includes historical client debt only in the all-trip view", () => {
  const clients = [{ id: "legacy", name: "Dora", city: "Campinas", totalDebt: 50 }];
  assert.equal(groupReceivablesByCity(clients, [])[0].totalToReceive, 50);
  assert.deepEqual(groupReceivablesByCity(clients, [], false), []);
});

test("merges legacy city accent and spelling variants in city receivables", () => {
  const clients = [
    { id: "client-a", name: "Ana", city: "Agua Azul do Norte - PA" },
    { id: "client-b", name: "Bia", city: "ÁGUA AZUL NORTE/Pará" },
  ];
  const cities = groupReceivablesByCity(
    clients,
    [
      { id: "sale-a", clientId: "client-a", total: 100, amountPaid: 20 },
      { id: "sale-b", clientId: "client-b", total: 60, amountPaid: 10 },
    ],
    false
  );

  assert.equal(cities.length, 1);
  assert.equal(cities[0].city, "Água Azul do Norte – PA");
  assert.equal(cities[0].clientsWithPending, 2);
  assert.equal(cities[0].totalToReceive, 130);
  assert.equal(cities[0].received, 30);
  assert.equal(clients[0].city, "Agua Azul do Norte - PA");
  assert.equal(clients[1].city, "ÁGUA AZUL NORTE/Pará");
});
