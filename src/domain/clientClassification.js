export const CLIENT_CLASSIFICATIONS = [
  { id: "unclassified", label: "Não classificado", symbol: "○", tone: "unclassified" },
  { id: "excellent", label: "⭐ Ótima", symbol: "⭐", tone: "excellent" },
  { id: "good", label: "👍 Boa", symbol: "👍", tone: "good" },
  { id: "regular", label: "➖ Regular", symbol: "➖", tone: "regular" },
  { id: "poor", label: "⚠️ Ruim", symbol: "⚠️", tone: "poor" },
  { id: "prego", label: "🚫 Prego", symbol: "🚫", tone: "prego" },
];

const classificationIds = new Set(
  CLIENT_CLASSIFICATIONS.map(({ id }) => id)
);

export function normalizeClientClassification(value) {
  return classificationIds.has(value) ? value : "unclassified";
}

export function resolveClientClassification(client, legacyPregoIds = new Set()) {
  if (Object.hasOwn(client || {}, "classification")) {
    return normalizeClientClassification(client.classification);
  }
  return legacyPregoIds.has(client?.id) ? "prego" : "unclassified";
}
