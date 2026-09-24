"use strict";
// API Full: preparação offline. Não realiza chamadas de rede nem consome saldo.
// Contrato extraído do catálogo público OpenAPI de 24/09/2026.
// A autenticação e o custo devem ser confirmados antes de habilitar consultas.
const SERVICES = Object.freeze({
  leilao: Object.freeze({ path: "/api/leilao", link: "leilao", input: "placa" }),
  rouboFurto: Object.freeze({ path: "/api/roubo-furto", link: "roubo-furto", input: "placa" }),
  fotoLeilao: Object.freeze({ path: "/api/ic-foto-leilao", link: "ic-foto-leilao", input: "placa" }),
  debitos: Object.freeze({ path: "/api/debitos-veicular", link: "debitos-veicular", input: "placa" }),
  gravame: Object.freeze({ path: "/api/gravame", link: "gravame", input: "chassi" })
});
function normalizePlate(value) {
  const plate = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)) throw new Error("Placa inválida.");
  return plate;
}
function normalizeChassis(value) {
  const chassis = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(chassis)) throw new Error("Chassi completo de 17 caracteres necessário.");
  return chassis;
}
function buildRequest(service, identifiers = {}) {
  const item = SERVICES[service];
  if (!item) throw new Error("Serviço API Full não autorizado.");
  const value = item.input === "placa" ? normalizePlate(identifiers.placa) : normalizeChassis(identifiers.chassi);
  return { path: item.path, method: "POST", body: { link: item.link, [item.input]: value } };
}
// Monta cabeçalhos em memória; não envia requisições nem registra o token.
function buildAuthorizedRequest(service, identifiers = {}, token = "") {
  const secret = String(token || "").trim();
  if (!secret || /[\r\n]/.test(String(token || ""))) throw new Error("Token API Full ausente ou inválido.");
  const request = buildRequest(service, identifiers);
  return {
    ...request,
    headers: {
      Authorization: "Bearer " + secret,
      Accept: "application/json",
      "Content-Type": "application/json"
    }
  };
}
// Proteção: este módulo ainda não tem cliente de rede. Mesmo com a variável
// APIFULL_ENABLED=true, não autoriza consultas até confirmação contratual.
function assertPaidCallsDisabled() {
  const error = new Error("Consultas API Full bloqueadas até validar autenticação e preços.");
  error.code = "APIFULL_PAID_CALLS_LOCKED";
  throw error;
}
// Planejamento sem rede: selecionar serviços não os executa.
const DEFAULT_SERVICES = Object.freeze(["rouboFurto", "debitos"]);
function planComplementaryQueries(identifiers = {}, requested = DEFAULT_SERVICES) {
  if (!Array.isArray(requested)) throw new Error("Seleção de serviços inválida.");
  const unique = [...new Set(requested)];
  return unique.map(name => {
    const service = SERVICES[name];
    if (!service) throw new Error("Serviço API Full não autorizado.");
    if (service.input === "chassi" && !identifiers.chassi) {
      return { service:name, status:"pending_chassis", request:null };
    }
    return { service:name, status:"ready_for_review", request:buildRequest(name, identifiers) };
  });
}
// Endpoints legados podem devolver erro mesmo com HTTP 200.
function classifyResponse(httpStatus, payload) {
  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    return { ok:false, reason:"http_error" };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok:false, reason:"invalid_payload" };
  }
  const status = String(payload.status ?? "").trim().toLowerCase();
  const failure = /^(erro|error|falha|failed|false|0|sem saldo|saldo insuficiente|unauthorized|não autorizado|nao autorizado)$/.test(status)
    || /(?:saldo insuficiente|token inválido|token invalido|não autorizado|nao autorizado)/i.test(String(payload["API Full"] || ""));
  if (failure) return { ok:false, reason:"provider_error" };
  if (!status || !/^(sucesso|success|ok|true|1|200)$/.test(status)) {
    return { ok:false, reason:"unconfirmed_status" };
  }
  if (payload.dados == null || payload.dados === "") {
    return { ok:false, reason:"missing_data" };
  }
  return { ok:true, data:payload.dados };
}
// Só anexa evidências reais. Nunca interpreta ausência de dados como resultado negativo.
function mergeReport(baseReport, results = {}) {
  if (!baseReport || typeof baseReport !== "object" || Array.isArray(baseReport)) throw new Error("Relatório principal inválido.");
  const merged = { ...baseReport };
  const extra = {};
  for (const name of Object.keys(SERVICES)) {
    const entry = results[name];
    if (!entry || entry.ok !== true || entry.data == null) continue;
    extra[name] = { source: "API Full", status: "consultado", data: entry.data };
  }
  if (Object.keys(extra).length) merged.complementosApiFull = extra;
  return merged;
}
module.exports = { SERVICES, normalizePlate, normalizeChassis, buildRequest, buildAuthorizedRequest, assertPaidCallsDisabled, planComplementaryQueries, classifyResponse, mergeReport };
