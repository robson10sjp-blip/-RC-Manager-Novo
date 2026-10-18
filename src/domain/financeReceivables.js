import { toDate } from "../utils/dates.js";
import {
  getClientCityDisplay,
  getClientCityKey,
} from "./clientCities.js";

const money = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

function finiteAmount(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const amount = Number(value);
    if (Number.isFinite(amount)) return Math.max(amount, 0);
  }
  return 0;
}

export function getSalePendingAmount(sale) {
  const received = finiteAmount(sale.amountPaid, sale.received, sale.valorRecebido);
  const total = finiteAmount(
    sale.total,
    sale.totalValue,
    sale.amount,
    sale.valorTotal
  );
  const hasReportedTotal = [
    sale.total,
    sale.totalValue,
    sale.amount,
    sale.valorTotal,
  ].some(
    (value) =>
      value !== null &&
      value !== undefined &&
      value !== "" &&
      Number.isFinite(Number(value))
  );

  return money(
    hasReportedTotal
      ? Math.max(total - received, 0)
      : finiteAmount(sale.pendingAmount, sale.remainingBalance)
  );
}

function getSaleDueDate(sale) {
  return toDate(
    sale.dueDate ||
      sale.paymentDueDate ||
      sale.collectionDate ||
      sale.dataCobranca ||
      sale.dataVencimento
  );
}

export function summarizeReceivablesByDueDate(sales = [], today = new Date()) {
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const tomorrow = new Date(startOfToday);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWeek = new Date(startOfToday);
  nextWeek.setDate(nextWeek.getDate() + 8);
  const nextMonth = new Date(startOfToday);
  nextMonth.setDate(nextMonth.getDate() + 31);
  const periods = {
    overdue: { count: 0, amount: 0 },
    today: { count: 0, amount: 0 },
    next7Days: { count: 0, amount: 0 },
    next30Days: { count: 0, amount: 0 },
  };

  for (const sale of sales) {
    const pending = getSalePendingAmount(sale);
    const dueDate = getSaleDueDate(sale);
    if (pending <= 0 || !dueDate) continue;

    const dueDay = new Date(
      dueDate.getFullYear(),
      dueDate.getMonth(),
      dueDate.getDate()
    );
    const period =
      dueDay < startOfToday
        ? periods.overdue
        : dueDay < tomorrow
          ? periods.today
          : dueDay < nextWeek
            ? periods.next7Days
            : dueDay < nextMonth
              ? periods.next30Days
              : null;

    if (period) {
      period.count += 1;
      period.amount += pending;
    }
  }

  return Object.fromEntries(
    Object.entries(periods).map(([key, period]) => [
      key,
      { count: period.count, amount: money(period.amount) },
    ])
  );
}

export function groupReceivablesByCity(
  clients = [],
  sales = [],
  includeLegacyBalances = true
) {
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const salesByClient = new Map();
  for (const sale of sales) {
    if (!sale.clientId || !clientsById.has(sale.clientId)) continue;
    const clientSales = salesByClient.get(sale.clientId) || [];
    clientSales.push(sale);
    salesByClient.set(sale.clientId, clientSales);
  }

  const cities = new Map();
  for (const client of clients) {
    const clientSales = salesByClient.get(client.id) || [];
    const salesPending = money(
      clientSales.reduce((sum, sale) => sum + getSalePendingAmount(sale), 0)
    );
    const hasLegacySale = clientSales.some(
      (sale) => sale.balanceModel !== "per-sale"
    );
    const legacyBalance =
      includeLegacyBalances && !hasLegacySale
        ? finiteAmount(client.totalDebt)
        : 0;
    const totalPending = money(salesPending + legacyBalance);
    const received = money(
      clientSales.reduce(
        (sum, sale) =>
          sum +
          finiteAmount(sale.amountPaid, sale.received, sale.valorRecebido),
        0
      )
    );
    const rawCity = String(client.city || "").trim();
    const cityName = rawCity
      ? getClientCityDisplay(rawCity)
      : "Cidade não informada";
    const cityKey = getClientCityKey(rawCity) || "cidade nao informada";
    const city = cities.get(cityKey) || {
      city: cityName,
      clientsWithPending: 0,
      totalToReceive: 0,
      received: 0,
      clients: [],
    };

    if (totalPending > 0) {
      city.clientsWithPending += 1;
      city.clients.push({
        clientId: client.id,
        clientName: client.name || "Cliente não informado",
        legacyBalance,
        salesPending,
        totalPending,
        received,
        sales: clientSales.filter((sale) => getSalePendingAmount(sale) > 0),
      });
    }
    city.totalToReceive += totalPending;
    city.received += received;
    cities.set(cityKey, city);
  }

  return Array.from(cities.values())
    .filter((city) => city.totalToReceive > 0 || city.received > 0)
    .map((city) => ({
      ...city,
      totalToReceive: money(city.totalToReceive),
      received: money(city.received),
      clients: city.clients.sort(
        (first, second) => second.totalPending - first.totalPending
      ),
    }))
    .sort(
      (first, second) =>
        second.totalToReceive - first.totalToReceive ||
        first.city.localeCompare(second.city, "pt-BR")
    );
}
