import { useState } from "react";
import { groupSalePeople, removeSalePerson } from "../domain/salePeople.js";
import FinancialValue from "./FinancialValue.jsx";
import "./SalePeople.css";

const currency = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function SalePeopleSummary({ sale }) {
  const groups = groupSalePeople(sale);
  if (!groups.length) return null;
  return <div className="sale-people-summary">
    {groups.map((person) => <section key={person.id}>
      <strong>{person.name}{person.relationship ? ` · ${person.relationship}` : ""}</strong>
      <ul>{person.items.map((item, index) => <li key={index}>
        {item.quantity}x {item.name || item.productName || "Produto"}
        {" · "}<FinancialValue>{currency(Number(item.quantity) * Number(item.price ?? item.unitPrice ?? 0))}</FinancialValue>
      </li>)}</ul>
      <span>Subtotal: <FinancialValue>{currency(person.subtotal)}</FinancialValue></span>
    </section>)}
  </div>;
}

export default function SalePeopleEditor({ sale, onChange, responsibleName, products, disabled }) {
  const [removing, setRemoving] = useState("");
  const [replacement, setReplacement] = useState("");
  const [error, setError] = useState("");
  const people = sale.people || [];
  function addPerson() {
    const first = { id: crypto.randomUUID(), name: responsibleName || "", relationship: "" };
    const added = { id: crypto.randomUUID(), name: "", relationship: "" };
    onChange({
      ...sale, people: people.length ? [...people, added] : [first, added],
      items: people.length ? sale.items : sale.items.map((item) => ({ ...item, personId: first.id })),
    });
  }
  function updatePerson(id, field, value) {
    onChange({ ...sale, people: people.map((person) => person.id === id ? { ...person, [field]: value } : person) });
  }
  return <section className="sale-people-editor" aria-label="Pessoas da compra">
    <div className="sale-people-heading"><h3>Pessoas da compra</h3>
      <button type="button" className="cl-btn cl-btn-soft" onClick={addPerson} disabled={disabled}>Adicionar pessoa</button>
    </div>
    {people.map((person) => <div className="sale-person-fields" key={person.id}>
      <label>Nome da pessoa<input value={person.name} disabled={disabled} required
        onChange={(event) => updatePerson(person.id, "name", event.target.value)} /></label>
      <label>Parentesco (opcional)<input value={person.relationship || ""} disabled={disabled}
        onChange={(event) => updatePerson(person.id, "relationship", event.target.value)} /></label>
      <button type="button" className="cl-btn cl-btn-soft" disabled={disabled}
        onClick={() => { setRemoving(person.id); setReplacement(""); setError(""); }}>Remover pessoa</button>
    </div>)}
    {removing && <div role="group" aria-label="Reatribuir itens">
      <label>Transferir itens para<select value={replacement} onChange={(event) => setReplacement(event.target.value)} disabled={disabled}>
        <option value="">Escolher pessoa</option>
        {people.filter((person) => person.id !== removing).map((person) => <option key={person.id} value={person.id}>{person.name || "Pessoa sem nome"}</option>)}
      </select></label>
      <button type="button" className="cl-btn cl-btn-soft" disabled={disabled} onClick={() => {
        try { onChange(removeSalePerson(sale, removing, replacement)); setRemoving(""); setError(""); }
        catch (failure) { setError(failure.message); }
      }}>Confirmar remoção</button>
      <button type="button" className="cl-btn cl-btn-soft" onClick={() => setRemoving("")}>Cancelar</button>
    </div>}
    {error && <p role="alert">{error}</p>}
    {people.length > 0 && <>
      {sale.items.map((item, index) => <label key={index}>Pessoa · item {index + 1} · {products.find((product) => product.id === item.productId)?.name || "Selecione o produto"}
        <select aria-label={`Pessoa do item ${index + 1}`} value={item.personId || ""} required disabled={disabled}
          onChange={(event) => onChange({ ...sale, items: sale.items.map((line, lineIndex) =>
            lineIndex === index ? { ...line, personId: event.target.value } : line) })}>
          <option value="">Escolher pessoa</option>
          {people.map((person) => <option key={person.id} value={person.id}>{person.name || "Pessoa sem nome"}</option>)}
        </select>
      </label>)}
      <SalePeopleSummary sale={{ ...sale, items: sale.items.map((item) => ({
        ...item, name: products.find((product) => product.id === item.productId)?.name || "Produto",
      })) }} />
    </>}
  </section>;
}
