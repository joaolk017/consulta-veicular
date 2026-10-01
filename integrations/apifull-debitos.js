"use strict";

// API Full adapter: disabled by default. Never call this from public routes
// until the provider's base URL, pdf values and response contract are verified.
const ENABLED = process.env.APIFULL_ENABLED === "true";
const BASE_URL = String(process.env.APIFULL_BASE_URL || "https://api.apifull.com.br").trim().replace(/\/+$/, "");
const TOKEN = String(process.env.APIFULL_TOKEN || "").trim();

function normalizePlate(value) {
  const plate = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)) {
    throw new Error("Placa inválida");
  }
  return plate;
}

async function fetchVehicleDebts(plate, { pdf } = {}) {
  if (!ENABLED) throw new Error("API Full desativada");
  if (!BASE_URL || !/^https:\/\/[^/]+$/i.test(BASE_URL) || !TOKEN) {
    throw new Error("Configuração da API Full incompleta");
  }
  // Provider docs show pdf as a string but do not document allowed values.
  // Require an explicitly verified value instead of guessing one.
  if (typeof pdf !== "string" || !pdf.trim()) {
    throw new Error("Valor de pdf ainda não confirmado na documentação");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(BASE_URL + "/api/debitos-veicular", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + TOKEN,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ link: "debitos-veicular", placa: normalizePlate(plate), pdf }),
      signal: controller.signal
    });
    const payload = await response.json();
    // Legacy endpoints may report errors inside an HTTP 200 response.
    // Success status values are unknown: fail closed until confirmed.
    if (!response.ok || !payload || typeof payload !== "object") {
      throw new Error("Falha na consulta de débitos");
    }
    throw new Error("Resposta recebida, mas status de sucesso ainda não homologado");
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { fetchVehicleDebts, normalizePlate };
