import { getClientCityKey, normalizeSearchText } from "./clientCities.js";
import { getRecordTripId } from "./tripIdentity.js";

export function createVisitRecordId(clientId, tripId, city) {
  const cityKey = getClientCityKey(city);
  if (!tripId || !clientId || !cityKey) {
    throw new Error("Cliente, cidade e identificador da viagem são obrigatórios.");
  }
  return [tripId, cityKey, clientId].map(encodeURIComponent).join("~");
}

export function resolveClientTripVisitStatus({
  client,
  city,
  tripId,
  tripName,
  visitRecords = [],
  sales = [],
}) {
  const tripKey = getRecordTripId({ tripId, tripName });
  const cityKey = getClientCityKey(city);
  if (!client?.id || !tripKey || !cityKey ||
    getClientCityKey(client.city) !== cityKey) return "unvisited";

  const bought = sales.some(
    (sale) =>
      sale.clientId === client.id &&
      getRecordTripId(sale) === tripKey &&
      !["cancelled", "canceled"].includes(sale.status) &&
      getClientCityKey(sale.tripCity || client.city) === cityKey
  );
  if (bought) return "bought";

  const matchingVisits = visitRecords.filter(
    (record) =>
      record.clientId === client.id &&
      getRecordTripId(record) === tripKey &&
      getClientCityKey(record.city) === cityKey
  );
  // A new canonical record (including undo) overrides a read-only legacy marker.
  const explicitVisit = matchingVisits.find((record) => record.tripId === tripKey)
    || matchingVisits[0];
  return explicitVisit?.status === "not_purchased"
    ? "not_purchased"
    : "unvisited";
}

export function buildClientVisitSummary({ clients, city, tripId, tripName, visitRecords, sales }) {
  const rows = !city || !getRecordTripId({ tripId, tripName }) ? [] : clients
    .filter((client) => getClientCityKey(client.city) === getClientCityKey(city))
    .map((client) => ({
      client,
      status: resolveClientTripVisitStatus({ client, city, tripId, tripName, visitRecords, sales }),
    }));
  const counts = { unvisited: 0, not_purchased: 0, bought: 0 };
  for (const row of rows) counts[row.status] += 1;
  return { rows, counts };
}

export function validateGiftQuantity(quantity, stock) {
  const requested = Number(quantity);
  const available = Math.floor(Number(stock) || 0);
  if (!Number.isInteger(requested) || requested <= 0) {
    throw new Error("A quantidade do brinde deve ser um número inteiro maior que zero.");
  }
  if (requested > available) {
    throw new Error("A quantidade do brinde não pode superar o estoque disponível.");
  }
  return requested;
}

export function calculateGiftCost(unitCost, quantity) {
  const cost = Number(unitCost);
  const count = Number(quantity);
  if (!Number.isFinite(cost) || cost < 0 || !Number.isInteger(count) || count <= 0) {
    throw new Error("Não foi possível calcular o custo do brinde.");
  }
  return Math.round((cost * count + Number.EPSILON) * 100) / 100;
}

export function hasGiftForTrip(gifts = [], tripName, city) {
  const tripKey = normalizeSearchText(tripName);
  const cityKey = getClientCityKey(city);
  return gifts.some(
    (gift) =>
      gift.status !== "cancelled" &&
      normalizeSearchText(gift.tripName) === tripKey &&
      getClientCityKey(gift.tripCity) === cityKey
  );
}
