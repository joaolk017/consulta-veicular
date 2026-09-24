"use strict";
// API Full: preparação offline. Não realiza chamadas de rede nem consome saldo.
// Contrato extraído do catálogo público OpenAPI de 24/09/2026.
// A autenticação e o custo devem ser confirmados antes de habilitar consultas.
const SERVICES = Object.freeze({
  leilao: Object.freeze({ path: "/api/leilao", link: "leilao", input: "placa" }),
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
module.exports = { SERVICES, normalizePlate, normalizeChassis, buildRequest, classifyResponse, mergeReport };
