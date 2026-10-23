import { toDate } from "../utils/dates.js";

const belemDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Belem", year: "numeric", month: "2-digit", day: "2-digit",
});

export function saleDateInput(value) {
  if (typeof value === "string") {
    const text = value.trim();
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const brazilian = text.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/);
    if (iso || brazilian) {
      const [, year, month, day] = iso || [null, brazilian[3], brazilian[2], brazilian[1]];
      const normalized = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
      const parsed = new Date(`${normalized}T12:00:00Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalized
        ? normalized : "";
    }
    // An instant must specify its timezone; device-local strings are ambiguous.
    if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) return "";
    if (!saleDateInput(text.slice(0, 10))) return "";
  }
  if (!value || typeof value === "number" || typeof value === "boolean") return "";
  if (typeof value.timestampValue === "string") return saleDateInput(value.timestampValue);
  const date = toDate(value);
  if (!date) return "";
  const parts = Object.fromEntries(belemDate.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getSaleTrip(sale) {
  const date = saleDateInput(sale.saleDate);
  if (!date) return null;
  const tripYear = Number(date.slice(0, 4));
  const tripNumber = Math.ceil(Number(date.slice(5, 7)) / 3);
  return {
    id: `trip-${tripYear}-${tripNumber}`,
    tripNumber,
    tripYear,
    name: `${tripNumber}ª viagem de ${tripYear}`,
    saleDateBased: true,
  };
}

export function getSaleYearTrips(year) {
  if (!Number.isInteger(Number(year)) || Number(year) < 1 || Number(year) > 9999) {
    throw new Error("Selecione um ano válido.");
  }
  return [1, 4, 7, 10].map((month) => getSaleTrip({
    saleDate: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`,
  }));
}

export function isSaleRecord(record) {
  return Object.hasOwn(record, "saleDate") ||
    (Object.hasOwn(record, "clientId") && (
      Object.hasOwn(record, "total") || Array.isArray(record.items)
    ));
}
