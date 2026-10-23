import { useEffect, useMemo, useRef, useState } from "react";
import { LuTruck } from "react-icons/lu";
import PageHeader from "../components/PageHeader.jsx";
import FinancialValue from "../components/FinancialValue.jsx";
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
import {
  applyPaymentToPayable,
  CHECK_STATUSES,
  getCheckStatus,
  getPayableBalance,
  summarizePayables,
} from "../domain/payables";
import { isFirestoreReadOnly } from "../firebase/writePolicy";
import {
  buildSupplierPayable,
  createSupplierIdentifier,
  formatSupplierDocument,
  formatSupplierPhone,
  getSupplierDisplayName,
} from "../domain/suppliers";
import { toDate } from "../utils/dates";
import {
  compensateSupplierCheck,
  correctSupplierPayment,
  correctSupplierCheck,
  editSupplierPurchase,
  issueSupplierCheck,
} from "../services/supplierPayables.js";
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
  initialCheckIdentification: "",
  initialCheckBankAccount: "bb-pf",
  initialCheckIssueDate: todayInput(),
  initialCheckExpectedDate: todayInput(),
};
const emptyPayment = {
  payableId: "",
  amount: "",
  date: todayInput(),
  method: "pix",
  identification: "",
  bankAccount: "bb-pf",
  bankName: "Banco do Brasil",
  issueDate: todayInput(),
  expectedCompensationDate: todayInput(),
};

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [payables, setPayables] = useState([]);
  const [paymentsByPayable, setPaymentsByPayable] = useState({});
  const [correctionsByPayable, setCorrectionsByPayable] = useState({});
  const [form, setForm] = useState(emptyForm);
  const [purchase, setPurchase] = useState(emptyPurchase);
  const [installments, setInstallments] = useState([]);
  const [payment, setPayment] = useState(emptyPayment);
  const [editingId, setEditingId] = useState(null);
  const [editingPurchase, setEditingPurchase] = useState(null);
  const [editingPayment, setEditingPayment] = useState(null);
  const [editingCheck, setEditingCheck] = useState(null);
  const [expandedSupplierId, setExpandedSupplierId] = useState(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPurchase, setSavingPurchase] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [compensatingCheckId, setCompensatingCheckId] = useState(null);
  const savingLock = useRef(false);
  const purchaseLock = useRef(false);
  const paymentLock = useRef(false);
  const paymentOperation = useRef(null);
  const compensatingCheckLock = useRef(new Set());

  useEffect(() => {
    let unsubscribeSuppliers = null;
    let unsubscribePayables = null;
    let generation = 0;
    const paymentListeners = new Map();
    const correctionListeners = new Map();
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      generation += 1;
      const currentGeneration = generation;
      unsubscribeSuppliers?.();
      unsubscribePayables?.();
      for (const unsubscribe of paymentListeners.values()) unsubscribe();
      paymentListeners.clear();
      for (const unsubscribe of correctionListeners.values()) unsubscribe();
      correctionListeners.clear();
      setSuppliers([]);
      setPayables([]);
      setPaymentsByPayable({});
      setCorrectionsByPayable({});
      setForm(emptyForm);
      setPurchase({ ...emptyPurchase, purchaseDate: todayInput() });
      setInstallments([]);
      setPayment({ ...emptyPayment, date: todayInput() });
      setEditingId(null);
      setEditingPurchase(null);
      setEditingPayment(null);
      setEditingCheck(null);
      compensatingCheckLock.current.clear();
      setCompensatingCheckId(null);
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
          for (const [payableId, unsubscribe] of correctionListeners) {
            if (payableIds.has(payableId)) continue;
            unsubscribe();
            correctionListeners.delete(payableId);
            setCorrectionsByPayable((current) => {
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
            if (!correctionListeners.has(payableDocument.id)) {
              correctionListeners.set(
                payableDocument.id,
                onSnapshot(
                  collection(
                    db,
                    "users",
                    user.uid,
                    "payables",
                    payableDocument.id,
                    "corrections"
                  ),
                  (correctionSnapshot) => {
                    if (currentGeneration !== generation) return;
                    setCorrectionsByPayable((current) => ({
                      ...current,
                      [payableDocument.id]: correctionSnapshot.docs
                        .map((item) => ({ id: item.id, ...item.data() }))
                        .sort((first, second) =>
                          (toDate(second.createdAt)?.getTime() || 0) -
                          (toDate(first.createdAt)?.getTime() || 0)
                        ),
                    }));
                  },
                  (loadError) => {
                    if (currentGeneration !== generation) return;
                    console.error("Erro ao carregar correções de fornecedor:", loadError);
                    setError("Não foi possível carregar o histórico de correções.");
                  }
                )
              );
            }
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
      for (const unsubscribe of correctionListeners.values()) unsubscribe();
      correctionListeners.clear();
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
    const initialCheque = purchase.paymentMethod === "cheque" &&
      Number(String(purchase.downPayment || 0).replace(",", ".")) > 0;
    const paidAmount = initialCheque
      ? 0
      : purchase.paymentType === "cash"
        ? purchase.totalAmount
        : purchase.downPayment;
    const purchaseInstallments = purchase.paymentType === "cash"
      ? []
      : [
          ...(initialCheque ? [{
            id: crypto.randomUUID(),
            amount: purchase.downPayment,
            dueDate: purchase.initialCheckExpectedDate,
            method: "cheque",
            identification: purchase.initialCheckIdentification,
            bankAccount: purchase.initialCheckBankAccount,
            bankName: "Banco do Brasil",
            issueDate: purchase.initialCheckIssueDate,
          }] : []),
          ...installments,
        ];
    let payableData;
    try {
      payableData = buildSupplierPayable({
        supplier,
        description: purchase.description,
        purchaseDate: purchase.purchaseDate,
        totalAmount: purchase.totalAmount,
        downPayment: paidAmount,
        installments: purchaseInstallments,
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
      payment.bankAccount,
      payment.issueDate,
      payment.expectedCompensationDate,
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
      if (payment.method === "cheque") {
        const result = await issueSupplierCheck({
          db,
          userId: user.uid,
          payableId: payable.id,
          operationId: paymentOperation.current.reference.id,
          amount,
          identification: payment.identification,
          bankAccount: payment.bankAccount,
          bankName: payment.bankName,
          issueDate: payment.issueDate,
          expectedCompensationDate: payment.expectedCompensationDate,
        });
        paymentOperation.current = null;
        setPayment({ ...emptyPayment, date: todayInput() });
        setNotice(
          result.alreadyRecorded
            ? "Este cheque já estava registrado; não foi criada uma nova saída de caixa."
            : "Cheque registrado como emitido. A obrigação e o fluxo de caixa só serão baixados na compensação."
        );
        return;
      }
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

  async function handleCheckCompensation(payableId, installment) {
    if (compensatingCheckLock.current.has(installment.id)) return;
    const user = auth.currentUser;
    if (!user) {
      setError("Entre novamente no RC Manager para continuar.");
      return;
    }
    if (!window.confirm(
      `Confirmar a compensação do cheque nº ${installment.identification || "sem número"}? A saída será lançada uma única vez no fluxo de caixa.`
    )) return;
    compensatingCheckLock.current.add(installment.id);
    setCompensatingCheckId(installment.id);
    try {
      setError("");
      setNotice("");
      const alreadyRecorded = await compensateSupplierCheck({
        db,
        userId: user.uid,
        payableId,
        installmentId: installment.id,
      });
      setNotice(
        alreadyRecorded
          ? "A compensação já estava registrada; o fluxo de caixa não foi duplicado."
          : "Cheque compensado e saída registrada uma única vez no Financeiro."
      );
    } catch (compensationError) {
      console.error("Erro ao compensar cheque do fornecedor:", compensationError);
      setError(`Não foi possível compensar o cheque: ${compensationError.message}`);
    } finally {
      compensatingCheckLock.current.delete(installment.id);
      setCompensatingCheckId(null);
    }
  }

  function beginPurchaseEdit(payable) {
    const firstOpenInstallment = (payable.installments || []).find(
      (item) => item.method !== "cheque" &&
        Number(item.amount || 0) > Number(item.paidAmount || 0)
    );
    const dateValue = (value) => {
      const parsed = toDate(value);
      if (!parsed) return "";
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    };
    setEditingPurchase({
      payableId: payable.id,
      description: payable.description || "",
      totalAmount: String(payable.totalAmount ?? ""),
      purchaseDate: dateValue(payable.purchaseDate),
      dueDate: dateValue(firstOpenInstallment?.dueDate || payable.dueDate),
      paymentType: payable.paymentType ||
        (Number(payable.paidAmount || 0) >= Number(payable.totalAmount || 0) ? "cash" : "credit"),
    });
  }

  async function savePurchaseEdit(event) {
    event.preventDefault();
    const user = auth.currentUser;
    if (!user || !editingPurchase) return;
    try {
      setSavingPurchase(true);
      setError("");
      const { payableId, ...changes } = editingPurchase;
      await editSupplierPurchase({ db, userId: user.uid, payableId, changes });
      setEditingPurchase(null);
      setNotice("Compra corrigida. Saldo e parcelas foram recalculados; a versão anterior foi preservada no histórico de correções.");
    } catch (editError) {
      console.error("Erro ao corrigir compra do fornecedor:", editError);
      setError(`Não foi possível corrigir a compra: ${editError.message}`);
    } finally {
      setSavingPurchase(false);
    }
  }

  function beginCheckEdit(payableId, check) {
    const inputDate = (value) => {
      const parsed = toDate(value);
      if (!parsed) return todayInput();
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    };
    setEditingCheck({
      payableId,
      installmentId: check.id,
      amount: String(check.amount ?? ""),
      identification: check.identification || "",
      bankAccount: check.bankAccount || "bb-pf",
      bankName: check.bankName || "Banco do Brasil",
      issueDate: inputDate(check.issueDate),
      expectedCompensationDate: inputDate(check.dueDate),
    });
  }

  async function saveCheckCorrection(event) {
    event.preventDefault();
    const user = auth.currentUser;
    if (!user || !editingCheck) return;
    try {
      setSavingPayment(true);
      setError("");
      const { payableId, installmentId, ...values } = editingCheck;
      await correctSupplierCheck({
        db,
        userId: user.uid,
        payableId,
        installmentId,
        changes: {
          ...values,
          amount: Number(String(values.amount).replace(",", ".")),
          issueDate: new Date(`${values.issueDate}T12:00:00`),
          expectedCompensationDate: new Date(`${values.expectedCompensationDate}T12:00:00`),
        },
      });
      setEditingCheck(null);
      setNotice("Cheque corrigido sem alterar o total devido nem registrar saída de caixa. Os dados anteriores foram preservados no histórico de correções.");
    } catch (checkError) {
      console.error("Erro ao corrigir cheque:", checkError);
      setError(`Não foi possível corrigir o cheque: ${checkError.message}`);
    } finally {
      setSavingPayment(false);
    }
  }

  function beginPaymentEdit(payableId, entry) {
    const inputDate = (value) => {
      const parsed = toDate(value);
      if (!parsed) return todayInput();
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    };
    setEditingPayment({
      payableId,
      paymentId: entry.id,
      amount: String(entry.amount ?? ""),
      date: inputDate(entry.date),
      method: entry.method || "pix",
      identification: entry.identification || "",
      bankAccount: entry.bankAccount || "bb-pf",
      bankName: entry.bankName || "Banco do Brasil",
      issueDate: inputDate(entry.issueDate),
      expectedCompensationDate: inputDate(entry.expectedCompensationDate),
    });
  }

  async function savePaymentCorrection(event) {
    event.preventDefault();
    const user = auth.currentUser;
    if (!user || !editingPayment) return;
    try {
      setSavingPayment(true);
      setError("");
      const { payableId, paymentId, ...values } = editingPayment;
      const date = new Date(`${values.date}T12:00:00`);
      const issueDate = values.method === "cheque"
        ? new Date(`${values.issueDate}T12:00:00`)
        : null;
      const expectedCompensationDate = values.method === "cheque"
        ? new Date(`${values.expectedCompensationDate}T12:00:00`)
        : null;
      await correctSupplierPayment({
        db,
        userId: user.uid,
        payableId,
        paymentId,
        changes: {
          ...values,
          amount: Number(String(values.amount).replace(",", ".")),
          date,
          issueDate,
          expectedCompensationDate,
        },
      });
      setEditingPayment(null);
      setNotice("Pagamento corrigido sem criar novo lançamento. Valores, saldo e parcelas foram recalculados e a versão anterior ficou no histórico de correções.");
    } catch (correctionError) {
      console.error("Erro ao corrigir pagamento do fornecedor:", correctionError);
      setError(`Não foi possível corrigir o pagamento: ${correctionError.message}`);
    } finally {
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
        <article><span>Total devido a fornecedores</span><strong><FinancialValue>{formatCurrency(payableSummary.totalToPay)}</FinancialValue></strong></article>
        <article><span>Contas vencidas</span><strong>{payableSummary.overdueCount} · <FinancialValue>{formatCurrency(payableSummary.overdueTotal)}</FinancialValue></strong></article>
        <article><span>Contas a vencer (30 dias)</span><strong>{upcomingAccountCount} · <FinancialValue>{formatCurrency(payableSummary.upcomingTotal)}</FinancialValue></strong></article>
        <article><span>Contas quitadas</span><strong>{paidPayableCount}</strong></article>
        <article><span>Total já pago</span><strong><FinancialValue>{formatCurrency(payableSummary.totalPaid)}</FinancialValue></strong></article>
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
                      <FinancialValue>
                        {formatCurrency(
                          payables
                            .filter((item) => item.supplierId === supplier.id)
                            .reduce((sum, item) => sum + getPayableBalance(item), 0)
                        )}{" "}
                        em aberto
                      </FinancialValue>
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
                                      ? <><FinancialValue>{formatCurrency(getPayableBalance(item))}</FinancialValue> em aberto</>
                                      : "Quitada"}
                                  </b>
                                </div>
                                <div className="supplier-purchase-meta">
                                  <span>Total: <FinancialValue>{formatCurrency(item.totalAmount)}</FinancialValue></span>
                                  <span>Pago: <FinancialValue>{formatCurrency(item.paidAmount)}</FinancialValue></span>
                                  <span>Parcelas: {(item.installments || []).length}</span>
                                </div>
                                <div className="supplier-purchase-actions">
                                  <button type="button" onClick={() => beginPurchaseEdit(item)} disabled={readOnly}>
                                    Editar compra
                                  </button>
                                </div>
                                {editingPurchase?.payableId === item.id && (
                                  <form className="supplier-correction-form" onSubmit={savePurchaseEdit}>
                                    <h5>Corrigir compra</h5>
                                    <label>
                                      Descrição
                                      <input value={editingPurchase.description} required maxLength={240}
                                        onChange={(event) => setEditingPurchase((current) => ({ ...current, description: event.target.value }))} />
                                    </label>
                                    <label>
                                      Valor total
                                      <input type="number" min="0.01" step="0.01" value={editingPurchase.totalAmount} required
                                        onChange={(event) => setEditingPurchase((current) => ({ ...current, totalAmount: event.target.value }))} />
                                    </label>
                                    <label>
                                      Data da compra
                                      <input type="date" value={editingPurchase.purchaseDate} required
                                        onChange={(event) => setEditingPurchase((current) => ({ ...current, purchaseDate: event.target.value }))} />
                                    </label>
                                    <label>
                                      Vencimento das parcelas comuns
                                      <input type="date" value={editingPurchase.dueDate}
                                        onChange={(event) => setEditingPurchase((current) => ({ ...current, dueDate: event.target.value }))} />
                                    </label>
                                    <label>
                                      Condição de pagamento
                                      <select value={editingPurchase.paymentType}
                                        onChange={(event) => setEditingPurchase((current) => ({ ...current, paymentType: event.target.value }))}>
                                        <option value="cash">À vista</option>
                                        <option value="credit">A prazo</option>
                                      </select>
                                    </label>
                                    <div className="supplier-correction-actions">
                                      <button type="submit" disabled={savingPurchase || readOnly}>
                                        {savingPurchase ? "Salvando..." : "Salvar correção"}
                                      </button>
                                      <button type="button" onClick={() => setEditingPurchase(null)}>Cancelar</button>
                                    </div>
                                    <small>O total não pode ficar abaixo do que já foi pago. Cheques emitidos não são alterados junto com o vencimento comum.</small>
                                  </form>
                                )}
                                {(item.installments || []).map((installment, index) => (
                                  <div className="supplier-installment" key={installment.id || index}>
                                    <span>
                                      {installment.method === "cheque" ? `Cheque nº ${installment.identification || "sem número"}` : `Parcela ${index + 1}`}
                                      {" · vence/compensa "}{formatDate(installment.dueDate)}
                                      {installment.method === "cheque" && (
                                        <>
                                          <br />{installment.bankName || "Banco do Brasil"} · {installment.bankAccount === "bb-pj" ? "PJ" : "PF"}
                                          {" · emitido "}{formatDate(installment.issueDate)}
                                          {" · "}{getCheckStatus(installment) === CHECK_STATUSES.COMPENSATED ? "Compensado" :
                                            getCheckStatus(installment) === CHECK_STATUSES.RETURNED ? "Devolvido" :
                                              getCheckStatus(installment) === CHECK_STATUSES.CANCELLED ? "Cancelado" : "Entregue / emitido"}
                                        </>
                                      )}
                                    </span>
                                    <span>
                                      <FinancialValue>{formatCurrency(installment.paidAmount || 0)}</FinancialValue> de{" "}
                                      <FinancialValue>{formatCurrency(installment.amount)}</FinancialValue>
                                    </span>
                                    <strong>
                                      Saldo <FinancialValue>{formatCurrency(Math.max(Number(installment.amount || 0) - Number(installment.paidAmount || 0), 0))}</FinancialValue>
                                    </strong>
                                    {installment.method === "cheque" &&
                                    getCheckStatus(installment) === CHECK_STATUSES.ISSUED && (
                                      <>
                                        <button type="button" onClick={() => handleCheckCompensation(item.id, installment)} disabled={readOnly || compensatingCheckId === installment.id}>
                                          {compensatingCheckId === installment.id ? "Compensando..." : "Confirmar compensação"}
                                        </button>
                                        <button type="button" onClick={() => beginCheckEdit(item.id, installment)} disabled={readOnly}>
                                          Corrigir cheque
                                        </button>
                                      </>
                                    )}
                                  </div>
                                ))}
                                {editingCheck?.payableId === item.id && (
                                  <form className="supplier-correction-form" onSubmit={saveCheckCorrection}>
                                    <h5>Corrigir cheque entregue</h5>
                                    <label>
                                      Valor
                                      <input type="number" min="0.01" step="0.01" required value={editingCheck.amount}
                                        onChange={(event) => setEditingCheck((current) => ({ ...current, amount: event.target.value }))} />
                                    </label>
                                    <label>
                                      Banco / conta
                                      <select required value={editingCheck.bankAccount}
                                        onChange={(event) => setEditingCheck((current) => ({ ...current, bankAccount: event.target.value }))}>
                                        <option value="bb-pf">Banco do Brasil · PF</option>
                                        <option value="bb-pj">Banco do Brasil · PJ</option>
                                      </select>
                                    </label>
                                    <label>
                                      Número do cheque
                                      <input required maxLength={40} value={editingCheck.identification}
                                        onChange={(event) => setEditingCheck((current) => ({ ...current, identification: event.target.value }))} />
                                    </label>
                                    <label>
                                      Emissão
                                      <input type="date" required value={editingCheck.issueDate}
                                        onChange={(event) => setEditingCheck((current) => ({ ...current, issueDate: event.target.value }))} />
                                    </label>
                                    <label>
                                      Previsão de compensação
                                      <input type="date" required value={editingCheck.expectedCompensationDate}
                                        onChange={(event) => setEditingCheck((current) => ({ ...current, expectedCompensationDate: event.target.value }))} />
                                    </label>
                                    <div className="supplier-correction-actions">
                                      <button type="submit" disabled={savingPayment || readOnly}>
                                        {savingPayment ? "Salvando..." : "Salvar correção"}
                                      </button>
                                      <button type="button" onClick={() => setEditingCheck(null)}>Cancelar</button>
                                    </div>
                                  </form>
                                )}
                                {(paymentsByPayable[item.id] || []).length > 0 && (
                                  <details className="supplier-payment-history">
                                    <summary>Histórico de pagamentos ({paymentsByPayable[item.id].length})</summary>
                                    {paymentsByPayable[item.id].map((entry) => (
                                      <div className="supplier-payment-history-entry" key={entry.id}>
                                        <p>
                                          {formatDate(entry.date)} · <FinancialValue>{formatCurrency(entry.amount)}</FinancialValue> ·{" "}
                                          {entry.method || entry.type || "Pagamento"}
                                          {entry.identification ? ` · ${entry.identification}` : ""}
                                          {entry.type === "check-compensation" ? " · cheque compensado" : ""}
                                        </p>
                                        <button type="button" onClick={() => beginPaymentEdit(item.id, entry)} disabled={readOnly}>
                                          Corrigir pagamento
                                        </button>
                                        {editingPayment?.payableId === item.id && editingPayment.paymentId === entry.id && (
                                          <form className="supplier-correction-form" onSubmit={savePaymentCorrection}>
                                            <h5>Corrigir pagamento</h5>
                                            <label>
                                              Valor
                                              <input type="number" min="0.01" step="0.01" value={editingPayment.amount} required
                                                onChange={(event) => setEditingPayment((current) => ({ ...current, amount: event.target.value }))} />
                                            </label>
                                            <label>
                                              Data
                                              <input type="date" value={editingPayment.date} required
                                                onChange={(event) => setEditingPayment((current) => ({ ...current, date: event.target.value }))} />
                                            </label>
                                            <label>
                                              Forma de pagamento
                                              <select value={editingPayment.method}
                                                disabled={entry.type === "check-compensation"}
                                                onChange={(event) => setEditingPayment((current) => ({ ...current, method: event.target.value }))}>
                                                <option value="pix">Pix</option>
                                                <option value="dinheiro">Dinheiro</option>
                                                <option value="transferencia">Transferência</option>
                                                <option value="boleto">Boleto</option>
                                                <option value="cartao">Cartão</option>
                                                <option value="cheque">Cheque</option>
                                              </select>
                                            </label>
                                            {editingPayment.method === "cheque" && (
                                              <>
                                                <label>
                                                  Banco / conta
                                                  <select value={editingPayment.bankAccount}
                                                    onChange={(event) => setEditingPayment((current) => ({ ...current, bankAccount: event.target.value, bankName: "Banco do Brasil" }))}>
                                                    <option value="bb-pf">Banco do Brasil · PF</option>
                                                    <option value="bb-pj">Banco do Brasil · PJ</option>
                                                  </select>
                                                </label>
                                                <label>
                                                  Número do cheque
                                                  <input value={editingPayment.identification} required maxLength={40}
                                                    onChange={(event) => setEditingPayment((current) => ({ ...current, identification: event.target.value }))} />
                                                </label>
                                                <label>
                                                  Emissão
                                                  <input type="date" value={editingPayment.issueDate} required
                                                    onChange={(event) => setEditingPayment((current) => ({ ...current, issueDate: event.target.value }))} />
                                                </label>
                                                <label>
                                                  Previsão de compensação
                                                  <input type="date" value={editingPayment.expectedCompensationDate} required
                                                    onChange={(event) => setEditingPayment((current) => ({ ...current, expectedCompensationDate: event.target.value }))} />
                                                </label>
                                              </>
                                            )}
                                            {editingPayment.method !== "cheque" && (
                                              <label>
                                                Identificação / comprovante
                                                <input value={editingPayment.identification}
                                                  onChange={(event) => setEditingPayment((current) => ({ ...current, identification: event.target.value }))} />
                                              </label>
                                            )}
                                            <div className="supplier-correction-actions">
                                              <button type="submit" disabled={savingPayment || readOnly}>
                                                {savingPayment ? "Salvando..." : "Salvar correção"}
                                              </button>
                                              <button type="button" onClick={() => setEditingPayment(null)}>Cancelar</button>
                                            </div>
                                          </form>
                                        )}
                                      </div>
                                    ))}
                                  </details>
                                )}
                                {(correctionsByPayable[item.id] || []).length > 0 && (
                                  <details className="supplier-correction-history">
                                    <summary>Histórico de correções ({correctionsByPayable[item.id].length})</summary>
                                    {correctionsByPayable[item.id].map((correction) => (
                                      <p key={correction.id}>
                                        {formatDate(correction.createdAt)} ·{" "}
                                        {correction.type === "purchase"
                                          ? `Compra: ${formatCurrency(correction.before?.totalAmount)} → ${formatCurrency(correction.after?.totalAmount)} · ${correction.before?.description || "sem descrição"} → ${correction.after?.description || "sem descrição"}`
                                          : correction.type === "check"
                                            ? `Cheque: ${correction.before?.identification || "sem número"} · ${formatCurrency(correction.before?.amount)} → ${correction.after?.installments?.find((check) => check.id === correction.installmentId)?.identification || "sem número"} · ${formatCurrency(correction.after?.installments?.find((check) => check.id === correction.installmentId)?.amount)}`
                                          : `Pagamento: ${formatCurrency(correction.before?.amount)} → ${formatCurrency(correction.after?.amount)} · ${correction.before?.method || "forma não informada"} → ${correction.after?.method || "forma não informada"}`}
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
                  paymentType: paymentType === "cash" && current.paymentMethod === "cheque"
                    ? "credit"
                    : paymentType,
                  paymentMethod: paymentType === "cash" && current.paymentMethod === "cheque"
                    ? "pix"
                    : current.paymentMethod,
                  downPayment: paymentType === "cash" ? current.totalAmount : "0",
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
                setPurchase((current) => {
                  const paymentMethod = event.target.value;
                  return {
                    ...current,
                    paymentMethod,
                    ...(paymentMethod === "cheque" && current.paymentType === "cash"
                      ? { paymentType: "credit", downPayment: current.totalAmount }
                      : {}),
                  };
                })
              }
              disabled={readOnly}
            >
              <option value="pix">Pix</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="transferencia">Transferência</option>
              <option value="boleto">Boleto</option>
              <option value="cartao">Cartão</option>
              <option value="cheque">Cheque</option>
            </select>
          </label>
          {purchase.paymentMethod === "cheque" && (
            <p className="supplier-purchase-wide supplier-check-note">
              Cheque entregue não é considerado pago nem gera saída de caixa antes da compensação.
            </p>
          )}

          {purchase.paymentType === "credit" && (
            <>
              <label>
                {purchase.paymentMethod === "cheque" ? "Valor do cheque de entrada" : "Valor já pago (opcional)"}
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
              {purchase.paymentMethod === "cheque" && Number(purchase.downPayment) > 0 && (
                <>
                  <label>
                    Banco / conta do cheque *
                    <select value={purchase.initialCheckBankAccount}
                      onChange={(event) => setPurchase((current) => ({ ...current, initialCheckBankAccount: event.target.value }))}
                      required disabled={readOnly}>
                      <option value="bb-pf">Banco do Brasil · PF</option>
                      <option value="bb-pj">Banco do Brasil · PJ</option>
                    </select>
                  </label>
                  <label>
                    Número do cheque *
                    <input value={purchase.initialCheckIdentification}
                      onChange={(event) => setPurchase((current) => ({ ...current, initialCheckIdentification: event.target.value }))}
                      required maxLength={40} disabled={readOnly} />
                  </label>
                  <label>
                    Emissão *
                    <input type="date" value={purchase.initialCheckIssueDate}
                      onChange={(event) => setPurchase((current) => ({ ...current, initialCheckIssueDate: event.target.value }))}
                      required disabled={readOnly} />
                  </label>
                  <label>
                    Previsão de compensação *
                    <input type="date" value={purchase.initialCheckExpectedDate}
                      onChange={(event) => setPurchase((current) => ({ ...current, initialCheckExpectedDate: event.target.value }))}
                      required disabled={readOnly} />
                  </label>
                </>
              )}
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
                          method: "boleto",
                          identification: "",
                          bankAccount: "bb-pf",
                          bankName: "Banco do Brasil",
                          issueDate: todayInput(),
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
                        <label>
                          Forma de pagamento
                          <select value={installment.method || "boleto"}
                            onChange={(event) => updateInstallment(index, "method", event.target.value)}
                            required disabled={readOnly}>
                            <option value="boleto">Boleto / parcela</option>
                            <option value="cheque">Cheque</option>
                          </select>
                        </label>
                        {installment.method === "cheque" && (
                          <>
                            <label>
                              Banco / conta *
                              <select value={installment.bankAccount || "bb-pf"}
                                onChange={(event) => {
                                  updateInstallment(index, "bankAccount", event.target.value);
                                  updateInstallment(index, "bankName", "Banco do Brasil");
                                }}
                                required disabled={readOnly}>
                                <option value="bb-pf">Banco do Brasil · PF</option>
                                <option value="bb-pj">Banco do Brasil · PJ</option>
                              </select>
                            </label>
                            <label>
                              Número do cheque *
                              <input value={installment.identification || ""}
                                onChange={(event) => updateInstallment(index, "identification", event.target.value)}
                                maxLength={40} required disabled={readOnly} />
                            </label>
                            <label>
                              Data de emissão *
                              <input type="date" value={installment.issueDate || ""}
                                onChange={(event) => updateInstallment(index, "issueDate", event.target.value)}
                                required disabled={readOnly} />
                            </label>
                            <small>O vencimento acima é a data prevista de compensação. O cheque permanece como obrigação até compensar.</small>
                          </>
                        )}
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
                    <FinancialValue>{formatCurrency(getPayableBalance(item))}</FinancialValue>
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
              <option value="cheque">Cheque</option>
            </select>
          </label>
          {payment.method === "cheque" && (
            <>
              <label>
                Banco / conta do cheque *
                <select
                  value={payment.bankAccount}
                  onChange={(event) => setPayment((current) => ({
                    ...current,
                    bankAccount: event.target.value,
                    bankName: "Banco do Brasil",
                  }))}
                  required disabled={readOnly}>
                  <option value="bb-pf">Banco do Brasil · PF</option>
                  <option value="bb-pj">Banco do Brasil · PJ</option>
                </select>
              </label>
              <label>
                Data de emissão *
                <input type="date" value={payment.issueDate}
                  onChange={(event) => setPayment((current) => ({ ...current, issueDate: event.target.value }))}
                  required disabled={readOnly} />
              </label>
              <label>
                Previsão de compensação *
                <input type="date" value={payment.expectedCompensationDate}
                  onChange={(event) => setPayment((current) => ({ ...current, expectedCompensationDate: event.target.value }))}
                  required disabled={readOnly} />
              </label>
              <small className="supplier-purchase-wide">
                A emissão registra o cheque sem baixar o saldo financeiro. A saída de caixa ocorre somente ao confirmar a compensação.
              </small>
            </>
          )}
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
