import assert from "node:assert/strict";
import test from "node:test";

import {
  getExpenseCategoryLabel,
  isPersonalWithdrawal,
  parseExpenseAmount,
  summarizeDailyExpenses,
} from "./expenses.js";

test("parses decimal input with comma and optional thousands separators", () => {
  assert.equal(parseExpenseAmount("12,50"), 12.5);
  assert.equal(parseExpenseAmount("1.234,56"), 1234.56);
  assert.equal(parseExpenseAmount("25"), 25);
  assert.ok(Number.isNaN(parseExpenseAmount("12,345")));
  assert.ok(Number.isNaN(parseExpenseAmount("R$ 20")));
});

test("identifies personal withdrawals separately from operating expenses", () => {
  assert.equal(isPersonalWithdrawal({ category: "pessoal" }), true);
  assert.equal(isPersonalWithdrawal({ kind: "personal_withdrawal" }), true);
  assert.equal(isPersonalWithdrawal({ category: "combustivel" }), false);
  assert.equal(getExpenseCategoryLabel({ category: "pessoal" }), "Retirada pessoal");
  assert.equal(getExpenseCategoryLabel({ category: "merenda" }), "Merenda");
  assert.equal(getExpenseCategoryLabel({ category: "alimentacao" }), "Alimentação");
});

test("summarizes today's operating expenses and cash withdrawals independently", () => {
  const today = new Date(2026, 9, 23, 13);
  const summary = summarizeDailyExpenses(
    [
      { category: "hotel", value: 80, expenseDate: new Date(2026, 9, 23, 9) },
      { category: "pessoal", value: 40, expenseDate: new Date(2026, 9, 23, 10) },
      { category: "outros", kind: "personal_withdrawal", value: 5, expenseDate: new Date(2026, 9, 22, 10) },
    ],
    today
  );
  assert.deepEqual(summary, { operational: 80, personal: 40, total: 120 });
});
