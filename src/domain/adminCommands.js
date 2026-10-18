import {
  EXPENSE_CATEGORIES,
  PRODUCT_CATEGORIES,
  TRIP_LABELS,
  findCategory,
  findProductMatches,
  formatDate,
  formatMoney,
  getCurrentTrip,
  normalizeText,
  parseDateInput,
  validateExpense,
  validateNewProduct,
  validateStockEntry,
} from "./adminOperations.js";

export const OPERATION_TITLES = {
  expense: "Registrar despesa",
  product: "Cadastrar novo produto",
  stockEntry: "Entrada de estoque",
};

const ORDINALS = { primeira: 1, segunda: 2, terceira: 3, quarta: 4 };
const TRIP_RE =
  /\b([1-4])\s*[ªaº°]?\s*viagem\b|\bviagem\s*(?:n[ºo°.]?\s*)?([1-4])\b|\b(primeira|segunda|terceira|quarta)\s+viagem\b/i;
const DATE_RE = /\b(hoje|ontem)\b|(?<![\d/])(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)(?![\d/])/i;
const CANCEL_RE = /^(cancelar?|cancela|desistir|esquece|deixa pra la|nao quero)\b/;
const CONFIRM_RE = /^(sim|confirmo|confirmar|confirma|ok|pode|pode gravar|salvar|grave|gravar|isso)\b/;

let draftCounter = 0;

function take(text, regex) {
  const match = regex.exec(text);
  if (!match) return { value: null, rest: text };
  return { value: match[1] ?? match[0], rest: text.replace(match[0], " "), match };
}

function takeTrip(text) {
  const match = TRIP_RE.exec(text);
  if (!match) return { trip: null, rest: text };
  const trip = match[1] || match[2] || ORDINALS[normalizeText(match[3])];
  return { trip: Number(trip), rest: text.replace(match[0], " ") };
}

const cleanMoneyText = (value) =>
  value == null ? undefined : String(value).replace(/[.,]+$/, "");

// ---------- Detecção ----------

export function detectAdminIntent(text) {
  const n = normalizeText(text);
  if (!n) return null;
  const createVerb = /\b(registr\w*|lanc\w*|adicion\w*|cadastr\w*|anot\w*|inclu\w*|cri[ae]\w*|nov[oa])\b/.test(n);
  const isQuestion = /\?|\b(quanto|quantos|quais|qual|quem|mostr\w*|resumo|total|liste\w*|ver)\b/.test(n);
  const hasAmount = /(r\$\s*\d|\d[\d.,]*\s*(reais|real)\b|\b(de|por|valor)\s+\d)/.test(n);

  // "gastei/paguei R$ 180 ..." é um lançamento, não uma consulta financeira.
  if (/\b(gastei|paguei|desembolsei|pago|gasto de|gastamos|pagamos)\b/.test(n) && hasAmount && !isQuestion) {
    return "expense";
  }
  if (/\b(despesas?|gastos?)\b/.test(n) && createVerb && !isQuestion) {
    return "expense";
  }
  if (
    /\b(cadastr\w+|cri[ae]\w*)\b.*\b(produto|roupa|peca|item)\b/.test(n) ||
    /\b(novo produto|produto novo|nova roupa|nova peca|novo item)\b/.test(n) ||
    /\b(adicion\w+|inclu\w+)\b.*\bnovo (produto|item)\b/.test(n)
  ) {
    return "product";
  }
  if (
    /\b(adicion\w+|acrescent\w+|somar?|soma|repor|reponha|dar entrada|entrada|inclu\w+|registr\w+|lanc\w+)\b/.test(n) &&
    /\b(estoque|unidades?|pecas?|pcs?|entrada)\b/.test(n)
  ) {
    return "stockEntry";
  }
  return null;
}

// ---------- Extração de campos ----------

function extractExpense(text, now) {
  const fields = {};
  let rest = text;
  const trip = takeTrip(rest);
  if (trip.trip) fields.tripNumber = trip.trip;
  rest = trip.rest;

  const dateMatch = DATE_RE.exec(rest);
  if (dateMatch) {
    const parsed = parseDateInput(dateMatch[1] || dateMatch[2], now);
    fields.date = parsed || "invalid";
    rest = rest.replace(dateMatch[0], " ");
  }

  const description = take(rest, /(?:descri[çc][aã]o|referente a|ref\.?)\s*[:=]?\s*(.+)$/i);
  if (description.value) {
    fields.description = description.value.trim();
    rest = description.rest;
  }

  for (const pattern of [
    /R\$\s*([\d.,]*\d)/i,
    /([\d.,]*\d)\s*(?:reais|real)\b/i,
    /\b(?:valor|no valor de|de|por)\s+([\d.,]*\d)\b/i,
  ]) {
    const found = pattern.exec(rest);
    if (found) {
      fields.value = cleanMoneyText(found[1]);
      break;
    }
  }

  const category = findCategory(EXPENSE_CATEGORIES, rest);
  if (category) fields.category = category.value;
  return fields;
}

function extractProduct(text) {
  const fields = {};
  let rest = text;
  const grab = (key, regex, transform = (value) => value.trim()) => {
    const found = take(rest, regex);
    if (found.value) {
      fields[key] = transform(found.value);
      rest = found.rest;
    }
  };

  grab("name", /\b(?:descri[çc][aã]o|nome)\s*[:=]?\s*(.+?)(?=\s+(?:c[oó]digo|tamanho|tam\b|cor\b|categoria|quantidade|qtd|qtde|custo|pre[çc]o|venda)\b|$)/i);
  grab("code", /\bc[oó]digo\s*[:=]?\s*([A-Za-z0-9][A-Za-z0-9._\-/]*)/i);
  grab("size", /\b(?:tamanho|tam\.?)\s*[:=]?\s*([A-Za-z0-9]+)/i);
  grab("color", /\bcor\b\s*[:=]?\s*([A-Za-zÀ-ÿ]+)/i);

  const categoryLabel = take(rest, /\bcategoria\s*[:=]?\s*([A-Za-zÀ-ÿ]+)/i);
  if (categoryLabel.value) {
    const category = findCategory(PRODUCT_CATEGORIES, categoryLabel.value);
    if (category) fields.category = category.value;
    rest = categoryLabel.rest;
  }

  grab("quantity", /\b(?:quantidade(?:\s+inicial)?|qtd\.?|qtde\.?)\s*(?:de)?\s*[:=]?\s*(-?[\d.,]+)/i, cleanMoneyText);
  if (fields.quantity === undefined) {
    grab("quantity", /(-?[\d.,]*\d)\s*(?:unidades?|pe[çc]as?|pcs?|un\b)/i, cleanMoneyText);
  }
  grab("costPrice", /\b(?:pre[çc]o\s+de\s+custo|custo|custou|comprei\s+por|paguei)\s*(?:de|por|:|=)?\s*(?:R\$)?\s*(-?[\d.,]*\d)/i, cleanMoneyText);
  grab("salePrice", /\b(?:pre[çc]o\s+de\s+venda|venda|vendo\s+por|vender\s+por)\s*(?:de|por|:|=)?\s*(?:R\$)?\s*(-?[\d.,]*\d)/i, cleanMoneyText);

  if (!fields.category) {
    const standalone = findCategory(
      PRODUCT_CATEGORIES.filter((item) => item.value !== "outros"),
      rest
    );
    if (standalone) fields.category = standalone.value;
  }

  if (!fields.name) {
    const name = rest
      .replace(/^\s*(?:por favor,?\s*)?(?:cadastr\w+|cri[ae]\w*|adicion\w+|inclu\w+|registr\w+)\s+/i, "")
      .replace(/^(?:um|uma)?\s*(?:novo|nova)?\s*(?:produto|roupa|pe[çc]a|item)?(?:\s+de\s+roupa)?\s*(?:chamad[oa]|:)?\s*/i, "")
      .replace(/[,;]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^(?:com|e|de)\s+|\s+(?:com|e|de)$/gi, "")
      .trim();
    if (name) fields.name = name;
  }
  return fields;
}

const STOCK_STOPWORDS = new Set([
  "adicionar", "adicione", "adiciona", "acrescentar", "acrescente", "somar", "soma", "some", "repor", "reponha",
  "incluir", "inclua", "registrar", "registre", "lancar", "lance", "dar", "de", "do", "da", "dos", "das", "no", "na",
  "nos", "nas", "ao", "aos", "a", "o", "as", "os", "em", "para", "estoque", "unidade", "unidades", "peca", "pecas",
  "pcs", "pc", "un", "produto", "item", "entrada", "mais", "por", "favor", "uma", "um",
]);

function extractStockEntry(text) {
  const fields = {};
  let rest = text;
  const grab = (key, regex, transform = (value) => value.trim()) => {
    const found = take(rest, regex);
    if (found.value) {
      fields[key] = transform(found.value);
      rest = found.rest;
    }
  };
  grab("code", /\bc[oó]digo\s*[:=]?\s*([A-Za-z0-9][A-Za-z0-9._\-/]*)/i);
  grab("size", /\b(?:tamanho|tam\.?)\s*[:=]?\s*([A-Za-z0-9]+)/i);
  grab("color", /\bcor\b\s*[:=]?\s*([A-Za-zÀ-ÿ]+)/i);

  for (const pattern of [
    /(-?[\d.,]*\d)\s*(?:unidades?|pe[çc]as?|pcs?|un\b)/i,
    /entrada\s+de\s+(-?[\d.,]*\d)/i,
    /(?:adicion\w+|acrescent\w+|somar?|repor|reponha|incluir|inclua|registr\w+|lanc\w+)\s+(-?[\d.,]*\d)\b/i,
    /\bquantidade\s*[:=]?\s*(-?[\d.,]*\d)/i,
  ]) {
    const found = take(rest, pattern);
    if (found.value) {
      fields.quantity = cleanMoneyText(found.value);
      rest = found.rest;
      break;
    }
  }

  const terms = normalizeText(rest)
    .split(/[^a-z0-9]+/)
    .filter((term) => term && !STOCK_STOPWORDS.has(term));
  if (terms.length) fields.text = terms.join(" ");
  return fields;
}

// ---------- Respostas a perguntas pendentes ----------

function parseTripAnswer(text) {
  const found = takeTrip(text);
  if (found.trip) return found.trip;
  const digit = /^\s*([1-4])\s*$/.exec(text);
  if (digit) return Number(digit[1]);
  const ordinal = ORDINALS[normalizeText(text).replace(/[^a-z]/g, "")];
  return ordinal || null;
}

function answerForPending(type, key, text, now) {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const unitFree = trimmed.replace(/\b(unidades?|pe[çc]as?|pcs?|reais|real)\b/gi, "").replace(/R\$/gi, "").trim();
  switch (key) {
    case "value":
    case "costPrice":
    case "salePrice":
    case "quantity":
      return { [key]: cleanMoneyText(unitFree) };
    case "category": {
      const list = type === "expense" ? EXPENSE_CATEGORIES : PRODUCT_CATEGORIES;
      const category = findCategory(list, trimmed);
      return category ? { category: category.value } : {};
    }
    case "tripNumber": {
      const trip = parseTripAnswer(trimmed);
      return trip ? { tripNumber: trip } : {};
    }
    case "date": {
      const date = parseDateInput(trimmed, now);
      return date ? { date } : {};
    }
    case "code":
      return { code: trimmed.slice(0, 40) };
    case "name":
      return { name: trimmed.slice(0, 120) };
    case "product":
      return { text: normalizeText(trimmed) };
    default:
      return {};
  }
}

// ---------- Avaliação (validação, perguntas, prévia) ----------

const EXPENSE_ORDER = ["value", "category", "tripNumber"];
const PRODUCT_ORDER = ["name", "code", "category", "quantity", "costPrice", "salePrice"];

const QUESTIONS = {
  value: "Qual é o valor da despesa?",
  category: (type) =>
    type === "expense"
      ? `Qual é a categoria? (${EXPENSE_CATEGORIES.map((item) => item.label).join(", ")})`
      : `Qual é a categoria do produto? (${PRODUCT_CATEGORIES.map((item) => item.label).join(", ")})`,
  tripNumber: "Em qual viagem devo registrar esta despesa?",
  date: "Qual é a data da despesa? (hoje, ontem ou dd/mm/aaaa)",
  name: "Qual é o nome ou a descrição do produto?",
  code: "Qual é o código do produto?",
  quantity: (type) =>
    type === "stockEntry" ? "Quantas unidades devo adicionar?" : "Qual é a quantidade inicial em estoque?",
  costPrice: "Qual é o preço de custo?",
  salePrice: "Qual é o preço de venda?",
  product: "Qual produto deve receber a entrada? Informe o código ou o nome.",
};

const question = (type, key, errors) => {
  const base = QUESTIONS[key];
  const text = typeof base === "function" ? base(type) : base;
  return errors?.[key] && !/^Informe|^Escolha/.test(errors[key]) ? `${errors[key]} ${text}` : text;
};

const candidateView = (product) => ({
  id: product.id,
  code: product.code || "",
  name: product.name || "Produto sem nome",
  size: product.size || "",
  color: product.color || "",
  quantity: Math.max(Math.floor(Number(product.quantity) || 0), 0),
});

function evaluate(draft, ctx) {
  const next = { ...draft, fields: { ...draft.fields } };
  next.candidates = [];
  next.blocker = null;
  next.preview = null;
  const products = ctx.products || [];
  const first = (order, errors) => order.find((key) => errors[key]);

  if (next.type === "expense") {
    const fields = next.fields;
    const validation = validateExpense(
      { ...fields, date: fields.date === "invalid" ? "x" : fields.date || new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate()) },
      { now: ctx.now }
    );
    const pending = first([...EXPENSE_ORDER, "date"], validation.errors);
    next.tripSuggestion = pending === "tripNumber" || !fields.tripNumber ? getCurrentTrip(ctx.now) : null;
    next.pending = pending || null;
    next.status = pending ? "collecting" : "ready";
    next.question = pending ? question("expense", pending, validation.errors) : null;
    if (pending === "tripNumber" && next.tripSuggestion) {
      next.question = `Em qual viagem devo registrar? Sugiro a ${TRIP_LABELS[next.tripSuggestion]} (viagem atual), mas preciso da sua confirmação: toque em "Usar ${TRIP_LABELS[next.tripSuggestion]}" ou escolha outra.`;
    }
    if (validation.valid) {
      const v = validation.values;
      next.preview = {
        rows: [
          ["Valor", formatMoney(v.value)],
          ["Categoria", v.categoryLabel],
          ["Descrição", v.description],
          ["Data", formatDate(v.expenseDate)],
          ["Viagem", TRIP_LABELS[v.tripNumber]],
        ],
        warnings: [],
      };
    }
    return next;
  }

  if (next.type === "product") {
    const validation = validateNewProduct(next.fields, products);
    const pending = first(PRODUCT_ORDER, validation.errors);
    next.pending = pending || null;
    if (validation.duplicate) {
      const { product, reason } = validation.duplicate;
      next.status = "blocked";
      next.blocker = candidateView(product);
      next.question = `${reason === "code" ? "Já existe um produto com este código" : "Já existe um produto igual (mesmo nome, tamanho e cor)"}: ${product.code || "sem código"} — ${product.name}. Para não duplicar, não vou cadastrar. Se quiser repor, peça: "adicionar 10 unidades ao ${product.code || product.name}".`;
      return next;
    }
    next.status = pending ? "collecting" : "ready";
    next.question = pending ? question("product", pending, validation.errors) : null;
    if (validation.valid) {
      const v = validation.values;
      next.preview = {
        rows: [
          ["Código", v.code],
          ["Descrição", v.name],
          ["Categoria", v.categoryLabel],
          ["Tamanho", v.size || "—"],
          ["Cor", v.color || "—"],
          ["Quantidade inicial", String(v.quantity)],
          ["Preço de custo", formatMoney(v.costPrice)],
          ["Preço de venda", formatMoney(v.salePrice)],
        ],
        warnings: validation.warnings,
      };
    }
    return next;
  }

  // stockEntry
  const fields = next.fields;
  let product = fields.productId ? products.find((item) => item.id === fields.productId) : null;
  if (!product && !fields.productId) {
    const matches = findProductMatches(products, fields);
    if (matches.length === 1) {
      product = matches[0];
      next.fields.productId = product.id;
    } else if (matches.length > 1) {
      next.candidates = matches.slice(0, 10).map(candidateView);
      next.pending = "product";
      next.status = "choosing";
      next.question = `Encontrei ${matches.length} produtos parecidos. Escolha qual deve receber a entrada — não vou selecionar sozinha.`;
      return next;
    } else if (fields.text || fields.code) {
      const terms = String(fields.text || fields.code).split(" ").filter((term) => term.length > 2);
      const similar = products
        .filter((item) => terms.some((term) => normalizeText([item.name, item.code, item.color].join(" ")).includes(term)))
        .slice(0, 8);
      next.pending = "product";
      if (similar.length) {
        next.candidates = similar.map(candidateView);
        next.status = "choosing";
        next.question = "Não encontrei esse produto exatamente. Veja os parecidos e escolha um, ou informe o código.";
      } else {
        next.status = "collecting";
        next.question = "Não encontrei esse produto no estoque. Informe o código ou o nome completo.";
      }
      return next;
    }
  }
  if (!product) {
    next.pending = "product";
    next.status = "collecting";
    next.question = QUESTIONS.product;
    return next;
  }
  const validation = validateStockEntry(fields, product);
  next.pending = validation.errors.quantity ? "quantity" : null;
  next.status = validation.valid ? "ready" : "collecting";
  next.question = validation.errors.quantity ? question("stockEntry", "quantity", validation.errors) : null;
  next.selectedProduct = candidateView(product);
  if (validation.valid) {
    const v = validation.values;
    next.preview = {
      rows: [
        ["Código", v.code || "—"],
        ["Produto", v.name],
        ["Tamanho", v.size || "—"],
        ["Cor", v.color || "—"],
        ["Quantidade anterior", String(v.previousQuantity)],
        ["Quantidade a adicionar", `+ ${v.quantity}`],
        ["Nova quantidade", String(v.newQuantity)],
      ],
      warnings: [],
    };
  }
  return next;
}

function replyFor(draft, ctx) {
  const simulated = ctx.readOnly ? " Você está na prévia somente leitura: a operação será apenas simulada e nada será gravado." : "";
  if (draft.status === "ready") {
    return `Conferi os dados. Revise o cartão e clique em "Confirmar operação" para concluir. Nada foi gravado ainda.${simulated}`;
  }
  return draft.question || "Preciso de mais informações.";
}

// ---------- API pública ----------

export function startAdminCommand(text, ctx) {
  const type = detectAdminIntent(text);
  if (!type) return null;
  const extractors = { expense: extractExpense, product: extractProduct, stockEntry: extractStockEntry };
  const fields = type === "expense" ? extractExpense(text, ctx.now) : extractors[type](text);
  draftCounter += 1;
  const draft = evaluate(
    {
      id: `admin-${ctx.now.getTime()}-${draftCounter}`,
      type,
      title: OPERATION_TITLES[type],
      status: "collecting",
      fields,
      createdAt: ctx.now.getTime(),
    },
    ctx
  );
  return { draft, reply: replyFor(draft, ctx) };
}

export function isDraftActive(draft) {
  return Boolean(draft) && ["collecting", "choosing", "ready"].includes(draft.status);
}

function mergeFields(draft, parsed) {
  const fields = { ...draft.fields };
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined && value !== null && value !== "") fields[key] = value;
  }
  return fields;
}

export function continueAdminDraft(draft, text, ctx) {
  const n = normalizeText(text);
  if (CANCEL_RE.test(n)) {
    const cancelled = cancelDraft(draft);
    return { draft: cancelled, reply: "Operação cancelada. Nada foi gravado." };
  }
  if (draft.status === "ready" && CONFIRM_RE.test(n)) {
    return {
      draft,
      reply: 'Por segurança, a gravação só acontece quando você clica no botão "Confirmar operação". Uma frase digitada ou falada nunca confirma sozinha.',
    };
  }

  let parsed;
  if (draft.type === "expense") parsed = extractExpense(text, ctx.now);
  else if (draft.type === "product") parsed = extractProductAnswer(text);
  else parsed = extractStockAnswer(text, draft);

  // Frase curta sem campos reconhecidos: trata como resposta à pergunta pendente.
  if (draft.type === "stockEntry") {
    if (draft.fields.productId) {
      parsed = parsed.quantity !== undefined ? { quantity: parsed.quantity } : {};
    } else if (/^(pp|p|m|g|gg|xg|xgg|\d{1,2})$/.test(n)) {
      parsed = { size: text.trim() };
    }
  }
  if (draft.pending && parsed[draft.pending === "product" ? "text" : draft.pending] === undefined) {
    parsed = { ...parsed, ...answerForPending(draft.type, draft.pending, text, ctx.now) };
  }

  if (draft.type === "stockEntry" && draft.status === "choosing") {
    const exact = draft.candidates.find((item) => normalizeText(item.code) === n && n);
    if (exact) parsed = { ...parsed, productId: exact.id };
  }

  const fields = mergeFields(draft, parsed);
  if (draft.type === "stockEntry" && !draft.fields.productId && parsed.text && !parsed.productId) {
    fields.text = [draft.fields.text, parsed.text].filter(Boolean).join(" ");
  }
  const next = evaluate({ ...draft, fields }, ctx);
  return { draft: next, reply: replyFor(next, ctx) };
}

function extractProductAnswer(text) {
  const parsed = extractProduct(text);
  // Em respostas, um nome só vale se estiver rotulado; senão vira resposta pendente.
  if (!/\b(descri[çc][aã]o|nome)\b/i.test(text)) delete parsed.name;
  return parsed;
}

function extractStockAnswer(text) {
  const parsed = extractStockEntry(text);
  if (parsed.quantity === undefined) delete parsed.quantity;
  return parsed;
}

export function chooseDraftProduct(draft, productId, ctx) {
  if (draft.type !== "stockEntry" || !isDraftActive(draft)) return { draft, reply: "" };
  const product = (ctx.products || []).find((item) => item.id === productId);
  if (!product) return { draft, reply: "Produto não encontrado. Escolha uma das opções." };
  const next = evaluate({ ...draft, fields: { ...draft.fields, productId } }, ctx);
  return { draft: next, reply: replyFor(next, ctx) };
}

export function chooseDraftTrip(draft, trip, ctx) {
  if (draft.type !== "expense" || !isDraftActive(draft) || !TRIP_LABELS[trip]) return { draft, reply: "" };
  const next = evaluate({ ...draft, fields: { ...draft.fields, tripNumber: Number(trip) } }, ctx);
  return { draft: next, reply: replyFor(next, ctx) };
}

export function cancelDraft(draft) {
  return isDraftActive(draft) || draft.status === "blocked" ? { ...draft, status: "cancelled" } : draft;
}

// A confirmação só vale com um clique real do usuário (evento confiável), nunca com texto ou voz.
export function markDraftConfirming(draft, { trusted } = {}) {
  if (trusted !== true) throw new Error("A confirmação precisa ser feita por clique no botão.");
  if (draft.status !== "ready") throw new Error("A operação ainda não está pronta para confirmação.");
  return { ...draft, status: "confirming" };
}

export function finishDraft(draft, result) {
  return {
    ...draft,
    status: result.ok ? (result.simulated ? "simulated" : "done") : "error",
    result,
  };
}

export function revalidateDraft(draft, ctx) {
  return evaluate(draft, ctx);
}
