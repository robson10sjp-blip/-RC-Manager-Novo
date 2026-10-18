import { useEffect, useMemo, useRef, useState } from "react";
import { LuTruck } from "react-icons/lu";
import PageHeader from "../components/PageHeader.jsx";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { auth, db } from "../firebase/config";
import { runTransaction } from "../firebase/firestoreAccess";
import { applyPaymentToPayable, getPayableBalance, summarizePayables } from "../domain/payables";
import { isFirestoreReadOnly } from "../firebase/writePolicy";
import {
  buildSupplierPayable,
  createSupplierIdentifier,
  formatSupplierDocument,
  formatSupplierPhone,
  getSupplierDisplayName,
} from "../domain/suppliers";
import { toDate } from "../utils/dates";
import "./SuppliersPage.css";

const todayInput = () => new Date().toISOString().slice(0, 10);
const emptyForm = {
  name: "",
  companyName: "",
  taxId: "",
  phone: "",
  city: "",
  state: "",
  notes: "",
};
const emptyPurchase = {
  supplierId: "",
  description: "",
  purchaseDate: todayInput(),
  totalAmount: "",
  paymentType: "credit",
  paymentMethod: "pix",
  downPayment: "0",
};
const emptyPayment = {
  payableId: "",
  amount: "",
  date: todayInput(),
  method: "pix",
  identification: "",
};

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [payables, setPayables] = useState([]);
  const [paymentsByPayable, setPaymentsByPayable] = useState({});
  const [form, setForm] = useState(emptyForm);
  const [purchase, setPurchase] = useState(emptyPurchase);
  const [installments, setInstallments] = useState([]);
  const [payment, setPayment] = useState(emptyPayment);
  const [editingId, setEditingId] = useState(null);
  const [expandedSupplierId, setExpandedSupplierId] = useState(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPurchase, setSavingPurchase] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const savingLock = useRef(false);
  const purchaseLock = useRef(false);
  const paymentLock = useRef(false);
  const paymentOperation = useRef(null);

  useEffect(() => {
    let unsubscribeSuppliers = null;
    let unsubscribePayables = null;
    let generation = 0;
    const paymentListeners = new Map();
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      generation += 1;
      const currentGeneration = generation;
      unsubscribeSuppliers?.();
      unsubscribePayables?.();
      for (const unsubscribe of paymentListeners.values()) unsubscribe();
      paymentListeners.clear();
      setSuppliers([]);
      setPayables([]);
      setPaymentsByPayable({});
      setForm(emptyForm);
      setPurchase({ ...emptyPurchase, purchaseDate: todayInput() });
      setInstallments([]);
      setPayment({ ...emptyPayment, date: todayInput() });
      setEditingId(null);
      setExpandedSupplierId(null);
      setSearch("");
      setLoading(Boolean(user));
      setError("");
      setNotice("");

      if (!user) {
        setLoading(false);
        return;
      }

      unsubscribeSuppliers = onSnapshot(
        collection(db, "users", user.uid, "suppliers"),
        (snapshot) => {
          if (currentGeneration !== generation) return;
          setSuppliers(
            snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
          );
          setLoading(false);
        },
        (loadError) => {
          if (currentGeneration !== generation) return;
          console.error("Erro ao carregar fornecedores:", loadError);
          setError("Não foi possível carregar os fornecedores.");
          setLoading(false);
        }
      );
      unsubscribePayables = onSnapshot(
        collection(db, "users", user.uid, "payables"),
        (snapshot) => {
          if (currentGeneration !== generation) return;
          const documents = snapshot.docs;
          const payableIds = new Set(documents.map((item) => item.id));
          for (const [payableId, unsubscribe] of paymentListeners) {
            if (payableIds.has(payableId)) continue;
            unsubscribe();
            paymentListeners.delete(payableId);
            setPaymentsByPayable((current) => {
              const next = { ...current };
              delete next[payableId];
              return next;
            });
          }
          for (const payableDocument of documents) {
            if (paymentListeners.has(payableDocument.id)) continue;
            paymentListeners.set(
              payableDocument.id,
              onSnapshot(
                collection(
                  db,
                  "users",
                  user.uid,
                  "payables",
                  payableDocument.id,
                  "payments"
                ),
                (paymentsSnapshot) => {
                  if (currentGeneration !== generation) return;
                  setPaymentsByPayable((current) => ({
                    ...current,
                    [payableDocument.id]: paymentsSnapshot.docs
                      .map((item) => ({ id: item.id, ...item.data() }))
                      .sort(
                        (first, second) =>
                          (toDate(second.date)?.getTime() || 0) -
                          (toDate(first.date)?.getTime() || 0)
                      ),
                  }));
                },
                (loadError) => {
                  if (currentGeneration !== generation) return;
                  console.error("Erro ao carregar pagamentos do fornecedor:", loadError);
                  setError("Não foi possível carregar todo o histórico de pagamentos.");
                }
              )
            );
          }
          setPayables(documents.map((item) => ({ id: item.id, ...item.data() })));
        },
        (loadError) => {
          if (currentGeneration !== generation) return;
          console.error("Erro ao verificar contas vinculadas:", loadError);
          setError("Não foi possível verificar as contas vinculadas aos fornecedores.");
        }
      );
    });

    return () => {
      generation += 1;
      unsubscribeAuth();
      unsubscribeSuppliers?.();
      unsubscribePayables?.();
      for (const unsubscribe of paymentListeners.values()) unsubscribe();
      paymentListeners.clear();
    };
  }, []);

  const visibleSuppliers = useMemo(() => {
    const searchTerm = search.trim().toLocaleLowerCase("pt-BR");
    return [...suppliers]
      .filter((supplier) =>
        !searchTerm ||
        [
          supplier.identifier,
          supplier.name,
          supplier.companyName,
          supplier.taxId,
          supplier.phone,
          supplier.city,
          supplier.state,
        ].some((value) =>
          String(value || "").toLocaleLowerCase("pt-BR").includes(searchTerm)
        )
      )
      .sort((first, second) =>
        String(first.name || "").localeCompare(String(second.name || ""), "pt-BR")
      );
  }, [search, suppliers]);

  function handleChange(event) {
    const { name, value } = event.target;
    const formatted =
      name === "phone"
        ? formatSupplierPhone(value)
        : name === "taxId"
          ? formatSupplierDocument(value)
          : value;
    setForm((current) => ({ ...current, [name]: formatted }));
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setNotice("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const user = auth.currentUser;
    const name = form.name.trim();
    if (!user) {
      setError("Entre novamente no RC Manager para continuar.");
      return;
    }
    if (!name) {
      setError("Informe o nome do fornecedor.");
      return;
    }
    if (savingLock.current) return;

    try {
      savingLock.current = true;
      setSaving(true);
      setError("");
      const supplierCollection = collection(db, "users", user.uid, "suppliers");
      const supplierReference = editingId
        ? doc(db, "users", user.uid, "suppliers", editingId)
        : doc(supplierCollection);
      const original = suppliers.find((item) => item.id === editingId);
      const identifier =
        original?.identifier || createSupplierIdentifier(supplierReference.id);
      const data = {
        identifier,
        normalizedIdentifier: identifier.toLocaleLowerCase("pt-BR"),
        name,
        companyName: form.companyName.trim(),
        taxId: form.taxId.trim(),
        phone: form.phone.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        notes: form.notes.trim(),
        updatedAt: serverTimestamp(),
      };
      await runTransaction(db, async (transaction) => {
        if (editingId) {
          const supplierSnapshot = await transaction.get(supplierReference);
          if (!supplierSnapshot?.exists()) {
            throw new Error("O fornecedor não foi encontrado.");
          }
          transaction.update(supplierReference, data);
        } else {
          transaction.set(supplierReference, {
            ...data,
            createdAt: serverTimestamp(),
          });
        }
      });
      resetForm();
    } catch (saveError) {
      console.error("Erro ao salvar fornecedor:", saveError);
      setError(`Não foi possível salvar o fornecedor: ${saveError.message}`);
    } finally {
      savingLock.current = false;
      setSaving(false);
    }
  }

  function editSupplier(supplier) {
    setEditingId(supplier.id);
    setForm({
      name: supplier.name || "",
      companyName: supplier.companyName || "",
      taxId: supplier.taxId || "",
      phone: supplier.phone || "",
      city: supplier.city || "",
      state: supplier.state || "",
      notes: supplier.notes || "",
    });
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const payableSummary = useMemo(
    () => summarizePayables(payables),
    [payables]
  );
  const upcomingAccountCount = new Set(
    payableSummary.upcomingItems.map((item) => item.payableId)
  ).size;
  const paidPayableCount = payables.filter(
    (payable) => getPayableBalance(payable) === 0
  ).length;
  const readOnly = isFirestoreReadOnly();

  async function removeSupplier(supplier) {
    const user = auth.currentUser;
    if (!user) {
      setError("Entre novamente no RC Manager para continuar.");
      return;
    }
    if (payables.some((payable) => payable.supplierId === supplier.id)) {
      setError("Este fornecedor possui contas vinculadas e não pode ser excluído.");
      return;
    }
    if (!window.confirm(`Excluir o fornecedor “${supplier.name}”?`)) return;
    try {
      const supplierReference = doc(db, "users", user.uid, "suppliers", supplier.id);
      const linkedPayables = query(
        collection(db, "users", user.uid, "payables"),
        where("supplierId", "==", supplier.id)
      );
      await runTransaction(db, async (transaction) => {
        const [supplierSnapshot, payableSnapshot] = await Promise.all([
          transaction.get(supplierReference),
          transaction.get(linkedPayables),
        ]);
        if (!supplierSnapshot.exists()) return;
        if (!payableSnapshot.empty) {
          throw new Error("Este fornecedor possui contas vinculadas e não pode ser excluído.");
        }
        transaction.delete(supplierReference);
      });
      if (editingId === supplier.id) resetForm();
      setError("");
    } catch (deleteError) {
      console.error("Erro ao excluir fornecedor:", deleteError);
      setError(`Não foi possível excluir o fornecedor: ${deleteError.message}`);
    }
  }

  function updateInstallment(index, field, value) {
    setInstallments((current) =>
      current.map((installment, installmentIndex) =>
        installmentIndex === index
          ? { ...installment, [field]: value }
          : installment
      )
    );
  }

  async function handlePurchaseSubmit(event) {
    event.preventDefault();
    if (purchaseLock.current) return;
    const user = auth.currentUser;
    if (!user) {
      setError("Entre novamente no RC Manager para continuar.");
      return;
    }

    const supplier = suppliers.find((item) => item.id === purchase.supplierId);
    const paidAmount =
      purchase.paymentType === "cash"
        ? purchase.totalAmount
        : purchase.downPayment;
    let payableData;
    try {
      payableData = buildSupplierPayable({
        supplier,
        description: purchase.description,
        purchaseDate: purchase.purchaseDate,
        totalAmount: purchase.totalAmount,
        downPayment: paidAmount,
        installments: purchase.paymentType === "cash" ? [] : installments,
      });
    } catch (validationError) {
      setError(validationError.message);
      return;
    }

    try {
      purchaseLock.current = true;
      setSavingPurchase(true);
      setError("");
      const payableReference = doc(collection(db, "users", user.uid, "payables"));
      const paid = Number(payableData.paidAmount);
      const initialPaymentReference =
        paid > 0
          ? doc(
              collection(
                db,
                "users",
                user.uid,
                "payables",
                payableReference.id,
                "payments"
              )
            )
          : null;
      await runTransaction(db, async (transaction) => {
        const existing = await transaction.get(payableReference);
        if (existing.exists()) return;
        transaction.set(payableReference, {
          ...payableData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          ...(paid > 0 ? { initialPaymentDate: new Date(`${purchase.purchaseDate}T12:00:00`) } : {}),
        });
        if (initialPaymentReference) {
          transaction.set(initialPaymentReference, {
            operationId: initialPaymentReference.id,
            type: purchase.paymentType === "cash" ? "cash-purchase" : "down-payment",
            amount: paid,
            date: new Date(`${purchase.purchaseDate}T12:00:00`),
            method: purchase.paymentMethod,
            identification: "",
            allocations: [],
            createdAt: serverTimestamp(),
          });
        }
      });
      setPurchase({ ...emptyPurchase, purchaseDate: todayInput() });
      setInstallments([]);
      setError("");
      setNotice("Compra registrada em Contas a pagar e vinculada ao fornecedor.");
    } catch (purchaseError) {
      console.error("Erro ao registrar compra do fornecedor:", purchaseError);
      setError(`Não foi possível registrar a compra: ${purchaseError.message}`);
    } finally {
      purchaseLock.current = false;
      setSavingPurchase(false);
    }
  }

  async function handlePaymentSubmit(event) {
    event.preventDefault();
    if (paymentLock.current) return;
    const user = auth.currentUser;
    const payable = payables.find((item) => item.id === payment.payableId);
    const amount = Number(String(payment.amount).replace(",", "."));
    const date = payment.date ? new Date(`${payment.date}T12:00:00`) : null;
    if (!user || !payable) {
      setError("Selecione uma compra válida para registrar o pagamento.");
      return;
    }
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !date ||
      Number.isNaN(date.getTime())
    ) {
      setError("Informe um valor e uma data válidos para o pagamento.");
      return;
    }

    const fingerprint = [
      payable.id,
      amount,
      payment.date,
      payment.method,
      payment.identification.trim(),
    ].join("|");
    if (paymentOperation.current?.fingerprint !== fingerprint) {
      paymentOperation.current = {
        fingerprint,
        reference: doc(
          collection(
            db,
            "users",
            user.uid,
            "payables",
            payable.id,
            "payments"
          )
        ),
      };
    }
    const paymentReference = paymentOperation.current.reference;
    const payableReference = doc(db, "users", user.uid, "payables", payable.id);

    try {
      paymentLock.current = true;
      setSavingPayment(true);
      setError("");
      setNotice("");
      const alreadyRecorded = await runTransaction(db, async (transaction) => {
        const recordedPayment = await transaction.get(paymentReference);
        if (recordedPayment.exists()) return true;
        const payableSnapshot = await transaction.get(payableReference);
        if (!payableSnapshot.exists()) {
          throw new Error("A compra do fornecedor não foi encontrada.");
        }
        const savedPayable = { id: payableSnapshot.id, ...payableSnapshot.data() };
        const result = applyPaymentToPayable(savedPayable, { amount });
        transaction.update(payableReference, {
          paidAmount: result.paidAmount,
          balance: result.balance,
          status: result.status,
          installments: result.installments,
          updatedAt: serverTimestamp(),
        });
        transaction.set(paymentReference, {
          operationId: paymentReference.id,
          amount,
          date,
          method: payment.method,
          identification: payment.identification.trim(),
          allocations: result.allocations,
          createdAt: serverTimestamp(),
        });
        return false;
      });
      if (!alreadyRecorded) {
        paymentOperation.current = null;
        setPayment({ ...emptyPayment, date: todayInput() });
      }
      setNotice(
        alreadyRecorded
          ? "Este pagamento já estava registrado; o saldo não foi atualizado novamente."
          : "Pagamento registrado, saldo recalculado e fluxo de caixa atualizado."
      );
    } catch (paymentError) {
      console.error("Erro ao registrar pagamento de fornecedor:", paymentError);
      setError(`Não foi possível registrar o pagamento: ${paymentError.message}`);
      setNotice("");
    } finally {
      paymentLock.current = false;
      setSavingPayment(false);
    }
  }

  function formatCurrency(value) {
    return Number(value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }

  function formatDate(value) {
    const date = toDate(value);
    return date ? date.toLocaleDateString("pt-BR") : "Data não informada";
  }

  return (
    <main className="suppliers-page">
      <PageHeader
        icon={LuTruck}
        title="Fornecedores"
        description="Organize os contatos e vincule cada conta ao fornecedor correto."
      >
        <div className="suppliers-count">
          <strong>{suppliers.length}</strong>
          <span>fornecedor(es)</span>
        </div>
      </PageHeader>

      {readOnly && (
        <div className="suppliers-readonly" role="status">
          Prévia somente leitura: cadastros, compras e pagamentos estão
          desabilitados para proteger os dados do Firebase.
        </div>
      )}
      {error && <div className="suppliers-error" role="alert">{error}</div>}
      {notice && <div className="suppliers-notice" role="status">{notice}</div>}

      <section className="supplier-payables-metrics" aria-label="Resumo de contas a pagar">
        <article><span>Total devido a fornecedores</span><strong>{formatCurrency(payableSummary.totalToPay)}</strong></article>
        <article><span>Contas vencidas</span><strong>{payableSummary.overdueCount} · {formatCurrency(payableSummary.overdueTotal)}</strong></article>
        <article><span>Contas a vencer (30 dias)</span><strong>{upcomingAccountCount} · {formatCurrency(payableSummary.upcomingTotal)}</strong></article>
        <article><span>Contas quitadas</span><strong>{paidPayableCount}</strong></article>
        <article><span>Total já pago</span><strong>{formatCurrency(payableSummary.totalPaid)}</strong></article>
      </section>

      <section className="suppliers-grid">
        <form className="suppliers-card suppliers-form" onSubmit={handleSubmit}>
          <h2>{editingId ? "Editar fornecedor" : "Novo fornecedor"}</h2>
          <label>
            Nome *
            <input name="name" value={form.name} onChange={handleChange} required maxLength={120} />
          </label>
          <label>
            Nome fantasia ou empresa
            <input name="companyName" value={form.companyName} onChange={handleChange} maxLength={160} />
          </label>
          <label>
            CPF ou CNPJ
            <input name="taxId" value={form.taxId} onChange={handleChange} inputMode="numeric" maxLength={18} placeholder="Opcional" />
          </label>
          <label>
            Telefone / WhatsApp
            <input name="phone" value={form.phone} onChange={handleChange} inputMode="tel" maxLength={16} placeholder="(00) 00000-0000" />
          </label>
          <label>
            Cidade
            <input name="city" value={form.city} onChange={handleChange} maxLength={100} />
          </label>
          <label>
            Estado
            <input name="state" value={form.state} onChange={handleChange} maxLength={60} />
          </label>
          <label>
            Observações
            <textarea name="notes" value={form.notes} onChange={handleChange} rows={4} maxLength={1000} />
          </label>
          <button className="suppliers-primary-button" type="submit" disabled={saving || readOnly}>
            {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Cadastrar fornecedor"}
          </button>
          {editingId && (
            <button className="suppliers-secondary-button" type="button" onClick={resetForm} disabled={readOnly}>
              Cancelar edição
            </button>
          )}
          <small>* Nome obrigatório. O código do fornecedor é gerado automaticamente.</small>
        </form>

        <section className="suppliers-card">
          <div className="suppliers-list-heading">
            <div>
              <h2>Fornecedores cadastrados</h2>
              <p>Dados privados da conta autenticada.</p>
            </div>
            <input
              className="suppliers-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar fornecedor"
              aria-label="Buscar fornecedor"
            />
          </div>
          {loading ? (
            <p className="suppliers-empty">Carregando fornecedores…</p>
          ) : visibleSuppliers.length === 0 ? (
            <p className="suppliers-empty">Nenhum fornecedor cadastrado ainda.</p>
          ) : (
            <div className="suppliers-list">
              {visibleSuppliers.map((supplier) => (
                <article className="supplier-row" key={supplier.id}>
                  <div className="supplier-avatar" aria-hidden="true">🏢</div>
                  <div className="supplier-details">
                    <div className="supplier-title-line">
                      <h3>{getSupplierDisplayName(supplier)}</h3>
                      <span>{supplier.identifier || "Código antigo não informado"}</span>
                    </div>
                    {supplier.companyName && supplier.name !== supplier.companyName && (
                      <p>Contato: {supplier.name}</p>
                    )}
                    <p>
                      {[
                        supplier.taxId,
                        supplier.phone,
                        [supplier.city, supplier.state].filter(Boolean).join(" – "),
                      ].filter(Boolean).join(" • ") ||
                        "Telefone e cidade não informados"}
                    </p>
                    {supplier.notes && <p className="supplier-notes">{supplier.notes}</p>}
                    <small>
                      {payables.filter((item) => item.supplierId === supplier.id).length} compra(s) ·{" "}
                      {formatCurrency(payables
                        .filter((item) => item.supplierId === supplier.id)
                        .reduce((sum, item) => sum + getPayableBalance(item), 0))} em aberto
                    </small>
                  </div>
                  <div className="supplier-actions">
                    <button type="button" onClick={() => setExpandedSupplierId((current) => current === supplier.id ? null : supplier.id)}>
                      {expandedSupplierId === supplier.id ? "Ocultar histórico" : "Histórico"}
                    </button>
                    <button type="button" onClick={() => editSupplier(supplier)} disabled={readOnly}>Editar</button>
                    <button type="button" onClick={() => removeSupplier(supplier)} disabled={readOnly}>Excluir</button>
                  </div>
                  {expandedSupplierId === supplier.id && (
                    <div className="supplier-history">
                      <h4>Compras, parcelas e pagamentos</h4>
                      {payables.filter((item) => item.supplierId === supplier.id).length === 0 ? (
                        <p>Nenhuma compra registrada para este fornecedor.</p>
                      ) : (
                        <div className="supplier-purchase-list">
                          {payables
                            .filter((item) => item.supplierId === supplier.id)
                            .sort((first, second) =>
                              (toDate(second.purchaseDate)?.getTime() || 0) -
                              (toDate(first.purchaseDate)?.getTime() || 0)
                            )
                            .map((item) => (
                              <article className="supplier-purchase" key={item.id}>
                                <div className="supplier-purchase-heading">
                                  <div>
                                    <strong>{item.description || "Compra de mercadorias"}</strong>
                                    <span>Compra em {formatDate(item.purchaseDate)}</span>
                                  </div>
                                  <b className={getPayableBalance(item) > 0 ? "supplier-balance-open" : "supplier-balance-paid"}>
                                    {getPayableBalance(item) > 0
                                      ? `${formatCurrency(getPayableBalance(item))} em aberto`
                                      : "Quitada"}
                                  </b>
                                </div>
                                <div className="supplier-purchase-meta">
                                  <span>Total: {formatCurrency(item.totalAmount)}</span>
                                  <span>Pago: {formatCurrency(item.paidAmount)}</span>
                                  <span>Parcelas: {(item.installments || []).length}</span>
                                </div>
                                {(item.installments || []).map((installment, index) => (
                                  <div className="supplier-installment" key={installment.id || index}>
                                    <span>Parcela {index + 1} · vence {formatDate(installment.dueDate)}</span>
                                    <span>
                                      {formatCurrency(installment.paidAmount || 0)} de{" "}
                                      {formatCurrency(installment.amount)}
                                    </span>
                                    <strong>
                                      Saldo {formatCurrency(Math.max(Number(installment.amount || 0) - Number(installment.paidAmount || 0), 0))}
                                    </strong>
                                  </div>
                                ))}
                                {(paymentsByPayable[item.id] || []).length > 0 && (
                                  <details className="supplier-payment-history">
                                    <summary>Histórico de pagamentos ({paymentsByPayable[item.id].length})</summary>
                                    {paymentsByPayable[item.id].map((entry) => (
                                      <p key={entry.id}>
                                        {formatDate(entry.date)} · {formatCurrency(entry.amount)} ·{" "}
                                        {entry.method || entry.type || "Pagamento"}
                                        {entry.identification ? ` · ${entry.identification}` : ""}
                                      </p>
                                    ))}
                                  </details>
                                )}
                              </article>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </section>

      <section className="suppliers-purchases">
        <div className="suppliers-section-heading">
          <div>
            <p className="suppliers-eyebrow">Mercadorias e obrigações</p>
            <h2>Registrar compra de mercadorias</h2>
            <p>
              As compras são lançadas uma única vez em Contas a pagar. Compras
              classificadas como estoque não são duplicadas como despesas.
            </p>
          </div>
        </div>

        <form className="supplier-purchase-form" onSubmit={handlePurchaseSubmit}>
          <label>
            Fornecedor *
            <select
              value={purchase.supplierId}
              onChange={(event) =>
                setPurchase((current) => ({
                  ...current,
                  supplierId: event.target.value,
                }))
              }
              required
              disabled={readOnly}
            >
              <option value="">Selecione um fornecedor</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.identifier || createSupplierIdentifier(supplier.id)} ·{" "}
                  {getSupplierDisplayName(supplier)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Data da compra *
            <input
              type="date"
              value={purchase.purchaseDate}
              onChange={(event) =>
                setPurchase((current) => ({
                  ...current,
                  purchaseDate: event.target.value,
                }))
              }
              required
              disabled={readOnly}
            />
          </label>
          <label className="supplier-purchase-wide">
            Descrição da mercadoria *
            <input
              value={purchase.description}
              onChange={(event) =>
                setPurchase((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              maxLength={240}
              required
              disabled={readOnly}
            />
          </label>
          <label>
            Valor total *
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={purchase.totalAmount}
              onChange={(event) =>
                setPurchase((current) => ({
                  ...current,
                  totalAmount: event.target.value,
                  ...(current.paymentType === "cash"
                    ? { downPayment: event.target.value }
                    : {}),
                }))
              }
              required
              disabled={readOnly}
            />
          </label>
          <label>
            Condição de pagamento *
            <select
              value={purchase.paymentType}
              onChange={(event) => {
                const paymentType = event.target.value;
                setPurchase((current) => ({
                  ...current,
                  paymentType,
                  downPayment:
                    paymentType === "cash" ? current.totalAmount : "0",
                }));
                if (paymentType === "cash") setInstallments([]);
              }}
              disabled={readOnly}
            >
              <option value="cash">À vista</option>
              <option value="credit">A prazo</option>
            </select>
          </label>
          <label>
            Forma do pagamento inicial
            <select
              value={purchase.paymentMethod}
              onChange={(event) =>
                setPurchase((current) => ({
                  ...current,
                  paymentMethod: event.target.value,
                }))
              }
              disabled={readOnly}
            >
              <option value="pix">Pix</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="transferencia">Transferência</option>
              <option value="boleto">Boleto</option>
              <option value="cartao">Cartão</option>
            </select>
          </label>

          {purchase.paymentType === "credit" && (
            <>
              <label>
                Valor já pago (opcional)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={purchase.downPayment}
                  onChange={(event) =>
                    setPurchase((current) => ({
                      ...current,
                      downPayment: event.target.value,
                    }))
                  }
                  disabled={readOnly}
                />
              </label>
              <div className="supplier-installment-editor supplier-purchase-wide">
                <div className="supplier-section-heading">
                  <div>
                    <h3>Parcelas e vencimentos</h3>
                    <p>
                      Valores das parcelas devem fechar o saldo restante da compra.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="suppliers-secondary-button"
                    disabled={readOnly}
                    onClick={() =>
                      setInstallments((current) => [
                        ...current,
                        {
                          id: crypto.randomUUID(),
                          amount: "",
                          dueDate: "",
                        },
                      ])
                    }
                  >
                    + Adicionar parcela
                  </button>
                </div>
                {installments.length === 0 ? (
                  <p className="suppliers-empty">
                    Adicione uma ou mais parcelas para registrar vencimentos.
                  </p>
                ) : (
                  <div className="supplier-installment-editor-list">
                    {installments.map((installment, index) => (
                      <div className="supplier-installment-editor-row" key={installment.id}>
                        <label>
                          Parcela {index + 1} · valor
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={installment.amount}
                            onChange={(event) =>
                              updateInstallment(index, "amount", event.target.value)
                            }
                            required
                            disabled={readOnly}
                          />
                        </label>
                        <label>
                          Vencimento *
                          <input
                            type="date"
                            value={installment.dueDate}
                            onChange={(event) =>
                              updateInstallment(index, "dueDate", event.target.value)
                            }
                            required
                            disabled={readOnly}
                          />
                        </label>
                        <button
                          type="button"
                          className="suppliers-secondary-button"
                          disabled={readOnly}
                          onClick={() =>
                            setInstallments((current) =>
                              current.filter((item) => item.id !== installment.id)
                            )
                          }
                        >
                          Remover
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          <button
            className="suppliers-primary-button supplier-purchase-wide"
            type="submit"
            disabled={savingPurchase || readOnly || suppliers.length === 0}
          >
            {savingPurchase ? "Registrando..." : "Registrar compra"}
          </button>
          {suppliers.length === 0 && (
            <small className="supplier-purchase-wide">
              Cadastre um fornecedor antes de registrar uma compra.
            </small>
          )}
        </form>
      </section>

      <section className="suppliers-card suppliers-payment-section">
        <div className="suppliers-section-heading">
          <div>
            <p className="suppliers-eyebrow">Baixa financeira</p>
            <h2>Registrar pagamento a fornecedor</h2>
            <p>
              Pagamentos parciais ou totais atualizam o saldo, as parcelas e o
              fluxo de caixa do Financeiro.
            </p>
          </div>
        </div>
        <form className="supplier-payment-form" onSubmit={handlePaymentSubmit}>
          <label>
            Compra em aberto *
            <select
              value={payment.payableId}
              onChange={(event) =>
                setPayment((current) => ({
                  ...current,
                  payableId: event.target.value,
                }))
              }
              required
              disabled={readOnly}
            >
              <option value="">Selecione uma compra</option>
              {payables
                .filter((item) => getPayableBalance(item) > 0)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.supplierName} · {item.description} · saldo{" "}
                    {formatCurrency(getPayableBalance(item))}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Valor pago *
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={payment.amount}
              onChange={(event) =>
                setPayment((current) => ({ ...current, amount: event.target.value }))
              }
              required
              disabled={readOnly}
            />
          </label>
          <label>
            Data do pagamento *
            <input
              type="date"
              value={payment.date}
              onChange={(event) =>
                setPayment((current) => ({ ...current, date: event.target.value }))
              }
              required
              disabled={readOnly}
            />
          </label>
          <label>
            Forma de pagamento
            <select
              value={payment.method}
              onChange={(event) =>
                setPayment((current) => ({ ...current, method: event.target.value }))
              }
              disabled={readOnly}
            >
              <option value="pix">Pix</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="transferencia">Transferência</option>
              <option value="boleto">Boleto</option>
              <option value="cartao">Cartão</option>
            </select>
          </label>
          <label>
            Identificação / comprovante
            <input
              value={payment.identification}
              onChange={(event) =>
                setPayment((current) => ({
                  ...current,
                  identification: event.target.value,
                }))
              }
              maxLength={80}
              disabled={readOnly}
            />
          </label>
          <button
            className="suppliers-primary-button"
            type="submit"
            disabled={savingPayment || readOnly}
          >
            {savingPayment ? "Registrando..." : "Registrar pagamento"}
          </button>
        </form>
      </section>
    </main>
  );
}
