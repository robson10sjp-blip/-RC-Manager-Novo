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

export function getCartQuantity(items = [], productId, personId = "") {
  return items
    .filter((item) => item.productId === productId && (item.personId || "") === personId)
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

// Define a quantidade por produto/pessoa, preservando linhas e preços históricos.
// Quantidade 0 remove a linha. Linhas vazias do formulário tradicional são descartadas.
export function setCartQuantity(items = [], product, quantity, maxQuantity, personId = "") {
  const wanted = Math.floor(Number(quantity) || 0);
  const limit = Math.max(0, Math.floor(Number(maxQuantity) || 0));
  const matches = (item) => item.productId === product.id && (item.personId || "") === personId;
  const otherPeopleQuantity = items.filter((item) => item.productId === product.id && !matches(item))
    .reduce((sum, item) => sum + Number(item.quantity), 0);
  const safe = Math.min(Math.max(wanted, 0), Math.max(0, limit - otherPeopleQuantity));
  let delta = safe - getCartQuantity(items, product.id, personId);
  const result = items.filter((item) => item.productId).map((item) => ({ ...item }));
  // Keep distinct historical prices and source lines; only the last matching line is increased.
  for (let index = result.length - 1; index >= 0 && delta !== 0; index--) {
    const item = result[index];
    if (!matches(item)) continue;
    const change = delta > 0 ? delta : -Math.min(Number(item.quantity), -delta);
    result[index] = { ...item, quantity: Number(item.quantity) + change };
    delete result[index].subtotal;
    delta -= change;
  }
  if (delta > 0) result.push({
    productId: product.id, quantity: delta, price: String(product.salePrice || 0),
    ...(personId ? { personId } : {}),
  });
  return result.filter((item) => Number(item.quantity) > 0);
}

export function removeCartProduct(items = [], productId, personId = "") {
  return items.filter((item) => item.productId && (item.productId !== productId || (item.personId || "") !== personId));
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
