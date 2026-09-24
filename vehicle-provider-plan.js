"use strict";
// Política planejada, sem rede e sem alteração no fluxo de produção.
// Falcon: somente prévia; FonteData: relatório pago; API Full: complementos opcionais.
const { planComplementaryQueries } = require("./apifull-integration");
function planVehicleProviders({ plate, chassis, paid = false, fonteDataContractVerified = false } = {}) {
  if (!paid) return { preview:"falcon", paidBase:null, complements:[] };
  if (!fonteDataContractVerified) return {
    preview:null, paidBase:"current_legacy_flow", complements:[],
    migrationStatus:"blocked_until_fontedata_contract_verified"
  };
  return {
    preview:null, paidBase:"fontedata",
    complements:planComplementaryQueries({placa:plate, chassi:chassis}),
    migrationStatus:"planned_only_no_network"
  };
}
module.exports = { planVehicleProviders };
