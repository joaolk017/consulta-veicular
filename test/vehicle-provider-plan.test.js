"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { planVehicleProviders } = require("../vehicle-provider-plan");
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
