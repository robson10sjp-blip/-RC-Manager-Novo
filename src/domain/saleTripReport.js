import { getSaleDateInput, getSaleTrip, resolveSaleCalendar } from "./saleTrip.js";
import { getClientCityKey, normalizeSearchText } from "./clientCities.js";
import { filterRecordsByTrip } from "./tripIdentity.js";

export function getSalesSummary(records) {
  const totals = { count: records.length, sold: 0, received: 0, pending: 0 };
  for (const sale of records) {
    for (const [key, field] of [["sold", "total"], ["received", "amountPaid"], ["pending", "pendingAmount"]]) {
      totals[key] += Math.round(Number(sale[field] || 0) * 100);
    }
  }
  for (const key of ["sold", "received", "pending"]) totals[key] /= 100;
  return totals;
}

export function selectSaleRows(sales, { trip = "all", city = "all", search = "", clients = [], order = "newest" } = {}) {
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const query = normalizeSearchText(search.trim());
  return filterRecordsByTrip(sales, trip).filter((sale) => {
    const client = clientsById.get(sale.clientId);
    return (city === "all" || getClientCityKey(sale.tripCity || client?.city) === getClientCityKey(city)) &&
      (!query || [client?.name, client?.nickname, client?.phone, client?.city, sale.clientName]
        .some((value) => normalizeSearchText(value).includes(query)));
  }).map((sale) => ({ ...sale, originalSaleDate: getSaleDateInput(sale) }))
    .sort((a, b) => {
      const first = a.originalSaleDate;
      const second = b.originalSaleDate;
      if (!first || !second) return first ? -1 : second ? 1 : 0;
      return order === "oldest" ? first.localeCompare(second) : second.localeCompare(first);
    });
}

export function groupSalesByTrip(sales) {
  const groups = new Map();
  for (const sale of sales) {
    const trip = getSaleTrip(sale);
    const id = trip?.id || "unassigned";
    const group = groups.get(id) || {
      id, name: trip?.name || "Data da venda não informada ou inválida",
      tripYear: trip?.tripYear || 0, tripNumber: trip?.tripNumber || 0, sales: [],
    };
    group.sales.push(sale);
    groups.set(id, group);
  }
  return [...groups.values()]
    .sort((a, b) => b.tripYear - a.tripYear || b.tripNumber - a.tripNumber)
    .map((group) => ({ ...group, summary: getSalesSummary(group.sales) }));
}

function dateFormat(value) {
  if (value === null || value === undefined || value === "") return "ausente";
  if (value instanceof Date) return "Date";
  if (typeof value?.toDate === "function") return "Firestore Timestamp";
  if (typeof value === "object") {
    if ("timestampValue" in value) return "REST timestampValue";
    if ("seconds" in value || "_seconds" in value) return "timestamp serializado";
    return "objeto não reconhecido";
  }
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return "ISO calendário";
    if (/^\d{1,2}[/. -]\d{1,2}[/. -]\d{4}$/.test(value.trim())) return "calendário brasileiro";
    if (/^\d{4}-\d{2}-\d{2}[T ]/.test(value.trim())) return "data e hora textual";
    return "texto não reconhecido";
  }
  return "tipo não reconhecido";
}

// Only fixed labels and aggregated numbers leave this report: no documents, IDs or field values.
export function buildSaleTripAudit(sales) {
  const groups = groupSalesByTrip(sales).map(({ id, name, summary }) => ({ id, name, ...summary }));
  const sources = { saleDate: 0, createdAt: 0, missing: 0, invalid: 0 };
  const formats = { saleDate: {}, createdAt: {} };
  for (const sale of sales) {
    const result = resolveSaleCalendar(sale);
    sources[result.source || (result.reason === "invalid-sale-date" ? "invalid" : "missing")]++;
    for (const field of ["saleDate", "createdAt"]) {
      const format = dateFormat(sale[field]);
      formats[field][format] = (formats[field][format] || 0) + 1;
    }
  }
  const totals = getSalesSummary(sales);
  const partition = groups.reduce((sum, group) => {
    for (const key of ["count", "sold", "received", "pending"]) sum[key] += group[key];
    return sum;
  }, { count: 0, sold: 0, received: 0, pending: 0 });
  const reconciled = ["count", "sold", "received", "pending"].every((key) =>
    Number.isFinite(totals[key]) && Math.abs(totals[key] - partition[key]) < 0.005);
  return { readOnly: true, totals, sources, formats, groups, reconciled };
}
