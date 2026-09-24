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
  // Campos conforme a documentação pública da FonteData.
  const text = value => typeof value === "string" && value.trim() ? value.trim().slice(0, 250) : null;
  const obj = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const credor = obj(data.agenteFinanceiro);
  const contrato = obj(data.contrato);
  const restricao = obj(data.restricao);
  const veiculo = obj(data.veiculo);
  const statuses = new Set(["ATIVO", "BAIXADO", "SEM_GRAVAME", "INDETERMINADO"]);
  const situacao = statuses.has(data.situacao) ? data.situacao : "INDETERMINADO";
  return {
    temGravame: typeof data.temGravame === "boolean" ? data.temGravame : null,
    situacao,
    situacaoDescricao: text(data.situacaoDescricao),
    agenteFinanceiro: { nome: text(credor.nome), codigo: text(credor.codigo), documento: text(credor.documento) },
    restricao: { numero: text(restricao.numero), data: text(restricao.data), uf: text(restricao.uf) },
    contrato: { numero: text(contrato.numero), data: text(contrato.data), uf: text(contrato.uf) },
    veiculo: { placa: text(veiculo.placa), chassi: text(veiculo.chassi), marcaModelo: text(veiculo.marcaModelo) },
    observacao: "Dados fornecidos pelo provedor. Campos ausentes não comprovam ausência de gravame."
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
