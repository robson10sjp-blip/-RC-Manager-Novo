import { useEffect, useMemo, useState } from "react";
import PageHeader from "../components/PageHeader.jsx";
import FinancialValue from "../components/FinancialValue.jsx";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";

import { useLocation } from "react-router-dom";
import {
  LuBoxes,
  LuChartNoAxesCombined,
  LuCircleDollarSign,
  LuHistory,
  LuPackageCheck,
  LuPackageMinus,
  LuPackageSearch,
  LuPlane,
  LuTriangleAlert,
} from "react-icons/lu";

import { auth, db } from "../firebase/config";
import { runTransaction, updateDoc } from "../firebase/firestoreAccess";
import { isFirestoreReadOnly } from "../firebase/writePolicy";
import {
  buildStockActivity,
  getStockThresholds,
  getSuggestedRestock,
  isLowAlertStock,
  isOutOfStock,
  summarizeStockSales,
} from "../domain/stock";
import { toDate } from "../utils/dates";
import "./StockPremium.css";

export default function StockPage() {
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [movements, setMovements] = useState([]);
  const location = useLocation();
  const [searchText, setSearchText] = useState(
    () => String(location.state?.search || "")
  );
  const [loading, setLoading] = useState(true);
  const [adjustingId, setAdjustingId] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [sizeFilter, setSizeFilter] = useState("all");
  const [planningTrip, setPlanningTrip] = useState("");
  const [planningProductId, setPlanningProductId] = useState("");
  const [planningQuantity, setPlanningQuantity] = useState("1");
  const [tripPlan, setTripPlan] = useState([]);
  const [activeSection, setActiveSection] = useState("reposição");
  const readOnly = isFirestoreReadOnly();

  useEffect(() => {
    let unsubscribeCollections = [];

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeCollections.forEach((unsubscribe) => unsubscribe());
      unsubscribeCollections = [];

      if (!user) {
        setProducts([]);
        setSales([]);
        setMovements([]);
        setLoading(false);
        return;
      }

      const sources = [
        ["products", setProducts, "estoque"],
        ["sales", setSales, "vendas"],
        ["stockMovements", setMovements, "movimentações do estoque"],
      ];
      unsubscribeCollections = sources.map(([collectionName, setter, label]) =>
        onSnapshot(
          collection(db, "users", user.uid, collectionName),
          (snapshot) => {
            setter(
              snapshot.docs.map((document) => ({
                id: document.id,
                ...document.data(),
              }))
            );
            if (collectionName === "products") setLoading(false);
          },
          (error) => {
            console.error(`Erro ao carregar ${label}:`, error);
            alert(`Erro ao carregar ${label}: ${error.message}`);
            if (collectionName === "products") setLoading(false);
          }
        )
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeCollections.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  const categories = useMemo(
    () =>
      [...new Set(products.map((product) => String(product.category || "").trim()).filter(Boolean))]
        .sort((first, second) => first.localeCompare(second, "pt-BR")),
    [products]
  );

  const sizes = useMemo(
    () =>
      [...new Set(products.map((product) => String(product.size || "").trim()).filter(Boolean))]
        .sort((first, second) => first.localeCompare(second, "pt-BR")),
    [products]
  );

  const filteredProducts = useMemo(() => {
    const search = searchText.trim().toLowerCase();

    return products.filter((product) => {
      const quantity = Number(product.quantity || 0);
      if (categoryFilter !== "all" && product.category !== categoryFilter) return false;
      if (sizeFilter !== "all" && String(product.size || "") !== sizeFilter) return false;
      if (stockFilter === "out" && !isOutOfStock(quantity)) return false;
      if (stockFilter === "low" && !isLowAlertStock(quantity)) return false;
      const code = String(product.code || "").toLowerCase();
      const name = String(product.name || "").toLowerCase();
      const category = String(product.category || "").toLowerCase();
      const size = String(product.size || "").toLowerCase();
      const color = String(product.color || "").toLowerCase();

      if (!search) return true;
      return (
        code.includes(search) ||
        name.includes(search) ||
        category.includes(search) ||
        size.includes(search) ||
        color.includes(search)
      );
    });
  }, [products, searchText, categoryFilter, stockFilter, sizeFilter]);

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

        if (isLowAlertStock(quantity)) {
          result.lowStock += 1;
        }

        if (isOutOfStock(quantity)) {
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

  const salesReport = useMemo(
    () => summarizeStockSales(products, sales),
    [products, sales]
  );

  const stockActivity = useMemo(
    () => buildStockActivity(sales, movements),
    [sales, movements]
  );

  const restockProducts = useMemo(
    () =>
      products
        .map((product) => ({
          ...product,
          suggestedQuantity: getSuggestedRestock(product),
        }))
        .filter((product) => product.suggestedQuantity > 0)
        .sort((first, second) => second.suggestedQuantity - first.suggestedQuantity),
    [products]
  );

  const plannedItems = useMemo(
    () =>
      tripPlan.map((item) => ({
        ...item,
        product: products.find((product) => product.id === item.productId),
      })),
    [tripPlan, products]
  );

  const stockHealth = useMemo(() => {
    return {
      available: Math.max(
        0,
        summary.totalProducts - summary.lowStock - summary.outOfStock
      ),
      low: summary.lowStock,
      out: summary.outOfStock,
    };
  }, [summary]);

  const healthTotal = Math.max(
    1,
    stockHealth.available + stockHealth.low + stockHealth.out
  );

  const sections = [
    { id: "reposição", label: "Reposição", icon: LuPackageSearch, count: restockProducts.length },
    { id: "histórico", label: "Movimentações", icon: LuHistory, count: stockActivity.length },
    { id: "análise", label: "Análise de vendas", icon: LuChartNoAxesCombined },
    { id: "viagens", label: "Planejamento", icon: LuPlane, count: tripPlan.length },
  ];

  function addPlannedItem() {
    const product = products.find((item) => item.id === planningProductId);
    const quantity = Number(planningQuantity);
    if (!planningTrip.trim() || !product || !Number.isInteger(quantity) || quantity <= 0) {
      alert("Informe a viagem, selecione um produto e uma quantidade inteira maior que zero.");
      return;
    }
    setTripPlan((current) => {
      const existing = current.find(
        (item) => item.productId === product.id && item.trip === planningTrip.trim()
      );
      if (existing) {
        return current.map((item) =>
          item === existing ? { ...item, quantity: item.quantity + quantity } : item
        );
      }
      return [...current, { productId: product.id, quantity, trip: planningTrip.trim() }];
    });
    setPlanningQuantity("1");
  }

  async function handleConfirmPlannedItem(item) {
    if (readOnly) return;
    const user = auth.currentUser;
    if (!user) {
      alert("Você precisa entrar novamente no sistema.");
      return;
    }
    const product = products.find((current) => current.id === item.productId);
    if (!product) {
      alert("O produto planejado não foi encontrado.");
      return;
    }
    if (!window.confirm(
      `Confirmar a baixa de ${item.quantity} unidade(s) de "${product.name}" para ${item.trip}?`
    )) return;

    const productReference = doc(db, "users", user.uid, "products", product.id);
    const movementReference = doc(collection(db, "users", user.uid, "stockMovements"));
    try {
      setAdjustingId(product.id);
      await runTransaction(db, async (transaction) => {
        const productSnapshot = await transaction.get(productReference);
        if (!productSnapshot.exists()) throw new Error("Produto não encontrado.");
        const savedProduct = productSnapshot.data();
        const currentQuantity = Number(savedProduct.quantity || 0);
        if (item.quantity > currentQuantity) {
          throw new Error(`Estoque insuficiente. Disponível: ${currentQuantity}.`);
        }
        const newQuantity = currentQuantity - item.quantity;
        transaction.update(productReference, {
          quantity: newQuantity,
          updatedAt: serverTimestamp(),
        });
        transaction.set(movementReference, {
          productId: product.id,
          productName: savedProduct.name || "",
          productCode: savedProduct.code || "",
          type: "saida",
          quantity: item.quantity,
          previousQuantity: currentQuantity,
          newQuantity,
          reason: `Separação confirmada para ${item.trip}`,
          createdAt: serverTimestamp(),
        });
      });
      setTripPlan((current) =>
        current.filter(
          (planned) =>
            !(planned.trip === item.trip && planned.productId === item.productId)
        )
      );
      alert("Baixa confirmada e registrada no histórico.");
    } catch (error) {
      console.error("Erro ao confirmar item planejado:", error);
      alert(`Erro ao confirmar a baixa: ${error.message}`);
    } finally {
      setAdjustingId(null);
    }
  }

  async function handleConfigureRestock(product) {
    if (readOnly) return;
    const user = auth.currentUser;
    if (!user) {
      alert("Você precisa entrar novamente no sistema.");
      return;
    }
    const { minimum, target } = getStockThresholds(product);
    const minimumInput = window.prompt(
      `Limite para considerar estoque baixo de "${product.name}":`,
      String(minimum)
    );
    if (minimumInput === null) return;
    const targetInput = window.prompt(
      `Quantidade desejada após reposição de "${product.name}":`,
      String(target)
    );
    if (targetInput === null) return;
    const nextMinimum = Number(minimumInput);
    const nextTarget = Number(targetInput);
    if (
      !Number.isInteger(nextMinimum) ||
      !Number.isInteger(nextTarget) ||
      nextMinimum < 0 ||
      nextTarget < nextMinimum
    ) {
      alert("Informe limites inteiros válidos; a quantidade desejada deve ser igual ou maior que o mínimo.");
      return;
    }
    try {
      await updateDoc(
        doc(db, "users", user.uid, "products", product.id),
        { minimumStock: nextMinimum, targetStock: nextTarget, updatedAt: serverTimestamp() }
      );
    } catch (error) {
      console.error("Erro ao configurar reposição:", error);
      alert(`Erro ao configurar reposição: ${error.message}`);
    }
  }

  function formatDate(value) {
    const date = toDate(value);
    return date
      ? date.toLocaleDateString("pt-BR")
      : "Data não informada";
  }

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
      outros: "Outros",
    };

    return categories[category] || category || "Não informada";
  }

  function getStockStatus(quantityValue) {
    const quantity = Number(
      typeof quantityValue === "object"
        ? quantityValue.quantity || 0
        : quantityValue || 0
    );
    if (isOutOfStock(quantity)) {
      return {
        label: "Sem estoque",
        color: "#dc2626",
        background: "#fee2e2",
      };
    }

    if (isLowAlertStock(quantity)) {
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
    if (readOnly) return;
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
    <div className="st-page" style={styles.page}>
      <PageHeader
        icon={LuBoxes}
        title="Estoque"
        description="Acompanhe disponibilidade, vendas reais e necessidade de reposição."
      />

      <section className="st-summary-grid">
        {[
          { label: "Produtos cadastrados", value: summary.totalProducts, icon: LuBoxes, tone: "navy" },
          { label: "Peças em estoque", value: summary.totalPieces, icon: LuPackageCheck, tone: "navy" },
          { label: "Valor investido", value: <FinancialValue>{formatCurrency(summary.totalCost)}</FinancialValue>, icon: LuCircleDollarSign, tone: "gold" },
          { label: "Valor potencial de venda", value: <FinancialValue>{formatCurrency(summary.totalSale)}</FinancialValue>, icon: LuPackageMinus, tone: "gold" },
          { label: "Lucro potencial", value: <FinancialValue>{formatCurrency(summary.totalSale - summary.totalCost)}</FinancialValue>, icon: LuChartNoAxesCombined, tone: "green" },
          { label: "Estoque baixo", value: summary.lowStock, icon: LuTriangleAlert, tone: "warning", detail: "De 1 a 3 peças", filter: "low" },
          { label: "Sem estoque", value: summary.outOfStock, icon: LuPackageMinus, tone: "danger", detail: "Quantidade igual a zero", filter: "out" },
        ].map(({ label, value, icon: Icon, tone, detail, filter }) => {
          const active = Boolean(filter && stockFilter === filter);
          const content = (
            <>
              <span className="st-kpi-icon"><Icon aria-hidden="true" /></span>
              <span className="st-kpi-label">{label}</span>
              <strong>{value}</strong>
              {detail && <small>{detail}</small>}
              {label === "Lucro potencial" && <small>Não representa lucro realizado nem dinheiro em caixa.</small>}
            </>
          );

          return filter ? (
            <button
              type="button"
              className={`st-kpi st-kpi-${tone} st-kpi-button${active ? " is-active" : ""}`}
              key={label}
              aria-pressed={active}
              onClick={() => setStockFilter(active ? "all" : filter)}
            >
              {content}
            </button>
          ) : (
            <article className={`st-kpi st-kpi-${tone}`} key={label}>
              {content}
            </article>
          );
        })}
      </section>

      <section className="st-health" aria-label="Saúde do estoque">
        <div className="st-health-head">
          <div>
            <span className="st-section-eyebrow">Visão geral</span>
            <h2>Saúde do estoque</h2>
          </div>
          <span>{summary.totalProducts} produtos monitorados</span>
        </div>
        <div className="st-health-bar" role="img" aria-label={`${stockHealth.available} disponíveis, ${stockHealth.low} com estoque baixo e ${stockHealth.out} sem estoque`}>
          <span className="st-health-fill st-health-available" style={{ width: `${stockHealth.available / healthTotal * 100}%` }} />
          <span className="st-health-fill st-health-low" style={{ width: `${stockHealth.low / healthTotal * 100}%` }} />
          <span className="st-health-fill st-health-out" style={{ width: `${stockHealth.out / healthTotal * 100}%` }} />
        </div>
        <div className="st-health-legend">
          <div><i className="st-health-dot st-health-available" /><span>Disponíveis</span><strong>{stockHealth.available}</strong></div>
          <div><i className="st-health-dot st-health-low" /><span>Estoque baixo</span><strong>{stockHealth.low}</strong></div>
          <div><i className="st-health-dot st-health-out" /><span>Sem estoque</span><strong>{stockHealth.out}</strong></div>
        </div>
      </section>

      <section className="st-products-section">
        <div className="st-toolbar" style={styles.toolbar}>
          <div>
            <span className="st-section-eyebrow">Catálogo</span>
            <h2 style={styles.cardTitle}>Produtos em estoque</h2>
            <p style={styles.helperText}>
              {filteredProducts.length} produto(s) encontrado(s).
              {stockFilter === "low" && " · Estoque baixo: de 1 a 3 peças"}
              {stockFilter === "out" && " · Sem estoque: quantidade zero"}
            </p>
          </div>

          <div className="st-filters">
            <label className="st-search">
              <LuPackageSearch aria-hidden="true" />
              <input
                type="search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Pesquisar produto ou código"
                aria-label="Pesquisar produto ou código"
              />
            </label>
            <label className="st-filter-select">
              <span>Categoria</span>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filtrar por categoria">
                <option value="all">Todas</option>
                {categories.map((category) => <option key={category} value={category}>{formatCategory(category)}</option>)}
              </select>
            </label>
            <label className="st-filter-select">
              <span>Tamanho</span>
              <select value={sizeFilter} onChange={(event) => setSizeFilter(event.target.value)} aria-label="Filtrar por tamanho">
                <option value="all">Todos</option>
                {sizes.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <label className="st-filter-select">
              <span>Situação</span>
              <select value={stockFilter} onChange={(event) => setStockFilter(event.target.value)} aria-label="Filtrar por estoque">
                <option value="all">Todas</option>
                <option value="out">Sem estoque</option>
                <option value="low">Estoque baixo (1 a 3)</option>
              </select>
            </label>
            {stockFilter !== "all" && (
              <button
                type="button"
                className="st-filter-clear"
                onClick={() => setStockFilter("all")}
              >
                Mostrar todos
              </button>
            )}
          </div>
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
              const stockStatus = getStockStatus(product);
              const quantity = Number(product.quantity || 0);

              return (
                <article key={product.id} className={`st-product-card st-product-${stockStatus.label === "Em estoque" ? "available" : stockStatus.label === "Estoque baixo" ? "low" : "out"}`}>
                  <div className="st-product-content">
                    <div style={styles.productTitleArea}>
                      <div className="st-product-heading">
                        <h3 style={styles.productName}>{product.name || "Produto sem nome"}</h3>
                        <p style={styles.productCode}>Código {product.code || "Não informado"}</p>
                      </div>

                      <span className={`st-status st-status-${stockStatus.label === "Em estoque" ? "available" : stockStatus.label === "Estoque baixo" ? "low" : "out"}`}>
                        {stockStatus.label}
                      </span>
                    </div>

                    <div className="st-tags">
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

                    <div className="st-values-grid">
                      <div>
                        <span style={styles.smallLabel}>Disponível</span>
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
                        <strong className="st-sale-value">
                          {formatCurrency(product.salePrice)}
                        </strong>
                      </div>

                      <div>
                        <span style={styles.smallLabel}>Total em venda</span>
                        <strong>
                          <FinancialValue>{formatCurrency(
                            quantity * Number(product.salePrice || 0)
                          )}</FinancialValue>
                        </strong>
                      </div>
                      <div>
                        <span style={styles.smallLabel}>Reposição (mín./alvo)</span>
                        <strong>
                          {getStockThresholds(product).minimum} / {getStockThresholds(product).target}
                        </strong>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="st-link-button"
                      onClick={() => handleConfigureRestock(product)}
                      disabled={readOnly}
                    >
                      Configurar limite e alvo de reposição
                    </button>
                  </div>

                  <div className="st-product-actions">
                    <button
                      type="button"
                      onClick={() =>
                        handleStockAdjustment(product, "entrada")
                      }
                      disabled={readOnly || adjustingId === product.id}
                      className="st-entry-button"
                    >
                      ➕ Entrada
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        handleStockAdjustment(product, "saida")
                      }
                      disabled={
                        readOnly || adjustingId === product.id || quantity <= 0
                      }
                      className="st-exit-button"
                      style={{
                        opacity:
                          readOnly || adjustingId === product.id || quantity <= 0
                            ? 0.5
                            : 1,
                        cursor:
                          readOnly || adjustingId === product.id || quantity <= 0
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

      <section className="st-tools">
        <div className="st-tools-heading">
          <div><span className="st-section-eyebrow">Gestão</span><h2>Ferramentas de estoque</h2></div>
          <p>Reposição, movimentações e planejamento operacional.</p>
        </div>
        <div className="st-tabs" role="tablist" aria-label="Ferramentas de estoque">
          {sections.map(({ id, label, icon: Icon, count }) => (
            <button
              type="button"
              role="tab"
              id={`stock-tab-${id}`}
              aria-selected={activeSection === id}
              aria-controls={`stock-panel-${id}`}
              className={activeSection === id ? "st-tab st-tab-active" : "st-tab"}
              key={id}
              onClick={() => setActiveSection(id)}
            >
              <Icon aria-hidden="true" /><span>{label}</span>
              {Number.isFinite(count) && <small>{count}</small>}
            </button>
          ))}
        </div>
      </section>

      <section className="st-panels">
        {activeSection === "reposição" && <article className="st-panel" role="tabpanel" id="stock-panel-reposição" aria-labelledby="stock-tab-reposição">
          <h2>Lista de reposição</h2>
          <p className="st-muted">Sugestões calculadas pelos limites configurados em cada produto. O custo é estimado pelo custo unitário cadastrado.</p>
          {restockProducts.length ? (
            <div className="st-table-wrap">
              <table className="st-table">
                <thead><tr><th>Produto</th><th>Disponível</th><th>Sugerido</th><th>Custo estimado</th></tr></thead>
                <tbody>
                  {restockProducts.map((product) => (
                    <tr key={product.id}>
                      <td>{product.name || "Produto sem nome"}<small>{product.code || "Sem código"}</small></td>
                      <td>{Number(product.quantity || 0)}</td>
                      <td>{product.suggestedQuantity}</td>
                      <td>{formatCurrency(product.suggestedQuantity * Number(product.costPrice || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="st-muted">Nenhum produto está abaixo do limite mínimo configurado.</p>}
        </article>}

        {activeSection === "viagens" && <article className="st-panel" role="tabpanel" id="stock-panel-viagens" aria-labelledby="stock-tab-viagens">
          <h2>Planejamento de mercadorias para viagem</h2>
          <p className="st-muted">Rascunho temporário desta sessão. Planejar não altera o estoque; confirme entradas ou baixas separadamente pelos controles de movimentação.</p>
          <div className="st-plan-form">
            <label>Viagem<input value={planningTrip} onChange={(event) => setPlanningTrip(event.target.value)} placeholder="Ex.: 4ª viagem" /></label>
            <label>Produto<select value={planningProductId} onChange={(event) => setPlanningProductId(event.target.value)}><option value="">Selecione</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.code || "sem código"}</option>)}</select></label>
            <label>Quantidade<input type="number" min="1" step="1" value={planningQuantity} onChange={(event) => setPlanningQuantity(event.target.value)} /></label>
            <button type="button" className="st-action-button" onClick={addPlannedItem}>Adicionar à lista</button>
          </div>
          {plannedItems.length ? (
            <div className="st-table-wrap">
              <table className="st-table">
                <thead><tr><th>Viagem</th><th>Produto</th><th>Quantidade planejada</th><th></th></tr></thead>
                <tbody>
                  {plannedItems.map((item) => (
                    <tr key={`${item.trip}-${item.productId}`}>
                      <td>{item.trip}</td><td>{item.product?.name || "Produto removido"}</td><td>{item.quantity}</td>
                      <td className="st-plan-actions">
                        <button type="button" className="st-link-button" disabled={readOnly || adjustingId === item.productId || !item.product} onClick={() => handleConfirmPlannedItem(item)}>Confirmar baixa</button>
                        <button type="button" className="st-link-button" onClick={() => setTripPlan((current) => current.filter((planned) => !(planned.trip === item.trip && planned.productId === item.productId)))}>Remover</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="st-muted">Nenhum item planejado nesta sessão.</p>}
        </article>}

        {activeSection === "análise" && <article className="st-panel" role="tabpanel" id="stock-panel-análise" aria-labelledby="stock-tab-análise">
          <h2>Desempenho de vendas</h2>
          <p className="st-muted">Agregado exclusivamente de itens em vendas reais registradas. Não inclui estimativas de demanda.</p>
          <div className="st-report-grid">
            <div><h3>Mais vendidos</h3>{salesReport.mostSold.length ? salesReport.mostSold.map((item) => <p key={item.productId}>{item.name}<strong>{item.quantitySold} un.</strong></p>) : <p className="st-muted">Sem vendas registradas.</p>}</div>
            <div><h3>Menos vendidos</h3>{salesReport.leastSold.length ? salesReport.leastSold.map((item) => <p key={item.productId}>{item.name}<strong>{item.quantitySold} un.</strong></p>) : <p className="st-muted">Sem vendas registradas.</p>}</div>
            <div><h3>Tamanhos mais procurados</h3>{salesReport.sizes.length ? salesReport.sizes.map((item) => <p key={item.size}>Tam. {item.size}<strong>{item.quantitySold} un.</strong></p>) : <p className="st-muted">Sem tamanhos em vendas registradas.</p>}</div>
          </div>
        </article>}

        {activeSection === "histórico" && <article className="st-panel" role="tabpanel" id="stock-panel-histórico" aria-labelledby="stock-tab-histórico">
          <h2>Histórico de estoque</h2>
          <p className="st-muted">Mostra movimentos que já estavam registrados e vendas reais existentes. Não são criados movimentos retroativos; vendas antigas sem registro de movimentação aparecem somente como venda.</p>
          {stockActivity.length ? (
            <div className="st-table-wrap">
              <table className="st-table">
                <thead><tr><th>Data</th><th>Movimentação</th><th>Produto</th><th>Quantidade</th><th>Detalhe</th><th>Origem</th></tr></thead>
                <tbody>
                  {stockActivity.map((activity) => (
                    <tr key={activity.id}>
                      <td>{formatDate(activity.createdAt)}</td>
                      <td>{activity.type}</td>
                      <td>{activity.productName || "Produto"}<small>{activity.productCode || ""}</small></td>
                      <td>{Number(activity.quantity || 0)}</td>
                      <td>{activity.reason || activity.reference || "—"}</td>
                      <td>{activity.source === "sale" ? "Venda real" : "Movimento registrado"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="st-muted">Ainda não há movimentações ou vendas registradas.</p>}
        </article>}
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