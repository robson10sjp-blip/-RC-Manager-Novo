import assert from "node:assert/strict";
import test from "node:test";

import {
  getVariantStock,
  groupProductsForQuickSale,
  removeCartProduct,
  searchQuickSaleGroups,
  setCartQuantity,
  summarizeCart,
} from "./quickSale.js";
import {
  applyStockDelta,
  calculateSaleAmounts,
  calculateStockDeltas,
} from "./sales.js";

const pants = (size, quantity, id = `calca-${size}`) => ({
  id,
  name: "Calça Feminina",
  category: "Calças",
  color: "Azul",
  code: "CF01",
  size,
  quantity,
  salePrice: 50,
});
const products = [
  pants("42", 3),
  pants("36", 5),
  pants("40", 0),
  pants("38", 8),
  { id: "blusa-m", name: "Blusa Feminina", category: "Blusas", size: "M", quantity: 4, salePrice: 30, code: "BL02" },
  { id: "calca-masc", name: "Calça Masculina", category: "Calças", size: "40", quantity: 2, salePrice: 60, code: "CM01" },
];

test("groups size variants of one product and sorts sizes", () => {
  const groups = groupProductsForQuickSale(products);
  const feminine = groups.find((group) => group.name === "Calça Feminina");
  assert.equal(groups.length, 3);
  assert.deepEqual(feminine.variants.map((variant) => variant.size), ["36", "38", "40", "42"]);
});

test("similar names are not merged and search matches name or code", () => {
  const groups = groupProductsForQuickSale(products);
  assert.equal(searchQuickSaleGroups(groups, "calca").length, 2);
  assert.equal(searchQuickSaleGroups(groups, "CALÇA masc").length, 1);
  assert.equal(searchQuickSaleGroups(groups, "bl02")[0].name, "Blusa Feminina");
  assert.equal(searchQuickSaleGroups(groups, "").length, 3);
  assert.equal(searchQuickSaleGroups(groups, "inexistente").length, 0);
});

test("cart supports several products, sizes and +/- adjustments", () => {
  let items = [{ productId: "", quantity: 1, price: "" }];
  items = setCartQuantity(items, products[1], 1, 5);
  items = setCartQuantity(items, products[3], 2, 8);
  items = setCartQuantity(items, products[4], 1, 4);
  assert.equal(items.length, 3);
  items = setCartQuantity(items, products[1], 3, 5);
  assert.equal(items.find((item) => item.productId === "calca-36").quantity, 3);
  items = setCartQuantity(items, products[1], 2, 5);
  assert.equal(items.find((item) => item.productId === "calca-36").quantity, 2);
  assert.deepEqual(summarizeCart(items), { lines: 3, pieces: 5, total: 2 * 50 + 2 * 50 + 30 });
  items = setCartQuantity(items, products[1], 0, 5);
  assert.equal(items.some((item) => item.productId === "calca-36"), false);
  assert.equal(removeCartProduct(items, "blusa-m").length, 1);
});

test("quantity never exceeds stock and out-of-stock sizes cannot be added", () => {
  assert.equal(setCartQuantity([], products[0], 10, 3)[0].quantity, 3);
  assert.deepEqual(setCartQuantity([], products[2], 1, 0), []);
  assert.equal(getVariantStock(products[2], new Map()), 0);
});

test("editing keeps the quantity already reserved by the sale available", () => {
  const original = new Map([["calca-42", 3]]);
  const soldOut = { ...products[0], quantity: 0 };
  assert.equal(getVariantStock(soldOut, original), 3);
  const items = setCartQuantity([{ productId: "calca-42", quantity: 3, price: "50" }], soldOut, 3, 3);
  assert.equal(items[0].quantity, 3);
});

test("cash and credit totals from quick sale items use the existing calculation", () => {
  const items = [
    { productId: "calca-36", quantity: 2, price: "50" },
    { productId: "blusa-m", quantity: 1, price: "30" },
  ];
  assert.deepEqual(calculateSaleAmounts(items, 130), {
    total: 130, amountPaid: 130, pendingAmount: 0, status: "paid",
  });
  assert.deepEqual(calculateSaleAmounts(items, 30), {
    total: 130, amountPaid: 30, pendingAmount: 100, status: "partial",
  });
  assert.equal(calculateSaleAmounts(items, 0).status, "pending");
});

test("stock is only deducted on confirmation, edit and delete reuse the same deltas", () => {
  const stock = { "calca-36": 5, "blusa-m": 4 };
  const items = [
    { productId: "calca-36", quantity: 2 },
    { productId: "blusa-m", quantity: 1 },
  ];
  const after = { ...stock };
  for (const [id, delta] of calculateStockDeltas([], items)) after[id] = applyStockDelta(after[id], delta, id);
  assert.deepEqual(after, { "calca-36": 3, "blusa-m": 3 });

  const edited = [{ productId: "calca-36", quantity: 3 }, ...items.slice(1)];
  assert.deepEqual(Object.fromEntries(calculateStockDeltas(items, edited)), { "calca-36": 1 });

  const restored = { ...after };
  for (const [id, delta] of calculateStockDeltas(items, [])) restored[id] = applyStockDelta(restored[id], delta, id);
  assert.deepEqual(restored, stock);
});
