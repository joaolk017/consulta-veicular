"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePlate, summarizeGravame, fetchGravameDetalhado } = require("../gravame-detalhado");

test("aceita placa Mercosul e tradicional", () => {
  assert.equal(normalizePlate("abc1d23"), "ABC1D23");
  assert.equal(normalizePlate("ABC-1234"), "ABC1234");
});
test("rejeita placa inválida", () => assert.throws(() => normalizePlate("123"), /Placa inválida/));
test("não infere ausência de gravame quando campos faltam", () => {
  const data = summarizeGravame({});
  assert.equal(data.situacao, null);
  assert.equal(data.instituicao, null);
  assert.match(data.observacao, /não significa ausência/);
});
test("não executa API com módulo desativado", async () => {
  await assert.rejects(fetchGravameDetalhado("ABC1D23", { apiKey: "test" }), /desativado/);
});
test("não executa API sem chave", async () => {
  await assert.rejects(fetchGravameDetalhado("ABC1D23", { enabled: true }), /não configurada/);
});
