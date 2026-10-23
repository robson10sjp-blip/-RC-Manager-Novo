export function parseBrlAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  let normalized = String(value ?? "")
    .trim()
    .replace(/R\$/gi, "")
    .replace(/\s/g, "");
  if (!normalized) return Number.NaN;

  const commaCount = (normalized.match(/,/g) || []).length;
  const dotCount = (normalized.match(/\./g) || []).length;
  if (commaCount > 1) return Number.NaN;

  if (commaCount === 1) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (dotCount > 1) {
    normalized = normalized.replace(/\./g, "");
  } else if (dotCount === 1) {
    const decimalDigits = normalized.length - normalized.lastIndexOf(".") - 1;
    if (decimalDigits === 0 || decimalDigits > 2) {
      normalized = normalized.replace(".", "");
    }
  }

  if (/^\.\d{1,2}$/.test(normalized)) normalized = `0${normalized}`;
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return Number.NaN;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) / 100 : Number.NaN;
}

export function formatBrlAmount(value) {
  const amount = parseBrlAmount(value);
  if (!Number.isFinite(amount)) return "";
  return amount.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
