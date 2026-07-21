import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { auth, db } from "../firebase/config";

const emptyForm = {
  code: "",
  name: "",
  category: "feminino",
  size: "",
  color: "",
  costPrice: "",
  salePrice: "",
  quantity: "",
};

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let unsubscribeProducts = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (unsubscribeProducts) {
        unsubscribeProducts();
        unsubscribeProducts = null;
      }

      if (!user) {
        setProducts([]);
        setLoadingProducts(false);
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
          const productsList = snapshot.docs.map((document) => ({
            id: document.id,
            ...document.data(),
          }));

          productsList.sort((firstProduct, secondProduct) =>
            String(firstProduct.name || "").localeCompare(
              String(secondProduct.name || ""),
              "pt-BR"
            )
          );

          setProducts(productsList);
          setLoadingProducts(false);
        },
        (error) => {
          console.error("Erro ao carregar produtos:", error);
          alert(`Erro ao carregar produtos: ${error.message}`);
          setLoadingProducts(false);
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

  const totalPieces = useMemo(() => {
    return products.reduce(
      (total, product) => total + Number(product.quantity || 0),
      0
    );
  }, [products]);

  const totalCostValue = useMemo(() => {
    return products.reduce((total, product) => {
      return (
        total +
        Number(product.costPrice || 0) *
          Number(product.quantity || 0)
      );
    }, 0);
  }, [products]);

  const totalSaleValue = useMemo(() => {
    return products.reduce((total, product) => {
      return (
        total +
        Number(product.salePrice || 0) *
          Number(product.quantity || 0)
      );
    }, 0);
  }, [products]);

  const lowStockCount = useMemo(() => {
    return products.filter(
      (product) => Number(product.quantity || 0) <= 3
    ).length;
  }, [products]);

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function clearForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const user = auth.currentUser;

    if (!user) {
      alert("Você precisa entrar novamente no sistema.");
      return;
    }

    if (!form.code.trim()) {
      alert("Digite o código do produto.");
      return;
    }

    if (!form.name.trim()) {
      alert("Digite o nome ou descrição do produto.");
      return;
    }

    const quantity = Number(form.quantity || 0);
    const costPrice = Number(form.costPrice || 0);
    const salePrice = Number(form.salePrice || 0);

    if (quantity < 0) {
      alert("A quantidade não pode ser negativa.");
      return;
    }

    if (costPrice < 0 || salePrice < 0) {
      alert("Os preços não podem ser negativos.");
      return;
    }

    if (salePrice < costPrice) {
      const confirmed = window.confirm(
        "O preço de venda está menor que o preço de custo. Deseja continuar?"
      );

      if (!confirmed) {
        return;
      }
    }

    const duplicatedCode = products.some(
      (product) =>
        String(product.code || "").trim().toLowerCase() ===
          form.code.trim().toLowerCase() &&
        product.id !== editingId
    );

    if (duplicatedCode) {
      alert("Já existe um produto cadastrado com esse código.");
      return;
    }

    try {
      setSaving(true);

      const productData = {
        code: form.code.trim(),
        name: form.name.trim(),
        category: form.category,
        size: form.size.trim(),
        color: form.color.trim(),
        costPrice,
        salePrice,
        quantity,
        updatedAt: serverTimestamp(),
      };

      if (editingId) {
        const productReference = doc(
          db,
          "users",
          user.uid,
          "products",
          editingId
        );

        await updateDoc(productReference, productData);

        alert("Produto atualizado com sucesso!");
      } else {
        const productsReference = collection(
          db,
          "users",
          user.uid,
          "products"
        );

        await addDoc(productsReference, {
          ...productData,
          createdAt: serverTimestamp(),
        });

        alert("Produto cadastrado e salvo na nuvem!");
      }

      clearForm();
    } catch (error) {
      console.error("Erro ao salvar produto:", error);
      alert(`Erro ao salvar produto: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(product) {
    setEditingId(product.id);

    setForm({
      code: product.code || "",
      name: product.name || "",
      category: product.category || "feminino",
      size: product.size || "",
      color: product.color || "",
      costPrice: String(product.costPrice ?? ""),
      salePrice: String(product.salePrice ?? ""),
      quantity: String(product.quantity ?? ""),
    });

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function handleDelete(product) {
    const user = auth.currentUser;

    if (!user) {
      alert("Você precisa entrar novamente no sistema.");
      return;
    }

    const confirmed = window.confirm(
      `Deseja realmente excluir o produto ${product.name}?`
    );

    if (!confirmed) {
      return;
    }

    try {
      const productReference = doc(
        db,
        "users",
        user.uid,
        "products",
        product.id
      );

      await deleteDoc(productReference);

      if (editingId === product.id) {
        clearForm();
      }

      alert("Produto excluído com sucesso!");
    } catch (error) {
      console.error("Erro ao excluir produto:", error);
      alert(`Erro ao excluir produto: ${error.message}`);
    }
  }

  function formatCurrency(value) {
    return Number(value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }

  function formatCategory(category) {
    const categories = {
      masculino: "Masculino",
      feminino: "Feminino",
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

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>RC Confecções</p>

          <h1 style={styles.title}>Produtos</h1>

          <p style={styles.subtitle}>
            Cadastre e acompanhe todas as peças do estoque.
          </p>
        </div>

        <div style={styles.headerCards}>
          <div style={styles.counter}>
            <span style={styles.counterLabel}>
              Produtos cadastrados
            </span>

            <strong style={styles.counterValue}>
              {products.length}
            </strong>
          </div>

          <div style={styles.counter}>
            <span style={styles.counterLabel}>
              Peças em estoque
            </span>

            <strong style={styles.counterValue}>
              {totalPieces}
            </strong>
          </div>

          <div style={styles.counter}>
            <span style={styles.counterLabel}>
              Estoque baixo
            </span>

            <strong style={styles.warningValue}>
              {lowStockCount}
            </strong>
          </div>
        </div>
      </header>

      <section style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>
            Valor investido no estoque
          </span>

          <strong style={styles.summaryValue}>
            {formatCurrency(totalCostValue)}
          </strong>
        </div>

        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>
            Valor de venda do estoque
          </span>

          <strong style={styles.saleSummaryValue}>
            {formatCurrency(totalSaleValue)}
          </strong>
        </div>

        <div style={styles.summaryCard}>
          <span style={styles.summaryLabel}>
            Lucro bruto estimado
          </span>

          <strong style={styles.profitValue}>
            {formatCurrency(totalSaleValue - totalCostValue)}
          </strong>
        </div>
      </section>

      <section style={styles.grid}>
        <form onSubmit={handleSubmit} style={styles.card}>
          <div style={styles.formHeader}>
            <h2 style={styles.cardTitle}>
              {editingId ? "Editar produto" : "Novo produto"}
            </h2>

            {editingId && (
              <button
                type="button"
                onClick={clearForm}
                style={styles.cancelButton}
              >
                Cancelar
              </button>
            )}
          </div>

          <label style={styles.label}>
            Código
            <input
              type="text"
              name="code"
              value={form.code}
              onChange={handleChange}
              placeholder="Exemplo: CAM-001"
              required
              disabled={saving}
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Nome ou descrição
            <input
              type="text"
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="Exemplo: Camisa social"
              required
              disabled={saving}
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Categoria
            <select
              name="category"
              value={form.category}
              onChange={handleChange}
              disabled={saving}
              style={styles.input}
            >
              <option value="feminino">Feminino</option>
              <option value="masculino">Masculino</option>
              <option value="infantil">Infantil</option>
            </select>
          </label>

          <div style={styles.twoColumns}>
            <label style={styles.label}>
              Tamanho
              <input
                type="text"
                name="size"
                value={form.size}
                onChange={handleChange}
                placeholder="P, M, G, 42..."
                disabled={saving}
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Cor
              <input
                type="text"
                name="color"
                value={form.color}
                onChange={handleChange}
                placeholder="Preto, azul..."
                disabled={saving}
                style={styles.input}
              />
            </label>
          </div>

          <div style={styles.twoColumns}>
            <label style={styles.label}>
              Preço de custo
              <input
                type="number"
                name="costPrice"
                value={form.costPrice}
                onChange={handleChange}
                placeholder="0,00"
                min="0"
                step="0.01"
                disabled={saving}
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Preço de venda
              <input
                type="number"
                name="salePrice"
                value={form.salePrice}
                onChange={handleChange}
                placeholder="0,00"
                min="0"
                step="0.01"
                required
                disabled={saving}
                style={styles.input}
              />
            </label>
          </div>

          <label style={styles.label}>
            Quantidade em estoque
            <input
              type="number"
              name="quantity"
              value={form.quantity}
              onChange={handleChange}
              placeholder="0"
              min="0"
              step="1"
              required
              disabled={saving}
              style={styles.input}
            />
          </label>

          <button
            type="submit"
            disabled={saving}
            style={{
              ...styles.button,
              opacity: saving ? 0.65 : 1,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving
              ? "Salvando..."
              : editingId
                ? "Salvar alterações"
                : "Cadastrar produto"}
          </button>
        </form>

        <section style={styles.card}>
          <h2 style={styles.cardTitle}>
            Produtos cadastrados
          </h2>

          <p style={styles.helperText}>
            {filteredProducts.length} produto(s) encontrado(s).
          </p>

          <input
            type="search"
            value={searchText}
            onChange={(event) =>
              setSearchText(event.target.value)
            }
            placeholder="Pesquisar código, nome, categoria, tamanho ou cor"
            style={styles.searchInput}
          />

          {loadingProducts ? (
            <div style={styles.empty}>
              <span style={styles.emptyIcon}>⏳</span>
              <strong>Carregando produtos...</strong>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div style={styles.empty}>
              <span style={styles.emptyIcon}>📦</span>
              <strong>Nenhum produto encontrado</strong>

              <p>
                Cadastre um produto ou altere sua pesquisa.
              </p>
            </div>
          ) : (
            <div style={styles.list}>
              {filteredProducts.map((product) => {
                const stockStatus = getStockStatus(
                  product.quantity
                );

                return (
                  <article
                    key={product.id}
                    style={styles.productItem}
                  >
                    <div style={styles.productContent}>
                      <div style={styles.productTitleArea}>
                        <h3 style={styles.productName}>
                          {product.name}
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
                        Código: {product.code}
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

                      <div style={styles.priceGrid}>
                        <div>
                          <span style={styles.smallLabel}>
                            Custo
                          </span>

                          <strong style={styles.costValue}>
                            {formatCurrency(product.costPrice)}
                          </strong>
                        </div>

                        <div>
                          <span style={styles.smallLabel}>
                            Venda
                          </span>

                          <strong style={styles.saleValue}>
                            {formatCurrency(product.salePrice)}
                          </strong>
                        </div>

                        <div>
                          <span style={styles.smallLabel}>
                            Estoque
                          </span>

                          <strong style={styles.quantityValue}>
                            {Number(product.quantity || 0)}
                          </strong>
                        </div>
                      </div>
                    </div>

                    <div style={styles.actions}>
                      <button
                        type="button"
                        onClick={() => handleEdit(product)}
                        style={styles.editButton}
                      >
                        Editar
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(product)}
                        style={styles.deleteButton}
                      >
                        Excluir
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
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
    gap: "20px",
    marginBottom: "20px",
  },

  headerCards: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
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

  counter: {
    minWidth: "135px",
    padding: "15px",
    borderRadius: "16px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    textAlign: "center",
  },

  counterLabel: {
    display: "block",
    marginBottom: "6px",
    color: "#64748b",
    fontSize: "12px",
  },

  counterValue: {
    fontSize: "26px",
  },

  warningValue: {
    color: "#ca8a04",
    fontSize: "26px",
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(190px, 1fr))",
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

  saleSummaryValue: {
    color: "#2563eb",
    fontSize: "20px",
  },

  profitValue: {
    color: "#16a34a",
    fontSize: "20px",
  },

  grid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(320px, 1fr))",
    alignItems: "start",
    gap: "22px",
  },

  card: {
    padding: "24px",
    borderRadius: "18px",
    background: "#ffffff",
    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
  },

  formHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
  },

  cardTitle: {
    margin: "0 0 18px",
    fontSize: "21px",
  },

  cancelButton: {
    border: 0,
    background: "transparent",
    color: "#64748b",
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

  twoColumns: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(130px, 1fr))",
    gap: "12px",
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

  button: {
    width: "100%",
    border: 0,
    borderRadius: "11px",
    padding: "14px",
    background: "#2563eb",
    color: "#ffffff",
    fontSize: "16px",
    fontWeight: "800",
  },

  helperText: {
    margin: "-10px 0 18px",
    color: "#64748b",
    fontSize: "14px",
  },

  searchInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "13px 14px",
    marginBottom: "18px",
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
    flex: "1 1 280px",
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
    display: "inline-block",
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

  priceGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(85px, 1fr))",
    gap: "12px",
  },

  smallLabel: {
    display: "block",
    marginBottom: "4px",
    color: "#64748b",
    fontSize: "11px",
  },

  costValue: {
    color: "#475569",
    fontSize: "15px",
  },

  saleValue: {
    color: "#16a34a",
    fontSize: "16px",
  },

  quantityValue: {
    color: "#2563eb",
    fontSize: "18px",
  },

  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
  },

  editButton: {
    border: 0,
    borderRadius: "8px",
    padding: "9px 12px",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: "700",
    cursor: "pointer",
  },

  deleteButton: {
    border: 0,
    borderRadius: "8px",
    padding: "9px 12px",
    background: "#dc2626",
    color: "#ffffff",
    fontWeight: "700",
    cursor: "pointer",
  },
};