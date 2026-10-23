import { normalizeSearchText } from "./clientCities.js";

export function getTripNumberYear(record = {}) {
  const name = normalizeSearchText(record.tripName || record.name);
  const numberMatch =
    name.match(/\b([1-9]\d*)\s*(?:a|o)?\s*viagem\b/) ||
    name.match(/\bviagem(?:\s+(?:n|no|numero))?\s*([1-9]\d*)\b/) ||
    name.match(/^([1-9]\d*)$/);
  const yearMatch = name.match(/\b(20\d{2})\b/);
  const tripNumber = Number(record.tripNumber || numberMatch?.[1] || 0);
  const year = Number(record.tripYear || record.year || yearMatch?.[1] || 0);
  return {
    tripNumber: Number.isInteger(tripNumber) && tripNumber > 0 ? tripNumber : null,
    tripYear: Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null,
  };
}

export function getTripOptionLabel(trip = {}, options = []) {
  if (trip.identityConflict && !trip.registered) {
    return trip.tripNumber
      ? `${trip.tripNumber}ª viagem (ano em conflito)`
      : "Viagem com número/ano conflitante";
  }
  const registered = options.find((option) =>
    option.registered && option.id === (trip.tripId || trip.id)
  );
  const saved = getTripNumberYear(trip);
  const resolved = registered ? getTripNumberYear(registered) : saved;
  const tripNumber = resolved.tripNumber || saved.tripNumber;
  const tripYear = resolved.tripYear || saved.tripYear;
  if (tripNumber) {
    return `${tripNumber}ª viagem${tripYear ? ` de ${tripYear}` : " (ano não informado)"}`;
  }
  const name = String(registered?.name || trip.name || trip.tripName || "Viagem sem nome");
  return tripYear && !normalizeSearchText(name).includes(String(tripYear))
    ? `${name} · ${tripYear}`
    : name;
}

export function getRecordTripId(record = {}) {
  if (record.tripId) return String(record.tripId);
  const { tripNumber, tripYear } = getTripNumberYear(record);
  if (tripNumber) {
    return `legacy-number-${tripNumber}${tripYear ? `-${tripYear}` : ""}`;
  }
  const name = normalizeSearchText(record.tripName || record.name);
  if (!name) return "";
  return `legacy-name-${name.replaceAll(" ", "-")}`;
}

export function tripMatchesRecord(record = {}, trip = {}) {
  const selectedId = typeof trip === "string" ? trip : trip.id;
  if (!selectedId) return false;

  const selectedIdentity = getTripNumberYear(trip);
  const recordIdentity = getTripNumberYear(record);
  if (record.tripId) {
    return String(record.tripId) === String(selectedId);
  }
  if (getRecordTripId(record) === selectedId) return true;

  return Boolean(
    // Only a synthetic legacy scope can match an ID-less historical record.
    String(selectedId).startsWith("legacy-") &&
    selectedIdentity.tripNumber &&
      selectedIdentity.tripYear &&
      selectedIdentity.tripNumber === recordIdentity.tripNumber &&
      selectedIdentity.tripYear === recordIdentity.tripYear
  );
}

export function buildTripOptions({
  trips = [],
  sales = [],
  visits = [],
  payables = [],
  expenses = [],
}) {
  const options = new Map();
  const evidence = new Map();
  for (const record of [...sales, ...visits, ...payables, ...expenses]) {
    const id = getRecordTripId(record);
    if (!id) continue;
    const { tripNumber, tripYear } = getTripNumberYear(record);
    const identity = evidence.get(id) || { numbers: new Set(), years: new Set() };
    if (tripNumber) identity.numbers.add(tripNumber);
    if (tripYear) identity.years.add(tripYear);
    evidence.set(id, identity);
    const existing = options.get(id);
    options.set(id, {
      ...existing,
      id,
      name: record.tripName || existing?.name || "Viagem sem nome",
      tripNumber: identity.numbers.size === 1 ? [...identity.numbers][0] : null,
      tripYear: identity.years.size === 1 ? [...identity.years][0] : null,
      identityConflict: identity.numbers.size > 1 || identity.years.size > 1,
      reviewRequired: true,
    });
  }
  for (const trip of trips) {
    const { tripNumber, tripYear } = getTripNumberYear(trip);
    const identity = evidence.get(trip.id);
    const identityConflict = Boolean(identity && (
      identity.numbers.size > 1 || identity.years.size > 1 ||
      (tripNumber && [...identity.numbers].some((number) => number !== tripNumber)) ||
      (tripYear && [...identity.years].some((year) => year !== tripYear))
    ));
    options.set(trip.id, {
      id: trip.id,
      name: trip.name || "Viagem sem nome",
      tripNumber,
      tripYear,
      registered: true,
      identityConflict,
      reviewRequired: !tripNumber || !tripYear || identityConflict,
    });
  }
  return [...options.values()].sort((a, b) =>
    (a.tripYear || 0) - (b.tripYear || 0) ||
    (a.tripNumber || 0) - (b.tripNumber || 0) ||
    a.name.localeCompare(b.name, "pt-BR") ||
    a.id.localeCompare(b.id)
  );
}

export function buildNewTrip({ tripNumber, tripYear }) {
  const number = Number(tripNumber);
  const year = Number(tripYear);
  if (![1, 2, 3, 4].includes(number) ||
    !Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error("Selecione o número da viagem (1 a 4) e um ano entre 2000 e 2100.");
  }
  return {
    id: `trip-${year}-${number}`,
    tripNumber: number,
    tripYear: year,
    name: getTripOptionLabel({ tripNumber: number, tripYear: year }),
  };
}

export function getTripSelectionLabel(trip, options = []) {
  const label = getTripOptionLabel(trip);
  const peers = options.filter((item) => getTripOptionLabel(item) === label);
  const suffix = peers.length > 1
    ? ` · referência ${peers.findIndex((item) => item.id === trip.id) + 1} (revisar)`
    : trip.identityConflict ? " · número/ano conflitante (revisar)"
      : trip.reviewRequired ? " · revisar vínculo" : "";
  return `${label}${suffix}`;
}

export function filterRecordsByTrip(records, selection, options = []) {
  if (!selection || selection === "all") return records;
  if (selection === "unassigned") {
    return records.filter((record) => !getRecordTripId(record));
  }
  const selected = typeof selection === "object"
    ? selection : options.find((trip) => trip.id === selection) || { id: selection };
  return records.filter((record) => tripMatchesRecord(record, selected));
}

export function getSaleTripEditFields(form, changed) {
  if (!changed) return {};
  if (!form.tripId) {
    return { tripId: "", tripName: "", tripNumber: null, tripYear: null };
  }
  const identity = getTripNumberYear(form);
  return {
    tripId: form.tripId,
    tripName: form.tripName || "",
    tripNumber: identity.tripNumber,
    tripYear: identity.tripYear,
  };
}

export function buildTripReview({ trips = [], ...collections }) {
  const options = buildTripOptions({ trips, ...collections });
  const rows = [];
  for (const trip of trips) {
    const option = options.find((item) => item.id === trip.id);
    const peers = options.filter((item) =>
      item.tripNumber === option.tripNumber && item.tripYear === option.tripYear
    );
    if (option.reviewRequired || peers.length > 1) {
      rows.push({
        collection: "trips", recordId: trip.id, tripId: trip.id,
        tripName: trip.name || "", label: getTripOptionLabel(option),
        reason: option.identityConflict ? "Número/ano conflitante entre referências do mesmo ID"
          : option.reviewRequired ? "Cadastro sem número/ano completo"
          : "Mais de uma referência; não unificar automaticamente",
      });
    }
  }
  for (const [collection, records] of Object.entries(collections)) {
    for (const record of records) {
      const tripId = getRecordTripId(record);
      if (!tripId) {
        rows.push({
          collection, recordId: record.id, tripId: "", tripName: "",
          label: "Sem viagem definida", reason: "Registro sem vínculo de viagem",
        });
        continue;
      }
      const trip = options.find((item) => item.id === tripId);
      const identity = getTripNumberYear(record);
      const conflictingIdentity = trip?.registered && (
        (identity.tripNumber && trip.tripNumber && identity.tripNumber !== trip.tripNumber) ||
        (identity.tripYear && trip.tripYear && identity.tripYear !== trip.tripYear)
      );
      const peers = options.filter((item) =>
        item.tripNumber === trip?.tripNumber && item.tripYear === trip?.tripYear
      );
      if (!trip?.registered || trip.reviewRequired || peers.length > 1 || conflictingIdentity) {
        rows.push({
          collection,
          recordId: record.id,
          tripId,
          tripName: record.tripName || "",
          label: getTripOptionLabel(trip),
          reason: conflictingIdentity
            ? "Número/ano do registro diverge do cadastro; preservar o ID e revisar"
            : trip?.identityConflict
              ? "Número/ano conflitante entre referências do mesmo ID"
              : !trip?.registered
              ? "Referência legada ou ausente do cadastro"
              : !trip.tripYear
                ? "Ano não informado"
                : "Mais de uma referência; não unificar automaticamente",
        });
      }
    }
  }
  return rows;
}
