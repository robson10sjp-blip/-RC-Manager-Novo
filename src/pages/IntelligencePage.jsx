import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot } from "firebase/firestore";

import { auth, db } from "../firebase/config";

export default function IntelligencePage() {
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [monthlyGoal, setMonthlyGoal] = useState(30000);

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
          setExpenses(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...document.data(),
            }))
          );
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
      const saleDate = sale.createdAt?.toDate?.();
      const isThisMonth =
        saleDate &&
        saleDate >= monthStart &&
        saleDate < nextMonthStart;

      const client = clientMap.get(sale.clientId);
      const city = client?.city || "Cidade não informada";
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

    const monthExpenses = expenses.reduce((sum, expense) => {
      const expenseDate =
        expense.expenseDate?.toDate?.() ||
        expense.createdAt?.toDate?.();

      if (
        expenseDate &&
        expenseDate >= monthStart &&
        expenseDate < nextMonthStart
      ) {
        return sum + Number(expense.value || 0);
      }

      return sum;
    }, 0);

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
        const date = sale.createdAt?.toDate?.();
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
    clients,
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

  function formatDate(date) {
    if (!date) return "Sem data";

    return date.toLocaleDateString("pt-BR");
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
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>RC Confecções</p>
          <h1 style={styles.title}>Inteligência RC</h1>
          <p style={styles.subtitle}>
            Análises automáticas para vender mais, cobrar melhor e comprar certo.
          </p>
        </div>

        <label style={styles.goalControl}>
          Meta mensal
          <input
            type="number"
            min="0"
            step="100"
            value={monthlyGoal}
            onChange={(event) =>
              setMonthlyGoal(Number(event.target.value || 0))
            }
            style={styles.goalInput}
          />
        </label>
      </header>

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
                {formatCurrency(intelligence.monthSales)}
              </strong>
            </div>

            <div style={styles.summaryCard}>
              <span style={styles.summaryLabel}>Recebido no mês</span>
              <strong style={styles.greenValue}>
                {formatCurrency(intelligence.monthReceived)}
              </strong>
            </div>

            <div style={styles.summaryCard}>
              <span style={styles.summaryLabel}>Lucro líquido estimado</span>
              <strong
                style={
                  intelligence.netProfit >= 0
                    ? styles.greenValue
                    : styles.redValue
                }
              >
                {formatCurrency(intelligence.netProfit)}
              </strong>
            </div>

            <div style={styles.summaryCard}>
              <span style={styles.summaryLabel}>Ticket médio</span>
              <strong style={styles.summaryValue}>
                {formatCurrency(intelligence.averageTicket)}
              </strong>
            </div>

            <div style={styles.summaryCard}>
              <span style={styles.summaryLabel}>Previsão do mês</span>
              <strong style={styles.blueValue}>
                {formatCurrency(intelligence.forecastMonth)}
              </strong>
            </div>

            <div style={styles.summaryCard}>
              <span style={styles.summaryLabel}>Pendente para receber</span>
              <strong style={styles.redValue}>
                {formatCurrency(intelligence.totalPending)}
              </strong>
            </div>
          </section>

          <section style={styles.goalCard}>
            <div style={styles.goalTop}>
              <div>
                <h2 style={styles.cardTitle}>Meta mensal</h2>
                <p style={styles.helperText}>
                  {formatCurrency(intelligence.monthSales)} de{" "}
                  {formatCurrency(monthlyGoal)}
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
                  {formatCurrency(intelligence.remainingGoal)}
                </strong>
              </span>

              <span>
                Necessário por dia:{" "}
                <strong>
                  {formatCurrency(intelligence.dailyGoalNeeded)}
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
                    {formatCurrency(
                      intelligence.bestClients[0]?.totalBought
                    )}
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
                    {formatCurrency(
                      intelligence.bestCities[0]?.totalSales
                    )}
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
                          {formatCurrency(client.totalPending)}
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
                          {formatCurrency(product.stockValue)}
                        </strong>
                      </article>
                    ))}
                </div>
              )}
            </div>

            <div style={styles.card}>
              <h2 style={styles.cardTitle}>🏙️ Ranking por cidade</h2>
              <p style={styles.helperText}>
                Cidades ordenadas pelo maior valor vendido.
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
                          {formatCurrency(city.totalSales)}
                        </strong>
                      </article>
                    ))}
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function formatCurrency(value) {
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