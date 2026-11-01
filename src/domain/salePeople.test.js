import assert from "node:assert/strict";
import test from "node:test";
import { assignSaleItems, buildPersonReceiptRows, groupSalePeople, removeSalePerson, saleItemLabel, salePeopleFields, validateSalePeople } from "./salePeople.js";
import { applyPaymentToSale, buildSaleDateUpdate, calculateConsolidatedReceivables, calculateSaleAmounts, calculateStockDeltas, createSaleEditForm, prepareSaleReceipt } from "./sales.js";

const fixture = () => ({
  id: "one-sale", clientId: "maria-client", clientName: "Maria", balanceModel: "per-sale",
  saleDate: "2026-10-25", tripCity: "Tucumã", paymentMethod: "prazo",
  people: [{ id: "maria", name: "Maria", relationship: "" }, { id: "joao", name: "João", relationship: "Filho" }],
  items: [
    { productId: "shirt", name: "Camisa", quantity: 3, unitPrice: 100, subtotal: 300, personId: "maria" },
    { productId: "shirt", name: "Camisa", quantity: 2, unitPrice: 100, subtotal: 200, personId: "joao" },
  ],
  total: 500, amountPaid: 0, pendingAmount: 500,
});

test("family items make one 500 sale with calculated 300/200 subtotals", () => {
  const sale = fixture();
  validateSalePeople(sale);
  assert.deepEqual(groupSalePeople(sale).map(({ name, subtotal }) => [name, subtotal]), [["Maria", 300], ["João", 200]]);
  assert.equal(calculateSaleAmounts(sale.items).total, 500);
  assert.deepEqual([...calculateStockDeltas([], sale.items)], [["shirt", 5]]);
  const paid = { ...sale, ...applyPaymentToSale(sale, 100) };
  assert.equal(paid.id, sale.id);
  assert.equal(paid.amountPaid, 100);
  assert.equal(paid.pendingAmount, 400);
  assert.deepEqual(paid.people, sale.people);
  const balance = calculateConsolidatedReceivables([{ id: sale.clientId, name: "Maria", totalDebt: 0 }], [paid]);
  assert.equal(balance.totalPending, 400);
});

test("reload and rename/reassignment update only allocation fields on a paid sale", () => {
  const sale = { ...fixture(), amountPaid: 100, pendingAmount: 400 };
  const form = createSaleEditForm(JSON.parse(JSON.stringify(sale)));
  assert.deepEqual(form.people, sale.people);
  form.people[1].name = "João Silva";
  form.items[0].personId = "joao";
  const patch = buildSaleDateUpdate(sale, form);
  assert.deepEqual(Object.keys(patch).sort(), ["items", "people"]);
  const edited = { ...sale, ...patch };
  assert.deepEqual([...calculateStockDeltas(sale.items, edited.items)], []);
  assert.equal(edited.total, 500);
  assert.equal(edited.pendingAmount, 400);
  assert.equal(edited.items[0].personId, "joao");
  assert.equal(edited.people[1].name, "João Silva");
  assert.deepEqual(buildSaleDateUpdate(edited, createSaleEditForm(edited)), {});
});

test("removing a person requires reassigning items and never changes stock or amounts", () => {
  const sale = fixture();
  assert.throws(() => removeSalePerson(sale, "joao", ""), /transferir/);
  const changed = removeSalePerson(sale, "joao", "maria");
  validateSalePeople(changed);
  assert.equal(changed.people.length, 1);
  assert.equal(groupSalePeople(changed)[0].subtotal, 500);
  assert.deepEqual([...calculateStockDeltas(sale.items, changed.items)], []);
  assert.throws(() => validateSalePeople({ ...sale, people: [{ id: "maria", name: "" }] }), /nome/);
  assert.throws(() => validateSalePeople({ ...sale, items: [{ ...sale.items[0], personId: "missing" }] }), /pessoa de cada item/);
});

test("quantity edits only apply the aggregate product difference", () => {
  const sale = fixture();
  const items = sale.items.map((item, index) => index ? { ...item, quantity: 3 } : item);
  assert.deepEqual([...calculateStockDeltas(sale.items, items)], [["shirt", 1]]);
});

test("premium receipt groups people without changing payment totals and old receipts keep rows", () => {
  const sale = fixture();
  const prepared = prepareSaleReceipt(sale);
  const rows = buildPersonReceiptRows(prepared.items, prepared);
  assert.deepEqual(rows.filter((row) => row.type === "person").map((row) => row.name), ["Maria", "João"]);
  assert.deepEqual(rows.filter((row) => row.type === "subtotal").map((row) => row.subtotal), [300, 200]);
  const old = { ...sale };
  delete old.people;
  assert.deepEqual(groupSalePeople(old), []);
  assert.equal(buildPersonReceiptRows(old.items, old), old.items);
  assert.deepEqual(salePeopleFields(old), {});
  assert.equal(createSaleEditForm(old).people, undefined);
});

test("adding family allocation to an old sale preserves the original timestamp and money", () => {
  const sale = fixture();
  delete sale.balanceModel;
  delete sale.saleDate;
  delete sale.people;
  sale.createdAt = { seconds: Date.parse("2026-08-15T12:00:00-03:00") / 1000 };
  sale.items = sale.items.map((item) => {
    const saved = { ...item };
    delete saved.personId;
    return saved;
  });
  const form = createSaleEditForm(sale);
  form.people = fixture().people;
  form.items = form.items.map((item, index) => ({ ...item, personId: form.people[index].id }));
  const patch = buildSaleDateUpdate(sale, form);
  assert.deepEqual(Object.keys(patch).sort(), ["items", "people"]);
  const updated = { ...sale, ...patch };
  assert.equal(Object.hasOwn(updated, "saleDate"), false);
  assert.deepEqual(updated.createdAt, sale.createdAt);
  assert.equal(updated.total, sale.total);
});

test("six blouses split 3/3, reload and partial transfer preserve discounts, payments and stock", () => {
  const stored = {
    ...fixture(), total: 145, amountPaid: 50, pendingAmount: 95, discount: 5,
    payments: [{ id: "receipt-1", saleId: "one-sale", value: 50 }],
    items: [{ productId: "blouse-m", name: "Blusa", size: "M", color: "Azul",
      quantity: 6, unitPrice: 25, subtotal: 149.99, historical: "keep" }],
  };
  const before = structuredClone(stored);
  let form = createSaleEditForm(stored);
  form = assignSaleItems(form, { 0: 3 }, "joao");
  assert.equal(form.items.filter((item) => !item.personId).reduce((sum, item) => sum + item.quantity, 0), 3);
  form = assignSaleItems(form, { 0: 3 }, "maria");
  validateSalePeople(form);
  const patch = buildSaleDateUpdate(stored, form);
  assert.deepEqual(Object.keys(patch), ["items"]);
  const saved = JSON.parse(JSON.stringify({ ...stored, ...patch }));
  assert.deepEqual(groupSalePeople(saved).map((person) => person.subtotal), groupSalePeople(form).map((person) => person.subtotal));
  assert.deepEqual(saved.items.map((item) => item.quantity), [3, 3]);
  assert.equal(saved.items.reduce((sum, item) => sum + Math.round(item.subtotal * 100), 0), 14999);
  assert.equal(saved.items.some((item) => Object.hasOwn(item, "sourceIndex")), false);
  assert.equal(saved.items.every((item) => item.historical === "keep" && item.size === "M"), true);
  for (const key of ["total", "discount", "amountPaid", "pendingAmount", "payments", "clientId", "id"]) {
    assert.deepEqual(saved[key], stored[key], key);
  }
  assert.deepEqual([...calculateStockDeltas(stored.items, saved.items)], []);
  assert.deepEqual(buildSaleDateUpdate(saved, createSaleEditForm(saved)), {});
  const moved = assignSaleItems(createSaleEditForm(saved), { 0: 1 }, "joao");
  const edited = { ...saved, ...buildSaleDateUpdate(saved, moved) };
  assert.deepEqual(groupSalePeople(edited).map((person) => person.items.reduce((sum, item) => sum + item.quantity, 0)), [2, 4]);
  assert.deepEqual([...calculateStockDeltas(saved.items, edited.items)], []);
  assert.deepEqual(stored, before);
});

test("batch assignment keeps sizes, prices, zero prices and distinct sources intact", () => {
  const stored = { ...fixture(), items: [
    { productId: "blouse-m", name: "Blusa", size: "M", color: "Azul", quantity: 6, price: 25, subtotal: 150 },
    { productId: "blouse-g", name: "Blusa", size: "G", color: "Azul", quantity: 2, price: 30, subtotal: 60 },
    { productId: "blouse-m", name: "Blusa", size: "M", quantity: 1, price: 0, subtotal: 0 },
  ] };
  let form = assignSaleItems(createSaleEditForm(stored), { 0: 3, 1: 1, 2: 1 }, "joao");
  const unassigned = Object.fromEntries(form.items.flatMap((item, index) => !item.personId ? [[index, item.quantity]] : []));
  form = assignSaleItems(form, unassigned, "maria");
  const patch = buildSaleDateUpdate(stored, form);
  assert.equal(patch.items.length, 5);
  assert.deepEqual([...calculateStockDeltas(stored.items, patch.items)], []);
  const rows = buildPersonReceiptRows(prepareSaleReceipt({ ...stored, ...patch }).items, { ...stored, ...patch });
  assert.equal(rows.filter((row) => row.type === "subtotal").reduce((sum, row) => sum + row.subtotal, 0), 210);
  assert.equal(saleItemLabel(patch.items[0]), "Blusa — Tam. M · Azul");
  assert.notEqual(saleItemLabel(patch.items[0]), saleItemLabel(patch.items[2]));
});

test("invalid distributions, duplicate names and commercial changes cannot use allocation-only save", () => {
  const stored = fixture();
  const form = createSaleEditForm(stored);
  for (const quantity of [0, -1, 4, 1.5, "invalid"]) {
    assert.throws(() => assignSaleItems(form, { 0: quantity }, "joao"), /quantidade/);
  }
  assert.throws(() => assignSaleItems(form, {}, "joao"), /Selecione/);
  assert.throws(() => assignSaleItems(form, { 0: 1 }, "missing"), /Escolha/);
  assert.throws(() => assignSaleItems(form, { 99: 1 }, "joao"), /válida/);
  assert.throws(() => validateSalePeople({ ...form, people: [...form.people, { id: "duplicate", name: " maria " }] }), /cadastrada/);
  const split = assignSaleItems(form, { 0: 1 }, "joao");
  split.items[0].quantity++;
  assert.equal(buildSaleDateUpdate(stored, split), null);
});

test("legacy text subtotals split in cents and moving to the same person is a no-op", () => {
  const stored = { ...fixture(), items: [
    { productId: "shirt", name: "Blusa", quantity: 6, price: 25, subtotal: "149.99" },
  ] };
  let form = assignSaleItems(createSaleEditForm(stored), { 0: 3 }, "joao");
  form = assignSaleItems(form, { 0: 3 }, "maria");
  assert.equal(form.items.reduce((sum, item) => sum + Math.round(item.subtotal * 100), 0), 14999);
  const unchanged = assignSaleItems(form, { 0: 1 }, "maria");
  assert.deepEqual(unchanged, form);
  const patch = buildSaleDateUpdate(stored, form);
  assert.deepEqual(groupSalePeople({ ...stored, ...patch }).map((person) => person.subtotal),
    groupSalePeople(form).map((person) => person.subtotal));
});
