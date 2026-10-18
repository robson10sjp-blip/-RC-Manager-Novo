import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_CITIES,
  getCanonicalClientCity,
  getClientCityDisplay,
  getClientCityKey,
  normalizeSearchText,
} from "./clientCities.js";

test("exposes exactly the five selectable client cities", () => {
  assert.deepEqual(CLIENT_CITIES, [
    "Floresta do Araguaia – PA",
    "Xinguara – PA",
    "Água Azul do Norte – PA",
    "Ourilândia do Norte – PA",
    "Tucumã – PA",
  ]);
});

test("normalizes known city spelling, accents, punctuation and state suffixes for display", () => {
  assert.equal(getClientCityDisplay(" floresta DO araguaia-pa "), "Floresta do Araguaia – PA");
  assert.equal(getClientCityDisplay("Floresta Araguaia"), "Floresta do Araguaia – PA");
  assert.equal(getClientCityDisplay("Xinguará / Pará"), "Xinguara – PA");
  assert.equal(getClientCityDisplay("Agua Azul Norte"), "Água Azul do Norte – PA");
  assert.equal(getClientCityDisplay("OURILANDIA do NORTE, PA"), "Ourilândia do Norte – PA");
  assert.equal(getClientCityDisplay("Ourilandia Norte"), "Ourilândia do Norte – PA");
  assert.equal(getClientCityDisplay("Tucuma"), "Tucumã – PA");
  assert.equal(getCanonicalClientCity("Agua Azul do Norte - PA"), "Água Azul do Norte – PA");
});

test("creates identical comparison keys for legacy city spelling variants", () => {
  assert.equal(
    getClientCityKey("Água Azul do Norte - PA"),
    getClientCityKey("agua azul norte/para")
  );
  assert.equal(getClientCityKey("Tucumã"), getClientCityKey("TUCUMA – PA"));
  assert.equal(normalizeSearchText("Agua Azul do Norte - PA"), "agua azul do norte pa");
});

test("preserves unrecognized legacy city text instead of assigning it to another city", () => {
  assert.equal(getCanonicalClientCity("Belém - PA"), "");
  assert.equal(getClientCityDisplay(" Belém / PA "), "Belém / PA");
});
