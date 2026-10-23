import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSupplierPayable,
  createSupplierIdentifier,
  formatSupplierDocument,
  formatSupplierPhone,
  getSupplierDisplayName,
} from "./suppliers.js";

test("generates supplier codes from Firestore document IDs", () => {
  assert.equal(createSupplierIdentifier("supplier-ab12cd34"), "FORN-AB12CD34");
  assert.throws(() => createSupplierIdentifier(""), /gerar o código/);
});

test("formats supplier phone numbers and CPF/CNPJ while preserving incomplete input", () => {
  assert.equal(formatSupplierPhone("11987654321"), "(11) 98765-4321");
  assert.equal(formatSupplierPhone("1133334444"), "(11) 3333-4444");
  assert.equal(formatSupplierDocument("12345678901"), "123.456.789-01");
  assert.equal(formatSupplierDocument("12345678000199"), "12.345.678/0001-99");
});

test("uses registered company name when available", () => {
  assert.equal(getSupplierDisplayName({ name: "Contato", companyName: "Empresa" }), "Empresa");
  assert.equal(getSupplierDisplayName({ name: "Contato" }), "Contato");
});

test("builds merchandise payable installments with exact totals and no duplicate expense", () => {
  const now = new Date(2026, 9, 18, 12);
  const purchase = buildSupplierPayable({
    supplier: { id: "supplier-1", name: "Distribuidora", companyName: "D Ltda" },
    description: "Lote de camisetas",
    purchaseDate: "2026-10-18",
    totalAmount: "1000",
    downPayment: "200",
    installments: [
      { id: "installment-1", amount: "300", dueDate: "2026-11-18" },
      { id: "installment-2", amount: "500", dueDate: "2026-12-18" },
    ],
    now,
  });

  assert.equal(purchase.supplierName, "D Ltda");
  assert.equal(purchase.purchaseType, "inventory");
  assert.equal(purchase.totalAmount, 1000);
  assert.equal(purchase.paidAmount, 200);
  assert.equal(purchase.balance, 800);
  assert.equal(purchase.status, "partial");
  assert.equal(purchase.installments.length, 2);
  assert.equal(purchase.installments[0].paidAmount, 0);
  assert.throws(
    () =>
      buildSupplierPayable({
        supplier: { id: "supplier-1", name: "Fornecedor" },
        description: "Compra",
        purchaseDate: "2026-10-18",
        totalAmount: 1000,
        downPayment: 200,
        installments: [{ amount: 799, dueDate: "2026-11-18" }],
        now,
      }),
    /soma das parcelas/
  );
});

test("allows cash purchases and rejects invalid supplier purchase data", () => {
  const purchase = buildSupplierPayable({
    supplier: { id: "supplier-1", name: "Fornecedor" },
    description: "Compra à vista",
    purchaseDate: "2026-10-18",
    totalAmount: 150,
    downPayment: 150,
    installments: [],
    now: new Date(2026, 9, 18, 12),
  });

  test("records several issued checks in a supplier purchase without counting them as cash paid", () => {
    const purchase = buildSupplierPayable({
      supplier: { id: "supplier-1", name: "Fornecedor" },
      description: "Compra com cheques",
      purchaseDate: "2026-10-18",
      totalAmount: 1000,
      downPayment: 0,
      installments: [
        {
          id: "check-1", amount: 400, dueDate: "2026-11-18",
          method: "cheque", identification: "0001", bankAccount: "bb-pf",
          issueDate: "2026-10-18",
        },
        {
          id: "check-2", amount: 600, dueDate: "2026-12-18",
          method: "cheque", identification: "0002", bankAccount: "bb-pj",
          issueDate: "2026-10-18",
        },
      ],
    });
    assert.equal(purchase.paidAmount, 0);
    assert.equal(purchase.balance, 1000);
    assert.deepEqual(purchase.installments.map((item) => item.method), ["cheque", "cheque"]);
    assert.deepEqual(purchase.installments.map((item) => item.checkStatus), ["issued", "issued"]);
    assert.equal(purchase.installments[0].issueDate.getDate(), 18);
    assert.equal(purchase.installments[1].dueDate.getMonth(), 11);
  });
  assert.equal(purchase.balance, 0);
  assert.equal(purchase.status, "paid");
  assert.throws(
    () =>
      buildSupplierPayable({
        supplier: null,
        description: "Compra",
        purchaseDate: "2026-10-18",
        totalAmount: 100,
        downPayment: 0,
        installments: [],
      }),
    /fornecedor cadastrado/
  );
});
