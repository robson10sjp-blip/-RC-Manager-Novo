import { normalizeSearchText } from "./clientCities.js";

export function getRecordTripId(record = {}) {
  if (record.tripId) return String(record.tripId);
  const name = normalizeSearchText(record.tripName);
  if (!name) return "";

  const numbered = name.match(
    /^(?:(?:viagem(?: n| numero)?) )?(\d+)(?:a|o)?(?: viagem)?(?: (\d{4}))?$/
  );
  if (numbered) {
    return `legacy-number-${Number(numbered[1])}${numbered[2] ? `-${numbered[2]}` : ""}`;
  }
  return `legacy-name-${name.replaceAll(" ", "-")}`;
}

export function buildTripOptions({ trips = [], sales = [], visits = [] }) {
  const options = new Map();
  for (const record of [...sales, ...visits]) {
    const id = getRecordTripId(record);
    if (id) options.set(id, { id, name: record.tripName || id });
  }
  for (const trip of trips) {
    options.set(trip.id, { id: trip.id, name: trip.name });
  }
  return [...options.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id)
  );
}
