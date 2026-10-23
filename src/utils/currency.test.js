import assert from "node:assert/strict";
import test from "node:test";
import { formatBrlAmount, parseBrlAmount } from "./currency.js";

test("parses Brazilian and decimal monetary input", () => {
  assert.equal(parseBrlAmount("R$ 8.900,00"), 8900);
  assert.equal(parseBrlAmount("8,90"), 8.9);
  assert.equal(parseBrlAmount("8900.00"), 8900);
  assert.equal(parseBrlAmount("8.900"), 8900);
  assert.equal(parseBrlAmount("8900"), 8900);
  assert.equal(parseBrlAmount(",50"), 0.5);
  assert.equal(parseBrlAmount(".50"), 0.5);
});

test("formats parsed values as Brazilian reais", () => {
  assert.equal(formatBrlAmount("8900"), "R$\u00a08.900,00");
  assert.equal(formatBrlAmount("8.900,00"), "R$\u00a08.900,00");
});

test("rejects malformed monetary values", () => {
  assert.equal(Number.isNaN(parseBrlAmount("8,90,00")), true);
  assert.equal(Number.isNaN(parseBrlAmount("R$ 8 reais")), true);
});
