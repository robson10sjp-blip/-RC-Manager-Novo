import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot } from "firebase/firestore";

import { auth, db } from "../firebase/config";

export default function DashboardPage() {
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);

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
    });

    return () => {
      unsubscribeAuth();

      if (unsubscribeClients) unsubscribeClients();
      if (unsubscribeProducts) unsubscribeProducts();
      if (unsubscribeSales) unsubscribeSales();
    };
  }, []);

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

    let salesToday = 0;
    let totalPending = 0;
    let pendingSales = 0;
    let receivedThisMonth = 0;

    const debtorMap = new Map();

    for (const sale of sales) {
      const pending = Number(sale.pendingAmount || 0);
      const amountPaid = Number(sale.amountPaid || 0);
      const total = Number(sale.total || 0);
      const saleDate = sale.createdAt?.toDate?.();

      if (
        saleDate &&
        saleDate >= startOfToday &&
        saleDate < startOfTomorrow
      ) {
        salesToday += total;
      }

      if (pending > 0) {
        totalPending += pending;
        pendingSales += 1;

        const current = debtorMap.get(sale.clientId) || {
          clientId: sale.clientId,
          clientName: sale.clientName || "Cliente",
          pending: 0,
          oldestSaleDate: saleDate || null,
        };

        current.pending += pending;

        if (
          saleDate &&
          (!current.oldestSaleDate || saleDate < current.oldestSaleDate)
        ) {
          current.oldestSaleDate = saleDate;
        }

        debtorMap.set(sale.clientId, current);
      }

      if (saleDate && saleDate >= startOfMonth) {
        receivedThisMonth += amountPaid;
      }
    }

    const debtorClients = Array.from(debtorMap.values()).sort(
      (first, second) => second.pending - first.pending
    );

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
      salesToday,
      totalPending,
      pendingSales,
      receivedThisMonth,
      debtorClients,
      priorities,
    };
  }, [clients, products, sales]);

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
          <section style={styles.summaryGrid}>
            <div style={styles.summaryCardBlue}>
              <div style={styles.iconBox}>💰</div>
              <div>
                <span style={styles.summaryLabel}>Vendas de hoje</span>
                <strong style={styles.summaryValue}>
                  {formatCurrency(dashboard.salesToday)}
                </strong>
              </div>
            </div>

            <div style={styles.summaryCardGreen}>
              <div style={styles.iconBox}>💵</div>
              <div>
                <span style={styles.summaryLabel}>Valor a receber</span>
                <strong style={styles.summaryValue}>
                  {formatCurrency(dashboard.totalPending)}
                </strong>
              </div>
            </div>

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

          <section style={styles.contentGrid}>
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <div>
                  <h2 style={styles.cardTitle}>Prioridades do dia</h2>
                  <p style={styles.cardSubtitle}>
                    Clientes e produtos que precisam de atenção
                  </p>
                </div>

                <span style={styles.counterBadge}>
                  {dashboard.priorities.length} pendência(s)
                </span>
              </div>

              {dashboard.priorities.length === 0 ? (
                <div style={styles.empty}>
                  <span style={styles.emptyIcon}>✅</span>
                  <strong>Nenhuma prioridade cadastrada</strong>
                  <p>As pendências aparecerão aqui.</p>
                </div>
              ) : (
                <div style={styles.priorityList}>
                  {dashboard.priorities.map((item) => (
                    <article key={item.id} style={styles.priorityItem}>
                      <div>
                        <h3 style={styles.priorityTitle}>{item.title}</h3>
                        <p style={styles.prioritySubtitle}>
                          {item.subtitle}
                        </p>
                      </div>

                      <span
                        style={{
                          ...styles.priorityBadge,
                          color: item.badgeColor,
                          background: item.badgeBackground,
                        }}
                      >
                        {item.badge}
                      </span>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div style={styles.card}>
              <h2 style={styles.cardTitle}>Resumo rápido</h2>
              <p style={styles.cardSubtitle}>
                Situação atual da sua empresa
              </p>

              <div style={styles.quickList}>
                <div style={styles.quickItem}>
                  <span>Clientes devedores</span>
                  <strong>{dashboard.debtorClients.length}</strong>
                </div>

                <div style={styles.quickItem}>
                  <span>Produtos com estoque baixo</span>
                  <strong>{dashboard.lowStockCount}</strong>
                </div>

                <div style={styles.quickItem}>
                  <span>Produtos sem estoque</span>
                  <strong>{dashboard.outOfStockCount}</strong>
                </div>

                <div style={styles.quickItem}>
                  <span>Vendas pendentes</span>
                  <strong>{dashboard.pendingSales}</strong>
                </div>

                <div style={styles.quickItem}>
                  <span>Recebimentos do mês</span>
                  <strong style={styles.greenText}>
                    {formatCurrency(dashboard.receivedThisMonth)}
                  </strong>
                </div>
              </div>
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

  contentGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "22px",
  },

  card: {
    padding: "24px",
    borderRadius: "18px",
    background: "#ffffff",
    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
  },

  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "15px",
    flexWrap: "wrap",
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

  counterBadge: {
    padding: "6px 10px",
    borderRadius: "999px",
    background: "#dbeafe",
    color: "#2563eb",
    fontSize: "12px",
    fontWeight: "800",
  },

  empty: {
    minHeight: "260px",
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

  priorityList: {
    display: "grid",
    gap: "12px",
    marginTop: "20px",
  },

  priorityItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "14px",
    padding: "15px",
    borderRadius: "13px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  priorityTitle: {
    margin: "0 0 5px",
    fontSize: "16px",
  },

  prioritySubtitle: {
    margin: 0,
    color: "#64748b",
    fontSize: "13px",
  },

  priorityBadge: {
    padding: "5px 9px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: "800",
    whiteSpace: "nowrap",
  },

  quickList: {
    display: "grid",
    gap: "0",
    marginTop: "18px",
  },

  quickItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "14px",
    padding: "15px 0",
    borderBottom: "1px solid #e2e8f0",
    color: "#475569",
  },

  greenText: {
    color: "#16a34a",
  },
};