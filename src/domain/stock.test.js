import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStockActivity,
  getStockThresholds,
  getSuggestedRestock,
  summarizeStockSales,
} from "./stock.js";

test("uses per-product stock targets and does not recommend excess restocking", () => {
  assert.deepEqual(getStockThresholds({}), { minimum: 3, target: 6 });
  assert.deepEqual(
    getStockThresholds({ minimumStock: 5, targetStock: 12 }),
    { minimum: 5, target: 12 }
  );
  assert.equal(getSuggestedRestock({ quantity: 0, minimumStock: 5, targetStock: 12 }), 12);
  assert.equal(getSuggestedRestock({ quantity: 4, minimumStock: 5, targetStock: 12 }), 8);
  assert.equal(getSuggestedRestock({ quantity: 8, minimumStock: 5, targetStock: 12 }), 0);
});

test("reports demand only from recorded sale items and aggregates sold sizes", () => {
  const result = summarizeStockSales(
    [
      { id: "p-1", name: "Camisa", code: "CAM-1", size: "M" },
      { id: "p-2", name: "Calça", code: "CAL-1", size: "42" },
      { id: "p-3", name: "Sem venda", code: "N-1", size: "G" },
    ],
    [
      {
        id: "sale-1",
        items: [
          { productId: "p-1", quantity: 3, size: "M" },
          { productId: "p-2", quantity: 1, size: "42" },
        ],
      },
      {
        id: "sale-2",
        items: [
          { productId: "p-1", quantity: 2, size: "M" },
          { productId: "p-2", quantity: 2, size: "40" },
        ],
      },
    ]
  );

  assert.deepEqual(
    result.mostSold.map(({ productId, quantitySold }) => [productId, quantitySold]),
    [["p-1", 5], ["p-2", 3]]
  );
  assert.deepEqual(
    result.leastSold.map(({ productId, quantitySold }) => [productId, quantitySold]),
    [["p-3", 0], ["p-2", 3], ["p-1", 5]]
  );
  assert.deepEqual(result.sizes, [
    { size: "M", quantitySold: 5 },
    { size: "40", quantitySold: 2 },
    { size: "42", quantitySold: 1 },
  ]);
});

test("combines existing stock movements and actual sales without duplicating linked sale movements", () => {
  const history = buildStockActivity(
    [
      {
        id: "sale-1",
        saleDate: "2026-10-18",
        items: [
          { productId: "p-1", name: "Camisa", quantity: 2 },
          { productId: "p-2", name: "Calça", quantity: 1 },
        ],
      },
    ],
    [
      {
        id: "sale-movement",
        saleId: "sale-1",
        productId: "p-1",
        type: "sale",
        quantity: 2,
        createdAt: "2026-10-18",
      },
      {
        id: "return-1",
        productId: "p-1",
        type: "devolução",
        quantity: 1,
        createdAt: "2026-10-19",
      },
      {
        id: "entry-1",
        productId: "p-1",
        type: "entrada",
        quantity: 5,
        createdAt: "2026-10-17",
      },
    ]
  );

  assert.equal(history.filter((entry) => entry.source === "sale").length, 1);
  assert.equal(history.find((entry) => entry.source === "sale").quantity, 1);
  assert.equal(history.find((entry) => entry.id === "return-1").type, "devolução");
  assert.equal(history.filter((entry) => entry.saleId === "sale-1").length, 1);
  assert.equal(history.length, 4);
});

test("keeps saved product thresholds and sales data unmodified", () => {
  const product = { id: "p", quantity: 1, minimumStock: 4, targetStock: 9 };
  const original = { ...product };
  assert.equal(getSuggestedRestock(product), 8);
  assert.deepEqual(product, original);
});

test("matches unlinked sale movements one-for-one instead of hiding same-day sales", () => {
  const history = buildStockActivity(
    [
      { id: "sale-1", saleDate: "2026-10-18", items: [{ productId: "p-1", quantity: 2 }] },
      { id: "sale-2", saleDate: "2026-10-18", items: [{ productId: "p-1", quantity: 2 }] },
    ],
    [
      { id: "movement-1", productId: "p-1", type: "venda", quantity: 2, createdAt: "2026-10-18" },
    ]
  );

  assert.equal(history.filter((entry) => entry.source === "sale").length, 1);
  assert.equal(history.filter((entry) => entry.source === "movement").length, 1);
});
