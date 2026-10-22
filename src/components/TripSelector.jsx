import { useRef, useState } from "react";
import { db } from "../firebase/config.js";
import { isFirestoreReadOnly } from "../firebase/writePolicy.js";
import { createClientTrip } from "../services/clientRecords.js";

export default function TripSelector({ userId, options, value, onChange, onPendingChange, disabled = false }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);

  async function createTrip() {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      const trip = await createClientTrip({ db, userId, name });
      onChange(trip);
      setCreating(false);
      onPendingChange?.(false);
      setName("");
    } catch (error) {
      console.error("Erro ao criar viagem:", error);
      setError(`Não foi possível criar a viagem: ${error.message}`);
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="cl-trip-selector">
      <label>
        Viagem
        <select
          aria-label="Viagem"
          value={creating ? "__new__" : value}
          disabled={disabled || saving}
          onChange={(event) => {
            setError("");
            setCreating(event.target.value === "__new__");
            onPendingChange?.(event.target.value === "__new__");
            if (event.target.value === "__new__") {
              onChange({ id: "", name: "" });
            } else {
              onChange(options.find((trip) => trip.id === event.target.value) || { id: "", name: "" });
            }
          }}
        >
          <option value="">Selecione uma viagem</option>
          {options.map((trip) => (
            <option key={trip.id} value={trip.id}>
              {trip.name} · {trip.id.startsWith("legacy-") ? "histórica" : trip.id.slice(-8)}
            </option>
          ))}
          <option value="__new__">Nova viagem (novo identificador)</option>
        </select>
      </label>
      {creating && (
        <div>
          <label>
            Nome da nova viagem
            <input value={name} onChange={(event) => setName(event.target.value)}
              maxLength={100} placeholder="Ex.: Rota Sul outubro 2026"
              disabled={disabled || saving} />
          </label>
          <p>A confirmação cria uma viagem independente, sem herdar marcações, mesmo se o nome for igual.</p>
          <button type="button" className="cl-btn cl-btn-gold"
            disabled={disabled || saving || !name.trim() || isFirestoreReadOnly()}
            onClick={createTrip}>
            {saving ? "Criando viagem..." : "Confirmar nova viagem"}
          </button>
          <button type="button" className="cl-btn cl-btn-soft" disabled={saving}
            onClick={() => {
              setCreating(false);
              onPendingChange?.(false);
            }}>Cancelar</button>
        </div>
      )}
      {error && <p role="alert" className="cl-record-error">{error}</p>}
    </div>
  );
}
