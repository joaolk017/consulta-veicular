"use strict";

const https = require("https");
const ENDPOINT = "https://app.dabradata.com/api/v1/consulta/gravame-veicular";
const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 95000;

function normalizePlate(value) {
  const plate = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)) {
    throw Object.assign(new Error("Placa inválida."), { status: 400 });
  }
  return plate;
}

function summarizeGravame(payload) {
  const root = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const data = root.data && typeof root.data === "object" && !Array.isArray(root.data) ? root.data : root;
  const record = data.gravame && typeof data.gravame === "object" && !Array.isArray(data.gravame) ? data.gravame : data;
  const pick = (...keys) => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim().slice(0, 250);
      if (typeof value === "boolean") return value;
    }
    return null;
  };
  return {
    situacao: pick("situacao", "situacaoGravame", "status"),
    instituicao: pick("instituicaoFinanceira", "financeira", "credor"),
    tipo: pick("tipoGravame", "tipoRestricao", "tipo"),
    numeroContrato: pick("numeroContrato", "contrato"),
    observacao: "Campos dependem da disponibilidade do provedor. Ausência de dados não significa ausência de gravame."
  };
}

function fetchGravameDetalhado(plate, { apiKey, enabled = false, transport = https } = {}) {
  if (!enabled) return Promise.reject(Object.assign(new Error("Gravame detalhado desativado."), { status: 503 }));
  if (!apiKey || !String(apiKey).trim()) return Promise.reject(Object.assign(new Error("Chave FonteData não configurada."), { status: 503 }));
  const normalized = normalizePlate(plate);
  const url = new URL(ENDPOINT);
  url.searchParams.set("placa", normalized);
  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method: "POST",
      headers: { "X-API-Key": String(apiKey).trim(), Accept: "application/json" }
    }, res => {
      let size = 0;
      const chunks = [];
      res.on("data", chunk => {
        size += chunk.length;
        if (size > MAX_BYTES) return req.destroy(new Error("Resposta da FonteData excedeu o limite."));
        chunks.push(chunk);
      });
      res.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { return reject(Object.assign(new Error("Resposta inválida da FonteData."), { status: 502 })); }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(Object.assign(new Error("Consulta de gravame indisponível no provedor."), { status: 502, providerStatus: res.statusCode }));
        }
        resolve({ plate: normalized, provider: "fontedata", details: summarizeGravame(parsed) });
      });
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error("Tempo limite da consulta de gravame.")));
    req.on("error", err => reject(Object.assign(new Error("Falha na consulta de gravame: " + err.message), { status: 502 })));
    req.end();
  });
}

module.exports = { normalizePlate, summarizeGravame, fetchGravameDetalhado };
