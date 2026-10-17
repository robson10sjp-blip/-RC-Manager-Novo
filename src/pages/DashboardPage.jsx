import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot } from "firebase/firestore";

import { auth, db } from "../firebase/config";
import {
  calculateConsolidatedReceivables,
  calculateTripFinancialSummary,
  organizeSalesByTrip2026,
  selectSalesForTrip,
} from "../domain/sales";
import { filterPayablesByTrip, summarizePayables } from "../domain/payables";
import { toDate } from "../utils/dates";
import "./DashboardPayables.css";

export default function DashboardPage() {
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [payables, setPayables] = useState([]);
  const [tripFilter, setTripFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeClients = null;
    let unsubscribeProducts = null;
    let unsubscribeSales = null;
    let unsubscribeExpenses = null;
    let unsubscribePayables = null;
    let authGeneration = 0;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      const generation = ++authGeneration;
      if (unsubscribeClients) unsubscribeClients();
      if (unsubscribeProducts) unsubscribeProducts();
      if (unsubscribeSales) unsubscribeSales();
      if (unsubscribeExpenses) unsubscribeExpenses();
      if (unsubscribePayables) unsubscribePayables();
      setClients([]);
      setProducts([]);
      setSales([]);
      setExpenses([]);
      setPayables([]);
      setLoading(Boolean(user));

      if (!user) {
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
          if (generation !== authGeneration) return;
          const list = snapshot.docs.map((document) => ({
            id: document.id,
            ...document.data(),
          }));

          setClients(list);
        },
        (error) => {
          if (generation !== authGeneration) return;
          console.error("Erro ao carregar clientes:", error);
        }
      );

      unsubscribeProducts = onSnapshot(
        productsReference,
        (snapshot) => {
          if (generation !== authGeneration) return;
          const list = snapshot.docs.map((document) => ({
            id: document.id,
            ...document.data(),
          }));

          setProducts(list);
        },
        (error) => {
          if (generation !== authGeneration) return;
          console.error("Erro ao carregar produtos:", error);
        }
      );

      unsubscribeSales = onSnapshot(
        salesReference,
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
          setExpenses(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...document.data(),
            }))
          );
        },
        (error) => {
          if (generation !== authGeneration) return;
          console.error("Erro ao carregar despesas:", error);
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
        },
        (error) => {
          if (generation !== authGeneration) return;
          console.error("Erro ao carregar contas a pagar:", error);
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
      if (unsubscribePayables) unsubscribePayables();
    };
  }, []);

  const tripOrganization = useMemo(
    () => organizeSalesByTrip2026(sales),
    [sales]
  );
  const selectedSales = useMemo(
    () => selectSalesForTrip(tripOrganization, tripFilter),
    [tripOrganization, tripFilter]
  );
  const selectedExpenses = useMemo(
    () =>
      tripFilter === "all"
        ? expenses
        : tripFilter === "review"
          ? []
        : expenses.filter(
            (expense) =>
              String(expense.tripNumber || "") ===
              (tripFilter === "third" ? "3" : tripFilter === "fourth" ? "4" : "")
          ),
    [expenses, tripFilter]
  );
  const selectedPayables = useMemo(
    () => filterPayablesByTrip(payables, tripFilter),
    [payables, tripFilter]
  );
  const tripFinancials = useMemo(
    () => calculateTripFinancialSummary(
      selectedSales,
      selectedExpenses,
      products,
      selectedPayables
    ),
    [products, selectedExpenses, selectedPayables, selectedSales]
  );
  const payableSummary = useMemo(
    () => summarizePayables(payables),
    [payables]
  );

  const dashboard = useMemo(() => {
    const today = new Date();

    const startOfToday = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );

    const startOfTomorrow = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1
    );

    const startOfMonth = new Date(
      today.getFullYear(),
      today.getMonth(),
      1
    );

    const totalClients = clients.length;

    const totalPieces = products.reduce(
      (sum, product) => sum + Number(product.quantity || 0),
      0
    );

    const lowStockProducts = products.filter(
      (product) => Number(product.quantity || 0) <= 3
    );

    const outOfStockProducts = products.filter(
      (product) => Number(product.quantity || 0) <= 0
    );

    const tripScopedClients =
      tripFilter === "all"
        ? clients
        : clients.map((client) => ({ ...client, totalDebt: 0 }));
    const receivables = calculateConsolidatedReceivables(
      tripScopedClients,
      selectedSales
    );
    const totalPending = receivables.totalPending;
    const pendingSales = selectedSales.filter(
      (sale) => Number(sale.pendingAmount || 0) > 0
    ).length;
    let receivedThisMonth = 0;
    let selectedSalesToday = 0;
    let sold = 0;
    let received = 0;

    for (const sale of selectedSales) {
      const amountPaid = Number(sale.amountPaid || 0);
      const total = Number(sale.total || 0);
      const saleDate = toDate(sale.saleDate) || toDate(sale.createdAt);
      sold += total;
      received += amountPaid;

      if (
        saleDate &&
        saleDate >= startOfToday &&
        saleDate < startOfTomorrow
      ) {
        selectedSalesToday += total;
      }

      if (saleDate && saleDate >= startOfMonth) {
        receivedThisMonth += amountPaid;
      }
    }

    const debtorClients = receivables.clients
      .filter((client) => client.totalPending > 0)
      .map((client) => ({
        clientId: client.clientId,
        clientName: client.clientName,
        pending: client.totalPending,
      }));

    if (receivables.unassignedPending > 0) {
      debtorClients.push({
        clientId: "unassigned",
        clientName: "Vendas sem cliente vinculado",
        pending: receivables.unassignedPending,
      });
    }
    debtorClients.sort((first, second) => second.pending - first.pending);

    const priorities = [];

    debtorClients.slice(0, 5).forEach((client) => {
      priorities.push({
        id: `debt-${client.clientId}`,
        type: "debt",
        title: client.clientName,
        subtitle: `Saldo pendente de ${formatCurrency(client.pending)}`,
        badge: "Cobrança",
        badgeColor: "#dc2626",
        badgeBackground: "#fee2e2",
      });
    });

    lowStockProducts.slice(0, 5).forEach((product) => {
      priorities.push({
        id: `stock-${product.id}`,
        type: "stock",
        title: product.name || "Produto",
        subtitle: `Apenas ${Number(product.quantity || 0)} unidade(s) em estoque`,
        badge: "Estoque baixo",
        badgeColor: "#ca8a04",
        badgeBackground: "#fef9c3",
      });
    });

    return {
      totalClients,
      totalPieces,
      lowStockCount: lowStockProducts.length,
      outOfStockCount: outOfStockProducts.length,
      salesToday: selectedSalesToday,
      sold,
      received,
      salesCount: selectedSales.length,
      tripExpenses: tripFinancials.expenses,
      tripEstimatedProfit: tripFinancials.estimatedProfit,
      tripCostDataComplete: tripFinancials.hasCompleteCostData,
      tripCashFlow: tripFinancials.cashFlow,
      supplierPayments: tripFinancials.supplierPayments,
      supplierOperationalPurchases:
        tripFinancials.supplierOperationalPurchases,
      totalPending,
      pendingSales,
      receivedThisMonth,
      debtorClients,
      priorities,
    };
  }, [clients, products, selectedSales, tripFinancials, tripFilter]);

  function formatCurrency(value) {
    return Number(value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }

  function formatDate(date) {
    return date.toLocaleDateString("pt-BR");
  }

  const todayText = formatDate(new Date());

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.welcome}>Bem-vindo ao</p>
          <h1 style={styles.title}>RC Manager</h1>
          <p style={styles.subtitle}>
            Gestão inteligente da RC Confecções
          </p>
        </div>

        <div style={styles.dateCard}>
          📅 {todayText}
        </div>
      </header>

      {loading ? (
        <div style={styles.loadingBox}>
          <span style={styles.loadingIcon}>⏳</span>
          <strong>Carregando informações...</strong>
        </div>
      ) : (
        <>
          <section style={styles.tripSection}>
            <div style={styles.tripHeader}>
              <div>
                <h2 style={styles.cardTitle}>Resultado das vendas por viagem</h2>
                <p style={styles.cardSubtitle}>
                  Classificação proposta pela data da venda ou, se ausente,
                  pela criação do registro. Nenhum dado foi alterado.
                  {" "}Despesas vinculadas acompanham a viagem selecionada.
                </p>
              </div>

              <label style={styles.tripFilterLabel}>
                Viagem
                <select
                  value={tripFilter}
                  onChange={(event) => setTripFilter(event.target.value)}
                  style={styles.tripSelect}
                >
                  <option value="all">Geral</option>
                  <option value="third">3ª viagem</option>
                  <option value="fourth">4ª viagem</option>
                  <option value="review">Revisão necessária</option>
                </select>
              </label>
            </div>

            <div style={styles.tripSummaryGrid}>
              {[
                { label: "Vendido", value: formatCurrency(dashboard.sold) },
                { label: "Recebido", value: formatCurrency(dashboard.received) },
                {
                  label: "Pendente",
                  value: formatCurrency(dashboard.totalPending),
                },
                { label: "Vendas", value: dashboard.salesCount },
                {
                  label: "Despesas vinculadas",
                  value: formatCurrency(dashboard.tripExpenses),
                },
                {
                  label: "Lucro estimado",
                  value: dashboard.tripCostDataComplete
                    ? formatCurrency(dashboard.tripEstimatedProfit)
                    : "Dados de custo incompletos",
                },
                {
                  label: "Fluxo de caixa",
                  value: formatCurrency(dashboard.tripCashFlow),
                },
                {
                  label: "Pagamentos a fornecedores",
                  value: formatCurrency(dashboard.supplierPayments),
                },
                {
                  label: "Compras operacionais de fornecedores",
                  value: formatCurrency(dashboard.supplierOperationalPurchases),
                },
              ].map(({ label, value }) => (
                <div key={label} style={styles.tripSummaryCard}>
                  <span style={styles.summaryLabel}>{label}</span>
                  <strong style={styles.summaryValue}>{value}</strong>
                </div>
              ))}
            </div>
            {tripFilter !== "all" && (
              <p style={styles.tripNotice}>
                Esta visão usa a classificação proposta e ainda não confirmada.
                Apenas despesas explicitamente vinculadas são incluídas.
              </p>
            )}
          </section>

          <section style={styles.summaryGrid}>
            <div style={styles.summaryCardPurple}>
              <div style={styles.iconBox}>👥</div>
              <div>
                <span style={styles.summaryLabel}>Total de clientes</span>
                <strong style={styles.summaryValue}>
                  {dashboard.totalClients}
                </strong>
              </div>
            </div>

            <div style={styles.summaryCardRed}>
              <div style={styles.iconBox}>📦</div>
              <div>
                <span style={styles.summaryLabel}>Peças em estoque</span>
                <strong style={styles.summaryValue}>
                  {dashboard.totalPieces}
                </strong>
              </div>
            </div>
          </section>

          <section className="dashboard-payables">
            <div className="dashboard-payables-heading">
              <div>
                <p>Fornecedores</p>
                <h2>Contas a pagar</h2>
                <span>Visão geral das obrigações da empresa, independente do filtro de viagem acima.</span>
              </div>
              <a href="/financeiro">Abrir Financeiro</a>
            </div>
            <div className="dashboard-payables-metrics">
              <article><span>Total a pagar</span><strong>{formatCurrency(payableSummary.totalToPay)}</strong></article>
              <article><span>Contas vencidas</span><strong>{payableSummary.overdueCount} · {formatCurrency(payableSummary.overdueTotal)}</strong></article>
              <article><span>A vencer em 30 dias</span><strong>{payableSummary.upcomingCount} · {formatCurrency(payableSummary.upcomingTotal)}</strong></article>
              <article><span>Total pago</span><strong>{formatCurrency(payableSummary.totalPaid)}</strong></article>
            </div>
            <div className="dashboard-payables-upcoming">
              <h3>Próximos vencimentos</h3>
              {payableSummary.upcomingItems.length ? (
                payableSummary.upcomingItems.slice(0, 5).map((item) => (
                  <p key={`${item.payableId}-${item.identification}-${item.dueDate.getTime()}`}>
                    <strong>{item.dueDate.toLocaleDateString("pt-BR")}</strong> · {item.supplierName} · {item.method === "cheque" ? "Cheque" : "Parcela"} {item.identification ? `#${item.identification}` : ""} · {formatCurrency(item.amount)}
                  </p>
                ))
              ) : (
                <p>Nenhum vencimento previsto para os próximos 30 dias.</p>
              )}
            </div>
          </section>
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
    gap: "20px",
    marginBottom: "24px",
  },

  welcome: {
    margin: 0,
    color: "#64748b",
    fontSize: "14px",
  },

  title: {
    margin: "4px 0",
    fontSize: "34px",
  },

  subtitle: {
    margin: 0,
    color: "#64748b",
    fontSize: "17px",
  },

  dateCard: {
    padding: "14px 18px",
    borderRadius: "14px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    fontWeight: "700",
  },

  loadingBox: {
    minHeight: "350px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    color: "#64748b",
  },

  loadingIcon: {
    marginBottom: "12px",
    fontSize: "42px",
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "14px",
    marginBottom: "22px",
  },

  tripSection: {
    marginBottom: "22px",
    padding: "22px",
    borderRadius: "18px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 10px 25px rgba(15, 23, 42, 0.06)",
  },

  tripHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "16px",
    flexWrap: "wrap",
    marginBottom: "18px",
  },

  tripFilterLabel: {
    display: "grid",
    gap: "6px",
    color: "#475569",
    fontSize: "13px",
    fontWeight: "700",
  },

  tripSelect: {
    minWidth: "190px",
    padding: "10px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: "10px",
    background: "#ffffff",
    color: "#0f172a",
    font: "inherit",
  },

  tripSummaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
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

  summaryCardBlue: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    padding: "20px",
    borderRadius: "18px",
    background: "#ffffff",
    borderTop: "4px solid #2563eb",
    boxShadow: "0 10px 25px rgba(15, 23, 42, 0.08)",
  },

  summaryCardGreen: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    padding: "20px",
    borderRadius: "18px",
    background: "#ffffff",
    borderTop: "4px solid #16a34a",
    boxShadow: "0 10px 25px rgba(15, 23, 42, 0.08)",
  },

  summaryCardPurple: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    padding: "20px",
    borderRadius: "18px",
    background: "#ffffff",
    borderTop: "4px solid #7c3aed",
    boxShadow: "0 10px 25px rgba(15, 23, 42, 0.08)",
  },

  summaryCardRed: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    padding: "20px",
    borderRadius: "18px",
    background: "#ffffff",
    borderTop: "4px solid #dc2626",
    boxShadow: "0 10px 25px rgba(15, 23, 42, 0.08)",
  },

  iconBox: {
    width: "46px",
    height: "46px",
    display: "grid",
    placeItems: "center",
    borderRadius: "13px",
    background: "#f8fafc",
    fontSize: "24px",
  },

  summaryLabel: {
    display: "block",
    marginBottom: "6px",
    color: "#64748b",
    fontSize: "13px",
  },

  summaryValue: {
    fontSize: "22px",
  },

  cardTitle: {
    margin: "0 0 7px",
    fontSize: "21px",
  },

  cardSubtitle: {
    margin: 0,
    color: "#64748b",
    fontSize: "14px",
  },
};