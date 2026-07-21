import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "../firebase/config";

const emptyExpense = {
  category: "combustivel",
  description: "",
  value: "",
  date: new Date().toISOString().slice(0, 10),
};

export default function FinancePage() {
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [expenses, setExpenses] = useState([]);

  const [expenseForm, setExpenseForm] = useState(emptyExpense);
  const [searchText, setSearchText] = useState("");
  const [periodFilter, setPeriodFilter] = useState("mes");
  const [loading, setLoading] = useState(true);
  const [savingExpense, setSavingExpense] = useState(false);
  const [receivingSaleId, setReceivingSaleId] = useState(null);

  useEffect(() => {
    let unsubscribeClients = null;
    let unsubscribeProducts = null;
    let unsubscribeSales = null;
    let unsubscribeExpenses = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (unsubscribeClients) unsubscribeClients();
      if (unsubscribeProducts) unsubscribeProducts();
      if (unsubscribeSales) unsubscribeSales();
      if (unsubscribeExpenses) unsubscribeExpenses();

      if (!user) {
        setClients([]);
        setProducts([]);
        setSales([]);
        setExpenses([]);
        setLoading(false);
        return;
      }

      unsubscribeClients = onSnapshot(
        collection(db, "users", user.uid, "clients"),
        (snapshot) => {
          setClients(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...document.data(),
            }))
          );
        },
        (error) => console.error("Erro ao carregar clientes:", error)
      );

      unsubscribeProducts = onSnapshot(
        collection(db, "users", user.uid, "products"),
        (snapshot) => {
          setProducts(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...document.data(),
            }))
          );
        },
        (error) => console.error("Erro ao carregar produtos:", error)
      );

      unsubscribeSales = onSnapshot(
        collection(db, "users", user.uid, "sales"),
        (snapshot) => {
          const list = snapshot.docs.map((document) => ({
            id: document.id,
            ...document.data(),
          }));

          list.sort((first, second) => {
            const firstDate = first.createdAt?.toMillis?.() || 0;
            const secondDate = second.createdAt?.toMillis?.() || 0;
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

      unsubscribeExpenses = onSnapshot(
        collection(db, "users", user.uid, "expenses"),
        (snapshot) => {
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
        (error) => console.error("Erro ao carregar despesas:", error)
      );
    });

    return () => {
      unsubscribeAuth();

      if (unsubscribeClients) unsubscribeClients();
      if (unsubscribeProducts) unsubscribeProducts();
      if (unsubscribeSales) unsubscribeSales();
      if (unsubscribeExpenses) unsubscribeExpenses();
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

  const filteredPeriod = useMemo(() => {
    const now = new Date();

    if (periodFilter === "hoje") {
      return {
        start: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
        end: new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() + 1
        ),
      };
    }

    if (periodFilter === "mes") {
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      };
    }

    if (periodFilter === "ano") {
      return {
        start: new Date(now.getFullYear(), 0, 1),
        end: new Date(now.getFullYear() + 1, 0, 1),
      };
    }

    return {
      start: null,
      end: null,
    };
  }, [periodFilter]);

  const periodSales = useMemo(() => {
    return sales.filter((sale) => {
      const date = sale.createdAt?.toDate?.();

      if (!filteredPeriod.start || !filteredPeriod.end) {
        return true;
      }

      return (
        date &&
        date >= filteredPeriod.start &&
        date < filteredPeriod.end
      );
    });
  }, [sales, filteredPeriod]);

  const periodExpenses = useMemo(() => {
    return expenses.filter((expense) => {
      const date =
        expense.expenseDate?.toDate?.() ||
        expense.createdAt?.toDate?.();

      if (!filteredPeriod.start || !filteredPeriod.end) {
        return true;
      }

      return (
        date &&
        date >= filteredPeriod.start &&
        date < filteredPeriod.end
      );
    });
  }, [expenses, filteredPeriod]);

  const summary = useMemo(() => {
    let sold = 0;
    let received = 0;
    let pending = 0;
    let estimatedCost = 0;

    for (const sale of periodSales) {
      sold += Number(sale.total || 0);
      received += Number(sale.amountPaid || 0);
      pending += Number(sale.pendingAmount || 0);

      for (const item of sale.items || []) {
        const product = productMap.get(item.productId);
        const costPrice = Number(product?.costPrice || 0);
        estimatedCost +=
          Number(item.quantity || 0) * costPrice;
      }
    }

    const expensesTotal = periodExpenses.reduce(
      (sum, expense) => sum + Number(expense.value || 0),
      0
    );

    const grossProfit = sold - estimatedCost;
    const netProfit = received - expensesTotal - estimatedCost;

    return {
      sold,
      received,
      pending,
      expensesTotal,
      estimatedCost,
      grossProfit,
      netProfit,
      salesCount: periodSales.length,
    };
  }, [periodSales, periodExpenses, productMap]);

  const debtors = useMemo(() => {
    const map = new Map();

    for (const sale of sales) {
      const pending = Number(sale.pendingAmount || 0);

      if (pending <= 0) {
        continue;
      }

      const client = clientMap.get(sale.clientId);

      const current = map.get(sale.clientId) || {
        clientId: sale.clientId,
        clientName:
          sale.clientName ||
          client?.name ||
          "Cliente não informado",
        phone: client?.phone || "",
        city: client?.city || "",
        totalPending: 0,
        sales: [],
      };

      current.totalPending += pending;
      current.sales.push(sale);

      map.set(sale.clientId, current);
    }

    const search = searchText.trim().toLowerCase();

    return Array.from(map.values())
      .filter((item) => {
        if (!search) return true;

        return (
          String(item.clientName).toLowerCase().includes(search) ||
          String(item.phone).toLowerCase().includes(search) ||
          String(item.city).toLowerCase().includes(search)
        );
      })
      .sort((first, second) => second.totalPending - first.totalPending);
  }, [sales, clientMap, searchText]);

  const history = useMemo(() => {
    const entries = [];

    for (const sale of periodSales) {
      entries.push({
        id: `sale-${sale.id}`,
        type: "sale",
        date: sale.createdAt?.toDate?.() || null,
        title: sale.clientName || "Venda",
        description: `${(sale.items || []).length} item(ns)`,
        value: Number(sale.total || 0),
        received: Number(sale.amountPaid || 0),
      });
    }

    for (const expense of periodExpenses) {
      entries.push({
        id: `expense-${expense.id}`,
        type: "expense",
        date:
          expense.expenseDate?.toDate?.() ||
          expense.createdAt?.toDate?.() ||
          null,
        title: formatExpenseCategory(expense.category),
        description: expense.description || "Despesa",
        value: Number(expense.value || 0),
        expenseId: expense.id,
      });
    }

    return entries.sort((first, second) => {
      const firstTime = first.date?.getTime?.() || 0;
      const secondTime = second.date?.getTime?.() || 0;
      return secondTime - firstTime;
    });
  }, [periodSales, periodExpenses]);

  function formatCurrency(value) {
    return Number(value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }

  function formatDate(value) {
    if (!value) return "Data não informada";

    return value.toLocaleDateString("pt-BR");
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

    try {
      setSavingExpense(true);

      const selectedDate = new Date(
        `${expenseForm.date}T12:00:00`
      );

      await addDoc(
        collection(db, "users", user.uid, "expenses"),
        {
          category: expenseForm.category,
          description: expenseForm.description.trim(),
          value,
          expenseDate: selectedDate,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      );

      setExpenseForm({
        ...emptyExpense,
        date: new Date().toISOString().slice(0, 10),
      });

      alert("Despesa registrada com sucesso!");
    } catch (error) {
      console.error("Erro ao registrar despesa:", error);
      alert(`Erro ao registrar despesa: ${error.message}`);
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
      "Deseja realmente excluir esta despesa?"
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

      alert("Despesa excluída com sucesso!");
    } catch (error) {
      console.error("Erro ao excluir despesa:", error);
      alert(`Erro ao excluir despesa: ${error.message}`);
    }
  }

  async function handleReceiveSale(sale) {
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

    const typedValue = window.prompt(
      `Saldo pendente: ${formatCurrency(
        currentPending
      )}\n\nDigite o valor recebido:`
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
      alert("O valor não pode ser maior que o saldo pendente.");
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

      const clientReference = doc(
        db,
        "users",
        user.uid,
        "clients",
        sale.clientId
      );

      const paymentReference = doc(
        collection(
          db,
          "users",
          user.uid,
          "sales",
          sale.id,
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
            `O saldo atual é ${formatCurrency(savedPending)}.`
          );
        }

        const updatedPaid = savedPaid + receivedValue;
        const updatedPending = Math.max(
          savedPending - receivedValue,
          0
        );

        const updatedClientDebt = Math.max(
          Number(savedClient.totalDebt || 0) -
            receivedValue,
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
            Number(savedClient.totalReceived || 0) +
            receivedValue,
          status:
            updatedClientDebt === 0 ? "paid" : "partial",
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
    } finally {
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
            <td>${item.quantity}x ${item.name}</td>
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
          <p>Comprovante da venda</p>

          <p><strong>Cliente:</strong> ${
            sale.clientName || "Não informado"
          }</p>

          <p><strong>Data:</strong> ${formatDate(
            sale.createdAt?.toDate?.()
          )}</p>

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
            Acompanhe receitas, despesas, lucros e clientes devedores.
          </p>
        </div>

        <select
          value={periodFilter}
          onChange={(event) => setPeriodFilter(event.target.value)}
          style={styles.periodSelect}
        >
          <option value="hoje">Hoje</option>
          <option value="mes">Este mês</option>
          <option value="ano">Este ano</option>
          <option value="tudo">Todo o período</option>
        </select>
      </header>

      <section style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>Total vendido</span>
          <strong style={styles.summaryValue}>
            {formatCurrency(summary.sold)}
          </strong>
        </div>

        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>Total recebido</span>
          <strong style={styles.receivedValue}>
            {formatCurrency(summary.received)}
          </strong>
        </div>

        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>Total pendente</span>
          <strong style={styles.pendingValue}>
            {formatCurrency(summary.pending)}
          </strong>
        </div>

        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>Despesas</span>
          <strong style={styles.expenseValue}>
            {formatCurrency(summary.expensesTotal)}
          </strong>
        </div>

        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>Custo estimado</span>
          <strong style={styles.summaryValue}>
            {formatCurrency(summary.estimatedCost)}
          </strong>
        </div>

        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>Lucro líquido estimado</span>
          <strong
            style={
              summary.netProfit >= 0
                ? styles.profitValue
                : styles.expenseValue
            }
          >
            {formatCurrency(summary.netProfit)}
          </strong>
        </div>
      </section>

      <section style={styles.mainGrid}>
        <form
          onSubmit={handleExpenseSubmit}
          style={styles.card}
        >
          <h2 style={styles.cardTitle}>Registrar despesa</h2>

          <label style={styles.label}>
            Categoria
            <select
              name="category"
              value={expenseForm.category}
              onChange={handleExpenseChange}
              style={styles.input}
            >
              <option value="combustivel">Combustível</option>
              <option value="hotel">Hotel</option>
              <option value="alimentacao">Alimentação</option>
              <option value="mercadoria">Compra de mercadoria</option>
              <option value="manutencao">Manutenção</option>
              <option value="transporte">Transporte</option>
              <option value="outros">Outros</option>
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
              ? "Salvando despesa..."
              : "Salvar despesa"}
          </button>
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

                    <div style={styles.actions}>
                      <button
                        type="button"
                        onClick={() =>
                          handleReceiveSale(debtor.sales[0])
                        }
                        disabled={
                          receivingSaleId === debtor.sales[0]?.id
                        }
                        style={styles.receiveButton}
                      >
                        💵 Receber
                      </button>

                      <button
                        type="button"
                        onClick={() => handleWhatsApp(debtor)}
                        style={styles.whatsAppButton}
                      >
                        📱 WhatsApp
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleReceipt(debtor.sales[0])
                        }
                        style={styles.receiptButton}
                      >
                        📄 Recibo
                      </button>
                    </div>
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
              Vendas e despesas do período selecionado.
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
                    <button
                      type="button"
                      onClick={() =>
                        handleDeleteExpense(entry.expenseId)
                      }
                      style={styles.deleteButton}
                    >
                      Excluir
                    </button>
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
    minWidth: "180px",
    padding: "12px 14px",
    borderRadius: "11px",
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    fontSize: "15px",
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

  profitValue: {
    color: "#16a34a",
    fontSize: "18px",
  },

  mainGrid: {
    display: "grid",
    gridTemplateColumns:
      "minmax(280px, 360px) minmax(0, 1fr)",
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
};