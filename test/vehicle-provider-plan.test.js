"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { planVehicleProviders, validatePaidPlate, buildFonteDataRequest } = require("../vehicle-provider-plan");
test("Falcon fica restrita à prévia gratuita no plano", () => {
  assert.deepEqual(planVehicleProviders({plate:"ABC1D23"}), {preview:"falcon",paidBase:null,complements:[]});
});
test("não troca fluxo pago sem contrato FonteData validado", () => {
  const plan=planVehicleProviders({plate:"ABC1D23",paid:true});
  assert.equal(plan.paidBase,"current_legacy_flow");
  assert.equal(plan.complements.length,0);
});
test("planeja FonteData e complementos API Full sem rede", () => {
  const plan=planVehicleProviders({plate:"ABC1D23",paid:true,fonteDataContractVerified:true});
  assert.equal(plan.paidBase,"fontedata");
  assert.equal(plan.migrationStatus,"planned_only_no_network");
  assert.deepEqual(plan.complements.map(x=>x.service),["leilao","rouboFurto","debitos"]);
});

test("valida a placa antes de planejar consulta paga", () => {
  assert.equal(validatePaidPlate("abc-1d23"), "ABC1D23");
  assert.throws(() => validatePaidPlate("123"), /inválida/);
  assert.throws(() => planVehicleProviders({plate:"123",paid:true,fonteDataContractVerified:true}), /inválida/);
});

test("monta requisição FonteData sem executá-la", () => {
  const request=buildFonteDataRequest("abc-1d23","chave-ficticia");
  assert.equal(request.method,"GET");
  assert.equal(request.url,"https://app.dabradata.com/api/v1/consulta/consulta-veicular?placa=ABC1D23");
  assert.equal(request.headers["X-API-Key"],"chave-ficticia");
  assert.throws(() => buildFonteDataRequest("ABC1D23",""), /Chave/);
  assert.throws(() => buildFonteDataRequest("ABC1D23","abc\\r\\nInjected"), /Chave/);
});
