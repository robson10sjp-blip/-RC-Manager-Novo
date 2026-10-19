import { useMemo, useState } from "react";
import {
  getCartQuantity,
  getVariantStock,
  groupProductsForQuickSale,
  removeCartProduct,
  searchQuickSaleGroups,
  setCartQuantity,
  summarizeCart,
} from "../domain/quickSale";
import "./QuickSalePicker.css";

const money = (value) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

const MAX_RESULTS = 30;

export default function QuickSalePicker({
  products,
  items,
  originalQuantities,
  disabled,
  onChange,
  onFinish,
}) {
  const [term, setTerm] = useState("");

  const groups = useMemo(() => groupProductsForQuickSale(products), [products]);
  const results = useMemo(
    () => searchQuickSaleGroups(groups, term),
    [groups, term]
  );
  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products]
  );
  const summary = summarizeCart(items);
  const cartLines = items.filter((item) => item.productId);

  function changeQuantity(product, quantity) {
    onChange(
      setCartQuantity(
        items,
        product,
        quantity,
        getVariantStock(product, originalQuantities)
      )
    );
  }

  return (
    <div className="qs">
      <div className="qs-search">
        <input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Buscar produto por nome ou código"
          aria-label="Buscar produto por nome ou código"
          disabled={disabled}
        />
      </div>

      <div className="qs-results">
        {results.length === 0 && (
          <p className="qs-empty">Nenhum produto encontrado.</p>
        )}

        {results.slice(0, MAX_RESULTS).map((group) => (
          <article className="qs-card" key={group.key}>
            <header>
              <strong>{group.name}</strong>
              <span>
                {[group.category, group.color, group.codes[0]]
                  .filter(Boolean)
                  .join(" • ")}
              </span>
            </header>

            <ul className="qs-sizes">
              {group.variants.map((product) => {
                const stock = getVariantStock(product, originalQuantities);
                const inCart = getCartQuantity(items, product.id);
                const soldOut = stock <= 0;

                return (
                  <li
                    key={product.id}
                    className={`qs-size${inCart > 0 ? " is-selected" : ""}${soldOut ? " is-out" : ""}`}
                  >
                    <button
                      type="button"
                      className="qs-size-btn"
                      disabled={disabled || soldOut || inCart >= stock}
                      onClick={() => changeQuantity(product, inCart + 1)}
                      aria-label={`Adicionar tamanho ${product.size || "único"}`}
                    >
                      <b>{product.size || "Único"}</b>
                      <small>
                        {soldOut ? "Esgotado" : `${stock} un.`}
                      </small>
                      <small>{money(product.salePrice)}</small>
                    </button>

                    {inCart > 0 && (
                      <div className="qs-stepper">
                        <button
                          type="button"
                          onClick={() => changeQuantity(product, inCart - 1)}
                          disabled={disabled}
                          aria-label="Diminuir quantidade"
                        >
                          −
                        </button>
                        <span>{inCart}</span>
                        <button
                          type="button"
                          onClick={() => changeQuantity(product, inCart + 1)}
                          disabled={disabled || inCart >= stock}
                          aria-label="Aumentar quantidade"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </article>
        ))}

        {results.length > MAX_RESULTS && (
          <p className="qs-empty">
            Mostrando {MAX_RESULTS} de {results.length}. Refine a busca.
          </p>
        )}
      </div>

      <section className="qs-cart" aria-label="Carrinho da venda">
        <h3>Carrinho</h3>
        {cartLines.length === 0 ? (
          <p className="qs-empty">Nenhuma peça selecionada.</p>
        ) : (
          <ul>
            {cartLines.map((item) => {
              const product = productById.get(item.productId);
              const stock = product
                ? getVariantStock(product, originalQuantities)
                : Number(item.quantity || 0);

              return (
                <li key={item.productId}>
                  <div className="qs-cart-name">
                    <strong>{product?.name || "Produto"}</strong>
                    <span>
                      {product?.code ? `Cód. ${product.code} • ` : ""}
                      <b>Tam. {product?.size || "—"}</b> • {money(item.price)} cada
                    </span>
                  </div>
                  <div className="qs-stepper">
                    <button
                      type="button"
                      disabled={disabled || !product}
                      onClick={() =>
                        changeQuantity(product, Number(item.quantity) - 1)
                      }
                      aria-label="Diminuir quantidade"
                    >
                      −
                    </button>
                    <span>{item.quantity}</span>
                    <button
                      type="button"
                      disabled={
                        disabled || !product || Number(item.quantity) >= stock
                      }
                      onClick={() =>
                        changeQuantity(product, Number(item.quantity) + 1)
                      }
                      aria-label="Aumentar quantidade"
                    >
                      +
                    </button>
                  </div>
                  <strong className="qs-sub">
                    {money(Number(item.quantity) * Number(item.price || 0))}
                  </strong>
                  <button
                    type="button"
                    className="qs-remove"
                    disabled={disabled}
                    onClick={() =>
                      onChange(removeCartProduct(items, item.productId))
                    }
                    aria-label="Remover do carrinho"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="qs-bar">
        <div>
          <span>{summary.pieces} peça(s)</span>
          <strong>{money(summary.total)}</strong>
        </div>
        <button
          type="button"
          onClick={onFinish}
          disabled={disabled || summary.pieces === 0}
        >
          Finalizar venda
        </button>
      </div>
    </div>
  );
}
