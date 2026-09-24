"use strict";
// Unifica dados já obtidos dos provedores; não executa consultas nem altera cobrança.
const SERVICES = Object.freeze(["debitos","gravame","rouboFurto","historicoRouboFurto","leilao","fotoLeilao"]);
function valid(value) { return value !== null && value !== undefined && value !== ""; }
function mergeReports(fonteData, apiFull = {}, options = {}) {
  if (!fonteData || typeof fonteData !== "object" || Array.isArray(fonteData)) throw new TypeError("Relatório FonteData inválido");
  const report = JSON.parse(JSON.stringify(fonteData));
  const sources = { fonteData: "ok", apiFull: {} };
  const complementary = {};
  const conflicts = [];
  for (const service of SERVICES) {
    const result = apiFull[service];
    if (!result) { sources.apiFull[service] = "nao_consultado"; continue; }
    if (result.error || result.status === "erro") {
      sources.apiFull[service] = "indisponivel";
      continue;
    }
    if (result.status && !["ok","sucesso","success"].includes(String(result.status).toLowerCase())) {
      sources.apiFull[service] = "nao_confirmado";
      continue;
    }
    const data = result.dados ?? result.data ?? result.resultado;
    if (!valid(data) || (typeof data === "object" && !Array.isArray(data) && !Object.keys(data).length)) {
      sources.apiFull[service] = "sem_dados";
      continue;
    }
    sources.apiFull[service] = "ok";
    complementary[service] = data;
    const baseline = options.baselineByService?.[service];
    if (valid(baseline) && JSON.stringify(baseline) !== JSON.stringify(data)) {
      conflicts.push({ campo: service, fonteData: baseline, apiFull: data });
    }
  }
  report.complementosApiFull = complementary;
  report.fontes = sources;
  report.divergencias = conflicts;
  // Só indicar múltiplas fontes quando algum serviço API Full efetivamente retornou dados.
  report.relatorioUnificado = Object.values(sources.apiFull).some(status => status === "ok");
  return report;
}
module.exports = { mergeReports, SERVICES };
