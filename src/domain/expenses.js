import { toDate } from "../utils/dates.js";

export const QUICK_EXPENSE_CATEGORIES = [
  { value: "merenda", label: "Merenda" },
  { value: "almoco", label: "Almoço" },
  { value: "janta", label: "Janta" },
  { value: "combustivel", label: "Combustível" },
  { value: "hotel", label: "Hotel" },
  { value: "mecanico", label: "Mecânico" },
  { value: "carro", label: "Carro" },
  { value: "outros", label: "Outros" },
  { value: "pessoal", label: "Pessoal" },
];

const categoryLabels = Object.fromEntries(
  QUICK_EXPENSE_CATEGORIES.map(({ value, label }) => [value, label])
);

Object.assign(categoryLabels, {
  alimentacao: "Alimentação",
  manutencao: "Manutenção",
  mercadoria: "Compra de mercadoria",
  transporte: "Transporte",
});

export function isPersonalWithdrawal(expense) {
  return expense?.kind === "personal_withdrawal" || expense?.category === "pessoal";
}

export function getExpenseCategoryLabel(expense) {
  return isPersonalWithdrawal(expense)
    ? "Retirada pessoal"
    : categoryLabels[expense?.category] || "Outros";
}

export function parseExpenseAmount(value) {
  const text = String(value ?? "").trim().replace(/\s/g, "");
  if (!text) return NaN;
  const normalized = text.includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : text;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return NaN;
  return Math.round(Number(normalized) * 100) / 100;
}

export function summarizeDailyExpenses(expenses = [], day = new Date()) {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const summary = expenses.reduce(
    (total, expense) => {
      const expenseDate = toDate(expense.expenseDate) || toDate(expense.createdAt);
      if (!expenseDate || expenseDate < start || expenseDate >= end) {
        return total;
      }
      if (isPersonalWithdrawal(expense)) {
        total.personal += Number(expense.value || 0);
      } else {
        total.operational += Number(expense.value || 0);
      }
      return total;
    },
    { operational: 0, personal: 0 }
  );
  return {
    operational: Math.round(summary.operational * 100) / 100,
    personal: Math.round(summary.personal * 100) / 100,
    total: Math.round((summary.operational + summary.personal) * 100) / 100,
  };
}
