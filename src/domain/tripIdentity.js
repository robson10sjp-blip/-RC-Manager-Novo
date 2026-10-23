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
    tripNumber: tripNumber > 0 ? tripNumber : null,
    tripYear: year >= 2000 && year <= 2100 ? year : null,
  };
}

export function getTripOptionLabel(trip = {}) {
  const { tripNumber, tripYear } = getTripNumberYear(trip);
  if (tripNumber) {
    return `${tripNumber}ª viagem${tripYear ? `/${tripYear}` : " (ano não informado)"}`;
  }
  const name = String(trip.name || trip.tripName || trip.id || "Viagem");
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
    if (String(record.tripId) === String(selectedId)) return true;
    return Boolean(
      selectedIdentity.tripYear === 2026 &&
        [3, 4].includes(selectedIdentity.tripNumber) &&
        selectedIdentity.tripNumber === recordIdentity.tripNumber &&
        !recordIdentity.tripYear &&
        record.tripId === `legacy-number-${selectedIdentity.tripNumber}`
    );
  }
  if (getRecordTripId(record) === selectedId) return true;

  if (
    selectedIdentity.tripYear === 2026 &&
    [3, 4].includes(selectedIdentity.tripNumber) &&
    selectedIdentity.tripNumber === recordIdentity.tripNumber &&
    !recordIdentity.tripYear
  ) {
    return true;
  }
  return Boolean(
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
  for (const record of [...sales, ...visits, ...payables, ...expenses]) {
    const id = getRecordTripId(record);
    if (!id) continue;
    const { tripNumber, tripYear } = getTripNumberYear(record);
    const existing = options.get(id);
    options.set(id, {
      ...existing,
      id,
      name: record.tripName || existing?.name || id,
      tripNumber: tripNumber || existing?.tripNumber || null,
      tripYear: tripYear || existing?.tripYear || null,
    });
  }
  for (const trip of trips) {
    const { tripNumber, tripYear } = getTripNumberYear(trip);
    options.set(trip.id, {
      id: trip.id,
      name: trip.name,
      tripNumber,
      tripYear,
    });
  }
  return [...options.values()].sort((a, b) =>
    (a.tripYear || 0) - (b.tripYear || 0) ||
    (a.tripNumber || 0) - (b.tripNumber || 0) ||
    a.name.localeCompare(b.name, "pt-BR") ||
    a.id.localeCompare(b.id)
  );
}
