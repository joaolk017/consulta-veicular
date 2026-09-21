"use strict";

/**
 * Diagnóstico 360
 * Camada interpretativa do relatório pago.
 *
 * Regras:
 * - não consulta provedores;
 * - não altera pagamento/créditos;
 * - não transforma ausência de dado em "nada consta";
 * - somente sinaliza fatos presentes no JSON recebido.
 */

const RULES = Object.freeze([
  { id: "roubo_furto", label: "Roubo ou furto", keys: ["roubo", "furto", "rouboFurto", "situacaoRouboFurto"] },
  { id: "leilao", label: "Leilão", keys: ["leilao", "leiloes", "historicoLeilao"] },
  { id: "sinistro", label: "Sinistro", keys: ["sinistro", "sinistros", "historicoSinistro"] },
  { id: "gravame", label: "Gravame", keys: ["gravame", "gravames", "restricaoFinanceira"] },
  { id: "recall", label: "Recall", keys: ["recall", "recalls"] },
  { id: "restricoes", label: "Restrições", keys: ["restricao", "restricoes", "restricoesVeiculo"] },
  { id: "debitos", label: "Débitos", keys: ["debito", "debitos", "multas", "dividas"] }
]);

const NEGATIVE = /^(nao|não|n|false|0|sem|nada consta|nenhum|nenhuma|inexistente|regular)$/i;
const POSITIVE = /^(sim|s|true|1|consta|ativo|ativa|pendente|irregular)$/i;

function normalizeKey(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function findValues(input, wantedKeys, output = [], depth = 0) {
  if (depth > 8 || input == null) return output;
  if (Array.isArray(input)) {
    for (const item of input) findValues(item, wantedKeys, output, depth + 1);
    return output;
  }
  if (typeof input !== "object") return output;

  const wanted = new Set(wantedKeys.map(normalizeKey));
  for (const [key, value] of Object.entries(input)) {
    if (wanted.has(normalizeKey(key))) output.push(value);
    if (value && typeof value === "object") findValues(value, wantedKeys, output, depth + 1);
  }
  return output;
}

function classifyValue(value) {
  if (value == null || value === "") return "unknown";
  if (Array.isArray(value)) return value.length ? "attention" : "clear";
  if (typeof value === "boolean") return value ? "attention" : "clear";
  if (typeof value === "number") return value > 0 ? "attention" : "clear";
  if (typeof value === "object") {
    const entries = Object.values(value);
    if (!entries.length) return "clear";
    const statuses = entries.map(classifyValue);
    if (statuses.includes("attention")) return "attention";
    if (statuses.every(s => s === "clear")) return "clear";
    return "unknown";
  }

  const text = String(value).trim();
  if (NEGATIVE.test(text)) return "clear";
  if (POSITIVE.test(text)) return "attention";
  // Texto livre não é interpretado como alerta automaticamente.
  return "unknown";
}

function analyzeRule(data, rule) {
  const values = findValues(data, rule.keys);
  if (!values.length) {
    return { id: rule.id, label: rule.label, status: "not_verified", message: "Não verificado nas fontes desta consulta." };
  }

  const statuses = values.map(classifyValue);
  if (statuses.includes("attention")) {
    return { id: rule.id, label: rule.label, status: "attention", message: "Há informação no relatório que merece conferência antes da compra." };
  }
  if (statuses.every(s => s === "clear")) {
    return { id: rule.id, label: rule.label, status: "clear", message: "Nenhum alerta identificado nos dados retornados para este item." };
  }
  return { id: rule.id, label: rule.label, status: "not_verified", message: "A fonte retornou informação insuficiente para uma classificação segura." };
}

function diagnostico360(data) {
  const items = RULES.map(rule => analyzeRule(data || {}, rule));
  const attentionCount = items.filter(item => item.status === "attention").length;
  const verifiedCount = items.filter(item => item.status !== "not_verified").length;

  return {
    version: 1,
    title: "Diagnóstico 360",
    summary: attentionCount
      ? `Encontramos ${attentionCount} ${attentionCount === 1 ? "ponto" : "pontos"} que ${attentionCount === 1 ? "merece" : "merecem"} atenção antes da compra.`
      : verifiedCount
        ? "Nenhum alerta foi identificado entre os itens que puderam ser verificados."
        : "Não há dados suficientes para gerar um diagnóstico dos itens analisados.",
    attentionCount,
    verifiedCount,
    items,
    disclaimer: "O Diagnóstico 360 interpreta apenas os dados retornados pelas fontes da consulta. Item não verificado não significa ausência de ocorrência."
  };
}

module.exports = { diagnostico360 };
