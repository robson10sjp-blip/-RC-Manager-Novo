import { useState } from "react";
import {
  buildNewTrip, buildTripReview, getTripOptionLabel,
} from "../domain/tripIdentity.js";
import { buildTripReviewPlan } from "../domain/tripReviewPlan.js";

export default function TripReview({ userId, trips, sales, payables, expenses }) {
  const [recordKey, setRecordKey] = useState("");
  const [tripNumber, setTripNumber] = useState("1");
  const [tripYear, setTripYear] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const rows = buildTripReview({ trips, sales, payables, expenses });
  const selected = rows.find((row) => `${row.collection}/${row.recordId}` === recordKey);
  const validDestination = /^[1-4]$/.test(tripNumber) &&
    /^\d{4}$/.test(tripYear) && Number(tripYear) >= 2000 && Number(tripYear) <= 2100;
  const destination = validDestination ? buildNewTrip({ tripNumber, tripYear }) : null;
  const candidates = destination ? trips.filter((trip) =>
    getTripOptionLabel(trip) === destination.name
  ) : [];
  const target = candidates.find((trip) => trip.id === destinationId);

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
    <details className="fin-notice">
      <summary>Revisar vínculos antigos de viagem ({rows.length} registros)</summary>
      <p>
        Referências diferentes não são unificadas pelo nome. Esta prévia não grava,
        não migra e não altera totais. Qualquer reparação futura exige backup,
        confirmação do dono e trilha de auditoria.
      </p>
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
          {selected.collection === "trips" ? (
            <p>O cadastro original não será alterado ou unido a outro. Revise os registros vinculados individualmente.</p>
          ) : (
            <>
              <button type="button" className="payables-secondary-button" disabled={!userId || !target}
                onClick={() => exportReview(true)}>Exportar simulação da associação</button>
              <p>A associação ainda não será aplicada. Para uma venda, use “Editar” em Vendas e escolha explicitamente a viagem; a referência só muda após salvar.</p>
            </>
          )}
        </div>
      )}
      {exportMessage && <p role="status">{exportMessage}</p>}
    </details>
  );
}
