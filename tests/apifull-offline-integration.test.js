"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const api = require("../apifull-integration");
const providers = require("../vehicle-provider-plan");

test("Falcon stays preview-only without paid queries", () => {
  assert.deepEqual(providers.planVehicleProviders({ plate: "ABC1D23", paid: false }), {
    preview: "falcon", paidBase: null, complements: []
  });
});
test("Paid migration remains gated until FonteData contract verification", () => {
  const plan = providers.planVehicleProviders({ plate: "ABC1D23", paid: true });
  assert.equal(plan.paidBase, "current_legacy_flow");
  assert.equal(plan.complements.length, 0);
});
test("Offline provider plan includes FonteData and API Full complements", () => {
  const plan = providers.planVehicleProviders({
    plate: "ABC1D23", paid: true, fonteDataContractVerified: true
  });
  assert.equal(plan.paidBase, "fontedata");
  assert.deepEqual(plan.complements.map(x => x.service), ["leilao", "rouboFurto", "debitos"]);
  assert.ok(plan.complements.every(x => x.status === "ready_for_review"));
  assert.equal(plan.migrationStatus, "planned_only_no_network");
});
test("Chassis-dependent gravame is deferred when chassis is absent", () => {
  const plan = api.planComplementaryQueries({ placa: "ABC1D23" }, ["gravame"]);
  assert.equal(plan[0].status, "pending_chassis");
  assert.equal(plan[0].request, null);
});
test("API Full HTTP 200 provider errors are not accepted", () => {
  assert.equal(api.classifyResponse(200, { status: "erro", dados: { leilao: false } }).ok, false);
  assert.equal(api.classifyResponse(200, { status: "sucesso", dados: { leilao: false } }).ok, true);
});
test("Merge preserves FonteData base and only includes confirmed API Full evidence", () => {
  const base = { placa: "ABC1D23", marca: "Exemplo", fipe: 45000 };
  const merged = api.mergeReport(base, {
    leilao: { ok: true, data: { registro: "EXEMPLO FICTICIO" } },
    debitos: { ok: false, data: { valor: 0 } }
  });
  assert.deepEqual(base, { placa: "ABC1D23", marca: "Exemplo", fipe: 45000 });
  assert.equal(merged.complementosApiFull.leilao.source, "API Full");
  assert.equal(merged.complementosApiFull.debitos, undefined);
});
test("Paid API Full network calls remain locked", () => {
  assert.throws(() => api.assertPaidCallsDisabled(), { code: "APIFULL_PAID_CALLS_LOCKED" });
});
