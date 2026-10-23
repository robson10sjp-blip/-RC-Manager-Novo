import { toDate } from "../utils/dates.js";
import { getClientCityDisplay } from "./clientCities.js";
import { getSalePendingAmount } from "./financeReceivables.js";
import { buildTripOptions, filterRecordsByTrip } from "./tripIdentity.js";

const money = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_RELIABLE_YEAR = 2000;
const MAX_RELIABLE_YEAR = 2100;

export const NO_DUE_DATE_LABEL = "Vencimento não informado";
export const ESTIMATED_DUE_LABEL = "Vencimento estimado — 90 dias";
export const ESTIMATED_DUE_DAYS = 90;
export const NO_CITY_LABEL = "Cidade não informada";

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Only a valid date inside a sane range counts; anything else is never invented.
export function getReliableDueDate(sale) {
  const date = toDate(
    sale.dueDate ||
      sale.paymentDueDate ||
      sale.collectionDate ||
      sale.dataCobranca ||
      sale.dataVencimento
  );
  if (!date) return null;
  const year = date.getFullYear();
  if (year < MIN_RELIABLE_YEAR || year > MAX_RELIABLE_YEAR) return null;
  return startOfDay(date);
}

function hasRegisteredDueValue(sale) {
  return [
    sale.dueDate,
    sale.paymentDueDate,
    sale.collectionDate,
    sale.dataCobranca,
    sale.dataVencimento,
  ].some((value) => value !== null && value !== undefined && value !== "");
}

// Same rule the old receipt used (prepareSaleReceipt): legacy sales on credit
// with no stored due date get saleDate + 90 days. Query-only; never saved.
// createdAt is not used: it is a record timestamp, not the original sale date.
export function resolveDueDate(sale) {
  const registered = getReliableDueDate(sale);
  if (registered) return { date: registered, source: "registered" };
  if (hasRegisteredDueValue(sale)) return { date: null, source: null };

  if (sale.balanceModel === "per-sale" || sale.paymentMethod !== "prazo") {
    return { date: null, source: null };
  }
  const saleDate = toDate(sale.saleDate);
  const year = saleDate?.getFullYear();
  if (!saleDate || year < MIN_RELIABLE_YEAR || year > MAX_RELIABLE_YEAR) {
    return { date: null, source: null };
  }
  const estimated = startOfDay(saleDate);
  estimated.setDate(estimated.getDate() + ESTIMATED_DUE_DAYS);
  return { date: estimated, source: "estimated" };
}

function dayDifference(later, earlier) {
  return Math.round(
    (Date.UTC(later.getFullYear(), later.getMonth(), later.getDate()) -
      Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate())) /
      DAY_MS
  );
}

function emptyGroup() {
  return { items: [], count: 0, total: 0 };
}

function finishGroup(group) {
  return { ...group, total: money(group.total), count: group.items.length };
}

/**
 * Builds the read-only collections report. Pending balance is total minus
 * received, so settled sales and partial payments are handled correctly, and
 * a sale is overdue only when its reliable due date is before today.
 *
 * @param {object} options
 * @param {Array} options.clients
 * @param {Array} options.sales
 * @param {Date} options.today
 * @param {number|string|null} options.trip 1, 2, 3, 4 or "all"
 */
export function buildCollectionsReport({
  clients = [],
  sales = [],
  today = new Date(),
  trip = "all",
} = {}) {
  const day = startOfDay(today);
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const isAll = trip === "all" || trip === null || trip === undefined;
  const options = buildTripOptions({ sales, salesOnly: true });
  const candidates = options.filter((option) => option.tripNumber === Number(trip));
  if (/^[1-4]$/.test(String(trip)) && candidates.length > 1) {
    throw new Error("Informe o ano da viagem para consultar cobranças.");
  }
  const scope = /^[1-4]$/.test(String(trip)) ? candidates[0] || { id: "no-sales" } : trip;
  const scopedSales = filterRecordsByTrip(sales, scope, options);

  const groups = {
    overdue: emptyGroup(),
    today: emptyGroup(),
    upcoming: emptyGroup(),
    noDueDate: emptyGroup(),
  };

  for (const sale of scopedSales) {
    const pending = getSalePendingAmount(sale);
    if (pending <= 0) continue;

    const client = clientsById.get(sale.clientId);
    const rawCity = String(client?.city || "").trim();
    const { date: dueDate, source: dueSource } = resolveDueDate(sale);
    const item = {
      saleId: sale.id || "",
      clientName: client?.name || sale.clientName || "Cliente não informado",
      city: rawCity ? getClientCityDisplay(rawCity) : NO_CITY_LABEL,
      pending,
      dueDate,
      dueLabel: dueDate ? dueDate.toLocaleDateString("pt-BR") : NO_DUE_DATE_LABEL,
      dueSource,
      dueNote: dueSource === "estimated" ? ESTIMATED_DUE_LABEL : "",
      daysLate: 0,
      daysUntil: 0,
      legacy: false,
    };

    let group;
    if (!dueDate) {
      group = groups.noDueDate;
    } else {
      const diff = dayDifference(day, dueDate);
      if (diff > 0) {
        item.daysLate = diff;
        group = groups.overdue;
      } else if (diff === 0) {
        group = groups.today;
      } else {
        item.daysUntil = -diff;
        group = groups.upcoming;
      }
    }
    group.items.push(item);
    group.total += pending;
  }

  // Old client-level balances have neither a sale nor a due date.
  if (isAll) {
    const clientsWithSales = new Set(
      sales
        .filter((sale) => sale.balanceModel !== "per-sale")
        .map((sale) => sale.clientId)
    );
    for (const client of clients) {
      const legacy = money(Math.max(Number(client.totalDebt) || 0, 0));
      if (legacy <= 0 || clientsWithSales.has(client.id)) continue;
      const rawCity = String(client.city || "").trim();
      groups.noDueDate.items.push({
        saleId: "",
        clientName: client.name || "Cliente não informado",
        city: rawCity ? getClientCityDisplay(rawCity) : NO_CITY_LABEL,
        pending: legacy,
        dueDate: null,
        dueLabel: NO_DUE_DATE_LABEL,
        dueSource: null,
        dueNote: "",
        daysLate: 0,
        daysUntil: 0,
        legacy: true,
      });
      groups.noDueDate.total += legacy;
    }
  }

  const byAmount = (first, second) =>
    second.pending - first.pending ||
    first.clientName.localeCompare(second.clientName, "pt-BR");
  groups.overdue.items.sort(
    (first, second) => second.daysLate - first.daysLate || byAmount(first, second)
  );
  groups.today.items.sort(byAmount);
  groups.upcoming.items.sort(
    (first, second) => first.daysUntil - second.daysUntil || byAmount(first, second)
  );
  groups.noDueDate.items.sort(byAmount);

  return {
    trip: isAll ? "all" : Number(trip),
    overdue: finishGroup(groups.overdue),
    today: finishGroup(groups.today),
    upcoming: finishGroup(groups.upcoming),
    noDueDate: finishGroup(groups.noDueDate),
  };
}
