"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizePlate, fetchVehicleDebts } = require("../integrations/apifull-debitos");

test("normaliza placa antiga e Mercosul", () => {
  assert.equal(normalizePlate("abc-1234"), "ABC1234");
  assert.equal(normalizePlate("abc1d23"), "ABC1D23");
});
test("rejeita placa inválida", () => {
  assert.throws(() => normalizePlate("123"), /Placa inválida/);
  assert.throws(() => normalizePlate("ABC1D2!"), /Placa inválida/);
});
test("não consulta API quando desativada", async () => {
  assert.equal(process.env.APIFULL_ENABLED === "true", false, "Execute testes sem habilitar APIFULL_ENABLED");
  await assert.rejects(fetchVehicleDebts("ABC1234"), /API Full desativada/);
});
