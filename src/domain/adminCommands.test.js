import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseDraftProduct,
  chooseDraftTrip,
  continueAdminDraft,
  isDraftActive,
  markDraftConfirming,
  startAdminCommand,
} from "./adminCommands.js";
import { getCurrentTrip, parseMoney, parseQuantity, validateExpense, validateStockEntry } from "./adminOperations.js";

const products = [
  { id: "a", code: "V001", name: "Vestido Floral", size: "M", color: "Azul", quantity: 5, costPrice: 30, salePrice: 70, category: "feminino" },
  { id: "b", code: "V002", name: "Vestido Floral", size: "G", color: "Azul", quantity: 2, costPrice: 30, salePrice: 70, category: "feminino" },
  { id: "c", code: "C010", name: "Camisa Polo", size: "M", color: "Preto", quantity: 7, costPrice: 20, salePrice: 50, category: "masculino" },
];
const ctx = { products, now: new Date("2026-10-15T10:00:00"), readOnly: true };

test("valores monetários em formato brasileiro", () => {
  assert.equal(parseMoney("R$ 1.250,50"), 1250.5);
  assert.equal(parseMoney("80"), 80);
  assert.equal(parseMoney("12,5"), 12.5);
  for (const bad of ["-5", "abc", ""]) assert.ok(Number.isNaN(parseMoney(bad)), bad);
  const base = { category: "hotel", description: "x", date: new Date("2026-10-15T12:00:00"), tripNumber: 4 };
  for (const bad of ["0", "2000000", "abc"]) assert.equal(validateExpense({ ...base, value: bad }).valid, false, bad);
  assert.equal(validateExpense({ ...base, value: "R$ 1.250,50" }).valid, true);
});

test("quantidades só aceitam inteiros positivos", () => {
  assert.equal(parseQuantity("10"), 10);
  for (const bad of ["-3", "2,5", "abc"]) assert.ok(Number.isNaN(parseQuantity(bad)), bad);
  for (const bad of ["0", "99999", "2,5"]) assert.equal(validateStockEntry({ quantity: bad }, products[0]).valid, false, bad);
});

test("viagem atual é calculada pela data, sem viagem fixa", () => {
  assert.equal(getCurrentTrip(new Date("2026-08-01T12:00:00")), 3);
  assert.equal(getCurrentTrip(new Date("2026-10-15T12:00:00")), 4);
});

test("despesa sem viagem sugere a viagem atual mas exige confirmação", () => {
  const { draft } = startAdminCommand("registrar despesa de R$ 150,50 com combustível", ctx);
  assert.equal(draft.status, "collecting");
  assert.equal(draft.tripSuggestion, 4);
  assert.equal(draft.fields.tripNumber, undefined);
  assert.throws(() => markDraftConfirming(draft, { trusted: true }));
  const later = startAdminCommand("registrar despesa de R$ 150,50 com combustível", { ...ctx, now: new Date("2026-08-10T10:00:00") });
  assert.equal(later.draft.tripSuggestion, 3);
  const chosen = chooseDraftTrip(draft, 4, ctx).draft;
  assert.equal(chosen.status, "ready");
  assert.equal(chosen.fields.tripNumber, 4);
});

test("despesa completa gera prévia e pede confirmação", () => {
  const { draft, reply } = startAdminCommand("registrar despesa de 80 reais em hotel na 4ª viagem hoje", ctx);
  assert.equal(draft.status, "ready");
  assert.ok(draft.preview.rows.some(([k, v]) => k === "Valor" && v.includes("80,00")));
  assert.match(reply, /Confirmar operação/);
});

test("despesa com valor inválido não fica pronta", () => {
  const { draft } = startAdminCommand("registrar despesa de abc com combustível", ctx);
  assert.notEqual(draft.status, "ready");
});

test("consultas não viram operações administrativas", () => {
  assert.equal(startAdminCommand("quanto gastei com combustível?", ctx), null);
  assert.equal(startAdminCommand("quem devo cobrar hoje?", ctx), null);
  assert.equal(startAdminCommand("estoque", ctx), null);
});

test("produto ambíguo nunca é selecionado automaticamente", () => {
  const { draft } = startAdminCommand("adicionar 10 unidades ao vestido floral", ctx);
  assert.equal(draft.status, "choosing");
  assert.equal(draft.fields.productId, undefined);
  assert.deepEqual(draft.candidates.map((p) => p.code), ["V001", "V002"]);
  assert.ok(draft.candidates.every((p) => "size" in p && "color" in p && "quantity" in p && "name" in p));
  assert.throws(() => markDraftConfirming(draft, { trusted: true }));
});

test("entrada de estoque mostra quantidade anterior e nova", () => {
  const first = startAdminCommand("adicionar 10 unidades ao vestido floral", ctx).draft;
  const { draft } = chooseDraftProduct(first, "b", ctx);
  assert.equal(draft.status, "ready");
  const row = (k) => draft.preview.rows.find(([label]) => label === k)[1];
  assert.equal(row("Quantidade anterior"), "2");
  assert.equal(row("Nova quantidade"), "12");
});

test("código exato resolve sem ambiguidade; quantidade faltante é perguntada", () => {
  const exact = startAdminCommand("adicionar 10 unidades ao C010", ctx).draft;
  assert.equal(exact.status, "ready");
  const missing = startAdminCommand("adicionar unidades ao C010", ctx).draft;
  assert.equal(missing.pending, "quantity");
  const answered = continueAdminDraft(missing, "12", ctx).draft;
  assert.equal(answered.status, "ready");
  assert.equal(answered.fields.productId, "c");
});

test("quantidade inválida no estoque não fica pronta", () => {
  const { draft } = startAdminCommand("adicionar -5 unidades ao C010", ctx);
  assert.notEqual(draft.status, "ready");
});

test("novo produto incompleto não pode ser confirmado", () => {
  const { draft } = startAdminCommand("cadastrar produto vestido longo", ctx);
  assert.equal(draft.status, "collecting");
  assert.throws(() => markDraftConfirming(draft, { trusted: true }));
  const filled = continueAdminDraft(draft, "código V100, quantidade 5, custo 40, venda 90, categoria feminino", ctx).draft;
  assert.equal(filled.status, "ready");
});

test("produto duplicado é bloqueado", () => {
  const { draft } = startAdminCommand(
    "cadastrar produto código V001 descrição Vestido Floral quantidade 3 custo 30 venda 70 categoria feminino tamanho M cor Azul",
    ctx
  );
  assert.equal(draft.status, "blocked");
  assert.throws(() => markDraftConfirming(draft, { trusted: true }));
});

test("confirmação exige clique confiável; frase 'confirmo' não confirma", () => {
  const { draft } = startAdminCommand("registrar despesa de 80 reais em hotel na 4ª viagem hoje", ctx);
  assert.throws(() => markDraftConfirming(draft), /clique/);
  assert.throws(() => markDraftConfirming(draft, { trusted: false }), /clique/);
  for (const phrase of ["sim", "confirmo", "pode gravar", "ok"]) {
    const step = continueAdminDraft(draft, phrase, ctx);
    assert.equal(step.draft.status, "ready", phrase);
    assert.match(step.reply, /botão/);
  }
  assert.equal(markDraftConfirming(draft, { trusted: true }).status, "confirming");
});

test("cancelar encerra o rascunho sem gravar", () => {
  const { draft } = startAdminCommand("registrar despesa de 80 reais em hotel na 4ª viagem hoje", ctx);
  const step = continueAdminDraft(draft, "cancelar", ctx);
  assert.equal(step.draft.status, "cancelled");
  assert.equal(isDraftActive(step.draft), false);
  assert.throws(() => markDraftConfirming(step.draft, { trusted: true }));
});

const today = { ...ctx, now: new Date("2026-10-18T12:00:00") };

test("regressão: 'gastei R$ 180 de combustível hoje na 4ª viagem' abre cartão de despesa", () => {
  const step = startAdminCommand("Secretária, gastei R$ 180 de combustível hoje na 4ª viagem.", today);
  assert.ok(step, "deve ser reconhecido como cadastro, não consulta");
  const { draft } = step;
  assert.equal(draft.type, "expense");
  assert.equal(draft.status, "ready");
  const row = (k) => draft.preview.rows.find(([label]) => label === k)[1].replace(/\s/g, " ");
  assert.equal(row("Valor"), "R$ 180,00");
  assert.equal(row("Categoria"), "Combustível");
  assert.equal(row("Data"), "18/10/2026");
  assert.equal(row("Viagem"), "4ª viagem");
  assert.throws(() => markDraftConfirming(draft), /clique/);
});

test("regressão: verbos de cadastro são reconhecidos como despesa", () => {
  for (const phrase of [
    "gastei R$ 180 de combustível",
    "paguei 90 reais de hotel",
    "registrar despesa de 50 em alimentação",
    "adicionar despesa de R$ 30 de pedágio",
    "lançar despesa de 200 reais de mercadoria na 3ª viagem",
    "Secretária, registre uma despesa de R$ 75 com manutenção",
  ]) {
    assert.equal(startAdminCommand(phrase, today)?.draft.type, "expense", phrase);
  }
});

test("regressão: consultas continuam sendo consultas", () => {
  for (const phrase of [
    "quanto gastei de combustível na 4ª viagem?",
    "quanto gastei com combustível",
    "quanto paguei de hotel",
    "gastei muito com combustível?",
    "4ª viagem: despesas de combustível",
    "mostrar despesas da 4ª viagem",
    "resumo das despesas",
    "qual o total de gastos",
  ]) {
    assert.equal(startAdminCommand(phrase, today), null, phrase);
  }
});

test("texto vindo do microfone segue o mesmo roteamento do digitado", () => {
  // A voz apenas preenche o campo; o envio chama startAdminCommand com o mesmo texto.
  const spoken = "gastei cento e oitenta reais de combustível";
  const typed = "gastei 180 reais de combustível hoje na quarta viagem";
  assert.equal(startAdminCommand(typed, today)?.draft.type, "expense");
  assert.equal(startAdminCommand(typed, today).draft.fields.tripNumber, 4);
  assert.notEqual(startAdminCommand(spoken, today)?.draft.status, "ready");
});
