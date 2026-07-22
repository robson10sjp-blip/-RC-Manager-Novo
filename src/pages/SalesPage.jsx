import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import ReceiptTemplate from "../components/receipts/ReceiptTemplate";
import { generateReceiptPdf } from "../components/receipts/generateReceiptPdf";
import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "../firebase/config";

const emptyItem = {
  productId: "",
  quantity: 1,
  price: "",
};

const emptySale = {
  clientId: "",
  paymentMethod: "prazo",
  amountPaid: "",
  items: [{ ...emptyItem }],
};

export default function SalesPage() {
  const receiptRef = useRef(null);
  const [selectedReceiptSale, setSelectedReceiptSale] = useState(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);

  const [sale, setSale] = useState(emptySale);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingSaleId, setEditingSaleId] = useState(null);

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
        setLoading(false);
        return;
      }

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
              first.createdAt?.toMillis?.() || 0;

            const secondDate =
              second.createdAt?.toMillis?.() || 0;

            return secondDate - firstDate;
          });

          setSales(list);
          setLoading(false);
        },
        (error) => {
          console.error("Erro ao carregar vendas:", error);
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

  const total = useMemo(() => {
    return sale.items.reduce((sum, item) => {
      return (
        sum +
        Number(item.quantity || 0) *
          Number(item.price || 0)
      );
    }, 0);
  }, [sale.items]);

  const amountPaid = Number(sale.amountPaid || 0);

  const pendingAmount = Math.max(total - amountPaid, 0);

  const saleStatus =
    total <= 0
      ? "pending"
      : amountPaid >= total
        ? "paid"
        : amountPaid > 0
          ? "partial"
          : "pending";

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

  function formatCurrency(value) {
    return Number(value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }

  function formatDate(timestamp) {
    if (!timestamp?.toDate) {
      return "Data não informada";
    }

    return timestamp.toDate().toLocaleString("pt-BR");
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
    setSale({
      clientId: "",
      paymentMethod: "prazo",
      amountPaid: "",
      items: [{ ...emptyItem }],
    });

    setEditingSaleId(null);
  }

  function handleEditSale(currentSale) {
    setEditingSaleId(currentSale.id);

    setSale({
      clientId: currentSale.clientId || "",
      paymentMethod: currentSale.paymentMethod || "prazo",
      amountPaid: String(currentSale.amountPaid || 0),
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

    const typedValue = window.prompt(
      `Saldo pendente: ${formatCurrency(currentPending)}\n\nDigite o valor recebido:`
    );

    if (typedValue === null) return;

    const receivedValue = Number(
      typedValue.replace(",", ".").replace(/[^\d.-]/g, "")
    );

    if (!receivedValue || receivedValue <= 0) {
      alert("Digite um valor válido.");
      return;
    }

    if (receivedValue > currentPending) {
      alert("O recebimento não pode ser maior que o saldo pendente.");
      return;
    }

    try {
      const saleReference = doc(
        db,
        "users",
        user.uid,
        "sales",
        currentSale.id
      );

      const clientReference = doc(
        db,
        "users",
        user.uid,
        "clients",
        currentSale.clientId
      );

      const paymentReference = doc(
        collection(
          db,
          "users",
          user.uid,
          "sales",
          currentSale.id,
          "payments"
        )
      );

      await runTransaction(db, async (transaction) => {
        const saleSnapshot = await transaction.get(saleReference);
        const clientSnapshot = await transaction.get(clientReference);

        if (!saleSnapshot.exists()) {
          throw new Error("Venda não encontrada.");
        }

        if (!clientSnapshot.exists()) {
          throw new Error("Cliente não encontrado.");
        }

        const savedSale = saleSnapshot.data();
        const savedClient = clientSnapshot.data();
        const savedPaid = Number(savedSale.amountPaid || 0);
        const savedPending = Number(savedSale.pendingAmount || 0);

        if (receivedValue > savedPending) {
          throw new Error(
            `O saldo atual desta venda é ${formatCurrency(savedPending)}.`
          );
        }

        const updatedPaid = savedPaid + receivedValue;
        const updatedPending = Math.max(savedPending - receivedValue, 0);
        const updatedClientDebt = Math.max(
          Number(savedClient.totalDebt || 0) - receivedValue,
          0
        );

        transaction.update(saleReference, {
          amountPaid: updatedPaid,
          pendingAmount: updatedPending,
          status: updatedPending === 0 ? "paid" : "partial",
          updatedAt: serverTimestamp(),
        });

        transaction.update(clientReference, {
          totalDebt: updatedClientDebt,
          totalReceived:
            Number(savedClient.totalReceived || 0) + receivedValue,
          status: updatedClientDebt === 0 ? "paid" : "partial",
          updatedAt: serverTimestamp(),
        });

        transaction.set(paymentReference, {
          value: receivedValue,
          previousBalance: savedPending,
          remainingBalance: updatedPending,
          createdAt: serverTimestamp(),
        });
      });

      alert("Recebimento registrado com sucesso!");
    } catch (error) {
      console.error("Erro ao registrar recebimento:", error);
      alert(`Erro ao registrar recebimento: ${error.message}`);
    }
  }

  function prepareReceiptSale(currentSale) {
    const saleDate = currentSale.createdAt?.toDate
      ? currentSale.createdAt.toDate()
      : currentSale.createdAt || new Date();

    let dueDate =
      currentSale.dueDate ||
      currentSale.paymentDueDate ||
      currentSale.collectionDate ||
      currentSale.dataCobranca ||
      null;

    if (!dueDate && currentSale.paymentMethod === "prazo") {
      const calculatedDueDate = new Date(saleDate);
      calculatedDueDate.setDate(calculatedDueDate.getDate() + 90);
      dueDate = calculatedDueDate;
    }

    return {
      ...currentSale,
      saleDate,
      dueDate,
      receiptNumber:
        currentSale.receiptNumber ||
        String(currentSale.id || Date.now()).slice(-6),
    };
  }

  function handleOpenReceipt(currentSale) {
    setSelectedReceiptSale(prepareReceiptSale(currentSale));
    setShowReceipt(true);
  }

  function handleCloseReceipt() {
    setShowReceipt(false);
    setSelectedReceiptSale(null);
  }

  async function handleDownloadReceipt() {
    if (!receiptRef.current || !selectedReceiptSale) return;

    try {
      await generateReceiptPdf(
        receiptRef.current,
        selectedReceiptSale.receiptNumber
      );
    } catch (error) {
      console.error("Erro ao gerar PDF do recibo:", error);
      alert("Não foi possível gerar o PDF do recibo.");
    }
  }

  function handlePrintReceipt() {
    if (!selectedReceiptSale) return;
    window.print();
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

      const clientReference = doc(
        db,
        "users",
        user.uid,
        "clients",
        currentSale.clientId
      );

      await runTransaction(db, async (transaction) => {
        const saleSnapshot = await transaction.get(saleReference);
        const clientSnapshot = await transaction.get(clientReference);

        if (!saleSnapshot.exists()) {
          throw new Error("Venda não encontrada.");
        }

        const savedSale = saleSnapshot.data();
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

        if (clientSnapshot.exists()) {
          const clientData = clientSnapshot.data();
          const updatedDebt = Math.max(
            Number(clientData.totalDebt || 0) -
              Number(savedSale.pendingAmount || 0),
            0
          );

          transaction.update(clientReference, {
            totalDebt: updatedDebt,
            status: updatedDebt === 0 ? "paid" : "partial",
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
                quantity:
                  currentQuantity - saleQuantity,
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

          const previousDebt = Number(
            clientData.totalDebt || 0
          );

          if (pendingAmount > 0) {
            transaction.update(clientReference, {
              totalDebt:
                previousDebt + pendingAmount,
              status:
                amountPaid > 0
                  ? "partial"
                  : "pending",
              updatedAt: serverTimestamp(),
            });
          }

          transaction.set(saleReference, {
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
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
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

      const oldClientReference = doc(
        db,
        "users",
        user.uid,
        "clients",
        oldSale.clientId
      );

      const newClientReference = doc(
        db,
        "users",
        user.uid,
        "clients",
        sale.clientId
      );

      const clientReferences = new Map([
        [oldSale.clientId, oldClientReference],
        [sale.clientId, newClientReference],
      ]);

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

      const clientSnapshots = new Map();

      for (const [clientId, reference] of clientReferences) {
        clientSnapshots.set(clientId, await transaction.get(reference));
      }

      const productSnapshots = new Map();

      for (const [productId, reference] of productReferences) {
        productSnapshots.set(productId, await transaction.get(reference));
      }

      const oldClientSnapshot = clientSnapshots.get(oldSale.clientId);
      const newClientSnapshot = clientSnapshots.get(sale.clientId);

      if (!oldClientSnapshot?.exists()) {
        throw new Error("O cliente original da venda não foi encontrado.");
      }

      if (!newClientSnapshot?.exists()) {
        throw new Error("O cliente selecionado não foi encontrado.");
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
        const updatedQuantity =
          currentQuantity + oldQuantity - newQuantity;

        if (updatedQuantity < 0) {
          throw new Error(
            `Estoque insuficiente para ${snapshot.data().name || "um produto"}.`
          );
        }

        transaction.update(reference, {
          quantity: updatedQuantity,
          updatedAt: serverTimestamp(),
        });
      }

      const oldPending = Number(oldSale.pendingAmount || 0);

      if (oldSale.clientId === sale.clientId) {
        const clientData = oldClientSnapshot.data();
        const updatedDebt = Math.max(
          Number(clientData.totalDebt || 0) -
            oldPending +
            pendingAmount,
          0
        );

        transaction.update(oldClientReference, {
          totalDebt: updatedDebt,
          status:
            updatedDebt === 0
              ? "paid"
              : amountPaid > 0
                ? "partial"
                : "pending",
          updatedAt: serverTimestamp(),
        });
      } else {
        const oldClientData = oldClientSnapshot.data();
        const oldClientDebt = Math.max(
          Number(oldClientData.totalDebt || 0) - oldPending,
          0
        );

        transaction.update(oldClientReference, {
          totalDebt: oldClientDebt,
          status: oldClientDebt === 0 ? "paid" : "partial",
          updatedAt: serverTimestamp(),
        });

        const newClientData = newClientSnapshot.data();
        const newClientDebt =
          Number(newClientData.totalDebt || 0) + pendingAmount;

        transaction.update(newClientReference, {
          totalDebt: newClientDebt,
          status:
            newClientDebt === 0
              ? "paid"
              : amountPaid > 0
                ? "partial"
                : "pending",
          updatedAt: serverTimestamp(),
        });
      }

      transaction.update(saleReference, {
        clientId: sale.clientId,
        clientName:
          newClientSnapshot.data().name ||
          selectedClient?.name ||
          "",
        items: savedItems,
        total,
        amountPaid,
        pendingAmount,
        paymentMethod: sale.paymentMethod,
        status: saleStatus,
        updatedAt: serverTimestamp(),
      });
    });
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>
            RC Confecções
          </p>

          <h1 style={styles.title}>Vendas</h1>

          <p style={styles.subtitle}>
            Registre vendas e atualize o estoque automaticamente.
          </p>
        </div>
      </header>

      <section style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>
            Total vendido
          </span>

          <strong style={styles.summaryValue}>
            {formatCurrency(
              dashboardTotals.totalSales
            )}
          </strong>
        </div>

        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>
            Total recebido
          </span>

          <strong style={styles.receivedValue}>
            {formatCurrency(
              dashboardTotals.totalReceived
            )}
          </strong>
        </div>

        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>
            Total pendente
          </span>

          <strong style={styles.pendingValue}>
            {formatCurrency(
              dashboardTotals.totalPending
            )}
          </strong>
        </div>

        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>
            Quantidade de vendas
          </span>

          <strong style={styles.summaryValue}>
            {sales.length}
          </strong>
        </div>
      </section>

      <section style={styles.grid}>
        <form
          onSubmit={handleSubmit}
          style={styles.card}
        >
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

          <label style={styles.label}>
            Cliente
            <select
              value={sale.clientId}
              onChange={handleClientChange}
              required
              disabled={saving}
              style={styles.input}
            >
              <option value="">
                Selecione um cliente
              </option>

              {clients.map((client) => (
                <option
                  key={client.id}
                  value={client.id}
                >
                  {client.name}
                </option>
              ))}
            </select>
          </label>

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
              disabled={saving}
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
            Valor recebido agora
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

        <section style={styles.card}>
          <h2 style={styles.cardTitle}>
            Vendas registradas
          </h2>

          {loading ? (
            <div style={styles.empty}>
              <span style={styles.emptyIcon}>
                ⏳
              </span>

              <strong>
                Carregando vendas...
              </strong>
            </div>
          ) : sales.length === 0 ? (
            <div style={styles.empty}>
              <span style={styles.emptyIcon}>
                🛒
              </span>

              <strong>
                Nenhuma venda registrada
              </strong>

              <p>
                As vendas aparecerão aqui.
              </p>
            </div>
          ) : (
            <div style={styles.salesList}>
              {sales.map((currentSale) => {
                const status =
                  formatStatus(
                    currentSale.status
                  );

                return (
                  <article
                    key={currentSale.id}
                    style={styles.saleItem}
                  >
                    <div style={styles.saleTop}>
                      <div>
                        <h3 style={styles.clientName}>
                          {currentSale.clientName ||
                            "Cliente não informado"}
                        </h3>

                        <p style={styles.saleDate}>
                          {formatDate(
                            currentSale.createdAt
                          )}
                        </p>
                      </div>

                      <span
                        style={{
                          ...styles.statusBadge,
                          color: status.color,
                          background:
                            status.background,
                        }}
                      >
                        {status.label}
                      </span>
                    </div>

                    <div style={styles.saleProducts}>
                      {(currentSale.items || []).map(
                        (item, index) => (
                          <p
                            key={`${currentSale.id}-${index}`}
                            style={styles.saleProduct}
                          >
                            {item.quantity}x{" "}
                            {item.name} —{" "}
                            {formatCurrency(
                              item.subtotal
                            )}
                          </p>
                        )
                      )}
                    </div>

                    <div style={styles.saleValues}>
                      <div>
                        <span style={styles.smallLabel}>
                          Total
                        </span>

                        <strong>
                          {formatCurrency(
                            currentSale.total
                          )}
                        </strong>
                      </div>

                      <div>
                        <span style={styles.smallLabel}>
                          Recebido
                        </span>

                        <strong style={styles.receivedValue}>
                          {formatCurrency(
                            currentSale.amountPaid
                          )}
                        </strong>
                      </div>

                      <div>
                        <span style={styles.smallLabel}>
                          Pendente
                        </span>

                        <strong style={styles.pendingValue}>
                          {formatCurrency(
                            currentSale.pendingAmount
                          )}
                        </strong>
                      </div>
                    </div>

                    <div style={styles.saleActions}>
                      <button
                        type="button"
                        onClick={() => handleEditSale(currentSale)}
                        style={styles.editSaleButton}
                      >
                        ✏️ Editar
                      </button>

                      <button
                        type="button"
                        onClick={() => handleReceiveSale(currentSale)}
                        disabled={Number(currentSale.pendingAmount || 0) <= 0}
                        style={{
                          ...styles.receiveSaleButton,
                          opacity:
                            Number(currentSale.pendingAmount || 0) <= 0
                              ? 0.5
                              : 1,
                          cursor:
                            Number(currentSale.pendingAmount || 0) <= 0
                              ? "not-allowed"
                              : "pointer",
                        }}
                      >
                        💵 Receber
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenReceipt(currentSale)}
                        style={styles.receiptButton}
                      >
                        📄 Recibo
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteSale(currentSale)}
                        style={styles.deleteSaleButton}
                      >
                        🗑️ Excluir
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
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
                onClick={handleDownloadReceipt}
                style={styles.receiptDownloadButton}
              >
                ⬇️ Baixar PDF
              </button>
            </div>
          </div>
        </div>
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

  grid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(340px, 1fr))",
    alignItems: "start",
    gap: "22px",
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
    width: "min(1180px, 100%)",
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