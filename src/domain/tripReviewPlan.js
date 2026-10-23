import { buildTripReview, getTripNumberYear, getTripOptionLabel } from "./tripIdentity.js";

const referenceFields = ["tripId", "tripName", "tripNumber", "tripYear", "year"];
const collectionNames = ["trips", "sales", "payables", "expenses"];

function originalFields(record, collection) {
  const fields = collection === "trips" ? ["name", ...referenceFields] : referenceFields;
  return Object.fromEntries(fields.map((field) => [
    field, Object.hasOwn(record, field)
      ? { present: true, value: record[field] }
      : { present: false },
  ]));
}

export function buildTripReviewPlan({ userId, collections, selection }) {
  if (!userId || userId.includes("/")) throw new Error("Entre na conta para exportar a revisão.");
  const loaded = Object.fromEntries(collectionNames.map((name) => [name, collections[name] || []]));
  const review = buildTripReview(loaded);
  const records = collectionNames.flatMap((collection) => loaded[collection].map((record) => ({
    path: `users/${userId}/${collection}/${record.id}`,
    collection,
    recordId: record.id,
    originalTripFields: originalFields(record, collection),
    issues: review.filter((row) => row.collection === collection && row.recordId === record.id)
      .map((row) => row.reason),
  })));
  const changes = [];
  if (selection) {
    if (!collectionNames.includes(selection.collection) || selection.collection === "trips") {
      throw new Error("A simulação associa registros; não altera nem une cadastros de viagem.");
    }
    const source = records.find((record) =>
      record.collection === selection.collection && record.recordId === selection.recordId);
    const destination = loaded.trips.find((trip) => trip.id === selection.destinationId);
    if (!source || !destination) throw new Error("Selecione o registro e o ID de uma viagem cadastrada.");
    const { tripNumber, tripYear } = getTripNumberYear(destination);
    if (![1, 2, 3, 4].includes(tripNumber) || !tripYear) {
      throw new Error("O destino precisa ter número de 1 a 4 e ano explícito no cadastro.");
    }
    changes.push({
      operationKey: `trip-link-v1:${source.collection}/${source.recordId}:${destination.id}`,
      path: source.path,
      expectedOriginalTripFields: source.originalTripFields,
      proposedTripFields: {
        tripId: destination.id,
        tripName: getTripOptionLabel(destination),
        tripNumber,
        tripYear,
      },
    });
  }
  return {
    schemaVersion: 1,
    mode: "simulation",
    executable: false,
    userId,
    scope: collectionNames,
    instructions: "Somente diagnóstico e backup dos campos de viagem carregados. Nenhuma gravação executada. Não é backup integral do banco. Antes de reparar, conferir campos originais, obter aprovação e registrar auditoria.",
    records,
    changes,
  };
}
