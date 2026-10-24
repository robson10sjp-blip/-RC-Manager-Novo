import { useEffect, useRef, useState } from "react";
import { db } from "../firebase/config.js";
import { isFirestoreReadOnly } from "../firebase/writePolicy.js";
import { createClientTrip } from "../services/clientRecords.js";
import { getTripOptionLabel, getTripNumberYear } from "../domain/tripIdentity.js";
import "./TripPeriodFilter.css";

export default function TripSelector({ userId, options, value, onChange, onPendingChange, disabled = false, label = "Escolher ano e viagem", allowCreate = true }) {
  const [draft, setDraft] = useState(() => ({
    value, year: "", number: "", destinationId: "", started: false,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const active = useRef(true);
  const current = options.find((trip) => trip.id === value);
  const currentIdentity = getTripNumberYear(current || {});
  const activeDraft = draft.value === value
    ? draft
    : { value, year: "", number: "", destinationId: "", started: false };
  function updateDraft(changes) {
    setDraft((previous) => ({
      ...(previous.value === value ? previous : { value, year: "", number: "", destinationId: "", started: false }),
      ...changes,
      value,
    }));
  }
  const selectedYear = activeDraft.year || String(currentIdentity.tripYear || "");
  const selectedNumber = activeDraft.started ? activeDraft.number : activeDraft.number || (selectedYear && Number(currentIdentity.tripYear) === Number(selectedYear)
    ? String(currentIdentity.tripNumber || "") : "");
  const years = [...new Set([new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1,
    ...options.map((trip) => getTripNumberYear(trip).tripYear).filter(Boolean)])].sort((a, b) => b - a);
  const candidates = selectedYear && selectedNumber ? options.filter((trip) => {
    const identity = getTripNumberYear(trip);
    return trip.registered && !trip.identityConflict &&
      identity.tripYear === Number(selectedYear) && identity.tripNumber === Number(selectedNumber);
  }) : [];
  const target = candidates.find((trip) => trip.id === activeDraft.destinationId) ||
    (candidates.length === 1 ? candidates[0] : null);

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
      const trip = await createClientTrip({ db, userId, tripNumber: selectedNumber, tripYear: selectedYear });
      if (!active.current) return;
      onChange(trip);
      updateDraft({ started: false });
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
        Ano
        <select aria-label={`Ano · ${label}`} value={selectedYear} disabled={disabled || saving}
          onChange={(event) => {
            updateDraft({
              year: event.target.value, number: "", destinationId: "",
              started: Boolean(event.target.value),
            });
            onPendingChange?.(Boolean(value && event.target.value));
          }}>
          <option value="">Escolher ano</option>
          {years.filter(Number.isFinite).map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
      </label>
      <label>
        {label}
        <select
          aria-label="Viagem"
          value={selectedNumber}
          disabled={disabled || saving || !selectedYear}
          onChange={(event) => {
            setError("");
            const number = event.target.value;
            updateDraft({ number, destinationId: "", started: Boolean(number) });
            const matches = options.filter((trip) => {
              const identity = getTripNumberYear(trip);
              return trip.registered && !trip.identityConflict &&
                identity.tripYear === Number(selectedYear) && identity.tripNumber === Number(number);
            });
            if (matches.length === 1) {
              onChange(matches[0]);
              updateDraft({ started: false });
              onPendingChange?.(false);
            } else {
              onPendingChange?.(Boolean(number));
            }
          }}
        >
          <option value="">Escolher viagem</option>
          {[1, 2, 3, 4].map((number) => (
            <option key={number} value={number}>{number}ª viagem de {selectedYear}</option>
          ))}
        </select>
      </label>
      {candidates.length > 1 && (
        <label>
          Cadastro da viagem
          <select aria-label="Cadastro da viagem" value={target?.id || ""}
            onChange={(event) => {
              const chosen = candidates.find((trip) => trip.id === event.target.value);
              updateDraft({ destinationId: event.target.value });
              if (chosen) {
                onChange(chosen);
                updateDraft({ started: false });
                onPendingChange?.(false);
              }
            }}>
            <option value="">Escolher cadastro</option>
            {candidates.map((trip) => <option key={trip.id} value={trip.id}>{trip.name || trip.id} · {trip.id}</option>)}
          </select>
        </label>
      )}
      {value && (!current?.registered || current?.reviewRequired) && (
        <p role="status">Vínculo atual preservado. Para alterá-lo, escolha ano e viagem.</p>
      )}
      {activeDraft.started && selectedNumber && !target && candidates.length === 0 && (
        <div>
          <p role="status">{getTripOptionLabel({ tripNumber: selectedNumber, tripYear: selectedYear })} ainda não tem cadastro.</p>
          {allowCreate && userId && <button type="button" className="cl-btn cl-btn-gold"
            disabled={disabled || saving || isFirestoreReadOnly()} onClick={createTrip}>
            {saving ? "Criando..." : "Cadastrar viagem"}
          </button>}
        </div>
      )}
      {error && <p role="alert" className="cl-record-error">{error}</p>}
    </div>
  );
}
