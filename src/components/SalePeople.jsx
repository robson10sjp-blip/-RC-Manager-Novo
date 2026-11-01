import { useState } from "react";
import { assignSaleItems, groupSalePeople, removeSalePerson, saleItemLabel } from "../domain/salePeople.js";
import FinancialValue from "./FinancialValue.jsx";
import "./SalePeople.css";

const currency = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function SalePeopleSummary({ sale }) {
  const groups = groupSalePeople(sale).filter((person) => person.items.length);
  if (!groups.length) return null;
  return <div className="sale-people-summary">
    {groups.map((person) => <section key={person.id}>
      <strong>{person.name}{person.relationship ? ` · ${person.relationship}` : ""}</strong>
      <ul>{person.items.map((item, index) => <li key={index}>
        {item.quantity}x {saleItemLabel(item)}
        {" · "}<FinancialValue>{currency(item.price ?? item.unitPrice)} cada · {currency(item.subtotal ?? Number(item.quantity) * Number(item.price ?? item.unitPrice ?? 0))}</FinancialValue>
      </li>)}</ul>
      <span>Subtotal: <FinancialValue>{currency(person.subtotal)}</FinancialValue></span>
    </section>)}
  </div>;
}

export default function SalePeopleEditor({ sale, onChange, products, disabled, activePersonId, onSelectPerson }) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [target, setTarget] = useState("");
  const [selectionState, setSelectionState] = useState({ items: sale.items, values: {} });
  const selections = selectionState.items === sale.items ? selectionState.values : {};
  const setSelections = (values) => setSelectionState({ items: sale.items, values });
  const [error, setError] = useState("");
  const people = sale.people || [];
  const items = sale.items.map((item) => {
    const product = products.find((entry) => entry.id === item.productId);
    return { ...product, ...item, name: item.name || product?.name || "Selecione o produto" };
  });
  const remaining = sale.items.filter((item) => item.productId && !people.some((person) => person.id === item.personId))
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  function addPerson() {
    const trimmed = name.trim();
    if (!trimmed) { setError("Informe o nome da pessoa."); return; }
    const existing = people.find((person) => person.name.trim().toLocaleLowerCase("pt-BR") === trimmed.toLocaleLowerCase("pt-BR"));
    if (existing) {
      onSelectPerson(existing.id);
      setTarget(existing.id);
    } else {
      const person = { id: crypto.randomUUID(), name: trimmed, relationship: relationship.trim() };
      onChange({ ...sale, people: [...people, person] });
      onSelectPerson(person.id);
      setTarget(person.id);
    }
    setName(""); setRelationship(""); setError("");
  }

  function applySelection() {
    try {
      onChange(assignSaleItems(sale, selections, target));
      setSelections({}); setError("");
    } catch (failure) { setError(failure.message); }
  }

  return <section className="sale-people-editor" aria-label="Pessoas da compra">
    <div className="sale-people-heading"><h3>Pessoas da compra</h3>
      <button type="button" className="cl-btn cl-btn-soft" disabled={disabled}
        onClick={() => setExpanded(!expanded)}>{expanded ? "Recolher separação" : "Separar por pessoa"}</button>
    </div>
    <p>Uma única venda e um único responsável financeiro. A separação não altera estoque nem recebimentos.</p>
    <label>Adicionar mercadoria por pessoa
      <select value={activePersonId} disabled={disabled} onChange={(event) => onSelectPerson(event.target.value)}>
        <option value="">Adicionar tudo e separar depois</option>
        {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select>
    </label>
    <div className="sale-person-fields">
      <label>Nome da pessoa<input value={name} disabled={disabled} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Filha ou Mãe" /></label>
      <label>Parentesco (opcional)<input value={relationship} disabled={disabled} onChange={(event) => setRelationship(event.target.value)} /></label>
      <button type="button" className="cl-btn cl-btn-soft" onClick={addPerson} disabled={disabled}>Adicionar / selecionar pessoa</button>
    </div>
    {activePersonId && <p role="status">Próximas mercadorias: <strong>{people.find((person) => person.id === activePersonId)?.name}</strong>. Mantido até você trocar.</p>}
    {(expanded || people.length > 0) && <>
      <p role="status"><strong>{remaining} unidade(s) ainda faltam distribuir.</strong></p>
      {expanded && <>
        <p>Selecione uma ou várias peças. Ajuste a quantidade para transferir apenas uma parte.</p>
        <div className="sale-people-heading">
          <button type="button" className="cl-btn cl-btn-soft" disabled={disabled}
            onClick={() => setSelections(Object.fromEntries(sale.items.flatMap((item, index) => item.productId ? [[index, item.quantity]] : [])))}>Selecionar todas</button>
          <button type="button" className="cl-btn cl-btn-soft" disabled={disabled} onClick={() => setSelections({})}>Limpar seleção</button>
        </div>
        {items.map((item, index) => item.productId && <div className="sale-allocation-line" key={index}>
          <label className="sale-allocation-check"><input type="checkbox" disabled={disabled}
            checked={Object.hasOwn(selections, index)} onChange={(event) => {
              const next = { ...selections };
              if (event.target.checked) next[index] = item.quantity;
              else delete next[index];
              setSelections(next);
            }} />
            <span>{saleItemLabel(item)}<small>{item.quantity} un. · <FinancialValue>{currency(item.price)} cada · {currency(item.subtotal ?? Number(item.quantity) * Number(item.price))}</FinancialValue><br />
              {people.find((person) => person.id === item.personId)?.name || "Sem pessoa informada"}</small></span>
          </label>
          {Object.hasOwn(selections, index) && <label className="sale-allocation-quantity">Transferir
            <input aria-label={`Quantidade a transferir do item ${index + 1}`} type="number" min="1" max={item.quantity} step="1"
              value={selections[index]} disabled={disabled} onChange={(event) => setSelections({ ...selections, [index]: event.target.value })} />
          </label>}
        </div>)}
        <div className="sale-person-fields">
          <label>Atribuir selecionadas a<select value={target} disabled={disabled} onChange={(event) => setTarget(event.target.value)}>
            <option value="">Escolher pessoa</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select></label>
          <button type="button" className="cl-btn cl-btn-soft" disabled={disabled} onClick={applySelection}>Transferir peças selecionadas</button>
        </div>
        {people.map((person) => <details key={person.id}>
          <summary>Editar pessoa: {person.name}</summary>
          <div className="sale-person-fields">
            {["name", "relationship"].map((field) => <label key={field}>{field === "name" ? "Nome da pessoa" : "Parentesco"}
              <input value={person[field] || ""} disabled={disabled} required={field === "name"}
                onChange={(event) => onChange({ ...sale, people: people.map((entry) => entry.id === person.id ? { ...entry, [field]: event.target.value } : entry) })} />
            </label>)}
            <button type="button" className="cl-btn cl-btn-soft" disabled={disabled} onClick={() => {
              try {
                onChange(removeSalePerson(sale, person.id, target));
                if (activePersonId === person.id) onSelectPerson(target === person.id ? "" : target);
                setSelections({}); setError("");
              } catch (failure) { setError(failure.message); }
            }}>Remover pessoa (transferir para o destino escolhido)</button>
          </div>
        </details>)}
      </>}
      <SalePeopleSummary sale={{ ...sale, items: items.filter((item) => item.productId) }} />
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
