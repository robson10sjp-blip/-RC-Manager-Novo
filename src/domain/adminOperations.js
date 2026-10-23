export const MAX_MONEY = 1_000_000;
export const MAX_QUANTITY = 10_000;

export const EXPENSE_CATEGORIES = [
  { value: "combustivel", label: "Combustível", words: ["combustivel", "gasolina", "diesel", "etanol", "abastecimento"] },
  { value: "hotel", label: "Hospedagem", words: ["hotel", "hospedagem", "pousada", "diaria"] },
  { value: "alimentacao", label: "Alimentação", words: ["alimentacao", "comida", "almoco", "jantar", "lanche", "restaurante", "refeicao"] },
  { value: "mercadoria", label: "Compra de mercadoria", words: ["mercadoria", "mercadorias"] },
  { value: "manutencao", label: "Manutenção", words: ["manutencao", "conserto", "oficina", "pneu", "mecanico"] },
  { value: "transporte", label: "Transporte", words: ["transporte", "frete", "pedagio", "onibus", "passagem"] },
  { value: "outros", label: "Outros", words: ["outros", "outro"] },
];

export const PRODUCT_CATEGORIES = [
  { value: "feminino", label: "Feminino", words: ["feminino", "feminina", "mulher"] },
  { value: "masculino", label: "Masculino", words: ["masculino", "masculina", "homem"] },
  { value: "infantil", label: "Infantil", words: ["infantil", "crianca", "kids"] },
  { value: "outros", label: "Outros", words: ["outros", "outro"] },
];

// Períodos conhecidos do sistema (fim exclusivo). A viagem atual é sempre derivada da data.
export const TRIP_PERIODS = [
  { trip: 3, start: new Date(2026, 6, 1), end: new Date(2026, 9, 1) },
  { trip: 4, start: new Date(2026, 9, 1), end: new Date(2027, 0, 1) },
];

export const TRIP_LABELS = {
  1: "1ª viagem",
  2: "2ª viagem",
  3: "3ª viagem",
  4: "4ª viagem",
};

export const normalizeText = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();

export function getCurrentTrip(now = new Date()) {
  const period = TRIP_PERIODS.find(({ start, end }) => now >= start && now < end);
  return period ? period.trip : null;
}

export function parseMoney(input) {
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.round(input * 100) / 100 : NaN;
  }
  let text = String(input ?? "")
    .toLocaleLowerCase("pt-BR")
    .replace(/r\$/g, "")
    .replace(/reais|real/g, "")
    .replace(/\s+/g, "");
  if (!text) return NaN;
  if (text.includes(",") && text.includes(".")) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (text.includes(",")) {
    text = text.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, "");
  }
  if (!/^\d+(\.\d+)?$/.test(text)) return NaN;
  return Math.round(Number(text) * 100) / 100;
}

export function parseQuantity(input) {
  const text = String(input ?? "").trim();
  if (!/^\d+$/.test(text)) return NaN;
  return Number(text);
}

export function findCategory(list, text) {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  return (
    list.find((item) => tokens.some((token) => item.words.includes(token))) || null
  );
}

export function parseDateInput(text, now = new Date()) {
  const normalized = normalizeText(text);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!normalized || normalized === "hoje") return today;
  if (normalized === "ontem") {
    return new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  }
  const match = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(normalized);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = match[3] ? Number(match[3]) : now.getFullYear();
  if (year < 100) year += 2000;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

export const formatDate = (date) =>
  date instanceof Date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString("pt-BR")
    : "";

export const formatMoney = (value) =>
  Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const searchableText = (product) =>
  normalizeText(
    [product.code, product.name, product.size, product.color, product.category].join(" ")
  );

// Produtos semelhantes: todos os termos precisam aparecer em código, nome, tamanho ou cor.
export function findProductMatches(products = [], query = {}) {
  const code = normalizeText(query.code);
  if (code) {
    const exact = products.filter((product) => normalizeText(product.code) === code);
    if (exact.length) return exact;
  }
  const size = normalizeText(query.size);
  const color = normalizeText(query.color);
  const terms = normalizeText(query.text)
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1);
  if (!terms.length && !size && !color) return [];

  return products.filter((product) => {
    const text = searchableText(product);
    if (size && normalizeText(product.size) !== size) return false;
    if (color && !normalizeText(product.color).includes(color)) return false;
    return terms.every((term) => text.includes(term));
  });
}

export function findDuplicateProduct(products = [], fields = {}) {
  const code = normalizeText(fields.code);
  const byCode = products.find((product) => normalizeText(product.code) === code);
  if (code && byCode) return { product: byCode, reason: "code" };
  const name = normalizeText(fields.name);
  const bySameVariant = products.find(
    (product) =>
      normalizeText(product.name) === name &&
      normalizeText(product.size) === normalizeText(fields.size) &&
      normalizeText(product.color) === normalizeText(fields.color)
  );
  return name && bySameVariant ? { product: bySameVariant, reason: "variant" } : null;
}

export function validateExpense(fields, { now = new Date() } = {}) {
  const errors = {};
  const value = parseMoney(fields.value);
  if (!(value > 0)) errors.value = "Informe um valor de despesa maior que zero.";
  else if (value > MAX_MONEY) errors.value = "Valor acima do limite permitido para um lançamento.";

  const category = EXPENSE_CATEGORIES.find((item) => item.value === fields.category);
  if (!category) errors.category = "Escolha a categoria da despesa.";

  const trip = Number(fields.tripNumber);
  if (!fields.tripConfirmed && !fields.tripId) {
    errors.tripNumber = "Selecione uma viagem cadastrada com número e ano ou confirme Sem viagem definida.";
  }

  const date = fields.date instanceof Date ? fields.date : parseDateInput(fields.date, now);
  if (!date) errors.date = "Informe uma data válida para a despesa.";

  return {
    errors,
    valid: Object.keys(errors).length === 0,
    values: {
      category: category?.value,
      categoryLabel: category?.label,
      description: String(fields.description || category?.label || "").trim(),
      value,
      expenseDate: date,
      tripId: fields.tripId || "",
      tripName: fields.tripId ? fields.tripName || "" : "",
      tripNumber: fields.tripId && TRIP_LABELS[trip] ? trip : null,
      tripYear: fields.tripId ? fields.tripYear || null : null,
    },
  };
}

export function validateNewProduct(fields, products = []) {
  const errors = {};
  const code = String(fields.code || "").trim();
  const name = String(fields.name || "").trim();
  if (!code) errors.code = "Informe o código do produto.";
  if (!name) errors.name = "Informe o nome ou a descrição do produto.";

  const category = PRODUCT_CATEGORIES.find((item) => item.value === fields.category);
  if (!category) errors.category = "Escolha a categoria: feminino, masculino, infantil ou outros.";

  const quantity = parseQuantity(fields.quantity);
  if (Number.isNaN(quantity)) errors.quantity = "Informe a quantidade inicial (número inteiro).";
  else if (quantity > MAX_QUANTITY) errors.quantity = "Quantidade acima do limite permitido.";

  const costPrice = parseMoney(fields.costPrice);
  if (Number.isNaN(costPrice) || fields.costPrice === "" || fields.costPrice == null) {
    errors.costPrice = "Informe o preço de custo.";
  } else if (costPrice < 0 || costPrice > MAX_MONEY) {
    errors.costPrice = "Preço de custo inválido.";
  }

  const salePrice = parseMoney(fields.salePrice);
  if (Number.isNaN(salePrice) || fields.salePrice === "" || fields.salePrice == null) {
    errors.salePrice = "Informe o preço de venda.";
  } else if (salePrice < 0 || salePrice > MAX_MONEY) {
    errors.salePrice = "Preço de venda inválido.";
  }

  const duplicate = code || name ? findDuplicateProduct(products, { ...fields, code, name }) : null;
  const warnings = [];
  if (!errors.costPrice && !errors.salePrice && salePrice < costPrice) {
    warnings.push("O preço de venda está menor que o preço de custo.");
  }

  return {
    errors,
    duplicate,
    warnings,
    valid: Object.keys(errors).length === 0 && !duplicate,
    values: {
      code,
      name,
      category: category?.value,
      categoryLabel: category?.label,
      size: String(fields.size || "").trim(),
      color: String(fields.color || "").trim(),
      costPrice,
      salePrice,
      quantity,
    },
  };
}

export function validateStockEntry(fields, product) {
  const errors = {};
  if (!product) errors.product = "Escolha o produto que receberá a entrada.";
  const quantity = parseQuantity(fields.quantity);
  if (Number.isNaN(quantity) || quantity <= 0) {
    errors.quantity = "Informe a quantidade a adicionar (inteiro maior que zero).";
  } else if (quantity > MAX_QUANTITY) {
    errors.quantity = "Quantidade acima do limite permitido.";
  }
  const previousQuantity = Math.max(Math.floor(Number(product?.quantity) || 0), 0);
  return {
    errors,
    valid: Object.keys(errors).length === 0,
    values: {
      productId: product?.id,
      code: product?.code || "",
      name: product?.name || "",
      size: product?.size || "",
      color: product?.color || "",
      quantity,
      previousQuantity,
      newQuantity: Number.isNaN(quantity) ? previousQuantity : previousQuantity + quantity,
    },
  };
}
