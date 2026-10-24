import { getTripNumberYear, getTripOptionLabel } from "./tripIdentity.js";

const fields = ["tripId", "tripName", "tripNumber", "tripYear", "year"];

export function snapshotTripFields(record) {
  return Object.fromEntries(fields.map((field) => [field, Object.hasOwn(record, field)
    ? { present: true, value: record[field] } : { present: false }]));
}

export function buildExpenseTripCorrection({ expense, expected, destination, userId }) {
  if (expense.id !== expected.id || expense.value !== expected.value ||
    JSON.stringify(snapshotTripFields(expense)) !== JSON.stringify(snapshotTripFields(expected))) {
    throw new Error("O lançamento mudou desde a prévia. Confira os dados e confirme novamente.");
  }
  const { tripNumber, tripYear } = getTripNumberYear(destination);
  if (!destination.id || ![1, 2, 3, 4].includes(tripNumber) || !tripYear) {
    throw new Error("Escolha um cadastro de destino com número e ano comprovados.");
  }
  if (expense.tripLinkHistory !== undefined && !Array.isArray(expense.tripLinkHistory)) {
    throw new Error("O histórico de vínculos está inválido. Revise o lançamento antes de corrigir.");
  }
  const next = { tripId: destination.id, tripName: getTripOptionLabel(destination), tripNumber, tripYear };
  if (Object.entries(next).every(([field, value]) => expense[field] === value)) {
    throw new Error("Este lançamento já possui o vínculo de destino. Nenhuma alteração é necessária.");
  }
  return {
    ...next,
    tripLinkHistory: [
      ...(expense.tripLinkHistory || []),
      { before: snapshotTripFields(expense), after: next, value: expense.value,
        userId, correctedAt: new Date().toISOString(), reason: "Correção de viagem confirmada pelo usuário" },
    ],
  };
}
