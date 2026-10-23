import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeLegacyBalances,
  adjustLegacyClientDebt,
  applyPaymentToSale,
  calculateConsolidatedReceivables,
  calculateTripFinancialSummary,
  calculateSaleAmounts,
  escapeReceiptText,
  isSaleOverdue,
  organizeSalesByTrip2026,
  prepareSaleReceipt,
  reusePaymentOperation,
  selectSalesForTrip,
  summarizeTrips,
  updateStockAfterSale,
  updateStockAfterSaleEdit,
} from "./sales.js";

test("calculates totals and a partial balance for a new purchase", () => {
  assert.deepEqual(
    calculateSaleAmounts(
      [
        { quantity: 2, price: 19.9 },
        { quantity: 1, price: 10.2 },
      ],
      15
    ),
    {
      total: 50,
      amountPaid: 15,
      pendingAmount: 35,
      status: "partial",
    }
  );
});

test("repeated purchases by one client keep independent balances", () => {
  const first = { id: "buy-a", clientId: "client-1", total: 100, amountPaid: 20, pendingAmount: 80 };
  const second = { id: "buy-b", clientId: "client-1", total: 70, amountPaid: 0, pendingAmount: 70 };

  const paidFirst = applyPaymentToSale(first, 30);

  assert.deepEqual(paidFirst, {
    amountPaid: 50,
    pendingAmount: 50,
    status: "partial",
  });
  assert.deepEqual(applyPaymentToSale(second, 70), {
    amountPaid: 70,
    pendingAmount: 0,
    status: "paid",
  });
  assert.equal(second.pendingAmount, 70);
  assert.throws(() => applyPaymentToSale(first, 81), /maior que o saldo/);
  assert.throws(() => applyPaymentToSale(first, 0), /maior que zero/);

  const completed = applyPaymentToSale(first, 80);
  assert.throws(
    () => applyPaymentToSale({ ...first, ...completed }, 80),
    /maior que o saldo/
  );
});

test("reuses the same payment operation ID when retrying an uncertain receipt", () => {
  const first = reusePaymentOperation(null, "sale-1", 25, () => "payment-1");

  assert.equal(
    reusePaymentOperation(first, "sale-1", 25, () => "payment-2").id,
    "payment-1"
  );
  assert.equal(
    reusePaymentOperation(first, "sale-1", 30, () => "payment-3").id,
    "payment-3"
  );
  assert.equal(
    reusePaymentOperation(first, "sale-2", 25, () => "payment-4").id,
    "payment-4"
  );
  assert.throws(
    () => reusePaymentOperation(null, "sale-1", 25, () => ""),
    /identificar o recebimento/
  );
});

test("keeps legacy client totals in sync only for linked legacy sale changes", () => {
  const legacySale = { balanceModel: "legacy" };
  const perSale = { balanceModel: "per-sale" };

  assert.equal(adjustLegacyClientDebt(legacySale, 180, 80, 50), 150);
  assert.equal(adjustLegacyClientDebt(legacySale, 180, 80, 60), 160);
  assert.equal(adjustLegacyClientDebt(legacySale, 180, 80, 0), 100);
  assert.equal(adjustLegacyClientDebt(perSale, 180, 80, 50), null);
  assert.throws(
    () => adjustLegacyClientDebt(legacySale, 60, 80, 70),
    /Concilie os valores/
  );
});

test("marks only unpaid purchases with past due dates as overdue", () => {
  const today = new Date(2026, 9, 17, 12);

  assert.equal(isSaleOverdue("2026-10-16", 1, today), true);
  assert.equal(isSaleOverdue("2026-10-17", 1, today), false);
  assert.equal(isSaleOverdue("2026-10-16", 0, today), false);
  assert.equal(isSaleOverdue("not-a-date", 1, today), false);
});

test("prepares new and legacy receipts without changing stored records", () => {
  const now = new Date(2026, 9, 17, 12);
  const newReceipt = prepareSaleReceipt(
    {
      id: "sale-123456",
      balanceModel: "per-sale",
      saleDate: "2026-10-01",
      dueDate: "2026-11-01",
      tripName: "Outubro",
      tripCity: "Campinas",
    },
    now
  );

  assert.equal(newReceipt.receiptNumber, "123456");
  assert.equal(newReceipt.saleDate.getDate(), 1);
  assert.equal(newReceipt.dueDate, "2026-11-01");
  assert.equal(newReceipt.tripCity, "Campinas");

  const legacyReceipt = prepareSaleReceipt(
    {
      id: "old-sale",
      paymentMethod: "prazo",
      createdAt: { toDate: () => new Date(2026, 0, 1, 12) },
    },
    now
  );

  assert.equal(legacyReceipt.saleDate.getMonth(), 0);
  assert.equal(legacyReceipt.dueDate.getDate(), 1);
  assert.equal(legacyReceipt.dueDate.getMonth(), 3);
});

test("uses the sale identifier when a receipt number is missing or zero", () => {
  const sale = {
    id: "sale-a1b2c3",
    receiptNumber: "000000",
  };

  const receipt = prepareSaleReceipt(sale, new Date(2026, 9, 17));

  assert.equal(receipt.receiptNumber, "a1b2c3");
  assert.equal(sale.receiptNumber, "000000");

  const alphanumericReceipt = prepareSaleReceipt(
    { id: "sale-abcdef" },
    new Date(2026, 9, 17)
  );
  assert.equal(alphanumericReceipt.receiptNumber, "abcdef");
});

test("escapes user-entered values inserted into printable receipt markup", () => {
  assert.equal(
    escapeReceiptText(`<img src=x onerror='alert("x")'>&`),
    "&lt;img src=x onerror=&#39;alert(&quot;x&quot;)&#39;&gt;&amp;"
  );
});

test("updates stock for sales and edits without allowing negative inventory", () => {
  assert.equal(updateStockAfterSale(10, 3), 7);
  assert.equal(updateStockAfterSaleEdit(7, 3, 5), 5);
  assert.throws(() => updateStockAfterSale(2, 3), /estoque insuficiente/i);
  assert.throws(() => updateStockAfterSaleEdit(1, 0, 2), /estoque insuficiente/i);
});

test("groups sales totals by trip and city", () => {
  assert.deepEqual(
    summarizeTrips([
      { tripName: "Outubro", tripCity: "Campinas", total: 100, amountPaid: 40, pendingAmount: 60 },
      { tripName: "outubro", tripCity: "campinas", total: 50, amountPaid: 10, pendingAmount: 40 },
      { tripName: "Novembro", tripCity: "Santos", total: 80, amountPaid: 80, pendingAmount: 0 },
      { total: 999, amountPaid: 999, pendingAmount: 0 },
    ]),
    [
      {
        name: "Outubro",
        city: "Campinas",
        salesCount: 2,
        sold: 150,
        received: 50,
        pending: 100,
      },
      {
        name: "Novembro",
        city: "Santos",
        salesCount: 1,
        sold: 80,
        received: 80,
        pending: 0,
      },
    ]
  );
});

test("proposes 2026 trip candidates from original sale dates and separates conflicts", () => {
  const sales = [
    { id: "jul", saleDate: "2026-07-01", tripName: "", total: 100, amountPaid: 25, pendingAmount: 75, clientId: "client-a" },
    { id: "sep", saleDate: "2026-09-30", tripName: "3ª viagem", total: 80, amountPaid: 80, pendingAmount: 0, clientId: "client-a" },
    { id: "oct", saleDate: "2026-10-01", tripName: "Viagem de outubro", total: 200, amountPaid: 50, pendingAmount: 150, clientId: "client-a" },
    { id: "different-trip-name", saleDate: "2026-10-05", tripName: "3ª viagem", total: 50, amountPaid: 10, pendingAmount: 40 },
    { id: "different-values", saleDate: "2026-10-08", tripName: "4ª viagem", total: 90, amountPaid: 20, pendingAmount: 30 },
    { id: "outside-range", saleDate: "2026-06-30", total: 60, amountPaid: 0, pendingAmount: 60 },
    { id: "missing-date", saleDate: "", total: 30, amountPaid: 0, pendingAmount: 30 },
    { id: "after-2026", saleDate: "2027-01-01", total: 40, amountPaid: 0, pendingAmount: 40 },
  ];

  const result = organizeSalesByTrip2026(sales);

  assert.deepEqual(result.thirdTrip.sales.map((sale) => sale.id), ["jul", "sep"]);
  assert.deepEqual(
    result.fourthTrip.sales.map((sale) => sale.id),
    ["oct", "different-trip-name", "different-values"]
  );
  assert.deepEqual(
    result.review.sales.map((sale) => sale.id),
    ["outside-range", "missing-date", "after-2026"]
  );
  assert.deepEqual(
    [result.thirdTrip.count, result.thirdTrip.sold, result.thirdTrip.received, result.thirdTrip.pending],
    [2, 180, 105, 75]
  );
  assert.deepEqual(
    [result.fourthTrip.count, result.fourthTrip.sold, result.fourthTrip.received, result.fourthTrip.pending],
    [3, 340, 80, 220]
  );
  assert.equal(result.fourthTrip.sales[1].tripNumber, 4);
  assert.equal(result.fourthTrip.sales[2].tripNumber, 4);
  assert.equal(result.review.sales[1].reviewReason, "A venda não tem data original nem data de criação confiável.");
});

test("selects proposed trip sales without persisting classification", () => {
  const sales = [
    { id: "third", saleDate: "2026-07-10", total: 100, amountPaid: 20, pendingAmount: 80 },
    { id: "fourth", saleDate: "2026-10-10", total: 200, amountPaid: 40, pendingAmount: 160 },
    { id: "review", saleDate: "2026-06-30", total: 50, amountPaid: 0, pendingAmount: 50 },
  ];
  const organization = organizeSalesByTrip2026(sales);

  assert.deepEqual(selectSalesForTrip(organization, "third").map(({ id }) => id), ["third"]);
  assert.deepEqual(selectSalesForTrip(organization, "fourth").map(({ id }) => id), ["fourth"]);
  assert.deepEqual(selectSalesForTrip(organization, "review").map(({ id }) => id), ["review"]);
  assert.deepEqual(selectSalesForTrip(organization).map(({ id }) => id), ["third", "fourth", "review"]);
  assert.deepEqual(sales.map(({ tripNumber }) => tripNumber), [undefined, undefined, undefined]);
});

test("selects first and second trip sales only from explicit trip links", () => {
  const sales = [
    { id: "first", tripNumber: 1, saleDate: "2026-04-10" },
    { id: "second", tripNumber: "2", saleDate: "2026-05-10" },
    { id: "unassigned", saleDate: "2026-06-10" },
  ];
  const organization = organizeSalesByTrip2026(sales);

  assert.deepEqual(
    selectSalesForTrip(organization, "1").map(({ id }) => id),
    ["first"]
  );
  assert.deepEqual(
    selectSalesForTrip(organization, "2").map(({ id }) => id),
    ["second"]
  );
  assert.deepEqual(selectSalesForTrip(organization, "unassigned"), []);
});

test("keeps one client's pending balances separate when filtering trips", () => {
  const client = { id: "client-1", name: "Cliente", totalDebt: 0 };
  const sales = [
    {
      id: "third-sale",
      clientId: client.id,
      saleDate: "2026-07-15",
      total: 120,
      amountPaid: 20,
      pendingAmount: 100,
    },
    {
      id: "fourth-sale",
      clientId: client.id,
      saleDate: "2026-10-15",
      total: 200,
      amountPaid: 50,
      pendingAmount: 150,
    },
  ];
  const organization = organizeSalesByTrip2026(sales);
  const thirdTripReceivables = calculateConsolidatedReceivables(
    [client],
    selectSalesForTrip(organization, "third")
  );
  const fourthTripReceivables = calculateConsolidatedReceivables(
    [client],
    selectSalesForTrip(organization, "fourth")
  );

  assert.equal(thirdTripReceivables.totalPending, 100);
  assert.deepEqual(
    thirdTripReceivables.clients[0].sales.map(({ id }) => id),
    ["third-sale"]
  );
  assert.equal(fourthTripReceivables.totalPending, 150);
  assert.deepEqual(
    fourthTripReceivables.clients[0].sales.map(({ id }) => id),
    ["fourth-sale"]
  );
});

test("calculates estimated profit and cash flow separately with complete cost data", () => {
  const summary = calculateTripFinancialSummary(
    [
      {
        total: 200,
        amountPaid: 80,
        pendingAmount: 120,
        items: [{ productId: "p-1", quantity: 2 }],
      },
    ],
    [{ value: 30 }],
    [{ id: "p-1", costPrice: 40 }]
  );

  assert.deepEqual(summary, {
    sold: 200,
    received: 80,
    pending: 120,
    expenses: 30,
    personalWithdrawals: 0,
    supplierPayments: 0,
    supplierPurchases: 0,
    supplierChecksPending: 0,
    supplierChecksCompensated: 0,
    supplierOperationalPurchases: 0,
    costOfGoodsSold: 80,
    estimatedProfit: 90,
    cashFlow: 50,
    salesCount: 1,
    hasCompleteCostData: true,
  });
});

test("subtracts supplier payments from cash flow without charging profit twice", () => {
  const summary = calculateTripFinancialSummary(
    [
      {
        total: 200,
        amountPaid: 80,
        pendingAmount: 120,
        items: [{ productId: "p-1", quantity: 2 }],
      },
    ],
    [{ value: 30 }],
    [{ id: "p-1", costPrice: 40 }],
    [{ paidAmount: 25 }]
  );

  assert.equal(summary.supplierPayments, 25);
  assert.equal(summary.supplierOperationalPurchases, 0);
  assert.equal(summary.supplierPurchases, 0);
  assert.equal(summary.cashFlow, 25);
  assert.equal(summary.estimatedProfit, 90);
});

test("separates supplier merchandise purchases and issued checks from cash payments", () => {
  const summary = calculateTripFinancialSummary(
    [{
      total: 1000,
      amountPaid: 1000,
      pendingAmount: 0,
      items: [{ productId: "p-1", quantity: 1 }],
    }],
    [],
    [{ id: "p-1", costPrice: 100 }],
    [
      {
        purchaseType: "inventory",
        totalAmount: 10000,
        paidAmount: 2000,
        installments: [
          { method: "cheque", amount: 3000, paidAmount: 0, checkStatus: "issued" },
          { method: "cheque", amount: 2000, paidAmount: 2000, checkStatus: "compensated" },
        ],
      },
      {
        purchaseType: "operational",
        totalAmount: 500,
        paidAmount: 100,
      },
    ]
  );

  assert.equal(summary.supplierPurchases, 10000);
  assert.equal(summary.supplierPayments, 2100);
  assert.equal(summary.supplierChecksPending, 3000);
  assert.equal(summary.supplierChecksCompensated, 2000);
  assert.equal(summary.estimatedProfit, 400);
  assert.equal(summary.cashFlow, -1100);
});

test("personal withdrawals reduce cash flow without reducing operating profit", () => {
  const summary = calculateTripFinancialSummary(
    [
      {
        total: 200,
        amountPaid: 150,
        pendingAmount: 50,
        items: [{ productId: "p-1", quantity: 2 }],
      },
    ],
    [
      { category: "hotel", value: 20 },
      { category: "pessoal", kind: "personal_withdrawal", value: 30 },
    ],
    [{ id: "p-1", costPrice: 40 }]
  );

  assert.equal(summary.expenses, 20);
  assert.equal(summary.personalWithdrawals, 30);
  assert.equal(summary.estimatedProfit, 100);
  assert.equal(summary.cashFlow, 100);
});

test("counts operational supplier purchases once in profit, not again when paid", () => {
  const summary = calculateTripFinancialSummary(
    [
      {
        total: 200,
        amountPaid: 80,
        pendingAmount: 120,
        items: [{ productId: "p-1", quantity: 2 }],
      },
    ],
    [],
    [{ id: "p-1", costPrice: 40 }],
    [
      {
        purchaseType: "operational",
        totalAmount: 30,
        paidAmount: 10,
      },
    ]
  );

  assert.equal(summary.supplierOperationalPurchases, 30);
  assert.equal(summary.estimatedProfit, 90);
  assert.equal(summary.cashFlow, 70);
});

test("does not report estimated profit when cost of goods data is missing", () => {
  const summary = calculateTripFinancialSummary(
    [{ total: 200, amountPaid: 100, pendingAmount: 100, items: [{ quantity: 1 }] }],
    [{ value: 20 }]
  );

  assert.equal(summary.estimatedProfit, null);
  assert.equal(summary.cashFlow, 80);
  assert.equal(summary.hasCompleteCostData, false);
  assert.equal(
    calculateTripFinancialSummary([
      { total: 100, amountPaid: 100, pendingAmount: 0 },
    ]).estimatedProfit,
    null
  );
});

test("reads different Firestore-compatible sale date formats and honors trip boundaries", () => {
  const result = organizeSalesByTrip2026(
    [
      {
        id: "timestamp-third",
        saleDate: { toDate: () => new Date(2026, 6, 1, 12) },
        tripName: "3ª viagem",
        total: 100,
        amountPaid: 0,
        pendingAmount: 100,
      },
      {
        id: "seconds-fourth",
        saleDate: { seconds: Date.UTC(2026, 9, 1, 12) / 1000 },
        tripName: "Viagem nº 4",
        total: 100,
        amountPaid: 0,
        pendingAmount: 100,
      },
      {
        id: "brazilian-date",
        saleDate: "30/09/2026",
        tripName: "",
        total: 100,
        amountPaid: 0,
        pendingAmount: 100,
      },
      {
        id: "string-year-end",
        saleDate: "2026-12-31",
        tripName: "4ª viagem",
        total: 100,
        amountPaid: 0,
        pendingAmount: 100,
      },
      {
        id: "outside-after-year",
        saleDate: new Date(2027, 0, 1, 12),
        total: 100,
        amountPaid: 0,
        pendingAmount: 100,
      },
      {
        id: "created-at-fallback",
        createdAt: { seconds: Date.UTC(2026, 7, 1, 12) / 1000 },
        updatedAt: new Date(2026, 9, 1, 12),
        dueDate: new Date(2026, 9, 1, 12),
        paymentDate: new Date(2026, 9, 1, 12),
        total: 100,
        amountPaid: 0,
        pendingAmount: 100,
      },
    ],
  );

  assert.deepEqual(
    result.thirdTrip.sales.map((sale) => sale.id),
    ["timestamp-third", "brazilian-date", "created-at-fallback"]
  );
  assert.deepEqual(
    result.fourthTrip.sales.map((sale) => sale.id),
    ["seconds-fourth", "string-year-end"]
  );
  assert.equal(result.review.sales[0].id, "outside-after-year");
  assert.equal(
    result.thirdTrip.sales[2].dateSource,
    "createdAt"
  );
});

test("consolidates legacy balances and linked purchases without double counting", () => {
  const result = calculateConsolidatedReceivables(
    [
      { id: "legacy-client", name: "Cliente legado", totalDebt: 150 },
      { id: "per-sale-client", name: "Cliente compra", totalDebt: 40 },
      { id: "legacy-only", name: "Cliente histórico", totalDebt: 30 },
    ],
    [
      {
        id: "legacy-sale",
        clientId: "legacy-client",
        pendingAmount: 150,
      },
      {
        id: "per-sale-sale",
        clientId: "per-sale-client",
        balanceModel: "per-sale",
        pendingAmount: 70,
      },
      {
        id: "unlinked-sale",
        clientId: "missing-client",
        pendingAmount: 25,
      },
      {
        id: "sale-without-client",
        pendingAmount: 15,
      },
    ]
  );

  assert.equal(result.totalPending, 330);
  assert.deepEqual(
    result.clients.map(({ clientId, legacyBalance, salesPending, totalPending }) => ({
      clientId,
      legacyBalance,
      salesPending,
      totalPending,
    })),
    [
      {
        clientId: "legacy-client",
        legacyBalance: 0,
        salesPending: 150,
        totalPending: 150,
      },
      {
        clientId: "per-sale-client",
        legacyBalance: 40,
        salesPending: 70,
        totalPending: 110,
      },
      {
        clientId: "legacy-only",
        legacyBalance: 30,
        salesPending: 0,
        totalPending: 30,
      },
    ]
  );
  assert.equal(result.unassignedPending, 40);
  assert.equal(result.unassignedSales.length, 2);
});

test("uses linked legacy sale balances to resolve the historical 400 difference", () => {
  const clients = [
    { id: "client-a", totalDebt: 140 },
    { id: "client-b", totalDebt: 300 },
    { id: "client-c", totalDebt: 100 },
  ];
  const sales = [
    { clientId: "client-a", pendingAmount: 290 },
    { clientId: "client-b", pendingAmount: 450 },
    { clientId: "client-c", pendingAmount: 200 },
  ];
  const result = calculateConsolidatedReceivables(clients, sales);
  const clientBalanceSum = clients.reduce(
    (sum, client) => sum + client.totalDebt,
    0
  );
  const salesBalanceSum = sales.reduce(
    (sum, sale) => sum + sale.pendingAmount,
    0
  );

  assert.equal(salesBalanceSum - clientBalanceSum, 400);
  assert.equal(result.totalPending, salesBalanceSum);
});

test("reports legacy balance differences only as reconciliation candidates", () => {
  const result = analyzeLegacyBalances(
    [
      { id: "client-1", name: "Ana", totalDebt: 100 },
      { id: "client-2", name: "Bia", totalDebt: 40 },
      { id: "client-3", name: "Caio", totalDebt: 0 },
    ],
    [
      { clientId: "client-1", pendingAmount: 80 },
      { clientId: "client-3", pendingAmount: 25 },
    ]
  );

  assert.deepEqual(result, [
    {
      clientId: "client-1",
      clientName: "Ana",
      legacyBalance: 100,
      purchaseBalance: 80,
      difference: 20,
      needsReview: true,
      hasLegacyOnly: false,
      hasPurchasesOnly: false,
    },
    {
      clientId: "client-2",
      clientName: "Bia",
      legacyBalance: 40,
      purchaseBalance: 0,
      difference: 40,
      needsReview: false,
      hasLegacyOnly: true,
      hasPurchasesOnly: false,
    },
    {
      clientId: "client-3",
      clientName: "Caio",
      legacyBalance: 0,
      purchaseBalance: 25,
      difference: -25,
      needsReview: false,
      hasLegacyOnly: false,
      hasPurchasesOnly: true,
    },
  ]);
});

import {
  applyStockDelta,
  calculateStockDeltas,
  getMaxEditableQuantity,
} from "./sales.js";

// Simula a transação: calcula tudo e só confirma se nenhum produto falhar.
function editSale(stock, oldItems, newItems) {
  const next = { ...stock };
  for (const [productId, delta] of calculateStockDeltas(oldItems, newItems)) {
    next[productId] = applyStockDelta(next[productId], delta, productId);
  }
  return next;
}

const pants36 = (quantity) => ({ productId: "calca-36", quantity });
const pants38 = (quantity) => ({ productId: "calca-38", quantity });
const shirt = (quantity) => ({ productId: "blusa-m", quantity });

test("edit without changing items does not touch stock (5 stock, sold 3)", () => {
  const stock = { "calca-36": 2 };
  assert.equal(calculateStockDeltas([pants36(3)], [pants36(3)]).size, 0);
  assert.deepEqual(editSale(stock, [pants36(3)], [pants36(3)]), stock);
});

test("adding a new product only requires stock for the added item", () => {
  const stock = { "calca-36": 2, "blusa-m": 4 };
  assert.deepEqual(
    editSale(stock, [pants36(3)], [pants36(3), shirt(4)]),
    { "calca-36": 2, "blusa-m": 0 }
  );
  assert.throws(
    () => editSale(stock, [pants36(3)], [pants36(3), shirt(5)]),
    /Estoque insuficiente/
  );
});

test("increasing deducts only the difference", () => {
  assert.deepEqual(
    editSale({ "calca-36": 2 }, [pants36(3)], [pants36(4)]),
    { "calca-36": 1 }
  );
  assert.throws(
    () => editSale({ "calca-36": 2 }, [pants36(3)], [pants36(6)]),
    /Estoque insuficiente/
  );
});

test("decreasing or removing returns stock", () => {
  assert.deepEqual(
    editSale({ "calca-36": 2 }, [pants36(3)], [pants36(2)]),
    { "calca-36": 3 }
  );
  assert.deepEqual(
    editSale({ "calca-36": 2, "blusa-m": 1 }, [pants36(3), shirt(1)], [shirt(1)]),
    { "calca-36": 5, "blusa-m": 1 }
  );
  assert.deepEqual(
    editSale({ "calca-36": 2 }, [pants36(3)], [pants36(0)]),
    { "calca-36": 5 }
  );
});

test("changing size returns the old size and deducts the new one", () => {
  assert.deepEqual(
    editSale({ "calca-36": 2, "calca-38": 1 }, [pants36(3)], [pants38(1)]),
    { "calca-36": 5, "calca-38": 0 }
  );
  assert.throws(
    () => editSale({ "calca-36": 2, "calca-38": 1 }, [pants36(3)], [pants38(2)]),
    /Estoque insuficiente/
  );
});

test("multiple products and repeated lines are grouped", () => {
  const deltas = calculateStockDeltas(
    [pants36(2), pants36(1), pants38(2), shirt(1)],
    [pants36(3), pants38(1), shirt(2), { productId: "novo", quantity: 2 }]
  );
  assert.deepEqual(Object.fromEntries(deltas), {
    "calca-38": -1,
    "blusa-m": 1,
    novo: 2,
  });
});

test("a failed edit leaves stock untouched (all-or-nothing)", () => {
  const stock = { "calca-36": 2, "blusa-m": 0 };
  const snapshot = { ...stock };
  assert.throws(() =>
    editSale(stock, [pants36(3)], [pants36(1), shirt(1)])
  );
  assert.deepEqual(stock, snapshot);
});

test("stock never goes negative and max editable includes the original quantity", () => {
  assert.throws(() => applyStockDelta(0, 1, "x"), /Estoque insuficiente/);
  assert.equal(applyStockDelta(2, -3), 5);
  assert.equal(getMaxEditableQuantity(2, 3), 5);
  assert.equal(getMaxEditableQuantity(0, 0), 0);
});

test("deleting a sale returns each product exactly once, summing repeated lines", () => {
  const items = [pants36(2), pants36(1), pants38(2)];
  const stock = { "calca-36": 2, "calca-38": 0 };
  const after = editSale(stock, items, []);
  assert.deepEqual(after, { "calca-36": 5, "calca-38": 2 });
  // estoque original (5 e 2) restaurado, sem devolver duas vezes
  assert.equal(calculateStockDeltas(items, []).get("calca-36"), -3);
});

test("deleting a sale with no valid items returns nothing", () => {
  assert.equal(calculateStockDeltas([{ quantity: 2 }], []).size, 0);
  assert.equal(calculateStockDeltas([], []).size, 0);
});

import { formatItemLabel } from "./sales.js";

test("item label shows the selected size and is not duplicated", () => {
  assert.equal(formatItemLabel({ name: "Calça feminina", size: "36" }), "Calça feminina — Tam. 36");
  assert.equal(formatItemLabel({ name: "Calça feminina — Tam. 36", size: "36" }), "Calça feminina — Tam. 36");
  assert.equal(formatItemLabel({ name: "Blusa" }), "Blusa");
});

test("receipt items keep each size separate without changing amounts", () => {
  const sale = {
    id: "abc123",
    items: [
      { productId: "a", name: "Calça feminina", size: "36", quantity: 1, unitPrice: 50, subtotal: 50 },
      { productId: "b", name: "Calça feminina", size: "38", quantity: 2, unitPrice: 50, subtotal: 100 },
    ],
    total: 150,
  };
  const receipt = prepareSaleReceipt(sale);
  assert.deepEqual(receipt.items.map((item) => item.name), ["Calça feminina — Tam. 36", "Calça feminina — Tam. 38"]);
  assert.equal(receipt.items[1].subtotal, 100);
  assert.equal(receipt.total, 150);
  assert.equal(sale.items[0].name, "Calça feminina");
});
