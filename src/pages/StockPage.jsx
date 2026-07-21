import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "../firebase/config";

export default function StockPage() {
  const [products, setProducts] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [loading, setLoading] = useState(true);
  const [adjustingId, setAdjustingId] = useState(null);

  useEffect(() => {
    let unsubscribeProducts = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (unsubscribeProducts) {
        unsubscribeProducts();
        unsubscribeProducts = null;
      }

      if (!user) {
        setProducts([]);
        setLoading(false);
        return;
      }

      const productsReference = collection(
        db,
        "users",
        user.uid,
        "products"
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
          setLoading(false);
        },
        (error) => {
          console.error("Erro ao carregar estoque:", error);
          alert(`Erro ao carregar estoque: ${error.message}`);
          setLoading(false);
        }
      );
    });

    return () => {
      unsubscribeAuth();

      if (unsubscribeProducts) {
        unsubscribeProducts();
      }
    };
  }, []);

  const filteredProducts = useMemo(() => {
    const search = searchText.trim().toLowerCase();

    if (!search) {
      return products;
    }

    return products.filter((product) => {
      const code = String(product.code || "").toLowerCase();
      const name = String(product.name || "").toLowerCase();
      const category = String(product.category || "").toLowerCase();
      const size = String(product.size || "").toLowerCase();
      const color = String(product.color || "").toLowerCase();

      return (
        code.includes(search) ||
        name.includes(search) ||
        category.includes(search) ||
        size.includes(search) ||
        color.includes(search)
      );
    });
  }, [products, searchText]);

  const summary = useMemo(() => {
    return products.reduce(
      (result, product) => {
        const quantity = Number(product.quantity || 0);
        const costPrice = Number(product.costPrice || 0);
        const salePrice = Number(product.salePrice || 0);

        result.totalProducts += 1;
        result.totalPieces += quantity;
        result.totalCost += quantity * costPrice;
        result.totalSale += quantity * salePrice;

        if (quantity <= 3) {
          result.lowStock += 1;
        }

        if (quantity <= 0) {
          result.outOfStock += 1;
        }

        return result;
      },
      {
        totalProducts: 0,
        totalPieces: 0,
        totalCost: 0,
        totalSale: 0,
        lowStock: 0,
        outOfStock: 0,
      }
    );
  }, [products]);

  function formatCurrency(value) {
    return Number(value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }

  function formatCategory(category) {
    const categories = {
      feminino: "Feminino",
      masculino: "Masculino",
      infantil: "Infantil",
    };

    return categories[category] || category || "Não informada";
  }

  function getStockStatus(quantityValue) {
    const quantity = Number(quantityValue || 0);

    if (quantity <= 0) {
      return {
        label: "Sem estoque",
        color: "#dc2626",
        background: "#fee2e2",
      };
    }

    if (quantity <= 3) {
      return {
        label: "Estoque baixo",
        color: "#ca8a04",
        background: "#fef9c3",
      };
    }

    return {
      label: "Em estoque",
      color: "#16a34a",
      background: "#dcfce7",
    };
  }

  async function handleStockAdjustment(product, type) {
    const user = auth.currentUser;

    if (!user) {
      alert("Você precisa entrar novamente no sistema.");
      return;
    }

    const actionText = type === "entrada" ? "adicionar" : "retirar";

    const typedValue = window.prompt(
      `Quantidade atual: ${Number(product.quantity || 0)}\n\n` +
        `Digite quantas unidades deseja ${actionText}:`
    );

    if (typedValue === null) {
      return;
    }

    const adjustment = Number(
      typedValue.replace(",", ".").replace(/[^\d.-]/g, "")
    );

    if (!Number.isInteger(adjustment) || adjustment <= 0) {
      alert("Digite uma quantidade inteira maior que zero.");
      return;
    }

    const reason =
      window.prompt(
        "Informe o motivo da movimentação:",
        type === "entrada"
          ? "Entrada de mercadoria"
          : "Baixa manual"
      ) || "";

    try {
      setAdjustingId(product.id);

      const productReference = doc(
        db,
        "users",
        user.uid,
        "products",
        product.id
      );

      const movementReference = doc(
        collection(
          db,
          "users",
          user.uid,
          "stockMovements"
        )
      );

      await runTransaction(db, async (transaction) => {
        const productSnapshot = await transaction.get(productReference);

        if (!productSnapshot.exists()) {
          throw new Error("Produto não encontrado.");
        }

        const savedProduct = productSnapshot.data();
        const currentQuantity = Number(savedProduct.quantity || 0);

        const newQuantity =
          type === "entrada"
            ? currentQuantity + adjustment
            : currentQuantity - adjustment;

        if (newQuantity < 0) {
          throw new Error(
            `Estoque insuficiente. Disponível: ${currentQuantity}.`
          );
        }

        transaction.update(productReference, {
          quantity: newQuantity,
          updatedAt: serverTimestamp(),
        });

        transaction.set(movementReference, {
          productId: product.id,
          productName: savedProduct.name || "",
          productCode: savedProduct.code || "",
          type,
          quantity: adjustment,
          previousQuantity: currentQuantity,
          newQuantity,
          reason: reason.trim(),
          createdAt: serverTimestamp(),
        });
      });

      alert(
        type === "entrada"
          ? "Entrada registrada com sucesso!"
          : "Baixa registrada com sucesso!"
      );
    } catch (error) {
      console.error("Erro ao movimentar estoque:", error);
      alert(`Erro ao movimentar estoque: ${error.message}`);
    } finally {
      setAdjustingId(null);
    }
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>RC Confecções</p>
          <h1 style={styles.title}>Estoque</h1>
          <p style={styles.subtitle}>
            Acompanhe as peças disponíveis e faça movimentações manuais.
          </p>
        </div>
      </header>

      <section style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>Produtos cadastrados</span>
          <strong style={styles.summaryValue}>
            {summary.totalProducts}
          </strong>
        </div>

        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>Peças em estoque</span>
          <strong style={styles.summaryValue}>
            {summary.totalPieces}
          </strong>
        </div>

        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>Valor investido</span>
          <strong style={styles.summaryValue}>
            {formatCurrency(summary.totalCost)}
          </strong>
        </div>

        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>Valor de venda</span>
          <strong style={styles.saleValue}>
            {formatCurrency(summary.totalSale)}
          </strong>
        </div>

        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>Lucro estimado</span>
          <strong style={styles.profitValue}>
            {formatCurrency(summary.totalSale - summary.totalCost)}
          </strong>
        </div>

        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>Estoque baixo</span>
          <strong style={styles.warningValue}>
            {summary.lowStock}
          </strong>
        </div>
      </section>

      <section style={styles.card}>
        <div style={styles.toolbar}>
          <div>
            <h2 style={styles.cardTitle}>Produtos em estoque</h2>
            <p style={styles.helperText}>
              {filteredProducts.length} produto(s) encontrado(s).
            </p>
          </div>

          <input
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Pesquisar código, nome, categoria, tamanho ou cor"
            style={styles.searchInput}
          />
        </div>

        {loading ? (
          <div style={styles.empty}>
            <span style={styles.emptyIcon}>⏳</span>
            <strong>Carregando estoque...</strong>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div style={styles.empty}>
            <span style={styles.emptyIcon}>📦</span>
            <strong>Nenhum produto encontrado</strong>
            <p>Cadastre produtos na página Produtos.</p>
          </div>
        ) : (
          <div style={styles.list}>
            {filteredProducts.map((product) => {
              const stockStatus = getStockStatus(product.quantity);
              const quantity = Number(product.quantity || 0);

              return (
                <article key={product.id} style={styles.productItem}>
                  <div style={styles.productContent}>
                    <div style={styles.productTitleArea}>
                      <h3 style={styles.productName}>
                        {product.name || "Produto sem nome"}
                      </h3>

                      <span
                        style={{
                          ...styles.statusBadge,
                          color: stockStatus.color,
                          background: stockStatus.background,
                        }}
                      >
                        {stockStatus.label}
                      </span>
                    </div>

                    <p style={styles.productCode}>
                      Código: {product.code || "Não informado"}
                    </p>

                    <div style={styles.tags}>
                      <span style={styles.tag}>
                        {formatCategory(product.category)}
                      </span>

                      <span style={styles.tag}>
                        Tamanho: {product.size || "Não informado"}
                      </span>

                      <span style={styles.tag}>
                        Cor: {product.color || "Não informada"}
                      </span>
                    </div>

                    <div style={styles.valuesGrid}>
                      <div>
                        <span style={styles.smallLabel}>Quantidade</span>
                        <strong style={styles.quantityValue}>
                          {quantity}
                        </strong>
                      </div>

                      <div>
                        <span style={styles.smallLabel}>Custo unitário</span>
                        <strong>
                          {formatCurrency(product.costPrice)}
                        </strong>
                      </div>

                      <div>
                        <span style={styles.smallLabel}>Venda unitária</span>
                        <strong style={styles.saleValue}>
                          {formatCurrency(product.salePrice)}
                        </strong>
                      </div>

                      <div>
                        <span style={styles.smallLabel}>Total em venda</span>
                        <strong>
                          {formatCurrency(
                            quantity * Number(product.salePrice || 0)
                          )}
                        </strong>
                      </div>
                    </div>
                  </div>

                  <div style={styles.actions}>
                    <button
                      type="button"
                      onClick={() =>
                        handleStockAdjustment(product, "entrada")
                      }
                      disabled={adjustingId === product.id}
                      style={styles.entryButton}
                    >
                      ➕ Entrada
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        handleStockAdjustment(product, "saida")
                      }
                      disabled={
                        adjustingId === product.id || quantity <= 0
                      }
                      style={{
                        ...styles.exitButton,
                        opacity:
                          adjustingId === product.id || quantity <= 0
                            ? 0.5
                            : 1,
                        cursor:
                          adjustingId === product.id || quantity <= 0
                            ? "not-allowed"
                            : "pointer",
                      }}
                    >
                      ➖ Baixa
                    </button>
                  </div>
                </article>
              );
            })}
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

  saleValue: {
    color: "#2563eb",
    fontSize: "18px",
  },

  profitValue: {
    color: "#16a34a",
    fontSize: "18px",
  },

  warningValue: {
    color: "#ca8a04",
    fontSize: "20px",
  },

  card: {
    padding: "24px",
    borderRadius: "18px",
    background: "#ffffff",
    boxShadow:
      "0 10px 30px rgba(15, 23, 42, 0.08)",
  },

  toolbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "16px",
    marginBottom: "18px",
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

  searchInput: {
    width: "min(100%, 430px)",
    boxSizing: "border-box",
    padding: "13px 14px",
    borderRadius: "11px",
    border: "1px solid #cbd5e1",
    outline: "none",
    fontSize: "15px",
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

  list: {
    display: "grid",
    gap: "14px",
  },

  productItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "18px",
    padding: "18px",
    borderRadius: "15px",
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
  },

  productContent: {
    flex: "1 1 420px",
  },

  productTitleArea: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "10px",
  },

  productName: {
    margin: 0,
    fontSize: "18px",
  },

  statusBadge: {
    padding: "5px 9px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: "800",
  },

  productCode: {
    margin: "8px 0",
    color: "#64748b",
    fontSize: "13px",
  },

  tags: {
    display: "flex",
    flexWrap: "wrap",
    gap: "7px",
    marginBottom: "15px",
  },

  tag: {
    padding: "5px 8px",
    borderRadius: "8px",
    background: "#e2e8f0",
    color: "#334155",
    fontSize: "12px",
    fontWeight: "700",
  },

  valuesGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(110px, 1fr))",
    gap: "12px",
  },

  smallLabel: {
    display: "block",
    marginBottom: "5px",
    color: "#64748b",
    fontSize: "11px",
  },

  quantityValue: {
    color: "#0f172a",
    fontSize: "22px",
  },

  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
  },

  entryButton: {
    border: 0,
    borderRadius: "8px",
    padding: "10px 12px",
    background: "#16a34a",
    color: "#ffffff",
    fontWeight: "700",
    cursor: "pointer",
  },

  exitButton: {
    border: 0,
    borderRadius: "8px",
    padding: "10px 12px",
    background: "#dc2626",
    color: "#ffffff",
    fontWeight: "700",
  },
};