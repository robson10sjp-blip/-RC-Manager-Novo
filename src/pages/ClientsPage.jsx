import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import PageHeader from "../components/PageHeader.jsx";
import { onAuthStateChanged } from "firebase/auth";
import {
  getDocs,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "../firebase/config";
import {
  addDoc,
  deleteDoc,
  runTransaction,
  updateDoc,
} from "../firebase/firestoreAccess";
import { useNavigate } from "react-router-dom";
import {
  displayCpf,
  displayPhone,
  formatCpf,
  formatPhone,
  isValidCpf,
  isValidPhone,
  normalizePersonName,
} from "../domain/clientFields";
import {
  CLIENT_CITIES,
  getCanonicalClientCity,
  getClientCityDisplay,
  getClientCityKey,
  normalizeSearchText,
} from "../domain/clientCities";
import {
  CLIENT_CLASSIFICATIONS,
  resolveClientClassification,
} from "../domain/clientClassification.js";
import { toDate } from "../utils/dates";
import {
  buildClientVisitSummary,
  hasGiftForTrip,
  resolveClientTripVisitStatus,
  validateGiftQuantity,
  calculateGiftCost,
} from "../domain/clientRecords";
import {
  CLIENT_GIFT_WRITES_ENABLED,
  CLIENT_VISIT_WRITES_ENABLED,
  cancelClientGift,
  recordClientGift,
  recordClientVisit,
} from "../services/clientRecords";
import { isFirestoreReadOnly } from "../firebase/writePolicy";
import {
  LuBanknote,
  LuChevronDown,
  LuHistory,
  LuMapPin,
  LuMessageCircle,
  LuPencil,
  LuPhone,
  LuPlus,
  LuSearch,
  LuShoppingBag,
  LuTriangleAlert,
  LuUsers,
  LuWallet,
} from "react-icons/lu";
import {
  analyzeLegacyBalances,
  calculateConsolidatedReceivables,
  isSaleOverdue,
  organizeSalesByTrip2026,
  prepareSaleReceipt,
} from "../domain/sales";
import { getSalePendingAmount } from "../domain/financeReceivables";
import ReceiptViewer from "../components/receipts/ReceiptViewer.jsx";
import FinancialValue from "../components/FinancialValue.jsx";
import TripSelector from "../components/TripSelector.jsx";
import useClientTrips from "../hooks/useClientTrips.js";
import { buildTripOptions } from "../domain/tripIdentity.js";
import "./ClientsPremium.css";

const emptyForm = {
  name: "",
  nickname: "",
  phone: "",
  cpf: "",
  city: "",
  street: "",
  number: "",
  district: "",
  totalDebt: "",
  notes: "",
};

export default function ClientsPage() {
  const [userId, setUserId] = useState("");
  const [clients, setClients] = useState([]);
  const [sales, setSales] = useState([]);
  const [clientViewMode, setClientViewMode] = useState("all");
  const [pregoClientIds, setPregoClientIds] = useState(new Set());
  const [pregoError, setPregoError] = useState("");
  const [classificationFilter, setClassificationFilter] = useState("all");
  const [classificationEditorId, setClassificationEditorId] = useState(null);
  const [classificationError, setClassificationError] = useState("");
  const [visitCity, setVisitCity] = useState("");
  const [visitTripName, setVisitTripName] = useState("");
  const [visitTripId, setVisitTripId] = useState("");
  const [visitStatusFilter, setVisitStatusFilter] = useState("unvisited");
  const { trips, visits: visitRecords, loading: loadingTrips, error: tripLoadError } = useClientTrips(userId);
  const [visitError, setVisitError] = useState("");
  const [giftClient, setGiftClient] = useState(null);
  const [giftProducts, setGiftProducts] = useState([]);
  const [giftRecords, setGiftRecords] = useState([]);
  const [giftProductId, setGiftProductId] = useState("");
  const [giftQuantity, setGiftQuantity] = useState("1");
  const [giftError, setGiftError] = useState("");
  const [giftDataReady, setGiftDataReady] = useState({ products: false, gifts: false });
  const [giftTrip, setGiftTrip] = useState(null);
  const [savingClientRecord, setSavingClientRecord] = useState(false);
  const clientRecordLock = useRef(false);
  const giftLock = useRef(false);
  const giftOperationId = useRef(null);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [cityFilter, setCityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tripFilter, setTripFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [selectedReceiptSale, setSelectedReceiptSale] = useState(null);
  const navigate = useNavigate();
  const [loadingClients, setLoadingClients] = useState(true);
  const [saving, setSaving] = useState(false);
  const [receivingClientId, setReceivingClientId] = useState(null);
  const receivingClientLock = useRef(false);

  useEffect(() => {
    let unsubscribeClients = null;
    let unsubscribeSales = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (unsubscribeClients) {
        unsubscribeClients();
        unsubscribeClients = null;
      }
      if (unsubscribeSales) {
        unsubscribeSales();
        unsubscribeSales = null;
      }

      setClients([]);
      setSales([]);
      setUserId(user?.uid || "");
      setPregoClientIds(new Set());
      setVisitCity("");
      setVisitTripId("");
      setVisitTripName("");
      setVisitError("");
      setGiftClient(null);
      setGiftTrip(null);
      setGiftRecords([]);
      setGiftProducts([]);
      giftOperationId.current = null;
      setGiftClient(null);

      if (!user) {
        setLoadingClients(false);
        return;
      }

      setLoadingClients(true);

      const clientsReference = collection(
        db,
        "users",
        user.uid,
        "clients"
      );

      unsubscribeClients = onSnapshot(
        clientsReference,
        (snapshot) => {
          const clientsList = snapshot.docs.map((document) => ({
            id: document.id,
            ...document.data(),
          }));

          clientsList.sort((firstClient, secondClient) =>
            String(firstClient.name || "").localeCompare(
              String(secondClient.name || ""),
              "pt-BR"
            )
          );

          setClients(clientsList);
          setLoadingClients(false);
        },
        (error) => {
          console.error("Erro ao carregar clientes:", error);
          alert(`Erro ao carregar clientes: ${error.message}`);
          setLoadingClients(false);
        }
      );

      unsubscribeSales = onSnapshot(
        collection(db, "users", user.uid, "sales"),
        (snapshot) => {
          setSales(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...document.data(),
            }))
          );
        },
        (error) => {
          console.error("Erro ao carregar compras dos clientes:", error);
          alert(`Erro ao carregar compras dos clientes: ${error.message}`);
        }
      );
    });

    return () => {
      unsubscribeAuth();

      if (unsubscribeClients) {
        unsubscribeClients();
      }
      if (unsubscribeSales) {
        unsubscribeSales();
      }
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      return undefined;
    }

    return onSnapshot(
      collection(db, "users", userId, "pregoClients"),
      (snapshot) => {
        setPregoClientIds(
          new Set(
            snapshot.docs
              .filter((document) => document.data().active)
              .map((document) => document.id)
          )
        );
        setPregoError("");
      },
      (error) => {
        console.error("Erro ao carregar Clientes Prego:", error);
        setPregoError(
          `Não foi possível carregar Clientes Prego: ${error.message}`
        );
      }
    );
  }, [userId]);

  useEffect(() => {
    if (!userId || !giftClient) {
      return undefined;
    }

    let unsubscribeProducts = () => {};
    let unsubscribeGifts = () => {};
    unsubscribeProducts = onSnapshot(
      collection(db, "users", userId, "products"),
      (snapshot) => {
        setGiftProducts(
          snapshot.docs.map((document) => ({
            id: document.id,
            ...document.data(),
          }))
        );
        setGiftDataReady((current) => ({ ...current, products: true }));
      },
      (error) => {
        console.error("Erro ao carregar produtos para brindes:", error);
        setGiftError(`Não foi possível carregar o estoque: ${error.message}`);
      }
    );
    unsubscribeGifts = onSnapshot(
      collection(db, "users", userId, "clientGifts"),
      (snapshot) => {
        setGiftRecords(
          snapshot.docs
            .map((document) => ({
              id: document.id,
              ...document.data(),
            }))
            .filter((gift) => gift.clientId === giftClient.id)
            .sort(
              (first, second) =>
                (toDate(second.giftDate)?.getTime() || 0) -
                (toDate(first.giftDate)?.getTime() || 0)
            )
        );
        setGiftDataReady((current) => ({ ...current, gifts: true }));
      },
      (error) => {
        console.error("Erro ao carregar brindes da cliente:", error);
        setGiftError(`Não foi possível carregar o histórico de brindes: ${error.message}`);
      }
    );

    return () => {
      unsubscribeProducts();
      unsubscribeGifts();
    };
  }, [giftClient, userId]);

  const salesByClient = useMemo(() => {
    const byClient = new Map();

    for (const sale of sales) {
      if (!sale.clientId) continue;

      const current = byClient.get(sale.clientId) || {
        count: 0,
        pending: 0,
        sales: [],
      };

      current.count += 1;
      current.pending += getSalePendingAmount(sale);
      current.sales.push(sale);
      byClient.set(sale.clientId, current);
    }

    for (const purchases of byClient.values()) {
      purchases.sales.sort((first, second) => {
        const firstDate = toDate(first.saleDate || first.createdAt)?.getTime() || 0;
        const secondDate = toDate(second.saleDate || second.createdAt)?.getTime() || 0;
        return secondDate - firstDate;
      });
    }

    return byClient;
  }, [sales]);

  const reconciliation = useMemo(
    () => analyzeLegacyBalances(clients, sales),
    [clients, sales]
  );

  const reconciliationCandidates = useMemo(
    () => reconciliation.filter((entry) => entry.needsReview),
    [reconciliation]
  );
  const legacyOnlyCount = reconciliation.filter(
    (entry) => entry.hasLegacyOnly
  ).length;
  const purchasesOnlyCount = reconciliation.filter(
    (entry) => entry.hasPurchasesOnly
  ).length;

  const receivables = useMemo(
    () => calculateConsolidatedReceivables(clients, sales),
    [clients, sales]
  );

  const tripOrganization = useMemo(
    () => organizeSalesByTrip2026(sales),
    [sales]
  );

  const clientRows = useMemo(() => {
    const tripsByClient = new Map();
    const addTrips = (list, key) => {
      for (const sale of list) {
        if (!sale.clientId) continue;
        const set = tripsByClient.get(sale.clientId) || new Set();
        set.add(key);
        tripsByClient.set(sale.clientId, set);
      }
    };
    addTrips(tripOrganization.thirdTrip.sales, "third");
    addTrips(tripOrganization.fourthTrip.sales, "fourth");
    addTrips(tripOrganization.review.sales, "review");

    const balances = new Map(
      receivables.clients.map((entry) => [entry.clientId, entry])
    );

    return clients.map((client) => {
      const balance = balances.get(client.id);
      const openSales = balance?.sales || [];
      const overdueSales = openSales.filter((sale) =>
        isSaleOverdue(sale.dueDate, sale.pendingAmount)
      );
      const totalPending = balance?.totalPending || 0;
      const status =
        totalPending <= 0
          ? "paid"
          : overdueSales.length > 0
            ? "overdue"
            : "open";

      return {
        client,
        totalPending,
        legacyBalance: balance?.legacyBalance || 0,
        salesPending: balance?.salesPending || 0,
        overdueCount: overdueSales.length,
        undatedCount: openSales.filter((sale) => !toDate(sale.dueDate)).length,
        status,
        trips: tripsByClient.get(client.id) || new Set(),
      };
    });
  }, [clients, receivables, tripOrganization]);

  const cities = useMemo(
    () =>
      [
        ...new Map(
          [
            ...CLIENT_CITIES,
            ...clients
              .map((client) => String(client.city || "").trim())
              .filter(Boolean),
          ].map((city) => [getClientCityKey(city), getClientCityDisplay(city)])
        ).values(),
      ].sort((first, second) => first.localeCompare(second, "pt-BR")),
    [clients]
  );

  const overdueClientsCount = clientRows.filter(
    (row) => row.status === "overdue"
  ).length;

  const filteredRows = useMemo(() => {
    const search = normalizeSearchText(searchText.trim());
    const searchDigits = search.replace(/\D/g, "");

    return clientRows.filter(({ client, status, trips }) => {
      const classification = resolveClientClassification(client, pregoClientIds);
      if (
        cityFilter !== "all" &&
        getClientCityKey(client.city) !== getClientCityKey(cityFilter)
      ) {
        return false;
      }
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (tripFilter !== "all" && !trips.has(tripFilter)) return false;
      if (
        classificationFilter !== "all" &&
        classification !== classificationFilter
      ) {
        return false;
      }
      if (!search) return true;

      const textMatch = [
        client.name,
        client.nickname,
        client.cpf,
        getClientCityDisplay(client.city),
        client.phone,
        client.street,
        client.number,
        client.district,
        client.notes,
      ].some((field) =>
        normalizeSearchText(field).includes(search)
      );

      const digitMatch =
        searchDigits.length >= 3 &&
        [client.cpf, client.phone].some((field) =>
          String(field || "").replace(/\D/g, "").includes(searchDigits)
        );

      return textMatch || digitMatch;
    });
  }, [
    clientRows,
    searchText,
    cityFilter,
    statusFilter,
    tripFilter,
    classificationFilter,
    pregoClientIds,
  ]);

  const displayedRows = useMemo(() => {
    return clientViewMode === "prego"
      ? filteredRows.filter(
          ({ client }) =>
            resolveClientClassification(client, pregoClientIds) === "prego"
        )
      : filteredRows;
  }, [clientViewMode, filteredRows, pregoClientIds]);

  const pregoClassificationCount = clients.filter(
    (client) => resolveClientClassification(client, pregoClientIds) === "prego"
  ).length;

  const { rows: visitRows, counts: visitCounts } = useMemo(
    () => buildClientVisitSummary({
      clients, city: visitCity, tripId: visitTripId, visitRecords, sales,
    }),
    [clients, sales, visitCity, visitRecords, visitTripId]
  );

  const visibleVisitRows = visitRows.filter(
    (entry) => entry.status === visitStatusFilter
  );

  const knownTrips = useMemo(
    () => buildTripOptions({
      trips: [...trips, ...(visitTripId ? [{ id: visitTripId, name: visitTripName }] : [])],
      sales, visits: visitRecords,
    }),
    [trips, sales, visitRecords, visitTripId, visitTripName]
  );

  const clientRecordWritesBlocked =
    !CLIENT_GIFT_WRITES_ENABLED || isFirestoreReadOnly();
  const visitWritesBlocked = !CLIENT_VISIT_WRITES_ENABLED || isFirestoreReadOnly() ||
    loadingTrips || Boolean(tripLoadError);
  const selectedClientGifts = giftRecords.filter(
    (gift) => gift.clientId === giftClient?.id
  );

  const hasActiveFilters =
    searchText.trim() !== "" ||
    cityFilter !== "all" ||
    statusFilter !== "all" ||
    tripFilter !== "all" ||
    classificationFilter !== "all";

  function clearFilters() {
    setSearchText("");
    setCityFilter("all");
    setStatusFilter("all");
    setTripFilter("all");
    setClassificationFilter("all");
  }

  async function handleSaveClassification(client, classification) {
    if (clientRecordLock.current || isFirestoreReadOnly()) return;
    if (!userId) {
      alert("Entre novamente no sistema para classificar a cliente.");
      return;
    }

    clientRecordLock.current = true;
    setSavingClientRecord(true);
    setClassificationError("");
    try {
      await updateDoc(doc(db, "users", userId, "clients", client.id), {
        classification,
        classificationUpdatedAt: serverTimestamp(),
      });
      setClassificationEditorId(null);
    } catch (error) {
      console.error("Erro ao classificar cliente:", error);
      setClassificationError(
        `Não foi possível salvar a classificação: ${error.message}`
      );
    } finally {
      clientRecordLock.current = false;
      setSavingClientRecord(false);
    }
  }

  async function handleVisitStatus(client, status) {
    if (clientRecordLock.current || visitWritesBlocked) return;
    if (!visitCity || !visitTripId) {
      alert("Selecione uma cidade e uma viagem antes de marcar a visita.");
      return;
    }
    if (getClientCityKey(client.city) !== getClientCityKey(visitCity)) {
      alert("A cliente não pertence à cidade selecionada para esta visita.");
      return;
    }
    if (!userId) {
      alert("Entre novamente no sistema para registrar a visita.");
      return;
    }

    clientRecordLock.current = true;
    setSavingClientRecord(true);
    setVisitError("");
    try {
      await recordClientVisit({
        db,
        userId,
        clientId: client.id,
        city: visitCity,
        tripId: visitTripId,
        tripName: visitTripName.trim(),
        status,
      });
    } catch (error) {
      console.error("Erro ao atualizar visita:", error);
      setVisitError(error.code === "permission-denied"
        ? "O Firebase recusou a gravação. Publique o firestore.rules atualizado para liberar visitas somente ao proprietário."
        : error.message);
    } finally {
      clientRecordLock.current = false;
      setSavingClientRecord(false);
    }
  }

  function handleOpenGift(client) {
    if (!visitCity || !visitTripId || !visitTripName.trim()) {
      alert("Selecione manualmente a cidade e a viagem antes de registrar um brinde.");
      return;
    }
    if (getClientCityKey(client.city) !== getClientCityKey(visitCity)) {
      alert("Selecione a cidade da cliente no controle de visitas antes de registrar o brinde.");
      return;
    }
    setGiftError("");
    setGiftRecords([]);
    setGiftProducts([]);
    setGiftDataReady({ products: false, gifts: false });
    setGiftTrip({ id: visitTripId, name: visitTripName, city: visitCity });
    setGiftProductId("");
    setGiftQuantity("1");
    giftOperationId.current = null;
    setGiftClient(client);
  }

  async function handleGiftSubmit(event) {
    event.preventDefault();
    if (giftLock.current || clientRecordWritesBlocked ||
      !giftDataReady.products || !giftDataReady.gifts) return;
    const product = giftProducts.find((entry) => entry.id === giftProductId);
    if (!giftClient || !product || !userId) {
      setGiftError("Selecione uma cliente e um produto cadastrado no estoque.");
      return;
    }

    try {
      validateGiftQuantity(giftQuantity, Number(product.quantity || 0));
    } catch (error) {
      setGiftError(error.message);
      return;
    }

    const alreadyGifted = hasGiftForTrip(
      giftRecords,
      giftTrip.name,
      giftTrip.city,
      giftTrip.id
    );
    const duplicateWarning = alreadyGifted
      ? "Esta cliente já recebeu um brinde nesta viagem. Deseja registrar outro mesmo assim?\n\n"
      : "";
    if (
      !window.confirm(
        `${duplicateWarning}Confirmar a entrega de ${giftQuantity} unidade(s) de ${product.name || "produto"} para ${giftClient.name}?`
      )
    ) {
      return;
    }

    if (!giftOperationId.current) {
      if (!globalThis.crypto?.randomUUID) {
        setGiftError("Este dispositivo não oferece um identificador seguro para registrar o brinde.");
        return;
      }
      giftOperationId.current = globalThis.crypto.randomUUID();
    }

    giftLock.current = true;
    setSavingClientRecord(true);
    setGiftError("");
    try {
      await recordClientGift({
        db,
        userId,
        operationId: giftOperationId.current,
        clientId: giftClient.id,
        productId: product.id,
        quantity: giftQuantity,
        tripId: giftTrip.id,
        tripName: giftTrip.name,
        tripCity: giftTrip.city,
      });
      setGiftProductId("");
      setGiftQuantity("1");
      giftOperationId.current = null;
    } catch (error) {
      console.error("Erro ao registrar brinde:", error);
      setGiftError(error.code === "permission-denied"
        ? "Entrega não confirmada. Confira o histórico e tente novamente com os mesmos dados; uma operação concorrente pode ter alterado o estoque. Se o bloqueio persistir, publique o firestore.rules atualizado para brindes."
        : error.message);
    } finally {
      giftLock.current = false;
      setSavingClientRecord(false);
    }
  }

  async function handleCancelGift(gift) {
    if (giftLock.current || clientRecordWritesBlocked) return;
    if (
      !window.confirm(
        "Cancelar este brinde e devolver a quantidade ao estoque?"
      )
    ) {
      return;
    }

    giftLock.current = true;
    setSavingClientRecord(true);
    setGiftError("");
    try {
      await cancelClientGift({ db, userId, gift });
    } catch (error) {
      console.error("Erro ao cancelar brinde:", error);
      setGiftError(error.code === "permission-denied"
        ? "Cancelamento não confirmado. Confira o histórico e tente novamente; outra sessão pode ter cancelado este brinde. Se o bloqueio persistir, publique o firestore.rules atualizado para brindes."
        : error.message);
    } finally {
      giftLock.current = false;
      setSavingClientRecord(false);
    }
  }

  function openNewClientForm() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function handleQuickReceive(row) {
    if (salesByClient.has(row.client.id)) {
      navigate("/financeiro");
      return;
    }
    handleReceivePayment(row.client);
  }

  function handleNewSale(client) {
    navigate("/vendas", { state: { newSaleClientId: client.id } });
  }

  function handleChange(event) {
    const { name, value } = event.target;
    const isPersonName = name === "name" || name === "nickname";
    const hasTrailingSpace = isPersonName && /\s$/.test(value);

    const masked =
      name === "cpf" ? formatCpf(value)
      : name === "phone" ? formatPhone(value)
      : isPersonName
        ? `${normalizePersonName(value)}${hasTrailingSpace ? " " : ""}`
      : value;

    setForm((current) => ({
      ...current,
      [name]: masked,
    }));
  }

  function clearForm() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  }
async function handleReceivePayment(client) {
  if (receivingClientLock.current) return;

  const user = auth.currentUser;

  if (!user) {
    alert("Você precisa entrar novamente no sistema.");
    return;
  }

  const currentBalance = Number(client.totalDebt || 0);

  if (salesByClient.has(client.id)) {
    alert(
      "Este cliente possui compras registradas. Para não misturar o saldo antigo com uma compra, registre cada recebimento na venda correspondente pela tela Financeiro."
    );
    return;
  }

  if (currentBalance <= 0) {
    alert("Este cliente já está com o saldo pago.");
    return;
  }

  receivingClientLock.current = true;
  const typedValue = window.prompt(
    `Saldo atual de ${client.name}: ${formatCurrency(
      currentBalance
    )}\n\nDigite o valor recebido:`
  );

  if (typedValue === null) {
    receivingClientLock.current = false;
    return;
  }

  const paymentValue = Number(
    typedValue.replace(",", ".").replace(/[^\d.-]/g, "")
  );

  if (!paymentValue || paymentValue <= 0) {
    alert("Digite um valor válido.");
    receivingClientLock.current = false;
    return;
  }

  if (paymentValue > currentBalance) {
    alert("O valor recebido não pode ser maior que o saldo.");
    receivingClientLock.current = false;
    return;
  }

  try {
    setReceivingClientId(client.id);

    const clientReference = doc(
      db,
      "users",
      user.uid,
      "clients",
      client.id
    );

    const paymentReference = doc(
      collection(
        db,
        "users",
        user.uid,
        "clients",
        client.id,
        "payments"
      )
    );
    await runTransaction(db, async (transaction) => {
      const clientSnapshot = await transaction.get(clientReference);

      if (!clientSnapshot.exists()) {
        throw new Error("Cliente não encontrado.");
      }

      const savedBalance = Number(
        clientSnapshot.data().totalDebt || 0
      );

      if (paymentValue > savedBalance) {
        throw new Error(
          `O saldo histórico atual é ${formatCurrency(savedBalance)}.`
        );
      }

      const updatedBalance = Math.max(
        savedBalance - paymentValue,
        0
      );

      transaction.update(clientReference, {
        totalDebt: updatedBalance,
        totalReceived:
          Number(clientSnapshot.data().totalReceived || 0) +
          paymentValue,
        status: updatedBalance === 0 ? "paid" : "partial",
        updatedAt: serverTimestamp(),
      });

      transaction.set(paymentReference, {
        value: paymentValue,
        previousBalance: savedBalance,
        remainingBalance: updatedBalance,
        createdAt: serverTimestamp(),
      });
    });

    alert(
      `Pagamento de ${formatCurrency(
        paymentValue
      )} registrado com sucesso!`
    );
  } catch (error) {
    console.error("Erro ao registrar pagamento:", error);
    alert(`Erro ao registrar pagamento: ${error.message}`);
  } finally {
    receivingClientLock.current = false;
    setReceivingClientId(null);
  }
}
async function handleShowHistory(client) {
  const user = auth.currentUser;

  if (!user) {
    alert("Você precisa entrar novamente no sistema.");
    return;
  }

  try {
    const paymentsReference = collection(
      db,
      "users",
      user.uid,
      "clients",
      client.id,
      "payments"
    );

    const paymentsQuery = query(
      paymentsReference,
      orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(paymentsQuery);

    if (snapshot.empty) {
      alert(`${client.name} ainda não possui pagamentos registrados.`);
      return;
    }

    const historyText = snapshot.docs
      .map((paymentDocument) => {
        const payment = paymentDocument.data();

        const date = payment.createdAt?.toDate
          ? payment.createdAt.toDate().toLocaleDateString("pt-BR")
          : "Data não informada";

        return `${date}
Pagamento: ${formatCurrency(payment.value)}
Saldo restante: ${formatCurrency(payment.remainingBalance)}`;
      })
      .join("\n\n");

    alert(`Histórico de ${client.name}\n\n${historyText}`);
  } catch (error) {
    console.error("Erro ao carregar histórico:", error);
    alert(`Erro ao carregar histórico: ${error.message}`);
  }
}
  async function handleSubmit(event) {
    event.preventDefault();


    const user = auth.currentUser;

    if (!user) {
      alert("Você precisa entrar novamente no sistema.");
      return;
    }

    if (!form.name.trim()) {
      alert("Digite o nome do cliente.");
      return;
    }

    const original = clients.find((item) => item.id === editingId);
    const canonicalCity = getCanonicalClientCity(form.city);

    if (!canonicalCity) {
      alert("Selecione uma das cinco cidades disponíveis.");
      return;
    }

    if (
      form.cpf.trim() &&
      form.cpf !== displayCpf(original?.cpf) &&
      !isValidCpf(form.cpf)
    ) {
      alert("CPF inválido. Confira os 11 números ou deixe o campo em branco.");
      return;
    }

    if (
      form.phone.trim() &&
      form.phone !== displayPhone(original?.phone) &&
      !isValidPhone(form.phone)
    ) {
      alert("Telefone incompleto. Use (00) 00000-0000 ou (00) 0000-0000.");
      return;
    }

    try {
      setSaving(true);

      const clientData = {
        name:
          original?.name === form.name
            ? original.name
            : normalizePersonName(form.name),
        nickname:
          original?.nickname === form.nickname
            ? original.nickname
            : normalizePersonName(form.nickname),
        phone: form.phone.trim(),
        cpf: form.cpf.trim(),
        city:
          original &&
          getCanonicalClientCity(original.city) === canonicalCity
            ? original.city
            : canonicalCity,
        street: form.street.trim(),
        number: form.number.trim(),
        district: form.district.trim(),
        totalDebt: Number(form.totalDebt || 0),
        notes: form.notes.trim(),
        ...(editingId ? {} : { classification: "unclassified" }),
        updatedAt: serverTimestamp(),
      };

      if (editingId) {
        const clientReference = doc(
          db,
          "users",
          user.uid,
          "clients",
          editingId
        );

        await updateDoc(clientReference, clientData);

        alert("Cliente atualizado com sucesso!");
      } else {
        const clientsReference = collection(
          db,
          "users",
          user.uid,
          "clients"
        );

        await addDoc(clientsReference, {
          ...clientData,
          createdAt: serverTimestamp(),
        });

        alert("Cliente cadastrado e salvo na nuvem!");
      }

      clearForm();
    } catch (error) {
      console.error("Erro ao salvar cliente:", error);
      alert(`Erro ao salvar cliente: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(client) {
    setEditingId(client.id);
    setShowForm(true);

    setForm({
      name: client.name || "",
      nickname: client.nickname || "",
      phone: displayPhone(client.phone),
      cpf: displayCpf(client.cpf),
      city: getCanonicalClientCity(client.city),
      street: client.street || "",
      number: client.number || "",
      district: client.district || "",
      totalDebt: String(client.totalDebt || ""),
      notes: client.notes || "",
    });

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function handleDelete(client) {
    const user = auth.currentUser;

    if (!user) {
      alert("Você precisa entrar novamente no sistema.");
      return;
    }

    if (salesByClient.has(client.id)) {
      alert(
        "Este cliente possui compras vinculadas. Não é possível excluí-lo sem preservar a associação das compras."
      );
      return;
    }

    const confirmed = window.confirm(
      `Deseja realmente excluir o cliente ${client.name}?`
    );

    if (!confirmed) {
      return;
    }

    try {
      const clientReference = doc(
        db,
        "users",
        user.uid,
        "clients",
        client.id
      );

      await deleteDoc(clientReference);

      if (editingId === client.id) {
        clearForm();
      }

      alert("Cliente excluído com sucesso!");
    } catch (error) {
      console.error("Erro ao excluir cliente:", error);
      alert(`Erro ao excluir cliente: ${error.message}`);
    }
  }

  function openWhatsApp(client) {
    const phone = String(client.phone || "").replace(/\D/g, "");

    if (!phone) {
      alert("Este cliente não possui telefone cadastrado.");
      return;
    }

    const brazilianPhone = phone.startsWith("55")
      ? phone
      : `55${phone}`;

    const message = encodeURIComponent(
      salesByClient.has(client.id)
        ? `Olá, ${client.nickname || client.name}! Tudo bem? Estou entrando em contato pela RC Confecções. Suas compras estão registradas separadamente; vou confirmar com você cada saldo em aberto.`
        : `Olá, ${client.nickname || client.name}! Tudo bem? Estou entrando em contato pela RC Confecções sobre seu saldo histórico de ${formatCurrency(
            client.totalDebt
          )}.`
    );

    window.open(
      `https://wa.me/${brazilianPhone}?text=${message}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  function formatCurrency(value) {
    return Number(value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }

  const statusLabels = {
    paid: "Em dia",
    open: "A receber",
    overdue: "Atrasado",
  };

  function initials(name) {
    return String(name || "?")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("");
  }

  const formFields = (
    <form onSubmit={handleSubmit} className="cl-form">
      <div className="cl-form-head">
        <h2>{editingId ? "Editar cliente" : "Novo cliente"}</h2>
        <button type="button" onClick={clearForm} className="cl-btn cl-btn-ghost">
          Cancelar
        </button>
      </div>

      <div className="cl-form-grid">
        <label className="cl-wide">
          Nome completo
          <input
            type="text"
            name="name"
            value={form.name}
            onChange={handleChange}
            placeholder="Digite o nome do cliente"
            lang="pt-BR"
            spellCheck="true"
            autoCorrect="on"
            required
            disabled={saving}
          />
        </label>

        <label>
          Conhecido como
          <input
            type="text"
            name="nickname"
            value={form.nickname}
            onChange={handleChange}
            placeholder="Apelido ou nome conhecido"
            lang="pt-BR"
            spellCheck="true"
            autoCorrect="on"
            disabled={saving}
          />
        </label>

        <label>
          Telefone
          <input
            type="tel"
            inputMode="numeric"
            maxLength={15}
            name="phone"
            value={form.phone}
            onChange={handleChange}
            placeholder="(00) 00000-0000"
            disabled={saving}
          />
        </label>

        <label>
          CPF
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={14}
            name="cpf"
            value={form.cpf}
            onChange={handleChange}
            placeholder="000.000.000-00"
            disabled={saving}
          />
        </label>

        <label>
          Cidade
          <select
            name="city"
            value={form.city}
            onChange={handleChange}
            required
            disabled={saving}
          >
            <option value="" disabled>
              Selecione a cidade
            </option>
            {cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </label>

        <label className="cl-wide">
          Rua
          <input
            type="text"
            name="street"
            value={form.street}
            onChange={handleChange}
            placeholder="Digite a rua"
            disabled={saving}
          />
        </label>

        <label>
          Número
          <input
            type="text"
            name="number"
            value={form.number}
            onChange={handleChange}
            placeholder="Número"
            disabled={saving}
          />
        </label>

        <label>
          Bairro
          <input
            type="text"
            name="district"
            value={form.district}
            onChange={handleChange}
            placeholder="Bairro"
            disabled={saving}
          />
        </label>

        <label className="cl-wide">
          Saldo legado/agregado (não conciliado)
          <input
            type="number"
            name="totalDebt"
            value={form.totalDebt}
            onChange={handleChange}
            placeholder="0,00"
            min="0"
            step="0.01"
            disabled={
              saving || Boolean(editingId && salesByClient.has(editingId))
            }
          />
          <small>
            Saldo histórico preservado. Compras novas e seus recebimentos são
            controlados individualmente.
            {editingId && salesByClient.has(editingId)
              ? " Não alterável enquanto houver compras registradas."
              : ""}
          </small>
        </label>

        <label className="cl-wide">
          Observações
          <textarea
            name="notes"
            value={form.notes}
            onChange={handleChange}
            placeholder="Ex.: prefere receber no fim do mês..."
            rows={3}
            disabled={saving}
          />
        </label>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="cl-btn cl-btn-primary cl-submit"
      >
        {saving
          ? "Salvando..."
          : editingId
            ? "Salvar alterações"
            : "Cadastrar cliente"}
      </button>
    </form>
  );

  return (
    <div className="cl">
      <PageHeader
        icon={LuUsers}
        title="Clientes"
        description="Cadastre, pesquise e acompanhe seus clientes e saldos."
      >
        <button
          type="button"
          className="cl-btn cl-btn-soft"
          onClick={() => {
            const openingPrego = clientViewMode !== "prego";
            setPregoError("");
            setClientViewMode(openingPrego ? "prego" : "all");
            setClassificationFilter(openingPrego ? "prego" : "all");
          }}
          aria-pressed={clientViewMode === "prego"}
        >
          {clientViewMode === "prego" ? "Lista geral" : "Clientes Prego"}
        </button>
        <button
          type="button"
          className="cl-btn cl-btn-primary cl-new"
          onClick={openNewClientForm}
        >
          <LuPlus aria-hidden="true" /> Novo cliente
        </button>
      </PageHeader>

      {clientViewMode === "prego" && (
        <section className="cl-panel cl-prego-panel">
          <div>
            <h2>Clientes Prego</h2>
            <p>
              Lista automática das clientes cuja classificação atual é Prego.
              Altere a classificação diretamente na ficha da cliente.
            </p>
          </div>
          <strong>{pregoClassificationCount} cliente(s) na lista</strong>
          {pregoError && <p className="cl-record-error" role="alert">{pregoError}</p>}
          {isFirestoreReadOnly() && (
            <p className="cl-record-pending" role="status">
              A prévia está em modo somente leitura; classificações não podem ser salvas nela.
            </p>
          )}
        </section>
      )}

      <div className="cl-kpis">
        <article className="cl-kpi cl-kpi-navy">
          <span className="cl-kpi-icon"><LuUsers aria-hidden="true" /></span>
          <span className="cl-kpi-label">Total de clientes</span>
          <strong>{clients.length}</strong>
        </article>

        <article className="cl-kpi cl-kpi-gold">
          <span className="cl-kpi-icon"><LuWallet aria-hidden="true" /></span>
          <span className="cl-kpi-label">Total a receber</span>
          <strong><FinancialValue>{formatCurrency(receivables.totalPending)}</FinancialValue></strong>
          <small>Mesmo cálculo do Dashboard, sem somar a mesma dívida duas vezes.</small>
        </article>

        <article className="cl-kpi cl-kpi-red">
          <span className="cl-kpi-icon"><LuTriangleAlert aria-hidden="true" /></span>
          <span className="cl-kpi-label">Clientes atrasados</span>
          <strong>{overdueClientsCount}</strong>
          <small>Somente compras com vencimento informado e já vencido.</small>
        </article>
      </div>

      {showForm && <section className="cl-panel">{formFields}</section>}

      <section className="cl-panel">
        <div className="cl-search">
          <LuSearch aria-hidden="true" />
          <input
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Nome, apelido, CPF, cidade ou telefone"
            aria-label="Pesquisar clientes"
          />
        </div>

        <div className="cl-filters">
          <label>
            Cidade
            <select
              value={cityFilter}
              onChange={(event) => setCityFilter(event.target.value)}
            >
              <option value="all">Todas as cidades</option>
              {cities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          </label>

          <label>
            Situação financeira
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">Todas</option>
              <option value="open">A receber</option>
              <option value="overdue">Atrasado</option>
              <option value="paid">Em dia</option>
            </select>
          </label>

          <label>
            Viagem
            <select
              value={tripFilter}
              onChange={(event) => setTripFilter(event.target.value)}
            >
              <option value="all">Todas as viagens</option>
              <option value="third">3ª viagem</option>
              <option value="fourth">4ª viagem</option>
              <option value="review">Revisão necessária</option>
            </select>
          </label>

          <label>
            Classificação
            <select
              value={classificationFilter}
              onChange={(event) => setClassificationFilter(event.target.value)}
              aria-label="Filtrar por classificação"
            >
              <option value="all">Todas as classificações</option>
              {CLIENT_CLASSIFICATIONS.map(({ id, label }) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </label>

          {hasActiveFilters && (
            <button type="button" className="cl-btn cl-btn-ghost" onClick={clearFilters}>
              Limpar filtros
            </button>
          )}
        </div>

        <p className="cl-count">
          {clientViewMode === "prego" ? `${pregoClassificationCount} cliente(s) Prego · ` : ""}
          {displayedRows.length} de {clients.length} cliente(s)
          {tripFilter !== "all" &&
            " — viagem conforme classificação proposta das vendas"}
        </p>
        {classificationError && (
          <p className="cl-record-error" role="alert">{classificationError}</p>
        )}

        {loadingClients ? (
          <div className="cl-empty"><strong>Carregando clientes...</strong></div>
        ) : displayedRows.length === 0 ? (
          <div className="cl-empty">
            <strong>Nenhum cliente encontrado</strong>
            <p>Cadastre um cliente ou altere a pesquisa e os filtros.</p>
          </div>
        ) : (
          <div className="cl-list">
            {displayedRows.map((row) => {
              const { client } = row;
              const purchases = salesByClient.get(client.id);
              const expanded = expandedId === client.id;
              const address = [client.street, client.number, client.district]
                .filter(Boolean)
                .join(", ");
              const clientVisitStatus = resolveClientTripVisitStatus({
                client,
                city: visitCity,
                tripId: visitTripId,
                visitRecords,
                sales,
              });
              const classification = resolveClientClassification(
                client,
                pregoClientIds
              );
              const classificationInfo = CLIENT_CLASSIFICATIONS.find(
                ({ id }) => id === classification
              );

              return (
                <article key={client.id} className={`cl-row cl-row-${row.status}`}>
                  <div className="cl-row-main">
                    <span className="cl-avatar" aria-hidden="true">
                      {initials(client.name)}
                    </span>

                    <div className="cl-identity">
                      <h3>{client.name}</h3>
                      {client.nickname && <p>“{client.nickname}”</p>}
                      <span
                        className={`cl-classification-chip cl-classification-${classification}`}
                      >
                        {classificationInfo?.label || "Não classificado"}
                      </span>
                    </div>

                    <div className="cl-contact">
                      <span><LuMapPin aria-hidden="true" /> {getClientCityDisplay(client.city) || "Cidade não informada"}</span>
                      <span><LuPhone aria-hidden="true" /> {displayPhone(client.phone) || "Telefone não informado"}</span>
                    </div>

                    <div className="cl-balance">
                      <span>Saldo</span>
                      <strong><FinancialValue>{formatCurrency(row.totalPending)}</FinancialValue></strong>
                    </div>

                    <span className={`cl-status cl-status-${row.status}`}>
                      {statusLabels[row.status]}
                    </span>
                  </div>

                  <div className="cl-actions">
                    <button
                      type="button"
                      className="cl-btn cl-btn-soft"
                      onClick={() => {
                        setClassificationError("");
                        setClassificationEditorId((current) =>
                          current === client.id ? null : client.id
                        );
                      }}
                      aria-expanded={classificationEditorId === client.id}
                      disabled={savingClientRecord}
                    >
                      Classificar cliente
                    </button>
                    <button
                      type="button"
                      className="cl-btn cl-btn-soft"
                      onClick={() => setExpandedId(expanded ? null : client.id)}
                      aria-expanded={expanded}
                    >
                      <LuChevronDown aria-hidden="true" className={expanded ? "cl-flip" : ""} />
                      {expanded ? "Ocultar detalhes" : "Ver detalhes"}
                    </button>
                    <button
                      type="button"
                      className="cl-btn cl-btn-soft"
                      onClick={() => setExpandedId(expanded ? null : client.id)}
                    >
                      <LuShoppingBag aria-hidden="true" /> Compras e Recibos
                    </button>
                    <button type="button" className="cl-btn cl-btn-soft" onClick={() => handleEdit(client)}>
                      <LuPencil aria-hidden="true" /> Editar
                    </button>
                    <button type="button" className="cl-btn cl-btn-soft" onClick={() => handleNewSale(client)}>
                      <LuShoppingBag aria-hidden="true" /> Nova venda
                    </button>
                    <button
                      type="button"
                      className="cl-btn cl-btn-gold"
                      onClick={() => handleQuickReceive(row)}
                      disabled={receivingClientId === client.id}
                      title={
                        purchases
                          ? "Abre o Financeiro para receber por compra"
                          : "Registrar recebimento do saldo legado"
                      }
                    >
                      <LuBanknote aria-hidden="true" />
                      {receivingClientId === client.id ? "Registrando..." : "Receber"}
                    </button>
                  </div>

                  {classificationEditorId === client.id && (
                    <div
                      className="cl-classification-options"
                      role="group"
                      aria-label={`Classificação de ${client.name}`}
                    >
                      {isFirestoreReadOnly() && (
                        <small role="status">
                          Prévia somente leitura: as opções podem ser consultadas,
                          mas não salvas.
                        </small>
                      )}
                      {CLIENT_CLASSIFICATIONS.map(({ id, label }) => (
                        <button
                          key={id}
                          type="button"
                          className={`cl-classification-option cl-classification-${id}${classification === id ? " is-selected" : ""}`}
                          aria-pressed={classification === id}
                          disabled={savingClientRecord || isFirestoreReadOnly()}
                          onClick={() => handleSaveClassification(client, id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}

                  {expanded && (
                    <div className="cl-details">
                      <dl>
                        <div><dt>CPF</dt><dd>{displayCpf(client.cpf) || "Não informado"}</dd></div>
                        <div><dt>Endereço</dt><dd>{address || "Não informado"}</dd></div>
                        <div>
                          <dt>Saldo histórico agregado</dt>
                          <dd><FinancialValue>{formatCurrency(client.totalDebt)}</FinancialValue></dd>
                        </div>
                        <div>
                          <dt>Compras{purchases ? ` (${purchases.count})` : ""}</dt>
                          <dd><FinancialValue>{formatCurrency(purchases?.pending || 0)}</FinancialValue> em aberto</dd>
                        </div>
                        {row.overdueCount > 0 && (
                          <div><dt>Vencidas</dt><dd>{row.overdueCount} compra(s)</dd></div>
                        )}
                        {row.undatedCount > 0 && (
                          <div>
                            <dt>Sem vencimento</dt>
                            <dd>{row.undatedCount} compra(s) — não classificadas como atrasadas</dd>
                          </div>
                        )}
                        {client.notes && (
                          <div className="cl-wide"><dt>Observações</dt><dd>{client.notes}</dd></div>
                        )}
                      </dl>

                      {purchases && (
                        <p className="cl-warning">
                          Para não misturar saldos, receba cada compra pela tela
                          Financeiro. O saldo histórico e as compras abertas podem
                          representar a mesma dívida e não são somados aqui.
                        </p>
                      )}

                      {purchases?.sales.length > 0 && (
                        <section className="cl-purchases" aria-label={`Compras de ${client.name}`}>
                          <h4>Compras e Recibos</h4>
                          {purchases.sales.map((purchase) => {
                            const received = Number(
                              purchase.amountPaid ??
                                purchase.received ??
                                purchase.valorRecebido ??
                                0
                            );
                            const pending = getSalePendingAmount(purchase);
                            const total = Number(
                              purchase.total ??
                                purchase.totalValue ??
                                purchase.amount ??
                                purchase.valorTotal ??
                                received + pending
                            );
                            const purchaseDate = toDate(
                              purchase.saleDate || purchase.createdAt
                            );
                            const financeStatus =
                              pending <= 0 ? "Pago" : received > 0 ? "Parcial" : "Pendente";
                            const tripLabel =
                              purchase.tripName ||
                              (purchase.tripNumber
                                ? `${purchase.tripNumber}ª viagem`
                                : purchase.tripCity || "Viagem não informada");

                            return (
                              <article className="cl-purchase" key={purchase.id}>
                                <div>
                                  <strong>Compra #{purchase.id}</strong>
                                  <span>
                                    Data: {purchaseDate?.toLocaleDateString("pt-BR") || "Não informada"}
                                  </span>
                                  <span>Viagem: {tripLabel}</span>
                                  <span>Situação financeira: {financeStatus}</span>
                                </div>
                                <dl>
                                  <div><dt>Total</dt><dd><FinancialValue>{formatCurrency(total)}</FinancialValue></dd></div>
                                  <div><dt>Recebido</dt><dd><FinancialValue>{formatCurrency(received)}</FinancialValue></dd></div>
                                  <div><dt>Saldo</dt><dd><FinancialValue>{formatCurrency(pending)}</FinancialValue></dd></div>
                                </dl>
                                <button
                                  type="button"
                                  className="cl-btn cl-btn-gold"
                                  onClick={() => setSelectedReceiptSale(prepareSaleReceipt({
                                    ...purchase,
                                    clientName: client.name,
                                  }))}
                                >
                                  Ver recibo
                                </button>
                              </article>
                            );
                          })}
                        </section>
                      )}
                      {(!purchases || purchases.sales.length === 0) && (
                        <p className="cl-empty-purchases">
                          Nenhuma compra vinculada ao ID desta cliente.
                        </p>
                      )}

                      <div className="cl-actions">
                        {clientVisitStatus === "bought" ? (
                          <span className="cl-visit-bought">Comprou nesta viagem</span>
                        ) : (
                          <button
                            type="button"
                            className="cl-btn cl-btn-soft"
                            onClick={() =>
                              handleVisitStatus(
                                client,
                                clientVisitStatus === "not_purchased"
                                  ? "unvisited"
                                  : "not_purchased"
                              )
                            }
                            disabled={
                              savingClientRecord ||
                              visitWritesBlocked ||
                              !visitCity ||
                              !visitTripName.trim() ||
                              getClientCityKey(client.city) !==
                                getClientCityKey(visitCity)
                            }
                          >
                            {clientVisitStatus === "not_purchased"
                              ? "Desfazer Não comprou"
                              : "Não comprou"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="cl-btn cl-btn-gold"
                          onClick={() => handleOpenGift(client)}
                          disabled={
                            savingClientRecord ||
                            !visitCity ||
                            !visitTripName.trim() ||
                            getClientCityKey(client.city) !==
                              getClientCityKey(visitCity)
                          }
                        >
                          Dar brinde
                        </button>
                        <button type="button" className="cl-btn cl-btn-soft" onClick={() => handleShowHistory(client)}>
                          <LuHistory aria-hidden="true" /> Histórico
                        </button>
                        <button type="button" className="cl-btn cl-btn-soft" onClick={() => openWhatsApp(client)}>
                          <LuMessageCircle aria-hidden="true" /> WhatsApp
                        </button>
                        <button type="button" className="cl-btn cl-btn-danger" onClick={() => handleDelete(client)}>
                          Excluir
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="cl-panel cl-visits">
        <header>
          <div>
            <h2>Visitas por cidade e viagem</h2>
            <p>
              Escolha a cidade e a viagem manualmente. Uma nova viagem começa
              sem herdar as marcações anteriores. “Comprou” exige uma venda
              vinculada ao mesmo ID de cliente e ao mesmo identificador de viagem.
            </p>
          </div>
        </header>
        <div className="cl-visit-selectors">
          <label>
            Cidade da visita
            <select
              value={visitCity}
              onChange={(event) => {
                setVisitError("");
                setVisitCity(event.target.value);
              }}
            >
              <option value="">Selecione uma cidade</option>
              {cities.map((city) => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
          </label>
          <TripSelector
            userId={userId}
            options={knownTrips}
            value={visitTripId}
            disabled={savingClientRecord || loadingTrips || Boolean(tripLoadError)}
            onChange={(trip) => {
              setVisitError("");
              setVisitTripId(trip.id);
              setVisitTripName(trip.name);
            }}
          />
        </div>

        {isFirestoreReadOnly() && (
          <p className="cl-record-pending" role="status">
            Esta prévia está em modo somente leitura e não permite marcações.
          </p>
        )}
        {tripLoadError && <p className="cl-record-error" role="alert">{tripLoadError}</p>}
        {visitError && <p className="cl-record-error" role="alert">{visitError}</p>}

        <div className="cl-visit-tabs" role="tablist" aria-label="Situação da visita">
          {[
            ["unvisited", "Falta visitar"],
            ["not_purchased", "Não comprou"],
            ["bought", "Comprou"],
          ].map(([status, label]) => (
            <button
              key={status}
              type="button"
              role="tab"
              aria-selected={visitStatusFilter === status}
              className={visitStatusFilter === status ? "is-active" : ""}
              onClick={() => setVisitStatusFilter(status)}
            >
              {label} <span>{visitCounts[status]}</span>
            </button>
          ))}
        </div>

        {!visitCity || !visitTripName.trim() ? (
          <p className="cl-empty-purchases">
            Selecione uma cidade e uma viagem para consultar ou marcar visitas.
          </p>
        ) : visibleVisitRows.length === 0 ? (
          <p className="cl-empty-purchases">
            Nenhuma cliente nesta situação para a cidade e viagem selecionadas.
          </p>
        ) : (
          <div className="cl-visit-list">
            {visibleVisitRows.map(({ client, status }) => (
              <article key={client.id} className="cl-visit-row">
                <div>
                  <strong>{client.name}</strong>
                  <span>{getClientCityDisplay(client.city)}</span>
                  <small>ID: {client.id}</small>
                </div>
                {status === "not_purchased" ? (
                  <button
                    type="button"
                    className="cl-btn cl-btn-soft"
                    onClick={() => handleVisitStatus(client, "unvisited")}
                    disabled={savingClientRecord || visitWritesBlocked}
                  >
                    Desfazer marcação
                  </button>
                ) : status === "unvisited" ? (
                  <button
                    type="button"
                    className="cl-btn cl-btn-soft"
                    onClick={() => handleVisitStatus(client, "not_purchased")}
                    disabled={savingClientRecord || visitWritesBlocked}
                  >
                    Não comprou
                  </button>
                ) : (
                  <span className="cl-visit-bought">Venda registrada</span>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <details className="cl-panel cl-check">
        <summary>
          <span>
            <strong>Conferência de saldos</strong>
            <small>
              {reconciliationCandidates.length} com possível sobreposição ·{" "}
              {legacyOnlyCount} somente saldo legado · {purchasesOnlyCount} somente compras
            </small>
          </span>
          <LuChevronDown aria-hidden="true" />
        </summary>

        <p className="cl-warning">
          Comparação somente para revisão. Não altera clientes, compras ou
          pagamentos. O saldo legado pode já incluir compras antigas; não some nem
          migre os valores sem confirmar os registros e recibos de origem.
        </p>

        <div className="cl-check-summary">
          <span>{reconciliationCandidates.length} cliente(s) com possível sobreposição</span>
          <span>{legacyOnlyCount} somente com saldo legado</span>
          <span>{purchasesOnlyCount} somente com compras</span>
        </div>

        {loadingClients ? (
          <p>Carregando saldos para comparação...</p>
        ) : reconciliationCandidates.length === 0 ? (
          <p>
            Nenhum cliente tem simultaneamente saldo legado e saldo pendente em
            compras nesta leitura.
          </p>
        ) : (
          <div className="cl-check-list">
            {reconciliationCandidates.map((entry) => (
              <div key={entry.clientId} className="cl-check-item">
                <strong>{entry.clientName}</strong>
                <span>Saldo legado: <FinancialValue>{formatCurrency(entry.legacyBalance)}</FinancialValue></span>
                <span>Compras abertas: <FinancialValue>{formatCurrency(entry.purchaseBalance)}</FinancialValue></span>
                <span>
                  Diferença matemática (não é valor para migração):{" "}
                  <FinancialValue>{formatCurrency(entry.difference)}</FinancialValue>
                </span>
                <small>
                  Conferir histórico de compras e recebimentos antes de qualquer
                  ajuste. Valores podem representar a mesma dívida.
                </small>
              </div>
            ))}
          </div>
        )}
      </details>
      {selectedReceiptSale && (
        <ReceiptViewer
          sale={selectedReceiptSale}
          onClose={() => setSelectedReceiptSale(null)}
        />
      )}
      {giftClient && createPortal(
        <div className="cl-record-overlay">
          <section className="cl-gift-dialog" role="dialog" aria-modal="true" aria-label="Dar brinde">
            <header>
              <div>
                <h2>Dar brinde</h2>
                <p>{giftClient.name} · {giftTrip.name} · {getClientCityDisplay(giftTrip.city)}</p>
              </div>
              <button type="button" className="cl-btn cl-btn-soft" disabled={savingClientRecord} onClick={() => setGiftClient(null)}>
                Fechar
              </button>
            </header>

            {clientRecordWritesBlocked && (
              <p className="cl-record-pending" role="status">
                Esta prévia está em modo somente leitura e não permite brindes.
              </p>
            )}
            {giftError && <p className="cl-record-error" role="alert">{giftError}</p>}

            {hasGiftForTrip(selectedClientGifts, giftTrip.name, giftTrip.city, giftTrip.id) && (
              <p className="cl-gift-warning" role="status">
                Esta cliente já recebeu brinde nesta viagem. Outra entrega exige confirmação.
              </p>
            )}

            <form onSubmit={handleGiftSubmit} className="cl-gift-form">
              <label>
                Produto cadastrado no estoque
                <select
                  value={giftProductId}
                  disabled={savingClientRecord || !giftDataReady.products}
                  onChange={(event) => setGiftProductId(event.target.value)}
                  required
                >
                  <option value="">Selecione um produto disponível</option>
                  {giftProducts
                    .filter((product) => Number(product.quantity || 0) > 0)
                    .map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name || "Produto"} · estoque {product.quantity}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Quantidade
                <input
                  type="number"
                  min="1"
                  step="1"
                  max={giftProducts.find((product) => product.id === giftProductId)?.quantity || 1}
                  value={giftQuantity}
                  disabled={savingClientRecord}
                  onChange={(event) => setGiftQuantity(event.target.value)}
                  required
                />
              </label>
              {giftProducts
                .filter((product) => product.id === giftProductId)
                .map((product) => {
                  const quantity = Number(giftQuantity);
                  const canEstimateCost =
                    Number.isFinite(Number(product.costPrice)) &&
                    Number(product.costPrice) >= 0 &&
                    Number.isInteger(quantity) &&
                    quantity > 0;
                  const estimatedCost = canEstimateCost
                    ? formatCurrency(
                        calculateGiftCost(product.costPrice, quantity)
                      )
                    : "Informe uma quantidade válida";
                  return (
                    <p key={product.id} className="cl-gift-cost">
                      Custo estimado separado:{" "}
                      <FinancialValue>{estimatedCost}</FinancialValue>
                    </p>
                  );
                })}
              <button
                type="submit"
                className="cl-btn cl-btn-primary"
                disabled={
                  savingClientRecord ||
                  clientRecordWritesBlocked ||
                  !giftDataReady.products || !giftDataReady.gifts ||
                  !giftProductId
                }
              >
                {savingClientRecord ? "Registrando..." : "Confirmar entrega"}
              </button>
            </form>

            <div className="cl-gift-history">
              <h3>Histórico de brindes</h3>
              <p>Para corrigir um lançamento, cancele e devolva ao estoque; depois registre a entrega correta. O histórico é preservado.</p>
              {!giftDataReady.gifts && <p role="status">Carregando histórico...</p>}
              {selectedClientGifts.length === 0 ? (
                <p>Nenhum brinde registrado para esta cliente.</p>
              ) : (
                selectedClientGifts.map((gift) => (
                  <article key={gift.id}>
                    <div>
                      <strong>{gift.productName || "Produto"}</strong>
                      <span>
                        {gift.quantity} unidade(s) · {gift.tripName} · {gift.tripCity}
                      </span>
                      <span>
                        Data: {toDate(gift.giftDate)?.toLocaleDateString("pt-BR") || "Não informada"}
                      </span>
                      <span>
                        Custo registrado:{" "}
                        <FinancialValue>{formatCurrency(gift.totalCost)}</FinancialValue>
                      </span>
                      <span>{gift.status === "cancelled" ? "Cancelado" : "Entregue"}</span>
                    </div>
                    {gift.status === "active" && (
                      <button
                        type="button"
                        className="cl-btn cl-btn-danger"
                        onClick={() => handleCancelGift(gift)}
                        disabled={savingClientRecord || clientRecordWritesBlocked}
                      >
                        Cancelar e devolver ao estoque
                      </button>
                    )}
                  </article>
                ))
              )}
            </div>
          </section>
        </div>,
        document.body
      )}
    </div>
  );
}
