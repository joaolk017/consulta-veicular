"use strict";
// Testes locais da preparação API Full. Nunca enviam requisições nem consomem saldo.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const api = require("./apifull-integration");
const { buildUnifiedReport } = require("./unified-vehicle-report");

test("monta roubo/furto e débitos usando somente a placa", () => {
  const jobs = api.planComplementaryQueries({ placa: "ABC1D23" }, ["rouboFurto", "debitos"]);
  assert.deepEqual(jobs.map(x => x.status), ["ready_for_review", "ready_for_review"]);
  assert.deepEqual(jobs.map(x => x.request.path), ["/api/roubo-furto", "/api/debitos-veicular"]);
});
test("não solicita gravame sem chassi", () => {
  assert.equal(api.planComplementaryQueries({ placa: "ABC1D23" }, ["gravame"])[0].status, "pending_chassis");
});
test("rejeita erros legados com HTTP 200", () => {
  assert.equal(api.classifyResponse(200, { status: "erro", dados: {} }).ok, false);
  assert.equal(api.classifyResponse(200, { status: "sucesso", dados: { restricao: true } }).ok, true);
});
test("relatório inclui apenas complementos realmente consultados", () => {
  const base = { placa: "ABC1D23", marca: "EXEMPLO" };
  const results = { rouboFurto: { ok: true, data: { indicio: true } }, debitos: { ok: false } };
  const merged = api.mergeReport(base, results);
  assert.equal(merged.complementosApiFull.rouboFurto.source, "API Full");
  assert.equal(merged.complementosApiFull.debitos, undefined);
  assert.equal(base.complementosApiFull, undefined);
});
test("bloqueia chamadas pagas antes de autorização", () => {
  assert.throws(() => api.assertPaidCallsDisabled(), { code: "APIFULL_PAID_CALLS_LOCKED" });
});
