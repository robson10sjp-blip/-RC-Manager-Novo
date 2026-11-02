import assert from "node:assert/strict";
import test from "node:test";

import { formatProductName } from "./productName.js";

test("capitalizes every product name word and preserves TXC and GG", () => {
  assert.equal(formatProductName("camisa polo chinesa"), "Camisa Polo Chinesa");
  assert.equal(formatProductName("blusa poliamida"), "Blusa Poliamida");
  assert.equal(formatProductName("short masculino"), "Short Masculino");
  assert.equal(formatProductName("camisa txc gg"), "Camisa TXC GG");
  assert.equal(formatProductName("CAMISA POLO TXC GG"), "Camisa Polo TXC GG");
});

test("preserves accents, punctuation, and spacing while normalizing words", () => {
  assert.equal(formatProductName("  calça jeans, azul  "), "  Calça Jeans, Azul  ");
  assert.equal(formatProductName("blusa d'água"), "Blusa D'Água");
});
