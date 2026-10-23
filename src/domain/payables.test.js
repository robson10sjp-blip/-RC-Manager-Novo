import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCheckStatusTransition,
  applyPaymentToPayable,
  CHECK_STATUSES,
  correctSupplierPayment,
  createIssuedCheck,
  editSupplierPurchase,
  filterPayablesByTrip,
  getCheckStatus,
  getPayableBalance,
  reusePayablePaymentOperation,
  summarizeChecks,
  summarizePayables,
  validatePayableSchedule,
} from "./payables.js";

const date = (value) => new Date(`${value}T12:00:00`);

test("validates purchase amount, down payment and exact installment totals", () => {
  assert.deepEqual(
    validatePayableSchedule(1000, 200, [
      { amount: 300, dueDate: date("2026-11-10") },
      { amount: 500, dueDate: date("2026-12-10") },
    ]),
    { totalAmount: 1000, paidAmount: 200, balance: 800 }
  );
  assert.deepEqual(validatePayableSchedule(500, 500, []), {
    totalAmount: 500,
    paidAmount: 500,
    balance: 0,
  });
  assert.throws(
    () =>
      validatePayableSchedule(1000, 200, [
        { amount: 799, dueDate: date("2026-11-10") },
      ]),
    /soma das parcelas/
  );
  assert.throws(
    () => validatePayableSchedule(1000, 1100, []),
    /entrada/
  );
  assert.throws(
    () => validatePayableSchedule(1000, 0, [{ amount: 1000 }]),
    /vencimento/
  );
  assert.throws(
    () =>
      validatePayableSchedule(1000, 0, [
        { amount: 500, dueDate: date("2026-11-10"), method: "cheque" },
        { amount: 500, dueDate: date("2026-12-10"), method: "cheque" },
      ]),
    /número de cada cheque/
  );
  assert.throws(
    () =>
      validatePayableSchedule(1000, 0, [
        { amount: 500, dueDate: date("2026-11-10"), method: "cheque", identification: "10", bankAccount: "bb-pf" },
        { amount: 500, dueDate: date("2026-12-10"), method: "cheque", identification: "10", bankAccount: "bb-pj" },
      ]),
    /identificação própria/
  );
  assert.throws(
    () =>
      validatePayableSchedule(1000, 0, [
        { amount: 1000, dueDate: date("2026-11-10"), method: "cheque", identification: "11" },
      ]),
    /conta PF ou PJ/
  );
  assert.deepEqual(
    validatePayableSchedule(1000, 0, [
      { amount: 1000, dueDate: date("2026-11-10"), method: "cheque", identification: "11", bankAccount: "bb-pf" },
    ]),
    { totalAmount: 1000, paidAmount: 0, balance: 1000 }
  );
});

test("applies partial payments once and allocates them to due installments", () => {
  const payable = {
    totalAmount: 1000,
    paidAmount: 100,
    installments: [
      { id: "check-1", amount: 400, paidAmount: 0, dueDate: date("2026-11-01") },
      { id: "check-2", amount: 500, paidAmount: 0, dueDate: date("2026-12-01") },
    ],
  };
  const first = applyPaymentToPayable(payable, { amount: 250 });
  assert.equal(first.paidAmount, 350);
  assert.equal(first.balance, 650);
  assert.equal(first.status, "partial");
  assert.deepEqual(first.allocations, [
    { installmentId: "check-1", amount: 250 },
  ]);
  assert.equal(first.installments[0].paidAmount, 250);
  assert.equal(payable.installments[0].paidAmount, 0);

  const second = applyPaymentToPayable(
    { ...payable, ...first },
    { amount: 150, installmentId: "check-1" }
  );
  assert.equal(second.installments[0].paidAmount, 400);
  assert.equal(second.installments[0].status, "paid");
  assert.equal(second.balance, 500);
  assert.throws(
    () =>
      applyPaymentToPayable(
        { ...payable, ...first },
        { amount: 151, installmentId: "check-1" }
      ),
    /saldo desta parcela/
  );
  assert.throws(
    () => applyPaymentToPayable(payable, { amount: 901 }),
    /maior que o saldo/
  );
});

test("reuses a payment reference on retry to avoid duplicate records", () => {
  const create = () => ({ id: "payment-1" });
  const first = reusePayablePaymentOperation(null, "payable|check|100", create);
  assert.equal(
    reusePayablePaymentOperation(
      first,
      "payable|check|100",
      () => ({ id: "payment-2" })
    ).paymentReference.id,
    "payment-1"
  );
  assert.equal(
    reusePayablePaymentOperation(
      first,
      "payable|check|150",
      () => ({ id: "payment-3" })
    ).paymentReference.id,
    "payment-3"
  );
  assert.throws(
    () => reusePayablePaymentOperation(null, "x", () => ({})),
    /identificar o pagamento/
  );
});

test("issued checks remain liabilities until they are compensated", () => {
  assert.equal(
    getCheckStatus({ method: "cheque", amount: 50, paidAmount: 50 }),
    CHECK_STATUSES.COMPENSATED
  );
  assert.equal(
    getCheckStatus({ method: "cheque", amount: 50, paidAmount: 0 }),
    CHECK_STATUSES.ISSUED
  );
  const payable = {
    id: "payable-checks",
    totalAmount: 1000,
    paidAmount: 100,
    balance: 900,
    status: "partial",
    installments: [
      {
        id: "bb-check",
        amount: 900,
        paidAmount: 0,
        dueDate: date("2026-10-20"),
        method: "cheque",
        identification: "0042",
        bankAccount: "bb-pj",
        checkStatus: CHECK_STATUSES.ISSUED,
      },
    ],
  };

  assert.equal(getPayableBalance(payable), 900);
  assert.throws(
    () => applyPaymentToPayable(payable, { amount: 100, installmentId: "bb-check" }),
    /confirmar a compensação/
  );
  const returned = applyCheckStatusTransition(
    payable,
    "bb-check",
    CHECK_STATUSES.RETURNED,
    date("2026-10-21")
  );
  assert.equal(returned.paidAmount, 100);
  assert.equal(returned.balance, 900);
  assert.equal(returned.installments[0].checkStatus, CHECK_STATUSES.RETURNED);
  assert.equal(returned.installments[0].checkStatusHistory.length, 1);
  assert.throws(
    () =>
      applyCheckStatusTransition(
        { ...payable, ...returned },
        "bb-check",
        CHECK_STATUSES.COMPENSATED
      ),
    /Somente cheques emitidos/
  );

  const compensated = applyCheckStatusTransition(
    payable,
    "bb-check",
    CHECK_STATUSES.COMPENSATED,
    date("2026-10-22")
  );
  assert.equal(compensated.paidAmount, 1000);
  assert.equal(compensated.balance, 0);
  assert.equal(compensated.status, "paid");
  assert.equal(compensated.installments[0].paidAmount, 900);
  assert.equal(
    compensated.installments[0].checkStatus,
    CHECK_STATUSES.COMPENSATED
  );
  assert.equal(compensated.allocations[0].amount, 900);
  assert.throws(
    () =>
      applyCheckStatusTransition(
        { ...payable, ...compensated },
        "bb-check",
        CHECK_STATUSES.COMPENSATED
      ),
    /Somente cheques emitidos/
  );
});

test("supplier edits recalculate installments without reducing the total below paid amounts", () => {
  const payable = {
    id: "supplier-purchase",
    description: "Lote",
    totalAmount: 1000,
    paidAmount: 200,
    balance: 800,
    paymentType: "credit",
    purchaseDate: date("2026-10-18"),
    installments: [
      { id: "part-1", amount: 800, paidAmount: 100, dueDate: date("2026-11-18"), method: "boleto" },
    ],
  };
  const updated = editSupplierPurchase(payable, {
    description: "Lote corrigido",
    totalAmount: 1200,
    purchaseDate: "2026-10-19",
    dueDate: "2026-12-01",
    paymentType: "credit",
  });
  assert.equal(updated.totalAmount, 1200);
  assert.equal(updated.paidAmount, undefined);
  assert.equal(updated.balance, 1000);
  assert.equal(updated.installments[0].amount, 1000);
  assert.equal(updated.installments[0].paidAmount, 100);
  assert.equal(updated.installments[0].dueDate.getDate(), 1);
  assert.throws(
    () => editSupplierPurchase(payable, {
      description: "Menor que recebido",
      totalAmount: 150,
      purchaseDate: "2026-10-19",
      dueDate: "2026-12-01",
      paymentType: "credit",
    }),
    /abaixo do valor já pago/
  );
  assert.throws(
    () => editSupplierPurchase(payable, {
      description: "À vista sem quitar",
      totalAmount: 1000,
      purchaseDate: "2026-10-19",
      paymentType: "cash",
    }),
    /integralmente pago/
  );
});

test("issuing multiple checks reserves obligations without reducing paid or cash totals", () => {
  const payable = {
    totalAmount: 1000,
    paidAmount: 200,
    balance: 800,
    installments: [
      { id: "part-1", amount: 500, paidAmount: 100, dueDate: date("2026-11-01"), method: "boleto" },
      { id: "part-2", amount: 300, paidAmount: 0, dueDate: date("2026-12-01"), method: "boleto" },
    ],
  };
  const withFirst = createIssuedCheck(payable, {
    id: "check-1", amount: 200, identification: "001", bankAccount: "bb-pf",
    issueDate: "2026-10-18", expectedCompensationDate: "2026-11-10",
  });
  const afterFirst = { ...payable, installments: withFirst };
  const withSecond = createIssuedCheck(afterFirst, {
    id: "check-2", amount: 300, identification: "002", bankAccount: "bb-pj",
    issueDate: "2026-10-19", expectedCompensationDate: "2026-12-10",
  });
  assert.equal(withSecond.filter((item) => item.method === "cheque").length, 2);
  assert.equal(withSecond.reduce((sum, item) => sum + item.amount, 0), 800);
  assert.equal(payable.paidAmount, 200);
  assert.equal(getPayableBalance({ ...payable, installments: withSecond }), 800);
  assert.equal(withSecond.find((item) => item.id === "check-1").checkStatus, CHECK_STATUSES.ISSUED);
});

test("correcting a payment updates existing allocation without adding another payment", () => {
  const payable = {
    totalAmount: 1000,
    paidAmount: 350,
    balance: 650,
    installments: [
      { id: "part-1", amount: 400, paidAmount: 250, dueDate: date("2026-11-01"), method: "boleto" },
      { id: "part-2", amount: 500, paidAmount: 0, dueDate: date("2026-12-01"), method: "boleto" },
    ],
  };
  const corrected = correctSupplierPayment(
    payable,
    { amount: 250, installmentId: "part-1", allocations: [{ installmentId: "part-1", amount: 250 }] },
    { amount: 200, date: date("2026-10-19"), installmentId: "part-1", method: "pix" }
  );
  assert.equal(corrected.paidAmount, 300);
  assert.equal(corrected.balance, 700);
  assert.equal(corrected.installments[0].paidAmount, 200);
  assert.equal(corrected.allocations[0].amount, 200);
  assert.equal(payable.paidAmount, 350);
  assert.throws(
    () => correctSupplierPayment(
      { ...payable, paidAmount: 900, balance: 100 },
      { amount: 100, allocations: [] },
      { amount: 300, date: date("2026-10-19"), method: "pix" }
    ),
    /excede o total/
  );
});

test("summarizes issued check values by upcoming compensation windows", () => {
  const summary = summarizeChecks(
    [
      {
        id: "payable-a",
        supplierId: "supplier-a",
        supplierName: "Fornecedor A",
        description: "Compra A",
        installments: [
          {
            id: "check-7",
            amount: 100,
            paidAmount: 0,
            dueDate: date("2026-10-24"),
            method: "cheque",
            identification: "0007",
            bankAccount: "bb-pf",
            checkStatus: CHECK_STATUSES.ISSUED,
          },
          {
            id: "check-15",
            amount: 200,
            paidAmount: 0,
            dueDate: date("2026-11-01"),
            method: "cheque",
            identification: "0015",
            bankAccount: "bb-pj",
            checkStatus: CHECK_STATUSES.ISSUED,
          },
          {
            id: "check-returned",
            amount: 300,
            paidAmount: 0,
            dueDate: date("2026-10-24"),
            method: "cheque",
            identification: "0099",
            bankAccount: "bb-pj",
            checkStatus: CHECK_STATUSES.RETURNED,
          },
        ],
      },
    ],
    date("2026-10-17")
  );

  assert.deepEqual(
    summary.upcomingTotals.map(({ days, total }) => ({ days, total })),
    [
      { days: 7, total: 100 },
      { days: 15, total: 300 },
      { days: 30, total: 300 },
    ]
  );
  assert.equal(summary.checks.length, 3);
  assert.equal(summary.checks[0].supplierName, "Fornecedor A");
  assert.equal(summary.checks[0].checkNumber, "0007");
  assert.equal(summary.checks[0].bankAccount, "bb-pf");
});

test("summarizes paid, overdue, and upcoming supplier obligations", () => {
  const today = date("2026-10-17");
  const summary = summarizePayables(
    [
      {
        id: "overdue",
        totalAmount: 100,
        paidAmount: 20,
        installments: [
          {
            id: "late-check",
            amount: 80,
            paidAmount: 0,
            dueDate: date("2026-10-10"),
            method: "cheque",
            identification: "0054",
          },
        ],
      },
      {
        id: "upcoming",
        supplierName: "Fornecedor B",
        totalAmount: 200,
        paidAmount: 0,
        installments: [
          {
            id: "next",
            amount: 200,
            paidAmount: 50,
            dueDate: date("2026-10-30"),
            method: "boleto",
          },
        ],
      },
      { id: "no-due", totalAmount: 50, paidAmount: 0, installments: [] },
    ],
    today
  );

  assert.equal(summary.totalToPay, 330);
  assert.equal(summary.totalPaid, 20);
  assert.equal(summary.overdueCount, 1);
  assert.equal(summary.overdueTotal, 80);
  assert.equal(summary.upcomingCount, 1);
  assert.equal(summary.upcomingTotal, 150);
  assert.equal(summary.overdueItems[0].identification, "0054");
});

test("filters obligations by trip while preserving the general view", () => {
  const records = [
    { id: "trip3", tripNumber: 3 },
    { id: "trip4", tripNumber: 4 },
    { id: "general", tripNumber: null },
  ];
  assert.equal(filterPayablesByTrip(records).length, 3);
  assert.deepEqual(filterPayablesByTrip(records, "third").map((item) => item.id), ["trip3"]);
  assert.deepEqual(filterPayablesByTrip(records, "4").map((item) => item.id), ["trip4"]);
  assert.deepEqual(filterPayablesByTrip(records, "unassigned").map((item) => item.id), ["general"]);
  assert.equal(getPayableBalance({ totalAmount: 120, paidAmount: 45 }), 75);
});
