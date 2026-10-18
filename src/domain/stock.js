import { toDate } from "../utils/dates.js";

const amount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function getStockThresholds(product) {
  const minimum = Math.max(0, Math.floor(amount(product.minimumStock ?? 3)));
  const target = Math.max(
    minimum,
    Math.floor(amount(product.targetStock ?? minimum * 2))
  );
  return { minimum, target };
}

export function getSuggestedRestock(product) {
  const quantity = Math.max(0, Math.floor(amount(product.quantity)));
  const { minimum, target } = getStockThresholds(product);
  if (quantity > minimum) return 0;
  return Math.max(target - quantity, 0);
}

export function summarizeStockSales(products = [], sales = []) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const byProduct = new Map(
    products.map((product) => [
      product.id,
      {
        productId: product.id,
        name: product.name || "Produto sem nome",
        code: product.code || "",
        quantitySold: 0,
      },
    ])
  );
  const bySize = new Map();

  for (const sale of sales) {
    for (const item of sale.items || []) {
      const productId = item.productId;
      if (!productId || !productById.has(productId)) continue;
      const quantity = Math.max(0, amount(item.quantity));
      if (!quantity) continue;
      const product = productById.get(productId);
      const stats = byProduct.get(productId) || {
        productId,
        name: item.name || product.name || "Produto sem nome",
        code: item.code || product.code || "",
        quantitySold: 0,
      };
      stats.quantitySold += quantity;
      byProduct.set(productId, stats);

      const size = String(item.size || "").trim();
      if (size) bySize.set(size, (bySize.get(size) || 0) + quantity);
    }
  }

  const allProducts = Array.from(byProduct.values()).sort(
    (first, second) =>
      second.quantitySold - first.quantitySold ||
      first.name.localeCompare(second.name, "pt-BR")
  );
  const productsSold = allProducts.filter((product) => product.quantitySold > 0);
  const leastSold = [...allProducts].sort(
    (first, second) =>
      first.quantitySold - second.quantitySold ||
      first.name.localeCompare(second.name, "pt-BR")
  );
  const sizes = Array.from(bySize, ([size, quantitySold]) => ({
    size,
    quantitySold,
  })).sort(
    (first, second) =>
      second.quantitySold - first.quantitySold ||
      first.size.localeCompare(second.size, "pt-BR")
  );

  return {
    mostSold: productsSold.slice(0, 5),
    leastSold: leastSold.slice(0, 5),
    sizes: sizes.slice(0, 8),
    productsSold,
  };
}

function normalizedMovementType(type) {
  const value = String(type || "").trim().toLocaleLowerCase("pt-BR");
  if (["entrada", "in", "purchase", "restock"].includes(value)) return "entrada";
  if (["saida", "saída", "out", "adjustment", "ajuste", "baixa"].includes(value)) {
    return value === "ajuste" || value === "adjustment" ? "ajuste" : "baixa";
  }
  if (["venda", "sale"].includes(value)) return "venda";
  if (["devolucao", "devolução", "return"].includes(value)) return "devolução";
  return value || "movimentação";
}

export function buildStockActivity(sales = [], movements = [], limit = 100) {
  const sortedSales = [...sales].sort(
    (first, second) =>
      (toDate(second.saleDate || second.createdAt)?.getTime() || 0) -
      (toDate(first.saleDate || first.createdAt)?.getTime() || 0)
  );
  const storedSaleKeys = new Set(
    movements
      .filter((movement) =>
        ["venda", "sale"].includes(
          String(movement.type || "").toLocaleLowerCase("pt-BR")
        )
      )
      .flatMap((movement) => [
        movement.saleId ? `${movement.saleId}|${movement.productId}` : "",
        movement.referenceId ? `${movement.referenceId}|${movement.productId}` : "",
      ])
      .filter(Boolean)
  );
  const storedSaleFingerprints = new Map();
  for (const movement of movements) {
    const type = String(movement.type || "").toLocaleLowerCase("pt-BR");
    if (!["venda", "sale"].includes(type) || movement.saleId || movement.referenceId) {
      continue;
    }
    const date = toDate(movement.createdAt || movement.date);
    if (!date) continue;
    const fingerprint = `${movement.productId}|${amount(movement.quantity)}|${date.toISOString().slice(0, 10)}`;
    storedSaleFingerprints.set(
      fingerprint,
      (storedSaleFingerprints.get(fingerprint) || 0) + 1
    );
  }

  const saleEvents = sortedSales.flatMap((sale) =>
    (sale.items || [])
      .filter((item) => {
        if (!item.productId || storedSaleKeys.has(`${sale.id}|${item.productId}`)) {
          return false;
        }
        const date = toDate(sale.saleDate || sale.createdAt);
        if (!date) return true;
        const fingerprint = `${item.productId}|${amount(item.quantity)}|${date.toISOString().slice(0, 10)}`;
        const remainingMovements = storedSaleFingerprints.get(fingerprint) || 0;
        if (!remainingMovements) return true;
        storedSaleFingerprints.set(fingerprint, remainingMovements - 1);
        return false;
      })
      .map((item, index) => ({
        id: `sale-${sale.id}-${item.productId}-${index}`,
        productId: item.productId,
        productName: item.name || sale.productName || "",
        productCode: item.code || "",
        type: "venda",
        quantity: amount(item.quantity),
        createdAt: sale.saleDate || sale.createdAt || null,
        reference: sale.id,
        source: "sale",
      }))
  );
  const movementEvents = movements.map((movement) => ({
    ...movement,
    id: movement.id,
    type: normalizedMovementType(movement.type),
    createdAt: movement.createdAt || movement.date || null,
    source: "movement",
  }));

  return [...saleEvents, ...movementEvents]
    .sort(
      (first, second) =>
        (toDate(second.createdAt)?.getTime() || 0) -
        (toDate(first.createdAt)?.getTime() || 0)
    )
    .slice(0, limit);
}
