import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";

import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  LuBoxes,
  LuPackagePlus,
  LuPencil,
  LuPlus,
  LuSearch,
  LuShirt,
  LuTag,
  LuTrash2,
  LuTrendingUp,
  LuTriangleAlert,
  LuWallet,
  LuX,
} from "react-icons/lu";

import { auth, db } from "../firebase/config";
import {
  addDoc,
  deleteDoc,
  updateDoc,
} from "../firebase/firestoreAccess";
import "./ClientsPremium.css";
import "./ProductsPremium.css";

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
    outros: "Outros",
  };

  return categories[category] || category || "Não informada";
}

function getStockStatus(quantityValue) {
  const quantity = Number(quantityValue || 0);

  if (quantity <= 0) {
    return { key: "out", label: "Sem estoque" };
  }

  if (quantity <= 3) {
    return { key: "low", label: "Estoque baixo" };
  }

  return { key: "in", label: "Em estoque" };
}

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const navigate = useNavigate();
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

    return products.filter((product) => {
      const quantity = Number(product.quantity || 0);

      if (categoryFilter !== "all" && product.category !== categoryFilter) {
        return false;
      }

      if (stockFilter === "out" && quantity > 0) return false;
      if (stockFilter === "low" && !(quantity > 0 && quantity <= 3)) return false;
      if (stockFilter === "in" && quantity <= 3) return false;

      if (!search) return true;

      return [
        product.code,
        product.name,
        product.category,
        formatCategory(product.category),
        product.size,
        product.color,
      ].some((field) => String(field || "").toLowerCase().includes(search));
    });
  }, [products, searchText, categoryFilter, stockFilter]);

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
    setShowForm(false);
  }

  function openNewForm() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
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
    setShowForm(true);

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

  const categoryOptions = useMemo(() => {
    const base = ["feminino", "masculino", "infantil", "outros"];
    const extra = products
      .map((product) => String(product.category || "").trim())
      .filter((category) => category && !base.includes(category));

    return [...base, ...new Set(extra)];
  }, [products]);

  const potentialProfit = totalSaleValue - totalCostValue;

  const kpis = [
    { label: "Produtos cadastrados", value: products.length, icon: LuShirt, tone: "navy" },
    { label: "Peças em estoque", value: totalPieces, icon: LuBoxes, tone: "navy" },
    { label: "Estoque baixo", value: lowStockCount, icon: LuTriangleAlert, tone: "red", hint: "Até 3 peças, inclui itens zerados" },
    { label: "Valor investido", value: formatCurrency(totalCostValue), icon: LuWallet, tone: "gold" },
    { label: "Valor potencial de venda", value: formatCurrency(totalSaleValue), icon: LuTag, tone: "gold" },
    { label: "Lucro bruto potencial", value: formatCurrency(potentialProfit), icon: LuTrendingUp, tone: "green" },
  ];

  const hasFilters =
    searchText.trim() || categoryFilter !== "all" || stockFilter !== "all";

  function renderField(label, input) {
    return (
      <label className="pr-field">
        <span>{label}</span>
        {input}
      </label>
    );
  }

  return (
    <div className="cl pr">
      <header className="cl-header">
        <div>
          <p className="cl-eyebrow">RC Confecções</p>
          <h1>Produtos</h1>
          <p className="cl-subtitle">
            Controle de mercadorias: cadastre e acompanhe todas as peças.
          </p>
        </div>

        <button
          type="button"
          className="cl-btn cl-btn-primary cl-new"
          onClick={openNewForm}
        >
          <LuPlus aria-hidden="true" /> Novo produto
        </button>
      </header>

      <div className="pr-kpis">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;

          return (
            <article key={kpi.label} className={`cl-kpi cl-kpi-${kpi.tone} pr-kpi`}>
              <span className="cl-kpi-icon"><Icon aria-hidden="true" /></span>
              <span className="cl-kpi-label">{kpi.label}</span>
              <strong>{kpi.value}</strong>
              {kpi.hint && <small>{kpi.hint}</small>}
            </article>
          );
        })}
      </div>

      <section className="cl-panel">
        <div className="cl-search">
          <LuSearch aria-hidden="true" />
          <input
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Código, nome, tamanho ou cor"
            aria-label="Pesquisar produtos"
          />
        </div>

        <div className="cl-filters">
          <label>
            Categoria
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              <option value="all">Todas as categorias</option>
              {categoryOptions.map((category) => (
                <option key={category} value={category}>
                  {formatCategory(category)}
                </option>
              ))}
            </select>
          </label>

          <label>
            Situação do estoque
            <select
              value={stockFilter}
              onChange={(event) => setStockFilter(event.target.value)}
            >
              <option value="all">Todas</option>
              <option value="in">Em estoque</option>
              <option value="low">Estoque baixo</option>
              <option value="out">Sem estoque</option>
            </select>
          </label>

          {hasFilters && (
            <button
              type="button"
              className="cl-btn cl-btn-ghost"
              onClick={() => {
                setSearchText("");
                setCategoryFilter("all");
                setStockFilter("all");
              }}
            >
              Limpar filtros
            </button>
          )}
        </div>

        <p className="cl-count">
          {filteredProducts.length} de {products.length} produto(s)
        </p>

        {loadingProducts ? (
          <div className="cl-empty"><strong>Carregando produtos...</strong></div>
        ) : filteredProducts.length === 0 ? (
          <div className="cl-empty">
            <strong>Nenhum produto encontrado</strong>
            <span>Cadastre um produto ou altere a pesquisa e os filtros.</span>
          </div>
        ) : (
          <div className="pr-grid">
            {filteredProducts.map((product) => {
              const status = getStockStatus(product.quantity);

              return (
                <article key={product.id} className={`pr-card pr-${status.key}`}>
                  <div className="pr-card-head">
                    <div className="pr-title">
                      <h3 title={product.name}>{product.name}</h3>
                      <p>Código {product.code}</p>
                    </div>
                    <span className={`cl-status pr-badge-${status.key}`}>
                      {status.label}
                    </span>
                  </div>

                  <div className="pr-tags">
                    <span>{formatCategory(product.category)}</span>
                    <span>Tam. {product.size || "—"}</span>
                    <span>{product.color || "Sem cor"}</span>
                  </div>

                  <dl className="pr-numbers">
                    <div><dt>Custo</dt><dd>{formatCurrency(product.costPrice)}</dd></div>
                    <div><dt>Venda</dt><dd className="pr-sale">{formatCurrency(product.salePrice)}</dd></div>
                    <div><dt>Estoque</dt><dd className={`pr-qty pr-qty-${status.key}`}>{Number(product.quantity || 0)}</dd></div>
                  </dl>

                  <div className="pr-actions">
                    <button type="button" className="cl-btn cl-btn-soft" onClick={() => handleEdit(product)}>
                      <LuPencil aria-hidden="true" /> Editar
                    </button>
                    <button
                      type="button"
                      className="cl-btn cl-btn-gold"
                      onClick={() => navigate("/estoque", { state: { search: product.code || product.name || "" } })}
                    >
                      <LuPackagePlus aria-hidden="true" /> Entrada
                    </button>
                    <button type="button" className="cl-btn cl-btn-danger" onClick={() => handleDelete(product)}>
                      <LuTrash2 aria-hidden="true" /> Excluir
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {showForm && createPortal(
        <div
          className="app-main pr-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) clearForm();
          }}
        >
          <form
            onSubmit={handleSubmit}
            className="pr-modal"
            role="dialog"
            aria-modal="true"
            aria-label={editingId ? "Editar produto" : "Novo produto"}
          >
            <div className="pr-modal-head">
              <h2>{editingId ? "Editar produto" : "Novo produto"}</h2>
              <button
                type="button"
                className="cl-btn cl-btn-ghost"
                onClick={clearForm}
                disabled={saving}
                aria-label="Fechar"
              >
                <LuX aria-hidden="true" />
              </button>
            </div>

            <div className="pr-form-grid">
              {renderField("Código", (
                <input type="text" name="code" value={form.code} onChange={handleChange} placeholder="Exemplo: CAM-001" required disabled={saving} />
              ))}
              {renderField("Categoria", (
                <select name="category" value={form.category} onChange={handleChange} disabled={saving}>
                  {[...new Set([...categoryOptions, form.category])].map((category) => (
                    <option key={category} value={category}>{formatCategory(category)}</option>
                  ))}
                </select>
              ))}
              <div className="pr-span">
                {renderField("Nome ou descrição", (
                  <input type="text" name="name" value={form.name} onChange={handleChange} placeholder="Exemplo: Camisa social" required disabled={saving} />
                ))}
              </div>
              {renderField("Tamanho", (
                <input type="text" name="size" value={form.size} onChange={handleChange} placeholder="P, M, G, 42..." disabled={saving} />
              ))}
              {renderField("Cor", (
                <input type="text" name="color" value={form.color} onChange={handleChange} placeholder="Preto, azul..." disabled={saving} />
              ))}
              {renderField("Preço de custo", (
                <input type="number" inputMode="decimal" name="costPrice" value={form.costPrice} onChange={handleChange} placeholder="0,00" min="0" step="0.01" disabled={saving} />
              ))}
              {renderField("Preço de venda", (
                <input type="number" inputMode="decimal" name="salePrice" value={form.salePrice} onChange={handleChange} placeholder="0,00" min="0" step="0.01" required disabled={saving} />
              ))}
              <div className="pr-span">
                {renderField("Quantidade em estoque", (
                  <input type="number" inputMode="numeric" name="quantity" value={form.quantity} onChange={handleChange} placeholder="0" min="0" step="1" required disabled={saving} />
                ))}
              </div>
            </div>

            <div className="pr-modal-foot">
              <button type="button" className="cl-btn cl-btn-ghost" onClick={clearForm} disabled={saving}>
                Cancelar
              </button>
              <button type="submit" className="cl-btn cl-btn-primary" disabled={saving}>
                {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Cadastrar produto"}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
}
