"use strict";
// Apresentação offline do relatório único. Não executa consultas ou cobra créditos.
const { mergeReport, SERVICES } = require("./apifull-integration");
const LABELS = Object.freeze({
  leilao:"Histórico de leilão", rouboFurto:"Roubo e furto",
  fotoLeilao:"Fotos de leilão", debitos:"Débitos veiculares", gravame:"Gravame"
});
function buildUnifiedReport(fonteDataReport, apiFullResults = {}) {
  if (!fonteDataReport || typeof fonteDataReport !== "object" || Array.isArray(fonteDataReport)) {
    throw new Error("Relatório FonteData inválido.");
  }
  const combined = mergeReport(fonteDataReport, apiFullResults);
  const sections = ["rouboFurto", "debitos"].map(key => {
    const result = apiFullResults[key];
    const confirmed = result && result.ok === true && result.data != null;
    return confirmed
      ? { id:key, title:LABELS[key], source:"API Full", status:"consultado", data:result.data }
      : { id:key, title:LABELS[key], source:"API Full", status:"nao_consultado", data:null };
  });
  return {
    provider:"FonteData",
    status:"relatorio_unificado",
    baseReport:fonteDataReport,
    sections,
    combined
  };
}
module.exports = { buildUnifiedReport };
