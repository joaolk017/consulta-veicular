"use strict";
// Planejamento seguro: não chama API Full, não consome créditos e não altera pagamento.
const { prepareRequest, ENDPOINTS } = require("./apifull-adapter");
const { mergeReports } = require("./unified-report");
const DEFAULT_SERVICES = Object.freeze(["debitos","rouboFurto","leilao"]);
function buildPlan(vehicle, services = DEFAULT_SERVICES) {
  if (!vehicle || typeof vehicle !== "object") throw new TypeError("Veículo inválido");
  const normalized = {placa:vehicle.plate || vehicle.placa, chassi:vehicle.rawChassis || vehicle.chassi};
  const plan = {};
  for (const service of services) {
    if (!Object.hasOwn(ENDPOINTS, service)) throw new Error("Serviço desconhecido");
    try {
      const request = prepareRequest(service, normalized);
      // Não retornar chassi completo nem outros identificadores no plano exposto.
      plan[service] = {eligible:true, method:request.method, path:request.path};
    } catch (error) {
      plan[service] = {eligible:false, reason:service === "gravame" ? "chassi_completo_necessario" : "placa_invalida"};
    }
  }
  return {enabled:false, mode:"dry_run", callsExecuted:0, plan};
}
function previewUnifiedReport(fonteData, apiFullFixture = {}) {
  return mergeReports(fonteData, apiFullFixture);
}
module.exports = {buildPlan,previewUnifiedReport,DEFAULT_SERVICES};
