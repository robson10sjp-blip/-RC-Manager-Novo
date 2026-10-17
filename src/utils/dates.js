export function toDate(value) {
  if (!value) return null;

  let date;

  if (typeof value?.toDate === "function") {
    date = value.toDate();
  } else if (typeof value === "object" && Number.isFinite(value.seconds)) {
    date = new Date(
      value.seconds * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1e6)
    );
  } else if (typeof value === "object" && Number.isFinite(value._seconds)) {
    date = new Date(
      value._seconds * 1000 + Math.floor(Number(value._nanoseconds || 0) / 1e6)
    );
  } else if (
    typeof value === "object" &&
    typeof value.timestampValue === "string"
  ) {
    date = new Date(value.timestampValue);
  } else if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    const [year, month, day] = value.split("-").map(Number);
    date = new Date(year, month - 1, day, 12);
  } else if (
    typeof value === "string" &&
    /^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/.test(value.trim())
  ) {
    const [, dayText, monthText, yearText] = value.trim().match(
      /^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/
    );
    const day = Number(dayText);
    const month = Number(monthText);
    const year = Number(yearText);
    date = new Date(year, month - 1, day, 12);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
  } else {
    date = new Date(value);
  }

  return Number.isNaN(date.getTime()) ? null : date;
}

export function toDateInputValue(value) {
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return value;
  }

  const date = toDate(value);

  if (!date) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
