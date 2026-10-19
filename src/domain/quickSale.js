import { getMaxEditableQuantity } from "./sales.js";

const SIZE_ORDER = ["PP", "P", "M", "G", "GG", "XG", "XGG", "UNICO", "ÚNICO"];

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ");
}

export function compareSizes(first, second) {
  const a = String(first ?? "").trim();
  const b = String(second ?? "").trim();
  const numA = Number(a.replace(",", "."));
  const numB = Number(b.replace(",", "."));
  const aIsNumber = a !== "" && Number.isFinite(numA);
  const bIsNumber = b !== "" && Number.isFinite(numB);

  if (aIsNumber && bIsNumber) return numA - numB;
  if (aIsNumber) return -1;
  if (bIsNumber) return 1;

  const indexA = SIZE_ORDER.indexOf(a.toLocaleUpperCase("pt-BR"));
  const indexB = SIZE_ORDER.indexOf(b.toLocaleUpperCase("pt-BR"));
  if (indexA !== -1 && indexB !== -1) return indexA - indexB;
  if (indexA !== -1) return -1;
  if (indexB !== -1) return 1;
  return a.localeCompare(b, "pt-BR");
}

// Agrupa os produtos existentes (um documento por tamanho) por nome + categoria + cor.
// Nomes só são agrupados quando idênticos (ignorando caixa e acentos): nomes parecidos continuam separados.
export function groupProductsForQuickSale(products = []) {
  const groups = new Map();

  for (const product of products) {
    if (!product?.id) continue;
    const key = [product.name, product.category, product.color]
      .map(normalize)
      .join("|");

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: product.name || "Produto sem nome",
        category: product.category || "",
        color: product.color || "",
        codes: [],
        variants: [],
      });
    }

    const group = groups.get(key);
    if (product.code) group.codes.push(String(product.code));
    group.variants.push(product);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      variants: group.variants.sort((first, second) =>
        compareSizes(first.size, second.size)
      ),
    }))
    .sort((first, second) => first.name.localeCompare(second.name, "pt-BR"));
}

export function searchQuickSaleGroups(groups = [], term = "") {
  const words = normalize(term).split(" ").filter(Boolean);
  if (words.length === 0) return groups;

  return groups.filter((group) => {
    const haystack = normalize(
      [group.name, group.category, group.color, ...group.codes].join(" ")
    );
    return words.every((word) => haystack.includes(word));
  });
}

export function getVariantStock(product, originalQuantities) {
  return getMaxEditableQuantity(
    product?.quantity,
    originalQuantities?.get(product?.id)
  );
}

export function getCartQuantity(items = [], productId) {
  return items
    .filter((item) => item.productId === productId)
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

// Define a quantidade de uma numeração no carrinho (uma linha por produto), respeitando o estoque.
// Quantidade 0 remove a linha. Linhas vazias do formulário tradicional são descartadas.
export function setCartQuantity(items = [], product, quantity, maxQuantity) {
  const wanted = Math.floor(Number(quantity) || 0);
  const limit = Math.max(0, Math.floor(Number(maxQuantity) || 0));
  const safe = Math.min(Math.max(wanted, 0), limit);
  const others = items.filter(
    (item) => item.productId && item.productId !== product.id
  );
  const existing = items.find((item) => item.productId === product.id);

  if (safe === 0) return others;

  const line = {
    productId: product.id,
    quantity: safe,
    price: existing ? existing.price : String(product.salePrice || 0),
  };

  return existing
    ? items
        .filter((item) => item.productId)
        .map((item) => (item.productId === product.id ? line : item))
    : [...others, line];
}

export function removeCartProduct(items = [], productId) {
  return items.filter((item) => item.productId && item.productId !== productId);
}

export function summarizeCart(items = []) {
  const lines = items.filter((item) => item.productId);
  return {
    lines: lines.length,
    pieces: lines.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    total: lines.reduce(
      (sum, item) =>
        sum + Number(item.quantity || 0) * Number(item.price || 0),
      0
    ),
  };
}
