import { useEffect, useMemo, useRef, useState } from "react";
import { LuBot } from "react-icons/lu";
import PageHeader from "../components/PageHeader.jsx";
import FinancialValue from "../components/FinancialValue.jsx";
import TripPeriodFilter from "../components/TripPeriodFilter.jsx";
import useTripScope from "../hooks/useTripScope.js";
import useClientTrips from "../hooks/useClientTrips.js";
import { filterRecordsByTrip, getTripSelectionLabel } from "../domain/tripIdentity.js";
import { calculateTripFinancialSummary } from "../domain/sales.js";
import { buildCollectionsReport } from "../domain/secretaryCollections.js";
import { maskFinancialText, useFinancialPrivacy } from "../context/financialPrivacy.js";
import { onAuthStateChanged, signInWithEmailAndPassword } from "firebase/auth";
import { collection, doc, onSnapshot, serverTimestamp } from "firebase/firestore";

import { auth, db } from "../firebase/config";
import { addDoc, runTransaction } from "../firebase/firestoreAccess";
import { isFirestoreReadOnly } from "../firebase/writePolicy";
import AdminOperationCard from "../components/AdminOperationCard.jsx";
import {
  cancelDraft,
  chooseDraftProduct,
  chooseDraftTrip,
  continueAdminDraft,
  finishDraft,
  isDraftActive,
  markDraftConfirming,
  revalidateDraft,
  startAdminCommand,
} from "../domain/adminCommands";
import { AdminOperationError, executeAdminOperation } from "../services/adminOperationsService";
import { getSaleDate } from "../domain/saleTrip.js";
import { isPersonalWithdrawal } from "../domain/expenses.js";
import { askSecretaryAi } from "../services/secretaryAi";
import { useSpeechRecognition, useSpeechSynthesis } from "../hooks/useSecretaryVoice";
import {
  answerSecretaryQueryWithContext,
  createSecretarySnapshot,
} from "../domain/secretary";
import "./SecretaryPage.css";

const quickSuggestions = [
  { label: "Resumo de hoje", prompt: "Resumo de hoje", icon: "☀️" },
  { label: "Quem devo cobrar?", prompt: "Quem devo cobrar?", icon: "💬" },
  { label: "Quanto recebi?", prompt: "Quanto recebi?", icon: "💸" },
  { label: "Minhas vendas", prompt: "Minhas vendas", icon: "🧾" },
  { label: "Estoque", prompt: "Estoque", icon: "📦" },
];
const legacyPanelsEnabled = false;

const currencyFormat = (value) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

function CollectionsCards({ collections }) {
  const { report, focusToday, tripLabel, provisional } = collections;
  const sections = [
    { key: "overdue", title: "Vencidas", tone: "overdue", group: report.overdue },
    { key: "today", title: "Vencem hoje", tone: "today", group: report.today },
    {
      key: "upcoming",
      title: focusToday ? "Próximas a vencer (não são para hoje)" : "Próximas a vencer",
      tone: "upcoming",
      group: report.upcoming,
    },
    {
      key: "noDueDate",
      title: "Vencimento não informado",
      tone: "nodate",
      group: report.noDueDate,
    },
  ];

  return (
    <div className="secretary-collections">
      <p className="secretary-collections-scope">
        <strong>Cobranças — {tripLabel}</strong>
        {provisional && (
          <span> A classificação por viagem ainda é provisória.</span>
        )}
      </p>
      {sections.map(({ key, title, tone, group }) => {
        if (key === "noDueDate" && !group.count) return null;
        return (
          <section
            key={key}
            className={`secretary-collections-group secretary-collections-${tone}`}
          >
            <header>
              <h3>{title}</h3>
              <span>
                {group.count} cobrança(s) · <FinancialValue>{currencyFormat(group.total)}</FinancialValue>
              </span>
            </header>
            {group.count === 0 ? (
              <p className="secretary-collections-empty">Nenhuma cobrança neste grupo.</p>
            ) : (
              <ul>
                {group.items.map((item, index) => (
                  <li key={`${item.saleId || "legacy"}-${index}`}>
                    <div className="secretary-collections-main">
                      <strong>{item.clientName}</strong>
                      <span>{item.city}</span>
                    </div>
                    <div className="secretary-collections-amount">
                      <FinancialValue>{currencyFormat(item.pending)}</FinancialValue>
                    </div>
                    <div className="secretary-collections-due">
                      <span>
                        {item.dueDate
                          ? `${item.dueNote ? "Vencimento previsto" : "Vencimento"}: ${item.dueLabel}`
                          : item.dueLabel}
                        {item.legacy ? " · saldo anterior" : ""}
                      </span>
                      {item.dueNote && (
                        <i className="secretary-collections-estimate">
                          {item.dueNote}
                        </i>
                      )}
                      {item.daysLate > 0 && (
                        <b>{item.daysLate} dia(s) de atraso</b>
                      )}
                      {key === "today" && <b>vence hoje</b>}
                      {key === "upcoming" && (
                        <em>em {item.daysUntil} dia(s)</em>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

export default function IntelligencePage() {
  const { hidden: financialValuesHidden } = useFinancialPrivacy();
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [payables, setPayables] = useState([]);
  const [paymentsBySale, setPaymentsBySale] = useState({});
  const [legacyPaymentsByClient, setLegacyPaymentsByClient] = useState({});
  const [dataReady, setDataReady] = useState(false);
  const [authStatus, setAuthStatus] = useState("loading");
  const [dataError, setDataError] = useState("");
  const [dataLoadFailed, setDataLoadFailed] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: "welcome",
      role: "assistant",
      text: "Bom dia! Sou a Secretária RC. Posso consultar os dados do seu usuário para ajudar com vendas, recebimentos, cobranças, despesas, estoque, viagens e contas a pagar de fornecedores.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [adminDrafts, setAdminDrafts] = useState({});
  const activeDraftId = useRef(null);
  const messageId = useRef(0);
  const messagesEndRef = useRef(null);
  const tripContext = useRef(null);
  const { trips, loading: loadingTrips } = useClientTrips(auth.currentUser?.uid || "");
  const monthlyGoal = 30000;
  const recognition = useSpeechRecognition({ onTranscript: setDraft });
  const synthesis = useSpeechSynthesis();
  const voiceError = recognition.error || synthesis.error;

  function toggleListening() {
    if (recognition.status === "listening") {
      recognition.stop();
      return;
    }
    if (recognition.status === "processing") return;
    synthesis.stop();
    recognition.start();
  }

  useEffect(() => {
    let unsubscribeClients = null;
    let unsubscribeProducts = null;
    let unsubscribeSales = null;
    let unsubscribeExpenses = null;
    let unsubscribeSuppliers = null;
    let unsubscribePayables = null;
    let authGeneration = 0;
    const salePaymentListeners = new Map();
    const clientPaymentListeners = new Map();
    const readyCoreCollections = new Set();

    const markCoreReady = (collectionName) => {
      readyCoreCollections.add(collectionName);
      if (readyCoreCollections.size === 6) setDataReady(true);
    };

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      const generation = ++authGeneration;
      if (unsubscribeClients) unsubscribeClients();
      if (unsubscribeProducts) unsubscribeProducts();
      if (unsubscribeSales) unsubscribeSales();
      if (unsubscribeExpenses) unsubscribeExpenses();
      if (unsubscribeSuppliers) unsubscribeSuppliers();
      if (unsubscribePayables) unsubscribePayables();
      for (const unsubscribe of salePaymentListeners.values()) unsubscribe();
      for (const unsubscribe of clientPaymentListeners.values()) unsubscribe();
      salePaymentListeners.clear();
      clientPaymentListeners.clear();
      readyCoreCollections.clear();

      setClients([]);
      setProducts([]);
      setSales([]);
      setExpenses([]);
      setSuppliers([]);
      setPayables([]);
      setPaymentsBySale({});
      setLegacyPaymentsByClient({});
      setDataReady(false);
      setDataLoadFailed(false);
      setDataError("");
      tripContext.current = null;
      setMessages([
        {
          id: "welcome",
          role: "assistant",
          text: "Bom dia! Sou a Secretária RC. Posso consultar os dados do seu usuário para ajudar com vendas, recebimentos, cobranças, despesas, estoque, viagens e contas a pagar de fornecedores.",
        },
      ]);

      if (!user) {
        setAuthStatus("signed-out");
        return;
      }

      setAuthStatus("signed-in");
      unsubscribeClients = onSnapshot(
        collection(db, "users", user.uid, "clients"),
        (snapshot) => {
          if (generation !== authGeneration) return;
          const documents = snapshot.docs;
          const clientIds = new Set(documents.map((document) => document.id));

          for (const [clientId, unsubscribe] of clientPaymentListeners) {
            if (clientIds.has(clientId)) continue;
            unsubscribe();
            clientPaymentListeners.delete(clientId);
            setLegacyPaymentsByClient((current) => {
              const next = { ...current };
              delete next[clientId];
              return next;
            });
          }

          for (const document of documents) {
            if (clientPaymentListeners.has(document.id)) continue;

            clientPaymentListeners.set(
              document.id,
              onSnapshot(
                collection(
                  db,
                  "users",
                  user.uid,
                  "clients",
                  document.id,
                  "payments"
                ),
                (paymentSnapshot) => {
                  if (generation !== authGeneration) return;
                  setLegacyPaymentsByClient((current) => ({
                    ...current,
                    [document.id]: paymentSnapshot.docs.map((payment) => ({
                      id: payment.id,
                      ...payment.data(),
                    })),
                  }));
                },
                (error) => {
                  if (generation !== authGeneration) return;
                  console.error("Erro ao carregar recebimentos antigos:", error);
                  setDataError((current) =>
                    current ||
                    "Não foi possível carregar todo o histórico de recebimentos."
                  );
                }
              )
            );
          }

          setClients(
            documents.map((document) => ({
              id: document.id,
              ...document.data(),
            }))
          );
          markCoreReady("clients");
        },
        (error) => {
          if (generation !== authGeneration) return;
          console.error("Erro ao carregar clientes:", error);
          setDataLoadFailed(true);
          setDataError((current) => current || "Não foi possível carregar os clientes.");
          markCoreReady("clients");
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
          markCoreReady("products");
        },
        (error) => {
          if (generation !== authGeneration) return;
          console.error("Erro ao carregar produtos:", error);
          setDataLoadFailed(true);
          setDataError((current) => current || "Não foi possível carregar os produtos.");
          markCoreReady("products");
        }
      );

      unsubscribeSales = onSnapshot(
        collection(db, "users", user.uid, "sales"),
        (snapshot) => {
          if (generation !== authGeneration) return;
          const documents = snapshot.docs;
          const saleIds = new Set(documents.map((document) => document.id));

          for (const [saleId, unsubscribe] of salePaymentListeners) {
            if (saleIds.has(saleId)) continue;
            unsubscribe();
            salePaymentListeners.delete(saleId);
            setPaymentsBySale((current) => {
              const next = { ...current };
              delete next[saleId];
              return next;
            });
          }

          for (const document of documents) {
            if (salePaymentListeners.has(document.id)) continue;

            salePaymentListeners.set(
              document.id,
              onSnapshot(
                collection(
                  db,
                  "users",
                  user.uid,
                  "sales",
                  document.id,
                  "payments"
                ),
                (paymentSnapshot) => {
                  if (generation !== authGeneration) return;
                  setPaymentsBySale((current) => ({
                    ...current,
                    [document.id]: paymentSnapshot.docs.map((payment) => ({
                      id: payment.id,
                      saleId: document.id,
                      ...payment.data(),
                    })),
                  }));
                },
                (error) => {
                  if (generation !== authGeneration) return;
                  console.error("Erro ao carregar recebimentos:", error);
                  setDataError((current) =>
                    current ||
                    "Não foi possível carregar todo o histórico de recebimentos."
                  );
                }
              )
            );
          }

          const list = documents.map((document) => ({
            id: document.id,
            ...document.data(),
          }));

          list.sort((first, second) => {
            const firstDate =
              getSaleDate(first)?.getTime() ||
              0;
            const secondDate =
              getSaleDate(second)?.getTime() ||
              0;
            return secondDate - firstDate;
          });

          setSales(list);
          markCoreReady("sales");
        },
        (error) => {
          if (generation !== authGeneration) return;
          console.error("Erro ao carregar vendas:", error);
          setDataLoadFailed(true);
          setDataError((current) => current || "Não foi possível carregar as vendas.");
          markCoreReady("sales");
        }
      );

      unsubscribeExpenses = onSnapshot(
        collection(db, "users", user.uid, "expenses"),
        (snapshot) => {
          if (generation !== authGeneration) return;
          setExpenses(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...document.data(),
            }))
          );
          markCoreReady("expenses");
        },
        (error) => {
          if (generation !== authGeneration) return;
          console.error("Erro ao carregar despesas:", error);
          setDataLoadFailed(true);
          setDataError((current) => current || "Não foi possível carregar as despesas.");
          markCoreReady("expenses");
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
          markCoreReady("suppliers");
        },
        (error) => {
          if (generation !== authGeneration) return;
          console.error("Erro ao carregar fornecedores para a Secretária:", error);
          setDataError((current) => current || "Não foi possível carregar os fornecedores.");
          setDataLoadFailed(true);
          markCoreReady("suppliers");
        }
      );

      unsubscribePayables = onSnapshot(
        collection(db, "users", user.uid, "payables"),
        (snapshot) => {
          if (generation !== authGeneration) return;
          setPayables(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...document.data(),
            }))
          );
          markCoreReady("payables");
        },
        (error) => {
          if (generation !== authGeneration) return;
          console.error("Erro ao carregar contas a pagar para a Secretária:", error);
          setDataError((current) => current || "Não foi possível carregar as contas a pagar.");
          setDataLoadFailed(true);
          markCoreReady("payables");
        }
      );
    }, (error) => {
      console.error("Erro ao verificar a sessão da Secretária RC:", error);
      setAuthStatus("error");
      setDataError("Não foi possível confirmar sua sessão. Entre novamente no RC Manager.");
    });

    return () => {
      authGeneration += 1;
      unsubscribeAuth();

      if (unsubscribeClients) unsubscribeClients();
      if (unsubscribeProducts) unsubscribeProducts();
      if (unsubscribeSales) unsubscribeSales();
      if (unsubscribeExpenses) unsubscribeExpenses();
      if (unsubscribeSuppliers) unsubscribeSuppliers();
      if (unsubscribePayables) unsubscribePayables();
      for (const unsubscribe of salePaymentListeners.values()) unsubscribe();
      for (const unsubscribe of clientPaymentListeners.values()) unsubscribe();
    };
  }, []);

  const clientMap = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients]
  );

  const productMap = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products]
  );

  const secretarySnapshot = useMemo(
    () =>
      createSecretarySnapshot({
        clients,
        sales,
        products,
        expenses,
        suppliers,
        payables,
        trips,
        payments: Object.values(paymentsBySale).flat(),
        legacyPayments: Object.values(legacyPaymentsByClient).flat(),
      }),
    [
      clients,
      sales,
      products,
      expenses,
      suppliers,
      payables,
      trips,
      paymentsBySale,
      legacyPaymentsByClient,
    ]
  );
  const secretaryLoading =
    authStatus === "loading" ||
    (authStatus === "signed-in" && !dataReady);
  const tripScope = useTripScope("secretary", secretarySnapshot.tripOptions);
  const periodSales = useMemo(() => filterRecordsByTrip(sales, tripScope.selection, tripScope.filterOptions),
    [sales, tripScope.selection, tripScope.filterOptions]);
  const periodSummary = useMemo(() => calculateTripFinancialSummary(
    periodSales,
    filterRecordsByTrip(expenses, tripScope.selection, tripScope.filterOptions),
    products,
    filterRecordsByTrip(payables, tripScope.selection, tripScope.filterOptions)
  ), [periodSales, expenses, products, payables, tripScope.selection, tripScope.filterOptions]);
  const periodCollections = useMemo(() => buildCollectionsReport({ clients, sales: periodSales }),
    [clients, periodSales]);
  const secretaryCanQuery =
    authStatus === "signed-in" && dataReady && !dataLoadFailed;
  const loading = !dataReady;

  async function handleSecretaryLogin(event) {
    event.preventDefault();
    setLoginError("");

    if (!loginEmail.trim() || !loginPassword) {
      setLoginError("Informe o e-mail e a senha da sua conta RC Manager.");
      return;
    }

    try {
      setLoginSubmitting(true);
      await signInWithEmailAndPassword(
        auth,
        loginEmail.trim(),
        loginPassword
      );
      setLoginPassword("");
    } catch (error) {
      console.error("Erro ao autenticar na Secretária RC:", error);
      const messages = {
        "auth/invalid-email": "O formato do e-mail é inválido.",
        "auth/invalid-credential": "E-mail ou senha incorretos.",
        "auth/user-not-found": "Não foi encontrada uma conta com esse e-mail.",
        "auth/wrong-password": "E-mail ou senha incorretos.",
        "auth/too-many-requests":
          "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
        "auth/network-request-failed":
          "Falha de conexão com o Firebase Authentication. Verifique a rede e tente novamente.",
        "auth/operation-not-allowed":
          "O login por e-mail e senha não está habilitado no Firebase Authentication deste projeto.",
      };

      if (error?.code === "auth/unauthorized-domain") {
        setLoginError(
          `O Firebase não autorizou o domínio ${window.location.hostname}. No Firebase Console, abra Authentication > Settings > Authorized domains e adicione esse domínio.`
        );
      } else {
        setLoginError(
          messages[error?.code] ||
            "Não foi possível entrar. Confira os dados e tente novamente."
        );
      }
    } finally {
      setLoginSubmitting(false);
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [messages]);

  function updateAdminDraft(id, updater, replyText) {
    setAdminDrafts((current) => {
      const existing = current[id];
      if (!existing) return current;
      return { ...current, [id]: updater(existing) };
    });
    if (replyText) {
      setMessages((current) => [
        ...current,
        { id: `message-${++messageId.current}`, role: "assistant", text: replyText, adminDraftId: id },
      ]);
    }
  }

  function handleChooseProduct(id, productId) {
    const current = adminDrafts[id];
    if (!current) return;
    const step = chooseDraftProduct(current, productId, { products, trips, now: new Date(), readOnly: isFirestoreReadOnly() });
    updateAdminDraft(id, () => step.draft, step.reply);
  }

  function handleChooseTrip(id, trip) {
    const current = adminDrafts[id];
    if (!current) return;
    const step = chooseDraftTrip(current, trip, { products, trips, now: new Date(), readOnly: isFirestoreReadOnly() });
    updateAdminDraft(id, () => step.draft, step.reply);
  }

  function handleCancelDraft(id) {
    updateAdminDraft(id, cancelDraft, "Operação cancelada. Nada foi gravado.");
  }

  async function handleConfirmDraft(id, event) {
    const current = adminDrafts[id];
    if (!current) return;
    const readOnly = isFirestoreReadOnly();
    let confirming;
    try {
      const fresh = revalidateDraft(current, { products, trips, now: new Date(), readOnly });
      confirming = markDraftConfirming(fresh, { trusted: event?.isTrusted === true });
    } catch (error) {
      updateAdminDraft(id, (draftValue) => ({
        ...draftValue,
        result: { ok: false, message: error.message },
      }));
      return;
    }
    setAdminDrafts((all) => ({ ...all, [id]: confirming }));
    let result;
    try {
      result = await executeAdminOperation(confirming, {
        user: auth.currentUser,
        readOnly,
        products,
        api: { db, collection, doc, serverTimestamp, addDoc, runTransaction },
      });
    } catch (error) {
      result = {
        ok: false,
        message:
          error instanceof AdminOperationError
            ? error.message
            : "Não foi possível concluir a operação. Nada foi gravado.",
      };
    }
    const finished = finishDraft(confirming, result);
    setAdminDrafts((all) => ({ ...all, [id]: finished }));
    setMessages((all) => [
      ...all,
      { id: `message-${++messageId.current}`, role: "assistant", text: result.message },
    ]);
  }

  async function sendMessage(text = draft) {
    const question = text.trim();
    if (!question || !secretaryCanQuery || isAsking) return;

    if (recognition.status !== "idle") recognition.stop();
    synthesis.stop();

    const adminContext = () => ({ products, trips, now: new Date(), readOnly: isFirestoreReadOnly() });
    const previousDraft = activeDraftId.current ? adminDrafts[activeDraftId.current] : null;
    let adminStep = startAdminCommand(question, adminContext());
    if (adminStep && previousDraft && isDraftActive(previousDraft)) {
      setAdminDrafts((current) => ({
        ...current,
        [previousDraft.id]: cancelDraft(current[previousDraft.id]),
      }));
    }
    if (!adminStep && previousDraft && isDraftActive(previousDraft)) {
      adminStep = continueAdminDraft(previousDraft, question, adminContext());
    }
    if (adminStep) {
      activeDraftId.current = adminStep.draft.id;
      setDraft("");
      setAdminDrafts((current) => ({ ...current, [adminStep.draft.id]: adminStep.draft }));
      setMessages((current) => [
        ...current,
        { id: `message-${++messageId.current}`, role: "user", text: question },
        {
          id: `message-${++messageId.current}`,
          role: "assistant",
          text: adminStep.reply,
          adminDraftId: adminStep.draft.id,
        },
      ]);
      return;
    }

    const userMessageId = `message-${++messageId.current}`;
    const assistantMessageId = `message-${++messageId.current}`;
    const history = messages
      .filter((message) => message.id !== "welcome" && message.text && !message.pending)
      .slice(-6)
      .map((message) => ({ role: message.role, content: message.text }));

    setDraft("");
    setIsAsking(true);
    setMessages((current) => [
      ...current,
      { id: userMessageId, role: "user", text: question },
      {
        id: assistantMessageId,
        role: "assistant",
        text: "Consultando seus dados...",
        pending: true,
      },
    ]);

    let reply;
    try {
      const ai = await askSecretaryAi(question, history);
      reply = {
        text: ai.answer,
        collections: ai.collections || null,
        ai: true,
      };
    } catch (error) {
      if (error?.fallback) {
        const response = answerSecretaryQueryWithContext(
          question,
          secretarySnapshot,
          intelligence,
          tripContext.current
        );
        tripContext.current = response.tripContext;
        reply = {
          text: response.answer,
          collections: response.collections || null,
        };
      } else {
        reply = {
          text: error?.message || "Não foi possível consultar a IA agora.",
          collections: null,
        };
      }
    }

    setMessages((current) =>
      current.map((message) =>
        message.id === assistantMessageId
          ? { id: assistantMessageId, role: "assistant", ...reply }
          : message
      )
    );
    setIsAsking(false);
  }

  const intelligence = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      1
    );

    const last30DaysStart = new Date(now);
    last30DaysStart.setDate(now.getDate() - 30);

    let monthSales = 0;
    let monthReceived = 0;
    let monthEstimatedCost = 0;
    let totalPending = 0;
    let monthSalesCount = 0;

    const clientStats = new Map();
    const productStats = new Map();
    const cityStats = new Map();

    for (const sale of sales) {
      const saleDate = getSaleDate(sale);
      const isThisMonth =
        saleDate &&
        saleDate >= monthStart &&
        saleDate < nextMonthStart;

      const client = clientMap.get(sale.clientId);
      const city =
        sale.tripCity || client?.city || "Cidade não informada";
      const total = Number(sale.total || 0);
      const received = Number(sale.amountPaid || 0);
      const pending = Number(sale.pendingAmount || 0);

      totalPending += pending;

      if (isThisMonth) {
        monthSales += total;
        monthReceived += received;
        monthSalesCount += 1;
      }

      const currentClient = clientStats.get(sale.clientId) || {
        clientId: sale.clientId,
        name: sale.clientName || client?.name || "Cliente",
        city,
        phone: client?.phone || "",
        totalBought: 0,
        totalPending: 0,
        purchaseCount: 0,
        lastPurchaseDate: null,
      };

      currentClient.totalBought += total;
      currentClient.totalPending += pending;
      currentClient.purchaseCount += 1;

      if (
        saleDate &&
        (!currentClient.lastPurchaseDate ||
          saleDate > currentClient.lastPurchaseDate)
      ) {
        currentClient.lastPurchaseDate = saleDate;
      }

      clientStats.set(sale.clientId, currentClient);

      const currentCity = cityStats.get(city) || {
        city,
        totalSales: 0,
        totalReceived: 0,
        salesCount: 0,
      };

      currentCity.totalSales += total;
      currentCity.totalReceived += received;
      currentCity.salesCount += 1;
      cityStats.set(city, currentCity);

      for (const item of sale.items || []) {
        const product = productMap.get(item.productId);
        const quantity = Number(item.quantity || 0);
        const subtotal = Number(item.subtotal || 0);
        const costPrice = Number(product?.costPrice || 0);

        if (isThisMonth) {
          monthEstimatedCost += quantity * costPrice;
        }

        const currentProduct = productStats.get(item.productId) || {
          productId: item.productId,
          name: item.name || product?.name || "Produto",
          quantitySold: 0,
          revenue: 0,
          stock: Number(product?.quantity || 0),
          salePrice: Number(product?.salePrice || 0),
          costPrice,
        };

        currentProduct.quantitySold += quantity;
        currentProduct.revenue += subtotal;
        currentProduct.stock = Number(product?.quantity || 0);
        productStats.set(item.productId, currentProduct);
      }
    }

    const monthExpenseTotals = expenses.reduce((totals, expense) => {
      const expenseDate =
        expense.expenseDate?.toDate?.() ||
        expense.createdAt?.toDate?.();

      if (
        expenseDate &&
        expenseDate >= monthStart &&
        expenseDate < nextMonthStart
      ) {
        const key = isPersonalWithdrawal(expense) ? "personal" : "operational";
        totals[key] += Number(expense.value || 0);
      }

      return totals;
    }, { operational: 0, personal: 0 });
    const monthExpenses = monthExpenseTotals.operational;
    const monthPersonalWithdrawals = monthExpenseTotals.personal;

    const grossProfit = monthSales - monthEstimatedCost;
    const netProfit = monthReceived - monthEstimatedCost - monthExpenses;
    const averageTicket =
      monthSalesCount > 0 ? monthSales / monthSalesCount : 0;

    const goalProgress =
      monthlyGoal > 0
        ? Math.min((monthSales / monthlyGoal) * 100, 100)
        : 0;

    const remainingGoal = Math.max(monthlyGoal - monthSales, 0);

    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0
    ).getDate();

    const remainingDays = Math.max(daysInMonth - now.getDate(), 1);
    const dailyGoalNeeded = remainingGoal / remainingDays;

    const bestClients = Array.from(clientStats.values()).sort(
      (first, second) => second.totalBought - first.totalBought
    );

    const debtorClients = Array.from(clientStats.values())
      .filter((client) => client.totalPending > 0)
      .sort((first, second) => second.totalPending - first.totalPending);

    const likelyToBuyAgain = Array.from(clientStats.values())
      .map((client) => {
        const daysSinceLastPurchase = client.lastPurchaseDate
          ? Math.floor(
              (now.getTime() - client.lastPurchaseDate.getTime()) /
                86400000
            )
          : 999;

        let score = 0;

        if (client.purchaseCount >= 3) score += 3;
        if (client.purchaseCount === 2) score += 2;
        if (client.totalBought >= 1000) score += 3;
        else if (client.totalBought >= 500) score += 2;
        else if (client.totalBought >= 200) score += 1;
        if (daysSinceLastPurchase >= 20 && daysSinceLastPurchase <= 90)
          score += 3;
        if (daysSinceLastPurchase < 20) score += 1;
        if (client.totalPending <= 0) score += 2;
        if (client.totalPending > 500) score -= 2;

        return {
          ...client,
          daysSinceLastPurchase,
          score,
        };
      })
      .filter((client) => client.score >= 4)
      .sort((first, second) => second.score - first.score);

    const bestProducts = Array.from(productStats.values()).sort(
      (first, second) => second.quantitySold - first.quantitySold
    );

    const lowStockProducts = products
      .filter((product) => Number(product.quantity || 0) <= 3)
      .map((product) => {
        const stats = productStats.get(product.id);
        const sold = Number(stats?.quantitySold || 0);

        return {
          id: product.id,
          name: product.name || "Produto",
          stock: Number(product.quantity || 0),
          sold,
          suggestedRestock: Math.max(sold * 2 - Number(product.quantity || 0), 5),
        };
      })
      .sort((first, second) => second.sold - first.sold);

    const slowProducts = products
      .map((product) => {
        const stats = productStats.get(product.id);

        return {
          id: product.id,
          name: product.name || "Produto",
          stock: Number(product.quantity || 0),
          quantitySold: Number(stats?.quantitySold || 0),
          stockValue:
            Number(product.quantity || 0) *
            Number(product.costPrice || 0),
        };
      })
      .filter(
        (product) =>
          product.stock > 0 &&
          product.quantitySold === 0
      )
      .sort((first, second) => second.stockValue - first.stockValue);

    const bestCities = Array.from(cityStats.values()).sort(
      (first, second) => second.totalSales - first.totalSales
    );

    const last30DaysSales = sales
      .filter((sale) => {
        const date = getSaleDate(sale);
        return date && date >= last30DaysStart;
      })
      .reduce((sum, sale) => sum + Number(sale.total || 0), 0);

    const averageDailySales = last30DaysSales / 30;
    const forecastMonth =
      monthSales + averageDailySales * remainingDays;

    const alerts = [];

    if (totalPending > 0) {
      alerts.push({
        id: "pending",
        title: "Cobranças pendentes",
        description: `${debtorClients.length} cliente(s) devem ${formatCurrency(
          totalPending
        )}.`,
        icon: "💵",
        level: "high",
      });
    }

    if (lowStockProducts.length > 0) {
      alerts.push({
        id: "stock",
        title: "Reposição necessária",
        description: `${lowStockProducts.length} produto(s) estão com estoque baixo.`,
        icon: "📦",
        level: "medium",
      });
    }

    if (slowProducts.length > 0) {
      alerts.push({
        id: "slow",
        title: "Produtos parados",
        description: `${slowProducts.length} produto(s) ainda não tiveram vendas registradas.`,
        icon: "🐢",
        level: "medium",
      });
    }

    if (remainingGoal > 0) {
      alerts.push({
        id: "goal",
        title: "Meta mensal",
        description: `Faltam ${formatCurrency(
          remainingGoal
        )} para alcançar a meta.`,
        icon: "🎯",
        level: "info",
      });
    }

    return {
      monthSales,
      monthReceived,
      monthEstimatedCost,
      monthExpenses,
      monthPersonalWithdrawals,
      grossProfit,
      netProfit,
      averageTicket,
      totalPending,
      monthSalesCount,
      goalProgress,
      remainingGoal,
      dailyGoalNeeded,
      forecastMonth,
      bestClients,
      debtorClients,
      likelyToBuyAgain,
      bestProducts,
      lowStockProducts,
      slowProducts,
      bestCities,
      alerts,
    };
  }, [
    sales,
    products,
    expenses,
    clientMap,
    productMap,
    monthlyGoal,
  ]);

  function formatCurrency(value) {
    return Number(value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }

  function getAlertStyle(level) {
    const stylesByLevel = {
      high: {
        color: "#dc2626",
        background: "#fee2e2",
        border: "#fecaca",
      },
      medium: {
        color: "#ca8a04",
        background: "#fef9c3",
        border: "#fde68a",
      },
      info: {
        color: "#2563eb",
        background: "#dbeafe",
        border: "#bfdbfe",
      },
    };

    return stylesByLevel[level] || stylesByLevel.info;
  }

  return (
    <div style={styles.page}>
      <PageHeader
        icon={LuBot}
        title="Secretária RC"
        description="Sua assistente de gestão para a rotina da RC Confecções."
      />
      {authStatus === "signed-in" && !secretaryLoading && (
        <section className="secretary-trip-pending">
          <h2>Resumo por viagem</h2>
          <TripPeriodFilter scope={tripScope} label="Resumo da Secretária RC" />
          <p>{periodSummary.salesCount} vendas · vendido <FinancialValue>{currencyFormat(periodSummary.sold)}</FinancialValue>
            {" "}· recebido <FinancialValue>{currencyFormat(periodSummary.received)}</FinancialValue>
            {" "}· pendente <FinancialValue>{currencyFormat(periodSummary.pending)}</FinancialValue></p>
          <p>Despesas operacionais <FinancialValue>{currencyFormat(periodSummary.expenses)}</FinancialValue>
            {" "}· retiradas <FinancialValue>{currencyFormat(periodSummary.personalWithdrawals)}</FinancialValue></p>
          <CollectionsCards collections={{ report: periodCollections, tripLabel: tripScope.label, focusToday: false, provisional: false }} />
          <p>Este filtro controla o resumo e as cobranças acima. No chat, informe o ano e a viagem na pergunta; o resumo matinal continua sendo de hoje.</p>
        </section>
      )}

      <section className="secretary-dashboard">
        <div className="secretary-morning-card">
          <div className="secretary-section-heading">
            <div>
              <p className="secretary-eyebrow">Seu começo de dia</p>
              <h2>Resumo matinal</h2>
            </div>
            <span className="secretary-today">
              {new Date().toLocaleDateString("pt-BR", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </span>
          </div>

          {secretaryLoading ? (
            <p className="secretary-muted">Consultando seus dados autorizados...</p>
          ) : authStatus !== "signed-in" ? (
            <p className="secretary-muted">
              Entre no RC Manager para consultar seus dados privados.
            </p>
          ) : (
            <>
              <div className="secretary-morning-metrics">
                <div>
                  <span>Vendas de hoje</span>
                  <strong>
                    {secretarySnapshot.salesToday.length} ·{" "}
                    <FinancialValue>{formatCurrency(secretarySnapshot.salesTodayTotal)}</FinancialValue>
                  </strong>
                </div>
                <div>
                  <span>Recebido hoje</span>
                  <strong><FinancialValue>{formatCurrency(secretarySnapshot.receivedToday)}</FinancialValue></strong>
                </div>
                <div>
                  <span>Despesas operacionais de hoje</span>
                  <strong><FinancialValue>{formatCurrency(secretarySnapshot.expensesTodayTotal)}</FinancialValue></strong>
                </div>
                <div>
                  <span>Retirada pessoal de hoje</span>
                  <strong><FinancialValue>{formatCurrency(secretarySnapshot.personalWithdrawalsTodayTotal)}</FinancialValue></strong>
                </div>
                <div>
                  <span>Total pendente</span>
                  <strong><FinancialValue>{formatCurrency(secretarySnapshot.totalPending)}</FinancialValue></strong>
                </div>
              </div>

              <div className="secretary-trip-pending" aria-label="Saldo pendente por viagem">
                <header>
                  <h3>Pendente por viagem</h3>
                  <span>classificação provisória</span>
                </header>
                <div className="secretary-trip-pending-grid">
                  {secretarySnapshot.tripOptions.map((scope) => {
                    const trip = secretarySnapshot.tripPending?.[scope.id];
                    return (
                      <div key={scope.id}>
                        <span>{getTripSelectionLabel(scope, secretarySnapshot.tripOptions)}</span>
                        <strong><FinancialValue>{formatCurrency(trip?.amount)}</FinancialValue></strong>
                        <small>{trip?.salesCount || 0} venda(s) em aberto</small>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="secretary-priorities">
                <h3>Prioridades e vencimentos</h3>
                {secretarySnapshot.overdueSales.length === 0 &&
                secretarySnapshot.dueSoonSales.length === 0 &&
                secretarySnapshot.lowStockProducts.length === 0 ? (
                  <p className="secretary-muted">
                    Nenhum vencimento próximo ou alerta de estoque baixo encontrado.
                  </p>
                ) : (
                  <ul>
                    {secretarySnapshot.overdueSales.slice(0, 3).map((sale) => (
                      <li key={`overdue-${sale.id}`} className="priority-overdue">
                        <span>🔴 Cobrança vencida · {sale.clientName}</span>
                        <strong>
                          <FinancialValue>{formatCurrency(sale.value)}</FinancialValue> ·{" "}
                          {sale.dueDate.toLocaleDateString("pt-BR")}
                        </strong>
                      </li>
                    ))}
                    {secretarySnapshot.dueSoonSales.slice(0, 3).map((sale) => (
                      <li key={`due-${sale.id}`}>
                        <span>📅 Vencimento próximo · {sale.clientName}</span>
                        <strong>
                          <FinancialValue>{formatCurrency(sale.value)}</FinancialValue> ·{" "}
                          {sale.dueDate.toLocaleDateString("pt-BR")}
                        </strong>
                      </li>
                    ))}
                    {secretarySnapshot.lowStockProducts.slice(0, 3).map((product) => (
                      <li key={`stock-${product.id}`}>
                        <span>📦 Estoque baixo · {product.name || "Produto"}</span>
                        <strong>{Number(product.quantity || 0)} unidade(s)</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        <div className="secretary-chat-card">
          <div className="secretary-section-heading">
            <div>
              <p className="secretary-eyebrow">Atendimento local e privado</p>
              <h2>Converse com a Secretária</h2>
            </div>
            <span className="secretary-readonly-badge">Somente consulta</span>
          </div>

          <div className="secretary-suggestions" aria-label="Sugestões rápidas">
            {quickSuggestions.map((suggestion) => (
              <button
                key={suggestion.prompt}
                type="button"
                className="secretary-suggestion"
                disabled={!secretaryCanQuery}
                onClick={() => sendMessage(suggestion.prompt)}
              >
                <span aria-hidden="true">{suggestion.icon}</span>
                {suggestion.label}
              </button>
            ))}
          </div>

          <div
            className="secretary-message-list"
            role="log"
            aria-live="polite"
            aria-label="Histórico da conversa"
          >
            {messages.map((message, index) => (
              <div
                key={message.id}
                className={`secretary-message secretary-message-${message.role}`}
              >
                <span className="secretary-message-avatar" aria-hidden="true">
                  {message.role === "assistant" ? "👩‍💼" : "Você"}
                </span>
                {message.collections && !message.ai ? (
                  <CollectionsCards collections={message.collections} />
                ) : (
                  <div className="secretary-message-body">
                    <p>{maskFinancialText(message.text, financialValuesHidden)}</p>
                    {message.collections && (
                      <CollectionsCards collections={message.collections} />
                    )}
                    {message.adminDraftId &&
                      adminDrafts[message.adminDraftId] &&
                      !messages
                        .slice(index + 1)
                        .some((later) => later.adminDraftId === message.adminDraftId) && (
                        <AdminOperationCard
                          trips={trips}
                          loadingTrips={loadingTrips}
                          draft={adminDrafts[message.adminDraftId]}
                          readOnly={isFirestoreReadOnly()}
                          onConfirm={(event) => handleConfirmDraft(message.adminDraftId, event)}
                          onCancel={() => handleCancelDraft(message.adminDraftId)}
                          onChooseProduct={(productId) => handleChooseProduct(message.adminDraftId, productId)}
                          onChooseTrip={(trip) => handleChooseTrip(message.adminDraftId, trip)}
                        />
                      )}
                  </div>
                )}
                {message.role === "assistant" &&
                  !message.pending &&
                  message.id !== "welcome" &&
                  message.text &&
                  synthesis.supported && (
                    <button
                      type="button"
                      className={`secretary-speak-button${
                        synthesis.speakingId === message.id ? " is-speaking" : ""
                      }`}
                      onClick={() =>
                        synthesis.speakingId === message.id
                          ? synthesis.stop()
                          : synthesis.speak(message.id, message.text)
                      }
                      aria-label={
                        synthesis.speakingId === message.id
                          ? "Parar a leitura da resposta"
                          : "Ouvir a resposta em voz alta"
                      }
                      title={
                        synthesis.speakingId === message.id
                          ? "Parar a leitura"
                          : "Ouvir a resposta"
                      }
                    >
                      <span aria-hidden="true">
                        {synthesis.speakingId === message.id ? "⏹" : "🔊"}
                      </span>
                    </button>
                  )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {dataError && (
            <p className="secretary-error" role="alert">
              {dataError}
              {!dataLoadFailed && " Alguns dados auxiliares podem estar incompletos."}
            </p>
          )}
          {authStatus === "signed-out" && (
            <form
              className="secretary-login-form"
              onSubmit={handleSecretaryLogin}
            >
              <p>Entre com sua conta existente do RC Manager para carregar seus dados.</p>
              <label>
                <span>E-mail</span>
                <input
                  type="email"
                  autoComplete="username"
                  value={loginEmail}
                  onChange={(event) => setLoginEmail(event.target.value)}
                  disabled={loginSubmitting}
                  required
                />
              </label>
              <label>
                <span>Senha</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  disabled={loginSubmitting}
                  required
                />
              </label>
              {loginError && (
                <p className="secretary-error" role="alert">
                  {loginError}
                </p>
              )}
              <button
                className="secretary-send-button"
                type="submit"
                disabled={loginSubmitting}
              >
                {loginSubmitting ? "Entrando..." : "Entrar"}
              </button>
            </form>
          )}

          <form
            className="secretary-composer"
            onSubmit={(event) => {
              event.preventDefault();
              sendMessage();
            }}
          >
            <label className="secretary-sr-only" htmlFor="secretary-question">
              Escreva uma pergunta para a Secretária RC
            </label>
            <input
              id="secretary-question"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={
                authStatus === "signed-out"
                  ? "Entre no RC Manager para continuar"
                  : authStatus === "error"
                    ? "Não foi possível confirmar sua sessão"
                    : secretaryLoading
                  ? "Aguarde a conexão segura com seus dados..."
                  : "Pergunte sobre cobranças, vendas, estoque..."
              }
              disabled={!secretaryCanQuery}
            />
            <button
              className={`secretary-mic-button secretary-mic-${recognition.status}`}
              type="button"
              onClick={toggleListening}
              disabled={!secretaryCanQuery || recognition.status === "processing"}
              aria-pressed={recognition.status === "listening"}
              aria-describedby="secretary-voice-help"
              aria-label={
                recognition.status === "listening"
                  ? "Parar de ouvir"
                  : "Falar a pergunta com o microfone"
              }
              title={
                recognition.status === "listening" ? "Parar de ouvir" : "Falar a pergunta"
              }
            >
              <span aria-hidden="true">
                {recognition.status === "listening" ? "⏹" : "🎙️"}
              </span>
            </button>
            <button
              className="secretary-send-button"
              type="submit"
              disabled={!secretaryCanQuery || isAsking || !draft.trim()}
            >
              Enviar
            </button>
          </form>

          <div className="secretary-voice-area">
            <p
              id="secretary-voice-help"
              className={`secretary-voice-status secretary-voice-status-${recognition.status}`}
              role="status"
              aria-live="polite"
            >
              {recognition.status === "listening"
                ? "Ouvindo… fale agora e toque no microfone para parar."
                : recognition.status === "processing"
                  ? "Processando sua fala…"
                  : recognition.supported
                    ? "Microfone desligado. Toque em 🎙️ para ditar; revise o texto antes de enviar."
                    : "Comando de voz indisponível neste navegador. Digite ou use o ditado do teclado."}
            </p>
            {voiceError && (
              <p className="secretary-error secretary-voice-error" role="alert">
                {voiceError}
              </p>
            )}
          </div>
          <p className="secretary-privacy-note">
            Consultas executadas no aplicativo com dados do seu usuário. Nenhum dado é enviado a uma IA externa. O áudio é tratado pelo navegador e nunca é gravado nem salvo pelo aplicativo.
          </p>
        </div>
      </section>

      {legacyPanelsEnabled && (
      <>
      <div className="secretary-analytics-heading">
        <p className="secretary-eyebrow">Ferramentas que você já conhece</p>
        <h2>Análises da Inteligência RC</h2>
        <p>
          Indicadores, tendências, clientes, produtos e resultados por cidade continuam disponíveis abaixo.
        </p>
      </div>

      {loading ? (
        <div style={styles.loadingBox}>
          <span style={styles.loadingIcon}>🧠</span>
          <strong>Analisando os dados...</strong>
        </div>
      ) : (
        <>
          <section style={styles.summaryGrid}>
            <div style={styles.summaryCard}>
              <span style={styles.summaryLabel}>Faturamento do mês</span>
              <strong style={styles.summaryValue}>
                <FinancialValue>{formatCurrency(intelligence.monthSales)}</FinancialValue>
              </strong>
            </div>

            <div style={styles.summaryCard}>
              <span style={styles.summaryLabel}>Recebido no mês</span>
              <strong style={styles.greenValue}>
                <FinancialValue>{formatCurrency(intelligence.monthReceived)}</FinancialValue>
              </strong>
            </div>

            <div style={styles.summaryCard}>
              <span style={styles.summaryLabel}>Lucro operacional estimado</span>
              <strong
                style={
                  intelligence.netProfit >= 0
                    ? styles.greenValue
                    : styles.redValue
                }
              >
                <FinancialValue>{formatCurrency(intelligence.netProfit)}</FinancialValue>
              </strong>
            </div>

            <div style={styles.summaryCard}>
              <span style={styles.summaryLabel}>Retirada pessoal no mês</span>
              <strong style={styles.summaryValue}>
                <FinancialValue>{formatCurrency(intelligence.monthPersonalWithdrawals)}</FinancialValue>
              </strong>
            </div>

            <div style={styles.summaryCard}>
              <span style={styles.summaryLabel}>Ticket médio</span>
              <strong style={styles.summaryValue}>
                <FinancialValue>{formatCurrency(intelligence.averageTicket)}</FinancialValue>
              </strong>
            </div>

            <div style={styles.summaryCard}>
              <span style={styles.summaryLabel}>Previsão do mês</span>
              <strong style={styles.blueValue}>
                <FinancialValue>{formatCurrency(intelligence.forecastMonth)}</FinancialValue>
              </strong>
            </div>

            <div style={styles.summaryCard}>
              <span style={styles.summaryLabel}>Pendente para receber</span>
              <strong style={styles.redValue}>
                <FinancialValue>{formatCurrency(intelligence.totalPending)}</FinancialValue>
              </strong>
            </div>
          </section>

          <section style={styles.goalCard}>
            <div style={styles.goalTop}>
              <div>
                <h2 style={styles.cardTitle}>Meta mensal</h2>
                <p style={styles.helperText}>
                  <FinancialValue>{formatCurrency(intelligence.monthSales)}</FinancialValue> de{" "}
                  <FinancialValue>{formatCurrency(monthlyGoal)}</FinancialValue>
                </p>
              </div>

              <strong style={styles.goalPercent}>
                {intelligence.goalProgress.toFixed(1)}%
              </strong>
            </div>

            <div style={styles.progressTrack}>
              <div
                style={{
                  ...styles.progressBar,
                  width: `${intelligence.goalProgress}%`,
                }}
              />
            </div>

            <div style={styles.goalDetails}>
              <span>
                Falta:{" "}
                <strong>
                  <FinancialValue>{formatCurrency(intelligence.remainingGoal)}</FinancialValue>
                </strong>
              </span>

              <span>
                Necessário por dia:{" "}
                <strong>
                  <FinancialValue>{formatCurrency(intelligence.dailyGoalNeeded)}</FinancialValue>
                </strong>
              </span>
            </div>
          </section>

          <section style={styles.alertGrid}>
            {intelligence.alerts.map((alert) => {
              const alertStyle = getAlertStyle(alert.level);

              return (
                <article
                  key={alert.id}
                  style={{
                    ...styles.alertCard,
                    background: alertStyle.background,
                    borderColor: alertStyle.border,
                  }}
                >
                  <span style={styles.alertIcon}>{alert.icon}</span>

                  <div>
                    <h3
                      style={{
                        ...styles.alertTitle,
                        color: alertStyle.color,
                      }}
                    >
                      {alert.title}
                    </h3>

                    <p style={styles.alertDescription}>
                      {alert.description}
                    </p>
                  </div>
                </article>
              );
            })}
          </section>

          <section style={styles.mainGrid}>
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>🏆 Modo Patrão</h2>
              <p style={styles.helperText}>
                Os melhores resultados da RC Confecções.
              </p>

              <div style={styles.bossList}>
                <div style={styles.bossItem}>
                  <span>Melhor cliente</span>
                  <strong>
                    {intelligence.bestClients[0]?.name || "Sem dados"}
                  </strong>
                </div>

                <div style={styles.bossItem}>
                  <span>Valor do melhor cliente</span>
                  <strong>
                    <FinancialValue>{formatCurrency(
                      intelligence.bestClients[0]?.totalBought
                    )}</FinancialValue>
                  </strong>
                </div>

                <div style={styles.bossItem}>
                  <span>Produto mais vendido</span>
                  <strong>
                    {intelligence.bestProducts[0]?.name || "Sem dados"}
                  </strong>
                </div>

                <div style={styles.bossItem}>
                  <span>Quantidade vendida</span>
                  <strong>
                    {intelligence.bestProducts[0]?.quantitySold || 0}
                  </strong>
                </div>

                <div style={styles.bossItem}>
                  <span>Melhor cidade</span>
                  <strong>
                    {intelligence.bestCities[0]?.city || "Sem dados"}
                  </strong>
                </div>

                <div style={styles.bossItem}>
                  <span>Vendas da melhor cidade</span>
                  <strong>
                    <FinancialValue>{formatCurrency(
                      intelligence.bestCities[0]?.totalSales
                    )}</FinancialValue>
                  </strong>
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <h2 style={styles.cardTitle}>
                💡 Clientes com chance de recompra
              </h2>

              <p style={styles.helperText}>
                Sugestão calculada pelo histórico de compras.
              </p>

              {intelligence.likelyToBuyAgain.length === 0 ? (
                <div style={styles.emptySmall}>
                  <strong>Dados insuficientes</strong>
                  <p>Cadastre mais vendas para gerar sugestões.</p>
                </div>
              ) : (
                <div style={styles.list}>
                  {intelligence.likelyToBuyAgain
                    .slice(0, 8)
                    .map((client) => (
                      <article
                        key={client.clientId}
                        style={styles.listItem}
                      >
                        <div>
                          <h3 style={styles.itemTitle}>{client.name}</h3>
                          <p style={styles.itemSubtitle}>
                            {client.city} • Última compra há{" "}
                            {client.daysSinceLastPurchase} dia(s)
                          </p>
                        </div>

                        <span style={styles.scoreBadge}>
                          Chance {client.score}/11
                        </span>
                      </article>
                    ))}
                </div>
              )}
            </div>
          </section>

          <section style={styles.mainGrid}>
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>💵 Prioridade de cobrança</h2>
              <p style={styles.helperText}>
                Clientes ordenados pelo maior saldo pendente.
              </p>

              {intelligence.debtorClients.length === 0 ? (
                <div style={styles.emptySmall}>
                  <strong>Nenhuma cobrança pendente</strong>
                </div>
              ) : (
                <div style={styles.list}>
                  {intelligence.debtorClients
                    .slice(0, 10)
                    .map((client, index) => (
                      <article
                        key={client.clientId}
                        style={styles.listItem}
                      >
                        <div style={styles.rankArea}>
                          <span style={styles.rankBadge}>
                            {index + 1}
                          </span>

                          <div>
                            <h3 style={styles.itemTitle}>
                              {client.name}
                            </h3>

                            <p style={styles.itemSubtitle}>
                              {client.city} •{" "}
                              {client.purchaseCount} compra(s)
                            </p>
                          </div>
                        </div>

                        <strong style={styles.redValue}>
                          <FinancialValue>{formatCurrency(client.totalPending)}</FinancialValue>
                        </strong>
                      </article>
                    ))}
                </div>
              )}
            </div>

            <div style={styles.card}>
              <h2 style={styles.cardTitle}>📦 Sugestão de reposição</h2>
              <p style={styles.helperText}>
                Produtos com estoque baixo e quantidade sugerida.
              </p>

              {intelligence.lowStockProducts.length === 0 ? (
                <div style={styles.emptySmall}>
                  <strong>Estoque em boa situação</strong>
                </div>
              ) : (
                <div style={styles.list}>
                  {intelligence.lowStockProducts
                    .slice(0, 10)
                    .map((product) => (
                      <article key={product.id} style={styles.listItem}>
                        <div>
                          <h3 style={styles.itemTitle}>
                            {product.name}
                          </h3>

                          <p style={styles.itemSubtitle}>
                            Estoque atual: {product.stock} • Vendidos:{" "}
                            {product.sold}
                          </p>
                        </div>

                        <span style={styles.restockBadge}>
                          Repor {product.suggestedRestock}
                        </span>
                      </article>
                    ))}
                </div>
              )}
            </div>
          </section>

          <section style={styles.mainGrid}>
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>🐢 Produtos parados</h2>
              <p style={styles.helperText}>
                Produtos com estoque, mas sem vendas registradas.
              </p>

              {intelligence.slowProducts.length === 0 ? (
                <div style={styles.emptySmall}>
                  <strong>Nenhum produto parado</strong>
                </div>
              ) : (
                <div style={styles.list}>
                  {intelligence.slowProducts
                    .slice(0, 10)
                    .map((product) => (
                      <article key={product.id} style={styles.listItem}>
                        <div>
                          <h3 style={styles.itemTitle}>
                            {product.name}
                          </h3>

                          <p style={styles.itemSubtitle}>
                            {product.stock} unidade(s) sem venda
                          </p>
                        </div>

                        <strong>
                          <FinancialValue>{formatCurrency(product.stockValue)}</FinancialValue>
                        </strong>
                      </article>
                    ))}
                </div>
              )}
            </div>

            <div style={styles.card}>
              <h2 style={styles.cardTitle}>🏙️ Ranking por cidade</h2>
              <p style={styles.helperText}>
                Cidades da viagem; em vendas antigas, usa a cidade cadastrada do cliente.
              </p>

              {intelligence.bestCities.length === 0 ? (
                <div style={styles.emptySmall}>
                  <strong>Sem vendas por cidade</strong>
                </div>
              ) : (
                <div style={styles.list}>
                  {intelligence.bestCities
                    .slice(0, 10)
                    .map((city, index) => (
                      <article key={city.city} style={styles.listItem}>
                        <div style={styles.rankArea}>
                          <span style={styles.rankBadge}>
                            {index + 1}
                          </span>

                          <div>
                            <h3 style={styles.itemTitle}>
                              {city.city}
                            </h3>

                            <p style={styles.itemSubtitle}>
                              {city.salesCount} venda(s)
                            </p>
                          </div>
                        </div>

                        <strong style={styles.blueValue}>
                          <FinancialValue>{formatCurrency(city.totalSales)}</FinancialValue>
                        </strong>
                      </article>
                    ))}
                </div>
              )}
            </div>
          </section>
        </>
      )}
      </>
      )}
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
    color: "#7c3aed",
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

  goalControl: {
    display: "grid",
    gap: "6px",
    color: "#334155",
    fontSize: "13px",
    fontWeight: "700",
  },

  goalInput: {
    width: "170px",
    padding: "11px 12px",
    borderRadius: "10px",
    border: "1px solid #cbd5e1",
    fontSize: "15px",
  },

  loadingBox: {
    minHeight: "420px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    color: "#64748b",
  },

  loadingIcon: {
    marginBottom: "12px",
    fontSize: "48px",
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "14px",
    marginBottom: "22px",
  },

  summaryCard: {
    padding: "18px",
    borderRadius: "16px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 8px 20px rgba(15, 23, 42, 0.06)",
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

  greenValue: {
    color: "#16a34a",
    fontSize: "18px",
  },

  redValue: {
    color: "#dc2626",
    fontSize: "18px",
  },

  blueValue: {
    color: "#2563eb",
    fontSize: "18px",
  },

  goalCard: {
    marginBottom: "22px",
    padding: "22px",
    borderRadius: "18px",
    background: "#ffffff",
    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
  },

  goalTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "15px",
  },

  cardTitle: {
    margin: "0 0 7px",
    fontSize: "21px",
  },

  helperText: {
    margin: 0,
    color: "#64748b",
    fontSize: "14px",
  },

  goalPercent: {
    color: "#7c3aed",
    fontSize: "22px",
  },

  progressTrack: {
    height: "14px",
    margin: "18px 0 12px",
    overflow: "hidden",
    borderRadius: "999px",
    background: "#e2e8f0",
  },

  progressBar: {
    height: "100%",
    borderRadius: "999px",
    background:
      "linear-gradient(90deg, #7c3aed 0%, #2563eb 100%)",
    transition: "width 0.4s ease",
  },

  goalDetails: {
    display: "flex",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "12px",
    color: "#475569",
    fontSize: "13px",
  },

  alertGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "14px",
    marginBottom: "22px",
  },

  alertCard: {
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
    padding: "16px",
    borderRadius: "14px",
    border: "1px solid",
  },

  alertIcon: {
    fontSize: "25px",
  },

  alertTitle: {
    margin: "0 0 5px",
    fontSize: "15px",
  },

  alertDescription: {
    margin: 0,
    color: "#475569",
    fontSize: "13px",
    lineHeight: 1.4,
  },

  mainGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(340px, 1fr))",
    gap: "22px",
    marginBottom: "22px",
  },

  card: {
    padding: "22px",
    borderRadius: "18px",
    background: "#ffffff",
    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
  },

  bossList: {
    display: "grid",
    gap: "0",
    marginTop: "17px",
  },

  bossItem: {
    display: "flex",
    justifyContent: "space-between",
    gap: "15px",
    padding: "14px 0",
    borderBottom: "1px solid #e2e8f0",
    color: "#475569",
  },

  emptySmall: {
    minHeight: "180px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    color: "#64748b",
  },

  list: {
    display: "grid",
    gap: "10px",
    marginTop: "17px",
  },

  listItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "14px",
    padding: "14px",
    borderRadius: "12px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  itemTitle: {
    margin: "0 0 5px",
    fontSize: "15px",
  },

  itemSubtitle: {
    margin: 0,
    color: "#64748b",
    fontSize: "12px",
  },

  scoreBadge: {
    padding: "6px 9px",
    borderRadius: "999px",
    background: "#ede9fe",
    color: "#7c3aed",
    fontSize: "11px",
    fontWeight: "800",
    whiteSpace: "nowrap",
  },

  restockBadge: {
    padding: "6px 9px",
    borderRadius: "999px",
    background: "#fef9c3",
    color: "#ca8a04",
    fontSize: "11px",
    fontWeight: "800",
    whiteSpace: "nowrap",
  },

  rankArea: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },

  rankBadge: {
    width: "28px",
    height: "28px",
    display: "grid",
    placeItems: "center",
    borderRadius: "50%",
    background: "#dbeafe",
    color: "#2563eb",
    fontSize: "12px",
    fontWeight: "800",
  },
};