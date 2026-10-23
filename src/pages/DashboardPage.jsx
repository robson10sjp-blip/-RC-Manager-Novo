import { useEffect, useMemo, useState } from "react";
import { LuLayoutDashboard } from "react-icons/lu";
import PageHeader from "../components/PageHeader.jsx";
import FinancialValue from "../components/FinancialValue.jsx";
import { useFinancialPrivacy } from "../context/financialPrivacy.js";
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
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  LuBanknote,
  LuCalendarDays,
  LuClock3,
  LuPackage,
  LuReceipt,
  LuTrendingUp,
  LuUsers,
  LuWallet,
} from "react-icons/lu";
import "./DashboardPayables.css";
import "./DashboardPremium.css";

export default function DashboardPage() {
  const { hidden: financialValuesHidden } = useFinancialPrivacy();
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
      tripPersonalWithdrawals: tripFinancials.personalWithdrawals,
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

  const kpis = [
    { label: "Vendido", value: formatCurrency(dashboard.sold), Icon: LuBanknote, tone: "navy" },
    { label: "Recebido", value: formatCurrency(dashboard.received), Icon: LuWallet, tone: "green" },
    { label: "Pendente", value: formatCurrency(dashboard.totalPending), Icon: LuClock3, tone: "gold" },
    { label: "Vendas", value: dashboard.salesCount, Icon: LuReceipt, tone: "slate" },
    { label: "Despesas vinculadas", value: formatCurrency(dashboard.tripExpenses), Icon: LuTrendingUp, tone: "red" },
  ];

  const secondaryMetrics = [
    {
      label: "Lucro estimado",
      value: dashboard.tripCostDataComplete
        ? formatCurrency(dashboard.tripEstimatedProfit)
        : "Dados de custo incompletos",
    },
    { label: "Fluxo de caixa", value: formatCurrency(dashboard.tripCashFlow) },
    { label: "Retirada pessoal", value: formatCurrency(dashboard.tripPersonalWithdrawals) },
    { label: "Pagamentos a fornecedores", value: formatCurrency(dashboard.supplierPayments) },
    {
      label: "Compras operacionais de fornecedores",
      value: formatCurrency(dashboard.supplierOperationalPurchases),
    },
  ];

  const compositionData = [
    { name: "Recebido", value: Math.max(dashboard.received, 0), color: "#15803d" },
    { name: "Pendente", value: Math.max(dashboard.totalPending, 0), color: "#b8892f" },
  ];

  const tripComparison = [
    { key: "third", name: "3ª viagem" },
    { key: "fourth", name: "4ª viagem" },
  ].map(({ key, name }) => {
    const tripSales = selectSalesForTrip(tripOrganization, key);
    const sold = tripSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    const received = tripSales.reduce((sum, sale) => sum + Number(sale.amountPaid || 0), 0);
    return {
      name,
      Vendido: sold,
      Recebido: received,
      Pendente: Math.max(sold - received, 0),
    };
  });

  const compactCurrency = (value) =>
    Number(value || 0).toLocaleString("pt-BR", {
      notation: "compact",
      maximumFractionDigits: 1,
    });

  return (
    <div className="dash">
      <PageHeader
        icon={LuLayoutDashboard}
        title="Dashboard"
        description="Gestão inteligente da RC Confecções"
      >
        <div className="dash-date">
          <LuCalendarDays aria-hidden="true" />
          {todayText}
        </div>
      </PageHeader>

      {loading ? (
        <div className="dash-loading">
          <strong>Carregando informações...</strong>
        </div>
      ) : (
        <>
          <section className="dash-panel">
            <div className="dash-panel-head">
              <div>
                <h2>Resultado das vendas por viagem</h2>
                <p>
                  Classificação proposta pela data da venda ou, se ausente,
                  pela criação do registro. Nenhum dado foi alterado.
                  {" "}Despesas vinculadas acompanham a viagem selecionada.
                </p>
              </div>

              <label className="dash-filter">
                Viagem
                <select
                  value={tripFilter}
                  onChange={(event) => setTripFilter(event.target.value)}
                >
                  <option value="all">Geral</option>
                  <option value="third">3ª viagem</option>
                  <option value="fourth">4ª viagem</option>
                  <option value="review">Revisão necessária</option>
                </select>
              </label>
            </div>

            <div className="dash-kpis">
              {kpis.map(({ label, value, Icon, tone }) => (
                <article key={label} className={`dash-kpi dash-kpi-${tone}`}>
                  <span className="dash-kpi-icon"><Icon aria-hidden="true" /></span>
                  <span className="dash-kpi-label">{label}</span>
                  <strong>
                    {label === "Vendas" ? value : <FinancialValue>{value}</FinancialValue>}
                  </strong>
                </article>
              ))}
            </div>

            <div className="dash-secondary">
              {secondaryMetrics.map(({ label, value }) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong><FinancialValue>{value}</FinancialValue></strong>
                </div>
              ))}
            </div>

            {tripFilter !== "all" && (
              <p className="dash-notice">
                Esta visão usa a classificação proposta e ainda não confirmada.
                Apenas despesas explicitamente vinculadas são incluídas.
              </p>
            )}
          </section>

          <div className="dash-grid">
            <section className="dash-panel dash-chart-wide">
              <h2>Comparativo entre viagens</h2>
              <div className="dash-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tripComparison} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7ee" />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} />
                    <YAxis
                      tickFormatter={financialValuesHidden ? () => "••••" : compactCurrency}
                      tickLine={false}
                      axisLine={false}
                      width={64}
                    />
                    <Tooltip
                      formatter={(value) =>
                        financialValuesHidden ? "••••••" : formatCurrency(value)
                      }
                    />
                    <Bar dataKey="Vendido" fill="#0f1b33" isAnimationActive={false} radius={[6, 6, 0, 0]} />
                    <Bar dataKey="Recebido" fill="#15803d" isAnimationActive={false} radius={[6, 6, 0, 0]} />
                    <Bar dataKey="Pendente" fill="#b8892f" isAnimationActive={false} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="dash-legend">
                <span><i style={{ background: "#0f1b33" }} />Vendido</span>
                <span><i style={{ background: "#15803d" }} />Recebido</span>
                <span><i style={{ background: "#b8892f" }} />Pendente</span>
              </div>
            </section>

            <section className="dash-panel">
              <h2>Recebido x pendente</h2>
              <div className="dash-chart dash-chart-donut">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={compositionData}
                      dataKey="value"
                      innerRadius="62%"
                      outerRadius="90%"
                      paddingAngle={2}
                      stroke="none"
                      isAnimationActive={false}
                    >
                      {compositionData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) =>
                        financialValuesHidden ? "••••••" : formatCurrency(value)
                      }
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="dash-donut-center">
                  <span>Recebido</span>
                  <strong>
                    {financialValuesHidden
                      ? "••••••"
                      : dashboard.sold > 0
                      ? `${Math.round((dashboard.received / dashboard.sold) * 100)}%`
                      : "—"}
                  </strong>
                </div>
              </div>
              <div className="dash-legend">
                <span><i style={{ background: "#15803d" }} />Recebido</span>
                <span><i style={{ background: "#b8892f" }} />Pendente</span>
              </div>
            </section>

            <section className="dash-panel dash-mini-column">
              <article className="dash-mini">
                <span className="dash-kpi-icon"><LuUsers aria-hidden="true" /></span>
                <div>
                  <span>Total de clientes</span>
                  <strong>{dashboard.totalClients}</strong>
                </div>
              </article>
              <article className="dash-mini">
                <span className="dash-kpi-icon"><LuPackage aria-hidden="true" /></span>
                <div>
                  <span>Peças em estoque</span>
                  <strong>{dashboard.totalPieces}</strong>
                </div>
              </article>
            </section>
          </div>

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
              <article><span>Total a pagar</span><strong><FinancialValue>{formatCurrency(payableSummary.totalToPay)}</FinancialValue></strong></article>
              <article><span>Contas vencidas</span><strong>{payableSummary.overdueCount} · <FinancialValue>{formatCurrency(payableSummary.overdueTotal)}</FinancialValue></strong></article>
              <article><span>A vencer em 30 dias</span><strong>{payableSummary.upcomingCount} · <FinancialValue>{formatCurrency(payableSummary.upcomingTotal)}</FinancialValue></strong></article>
              <article><span>Total pago</span><strong><FinancialValue>{formatCurrency(payableSummary.totalPaid)}</FinancialValue></strong></article>
            </div>
            <div className="dashboard-payables-upcoming">
              <h3>Próximos vencimentos</h3>
              {payableSummary.upcomingItems.length ? (
                payableSummary.upcomingItems.slice(0, 5).map((item) => (
                  <p key={`${item.payableId}-${item.identification}-${item.dueDate.getTime()}`}>
                    <strong>{item.dueDate.toLocaleDateString("pt-BR")}</strong> · {item.supplierName} · {item.method === "cheque" ? "Cheque" : "Parcela"} {item.identification ? `#${item.identification}` : ""} · <FinancialValue>{formatCurrency(item.amount)}</FinancialValue>
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
