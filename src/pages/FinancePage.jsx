import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "../firebase/config";
import {
  addDoc,
  deleteDoc,
  runTransaction,
  updateDoc,
} from "../firebase/firestoreAccess";
import {
  adjustLegacyClientDebt,
  applyPaymentToSale,
  calculateConsolidatedReceivables,
  calculateTripFinancialSummary,
  escapeReceiptText,
  isSaleOverdue,
  organizeSalesByTrip2026,
  reusePaymentOperation,
  selectSalesForTrip,
} from "../domain/sales";
import {
  applyPaymentToPayable,
  applyCheckStatusTransition,
  CHECK_STATUSES,
  filterPayablesByTrip,
  getCheckStatus,
  getPayableBalance,
  reusePayablePaymentOperation,
  summarizeChecks,
  summarizePayables,
  validatePayableSchedule,
} from "../domain/payables";
import { toDate } from "../utils/dates";
import "./FinancePayables.css";

const todayInput = () => new Date().toISOString().slice(0, 10);
const emptyExpense = {
  category: "combustivel",
  description: "",
  value: "",
  date: todayInput(),
  tripNumber: "",
};

const emptyPayable = {
  supplierId: "",
  purchaseType: "inventory",
  description: "",
  purchaseDate: todayInput(),
  totalAmount: "",
  downPayment: "0",
  downPaymentDate: todayInput(),
  initialMethod: "pix",
  initialIdentification: "",
  tripNumber: "",
  notes: "",
};

const emptyPayablePayment = {
  payableId: "",
  installmentId: "",
  amount: "",
  date: todayInput(),
  method: "pix",
  identification: "",
};

const tripOptions = [
  { value: "1", label: "1ª viagem" },
  { value: "2", label: "2ª viagem" },
  { value: "3", label: "3ª viagem (julho a setembro de 2026)" },
  { value: "4", label: "4ª viagem (outubro a dezembro de 2026)" },
];

export default function FinancePage() {
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [payables, setPayables] = useState([]);
  const [paymentsByPayable, setPaymentsByPayable] = useState({});

  const [expenseForm, setExpenseForm] = useState(emptyExpense);
  const [payableForm, setPayableForm] = useState(emptyPayable);
  const [payableInstallments, setPayableInstallments] = useState([]);
  const [payablePaymentForm, setPayablePaymentForm] = useState(emptyPayablePayment);
  const [payableMessage, setPayableMessage] = useState("");
  const [checkMonthFilter, setCheckMonthFilter] = useState("all");
  const [checkSupplierFilter, setCheckSupplierFilter] = useState("all");
  const [checkAccountFilter, setCheckAccountFilter] = useState("all");
  const [checkStatusFilter, setCheckStatusFilter] = useState("all");
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [tripFilter, setTripFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [savingExpense, setSavingExpense] = useState(false);
  const [savingPayable, setSavingPayable] = useState(false);
  const [payingPayable, setPayingPayable] = useState(false);
  const [showPayablePaymentForm, setShowPayablePaymentForm] = useState(false);
  const [receivingSaleId, setReceivingSaleId] = useState(null);
  const receivingSaleLock = useRef(false);
  const pendingPaymentOperation = useRef(null);
  const payableCreateOperation = useRef(null);
  const payablePaymentOperation = useRef(null);
  const payableCreateLock = useRef(false);
  const payablePaymentLock = useRef(false);

  useEffect(() => {
    let unsubscribeClients = null;
    let unsubscribeProducts = null;
    let unsubscribeSales = null;
    let unsubscribeExpenses = null;
    let unsubscribeSuppliers = null;
    let unsubscribePayables = null;
    let authGeneration = 0;
    const payablePaymentListeners = new Map();

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      const generation = ++authGeneration;
      if (unsubscribeClients) unsubscribeClients();
      if (unsubscribeProducts) unsubscribeProducts();
      if (unsubscribeSales) unsubscribeSales();
      if (unsubscribeExpenses) unsubscribeExpenses();
      if (unsubscribeSuppliers) unsubscribeSuppliers();
      if (unsubscribePayables) unsubscribePayables();
      for (const unsubscribe of payablePaymentListeners.values()) unsubscribe();
      payablePaymentListeners.clear();
      setClients([]);
      setProducts([]);
      setSales([]);
      setExpenses([]);
      setSuppliers([]);
      setPayables([]);
      setPaymentsByPayable({});
      setLoading(Boolean(user));
      setPayableMessage("");
      setCheckMonthFilter("all");
      setCheckSupplierFilter("all");
      setCheckAccountFilter("all");
      setCheckStatusFilter("all");
      setExpenseForm({ ...emptyExpense, date: todayInput() });
      setPayableForm({ ...emptyPayable, purchaseDate: todayInput() });
      setPayableInstallments([]);
      setPayablePaymentForm({
        ...emptyPayablePayment,
        date: todayInput(),
      });
      setEditingExpenseId(null);
      payableCreateOperation.current = null;
      payablePaymentOperation.current = null;

      if (!user) {
        setLoading(false);
        return;
      }

      unsubscribeClients = onSnapshot(
        collection(db, "users", user.uid, "clients"),
        (snapshot) => {
          if (generation !== authGeneration) return;
          setClients(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...document.data(),
            }))
          );
        },
        (error) => {
          if (generation !== authGeneration) return;
          console.error("Erro ao carregar clientes:", error);
        }
      );

      unsubscribeProducts = onSnapshot(
        collection(db, "users", user.uid, "products"),
        (snapshot) => {
          if (generation !== authGeneration) return;
          setProducts(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...document.data(),
            }))
          );
        },
        (error) => {
          if (generation !== authGeneration) return;
          console.error("Erro ao carregar produtos:", error);
        }
      );

      unsubscribeSales = onSnapshot(
        collection(db, "users", user.uid, "sales"),
        (snapshot) => {
          if (generation !== authGeneration) return;
          const list = snapshot.docs.map((document) => ({
            id: document.id,
            ...document.data(),
          }));

          list.sort((first, second) => {
            const firstDate =
              toDate(first.saleDate)?.getTime() ||
              first.createdAt?.toMillis?.() ||
              0;
            const secondDate =
              toDate(second.saleDate)?.getTime() ||
              second.createdAt?.toMillis?.() ||
              0;
            return secondDate - firstDate;
          });

          setSales(list);
          setLoading(false);
        },
        (error) => {
          if (generation !== authGeneration) return;
          console.error("Erro ao carregar vendas:", error);
          setLoading(false);
        }
      );

      unsubscribeExpenses = onSnapshot(
        collection(db, "users", user.uid, "expenses"),
        (snapshot) => {
          if (generation !== authGeneration) return;
          const list = snapshot.docs.map((document) => ({
            id: document.id,
            ...document.data(),
          }));

          list.sort((first, second) => {
            const firstDate =
              first.expenseDate?.toMillis?.() ||
              first.createdAt?.toMillis?.() ||
              0;

            const secondDate =
              second.expenseDate?.toMillis?.() ||
              second.createdAt?.toMillis?.() ||
              0;

            return secondDate - firstDate;
          });

          setExpenses(list);
        },
        (error) => {
          if (generation !== authGeneration) return;
          console.error("Erro ao carregar despesas:", error);
        }
      );

      unsubscribeSuppliers = onSnapshot(
        collection(db, "users", user.uid, "suppliers"),
        (snapshot) => {
          if (generation !== authGeneration) return;
          setSuppliers(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...document.data(),
            }))
          );
        },
        (error) => {
          if (generation !== authGeneration) return;
          console.error("Erro ao carregar fornecedores:", error);
          setPayableMessage("Não foi possível carregar a lista de fornecedores.");
        }
      );

      unsubscribePayables = onSnapshot(
        collection(db, "users", user.uid, "payables"),
        (snapshot) => {
          if (generation !== authGeneration) return;
          const documents = snapshot.docs;
          const accountIds = new Set(documents.map((document) => document.id));
          for (const [payableId, unsubscribe] of payablePaymentListeners) {
            if (accountIds.has(payableId)) continue;
            unsubscribe();
            payablePaymentListeners.delete(payableId);
            setPaymentsByPayable((current) => {
              const next = { ...current };
              delete next[payableId];
              return next;
            });
          }
          for (const document of documents) {
            if (payablePaymentListeners.has(document.id)) continue;
            payablePaymentListeners.set(
              document.id,
              onSnapshot(
                collection(
                  db,
                  "users",
                  user.uid,
                  "payables",
                  document.id,
                  "payments"
                ),
                (paymentsSnapshot) => {
                  if (generation !== authGeneration) return;
                  setPaymentsByPayable((current) => ({
                    ...current,
                    [document.id]: paymentsSnapshot.docs.map((payment) => ({
                      id: payment.id,
                      ...payment.data(),
                    })),
                  }));
                },
                (error) => {
                  if (generation !== authGeneration) return;
                  console.error("Erro ao carregar histórico de pagamentos:", error);
                  setPayableMessage("Não foi possível carregar todo o histórico de pagamentos.");
                }
              )
            );
          }
          setPayables(
            documents.map((document) => ({
              id: document.id,
              ...document.data(),
            }))
          );
        },
        (error) => {
          if (generation !== authGeneration) return;
          console.error("Erro ao carregar contas a pagar:", error);
          setPayableMessage("Não foi possível carregar as contas a pagar.");
        }
      );
    });

    return () => {
      unsubscribeAuth();
      authGeneration += 1;

      if (unsubscribeClients) unsubscribeClients();
      if (unsubscribeProducts) unsubscribeProducts();
      if (unsubscribeSales) unsubscribeSales();
      if (unsubscribeExpenses) unsubscribeExpenses();
      if (unsubscribeSuppliers) unsubscribeSuppliers();
      if (unsubscribePayables) unsubscribePayables();
      for (const unsubscribe of payablePaymentListeners.values()) unsubscribe();
      payablePaymentListeners.clear();
    };
  }, []);

  const clientMap = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients]
  );

  const receivables = useMemo(
    () => calculateConsolidatedReceivables(clients, sales),
    [clients, sales]
  );

  const tripOrganization = useMemo(
    () => organizeSalesByTrip2026(sales),
    [sales]
  );

  const tripBySaleId = useMemo(
    () =>
      new Map(
        [
          ...tripOrganization.thirdTrip.sales,
          ...tripOrganization.fourthTrip.sales,
        ].map((sale) => [sale.id, sale.tripNumber])
      ),
    [tripOrganization]
  );

  const selectedTripSales = useMemo(
    () => selectSalesForTrip(
      tripOrganization,
      tripFilter === "third"
        ? "3"
        : tripFilter === "fourth"
          ? "4"
          : tripFilter
    ),
    [tripOrganization, tripFilter]
  );

  const selectedTripExpenses = useMemo(
    () =>
      expenses.filter((expense) => {
        if (tripFilter === "all") return true;
        if (tripFilter === "unassigned") return !expense.tripNumber;
        const selectedNumber =
          tripFilter === "third" ? "3" : tripFilter === "fourth" ? "4" : tripFilter;
        return String(expense.tripNumber || "") === selectedNumber;
      }),
    [expenses, tripFilter]
  );

  const selectedPayables = useMemo(
    () => filterPayablesByTrip(payables, tripFilter),
    [payables, tripFilter]
  );
  const payableSummary = useMemo(
    () => summarizePayables(selectedPayables),
    [selectedPayables]
  );
  const checkSummary = useMemo(
    () => summarizeChecks(selectedPayables),
    [selectedPayables]
  );
  const checkMonths = useMemo(
    () =>
      [...new Set(
        checkSummary.checks
          .filter((check) => check.dueDate)
          .map((check) => {
            const year = check.dueDate.getFullYear();
            const month = String(check.dueDate.getMonth() + 1).padStart(2, "0");
            return `${year}-${month}`;
          })
      )].sort(),
    [checkSummary.checks]
  );
  const filteredChecks = useMemo(
    () =>
      checkSummary.checks
        .filter((check) => {
          const month = check.dueDate
            ? `${check.dueDate.getFullYear()}-${String(check.dueDate.getMonth() + 1).padStart(2, "0")}`
            : "";
          return (
            (checkMonthFilter === "all" || checkMonthFilter === month) &&
            (checkSupplierFilter === "all" ||
              checkSupplierFilter === check.supplierId) &&
            (checkAccountFilter === "all" ||
              checkAccountFilter === check.bankAccount) &&
            (checkStatusFilter === "all" ||
              checkStatusFilter === check.status)
          );
        })
        .sort(
          (first, second) =>
            (first.dueDate?.getTime() || 0) - (second.dueDate?.getTime() || 0)
        ),
    [
      checkSummary.checks,
      checkMonthFilter,
      checkSupplierFilter,
      checkAccountFilter,
      checkStatusFilter,
    ]
  );
  const selectedPaymentPayable = payables.find(
    (payable) => payable.id === payablePaymentForm.payableId
  );

  const tripSummary = useMemo(
    () => calculateTripFinancialSummary(
      selectedTripSales,
      selectedTripExpenses,
      products,
      selectedPayables
    ),
    [selectedTripSales, selectedTripExpenses, products, selectedPayables]
  );

  const selectedReceivables = useMemo(() => {
    if (tripFilter === "all") return receivables;

    return calculateConsolidatedReceivables(
      clients.map((client) => ({ ...client, totalDebt: 0 })),
      selectedTripSales
    );
  }, [clients, receivables, selectedTripSales, tripFilter]);

  const debtors = useMemo(() => {
    const clientDebtors = selectedReceivables.clients
      .filter((client) => client.totalPending > 0)
      .map((balance) => {
        const client = clientMap.get(balance.clientId);

        return {
          ...balance,
          phone: client?.phone || "",
          city: client?.city || "",
        };
      });

    if (selectedReceivables.unassignedPending > 0) {
      clientDebtors.push({
        clientId: "unassigned",
        clientName: "Vendas sem cliente vinculado",
        phone: "",
        city: "",
        legacyBalance: 0,
        totalPending: selectedReceivables.unassignedPending,
        sales: selectedReceivables.unassignedSales,
      });
    }

    const search = searchText.trim().toLowerCase();

    return clientDebtors
      .filter((item) => {
        if (!search) return true;

        return (
          String(item.clientName).toLowerCase().includes(search) ||
          String(item.phone).toLowerCase().includes(search) ||
          String(item.city).toLowerCase().includes(search)
        );
      })
      .sort((first, second) => second.totalPending - first.totalPending);
  }, [selectedReceivables, clientMap, searchText]);

  const history = useMemo(() => {
    const entries = [];

    for (const sale of selectedTripSales) {
      entries.push({
        id: `sale-${sale.id}`,
        type: "sale",
        date: toDate(sale.saleDate) || toDate(sale.createdAt),
        title: sale.clientName || "Venda",
        description: [
          `Compra #${sale.id}`,
          `${(sale.items || []).length} item(ns)`,
          tripBySaleId.has(sale.id)
            ? `Classificação proposta: ${tripBySaleId.get(sale.id)}ª viagem`
            : "",
          sale.tripName,
          sale.tripCity,
        ]
          .filter(Boolean)
          .join(" • "),
        value: Number(sale.total || 0),
        received: Number(sale.amountPaid || 0),
      });
    }

    for (const expense of selectedTripExpenses) {
      entries.push({
        id: `expense-${expense.id}`,
        type: "expense",
        date:
          expense.expenseDate?.toDate?.() ||
          expense.createdAt?.toDate?.() ||
          null,
        title: formatExpenseCategory(expense.category),
        description: [
          expense.description || "Despesa",
          expense.tripNumber
            ? `${expense.tripNumber}ª viagem`
            : "Sem viagem",
        ].join(" • "),
        value: Number(expense.value || 0),
        expenseId: expense.id,
        expense,
      });
    }

    return entries.sort((first, second) => {
      const firstTime = first.date?.getTime?.() || 0;
      const secondTime = second.date?.getTime?.() || 0;
      return secondTime - firstTime;
    });
  }, [selectedTripSales, selectedTripExpenses, tripBySaleId]);

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

  function formatExpenseCategory(category) {
    const categories = {
      combustivel: "Combustível",
      hotel: "Hotel",
      alimentacao: "Alimentação",
      mercadoria: "Compra de mercadoria",
      manutencao: "Manutenção",
      transporte: "Transporte",
      outros: "Outros",
    };

    return categories[category] || "Outros";
  }

  function normalizePhone(phone) {
    let digits = String(phone || "").replace(/\D/g, "");

    if (!digits) return "";

    if (!digits.startsWith("55")) {
      digits = `55${digits}`;
    }

    return digits;
  }

  function handleExpenseChange(event) {
    const { name, value } = event.target;

    setExpenseForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function handleEditExpense(expense) {
    const expenseDate =
      toDate(expense.expenseDate) || toDate(expense.createdAt);
    const year = expenseDate?.getFullYear();
    const month = String((expenseDate?.getMonth() || 0) + 1).padStart(2, "0");
    const day = String(expenseDate?.getDate() || 1).padStart(2, "0");

    setExpenseForm({
      category: expense.category || "outros",
      description: expense.description || "",
      value: String(expense.value ?? ""),
      date: expenseDate ? `${year}-${month}-${day}` : "",
      tripNumber: expense.tripNumber ? String(expense.tripNumber) : "",
    });
    setEditingExpenseId(expense.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelExpenseEdit() {
    setEditingExpenseId(null);
    setExpenseForm({
      ...emptyExpense,
      date: new Date().toISOString().slice(0, 10),
    });
  }

  async function handleExpenseSubmit(event) {
    event.preventDefault();

    const user = auth.currentUser;

    if (!user) {
      alert("Você precisa entrar novamente no sistema.");
      return;
    }

    const value = Number(
      String(expenseForm.value)
        .replace(",", ".")
        .replace(/[^\d.-]/g, "")
    );

    if (!value || value <= 0) {
      alert("Digite um valor de despesa válido.");
      return;
    }

    if (!tripOptions.some((trip) => trip.value === expenseForm.tripNumber)) {
      alert("Selecione a viagem desta despesa.");
      return;
    }

    try {
      setSavingExpense(true);

      const selectedDate = new Date(
        `${expenseForm.date}T12:00:00`
      );
      if (Number.isNaN(selectedDate.getTime())) {
        alert("Informe uma data válida para a despesa.");
        return;
      }
      const expenseData = {
        category: expenseForm.category,
        description: expenseForm.description.trim(),
        value,
        expenseDate: selectedDate,
        tripNumber: Number(expenseForm.tripNumber),
        updatedAt: serverTimestamp(),
      };

      if (editingExpenseId) {
        const confirmed = window.confirm(
          "Salvar as alterações informadas para esta despesa?"
        );
        if (!confirmed) return;

        await updateDoc(
          doc(db, "users", user.uid, "expenses", editingExpenseId),
          expenseData
        );
        alert("Despesa atualizada com sucesso!");
      } else {
        await addDoc(
          collection(db, "users", user.uid, "expenses"),
          {
            ...expenseData,
            createdAt: serverTimestamp(),
          }
        );
        alert("Despesa registrada com sucesso!");
      }

      cancelExpenseEdit();
    } catch (error) {
      console.error("Erro ao salvar despesa:", error);
      alert(`Erro ao salvar despesa: ${error.message}`);
    } finally {
      setSavingExpense(false);
    }
  }

  async function handleDeleteExpense(expenseId) {
    const user = auth.currentUser;

    if (!user) {
      alert("Você precisa entrar novamente no sistema.");
      return;
    }

    const confirmed = window.confirm(
      "Deseja realmente excluir esta despesa? Esta ação não pode ser desfeita."
    );

    if (!confirmed) return;

    try {
      await deleteDoc(
        doc(
          db,
          "users",
          user.uid,
          "expenses",
          expenseId
        )
      );

      if (editingExpenseId === expenseId) cancelExpenseEdit();
      alert("Despesa excluída com sucesso!");
    } catch (error) {
      console.error("Erro ao excluir despesa:", error);
      alert(`Erro ao excluir despesa: ${error.message}`);
    }
  }

  function handlePayableFormChange(event) {
    const { name, value } = event.target;
    setPayableForm((current) => ({ ...current, [name]: value }));
  }

  function updatePayableInstallment(index, field, value) {
    setPayableInstallments((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      )
    );
  }

  function resetPayableForm() {
    setPayableForm({ ...emptyPayable, purchaseDate: todayInput() });
    setPayableInstallments([]);
    payableCreateOperation.current = null;
  }

  async function handlePayableSubmit(event) {
    event.preventDefault();
    if (payableCreateLock.current) return;
    const user = auth.currentUser;
    if (!user) {
      setPayableMessage("Entre novamente no RC Manager para continuar.");
      return;
    }
    const supplier = suppliers.find(
      (item) => item.id === payableForm.supplierId
    );
    if (!supplier) {
      setPayableMessage("Selecione um fornecedor cadastrado.");
      return;
    }

    const purchaseDate = new Date(`${payableForm.purchaseDate}T12:00:00`);
    const totalAmount = Number(String(payableForm.totalAmount).replace(",", "."));
    const downPayment = Number(String(payableForm.downPayment || 0).replace(",", "."));
    const normalizedInstallments = payableInstallments.map((item) => {
      const method = item.method || "boleto";
      return {
        id: item.id || doc(collection(db, "users", user.uid, "payables")).id,
        amount: Number(String(item.amount || 0).replace(",", ".")),
        paidAmount: 0,
        dueDate: item.dueDate ? new Date(`${item.dueDate}T12:00:00`) : null,
        method,
        identification: String(item.identification || "").trim(),
        ...(method === "cheque"
          ? {
              bankAccount: item.bankAccount,
              checkStatus: CHECK_STATUSES.ISSUED,
              checkStatusHistory: [
                { status: CHECK_STATUSES.ISSUED, changedAt: new Date() },
              ],
            }
          : {}),
        status: "pending",
      };
    });

    if (Number.isNaN(purchaseDate.getTime())) {
      setPayableMessage("Informe uma data de compra válida.");
      return;
    }
    if (payableForm.tripNumber &&
        !tripOptions.some((trip) => trip.value === payableForm.tripNumber)) {
      setPayableMessage("Selecione uma viagem válida ou deixe sem viagem.");
      return;
    }
    if (
      downPayment > 0 &&
      payableForm.initialMethod === "cheque" &&
      !payableForm.initialIdentification.trim()
    ) {
      setPayableMessage("Informe a identificação do cheque usado na entrada.");
      return;
    }
    const downPaymentDate = downPayment > 0
      ? new Date(`${payableForm.downPaymentDate}T12:00:00`)
      : null;
    if (downPayment > 0 && (!downPaymentDate || Number.isNaN(downPaymentDate.getTime()))) {
      setPayableMessage("Informe uma data válida para a entrada já paga.");
      return;
    }

    let amounts;
    try {
      amounts = validatePayableSchedule(
        totalAmount,
        downPayment,
        normalizedInstallments
      );
    } catch (validationError) {
      setPayableMessage(validationError.message);
      return;
    }

    try {
      payableCreateLock.current = true;
      setSavingPayable(true);
      setPayableMessage("");
      const payablesReference = collection(db, "users", user.uid, "payables");
      const createFingerprint = JSON.stringify({
        supplierId: supplier.id,
        purchaseType: payableForm.purchaseType,
        description: payableForm.description.trim(),
        purchaseDate: payableForm.purchaseDate,
        totalAmount: amounts.totalAmount,
        downPayment: amounts.paidAmount,
        downPaymentDate: payableForm.downPaymentDate,
        initialMethod: payableForm.initialMethod,
        initialIdentification: payableForm.initialIdentification.trim(),
        tripNumber: payableForm.tripNumber || null,
        notes: payableForm.notes.trim(),
        installments: normalizedInstallments.map(
          ({ amount, dueDate, method, identification, bankAccount }) => ({
            amount,
            dueDate: dueDate?.toISOString(),
            method,
            identification,
            bankAccount: bankAccount || "",
          })
        ),
      });
      if (payableCreateOperation.current?.fingerprint !== createFingerprint) {
        const payableReference = doc(payablesReference);
        const initialPaymentReference = downPayment > 0
          ? doc(collection(payableReference, "payments"))
          : null;
        payableCreateOperation.current = {
          fingerprint: createFingerprint,
          payableReference,
          initialPaymentReference,
        };
      }
      const { payableReference, initialPaymentReference } =
        payableCreateOperation.current;
      const payableData = {
        supplierId: supplier.id,
        purchaseType: payableForm.purchaseType,
        supplierName: supplier.name,
        description: payableForm.description.trim(),
        purchaseDate,
        totalAmount: amounts.totalAmount,
        paidAmount: amounts.paidAmount,
        balance: amounts.balance,
        tripNumber: payableForm.tripNumber
          ? Number(payableForm.tripNumber)
          : null,
        notes: payableForm.notes.trim(),
        initialPaymentMethod: payableForm.initialMethod,
        initialPaymentIdentification: payableForm.initialIdentification.trim(),
        initialPaymentDate: downPaymentDate,
        installments: normalizedInstallments,
        status: amounts.balance === 0 ? "paid" : downPayment > 0 ? "partial" : "pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await runTransaction(db, async (transaction) => {
        const existing = await transaction.get(payableReference);
        if (existing.exists()) return;
        transaction.set(payableReference, payableData);
        if (initialPaymentReference) {
          transaction.set(initialPaymentReference, {
            operationId: initialPaymentReference.id,
            type: "down-payment",
            amount: amounts.paidAmount,
            date: downPaymentDate,
            method: payableForm.initialMethod,
            identification: payableForm.initialIdentification.trim(),
            allocations: [],
            createdAt: serverTimestamp(),
          });
        }
      });
      resetPayableForm();
      setPayableMessage("Conta registrada com sucesso. A compra foi cadastrada separadamente dos pagamentos.");
    } catch (saveError) {
      console.error("Erro ao registrar conta a pagar:", saveError);
      setPayableMessage(`Não foi possível registrar a conta: ${saveError.message}`);
    } finally {
      payableCreateLock.current = false;
      setSavingPayable(false);
    }
  }

  async function handlePayablePaymentSubmit(event) {
    event.preventDefault();
    if (payablePaymentLock.current) return;
    const user = auth.currentUser;
    const payable = payables.find(
      (item) => item.id === payablePaymentForm.payableId
    );
    if (!user || !payable) {
      setPayableMessage("Selecione uma conta a pagar válida.");
      return;
    }
    const amount = Number(String(payablePaymentForm.amount).replace(",", "."));
    const paymentDate = payablePaymentForm.date
      ? new Date(`${payablePaymentForm.date}T12:00:00`)
      : null;
    if (!Number.isFinite(amount) || amount <= 0 || !paymentDate || Number.isNaN(paymentDate.getTime())) {
      setPayableMessage("Informe valor e data válidos para o pagamento.");
      return;
    }
    if (
      payablePaymentForm.method === "cheque" &&
      !payablePaymentForm.identification.trim()
    ) {
      setPayableMessage("Informe a identificação do cheque usado no pagamento.");
      return;
    }

    const paymentFingerprint = [
      payable.id,
      payablePaymentForm.installmentId,
      amount,
      payablePaymentForm.date,
      payablePaymentForm.method,
      payablePaymentForm.identification.trim(),
    ].join("|");
    payablePaymentOperation.current = reusePayablePaymentOperation(
      payablePaymentOperation.current,
      paymentFingerprint,
      () =>
        doc(
          collection(db, "users", user.uid, "payables", payable.id, "payments")
        )
      );

    const payableReference = doc(db, "users", user.uid, "payables", payable.id);
    const { paymentReference } = payablePaymentOperation.current;
    try {
      payablePaymentLock.current = true;
      setPayingPayable(true);
      setPayableMessage("");
      const alreadyRecorded = await runTransaction(db, async (transaction) => {
        const paymentSnapshot = await transaction.get(paymentReference);
        if (paymentSnapshot.exists()) return true;
        const payableSnapshot = await transaction.get(payableReference);
        if (!payableSnapshot.exists()) {
          throw new Error("Conta a pagar não encontrada.");
        }
        const savedPayable = {
          id: payableSnapshot.id,
          ...payableSnapshot.data(),
        };
        const result = applyPaymentToPayable(savedPayable, {
          amount,
          installmentId: payablePaymentForm.installmentId || null,
        });
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
          date: paymentDate,
          method: payablePaymentForm.method,
          identification: payablePaymentForm.identification.trim(),
          installmentId: payablePaymentForm.installmentId || null,
          allocations: result.allocations,
          createdAt: serverTimestamp(),
        });
        return false;
      });
      payablePaymentOperation.current = null;
      setPayablePaymentForm({ ...emptyPayablePayment, date: todayInput() });
      setPayableMessage(
        alreadyRecorded
          ? "Este pagamento já estava registrado; o saldo não foi atualizado novamente."
          : "Pagamento registrado e saldo recalculado."
      );
    } catch (paymentError) {
      console.error("Erro ao registrar pagamento de fornecedor:", paymentError);
      setPayableMessage(`Não foi possível registrar o pagamento: ${paymentError.message}`);
    } finally {
      payablePaymentLock.current = false;
      setPayingPayable(false);
    }
  }

  async function handleCheckStatusChange(payableId, installmentId, nextStatus) {
    const payable = payables.find((item) => item.id === payableId);
    const installment = payable?.installments?.find(
      (item) => item.id === installmentId
    );
    const user = auth.currentUser;
    if (!user || !payable || !installment) {
      setPayableMessage("Não foi possível localizar a compra e o cheque selecionados.");
      return;
    }

    const statusLabels = {
      [CHECK_STATUSES.COMPENSATED]: "compensar o cheque e registrar o débito no fluxo de caixa",
      [CHECK_STATUSES.RETURNED]: "registrar o cheque como devolvido, mantendo a dívida em aberto",
      [CHECK_STATUSES.CANCELLED]: "cancelar o cheque, mantendo a dívida em aberto",
    };
    if (
      !window.confirm(
        `Confirma ${statusLabels[nextStatus]} de nº ${installment.identification}?`
      )
    ) {
      return;
    }

    const changedAt = new Date();
    const payableReference = doc(
      db,
      "users",
      user.uid,
      "payables",
      payableId
    );
    const paymentReference =
      nextStatus === CHECK_STATUSES.COMPENSATED
        ? doc(
            collection(
              db,
              "users",
              user.uid,
              "payables",
              payableId,
              "payments"
            ),
            `check-compensation-${installmentId}`
          )
        : null;

    try {
      setPayableMessage("");
      const alreadyRecorded = await runTransaction(db, async (transaction) => {
        if (paymentReference) {
          const paymentSnapshot = await transaction.get(paymentReference);
          if (paymentSnapshot.exists()) return true;
        }
        const payableSnapshot = await transaction.get(payableReference);
        if (!payableSnapshot.exists()) {
          throw new Error("Conta a pagar não encontrada.");
        }
        const savedPayable = {
          id: payableSnapshot.id,
          ...payableSnapshot.data(),
        };
        const result = applyCheckStatusTransition(
          savedPayable,
          installmentId,
          nextStatus,
          changedAt
        );
        transaction.update(payableReference, {
          paidAmount: result.paidAmount,
          balance: result.balance,
          status: result.status,
          installments: result.installments,
          updatedAt: serverTimestamp(),
        });
        if (paymentReference) {
          const check = savedPayable.installments.find(
            (item) => item.id === installmentId
          );
          const allocation = result.allocations.find(
            (item) => item.installmentId === installmentId
          );
          if (!allocation) {
            throw new Error("Não foi possível associar a compensação ao saldo do cheque.");
          }
          transaction.set(paymentReference, {
            operationId: paymentReference.id,
            type: "check-compensation",
            amount: allocation.amount,
            date: changedAt,
            method: "cheque",
            identification: check.identification,
            bankAccount: check.bankAccount,
            checkId: installmentId,
            installmentId,
            allocations: allocation ? [allocation] : [],
            createdAt: serverTimestamp(),
          });
        }
        return false;
      });
      setPayableMessage(
        alreadyRecorded
          ? "A compensação deste cheque já estava registrada; o saldo não foi atualizado novamente."
          : nextStatus === CHECK_STATUSES.COMPENSATED
            ? "Cheque compensado. O pagamento foi vinculado à compra e lançado no fluxo de caixa uma única vez."
            : nextStatus === CHECK_STATUSES.RETURNED
              ? "Devolução registrada. A obrigação continua em aberto para pagamento."
              : "Cancelamento registrado. A obrigação continua em aberto para pagamento."
      );
    } catch (statusError) {
      console.error("Erro ao atualizar status do cheque:", statusError);
      setPayableMessage(`Não foi possível atualizar o cheque: ${statusError.message}`);
    }
  }

  async function handleReceiveSale(sale) {
    if (receivingSaleLock.current) return;

    const user = auth.currentUser;

    if (!user) {
      alert("Você precisa entrar novamente no sistema.");
      return;
    }

    const currentPending = Number(sale.pendingAmount || 0);

    if (currentPending <= 0) {
      alert("Esta venda já está paga.");
      return;
    }

    receivingSaleLock.current = true;
    const typedValue = window.prompt(
      `Saldo pendente: ${formatCurrency(
        currentPending
      )}\n\nDigite o valor recebido:`
    );

    if (typedValue === null) {
      receivingSaleLock.current = false;
      return;
    }

    const receivedValue = Number(
      typedValue.replace(",", ".").replace(/[^\d.-]/g, "")
    );

    if (!receivedValue || receivedValue <= 0) {
      alert("Digite um valor válido.");
      receivingSaleLock.current = false;
      return;
    }

    if (receivedValue > currentPending) {
      alert("O valor não pode ser maior que o saldo pendente.");
      receivingSaleLock.current = false;
      return;
    }

    try {
      setReceivingSaleId(sale.id);

      const saleReference = doc(
        db,
        "users",
        user.uid,
        "sales",
        sale.id
      );

      const paymentsReference = collection(
        db,
        "users",
        user.uid,
        "sales",
        sale.id,
        "payments"
      );
      const paymentOperation = reusePaymentOperation(
        pendingPaymentOperation.current,
        sale.id,
        receivedValue,
        () => doc(paymentsReference).id
      );
      pendingPaymentOperation.current = paymentOperation;
      const paymentReference = doc(
        paymentsReference,
        paymentOperation.id
      );

      const alreadyRecorded = await runTransaction(db, async (transaction) => {
        const paymentSnapshot = await transaction.get(paymentReference);
        if (paymentSnapshot.exists()) return true;

        const saleSnapshot = await transaction.get(saleReference);

        if (!saleSnapshot.exists()) {
          throw new Error("Venda não encontrada.");
        }

        const savedSale = saleSnapshot.data();

        const savedPaid = Number(savedSale.amountPaid || 0);
        const savedPending = Number(savedSale.pendingAmount || 0);
        let legacyClientReference = null;
        let legacyClientData = null;

        if (savedSale.balanceModel !== "per-sale") {
          if (!savedSale.clientId) {
            throw new Error(
              "Esta compra antiga não está vinculada a um cliente. Concilie-a antes de registrar o recebimento."
            );
          }

          legacyClientReference = doc(
            db,
            "users",
            user.uid,
            "clients",
            savedSale.clientId
          );
          const legacyClientSnapshot = await transaction.get(
            legacyClientReference
          );

          if (!legacyClientSnapshot.exists()) {
            throw new Error(
              "O cliente desta compra antiga não foi encontrado."
            );
          }

          legacyClientData = legacyClientSnapshot.data();
        }

        if (receivedValue > savedPending) {
          throw new Error(
            `O saldo atual é ${formatCurrency(savedPending)}.`
          );
        }

        const updatedBalance = applyPaymentToSale(
          {
            total: savedSale.total,
            amountPaid: savedPaid,
            pendingAmount: savedPending,
          },
          receivedValue
        );

        transaction.update(saleReference, {
          ...updatedBalance,
          updatedAt: serverTimestamp(),
        });

        if (legacyClientReference && legacyClientData) {
          const updatedLegacyDebt = adjustLegacyClientDebt(
            savedSale,
            legacyClientData.totalDebt,
            savedPending,
            updatedBalance.pendingAmount
          );

          transaction.update(legacyClientReference, {
            totalDebt: updatedLegacyDebt,
            totalReceived:
              Number(legacyClientData.totalReceived || 0) +
              receivedValue,
            status: updatedLegacyDebt === 0 ? "paid" : "partial",
            updatedAt: serverTimestamp(),
          });
        }

        transaction.set(paymentReference, {
          operationId: paymentOperation.id,
          saleId: sale.id,
          clientId: sale.clientId || "",
          value: receivedValue,
          previousBalance: savedPending,
          remainingBalance: updatedBalance.pendingAmount,
          createdAt: serverTimestamp(),
        });

        return false;
      });

      pendingPaymentOperation.current = null;
      alert(
        alreadyRecorded
          ? "Este recebimento já havia sido registrado. O saldo não foi baixado novamente."
          : "Recebimento registrado com sucesso!"
      );
    } catch (error) {
      console.error("Erro ao registrar recebimento:", error);
      alert(`Erro ao registrar recebimento: ${error.message}`);
    } finally {
      receivingSaleLock.current = false;
      setReceivingSaleId(null);
    }
  }

  function handleWhatsApp(debtor) {
    const phone = normalizePhone(debtor.phone);

    if (!phone) {
      alert("Este cliente não possui telefone cadastrado.");
      return;
    }

    const message = `Olá ${debtor.clientName}, tudo bem?

Estou entrando em contato referente ao seu saldo pendente na RC Confecções.

Saldo atual: ${formatCurrency(debtor.totalPending)}

Qualquer dúvida estou à disposição. Obrigado!`;

    window.open(
      `https://wa.me/${phone}?text=${encodeURIComponent(
        message
      )}`,
      "_blank"
    );
  }

  function handleReceipt(sale) {
    const receiptWindow = window.open("", "_blank");

    if (!receiptWindow) {
      alert("O navegador bloqueou a abertura do recibo.");
      return;
    }

    const itemsHtml = (sale.items || [])
      .map(
        (item) => `
          <tr>
            <td>${escapeReceiptText(item.quantity)}x ${escapeReceiptText(item.name)}</td>
            <td>${formatCurrency(item.unitPrice)}</td>
            <td>${formatCurrency(item.subtotal)}</td>
          </tr>
        `
      )
      .join("");

    receiptWindow.document.write(`
      <!DOCTYPE html>
      <html lang="pt-BR">
        <head>
          <meta charset="UTF-8" />
          <title>Recibo RC Confecções</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              color: #0f172a;
              padding: 35px;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              margin: 24px 0;
            }

            th, td {
              padding: 10px;
              text-align: left;
              border-bottom: 1px solid #dddddd;
            }

            .total {
              font-size: 20px;
              font-weight: bold;
            }

            .footer {
              margin-top: 50px;
              text-align: center;
            }
          </style>
        </head>

        <body>
          <h1>RC Confecções</h1>
          <p>Comprovante da compra #${escapeReceiptText(sale.id)}</p>

          <p><strong>Cliente:</strong> ${
            escapeReceiptText(sale.clientName || "Não informado")
          }</p>

          <p><strong>Data:</strong> ${formatDate(
            toDate(sale.saleDate) || toDate(sale.createdAt)
          )}</p>
          ${
            sale.tripName || sale.tripCity
              ? `<p><strong>Viagem:</strong> ${escapeReceiptText(sale.tripName || "Sem nome")}${sale.tripCity ? ` • ${escapeReceiptText(sale.tripCity)}` : ""}</p>`
              : ""
          }

          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Preço</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <p class="total">
            Total: ${formatCurrency(sale.total)}
          </p>

          <p>
            Recebido: ${formatCurrency(sale.amountPaid)}
          </p>

          <p>
            Saldo pendente: ${formatCurrency(
              sale.pendingAmount
            )}
          </p>

          <div class="footer">
            ______________________________________
            <p>RC Confecções</p>
          </div>

          <script>
            window.onload = function () {
              window.print();
            };
          </script>
        </body>
      </html>
    `);

    receiptWindow.document.close();
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>RC Confecções</p>
          <h1 style={styles.title}>Financeiro</h1>
          <p style={styles.subtitle}>
            Acompanhe vendas, recebimentos, despesas e obrigações de fornecedores.
          </p>
        </div>

        <label style={styles.filterLabel}>
          Viagem
          <select
            value={tripFilter}
            onChange={(event) => setTripFilter(event.target.value)}
            style={styles.periodSelect}
          >
            <option value="all">Todas as viagens</option>
            <option value="1">1ª viagem</option>
            <option value="2">2ª viagem</option>
            <option value="third">
              3ª viagem (julho a setembro de 2026)
            </option>
            <option value="fourth">
              4ª viagem (outubro a dezembro de 2026)
            </option>
            <option value="unassigned">Sem viagem</option>
          </select>
        </label>
      </header>

      <section style={styles.tripSummarySection}>
        <div style={styles.tripSummaryHeader}>
          <div>
            <h2 style={styles.cardTitle}>
              {tripFilter === "all"
                ? "Resumo de todas as viagens"
                : tripFilter === "unassigned"
                  ? "Despesas sem viagem"
                  : `${tripFilter === "third" ? "3ª" : tripFilter === "fourth" ? "4ª" : `${tripFilter}ª`} viagem`}
            </h2>
            <p style={styles.helperText}>
              Vendas agrupadas pela data original ou, quando ausente, pela
              criação do registro. A classificação permanece como proposta.
            </p>
          </div>
          <span style={styles.proposalBadge}>
            Classificação das vendas proposta
          </span>
        </div>
        <div style={styles.tripSummaryGrid}>
          {[
            {
              label: "Total vendido",
              value: formatCurrency(tripSummary.sold),
            },
            {
              label: "Total recebido",
              value: formatCurrency(tripSummary.received),
            },
            {
              label: "Total pendente",
              value: formatCurrency(tripSummary.pending),
            },
            { label: "Quantidade de vendas", value: tripSummary.salesCount },
            {
              label: "Total de despesas",
              value: formatCurrency(tripSummary.expenses),
            },
            {
              label: "Pagamentos a fornecedores",
              value: formatCurrency(tripSummary.supplierPayments),
            },
            {
              label: "Compras operacionais a fornecedores",
              value: formatCurrency(tripSummary.supplierOperationalPurchases),
            },
            {
              label: "Custo estimado das mercadorias",
              value: tripSummary.hasCompleteCostData
                ? formatCurrency(tripSummary.costOfGoodsSold)
                : "Dados incompletos",
            },
            {
              label: "Lucro estimado",
              value: tripFilter === "unassigned"
                ? "Viagem não definida"
                : tripSummary.hasCompleteCostData
                ? formatCurrency(tripSummary.estimatedProfit)
                : "Dados de custo incompletos",
            },
            {
              label: "Fluxo de caixa",
              value: tripFilter === "unassigned"
                ? "Viagem não definida"
                : formatCurrency(tripSummary.cashFlow),
            },
          ].map(({ label, value }) => (
            <div key={label} style={styles.tripSummaryCard}>
              <span style={styles.summaryLabel}>{label}</span>
              <strong style={styles.summaryValue}>{value}</strong>
            </div>
          ))}
        </div>
        <p style={styles.tripNotice}>
          Compras classificadas como estoque não viram despesa nem alteram o
          estoque automaticamente; o custo entra no lucro quando a mercadoria é
          vendida. Compras marcadas como operacionais entram uma vez no lucro
          na data da compra. O fluxo de caixa usa recebimentos efetivos menos
          despesas e pagamentos registrados aos fornecedores; não é o lucro.
          Não registre também a mesma compra operacional em “Registrar despesa”.
          Despesas antigas sem viagem só entram no
          consolidado geral e podem ser classificadas individualmente. Quando
          não há custo unitário salvo na venda, usamos o custo atual do produto.
        </p>
      </section>

      <section className="payables-section">
        <div className="payables-heading">
          <div>
            <p className="payables-eyebrow">Fornecedores</p>
            <h2>Contas a pagar</h2>
            <p>
              Compras a prazo e pagamentos são acompanhados separadamente das
              despesas e do custo das mercadorias.
            </p>
            <span className="payables-current-filter">
              {tripFilter === "all"
                ? "Visão geral: todas as obrigações da empresa."
                : tripFilter === "unassigned"
                  ? "Mostrando obrigações sem viagem vinculada."
                  : `Mostrando obrigações da ${tripFilter === "third" ? "3ª" : tripFilter === "fourth" ? "4ª" : `${tripFilter}ª`} viagem.`}
            </span>
          </div>
        </div>

        {payableMessage && (
          <p className="payables-message" role="status">{payableMessage}</p>
        )}

        <div className="payables-metrics">
          <article><span>Total a pagar</span><strong>{formatCurrency(payableSummary.totalToPay)}</strong></article>
          <article><span>Contas vencidas</span><strong>{payableSummary.overdueCount} · {formatCurrency(payableSummary.overdueTotal)}</strong></article>
          <article><span>A vencer (30 dias)</span><strong>{payableSummary.upcomingCount} · {formatCurrency(payableSummary.upcomingTotal)}</strong></article>
          <article><span>Total já pago</span><strong>{formatCurrency(payableSummary.totalPaid)}</strong></article>
        </div>
        <div className="check-forecast" aria-label="Cheques previstos para compensação">
          {checkSummary.upcomingTotals.map(({ days, total }) => (
            <article key={days}>
              <span>Compensação em até {days} dias</span>
              <strong>{formatCurrency(total)}</strong>
            </article>
          ))}
        </div>

        <div className="payables-workspace">
          <details className="payables-panel" open={suppliers.length > 0 ? undefined : true}>
            <summary>Registrar compra / conta</summary>
            {suppliers.length === 0 ? (
              <p>
                Cadastre um fornecedor antes de registrar uma conta. Acesse
                {" "}<a href="/fornecedores">Fornecedores</a>.
              </p>
            ) : (
              <form className="payables-form" onSubmit={handlePayableSubmit}>
                <label>
                  Fornecedor *
                  <select name="supplierId" value={payableForm.supplierId} onChange={handlePayableFormChange} required>
                    <option value="">Selecione</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name} · {supplier.identifier}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Descrição da compra *
                  <input name="description" value={payableForm.description} onChange={handlePayableFormChange} required maxLength={180} placeholder="Ex.: mercadorias para revenda" />
                </label>
                <label>
                  Natureza da compra *
                  <select name="purchaseType" value={payableForm.purchaseType} onChange={handlePayableFormChange} required>
                    <option value="inventory">Estoque / mercadorias</option>
                    <option value="operational">Despesa operacional</option>
                  </select>
                </label>
                <label>
                  Data da compra *
                  <input type="date" name="purchaseDate" value={payableForm.purchaseDate} onChange={handlePayableFormChange} required />
                </label>
                <label>
                  Valor total *
                  <input type="number" name="totalAmount" value={payableForm.totalAmount} onChange={handlePayableFormChange} min="0.01" step="0.01" required />
                </label>
                <label>
                  Entrada já paga
                  <input type="number" name="downPayment" value={payableForm.downPayment} onChange={handlePayableFormChange} min="0" step="0.01" />
                </label>
                {Number(payableForm.downPayment) > 0 && (
                  <label>
                    Data da entrada *
                    <input type="date" name="downPaymentDate" value={payableForm.downPaymentDate} onChange={handlePayableFormChange} required />
                  </label>
                )}
                <label>
                  Forma da entrada
                  <select name="initialMethod" value={payableForm.initialMethod} onChange={handlePayableFormChange}>
                    <option value="pix">Pix</option>
                    <option value="dinheiro">Dinheiro</option>
                    <option value="transferencia">Transferência</option>
                    <option value="cartao">Cartão</option>
                    <option value="boleto">Boleto</option>
                  </select>
                </label>
                <label>
                  Viagem (opcional)
                  <select name="tripNumber" value={payableForm.tripNumber} onChange={handlePayableFormChange}>
                    <option value="">Sem viagem vinculada</option>
                    {tripOptions.map((trip) => (
                      <option key={trip.value} value={trip.value}>{trip.label}</option>
                    ))}
                  </select>
                </label>
                <label className="payables-notes-field">
                  Observações
                  <textarea name="notes" value={payableForm.notes} onChange={handlePayableFormChange} rows={2} maxLength={1000} />
                </label>

                <div className="payables-schedule">
                  <div className="payables-schedule-heading">
                    <div>
                      <h3>Parcelas e cheques</h3>
                      <p>Cheques emitidos seguem pendentes até a compensação. A soma deve fechar o saldo após a entrada.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPayableInstallments((current) => [...current, {
                        id: crypto.randomUUID(),
                        amount: "",
                        dueDate: "",
                        method: "boleto",
                        identification: "",
                        bankAccount: "",
                      }])}
                    >
                      + Parcela / cheque
                    </button>
                  </div>
                  {payableInstallments.length === 0 ? (
                    <p className="payables-empty">Adicione parcelas ou cheques para controlar vencimentos.</p>
                  ) : (
                    payableInstallments.map((item, index) => (
                      <div className="payables-installment-row" key={item.id}>
                        <label>Valor<input type="number" value={item.amount} min="0.01" step="0.01" onChange={(event) => updatePayableInstallment(index, "amount", event.target.value)} required /></label>
                        <label>{item.method === "cheque" ? "Data prevista de apresentação *" : "Vencimento"}
                          <input type="date" value={item.dueDate} onChange={(event) => updatePayableInstallment(index, "dueDate", event.target.value)} required />
                        </label>
                        <label>Forma
                          <select value={item.method} onChange={(event) => updatePayableInstallment(index, "method", event.target.value)}>
                            <option value="boleto">Boleto</option><option value="cheque">Cheque</option><option value="pix">Pix</option><option value="transferencia">Transferência</option><option value="dinheiro">Dinheiro</option><option value="cartao">Cartão</option>
                          </select>
                        </label>
                        <label>{item.method === "cheque" ? "Número do cheque *" : "Identificação"}
                          <input value={item.identification} onChange={(event) => updatePayableInstallment(index, "identification", event.target.value)} maxLength={80} placeholder={item.method === "cheque" ? "Número do cheque" : "Nº documento"} required={item.method === "cheque"} />
                        </label>
                        {item.method === "cheque" && (
                          <label>Conta Banco do Brasil *
                            <select value={item.bankAccount || ""} onChange={(event) => updatePayableInstallment(index, "bankAccount", event.target.value)} required>
                              <option value="">Selecione PF ou PJ</option>
                              <option value="bb-pf">Banco do Brasil · PF</option>
                              <option value="bb-pj">Banco do Brasil · PJ</option>
                            </select>
                          </label>
                        )}
                        <button type="button" aria-label={`Remover parcela ${index + 1}`} onClick={() => setPayableInstallments((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remover</button>
                      </div>
                    ))
                  )}
                </div>
                <button className="payables-primary-button" type="submit" disabled={savingPayable}>
                  {savingPayable ? "Salvando..." : "Registrar conta a pagar"}
                </button>
              </form>
            )}
          </details>

          <details
            className="payables-panel"
            open={showPayablePaymentForm}
            onToggle={(event) => setShowPayablePaymentForm(event.currentTarget.open)}
          >
            <summary>Registrar pagamento</summary>
            <form className="payables-form" onSubmit={handlePayablePaymentSubmit}>
              <label className="payables-wide-field">
                Conta / compra
                <select
                  value={payablePaymentForm.payableId}
                  onChange={(event) => setPayablePaymentForm((current) => ({
                    ...current,
                    payableId: event.target.value,
                    installmentId: "",
                  }))}
                  required
                >
                  <option value="">Selecione uma conta em aberto</option>
                  {payables.filter((item) => getPayableBalance(item) > 0).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.supplierName} · {item.description} · saldo {formatCurrency(getPayableBalance(item))}
                    </option>
                  ))}
                </select>
              </label>
              {selectedPaymentPayable?.installments?.length > 0 && (
                <label className="payables-wide-field">
                  Parcela / cheque (opcional)
                  <select
                    value={payablePaymentForm.installmentId}
                    onChange={(event) => setPayablePaymentForm((current) => ({ ...current, installmentId: event.target.value }))}
                  >
                    <option value="">Abater automaticamente dos vencimentos mais próximos</option>
                    {selectedPaymentPayable.installments.filter((item) => Number(item.amount) > Number(item.paidAmount || 0) && getCheckStatus(item) !== CHECK_STATUSES.ISSUED).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.method === "cheque" ? "Cheque" : "Parcela"} {item.identification ? `#${item.identification}` : ""} · {formatDate(item.dueDate)} · saldo {formatCurrency(Number(item.amount) - Number(item.paidAmount || 0))}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>Valor pago<input type="number" value={payablePaymentForm.amount} onChange={(event) => setPayablePaymentForm((current) => ({ ...current, amount: event.target.value }))} min="0.01" step="0.01" required /></label>
              <label>Data do pagamento<input type="date" value={payablePaymentForm.date} onChange={(event) => setPayablePaymentForm((current) => ({ ...current, date: event.target.value }))} required /></label>
              <label>Forma de pagamento
                <select value={payablePaymentForm.method} onChange={(event) => setPayablePaymentForm((current) => ({ ...current, method: event.target.value }))}>
                  <option value="pix">Pix</option><option value="dinheiro">Dinheiro</option><option value="transferencia">Transferência</option><option value="boleto">Boleto</option><option value="cartao">Cartão</option>
                </select>
              </label>
              <label>Identificação do pagamento<input value={payablePaymentForm.identification} onChange={(event) => setPayablePaymentForm((current) => ({ ...current, identification: event.target.value }))} maxLength={80} placeholder="Nº do comprovante" /></label>
              <button className="payables-primary-button" type="submit" disabled={payingPayable}>
                {payingPayable ? "Registrando..." : "Confirmar pagamento"}
              </button>
            </form>
          </details>
        </div>

        <section className="checks-section" aria-labelledby="checks-heading">
          <div className="payables-list-heading checks-heading">
            <div>
              <h3 id="checks-heading">Controle de cheques</h3>
              <p>Cheques emitidos permanecem como obrigação até a confirmação da compensação.</p>
            </div>
            <span>{filteredChecks.length} cheque(s)</span>
          </div>
          <div className="checks-filters">
            <label>
              Mês de apresentação
              <select value={checkMonthFilter} onChange={(event) => setCheckMonthFilter(event.target.value)}>
                <option value="all">Todos os meses</option>
                {checkMonths.map((month) => (
                  <option key={month} value={month}>
                    {new Date(`${month}-01T12:00:00`).toLocaleDateString("pt-BR", {
                      month: "long",
                      year: "numeric",
                    })}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Fornecedor
              <select value={checkSupplierFilter} onChange={(event) => setCheckSupplierFilter(event.target.value)}>
                <option value="all">Todos os fornecedores</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                ))}
              </select>
            </label>
            <label>
              Conta
              <select value={checkAccountFilter} onChange={(event) => setCheckAccountFilter(event.target.value)}>
                <option value="all">PF e PJ</option>
                <option value="bb-pf">Banco do Brasil · PF</option>
                <option value="bb-pj">Banco do Brasil · PJ</option>
                <option value="">Conta não informada (legado)</option>
              </select>
            </label>
            <label>
              Status
              <select value={checkStatusFilter} onChange={(event) => setCheckStatusFilter(event.target.value)}>
                <option value="all">Todos os status</option>
                <option value={CHECK_STATUSES.ISSUED}>Emitido</option>
                <option value={CHECK_STATUSES.COMPENSATED}>Compensado</option>
                <option value={CHECK_STATUSES.RETURNED}>Devolvido</option>
                <option value={CHECK_STATUSES.CANCELLED}>Cancelado</option>
              </select>
            </label>
          </div>
          {filteredChecks.length === 0 ? (
            <p className="payables-empty">Nenhum cheque corresponde aos filtros.</p>
          ) : (
            <div className="checks-list">
              {filteredChecks.map((check) => {
                const statusLabels = {
                  [CHECK_STATUSES.ISSUED]: "Emitido",
                  [CHECK_STATUSES.COMPENSATED]: "Compensado",
                  [CHECK_STATUSES.RETURNED]: "Devolvido",
                  [CHECK_STATUSES.CANCELLED]: "Cancelado",
                };
                const accountLabels = {
                  "bb-pf": "Banco do Brasil · PF",
                  "bb-pj": "Banco do Brasil · PJ",
                };
                const history =
                  check.installment.checkStatusHistory ||
                  [{ status: check.status, changedAt: check.dueDate }];
                return (
                  <article className="check-card" key={`${check.payableId}-${check.installment.id}`}>
                    <div className="check-card-main">
                      <div>
                        <strong>Cheque #{check.checkNumber || "sem número"}</strong>
                        <span>{check.supplierName} · {check.description}</span>
                      </div>
                      <span className={`check-status check-status-${check.status}`}>
                        {statusLabels[check.status] || "Status desconhecido"}
                      </span>
                    </div>
                    <div className="check-card-meta">
                      <span>{accountLabels[check.bankAccount] || "Conta não informada (cadastro antigo)"}</span>
                      <span>Apresentação: {formatDate(check.dueDate)}</span>
                      <span>Compra: {formatDate(payables.find((item) => item.id === check.payableId)?.purchaseDate)}</span>
                      <strong>Valor: {formatCurrency(check.installment.amount)}</strong>
                      {check.status !== CHECK_STATUSES.COMPENSATED && (
                        <strong>Obrigação em aberto: {formatCurrency(check.amount)}</strong>
                      )}
                    </div>
                    <details className="check-history">
                      <summary>Histórico de status</summary>
                      {history.map((entry, index) => (
                        <p key={`${entry.status}-${index}`}>
                          {statusLabels[entry.status] || entry.status} · {formatDate(entry.changedAt)}
                        </p>
                      ))}
                    </details>
                    {check.status === CHECK_STATUSES.ISSUED && (
                      <div className="check-actions">
                        <button type="button" className="check-action-primary" onClick={() => handleCheckStatusChange(check.payableId, check.installment.id, CHECK_STATUSES.COMPENSATED)}>
                          Confirmar compensação
                        </button>
                        <button type="button" onClick={() => handleCheckStatusChange(check.payableId, check.installment.id, CHECK_STATUSES.RETURNED)}>
                          Registrar devolução
                        </button>
                        <button type="button" onClick={() => handleCheckStatusChange(check.payableId, check.installment.id, CHECK_STATUSES.CANCELLED)}>
                          Cancelar cheque
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <div className="payables-list-heading">
          <h3>Obrigações {tripFilter === "all" ? "da empresa" : "da visão selecionada"}</h3>
          <span>{selectedPayables.length} conta(s)</span>
        </div>
        {selectedPayables.length === 0 ? (
            <p className="payables-empty">Nenhuma conta registrada nesta visão.</p>
        ) : (
          <div className="payables-list">
            {selectedPayables.map((payable) => (
              <article className="payable-card" key={payable.id}>
                <div className="payable-card-heading">
                  <div>
                    <h3>{payable.supplierName || "Fornecedor"}</h3>
                    <p>{payable.description} · compra em {formatDate(payable.purchaseDate)}</p>
                  </div>
                  <strong className={getPayableBalance(payable) > 0 ? "" : "payable-paid-status"}>
                    {getPayableBalance(payable) > 0
                      ? `${formatCurrency(getPayableBalance(payable))} em aberto`
                      : "Quitada"}
                  </strong>
                </div>
                <div className="payable-card-meta">
                  <span>Total: {formatCurrency(payable.totalAmount)}</span>
                  <span>Pago: {formatCurrency(payable.paidAmount)}</span>
                  <span>{payable.tripNumber ? `${payable.tripNumber}ª viagem` : "Sem viagem"}</span>
                  <span>{payable.purchaseType === "operational" ? "Despesa operacional" : "Estoque / mercadorias"}</span>
                  <span>{(payable.installments || []).length} parcela(s)/título(s)</span>
                </div>
                {payable.notes && <p className="payable-notes">{payable.notes}</p>}
                {!!payable.installments?.length && (
                  <div className="payable-installments">
                    {payable.installments.map((item) => {
                      const outstanding = Math.max(Number(item.amount || 0) - Number(item.paidAmount || 0), 0);
                      const overdue = outstanding > 0 && toDate(item.dueDate) < new Date(new Date().setHours(0, 0, 0, 0));
                      return (
                        <div key={item.id} className={overdue ? "payable-installment overdue" : "payable-installment"}>
                          <span>{item.method === "cheque" ? "Cheque" : "Parcela"} {item.identification ? `#${item.identification}` : ""}</span>
                          <span>{formatDate(item.dueDate)}</span>
                          <strong>{formatCurrency(outstanding)} {overdue ? "· vencido" : ""}</strong>
                        </div>
                      );
                    })}
                  </div>
                )}
                {(paymentsByPayable[payable.id] || []).length > 0 && (
                  <details className="payable-payment-history">
                    <summary>Histórico de pagamentos</summary>
                    {(paymentsByPayable[payable.id] || [])
                      .slice()
                      .sort(
                        (first, second) =>
                          (toDate(second.date)?.getTime() || 0) -
                          (toDate(first.date)?.getTime() || 0)
                      )
                      .map((payment) => (
                        <p key={payment.id}>
                          <strong>{formatDate(payment.date)}</strong> · {formatCurrency(payment.amount)} · {payment.method || "Forma não informada"} {payment.identification && `· ${payment.identification}`}
                        </p>
                      ))}
                  </details>
                )}
                {getPayableBalance(payable) > 0 && <button
                  type="button"
                  className="payables-secondary-button"
                  onClick={() => {
                    setPayablePaymentForm((current) => ({
                      ...current,
                      payableId: payable.id,
                      installmentId: "",
                      amount: "",
                    }));
                    setShowPayablePaymentForm(true);
                  }}
                >
                  Registrar pagamento
                </button>}
              </article>
            ))}
          </div>
        )}
        {payableSummary.upcomingItems.length > 0 && (
          <div className="payables-upcoming">
            <h3>Próximos vencimentos</h3>
            {payableSummary.upcomingItems.slice(0, 5).map((item) => (
              <p key={`${item.payableId}-${item.identification}-${item.dueDate.getTime()}`}>
                <strong>{formatDate(item.dueDate)}</strong> · {item.supplierName} · {item.method === "cheque" ? "Cheque" : "Parcela"} {item.identification && `#${item.identification}`} · {formatCurrency(item.amount)}
              </p>
            ))}
          </div>
        )}
        <p className="payables-accounting-note">
          Registrar uma obrigação não lança uma despesa operacional nem altera
          o custo dos produtos. Cada pagamento reduz apenas o saldo desta conta
          e registra o fluxo de caixa uma única vez.
        </p>
      </section>

      <section style={styles.mainGrid}>
        <form
          onSubmit={handleExpenseSubmit}
          style={styles.card}
        >
          <h2 style={styles.cardTitle}>
            {editingExpenseId ? "Editar despesa" : "Registrar despesa"}
          </h2>

          <label style={styles.label}>
            Categoria
            <select
              name="category"
              value={expenseForm.category}
              onChange={handleExpenseChange}
              style={styles.input}
            >
              <option value="combustivel">Combustível</option>
              <option value="hotel">Hospedagem</option>
              <option value="alimentacao">Alimentação</option>
              <option value="mercadoria">Compra de mercadoria</option>
              <option value="manutencao">Manutenção</option>
              <option value="transporte">Transporte</option>
              <option value="outros">Outros</option>
            </select>
          </label>

          <label style={styles.label}>
            Viagem
            <select
              name="tripNumber"
              value={expenseForm.tripNumber}
              onChange={handleExpenseChange}
              required
              style={styles.input}
            >
              <option value="" disabled>
                Selecione a viagem
              </option>
              {tripOptions.map((trip) => (
                <option key={trip.value} value={trip.value}>
                  {trip.label}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.label}>
            Descrição
            <input
              type="text"
              name="description"
              value={expenseForm.description}
              onChange={handleExpenseChange}
              placeholder="Exemplo: combustível da viagem"
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Valor
            <input
              type="number"
              name="value"
              value={expenseForm.value}
              onChange={handleExpenseChange}
              min="0"
              step="0.01"
              placeholder="0,00"
              required
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Data
            <input
              type="date"
              name="date"
              value={expenseForm.date}
              onChange={handleExpenseChange}
              required
              style={styles.input}
            />
          </label>

          <button
            type="submit"
            disabled={savingExpense}
            style={styles.saveButton}
          >
            {savingExpense
              ? "Salvando..."
              : editingExpenseId
                ? "Salvar alterações"
                : "Salvar despesa"}
          </button>
          {editingExpenseId && (
            <button
              type="button"
              onClick={cancelExpenseEdit}
              disabled={savingExpense}
              style={styles.cancelButton}
            >
              Cancelar edição
            </button>
          )}
        </form>

        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <h2 style={styles.cardTitle}>Clientes devedores</h2>
              <p style={styles.helperText}>
                {debtors.length} cliente(s) com saldo pendente.
              </p>
            </div>

            <input
              type="search"
              value={searchText}
              onChange={(event) =>
                setSearchText(event.target.value)
              }
              placeholder="Pesquisar cliente"
              style={styles.searchInput}
            />
          </div>

          {debtors.length === 0 ? (
            <div style={styles.empty}>
              <span style={styles.emptyIcon}>✅</span>
              <strong>Nenhum cliente devedor</strong>
            </div>
          ) : (
            <div style={styles.debtorList}>
              {debtors.map((debtor) => (
                <article
                  key={debtor.clientId}
                  style={styles.debtorItem}
                >
                  <div>
                    <h3 style={styles.debtorName}>
                      {debtor.clientName}
                    </h3>

                    <p style={styles.debtorInfo}>
                      📞 {debtor.phone || "Telefone não informado"}
                    </p>

                    <p style={styles.debtorInfo}>
                      📍 {debtor.city || "Cidade não informada"}
                    </p>
                  </div>

                  <div style={styles.debtorRight}>
                    <span style={styles.smallLabel}>
                      Total devido
                    </span>

                    <strong style={styles.pendingValue}>
                      {formatCurrency(debtor.totalPending)}
                    </strong>
                    {debtor.legacyBalance > 0 && (
                      <p style={styles.saleDebtMeta}>
                        Saldo histórico: {formatCurrency(debtor.legacyBalance)}
                      </p>
                    )}

                    <div style={styles.saleDebtList}>
                      {debtor.sales.map((openSale) => {
                        const dueDate = toDate(
                          openSale.dueDate ||
                            openSale.paymentDueDate ||
                            openSale.collectionDate ||
                            openSale.dataCobranca
                        );
                        const isOverdue = isSaleOverdue(
                          dueDate,
                          openSale.pendingAmount
                        );

                        return (
                          <article
                            key={openSale.id}
                            style={styles.saleDebtItem}
                          >
                            <div style={styles.saleDebtHeader}>
                              <div>
                                <strong>
                                  Compra #{openSale.id}
                                </strong>
                                <p style={styles.saleDebtMeta}>
                                  {formatDate(
                                    toDate(
                                      openSale.saleDate ||
                                        openSale.createdAt
                                    )
                                  )}
                                  {dueDate
                                    ? ` • ${isOverdue ? "Vencida" : "Vence"} ${formatDate(dueDate)}`
                                    : " • Vencimento não informado"}
                                </p>
                                {tripBySaleId.has(openSale.id) && (
                                  <p style={styles.saleDebtMeta}>
                                    Classificação proposta:{" "}
                                    {tripBySaleId.get(openSale.id)}ª viagem
                                  </p>
                                )}
                                {(openSale.tripName || openSale.tripCity) && (
                                  <p style={styles.saleDebtMeta}>
                                    Viagem registrada: {openSale.tripName || "Sem nome"}
                                    {openSale.tripCity
                                      ? ` • ${openSale.tripCity}`
                                      : ""}
                                  </p>
                                )}
                              </div>
                              {isOverdue && (
                                <span style={styles.overdueBadge}>Vencida</span>
                              )}
                            </div>

                            <div style={styles.saleDebtValues}>
                              <span>
                                Total: {formatCurrency(openSale.total)}
                              </span>
                              <span>
                                Recebido: {formatCurrency(openSale.amountPaid)}
                              </span>
                              <strong>
                                Saldo: {formatCurrency(openSale.pendingAmount)}
                              </strong>
                            </div>

                            <div style={styles.actions}>
                              <button
                                type="button"
                                onClick={() => handleReceiveSale(openSale)}
                                disabled={receivingSaleId === openSale.id}
                                style={styles.receiveButton}
                              >
                                💵 Receber nesta compra
                              </button>

                              <button
                                type="button"
                                onClick={() => handleReceipt(openSale)}
                                style={styles.receiptButton}
                              >
                                📄 Recibo
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleWhatsApp(debtor)}
                      style={styles.whatsAppButton}
                    >
                      📱 WhatsApp
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>

      <section style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <h2 style={styles.cardTitle}>Histórico financeiro</h2>
            <p style={styles.helperText}>
              Vendas e despesas da viagem selecionada. Despesas sem viagem
              permanecem disponíveis em “Todas as viagens” ou “Sem viagem”.
            </p>
          </div>
        </div>

        {loading ? (
          <div style={styles.empty}>
            <span style={styles.emptyIcon}>⏳</span>
            <strong>Carregando financeiro...</strong>
          </div>
        ) : history.length === 0 ? (
          <div style={styles.empty}>
            <span style={styles.emptyIcon}>📊</span>
            <strong>Nenhuma movimentação encontrada</strong>
          </div>
        ) : (
          <div style={styles.historyList}>
            {history.map((entry) => (
              <article key={entry.id} style={styles.historyItem}>
                <div style={styles.historyLeft}>
                  <div
                    style={{
                      ...styles.historyIcon,
                      background:
                        entry.type === "sale"
                          ? "#dcfce7"
                          : "#fee2e2",
                    }}
                  >
                    {entry.type === "sale" ? "💰" : "💸"}
                  </div>

                  <div>
                    <h3 style={styles.historyTitle}>
                      {entry.title}
                    </h3>

                    <p style={styles.historyDescription}>
                      {entry.description} • {formatDate(entry.date)}
                    </p>
                  </div>
                </div>

                <div style={styles.historyRight}>
                  <strong
                    style={
                      entry.type === "sale"
                        ? styles.receivedValue
                        : styles.expenseValue
                    }
                  >
                    {entry.type === "sale" ? "+" : "-"}{" "}
                    {formatCurrency(entry.value)}
                  </strong>

                  {entry.type === "sale" && (
                    <span style={styles.historyReceived}>
                      Recebido: {formatCurrency(entry.received)}
                    </span>
                  )}

                  {entry.type === "expense" && (
                    <div style={styles.expenseActions}>
                      <button
                        type="button"
                        onClick={() => handleEditExpense(entry.expense)}
                        style={styles.editButton}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteExpense(entry.expenseId)}
                        style={styles.deleteButton}
                      >
                        Excluir
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const styles = {
  page: {
    color: "#0f172a",
    fontFamily: "Arial, sans-serif",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "18px",
    marginBottom: "22px",
  },

  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: "13px",
    fontWeight: "800",
    textTransform: "uppercase",
  },

  title: {
    margin: "5px 0",
    fontSize: "32px",
  },

  subtitle: {
    margin: 0,
    color: "#64748b",
  },

  periodSelect: {
    width: "100%",
    minWidth: "220px",
    maxWidth: "340px",
    padding: "12px 14px",
    borderRadius: "11px",
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    fontSize: "15px",
  },

  filterLabel: {
    display: "grid",
    gap: "6px",
    color: "#475569",
    fontSize: "12px",
    fontWeight: "700",
  },

  tripSummarySection: {
    marginBottom: "22px",
    padding: "22px",
    borderRadius: "18px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 10px 25px rgba(15, 23, 42, 0.06)",
  },

  tripSummaryHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: "12px",
    marginBottom: "12px",
  },

  proposalBadge: {
    padding: "6px 10px",
    borderRadius: "999px",
    background: "#fef3c7",
    color: "#92400e",
    fontSize: "12px",
    fontWeight: "800",
  },

  tripSummaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "12px",
  },

  tripSummaryCard: {
    padding: "15px",
    borderRadius: "13px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  tripNotice: {
    margin: "14px 0 0",
    color: "#64748b",
    fontSize: "13px",
    lineHeight: 1.5,
  },

  summaryLabel: {
    display: "block",
    marginBottom: "8px",
    color: "#64748b",
    fontSize: "13px",
  },

  summaryValue: {
    fontSize: "19px",
  },

  receivedValue: {
    color: "#16a34a",
    fontSize: "18px",
  },

  pendingValue: {
    color: "#dc2626",
    fontSize: "18px",
  },

  expenseValue: {
    color: "#dc2626",
    fontSize: "18px",
  },

  mainGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
    gap: "22px",
    alignItems: "start",
    marginBottom: "22px",
  },

  card: {
    padding: "24px",
    borderRadius: "18px",
    background: "#ffffff",
    boxShadow:
      "0 10px 30px rgba(15, 23, 42, 0.08)",
  },

  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "14px",
  },

  cardTitle: {
    margin: "0 0 8px",
    fontSize: "21px",
  },

  helperText: {
    margin: "0 0 18px",
    color: "#64748b",
    fontSize: "14px",
  },

  label: {
    display: "grid",
    gap: "8px",
    marginBottom: "16px",
    color: "#334155",
    fontSize: "14px",
    fontWeight: "700",
  },

  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "13px 14px",
    borderRadius: "11px",
    border: "1px solid #cbd5e1",
    outline: "none",
    background: "#ffffff",
    fontSize: "15px",
  },

  searchInput: {
    width: "min(100%, 300px)",
    boxSizing: "border-box",
    padding: "12px 13px",
    borderRadius: "10px",
    border: "1px solid #cbd5e1",
    outline: "none",
    fontSize: "14px",
  },

  saveButton: {
    width: "100%",
    border: 0,
    borderRadius: "11px",
    padding: "14px",
    background: "#2563eb",
    color: "#ffffff",
    fontSize: "15px",
    fontWeight: "800",
    cursor: "pointer",
  },

  cancelButton: {
    width: "100%",
    marginTop: "9px",
    padding: "12px",
    border: "1px solid #cbd5e1",
    borderRadius: "11px",
    background: "#ffffff",
    color: "#334155",
    fontSize: "14px",
    fontWeight: "700",
    cursor: "pointer",
  },

  empty: {
    minHeight: "220px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    color: "#64748b",
  },

  emptyIcon: {
    marginBottom: "10px",
    fontSize: "38px",
  },

  debtorList: {
    display: "grid",
    gap: "12px",
  },

  debtorItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "16px",
    padding: "16px",
    borderRadius: "14px",
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
  },

  debtorName: {
    margin: "0 0 7px",
    fontSize: "17px",
  },

  debtorInfo: {
    margin: "3px 0",
    color: "#64748b",
    fontSize: "13px",
  },

  debtorRight: {
    display: "grid",
    justifyItems: "end",
    gap: "6px",
    width: "min(100%, 600px)",
  },

  saleDebtList: {
    display: "grid",
    width: "100%",
    gap: "10px",
    marginTop: "8px",
  },

  saleDebtItem: {
    display: "grid",
    gap: "8px",
    padding: "12px",
    borderRadius: "11px",
    border: "1px solid #e2e8f0",
    background: "#ffffff",
  },

  saleDebtHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "start",
    flexWrap: "wrap",
    gap: "8px",
  },

  saleDebtMeta: {
    margin: "4px 0 0",
    color: "#64748b",
    fontSize: "12px",
  },

  saleDebtValues: {
    display: "flex",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "8px 14px",
    color: "#475569",
    fontSize: "12px",
  },

  overdueBadge: {
    padding: "4px 8px",
    borderRadius: "999px",
    background: "#fee2e2",
    color: "#dc2626",
    fontSize: "11px",
    fontWeight: "800",
  },

  smallLabel: {
    display: "block",
    color: "#64748b",
    fontSize: "11px",
  },

  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "7px",
    marginTop: "5px",
  },

  receiveButton: {
    border: 0,
    borderRadius: "8px",
    padding: "8px 10px",
    background: "#16a34a",
    color: "#ffffff",
    fontWeight: "700",
    cursor: "pointer",
  },

  whatsAppButton: {
    border: 0,
    borderRadius: "8px",
    padding: "8px 10px",
    background: "#22c55e",
    color: "#ffffff",
    fontWeight: "700",
    cursor: "pointer",
  },

  receiptButton: {
    border: 0,
    borderRadius: "8px",
    padding: "8px 10px",
    background: "#7c3aed",
    color: "#ffffff",
    fontWeight: "700",
    cursor: "pointer",
  },

  historyList: {
    display: "grid",
    gap: "10px",
  },

  historyItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "14px",
    padding: "14px",
    borderRadius: "13px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  historyLeft: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },

  historyIcon: {
    width: "42px",
    height: "42px",
    display: "grid",
    placeItems: "center",
    borderRadius: "11px",
    fontSize: "21px",
  },

  historyTitle: {
    margin: "0 0 5px",
    fontSize: "16px",
  },

  historyDescription: {
    margin: 0,
    color: "#64748b",
    fontSize: "12px",
  },

  historyRight: {
    display: "grid",
    justifyItems: "end",
    gap: "5px",
  },

  historyReceived: {
    color: "#64748b",
    fontSize: "11px",
  },

  deleteButton: {
    border: 0,
    borderRadius: "7px",
    padding: "6px 9px",
    background: "#fee2e2",
    color: "#dc2626",
    fontWeight: "700",
    cursor: "pointer",
  },

  editButton: {
    border: 0,
    borderRadius: "7px",
    padding: "6px 9px",
    background: "#dbeafe",
    color: "#1d4ed8",
    fontWeight: "700",
    cursor: "pointer",
  },

  expenseActions: {
    display: "flex",
    gap: "7px",
  },
};