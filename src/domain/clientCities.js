export const CLIENT_CITIES = [
  "Floresta do Araguaia – PA",
  "Xinguara – PA",
  "Água Azul do Norte – PA",
  "Ourilândia do Norte – PA",
  "Tucumã – PA",
];

export function normalizeCityText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+(pa|para)$/i, "")
    .trim()
    .replace(/\s+/g, " ");
}

const cityAliases = new Map([
  ["agua azul norte", "agua azul do norte"],
  ["floresta araguaia", "floresta do araguaia"],
  ["ourilandia norte", "ourilandia do norte"],
]);

export function getClientCityKey(value) {
  const normalized = normalizeCityText(value);
  return cityAliases.get(normalized) || normalized;
}

export function getClientCityDisplay(value) {
  const key = getClientCityKey(value);
  return (
    CLIENT_CITIES.find(
      (city) => getClientCityKey(city) === key
    ) || String(value || "").trim()
  );
}

export function getCanonicalClientCity(value) {
  const key = getClientCityKey(value);
  return (
    CLIENT_CITIES.find(
      (city) => getClientCityKey(city) === key
    ) || ""
  );
}

export function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
