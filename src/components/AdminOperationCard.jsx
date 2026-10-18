import "./AdminOperationCard.css";

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

const TRIP_LABELS = { 1: "1ª viagem", 2: "2ª viagem", 3: "3ª viagem", 4: "4ª viagem" };

export default function AdminOperationCard({
  draft,
  readOnly,
  onConfirm,
  onCancel,
  onChooseProduct,
  onChooseTrip,
}) {
  const open = ["collecting", "choosing", "ready"].includes(draft.status);

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
          {draft.tripSuggestion && (
            <button
              type="button"
              className="admin-card-trip-primary"
              onClick={() => onChooseTrip(draft.tripSuggestion)}
            >
              Usar {TRIP_LABELS[draft.tripSuggestion]}
            </button>
          )}
          {[1, 2, 3, 4]
            .filter((trip) => trip !== draft.tripSuggestion)
            .map((trip) => (
              <button key={trip} type="button" onClick={() => onChooseTrip(trip)}>
                {TRIP_LABELS[trip]}
              </button>
            ))}
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
