import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useLocation } from "react-router-dom";
import {
  LuBanknote,
  LuCircleCheck,
  LuClock,
  LuFileText,
  LuPencil,
  LuPlus,
  LuReceipt,
  LuSearch,
  LuShoppingBag,
  LuTrash2,
  LuX,
} from "react-icons/lu";
import ReceiptTemplate from "../components/receipts/ReceiptTemplate";
import {
  buildReceiptPdfFile,
  canShareReceiptFile,
  downloadReceiptFile,
  generateReceiptPdf,
  printReceipt,
  shareReceiptFile,
} from "../components/receipts/generateReceiptPdf";
import {
  adjustLegacyClientDebt,
  applyPaymentToSale,
  calculateSaleAmounts,
  isSaleOverdue as checkSaleOverdue,
  organizeSalesByTrip2026,
  prepareSaleReceipt,
  reusePaymentOperation,
  updateStockAfterSale,
  updateStockAfterSaleEdit,
} from "../domain/sales";
import { toDate, toDateInputValue } from "../utils/dates";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "../firebase/config";
import { runTransaction } from "../firebase/firestoreAccess";
import "./ClientsPremium.css";
import "./SalesPremium.css";

const emptyItem = {
  productId: "",
  quantity: 1,
  price: "",
};

function createEmptySale() {
  const saleDate = new Date();
  const dueDate = new Date(saleDate);
  dueDate.setDate(dueDate.getDate() + 90);

  return {
    clientId: "",
    paymentMethod: "prazo",
    amountPaid: "",
    saleDate: toDateInputValue(saleDate),
    dueDate: toDateInputValue(dueDate),
    tripName: "",
    tripCity: "",
    items: [{ ...emptyItem }],
  };
}

export default function SalesPage() {
  const receiptRef = useRef(null);
  const [selectedReceiptSale, setSelectedReceiptSale] = useState(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const location = useLocation();
  const requestedClientId = location.state?.newSaleClientId || "";
  const [tripFilter, setTripFilter] = useState("fourth");
  const [searchText, setSearchText] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [receiptPdf, setReceiptPdf] = useState({ key: null, status: "idle", file: null });
  const [receiptNotice, setReceiptNotice] = useState("");
  const [sortOrder, setSortOrder] = useState("newest");
  const [salesLoadError, setSalesLoadError] = useState("");

  const [sale, setSale] = useState(() => ({
    ...createEmptySale(),
    clientId: requestedClientId,
  }));
  const [showSaleForm, setShowSaleForm] = useState(Boolean(requestedClientId));
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingSaleId, setEditingSaleId] = useState(null);
  const [receivingSaleId, setReceivingSaleId] = useState(null);
  const receivingSaleLock = useRef(false);
  const pendingPaymentOperation = useRef(null);

  useEffect(() => {
    let unsubscribeClients = null;
    let unsubscribeProducts = null;
    let unsubscribeSales = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (unsubscribeClients) unsubscribeClients();
      if (unsubscribeProducts) unsubscribeProducts();
      if (unsubscribeSales) unsubscribeSales();

      if (!user) {
        setClients([]);
        setProducts([]);
        setSales([]);
        setSalesLoadError("");
        setLoading(false);
        return;
      }

      setSalesLoadError("");
      setLoading(true);
      const clientsReference = collection(
        db,
        "users",
        user.uid,
        "clients"
      );

      const productsReference = collection(
        db,
        "users",
        user.uid,
        "products"
      );

      const salesReference = collection(
        db,
        "users",
        user.uid,
        "sales"
      );

      unsubscribeClients = onSnapshot(
        clientsReference,
        (snapshot) => {
          const list = snapshot.docs.map((document) => ({
            id: document.id,
            ...document.data(),
          }));

          list.sort((first, second) =>
            String(first.name || "").localeCompare(
              String(second.name || ""),
              "pt-BR"
            )
          );

          setClients(list);
        },
        (error) => {
          console.error("Erro ao carregar clientes:", error);
        }
      );

      unsubscribeProducts = onSnapshot(
        productsReference,
        (snapshot) => {
          const list = snapshot.docs.map((document) => ({
            id: document.id,
            ...document.data(),
          }));

          list.sort((first, second) =>
            String(first.name || "").localeCompare(
              String(second.name || ""),
              "pt-BR"
            )
          );

          setProducts(list);
        },
        (error) => {
          console.error("Erro ao carregar produtos:", error);
        }
      );

      unsubscribeSales = onSnapshot(
        salesReference,
        (snapshot) => {
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
          setSalesLoadError("");
          setLoading(false);
        },
        (error) => {
          console.error("Erro ao carregar vendas:", error);
          setSalesLoadError(
            "Não foi possível carregar o histórico de vendas. Confira sua conexão e tente novamente."
          );
          setLoading(false);
        }
      );
    });

    return () => {
      unsubscribeAuth();

      if (unsubscribeClients) unsubscribeClients();
      if (unsubscribeProducts) unsubscribeProducts();
      if (unsubscribeSales) unsubscribeSales();
    };
  }, []);

  const selectedClient = useMemo(() => {
    return clients.find(
      (client) => client.id === sale.clientId
    );
  }, [clients, sale.clientId]);

  const clientsById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients]
  );

  const total = useMemo(() => {
    return calculateSaleAmounts(sale.items).total;
  }, [sale.items]);

  const amountPaid = Number(sale.amountPaid || 0);

  const pendingAmount = Math.max(total - amountPaid, 0);

  const saleStatus = calculateSaleAmounts(sale.items, amountPaid).status;

  const dashboardTotals = useMemo(() => {
    return sales.reduce(
      (summary, currentSale) => {
        summary.totalSales += Number(
          currentSale.total || 0
        );

        summary.totalReceived += Number(
          currentSale.amountPaid || 0
        );

        summary.totalPending += Number(
          currentSale.pendingAmount || 0
        );

        return summary;
      },
      {
        totalSales: 0,
        totalReceived: 0,
        totalPending: 0,
      }
    );
  }, [sales]);

  const tripOrganization = useMemo(
    () => organizeSalesByTrip2026(sales),
    [sales]
  );

  const tripClassificationById = useMemo(() => {
    const classified = new Map();
    for (const sale of [
      ...tripOrganization.thirdTrip.sales,
      ...tripOrganization.fourthTrip.sales,
      ...tripOrganization.review.sales,
    ]) {
      classified.set(sale.id, sale);
    }
    return classified;
  }, [tripOrganization]);

  const displayedSales = useMemo(() => {
    let filteredSales;
    if (tripFilter === "third") filteredSales = tripOrganization.thirdTrip.sales;
    else if (tripFilter === "fourth") filteredSales = tripOrganization.fourthTrip.sales;
    else if (tripFilter === "review") filteredSales = tripOrganization.review.sales;
    else {
      filteredSales = sales.map((sale) => {
      const classification = tripClassificationById.get(sale.id);
      return {
        ...sale,
        originalSaleDate: classification?.originalSaleDate || null,
        dateSource: classification?.dateSource || null,
        tripNumber: classification?.tripNumber || null,
        reviewReason:
          classification?.reviewReason || "Não foi possível avaliar esta venda.",
      };
      });
    }

    const search = searchText.trim().toLocaleLowerCase("pt-BR");
    return filteredSales
      .filter((sale) => {
        if (!search) return true;
        const clientName =
          clientsById.get(sale.clientId)?.name || sale.clientName || "";
        return clientName.toLocaleLowerCase("pt-BR").includes(search);
      })
      .sort((first, second) => {
        const firstDate = toDate(first.originalSaleDate)?.getTime();
        const secondDate = toDate(second.originalSaleDate)?.getTime();
        if (firstDate === undefined && secondDate === undefined) return 0;
        if (firstDate === undefined) return 1;
        if (secondDate === undefined) return -1;
        return sortOrder === "oldest"
          ? firstDate - secondDate
          : secondDate - firstDate;
      });
  }, [
    sales,
    tripFilter,
    tripOrganization,
    tripClassificationById,
    clientsById,
    searchText,
    sortOrder,
  ]);

  function formatCurrency(value) {
    return Number(value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }

  function formatDate(timestamp) {
    const date = toDate(timestamp);
    if (!date) return "Data não informada";

    return date.toLocaleString("pt-BR");
  }

  function formatDateOnly(value) {
    const date = toDate(value);
    if (!date) return "Não informado";

    return date.toLocaleDateString("pt-BR");
  }

  function isSaleOverdue(currentSale) {
    return checkSaleOverdue(
      currentSale.dueDate,
      currentSale.pendingAmount
    );
  }

  function formatStatus(status) {
    const statuses = {
      paid: {
        label: "Pago",
        color: "#16a34a",
        background: "#dcfce7",
      },
      partial: {
        label: "Parcial",
        color: "#ca8a04",
        background: "#fef9c3",
      },
      pending: {
        label: "Pendente",
        color: "#dc2626",
        background: "#fee2e2",
      },
    };

    return statuses[status] || statuses.pending;
  }

  function handleClientChange(event) {
    setSale((current) => ({
      ...current,
      clientId: event.target.value,
    }));
  }

  function handlePaymentMethodChange(event) {
    const paymentMethod = event.target.value;

    setSale((current) => ({
      ...current,
      paymentMethod,
      amountPaid:
        paymentMethod === "avista"
          ? String(total)
          : "",
      dueDate:
        paymentMethod === "avista" ? "" : current.dueDate || createEmptySale().dueDate,
    }));
  }

  function handleAmountPaidChange(event) {
    setSale((current) => ({
      ...current,
      amountPaid: event.target.value,
    }));
  }

  function addItem() {
    setSale((current) => ({
      ...current,
      items: [...current.items, { ...emptyItem }],
    }));
  }

  function removeItem(index) {
    setSale((current) => {
      const newItems = current.items.filter(
        (_, itemIndex) => itemIndex !== index
      );

      return {
        ...current,
        items:
          newItems.length > 0
            ? newItems
            : [{ ...emptyItem }],
      };
    });
  }

  function handleProductChange(index, productId) {
    const product = products.find(
      (currentProduct) =>
        currentProduct.id === productId
    );

    setSale((current) => {
      const newItems = [...current.items];

      newItems[index] = {
        ...newItems[index],
        productId,
        price: product
          ? String(product.salePrice || 0)
          : "",
      };

      const updatedSale = {
        ...current,
        items: newItems,
      };

      if (updatedSale.paymentMethod === "avista") {
        const updatedTotal = newItems.reduce(
          (sum, item) =>
            sum +
            Number(item.quantity || 0) *
              Number(item.price || 0),
          0
        );

        updatedSale.amountPaid =
          String(updatedTotal);
      }

      return updatedSale;
    });
  }

  function handleItemChange(index, field, value) {
    setSale((current) => {
      const newItems = [...current.items];

      newItems[index] = {
        ...newItems[index],
        [field]: value,
      };

      const updatedSale = {
        ...current,
        items: newItems,
      };

      if (updatedSale.paymentMethod === "avista") {
        const updatedTotal = newItems.reduce(
          (sum, item) =>
            sum +
            Number(item.quantity || 0) *
              Number(item.price || 0),
          0
        );

        updatedSale.amountPaid =
          String(updatedTotal);
      }

      return updatedSale;
    });
  }

  function clearSale() {
    setSale(createEmptySale());
    setClientSearch("");

    setEditingSaleId(null);
    setShowSaleForm(false);
  }

  function handleEditSale(currentSale) {
    const saleDate =
      toDate(currentSale.saleDate) ||
      toDate(currentSale.createdAt) ||
      new Date();

    const legacyDueDate =
      currentSale.dueDate ||
      currentSale.paymentDueDate ||
      currentSale.collectionDate ||
      currentSale.dataCobranca ||
      "";

    setEditingSaleId(currentSale.id);
    setShowSaleForm(true);

    setSale({
      clientId: currentSale.clientId || "",
      paymentMethod: currentSale.paymentMethod || "prazo",
      amountPaid: String(currentSale.amountPaid || 0),
      saleDate: toDateInputValue(saleDate),
      dueDate: toDateInputValue(legacyDueDate),
      tripName: currentSale.tripName || "",
      tripCity: currentSale.tripCity || "",
      items:
        (currentSale.items || []).length > 0
          ? currentSale.items.map((item) => ({
              productId: item.productId || "",
              quantity: Number(item.quantity || 1),
              price: String(item.unitPrice || 0),
            }))
          : [{ ...emptyItem }],
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleReceiveSale(currentSale) {
    if (receivingSaleLock.current) return;

    const user = auth.currentUser;

    if (!user) {
      alert("Você precisa entrar novamente no sistema.");
      return;
    }

    const currentPending = Number(currentSale.pendingAmount || 0);

    if (currentPending <= 0) {
      alert("Essa venda já está totalmente paga.");
      return;
    }

    receivingSaleLock.current = true;
    const typedValue = window.prompt(
      `Saldo pendente: ${formatCurrency(currentPending)}\n\nDigite o valor recebido:`
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
      alert("O recebimento não pode ser maior que o saldo pendente.");
      receivingSaleLock.current = false;
      return;
    }

    try {
      setReceivingSaleId(currentSale.id);

      const saleReference = doc(
        db,
        "users",
        user.uid,
        "sales",
        currentSale.id
      );

      const paymentsReference = collection(
        db,
        "users",
        user.uid,
        "sales",
        currentSale.id,
        "payments"
      );
      const paymentOperation = reusePaymentOperation(
        pendingPaymentOperation.current,
        currentSale.id,
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
            `O saldo atual desta venda é ${formatCurrency(savedPending)}.`
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
          saleId: currentSale.id,
          clientId: currentSale.clientId || "",
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

  function handleOpenReceipt(currentSale) {
    setSelectedReceiptSale(prepareSaleReceipt(currentSale));
    setShowReceipt(true);
  }

  function handleCloseReceipt() {
    setShowReceipt(false);
    setSelectedReceiptSale(null);
    setReceiptNotice("");
  }

  async function handleDownloadReceipt() {
    if (!receiptRef.current || !selectedReceiptSale) return;

    try {
      if (receiptStatus === "ready" && receiptPdf.file) {
        downloadReceiptFile(receiptPdf.file);
        return;
      }

      await generateReceiptPdf(
        receiptRef.current,
        selectedReceiptSale.receiptNumber
      );
    } catch (error) {
      console.error("Erro ao gerar PDF do recibo:", error);
      alert("Não foi possível gerar o PDF do recibo.");
    }
  }

  const receiptKey = showReceipt && selectedReceiptSale ? String(selectedReceiptSale.receiptNumber) : null;
  const receiptStatus = receiptKey && receiptPdf.key === receiptKey ? receiptPdf.status : "preparing";

  // Gera o PDF assim que o recibo abre, para o clique em Compartilhar ser imediato
  // (o navegador exige que o compartilhamento ocorra logo após o toque).
  useEffect(() => {
    if (!receiptKey) return undefined;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const file = await buildReceiptPdfFile(receiptRef.current, receiptKey);
        if (!cancelled) setReceiptPdf({ key: receiptKey, status: "ready", file });
      } catch (error) {
        console.error("Erro ao gerar PDF do recibo:", error);
        if (!cancelled) setReceiptPdf({ key: receiptKey, status: "error", file: null });
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [receiptKey]);

  function handleRetryReceipt() {
    setReceiptNotice("");
    const key = receiptKey;
    setReceiptPdf({ key: null, status: "idle", file: null });
    buildReceiptPdfFile(receiptRef.current, key)
      .then((file) => setReceiptPdf({ key, status: "ready", file }))
      .catch((error) => {
        console.error("Erro ao gerar PDF do recibo:", error);
        setReceiptPdf({ key, status: "error", file: null });
      });
  }

  async function handleShareReceipt() {
    const file = receiptPdf.file;
    if (!file || receiptStatus !== "ready") return;

    setReceiptNotice("");

    if (!canShareReceiptFile(file)) {
      setReceiptNotice(
        "Este navegador ou dispositivo não permite compartilhar o PDF diretamente. Use “Baixar PDF” e envie o arquivo pelo WhatsApp."
      );
      return;
    }

    try {
      await shareReceiptFile(file);
    } catch (error) {
      console.error("Erro ao compartilhar recibo:", error);
      setReceiptNotice(
        "Não foi possível abrir o compartilhamento. O PDF foi baixado para você enviar manualmente."
      );
      downloadReceiptFile(file);
    }
  }

  async function handlePrintReceipt() {
    if (!selectedReceiptSale || !receiptRef.current) return;

    try {
      await printReceipt(receiptRef.current);
    } catch (error) {
      console.error("Erro ao imprimir recibo:", error);
      alert("Não foi possível abrir a impressão do recibo.");
    }
  }

  async function handleDeleteSale(currentSale) {
    const user = auth.currentUser;

    if (!user) {
      alert("Você precisa entrar novamente no sistema.");
      return;
    }

    const confirmed = window.confirm(
      `Deseja excluir a venda de ${
        currentSale.clientName || "este cliente"
      }?\n\nOs produtos voltarão ao estoque.`
    );

    if (!confirmed) return;

    try {
      const saleReference = doc(
        db,
        "users",
        user.uid,
        "sales",
        currentSale.id
      );

      await runTransaction(db, async (transaction) => {
        const saleSnapshot = await transaction.get(saleReference);

        if (!saleSnapshot.exists()) {
          throw new Error("Venda não encontrada.");
        }

        const savedSale = saleSnapshot.data();
        if (Number(savedSale.amountPaid || 0) > 0) {
          throw new Error(
            "Esta compra possui recebimentos. Para preservar o histórico financeiro, ajuste-a sem excluir."
          );
        }

        let legacyClientReference = null;
        let legacyClientData = null;

        if (savedSale.balanceModel !== "per-sale") {
          if (!savedSale.clientId) {
            throw new Error(
              "Esta compra antiga não está vinculada a um cliente. Concilie-a antes de excluí-la."
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

        const productDataList = [];

        for (const item of savedSale.items || []) {
          const productReference = doc(
            db,
            "users",
            user.uid,
            "products",
            item.productId
          );

          const productSnapshot = await transaction.get(productReference);

          productDataList.push({
            item,
            reference: productReference,
            snapshot: productSnapshot,
          });
        }

        for (const productData of productDataList) {
          if (productData.snapshot.exists()) {
            const currentQuantity = Number(
              productData.snapshot.data().quantity || 0
            );

            transaction.update(productData.reference, {
              quantity:
                currentQuantity + Number(productData.item.quantity || 0),
              updatedAt: serverTimestamp(),
            });
          }
        }

        if (legacyClientReference && legacyClientData) {
          const updatedLegacyDebt = adjustLegacyClientDebt(
            savedSale,
            legacyClientData.totalDebt,
            Number(savedSale.pendingAmount || 0),
            0
          );

          transaction.update(legacyClientReference, {
            totalDebt: updatedLegacyDebt,
            status: updatedLegacyDebt === 0 ? "paid" : "partial",
            updatedAt: serverTimestamp(),
          });
        }

        transaction.delete(saleReference);
      });

      if (editingSaleId === currentSale.id) clearSale();

      alert("Venda excluída e produtos devolvidos ao estoque!");
    } catch (error) {
      console.error("Erro ao excluir venda:", error);
      alert(`Erro ao excluir venda: ${error.message}`);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const user = auth.currentUser;

    if (!user) {
      alert("Você precisa entrar novamente no sistema.");
      return;
    }

    if (!sale.clientId) {
      alert("Selecione o cliente.");
      return;
    }

    if (!sale.saleDate) {
      alert("Informe a data da compra.");
      return;
    }

    if (
      sale.paymentMethod === "prazo" &&
      !sale.dueDate
    ) {
      alert("Informe o vencimento da compra a prazo.");
      return;
    }

    if (
      sale.dueDate &&
      toDate(sale.dueDate) < toDate(sale.saleDate)
    ) {
      alert("O vencimento não pode ser anterior à data da compra.");
      return;
    }
    if (sale.items.length === 0) {
      alert("Adicione pelo menos um produto.");
      return;
    }

    const invalidItem = sale.items.find(
      (item) =>
        !item.productId ||
        Number(item.quantity || 0) <= 0 ||
        Number(item.price || 0) < 0
    );

    if (invalidItem) {
      alert(
        "Confira os produtos, quantidades e preços da venda."
      );
      return;
    }

    const productIds = sale.items.map(
      (item) => item.productId
    );

    const hasDuplicatedProduct =
      new Set(productIds).size !== productIds.length;

    if (hasDuplicatedProduct) {
      alert(
        "O mesmo produto foi adicionado mais de uma vez. Ajuste a quantidade em uma única linha."
      );
      return;
    }

    if (total <= 0) {
      alert("O total da venda precisa ser maior que zero.");
      return;
    }

    if (amountPaid < 0) {
      alert("O valor recebido não pode ser negativo.");
      return;
    }

    if (amountPaid > total) {
      alert(
        "O valor recebido não pode ser maior que o total da venda."
      );
      return;
    }

    if (
      !editingSaleId &&
      sale.paymentMethod === "avista" &&
      amountPaid !== total
    ) {
      alert(
        "Na venda à vista, o valor recebido deve ser igual ao total."
      );
      return;
    }

    try {
      setSaving(true);

      if (editingSaleId) {
        const originalSale = sales.find(
          (currentSale) => currentSale.id === editingSaleId
        );

        if (
          originalSale &&
          Number(originalSale.amountPaid || 0) > 0 &&
          originalSale.clientId !== sale.clientId
        ) {
          alert(
            "Não é possível trocar o cliente de uma compra com recebimentos registrados."
          );
          return;
        }

        await updateExistingSale();
        alert("Venda atualizada com sucesso!");
        clearSale();
        return;
      }

      const clientReference = doc(
        db,
        "users",
        user.uid,
        "clients",
        sale.clientId
      );

      const saleReference = doc(
        collection(
          db,
          "users",
          user.uid,
          "sales"
        )
      );

      const initialPaymentReference =
        amountPaid > 0
          ? doc(
              collection(
                db,
                "users",
                user.uid,
                "sales",
                saleReference.id,
                "payments"
              )
            )
          : null;

      const productReferences = sale.items.map(
        (item) => ({
          item,
          reference: doc(
            db,
            "users",
            user.uid,
            "products",
            item.productId
          ),
        })
      );

      await runTransaction(
        db,
        async (transaction) => {
          const clientSnapshot =
            await transaction.get(clientReference);

          if (!clientSnapshot.exists()) {
            throw new Error(
              "O cliente selecionado não foi encontrado."
            );
          }

          const productSnapshots = [];

          for (const productData of productReferences) {
            const productSnapshot =
              await transaction.get(
                productData.reference
              );

            productSnapshots.push({
              ...productData,
              snapshot: productSnapshot,
            });
          }

          const savedItems = productSnapshots.map(
            ({ item, reference, snapshot }) => {
              if (!snapshot.exists()) {
                throw new Error(
                  "Um dos produtos selecionados não foi encontrado."
                );
              }

              const product = snapshot.data();

              const currentQuantity = Number(
                product.quantity || 0
              );

              const saleQuantity = Number(
                item.quantity || 0
              );

              if (saleQuantity > currentQuantity) {
                throw new Error(
                  `Estoque insuficiente para ${product.name}. Disponível: ${currentQuantity}.`
                );
              }

              transaction.update(reference, {
                quantity: updateStockAfterSale(
                  currentQuantity,
                  saleQuantity
                ),
                updatedAt: serverTimestamp(),
              });

              return {
                productId: snapshot.id,
                code: product.code || "",
                name: product.name || "",
                category:
                  product.category || "",
                size: product.size || "",
                color: product.color || "",
                quantity: saleQuantity,
                unitPrice: Number(item.price || 0),
                subtotal:
                  saleQuantity *
                  Number(item.price || 0),
              };
            }
          );

          const clientData = clientSnapshot.data();

          transaction.set(saleReference, {
            balanceModel: "per-sale",
            clientId: sale.clientId,
            clientName:
              clientData.name ||
              selectedClient?.name ||
              "",
            items: savedItems,
            total,
            amountPaid,
            pendingAmount,
            paymentMethod:
              sale.paymentMethod,
            status: saleStatus,
            saleDate: new Date(`${sale.saleDate}T12:00:00`),
            dueDate: sale.dueDate
              ? new Date(`${sale.dueDate}T12:00:00`)
              : null,
            tripName: sale.tripName.trim(),
            tripCity: sale.tripCity.trim(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          if (initialPaymentReference) {
            transaction.set(initialPaymentReference, {
              saleId: saleReference.id,
              clientId: sale.clientId,
              value: amountPaid,
              previousBalance: total,
              remainingBalance: pendingAmount,
              type: "initial",
              createdAt: serverTimestamp(),
            });
          }
        }
      );

      alert("Venda registrada com sucesso!");

      clearSale();
    } catch (error) {
      console.error("Erro ao registrar venda:", error);

      alert(
        `Erro ao registrar venda: ${error.message}`
      );
    } finally {
      setSaving(false);
    }
  }


  async function updateExistingSale() {
    const user = auth.currentUser;

    if (!user) {
      throw new Error("Você precisa entrar novamente no sistema.");
    }

    const saleReference = doc(
      db,
      "users",
      user.uid,
      "sales",
      editingSaleId
    );

    await runTransaction(db, async (transaction) => {
      const oldSaleSnapshot = await transaction.get(saleReference);

      if (!oldSaleSnapshot.exists()) {
        throw new Error("A venda não foi encontrada.");
      }

      const oldSale = oldSaleSnapshot.data();
      const savedPaid = Number(oldSale.amountPaid || 0);

      if (
        savedPaid > 0 &&
        Math.round(total * 100) !==
          Math.round(Number(oldSale.total || 0) * 100)
      ) {
        throw new Error(
          "Não é possível alterar os produtos ou o total de uma compra com recebimentos. Ajuste somente os dados de data e viagem."
        );
      }

      if (total < savedPaid) {
        throw new Error(
          `O total da compra não pode ser menor que o valor já recebido (${formatCurrency(savedPaid)}).`
        );
      }

      const updatedPending = Math.max(total - savedPaid, 0);

      const newClientReference = doc(
        db,
        "users",
        user.uid,
        "clients",
        sale.clientId
      );

      const newClientSnapshot = await transaction.get(newClientReference);

      if (!newClientSnapshot.exists()) {
        throw new Error("O cliente selecionado não foi encontrado.");
      }

      let oldLegacyClientReference = null;
      let oldLegacyClientData = null;
      let newLegacyClientData = null;

      if (oldSale.balanceModel !== "per-sale") {
        if (!oldSale.clientId) {
          throw new Error(
            "Esta compra antiga não está vinculada a um cliente. Concilie-a antes de editá-la."
          );
        }

        oldLegacyClientReference = doc(
          db,
          "users",
          user.uid,
          "clients",
          oldSale.clientId
        );

        if (oldSale.clientId === sale.clientId) {
          oldLegacyClientData = newClientSnapshot.data();
        } else {
          const oldLegacyClientSnapshot = await transaction.get(
            oldLegacyClientReference
          );

          if (!oldLegacyClientSnapshot.exists()) {
            throw new Error(
              "O cliente original desta compra antiga não foi encontrado."
            );
          }

          oldLegacyClientData = oldLegacyClientSnapshot.data();
        }

        newLegacyClientData = newClientSnapshot.data();
      }

      const productReferences = new Map();

      for (const oldItem of oldSale.items || []) {
        productReferences.set(
          oldItem.productId,
          doc(
            db,
            "users",
            user.uid,
            "products",
            oldItem.productId
          )
        );
      }

      for (const newItem of sale.items) {
        productReferences.set(
          newItem.productId,
          doc(
            db,
            "users",
            user.uid,
            "products",
            newItem.productId
          )
        );
      }

      const productSnapshots = new Map();

      for (const [productId, reference] of productReferences) {
        productSnapshots.set(productId, await transaction.get(reference));
      }

      const oldQuantities = new Map();
      const newQuantities = new Map();

      for (const oldItem of oldSale.items || []) {
        oldQuantities.set(
          oldItem.productId,
          Number(oldItem.quantity || 0)
        );
      }

      for (const newItem of sale.items) {
        newQuantities.set(
          newItem.productId,
          Number(newItem.quantity || 0)
        );
      }

      const savedItems = sale.items.map((newItem) => {
        const snapshot = productSnapshots.get(newItem.productId);

        if (!snapshot?.exists()) {
          throw new Error(
            "Um dos produtos selecionados não foi encontrado."
          );
        }

        const product = snapshot.data();
        const currentQuantity = Number(product.quantity || 0);
        const oldQuantity = Number(
          oldQuantities.get(newItem.productId) || 0
        );
        const newQuantity = Number(newItem.quantity || 0);
        const available = currentQuantity + oldQuantity;

        if (newQuantity > available) {
          throw new Error(
            `Estoque insuficiente para ${product.name}. Disponível para edição: ${available}.`
          );
        }

        return {
          productId: snapshot.id,
          code: product.code || "",
          name: product.name || "",
          category: product.category || "",
          size: product.size || "",
          color: product.color || "",
          quantity: newQuantity,
          unitPrice: Number(newItem.price || 0),
          subtotal:
            newQuantity * Number(newItem.price || 0),
        };
      });

      for (const [productId, reference] of productReferences) {
        const snapshot = productSnapshots.get(productId);

        if (!snapshot?.exists()) continue;

        const currentQuantity = Number(snapshot.data().quantity || 0);
        const oldQuantity = Number(oldQuantities.get(productId) || 0);
        const newQuantity = Number(newQuantities.get(productId) || 0);
        const updatedQuantity = updateStockAfterSaleEdit(
          currentQuantity,
          oldQuantity,
          newQuantity
        );

        transaction.update(reference, {
          quantity: updatedQuantity,
          updatedAt: serverTimestamp(),
        });
      }

      if (oldLegacyClientReference && oldLegacyClientData) {
        const oldPending = Number(oldSale.pendingAmount || 0);

        if (oldSale.clientId === sale.clientId) {
          const updatedLegacyDebt = adjustLegacyClientDebt(
            oldSale,
            oldLegacyClientData.totalDebt,
            oldPending,
            updatedPending
          );

          transaction.update(oldLegacyClientReference, {
            totalDebt: updatedLegacyDebt,
            updatedAt: serverTimestamp(),
          });
        } else {
          const updatedOldClientDebt = adjustLegacyClientDebt(
            oldSale,
            oldLegacyClientData.totalDebt,
            oldPending,
            0
          );
          const updatedNewClientDebt = adjustLegacyClientDebt(
            oldSale,
            newLegacyClientData.totalDebt,
            0,
            updatedPending
          );

          transaction.update(oldLegacyClientReference, {
            totalDebt: updatedOldClientDebt,
            updatedAt: serverTimestamp(),
          });
          transaction.update(newClientReference, {
            totalDebt: updatedNewClientDebt,
            updatedAt: serverTimestamp(),
          });
        }
      }

      transaction.update(saleReference, {
        ...(oldSale.balanceModel === "per-sale"
          ? { balanceModel: "per-sale" }
          : {}),
        clientId: sale.clientId,
        clientName:
          newClientSnapshot.data().name ||
          selectedClient?.name ||
          "",
        items: savedItems,
        total,
        amountPaid: savedPaid,
        pendingAmount: updatedPending,
        paymentMethod: sale.paymentMethod,
        status: updatedPending === 0 ? "paid" : savedPaid > 0 ? "partial" : "pending",
        saleDate: new Date(`${sale.saleDate}T12:00:00`),
        dueDate: sale.dueDate
          ? new Date(`${sale.dueDate}T12:00:00`)
          : null,
        tripName: sale.tripName.trim(),
        tripCity: sale.tripCity.trim(),
        updatedAt: serverTimestamp(),
      });
    });
  }

  const tripFilterLabels = {
    all: "Todas as vendas",
    third: "3ª viagem (proposta)",
    fourth: "4ª viagem (proposta)",
    review: "Em revisão",
  };

  const displayedTotals = displayedSales.reduce(
    (summary, currentSale) => ({
      sold: summary.sold + Number(currentSale.total || 0),
      received: summary.received + Number(currentSale.amountPaid || 0),
      pending: summary.pending + Number(currentSale.pendingAmount || 0),
    }),
    { sold: 0, received: 0, pending: 0 }
  );

  const clientSearchTerm = clientSearch.trim().toLocaleLowerCase("pt-BR");
  const clientOptions = clients.filter((client) => {
    if (client.id === sale.clientId) return true;
    if (!clientSearchTerm) return true;
    return [client.name, client.nickname, client.city, client.phone].some(
      (field) =>
        String(field || "").toLocaleLowerCase("pt-BR").includes(clientSearchTerm)
    );
  });

  const tripScopeSummary =
    tripFilter === "third"
      ? tripOrganization.thirdTrip
      : tripFilter === "fourth"
        ? tripOrganization.fourthTrip
        : tripFilter === "review"
          ? tripOrganization.review
          : null;

  const scopeTotals = tripScopeSummary
    ? {
        sold: tripScopeSummary.sold,
        received: tripScopeSummary.received,
        pending: tripScopeSummary.pending,
        count: tripScopeSummary.count,
      }
    : {
        sold: dashboardTotals.totalSales,
        received: dashboardTotals.totalReceived,
        pending: dashboardTotals.totalPending,
        count: sales.length,
      };

  const kpis = [
    { label: "Total vendido", value: formatCurrency(scopeTotals.sold), icon: LuShoppingBag, tone: "navy" },
    { label: "Total recebido", value: formatCurrency(scopeTotals.received), icon: LuCircleCheck, tone: "green" },
    { label: "Total pendente", value: formatCurrency(scopeTotals.pending), icon: LuClock, tone: "red" },
    { label: "Quantidade de vendas", value: scopeTotals.count, icon: LuReceipt, tone: "gold" },
  ];

  return (
    <div className="cl sl">
      <header className="cl-header">
        <div>
          <p className="cl-eyebrow">RC Confecções</p>
          <h1>Vendas</h1>
          <p className="cl-subtitle">
            Registre compras e acompanhe cada saldo por viagem.
          </p>
        </div>

        <button
          type="button"
          className="cl-btn cl-btn-primary cl-new"
          onClick={() => setShowSaleForm((current) => !current)}
          aria-expanded={showSaleForm}
          aria-controls="new-sale-form"
        >
          {showSaleForm ? (
            <><LuX aria-hidden="true" /> Fechar formulário</>
          ) : (
            <><LuPlus aria-hidden="true" /> Nova venda</>
          )}
        </button>
      </header>

      <p className="sl-scope">
        Indicadores de: <strong>{tripFilterLabels[tripFilter]}</strong>
        {" "}— altere no filtro de viagem.
      </p>

      <div className="sl-kpis">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;

          return (
            <article key={kpi.label} className={`cl-kpi cl-kpi-${kpi.tone} sl-kpi`}>
              <span className="cl-kpi-icon"><Icon aria-hidden="true" /></span>
              <span className="cl-kpi-label">{kpi.label}</span>
              <strong>{kpi.value}</strong>
            </article>
          );
        })}
      </div>

      {showSaleForm && (
        <section id="new-sale-form" className="cl-panel sl-form">
            <form onSubmit={handleSubmit}>
          <div style={styles.formTitleRow}>
            <h2 style={styles.cardTitle}>
              {editingSaleId ? "Editar venda" : "Nova venda"}
            </h2>

            {editingSaleId && (
              <button
                type="button"
                onClick={clearSale}
                style={styles.cancelEditButton}
              >
                Cancelar edição
              </button>
            )}
          </div>

          <div className="sl-client">
            <label className="sl-client-search">
              Cliente
              <span className="cl-search">
                <LuSearch aria-hidden="true" />
                <input
                  type="search"
                  value={clientSearch}
                  onChange={(event) => setClientSearch(event.target.value)}
                  placeholder="Buscar cliente: nome, apelido, cidade"
                  disabled={saving}
                />
              </span>
            </label>

            <select
              aria-label="Cliente da venda"
              value={sale.clientId}
              onChange={handleClientChange}
              required
              disabled={saving}
              style={styles.input}
            >
              <option value="">
                {clientOptions.length === 0
                  ? "Nenhum cliente encontrado"
                  : "Selecione um cliente"}
              </option>

              {clientOptions.map((client) => (
                <option
                  key={client.id}
                  value={client.id}
                >
                  {client.name}
                  {client.nickname ? ` (${client.nickname})` : ""}
                  {client.city ? ` — ${client.city}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.itemGrid}>
            <label style={styles.label}>
              Data da compra
              <input
                type="date"
                value={sale.saleDate}
                onChange={(event) =>
                  setSale((current) => ({
                    ...current,
                    saleDate: event.target.value,
                  }))
                }
                required
                disabled={saving}
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Vencimento
              <input
                type="date"
                value={sale.dueDate}
                onChange={(event) =>
                  setSale((current) => ({
                    ...current,
                    dueDate: event.target.value,
                  }))
                }
                disabled={saving || sale.paymentMethod === "avista"}
                style={styles.input}
              />
            </label>
          </div>

          <div style={styles.itemGrid}>
            <label style={styles.label}>
              Viagem (opcional)
              <input
                type="text"
                value={sale.tripName}
                onChange={(event) =>
                  setSale((current) => ({
                    ...current,
                    tripName: event.target.value,
                  }))
                }
                placeholder="Ex.: Viagem de outubro"
                disabled={saving}
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Cidade da viagem (opcional)
              <input
                type="text"
                value={sale.tripCity}
                onChange={(event) =>
                  setSale((current) => ({
                    ...current,
                    tripCity: event.target.value,
                  }))
                }
                placeholder="Ex.: Campinas"
                disabled={saving}
                style={styles.input}
              />
            </label>
          </div>

          <div style={styles.itemsHeader}>
            <h3 style={styles.sectionTitle}>
              Produtos da venda
            </h3>

            <button
              type="button"
              onClick={addItem}
              disabled={saving}
              style={styles.addButton}
            >
              + Adicionar produto
            </button>
          </div>

          <div style={styles.itemsList}>
            {sale.items.map((item, index) => {
              const product = products.find(
                (currentProduct) =>
                  currentProduct.id ===
                  item.productId
              );

              return (
                <div
                  key={index}
                  style={styles.itemCard}
                >
                  <label style={styles.label}>
                    Produto
                    <select
                      value={item.productId}
                      onChange={(event) =>
                        handleProductChange(
                          index,
                          event.target.value
                        )
                      }
                      required
                      disabled={saving}
                      style={styles.input}
                    >
                      <option value="">
                        Selecione o produto
                      </option>

                      {products.map(
                        (currentProduct) => (
                          <option
                            key={
                              currentProduct.id
                            }
                            value={
                              currentProduct.id
                            }
                            disabled={
                              Number(
                                currentProduct.quantity ||
                                  0
                              ) <= 0
                            }
                          >
                            {currentProduct.name} —{" "}
                            {currentProduct.code} —{" "}
                            Estoque:{" "}
                            {Number(
                              currentProduct.quantity ||
                                0
                            )}
                          </option>
                        )
                      )}
                    </select>
                  </label>

                  {product && (
                    <p style={styles.stockInfo}>
                      Estoque disponível:{" "}
                      <strong>
                        {Number(
                          product.quantity || 0
                        )}
                      </strong>
                    </p>
                  )}

                  <div style={styles.itemGrid}>
                    <label style={styles.label}>
                      Quantidade
                      <input
                        type="number"
                        min="1"
                        max={
                          product
                            ? Number(
                                product.quantity ||
                                  0
                              )
                            : undefined
                        }
                        step="1"
                        value={item.quantity}
                        onChange={(event) =>
                          handleItemChange(
                            index,
                            "quantity",
                            event.target.value
                          )
                        }
                        required
                        disabled={saving}
                        style={styles.input}
                      />
                    </label>

                    <label style={styles.label}>
                      Preço unitário
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.price}
                        onChange={(event) =>
                          handleItemChange(
                            index,
                            "price",
                            event.target.value
                          )
                        }
                        required
                        disabled={saving}
                        style={styles.input}
                      />
                    </label>
                  </div>

                  <div style={styles.itemFooter}>
                    <strong>
                      Subtotal:{" "}
                      {formatCurrency(
                        Number(
                          item.quantity || 0
                        ) *
                          Number(
                            item.price || 0
                          )
                      )}
                    </strong>

                    <button
                      type="button"
                      onClick={() =>
                        removeItem(index)
                      }
                      disabled={saving}
                      style={styles.removeButton}
                    >
                      Remover
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={styles.totalBox}>
            <span>Total da venda</span>

            <strong>
              {formatCurrency(total)}
            </strong>
          </div>

          <label style={styles.label}>
            Forma de pagamento
            <select
              value={sale.paymentMethod}
              onChange={
                handlePaymentMethodChange
              }
              disabled={saving || Boolean(editingSaleId)}
              style={styles.input}
            >
              <option value="prazo">
                A prazo
              </option>

              <option value="avista">
                À vista
              </option>
            </select>
          </label>

          <label style={styles.label}>
            {editingSaleId ? "Total recebido até agora" : "Valor recebido agora"}
            <input
              type="number"
              min="0"
              max={total}
              step="0.01"
              value={sale.amountPaid}
              onChange={
                handleAmountPaidChange
              }
              disabled={
                saving ||
                Boolean(editingSaleId) ||
                sale.paymentMethod ===
                  "avista"
              }
              placeholder="0,00"
              style={styles.input}
            />
          </label>

          <div style={styles.paymentSummary}>
            <div>
              <span style={styles.smallLabel}>
                Recebido
              </span>

              <strong style={styles.receivedValue}>
                {formatCurrency(
                  amountPaid
                )}
              </strong>
            </div>

            <div>
              <span style={styles.smallLabel}>
                Ficará pendente
              </span>

              <strong style={styles.pendingValue}>
                {formatCurrency(
                  pendingAmount
                )}
              </strong>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            style={{
              ...styles.saveButton,
              opacity: saving ? 0.65 : 1,
              cursor: saving
                ? "not-allowed"
                : "pointer",
            }}
          >
            {saving
              ? editingSaleId
                ? "Salvando alterações..."
                : "Registrando venda..."
              : editingSaleId
                ? "Salvar alterações"
                : "Finalizar venda"}
          </button>
            </form>
        </section>
      )}

      <section className="cl-panel">
        <div className="sl-heading">
          <h2>Vendas registradas</h2>
          <p>
            Classificação por viagem é apenas uma proposta, baseada na data da
            venda (ou na data de criação do registro). Nada será alterado até
            sua aprovação.
          </p>
        </div>

        {loading ? (
          <div className="cl-empty"><strong>Calculando os totais por viagem...</strong></div>
        ) : salesLoadError ? (
          <div className="cl-empty" role="alert"><strong>{salesLoadError}</strong></div>
        ) : (
          <div className="sl-trips">
            <TripSummaryCard title="3ª viagem" period="jul-set/2026" summary={tripOrganization.thirdTrip} />
            <TripSummaryCard title="4ª viagem" period="out-dez/2026" summary={tripOrganization.fourthTrip} />
            <TripSummaryCard title="Revisão necessária" period="data ou valores a conferir" summary={tripOrganization.review} review />
          </div>
        )}

        <div className="sl-filters">
          <label>
            Viagem
            <select value={tripFilter} onChange={(event) => setTripFilter(event.target.value)}>
              <option value="all">Todas as vendas</option>
              <option value="third">Candidatas à 3ª viagem</option>
              <option value="fourth">Candidatas à 4ª viagem</option>
              <option value="review">Separadas para revisão</option>
            </select>
          </label>
          <label className="sl-filter-search">
            Cliente
            <span className="cl-search">
              <LuSearch aria-hidden="true" />
              <input
                type="search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Buscar por nome do cliente"
              />
            </span>
          </label>
          <label>
            Ordenar por data
            <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
              <option value="newest">Mais recente primeiro</option>
              <option value="oldest">Mais antiga primeiro</option>
            </select>
          </label>
        </div>

        {!loading && !salesLoadError && (
          <p className="cl-count">
            {displayedSales.length} de {sales.length} venda(s)
            {tripFilter !== "all" || searchText.trim() ? (
              <>
                {" "}· {tripFilter !== "all" ? tripFilterLabels[tripFilter] : "Busca"}:{" "}
                vendido <strong>{formatBRL(displayedTotals.sold)}</strong> · recebido{" "}
                <strong>{formatBRL(displayedTotals.received)}</strong> · pendente{" "}
                <strong>{formatBRL(displayedTotals.pending)}</strong>
              </>
            ) : null}
          </p>
        )}

        {loading ? (
          <div className="cl-empty"><strong>Carregando vendas...</strong></div>
        ) : salesLoadError ? (
          <div className="cl-empty" role="alert">
            <strong>Erro ao carregar vendas</strong>
            <span>{salesLoadError}</span>
          </div>
        ) : sales.length === 0 ? (
          <div className="cl-empty">
            <strong>Nenhuma venda registrada</strong>
            <span>As vendas aparecerão aqui.</span>
          </div>
        ) : displayedSales.length === 0 ? (
          <div className="cl-empty">
            <strong>Nenhuma venda neste filtro</strong>
            <span>Altere a viagem ou a busca para ver outras vendas.</span>
          </div>
        ) : (
          <div className="sl-list">
            {displayedSales.map((currentSale) => {
              const status = formatStatus(currentSale.status);
              const overdue = isSaleOverdue(currentSale);
              const statusKey = overdue ? "overdue" : currentSale.status || "pending";
              const receiving =
                Number(currentSale.pendingAmount || 0) <= 0 ||
                receivingSaleId === currentSale.id;

              return (
                <article key={currentSale.id} className={`sl-card sl-${statusKey}`}>
                  <div className="sl-top">
                    <div className="sl-who">
                      <h3>{currentSale.clientName || "Cliente não informado"}</h3>
                      <p>
                        {currentSale.originalSaleDate
                          ? currentSale.dateSource === "saleDate"
                            ? `Venda em ${formatDate(currentSale.originalSaleDate)}`
                            : `Registro criado em ${formatDate(currentSale.originalSaleDate)}`
                          : "Data original não confiável"}
                      </p>
                    </div>
                    <span className={`cl-status sl-badge-${statusKey}`}>
                      {overdue ? "Vencida" : status.label}
                    </span>
                  </div>

                  <div className="sl-tags">
                    <span className={currentSale.tripNumber ? "sl-tag-trip" : "sl-tag-review"}>
                      {currentSale.tripNumber
                        ? `${currentSale.tripNumber}ª viagem (proposta)`
                        : "Revisar"}
                    </span>
                    {currentSale.tripName && (
                      <span>
                        {currentSale.tripName}
                        {currentSale.tripCity ? ` • ${currentSale.tripCity}` : ""}
                      </span>
                    )}
                    {currentSale.dueDate && (
                      <span className={overdue ? "sl-tag-overdue" : ""}>
                        {overdue ? "Vencida em" : "Vence em"} {formatDateOnly(currentSale.dueDate)}
                      </span>
                    )}
                    <span title={currentSale.id}>Compra #{String(currentSale.id).slice(-6)}</span>
                  </div>

                  {!currentSale.tripNumber && (
                    <p className="sl-review-note">
                      Revisar: {currentSale.reviewReason || "A data original ou os valores da venda precisam ser conferidos."}
                    </p>
                  )}

                  <ul className="sl-products">
                    {(currentSale.items || []).map((item, index) => (
                      <li key={`${currentSale.id}-${index}`}>
                        <span>{item.quantity}x {item.name}</span>
                        <strong>{formatCurrency(item.subtotal)}</strong>
                      </li>
                    ))}
                  </ul>

                  <dl className="sl-values">
                    <div><dt>Total</dt><dd>{formatSaleAmount(currentSale.total)}</dd></div>
                    <div><dt>Recebido</dt><dd className="sl-green">{formatSaleAmount(currentSale.amountPaid)}</dd></div>
                    <div><dt>Pendente</dt><dd className="sl-red">{formatSaleAmount(currentSale.pendingAmount)}</dd></div>
                  </dl>

                  <div className="sl-actions">
                    <button type="button" className="cl-btn cl-btn-soft" onClick={() => handleEditSale(currentSale)}>
                      <LuPencil aria-hidden="true" /> Editar
                    </button>
                    <button
                      type="button"
                      className="cl-btn cl-btn-gold"
                      onClick={() => handleReceiveSale(currentSale)}
                      disabled={receiving}
                    >
                      <LuBanknote aria-hidden="true" /> Receber
                    </button>
                    <button type="button" className="cl-btn cl-btn-soft" onClick={() => handleOpenReceipt(currentSale)}>
                      <LuFileText aria-hidden="true" /> Recibo
                    </button>
                    <button type="button" className="cl-btn cl-btn-danger" onClick={() => handleDeleteSale(currentSale)}>
                      <LuTrash2 aria-hidden="true" /> Excluir
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {showReceipt && selectedReceiptSale && (
        <div style={styles.receiptModalOverlay}>
          <div style={styles.receiptModal}>
            <div style={styles.receiptModalHeader}>
              <div>
                <strong style={styles.receiptModalTitle}>
                  Visualizar recibo
                </strong>
                <span style={styles.receiptModalSubtitle}>
                  Confira os dados antes de baixar ou imprimir.
                </span>
              </div>

              <button
                type="button"
                onClick={handleCloseReceipt}
                style={styles.receiptCloseButton}
                aria-label="Fechar recibo"
              >
                ✕
              </button>
            </div>

            <div style={styles.receiptPreviewArea}>
              <ReceiptTemplate
                ref={receiptRef}
                sale={selectedReceiptSale}
                receiptNumber={selectedReceiptSale.receiptNumber}
                sellerName="Robson Henrique"
                companyName="RC Confecções"
              />
            </div>

            <div style={styles.receiptModalActions}>
              <button
                type="button"
                onClick={handleCloseReceipt}
                style={styles.receiptCancelButton}
              >
                Fechar
              </button>

              <button
                type="button"
                onClick={handlePrintReceipt}
                style={styles.receiptPrintButton}
              >
                🖨️ Imprimir
              </button>

              <button
                type="button"
                onClick={receiptStatus === "error" ? handleRetryReceipt : handleShareReceipt}
                disabled={receiptStatus === "preparing"}
                style={{
                  ...styles.receiptDownloadButton,
                  opacity: receiptStatus === "preparing" ? 0.65 : 1,
                }}
              >
                {receiptStatus === "preparing"
                  ? "Preparando PDF..."
                  : receiptStatus === "error"
                    ? "Tentar novamente"
                    : "📤 Compartilhar recibo"}
              </button>

              <button
                type="button"
                onClick={handleDownloadReceipt}
                style={styles.receiptDownloadButton}
              >
                ⬇️ Baixar PDF
              </button>
            </div>

            {(receiptNotice || receiptStatus === "error") && (
              <p role="status" style={{ margin: "10px 0 0", color: "#92400e", fontSize: 14 }}>
                {receiptNotice || "Não foi possível preparar o PDF. Toque em “Tentar novamente” ou em “Baixar PDF”."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TripSummaryCard({ title, period, summary, review = false }) {
  return (
    <article className={`sl-trip${review ? " sl-trip-review" : ""}`}>
      <div className="sl-trip-head">
        <div>
          <h3>{title}</h3>
          <p>{period}</p>
        </div>
        <span className="sl-trip-count">{summary.count} venda(s)</span>
      </div>
      <dl className="sl-trip-values">
        <div><dt>Vendido</dt><dd>{formatBRL(summary.sold)}</dd></div>
        <div><dt>Recebido</dt><dd className="sl-green">{formatBRL(summary.received)}</dd></div>
        <div><dt>Pendente</dt><dd className="sl-red">{formatBRL(summary.pending)}</dd></div>
      </dl>
      {summary.incompleteValues > 0 && (
        <p className="sl-review-note">
          {summary.incompleteValues} venda(s) com valores incompletos; totais
          incluem somente os valores disponíveis.
        </p>
      )}
    </article>
  );
}

function formatSaleAmount(value) {
  return value === null || value === undefined || value === ""
    ? "Não informado"
    : formatBRL(value);
}

function formatBRL(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

const styles = {
  page: {
    color: "#0f172a",
    fontFamily: "Arial, sans-serif",
  },

  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "16px",
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

  newSaleButton: {
    border: 0,
    borderRadius: "10px",
    padding: "12px 18px",
    background: "#2563eb",
    color: "#ffffff",
    fontSize: "14px",
    fontWeight: "700",
    cursor: "pointer",
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(170px, 1fr))",
    gap: "14px",
    marginBottom: "22px",
  },

  summaryCard: {
    padding: "18px",
    borderRadius: "16px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
  },

  summaryLabel: {
    display: "block",
    marginBottom: "8px",
    color: "#64748b",
    fontSize: "13px",
  },

  summaryValue: {
    fontSize: "20px",
  },

  receivedValue: {
    color: "#16a34a",
    fontSize: "18px",
  },

  pendingValue: {
    color: "#dc2626",
    fontSize: "18px",
  },

  salesAreas: {
    display: "flex",
    flexDirection: "column",
    gap: "18px",
  },

  card: {
    padding: "24px",
    borderRadius: "18px",
    background: "#ffffff",
    boxShadow:
      "0 10px 30px rgba(15, 23, 42, 0.08)",
  },

  cardTitle: {
    margin: "0 0 20px",
    fontSize: "21px",
  },

  salesHeading: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "16px",
    marginBottom: "18px",
  },

  salesHint: {
    margin: "7px 0 0",
    maxWidth: "520px",
    color: "#64748b",
    fontSize: "13px",
    lineHeight: 1.5,
  },

  filterLabel: {
    display: "grid",
    gap: "6px",
    color: "#334155",
    fontSize: "13px",
    fontWeight: "700",
  },

  filterSelect: {
    minWidth: "220px",
    maxWidth: "100%",
    padding: "10px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: "9px",
    background: "#fff",
    color: "#0f172a",
    fontSize: "14px",
  },

  tripSummaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: "10px",
    marginBottom: "22px",
  },

  tripSummaryLoading: {
    marginBottom: "22px",
    padding: "18px",
    borderRadius: "12px",
    background: "#f8fafc",
    color: "#64748b",
    textAlign: "center",
  },

  tripSummaryError: {
    marginBottom: "22px",
    padding: "14px 16px",
    border: "1px solid #fecaca",
    borderRadius: "12px",
    background: "#fef2f2",
    color: "#991b1b",
  },

  tripSummaryCard: {
    minWidth: 0,
    padding: "14px",
    border: "1px solid #dbeafe",
    borderRadius: "12px",
    background: "#f8fbff",
  },

  tripSummaryReview: {
    borderColor: "#fed7aa",
    background: "#fffaf5",
  },

  tripSummaryTitle: {
    margin: "0 0 8px",
    color: "#334155",
    fontSize: "14px",
  },

  tripSummaryCount: {
    display: "block",
    marginBottom: "10px",
    fontSize: "18px",
  },

  tripSummaryRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "8px",
    padding: "5px 0",
    borderTop: "1px solid #e2e8f0",
    color: "#64748b",
    fontSize: "12px",
  },

  tripSummaryReceived: {
    color: "#16a34a",
  },

  tripSummaryPending: {
    color: "#dc2626",
  },

  tripSummaryWarning: {
    margin: "9px 0 0",
    color: "#9a3412",
    fontSize: "11px",
    lineHeight: 1.4,
  },

  tripProposal: {
    display: "inline-block",
    margin: "7px 0 0",
    padding: "4px 8px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: "700",
  },

  tripProposalCandidate: {
    background: "#dcfce7",
    color: "#166534",
  },

  tripProposalReview: {
    background: "#ffedd5",
    color: "#9a3412",
  },

  formTitleRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "12px",
  },

  cancelEditButton: {
    border: 0,
    borderRadius: "8px",
    padding: "8px 10px",
    marginBottom: "20px",
    background: "#e2e8f0",
    color: "#334155",
    fontWeight: "700",
    cursor: "pointer",
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

  itemsHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "12px",
    marginBottom: "14px",
  },

  sectionTitle: {
    margin: 0,
    fontSize: "17px",
  },

  addButton: {
    border: 0,
    borderRadius: "9px",
    padding: "9px 12px",
    background: "#0f172a",
    color: "#ffffff",
    fontWeight: "700",
    cursor: "pointer",
  },

  itemsList: {
    display: "grid",
    gap: "14px",
  },

  itemCard: {
    padding: "16px",
    borderRadius: "14px",
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
  },

  itemGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(130px, 1fr))",
    gap: "12px",
  },

  stockInfo: {
    margin: "-7px 0 14px",
    color: "#64748b",
    fontSize: "13px",
  },

  itemFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "12px",
  },

  removeButton: {
    border: 0,
    borderRadius: "8px",
    padding: "8px 10px",
    background: "#fee2e2",
    color: "#dc2626",
    fontWeight: "700",
    cursor: "pointer",
  },

  totalBox: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    margin: "20px 0",
    padding: "18px",
    borderRadius: "14px",
    background: "#eff6ff",
    color: "#1d4ed8",
    fontSize: "20px",
  },

  paymentSummary: {
    display: "grid",
    gridTemplateColumns:
      "repeat(2, minmax(120px, 1fr))",
    gap: "12px",
    marginBottom: "18px",
    padding: "16px",
    borderRadius: "14px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  smallLabel: {
    display: "block",
    marginBottom: "5px",
    color: "#64748b",
    fontSize: "11px",
  },

  saveButton: {
    width: "100%",
    border: 0,
    borderRadius: "11px",
    padding: "14px",
    background: "#2563eb",
    color: "#ffffff",
    fontSize: "16px",
    fontWeight: "800",
  },

  empty: {
    minHeight: "300px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    color: "#64748b",
  },

  emptyIcon: {
    marginBottom: "12px",
    fontSize: "42px",
  },

  salesList: {
    display: "grid",
    gap: "14px",
  },

  saleItem: {
    padding: "18px",
    borderRadius: "15px",
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
  },

  saleTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "15px",
  },

  clientName: {
    margin: 0,
    fontSize: "18px",
  },

  saleDate: {
    margin: "5px 0 0",
    color: "#64748b",
    fontSize: "12px",
  },

  statusBadge: {
    padding: "5px 9px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: "800",
  },

  saleProducts: {
    margin: "15px 0",
    padding: "12px",
    borderRadius: "10px",
    background: "#ffffff",
  },

  saleProduct: {
    margin: "5px 0",
    color: "#475569",
    fontSize: "13px",
  },

  saleValues: {
    display: "grid",
    gridTemplateColumns:
      "repeat(3, minmax(80px, 1fr))",
    gap: "10px",
  },

  saleActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "16px",
  },

  editSaleButton: {
    border: 0,
    borderRadius: "8px",
    padding: "9px 11px",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: "700",
    cursor: "pointer",
  },

  receiveSaleButton: {
    border: 0,
    borderRadius: "8px",
    padding: "9px 11px",
    background: "#16a34a",
    color: "#ffffff",
    fontWeight: "700",
  },

  receiptButton: {
    border: 0,
    borderRadius: "8px",
    padding: "9px 11px",
    background: "#7c3aed",
    color: "#ffffff",
    fontWeight: "700",
    cursor: "pointer",
  },


  receiptModalOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    background: "rgba(15, 23, 42, 0.82)",
    backdropFilter: "blur(4px)",
  },

  receiptModal: {
    width: "min(720px, 100%)",
    maxHeight: "96vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: "18px",
    background: "#ffffff",
    boxShadow: "0 30px 80px rgba(0, 0, 0, 0.35)",
  },

  receiptModalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    padding: "16px 20px",
    borderBottom: "1px solid #e2e8f0",
  },

  receiptModalTitle: {
    display: "block",
    color: "#0f172a",
    fontSize: "18px",
  },

  receiptModalSubtitle: {
    display: "block",
    marginTop: "3px",
    color: "#64748b",
    fontSize: "12px",
  },

  receiptCloseButton: {
    width: "38px",
    height: "38px",
    border: 0,
    borderRadius: "50%",
    background: "#f1f5f9",
    color: "#0f172a",
    fontSize: "18px",
    cursor: "pointer",
  },

  receiptPreviewArea: {
    flex: 1,
    overflow: "auto",
    padding: "18px",
    background: "#e2e8f0",
  },

  receiptModalActions: {
    display: "flex",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: "10px",
    padding: "14px 20px",
    borderTop: "1px solid #e2e8f0",
  },

  receiptCancelButton: {
    border: 0,
    borderRadius: "9px",
    padding: "11px 16px",
    background: "#e2e8f0",
    color: "#334155",
    fontWeight: "700",
    cursor: "pointer",
  },

  receiptPrintButton: {
    border: 0,
    borderRadius: "9px",
    padding: "11px 16px",
    background: "#0f172a",
    color: "#ffffff",
    fontWeight: "700",
    cursor: "pointer",
  },

  receiptDownloadButton: {
    border: 0,
    borderRadius: "9px",
    padding: "11px 16px",
    background: "#e0aa00",
    color: "#111111",
    fontWeight: "800",
    cursor: "pointer",
  },

  deleteSaleButton: {
    border: 0,
    borderRadius: "8px",
    padding: "9px 11px",
    background: "#dc2626",
    color: "#ffffff",
    fontWeight: "700",
    cursor: "pointer",
  },
};