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
module.exports = { SERVICES, normalizePlate, normalizeChassis, buildRequest, mergeReport };
