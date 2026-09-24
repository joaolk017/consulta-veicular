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
// Reutiliza o contrato FonteData já presente no servidor; apenas monta a chamada.
function buildFonteDataRequest(plate, apiKey) {
  const normalized = validatePaidPlate(plate);
  const rawKey = String(apiKey || "");
  const key = rawKey.trim();
  if (!key || /[\r\n]/.test(rawKey)) throw new Error("Chave FonteData ausente ou inválida.");
  return {
    url:"https://app.dabradata.com/api/v1/consulta/consulta-veicular?placa=" + encodeURIComponent(normalized),
    method:"GET",
    headers:{"X-API-Key":key},
    timeout:120000
  };
}
function isFonteDataPaidApproved(env = {}) {
  return String(env.FONTEDATA_PAID_PRIMARY_ENABLED || "").trim() === "true"
    && String(env.FONTEDATA_PAID_PRIMARY_APPROVED || "").trim() === "confirmed";
}
function assertFonteDataSuccess(response) {
  const httpStatus = Number(response && response.status);
  const data = response && response.data;
  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300
      || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Resposta FonteData inválida ou indisponível.");
  }
  const bodyStatus = String(data.status || "").toLowerCase();
  if (data.error || data.errors || data.success === false
      || ["error", "erro", "failed", "failure", "unauthorized"].includes(bodyStatus)) {
    throw new Error("FonteData informou falha no corpo da resposta.");
  }
  const vehicle = data.veiculo && typeof data.veiculo === "object" && !Array.isArray(data.veiculo)
    ? data.veiculo : data;
  const fields = ["marca","modelo","chassi","renavam","anoModelo","anoFabricacao"];
  if (!fields.some(field => vehicle[field] !== null && vehicle[field] !== undefined && String(vehicle[field]).trim() !== "")) {
    throw new Error("FonteData não retornou dados suficientes para emitir relatório.");
  }
  return data;
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
module.exports = { planVehicleProviders, validatePaidPlate, buildFonteDataRequest, isFonteDataPaidApproved, assertFonteDataSuccess };
