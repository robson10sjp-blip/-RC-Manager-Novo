import { useEffect, useRef, useState } from "react";
import { db } from "../firebase/config.js";
import { isFirestoreReadOnly } from "../firebase/writePolicy.js";
import { createClientTrip } from "../services/clientRecords.js";
import { getTripSelectionLabel, getTripOptionLabel } from "../domain/tripIdentity.js";

export default function TripSelector({ userId, options, value, onChange, onPendingChange, disabled = false, allowUnregistered = true }) {
  const [creating, setCreating] = useState(false);
  const [tripNumber, setTripNumber] = useState("1");
  const [tripYear, setTripYear] = useState(String(new Date().getFullYear()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  async function createTrip() {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      const trip = await createClientTrip({ db, userId, tripNumber, tripYear });
      if (!active.current) return;
      onChange(trip);
      setCreating(false);
      onPendingChange?.(false);
    } catch (error) {
      console.error("Erro ao criar viagem:", error);
      if (active.current) setError(`Não foi possível criar a viagem: ${error.message}`);
    } finally {
      lock.current = false;
      if (active.current) setSaving(false);
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
            if (event.target.value !== "__new__") {
              onChange(options.find((trip) => trip.id === event.target.value) || { id: "", name: "" });
            }
          }}
        >
          <option value="">Selecione uma viagem</option>
          {value && !options.some((trip) => trip.id === value) && (
            <option value={value}>Viagem original preservada · revisar cadastro</option>
          )}
          {options.map((trip) => (
            <option key={trip.id} value={trip.id} disabled={!allowUnregistered && !trip.registered && trip.id !== value}>
              {getTripSelectionLabel(trip, options)}
            </option>
          ))}
          <option value="__new__">Criar nova viagem</option>
        </select>
      </label>
      {creating && (
        <div>
          <label>
            Número da viagem
            <select aria-label="Número da viagem" value={tripNumber} onChange={(event) => setTripNumber(event.target.value)}
              disabled={disabled || saving}>
              {[1, 2, 3, 4].map((number) => <option key={number} value={number}>{number}</option>)}
            </select>
          </label>
          <label>
            Ano da viagem
            <input aria-label="Ano da viagem" type="number" min="2000" max="2100" step="1"
              value={tripYear} onChange={(event) => setTripYear(event.target.value)}
              disabled={disabled || saving} />
          </label>
          <p>{getTripOptionLabel({ tripNumber, tripYear })}</p>
          <p>Referência: 1ª jan–mar; 2ª abr–jun; 3ª jul–set; 4ª out–dez. Nenhum registro antigo será reclassificado.</p>
          <button type="button" className="cl-btn cl-btn-gold"
            disabled={disabled || saving || !tripYear || isFirestoreReadOnly()}
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
      {!creating && value && (!options.find((trip) => trip.id === value)?.registered ||
        options.find((trip) => trip.id === value)?.reviewRequired) && (
        <p role="status">Referência original preservada. Cadastro ou ano precisa de revisão; nenhuma viagem será criada ao salvar.</p>
      )}
      {error && <p role="alert" className="cl-record-error">{error}</p>}
    </div>
  );
}
