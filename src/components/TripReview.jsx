import { useRef, useState } from "react";
import {
  buildNewTrip, buildTripReview, getTripOptionLabel,
} from "../domain/tripIdentity.js";
import { buildTripReviewPlan } from "../domain/tripReviewPlan.js";
import { correctExpenseTrip } from "../services/expenses.js";
import { db } from "../firebase/config.js";
import { isFirestoreReadOnly } from "../firebase/writePolicy.js";
import FinancialValue from "./FinancialValue.jsx";
import { useFinancialPrivacy } from "../context/financialPrivacy.js";
import "./TripPeriodFilter.css";

export default function TripReview({ userId, trips, sales, payables, expenses }) {
  const { hidden } = useFinancialPrivacy();
  const [recordKey, setRecordKey] = useState("");
  const [tripNumber, setTripNumber] = useState("1");
  const [tripYear, setTripYear] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const rows = buildTripReview({ trips, sales, payables, expenses });
  const selected = rows.find((row) => `${row.collection}/${row.recordId}` === recordKey);
  const validDestination = /^[1-4]$/.test(tripNumber) &&
    /^\d{4}$/.test(tripYear) && Number(tripYear) >= 2000 && Number(tripYear) <= 2100;
  const destination = validDestination ? buildNewTrip({ tripNumber, tripYear }) : null;
  const candidates = destination ? trips.filter((trip) =>
    getTripOptionLabel(trip) === destination.name
  ) : [];
  const target = candidates.find((trip) => trip.id === destinationId);
  const expense = expenses.find((entry) => selected?.collection === "expenses" && entry.id === selected.recordId);
  const reviewExpenses = expenses.filter((entry) => rows.some((row) =>
    row.collection === "expenses" && row.recordId === entry.id));
  const currency = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  async function applyCorrection() {
    if (lock.current || !expense || !target) return;
    if (!window.confirm(`Corrigir somente a viagem de ${expense.category || "despesa"} (${hidden ? "valor oculto" : currency(expense.value)}) para ${destination.name}, cadastro ${target.id}? O lançamento será preservado, com backup e histórico dos vínculos.`)) return;
    lock.current = true;
    setSaving(true);
    setExportMessage("");
    try {
      await correctExpenseTrip({ db, userId, expected: expense, destination: target });
      setExportMessage("Vínculo corrigido. Valores preservados; backup e histórico salvos no lançamento. Os resumos serão atualizados pela leitura do Firebase.");
      setRecordKey("");
    } catch (error) {
      console.error("Erro ao corrigir vínculo de viagem:", error);
      setExportMessage(`Não foi possível corrigir: ${error.message}`);
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  function exportReview(includeSelection) {
    try {
      const plan = buildTripReviewPlan({
        userId,
        collections: { trips, sales, payables, expenses },
        selection: includeSelection ? {
          collection: selected.collection, recordId: selected.recordId, destinationId: target.id,
        } : null,
      });
      const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "rc-revisao-viagens-simulacao.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMessage("Arquivo de simulação gerado com os IDs e campos originais. Nenhum dado foi gravado.");
    } catch (error) {
      console.error("Erro ao exportar revisão de viagens:", error);
      setExportMessage(`Não foi possível exportar: ${error.message}`);
    }
  }

  return (
    <details className="fin-notice trip-review">
      <summary>Revisão de viagens ({rows.length} registros)</summary>
      <p>
        Referências diferentes não são unificadas pelo nome. Nenhum ano é inferido
        pela data da despesa. A correção individual exige confirmação e preserva
        os valores, com backup dos campos e trilha de auditoria no lançamento.
      </p>
      <p>Despesas para revisão: {reviewExpenses.length} · total <FinancialValue>{currency(reviewExpenses.reduce((sum, entry) => sum + Number(entry.value || 0), 0))}</FinancialValue>.
        {" "}Consulte os lançamentos abaixo antes de escolher o destino. Sem evidência do ano, confirme com o responsável.</p>
      {reviewExpenses.map((entry) => <p key={entry.id}>
        {entry.category || "Despesa"} · {entry.description || entry.city || "Sem descrição"} · {entry.id}:
        {" "}<FinancialValue>{currency(entry.value)}</FinancialValue> · vínculo {entry.tripId || entry.tripName || "ausente"}
      </p>)}
      <button type="button" className="payables-secondary-button" disabled={!userId} onClick={() => exportReview(false)}>
        Exportar diagnóstico e backup dos vínculos
      </button>
      <p>O arquivo contém IDs e campos de viagem das vendas, compras, despesas e viagens carregadas nesta conta. Guarde-o em local privado; não é um backup integral do banco.</p>
      <label>
        Registro para revisão
        <select value={recordKey} onChange={(event) => {
          setRecordKey(event.target.value);
          setDestinationId("");
          setExportMessage("");
        }}>
          <option value="">Selecione um registro</option>
          {rows.map((row) => (
            <option key={`${row.collection}/${row.recordId}`} value={`${row.collection}/${row.recordId}`}>
              {row.collection}/{row.recordId} — {row.label} — {row.reason}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <div>
          <p>Referência original: <code>{selected.tripId}</code> · {selected.reason}</p>
          <label>
            Número de destino (prévia)
            <select value={tripNumber} onChange={(event) => {
              setTripNumber(event.target.value);
              setDestinationId("");
            }}>
              {[1, 2, 3, 4].map((number) => <option key={number}>{number}</option>)}
            </select>
          </label>
          <label>
            Ano de destino (confirme; não inferido)
            <input type="number" min="2000" max="2100" value={tripYear}
              onChange={(event) => {
                setTripYear(event.target.value);
                setDestinationId("");
              }} />
          </label>
          {destination && (
            <p>
              Prévia: {selected.collection}/{selected.recordId}: {selected.label} → {destination.name}.
              {" "}{candidates.length === 1
                ? `Cadastro de destino: ${candidates[0].id}.`
                : candidates.length > 1
                  ? "Há mais de um cadastro possível; confirme o ID de destino antes de qualquer reparação."
                  : "Não existe cadastro de destino. A prévia não cria viagens."}
              {" "}Nenhuma alteração foi aplicada.
            </p>
          )}
          {expense && <p>Lançamento selecionado: {expense.category || "Despesa"} · {expense.id} · <FinancialValue>{currency(expense.value)}</FinancialValue>.
            {" "}Somente este lançamento será corrigido; demais despesas da referência continuam acessíveis.</p>}
          {candidates.length > 0 && selected.collection !== "trips" && (
            <label>
              Cadastro de destino (confirme o ID)
              <select aria-label="Cadastro de destino (confirme o ID)" value={target?.id || ""}
                onChange={(event) => setDestinationId(event.target.value)}>
                <option value="">Selecione explicitamente o destino</option>
                {candidates.map((trip) => (
                  <option key={trip.id} value={trip.id}>{getTripOptionLabel(trip)} · {trip.id}</option>
                ))}
              </select>
            </label>
          )}
          {selected.collection === "trips" || selected.collection === "sales" ? (
            <p>O cadastro original não será alterado ou unido a outro. Vendas exigem revisão da data comercial em Vendas, não seleção manual de viagem.</p>
          ) : (
            <>
              <button type="button" className="payables-secondary-button" disabled={!userId || !target}
                onClick={() => exportReview(true)}>Exportar simulação da associação</button>
              {expense ? <>
                <button type="button" className="payables-secondary-button" disabled={!userId || !target || saving || isFirestoreReadOnly()}
                  onClick={applyCorrection}>{saving ? "Corrigindo..." : "Corrigir viagem"}</button>
                {isFirestoreReadOnly() && <p>Somente leitura: confira o destino e exporte a simulação. Aplicar a correção está bloqueado nesta prévia.</p>}
              </> : <p>Compras de fornecedores devem ser corrigidas no formulário próprio, que mantém o histórico financeiro existente.</p>}
            </>
          )}
        </div>
      )}
      {exportMessage && <p role="status">{exportMessage}</p>}
    </details>
  );
}
