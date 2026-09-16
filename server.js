const express = require("express");
const path = require("path");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;
const FALCON_TOKEN = process.env.FALCON_TOKEN;

if (!FALCON_TOKEN) console.warn("FALCON_TOKEN não configurado.");

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname), { dotfiles: "deny", index: "index.html" }));

// Proteção simples da prévia: limita consultas por IP e evita repetir chamadas
// à Falcon para a mesma placa em um curto período. Em instâncias com múltiplos
// servidores, o ideal é migrar estes controles para Redis/banco compartilhado.
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_PREVIEWS_PER_HOUR = 3;
const CACHE_TTL_MS = 10 * 60 * 1000;
const rateStore = new Map();
const previewCache = new Map();

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function checkRateLimit(req) {
  const now = Date.now();
  const key = clientIp(req);
  let entry = rateStore.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateStore.set(key, entry);
  }
  if (entry.count >= MAX_PREVIEWS_PER_HOUR) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  entry.count += 1;
  return { allowed: true, remaining: MAX_PREVIEWS_PER_HOUR - entry.count };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateStore) if (now >= entry.resetAt) rateStore.delete(key);
  for (const [plate, entry] of previewCache) if (now >= entry.expiresAt) previewCache.delete(plate);
}, 10 * 60 * 1000).unref();

function normalizePlate(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function validPlate(plate) {
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate) || /^[A-Z]{3}[0-9]{4}$/.test(plate);
}

function falconRequest(url, token) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => {
        body += chunk;
        if (body.length > 2_000_000) request.destroy(new Error("Resposta da API excedeu o limite permitido."));
      });
      response.on("end", () => resolve({ status: response.statusCode || 502, body }));
    });
    request.setTimeout(15000, () => request.destroy(new Error("Tempo limite da API Falcon excedido.")));
    request.on("error", reject);
  });
}

async function getVehicle(plate) {
  const cached = previewCache.get(plate);
  if (cached && Date.now() < cached.expiresAt) return cached.vehicle;

  if (!FALCON_TOKEN) {
    const err = new Error("API não configurada no servidor.");
    err.status = 500;
    throw err;
  }

  const url = `https://beta.falcon-server.com.br/data-hub/private/v1/vehicles/${encodeURIComponent(plate)}/search`;
  const response = await falconRequest(url, FALCON_TOKEN);
  let data;
  try { data = JSON.parse(response.body); } catch { data = null; }

  if (response.status < 200 || response.status >= 300) {
    console.error("Falcon respondeu com erro HTTP", response.status);
    const err = new Error("Não foi possível realizar a consulta veicular.");
    err.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw err;
  }
  if (!data || typeof data !== "object") {
    const err = new Error("Resposta inválida da fonte veicular.");
    err.status = 502;
    throw err;
  }

  const vehicle = data.vehicle || data.data || data;
  previewCache.set(plate, { vehicle, expiresAt: Date.now() + CACHE_TTL_MS });
  return vehicle;
}

app.get("/api/consulta/:plate", async (req, res) => {
  const plate = normalizePlate(req.params.plate);
  if (!validPlate(plate)) return res.status(400).json({ error: "Placa inválida." });

  const limit = checkRateLimit(req);
  if (!limit.allowed) {
    res.set("Retry-After", String(limit.retryAfter));
    res.set("Cache-Control", "no-store");
    return res.status(429).json({ error: "Limite de consultas gratuitas atingido. Tente novamente mais tarde." });
  }

  res.set("Cache-Control", "no-store");
  res.set("X-RateLimit-Limit", String(MAX_PREVIEWS_PER_HOUR));
  res.set("X-RateLimit-Remaining", String(limit.remaining));

  try {
    const vehicle = await getVehicle(plate);
    return res.json({
      preview: true,
      vehicle: {
        plate,
        brand: vehicle.brand || vehicle.marca || null,
        model: vehicle.model || vehicle.modelo || null
      },
      lockedFields: ["year", "modelYear", "color", "city", "state", "fuel", "type", "details"],
      price: 18.90,
      currency: "BRL"
    });
  } catch (err) {
    console.error("Erro na consulta pública:", err.message);
    return res.status(err.status || 502).json({ error: err.message || "Falha ao realizar a consulta." });
  }
});

app.all(/^\/api\/consulta-completa(?:\/.*)?$/, (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.status(402).json({ error: "Consulta completa disponível somente após confirmação do pagamento." });
});

app.use("/api", (req, res) => res.status(404).json({ error: "Endpoint não encontrado." }));

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
