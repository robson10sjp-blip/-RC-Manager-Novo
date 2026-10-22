import test from "node:test";
import assert from "node:assert/strict";
import {
  displayCpf,
  displayPhone,
  formatCpf,
  formatPhone,
  isValidCpf,
  isValidPhone,
  normalizePersonName,
} from "./clientFields.js";

test("formata CPF progressivamente e limita a 11 dígitos", () => {
  assert.equal(formatCpf("1234"), "123.4");
  assert.equal(formatCpf("123456789"), "123.456.789");
  assert.equal(formatCpf("12345678909999"), "123.456.789-09");
  assert.equal(formatCpf("abc123"), "123");
});

test("valida CPF", () => {
  assert.equal(isValidCpf("529.982.247-25"), true);
  assert.equal(isValidCpf("52998224725"), true);
  assert.equal(isValidCpf("111.111.111-11"), false);
  assert.equal(isValidCpf("529.982.247-24"), false);
  assert.equal(isValidCpf("123"), false);
});

test("formata celular e fixo", () => {
  assert.equal(formatPhone("1"), "(1");
  assert.equal(formatPhone("19"), "(19");
  assert.equal(formatPhone("199"), "(19) 9");
  assert.equal(formatPhone("1933334444"), "(19) 3333-4444");
  assert.equal(formatPhone("19999998888"), "(19) 99999-8888");
  assert.equal(formatPhone("1999999888877"), "(19) 99999-8888");
  assert.equal(formatPhone(""), "");
});

test("exibe dados antigos sem pontuação e preserva valores fora do padrão", () => {
  assert.equal(displayCpf("52998224725"), "529.982.247-25");
  assert.equal(displayCpf("abc"), "abc");
  assert.equal(displayPhone("19999998888"), "(19) 99999-8888");
  assert.equal(displayPhone("+55 19 99999-8888"), "+55 19 99999-8888");
});

test("valida tamanho do telefone", () => {
  assert.equal(isValidPhone(""), true);
  assert.equal(isValidPhone("(19) 3333-4444"), true);
  assert.equal(isValidPhone("(19) 3333"), false);
});

test("normaliza nomes sem remover acentos nem alterar partículas", () => {
  assert.equal(
    normalizePersonName("  maria   da   conceição  "),
    "Maria da Conceição"
  );
  assert.equal(normalizePersonName("ana d'ávila"), "Ana D'Ávila");
  assert.equal(normalizePersonName("JOÃO DOS SANTOS"), "João dos Santos");
});
