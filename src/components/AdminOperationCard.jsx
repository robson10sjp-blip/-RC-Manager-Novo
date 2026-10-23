import "./AdminOperationCard.css";
import { buildTripOptions, getTripSelectionLabel } from "../domain/tripIdentity.js";

const STATUS_LABELS = {
  collecting: "Aguardando informações",
  choosing: "Escolha o produto",
  ready: "Pronto para confirmar",
  confirming: "Processando...",
  done: "Concluída",
  simulated: "Simulada — nada gravado",
  cancelled: "Cancelada",
  blocked: "Bloqueada",
  error: "Não concluída",
};

export default function AdminOperationCard({
  draft,
  readOnly,
  onConfirm,
  onCancel,
  onChooseProduct,
  onChooseTrip,
  trips = [],
  loadingTrips = false,
}) {
  const open = ["collecting", "choosing", "ready"].includes(draft.status);
  const tripOptions = buildTripOptions({ trips });

  return (
    <section className={`admin-card admin-card-${draft.status}`} aria-label={draft.title}>
      <header className="admin-card-header">
        <strong>{draft.title}</strong>
        <span className="admin-card-status">{STATUS_LABELS[draft.status] || draft.status}</span>
      </header>

      {readOnly && (
        <p className="admin-card-banner">
          Prévia somente leitura: a operação será apenas simulada e nada será gravado.
        </p>
      )}

      {draft.preview && (
        <dl className="admin-card-rows">
          {draft.preview.rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {draft.preview?.warnings?.map((warning) => (
        <p key={warning} className="admin-card-warning">
          ⚠ {warning}
        </p>
      ))}

      {draft.status === "choosing" && draft.candidates?.length > 0 && (
        <ul className="admin-card-options">
          {draft.candidates.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => onChooseProduct(item.id)}>
                <strong>{item.code || "Sem código"}</strong>
                <span>{item.name}</span>
                <small>
                  Tam.: {item.size || "—"} · Cor: {item.color || "—"} · Estoque atual: {item.quantity}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}

      {draft.status === "collecting" && draft.pending === "tripNumber" && (
        <div className="admin-card-trips">
          {tripOptions.map((trip) => (
            <button key={trip.id} type="button" disabled={loadingTrips} onClick={() => onChooseTrip(trip)}>
              {getTripSelectionLabel(trip, tripOptions)}
            </button>
          ))}
          <button type="button" onClick={() => onChooseTrip(null)}>Sem viagem definida</button>
        </div>
      )}

      {draft.status === "blocked" && draft.blocker && (
        <p className="admin-card-warning">
          Já existe: {draft.blocker.code || "sem código"} — {draft.blocker.name} (estoque {draft.blocker.quantity}).
        </p>
      )}

      {draft.result?.message && (
        <p className={draft.status === "error" ? "admin-card-error" : "admin-card-result"} role="status">
          {draft.result.message}
        </p>
      )}

      {open && (
        <footer className="admin-card-actions">
          <button
            type="button"
            className="admin-card-confirm"
            disabled={draft.status !== "ready"}
            onClick={(event) => onConfirm(event)}
          >
            {readOnly ? "Confirmar operação (simulada)" : "Confirmar operação"}
          </button>
          <button type="button" className="admin-card-cancel" onClick={onCancel}>
            Cancelar
          </button>
        </footer>
      )}
    </section>
  );
}
