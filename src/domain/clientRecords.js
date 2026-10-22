import { getClientCityKey, normalizeSearchText } from "./clientCities.js";

export function createVisitRecordId(clientId, tripName) {
  const tripKey = normalizeSearchText(tripName).replace(/\s+/g, "-");
  if (!tripKey || !clientId) {
    throw new Error("Cliente e identificador da viagem são obrigatórios.");
  }
  return `${tripKey}_${encodeURIComponent(String(clientId))}`;
}

export function resolveClientTripVisitStatus({
  client,
  city,
  tripName,
  visitRecords = [],
  sales = [],
}) {
  const tripKey = normalizeSearchText(tripName);
  const cityKey = getClientCityKey(city);
  if (!client?.id || !tripKey || !cityKey) return "unvisited";

  const bought = sales.some(
    (sale) =>
      sale.clientId === client.id &&
      normalizeSearchText(sale.tripName) === tripKey &&
      (!sale.tripCity || getClientCityKey(sale.tripCity) === cityKey)
  );
  if (bought) return "bought";

  const explicitVisit = visitRecords.find(
    (record) =>
      record.clientId === client.id &&
      normalizeSearchText(record.tripName) === tripKey &&
      getClientCityKey(record.city) === cityKey
  );
  return explicitVisit?.status === "not_purchased"
    ? "not_purchased"
    : "unvisited";
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
