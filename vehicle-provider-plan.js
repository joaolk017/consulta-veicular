"use strict";
// Política planejada, sem rede e sem alteração no fluxo de produção.
// Falcon: somente prévia; FonteData: relatório pago; API Full: complementos opcionais.
const { planComplementaryQueries } = require("./apifull-integration");
// Pré-validação de placa para o futuro fluxo pago, sem acessar provedores.
function validatePaidPlate(plate) {
  const value = String(plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(value)) throw new Error("Placa inválida.");
  return value;
}
function planVehicleProviders({ plate, chassis, paid = false, fonteDataContractVerified = false } = {}) {
  if (!paid) return { preview:"falcon", paidBase:null, complements:[] };
  if (!fonteDataContractVerified) return {
    preview:null, paidBase:"current_legacy_flow", complements:[],
    migrationStatus:"blocked_until_fontedata_contract_verified"
  };
  return {
    preview:null, paidBase:"fontedata", validatedPlate:validatePaidPlate(plate),
    complements:planComplementaryQueries({placa:plate, chassi:chassis}),
    migrationStatus:"planned_only_no_network"
  };
}
module.exports = { planVehicleProviders, validatePaidPlate };
