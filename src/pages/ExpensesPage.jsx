import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { LuReceipt, LuWallet } from "react-icons/lu";
import PageHeader from "../components/PageHeader.jsx";
import FinancialValue from "../components/FinancialValue.jsx";
import useClientTrips from "../hooks/useClientTrips.js";
import { buildTripOptions, getRecordTripId, getTripOptionLabel, getTripSelectionLabel } from "../domain/tripIdentity.js";
import { auth, db } from "../firebase/config.js";
import { isFirestoreReadOnly } from "../firebase/writePolicy.js";
import { MAX_MONEY } from "../domain/adminOperations.js";
import {
  getExpenseCategoryLabel,
  isPersonalWithdrawal,
  parseExpenseAmount,
  QUICK_EXPENSE_CATEGORIES,
  summarizeDailyExpenses,
} from "../domain/expenses.js";
import { toDate, toDateInputValue } from "../utils/dates.js";
import {
  createExpense,
  removeExpense,
  updateExpense,
} from "../services/expenses.js";
import "./ExpensesPage.css";

const PAYMENT_METHOD_STORAGE_KEY = "rc-expense-last-payment-method";
const PAYMENT_METHODS = [
  ["", "Não informado"],
  ["pix", "Pix"],
  ["dinheiro", "Dinheiro"],
  ["transferencia", "Transferência"],
  ["cartao", "Cartão"],
  ["cheque", "Cheque"],
  ["boleto", "Boleto"],
  ["outros", "Outros"],
];

function todayInput() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function expenseDate(expense) {
  return toDate(expense.expenseDate) || toDate(expense.createdAt);
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function paymentMethodLabel(method) {
  return PAYMENT_METHODS.find(([value]) => value === method)?.[1] || "Não informado";
}

function createEmptyForm(paymentMethod = "") {
  return {
    category: "",
    value: "",
    date: todayInput(),
    paymentMethod,
    city: "",
    tripId: "",
  };
}

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState([]);
  const [userId, setUserId] = useState("");
  const { trips } = useClientTrips(userId);
  const tripOptions = useMemo(() => buildTripOptions({ trips, expenses }), [trips, expenses]);
  const [form, setForm] = useState(() => createEmptyForm(
    window.localStorage.getItem(PAYMENT_METHOD_STORAGE_KEY) || ""
  ));
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const amountInput = useRef(null);
  const submitLock = useRef(false);
  const pendingCreate = useRef(null);

  useEffect(() => {
    let unsubscribeExpenses = null;
    let authGeneration = 0;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      const generation = ++authGeneration;
      setUserId(user?.uid || "");
      unsubscribeExpenses?.();
      setExpenses([]);
      setLoading(Boolean(user));
      setError("");
      setEditingExpenseId(null);
      pendingCreate.current = null;
      if (!user) {
        setLoading(false);
        return;
      }
      unsubscribeExpenses = onSnapshot(
        collection(db, "users", user.uid, "expenses"),
        (snapshot) => {
          if (generation !== authGeneration) return;
          setExpenses(snapshot.docs.map((entry) => ({
            id: entry.id,
            ...entry.data(),
          })));
          setLoading(false);
        },
        (loadError) => {
          if (generation !== authGeneration) return;
          console.error("Erro ao carregar despesas:", loadError);
          setError(`Não foi possível carregar as despesas: ${loadError.message}`);
          setLoading(false);
        }
      );
    });
    return () => {
      unsubscribeAuth();
      authGeneration += 1;
      unsubscribeExpenses?.();
    };
  }, []);

  const recentExpenses = useMemo(
    () => [...expenses]
      .sort((first, second) =>
        (expenseDate(second)?.getTime() || 0) -
        (expenseDate(first)?.getTime() || 0)
      )
      .slice(0, 20),
    [expenses]
  );
  const todaySummary = useMemo(
    () => summarizeDailyExpenses(expenses),
    [expenses]
  );

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function selectCategory(category) {
    setField("category", category);
    requestAnimationFrame(() => amountInput.current?.focus());
  }

  function resetAfterSave() {
    setEditingExpenseId(null);
    setForm((current) => ({
      ...current,
      value: "",
      date: todayInput(),
      category: "",
    }));
  }

  function beginEdit(expense) {
    setEditingExpenseId(expense.id);
    setForm({
      category: expense.category || "outros",
      value: String(expense.value ?? ""),
      date: toDateInputValue(expenseDate(expense)) || todayInput(),
      paymentMethod: expense.paymentMethod || "",
      city: expense.city || "",
      tripId: getRecordTripId(expense),
    });
    setError("");
    setNotice("");
    amountInput.current?.focus();
  }

  function cancelEdit() {
    setEditingExpenseId(null);
    setForm((current) => ({
      ...createEmptyForm(current.paymentMethod),
      city: current.city,
      tripId: current.tripId,
    }));
    setError("");
    setNotice("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitLock.current) return;
    const user = auth.currentUser;
    if (!user) {
      setError("Sua sessão expirou. Entre novamente para salvar.");
      return;
    }
    if (!form.category) {
      setError("Escolha uma categoria para continuar.");
      return;
    }
    const value = parseExpenseAmount(form.value);
    if (!Number.isFinite(value) || value <= 0 || value > MAX_MONEY) {
      setError(`Digite um valor válido entre R$ 0,01 e ${formatCurrency(MAX_MONEY)}.`);
      return;
    }
    const date = form.date ? new Date(`${form.date}T12:00:00`) : null;
    if (!date || Number.isNaN(date.getTime())) {
      setError("Informe uma data válida.");
      return;
    }
    const selectedTrip = form.tripId
      ? tripOptions.find((trip) => trip.id === form.tripId)
      : null;
    if (form.tripId && !selectedTrip) {
      setError("Selecione uma viagem válida ou deixe sem viagem.");
      return;
    }
    const isPersonal = form.category === "pessoal";
    const expenseData = {
      category: form.category,
      kind: isPersonal ? "personal_withdrawal" : "operational",
      value,
      expenseDate: date,
      paymentMethod: form.paymentMethod || null,
      city: form.city.trim(),
      ...(editingExpenseId && getRecordTripId(expenses.find((expense) => expense.id === editingExpenseId)) === form.tripId
        ? {}
        : {
            tripId: selectedTrip?.id || "",
            tripName: selectedTrip?.name || "",
            tripNumber: selectedTrip?.tripNumber || null,
            tripYear: selectedTrip?.tripYear || null,
          }),
    };
    if (isFirestoreReadOnly()) {
      setError("A gravação está bloqueada no modo somente leitura.");
      return;
    }

    submitLock.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (editingExpenseId) {
        if (!window.confirm("Salvar as alterações deste lançamento?")) return;
        await updateExpense({
          db,
          userId: user.uid,
          expenseId: editingExpenseId,
          expense: expenseData,
        });
        setNotice("Lançamento atualizado. Totais e relatórios foram recalculados.");
      } else {
        const fingerprint = JSON.stringify({
          ...expenseData,
          expenseDate: form.date,
        });
        if (pendingCreate.current?.fingerprint !== fingerprint) {
          pendingCreate.current = {
            fingerprint,
            id: doc(collection(db, "users", user.uid, "expenses")).id,
          };
        }
        const alreadySaved = await createExpense({
          db,
          userId: user.uid,
          expenseId: pendingCreate.current.id,
          expense: expenseData,
        });
        pendingCreate.current = null;
        let paymentMethodRemembered = true;
        try {
          if (form.paymentMethod) {
            window.localStorage.setItem(PAYMENT_METHOD_STORAGE_KEY, form.paymentMethod);
          }
        } catch (storageError) {
          console.error("Não foi possível lembrar a forma de pagamento:", storageError);
          paymentMethodRemembered = false;
        }
        setNotice(!paymentMethodRemembered
          ? "Lançamento salvo, mas a forma de pagamento não pôde ser lembrada neste dispositivo."
          : alreadySaved
            ? "Este lançamento já estava salvo; nenhum registro duplicado foi criado."
            : "Lançamento salvo com sucesso.");
      }
      resetAfterSave();
    } catch (saveError) {
      console.error("Erro ao salvar despesa:", saveError);
      setError(`Não foi possível salvar o lançamento: ${saveError.message}`);
    } finally {
      submitLock.current = false;
      setSaving(false);
    }
  }

  async function handleDelete(expense) {
    if (!window.confirm("Excluir este lançamento? Os totais e relatórios serão atualizados.")) return;
    const user = auth.currentUser;
    if (!user) {
      setError("Sua sessão expirou. Entre novamente para continuar.");
      return;
    }
    try {
      await removeExpense({ db, userId: user.uid, expenseId: expense.id });
      if (editingExpenseId === expense.id) cancelEdit();
      setNotice("Lançamento excluído e totais atualizados.");
      setError("");
    } catch (deleteError) {
      console.error("Erro ao excluir despesa:", deleteError);
      setError(`Não foi possível excluir o lançamento: ${deleteError.message}`);
    }
  }

  return (
    <div className="expenses-page">
      <PageHeader
        icon={LuReceipt}
        title="Despesas"
        description="Lançamentos rápidos vinculados ao Financeiro e aos relatórios da RC."
      />

      {isFirestoreReadOnly() && (
        <div className="expenses-readonly" role="status">
          Prévia somente leitura: os lançamentos estão desabilitados para proteger os dados do Firebase.
        </div>
      )}
      {error && <div className="expenses-alert" role="alert">{error}</div>}
      {notice && <div className="expenses-notice" role="status">{notice}</div>}

      <section className="expenses-today-grid" aria-label="Resumo de hoje">
        <article className="expenses-today-card expenses-today-total">
          <span><LuWallet aria-hidden="true" /> Saídas de hoje</span>
          <strong><FinancialValue>{formatCurrency(todaySummary.total)}</FinancialValue></strong>
          <small>
            Operacionais <FinancialValue>{formatCurrency(todaySummary.operational)}</FinancialValue>
            {" · "}Retirada pessoal <FinancialValue>{formatCurrency(todaySummary.personal)}</FinancialValue>
          </small>
        </article>
        <article className="expenses-today-card">
          <span>Despesas operacionais</span>
          <strong><FinancialValue>{formatCurrency(todaySummary.operational)}</FinancialValue></strong>
          <small>Consideradas no cálculo do lucro operacional.</small>
        </article>
        <article className="expenses-today-card expenses-personal-card">
          <span>Retirada pessoal</span>
          <strong><FinancialValue>{formatCurrency(todaySummary.personal)}</FinancialValue></strong>
          <small>Reduz o caixa, sem reduzir o lucro operacional.</small>
        </article>
      </section>

      <div className="expenses-content-grid">
        <form className="expenses-entry-card" onSubmit={handleSubmit}>
          <div className="expenses-card-heading">
            <div>
              <span className="expenses-eyebrow">{editingExpenseId ? "AJUSTE DE LANÇAMENTO" : "NOVO LANÇAMENTO"}</span>
              <h2>{editingExpenseId ? "Editar lançamento" : "Lançamento rápido"}</h2>
            </div>
            {editingExpenseId && (
              <button type="button" className="expenses-cancel-link" onClick={cancelEdit} disabled={saving}>
                Cancelar edição
              </button>
            )}
          </div>

          <fieldset className="expenses-categories">
            <legend>1. Escolha a categoria</legend>
            <div className="expenses-category-grid">
              {QUICK_EXPENSE_CATEGORIES.map((category) => (
                <button
                  key={category.value}
                  type="button"
                  className={`expenses-category${form.category === category.value ? " is-selected" : ""}${category.value === "pessoal" ? " is-personal" : ""}`}
                  aria-pressed={form.category === category.value}
                  onClick={() => selectCategory(category.value)}
                >
                  <span className="expenses-category-mark" aria-hidden="true" />
                  {category.label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="expenses-field expenses-amount-field">
            <span>2. Valor</span>
            <div className="expenses-amount-input">
              <span>R$</span>
              <input
                ref={amountInput}
                aria-label="Valor"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                value={form.value}
                onChange={(event) => setField("value", event.target.value)}
                required
                disabled={saving || isFirestoreReadOnly()}
              />
            </div>
          </label>

          <div className="expenses-fields-row">
            <label className="expenses-field">
              <span>Data</span>
              <input
                aria-label="Data"
                type="date"
                value={form.date}
                onChange={(event) => setField("date", event.target.value)}
                required
                disabled={saving || isFirestoreReadOnly()}
              />
            </label>
            <label className="expenses-field">
              <span>Forma de pagamento <small>(opcional)</small></span>
              <select
                aria-label="Forma de pagamento"
                value={form.paymentMethod}
                onChange={(event) => setField("paymentMethod", event.target.value)}
                disabled={saving || isFirestoreReadOnly()}
              >
                {PAYMENT_METHODS.map(([value, label]) => (
                  <option key={value || "none"} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </div>

          <details className="expenses-optional-fields">
            <summary>Vincular cidade e viagem <span>(opcional)</span></summary>
            <div className="expenses-fields-row">
              <label className="expenses-field">
                <span>Cidade</span>
                <input
                  aria-label="Cidade"
                  type="text"
                  maxLength={100}
                  placeholder="Ex.: Campinas"
                  value={form.city}
                  onChange={(event) => setField("city", event.target.value)}
                  disabled={saving || isFirestoreReadOnly()}
                />
              </label>
              <label className="expenses-field">
                <span>Viagem</span>
                <select
                  aria-label="Viagem"
                  value={form.tripId}
                  onChange={(event) => setField("tripId", event.target.value)}
                  disabled={saving || isFirestoreReadOnly()}
                >
                  <option value="">Sem viagem definida</option>
                  {tripOptions.map((trip) => (
                    <option key={trip.id} value={trip.id}>{getTripSelectionLabel(trip, tripOptions)}</option>
                  ))}
                </select>
              </label>
            </div>
          </details>

          {form.category === "pessoal" && (
            <p className="expenses-personal-note">
              Será registrada como retirada pessoal: diminui o caixa disponível, mas não entra nas despesas operacionais nem no lucro operacional.
            </p>
          )}

          <button
            type="submit"
            className="expenses-save-button"
            disabled={saving || isFirestoreReadOnly()}
          >
            {saving ? "Salvando..." : editingExpenseId ? "Salvar alterações" : "Salvar lançamento"}
          </button>
        </form>

        <section className="expenses-recent-card">
          <div className="expenses-card-heading">
            <div>
              <span className="expenses-eyebrow">MOVIMENTAÇÕES</span>
              <h2>Lançamentos recentes</h2>
            </div>
            <span className="expenses-count">{recentExpenses.length}</span>
          </div>
          {loading ? (
            <p className="expenses-empty">Carregando lançamentos...</p>
          ) : recentExpenses.length === 0 ? (
            <p className="expenses-empty">Ainda não há despesas cadastradas.</p>
          ) : (
            <div className="expenses-recent-list">
              {recentExpenses.map((expense) => {
                const personal = isPersonalWithdrawal(expense);
                const date = expenseDate(expense);
                return (
                  <article className={`expenses-recent-item${personal ? " is-personal" : ""}`} key={expense.id}>
                    <div className="expenses-recent-main">
                      <div className="expenses-recent-title">
                        <strong>{getExpenseCategoryLabel(expense)}</strong>
                        {personal && <span>RETIRADA</span>}
                      </div>
                      <p>
                        {date?.toLocaleDateString("pt-BR") || "Data não informada"}
                        {expense.city ? ` · ${expense.city}` : ""}
                        {getRecordTripId(expense) ? ` · ${getTripOptionLabel(expense, tripOptions)}` : ""}
                      </p>
                      <small>Pagamento: {paymentMethodLabel(expense.paymentMethod)}</small>
                    </div>
                    <div className="expenses-recent-side">
                      <strong><FinancialValue>{formatCurrency(expense.value)}</FinancialValue></strong>
                      <div>
                        <button
                          type="button"
                          onClick={() => beginEdit(expense)}
                          disabled={saving || isFirestoreReadOnly()}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="expenses-delete-button"
                          onClick={() => handleDelete(expense)}
                          disabled={saving || isFirestoreReadOnly()}
                        >
                          Excluir
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {expenses.length > recentExpenses.length && (
            <p className="expenses-recent-footnote">Exibindo os 20 lançamentos mais recentes. O histórico completo continua no Financeiro.</p>
          )}
        </section>
      </div>
    </div>
  );
}
