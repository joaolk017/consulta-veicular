const express = require("express");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const FALCON_TOKEN = process.env.FALCON_TOKEN;
// Aceita o nome usado na documentação da Desphub e mantém compatibilidade com a variável antiga.
const DESPHUB_API_KEY = process.env.DESPHUB_CHAVE || process.env.DESPHUB_API_KEY;
const CRLV_ADMIN_TOKEN = process.env.CRLV_ADMIN_TOKEN;
const CRLV_SP_SALE_PRICE = 59.90;

if (!FALCON_TOKEN) console.warn("FALCON_TOKEN não configurado.");
if (!DESPHUB_API_KEY) console.warn("DESPHUB_CHAVE/DESPHUB_API_KEY não configurada.");
if (!CRLV_ADMIN_TOKEN) console.warn("CRLV_ADMIN_TOKEN não configurado. A emissão de CRLV ficará bloqueada.");

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname), { dotfiles: "deny", index: "index.html" }));

const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_PREVIEWS_PER_HOUR = 3;
const CACHE_TTL_MS = 10 * 60 * 1000;
const rateStore = new Map();
const previewCache = new Map();
// Evita duas emissões simultâneas da mesma placa por duplo clique/requisições concorrentes.
const crlvInFlight = new Set();

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

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
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

function desphubRequest(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request("https://painel.desphub.com/api/v1/consultas", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DESPHUB_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    }, response => {
      const chunks = [];
      let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > 25_000_000) {
          request.destroy(new Error("Resposta da API Desphub excedeu o limite permitido."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
        resolve({ status: response.statusCode || 502, data });
      });
    });
    request.setTimeout(65000, () => request.destroy(new Error("Tempo limite da API Desphub excedido.")));
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function desphubPublicMessage(code, fallback) {
  const messages = {
    requisicao_invalida: "Os dados enviados para a emissão são inválidos.",
    nao_autenticado: "A integração de emissão está temporariamente indisponível.",
    saldo_insuficiente: "A emissão está temporariamente indisponível. Tente novamente mais tarde.",
    produto_desconhecido: "O serviço de CRLV-e está temporariamente indisponível.",
    produto_sem_preco: "O serviço de CRLV-e está temporariamente indisponível.",
    limite_excedido: "O limite de emissões foi atingido. Tente novamente mais tarde.",
    produto_indisponivel: "O serviço de CRLV-e está temporariamente indisponível.",
    provedor_indisponivel: "A base de emissão não respondeu. Nada deve ser repetido automaticamente."
  };
  return messages[code] || fallback || "Não foi possível processar a emissão do CRLV-e.";
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

app.get("/api/crlv/sp/info", (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json({
    produto: "crlv-sp",
    codigo: "1942",
    estado: "SP",
    preco: CRLV_SP_SALE_PRICE,
    currency: "BRL",
    pagamento_obrigatorio: true,
    finalidade_obrigatoria_no_site: true
  });
});

// CRLV-e SP / Desphub.
// Esta rota é deliberadamente protegida: a chave da Desphub e o CRLV_ADMIN_TOKEN nunca vão ao navegador.
// O fluxo público deve chamar esta rota somente a partir de um backend/webhook depois da confirmação do pagamento.
// IMPORTANTE: tem_dados=false também pode ser uma consulta cobrada. Não repetir automaticamente.
app.post("/api/crlv/sp", async (req, res) => {
  res.set("Cache-Control", "no-store");

  if (!DESPHUB_API_KEY) {
    return res.status(503).json({ error: "integracao_nao_configurada", mensagem: "Integração de CRLV-e não configurada no servidor." });
  }
  if (!CRLV_ADMIN_TOKEN) {
    return res.status(503).json({ error: "emissao_bloqueada", mensagem: "Emissão bloqueada até a configuração da autorização interna do servidor." });
  }

  const accessToken = req.get("X-CRLV-Access");
  if (!secureEqual(accessToken, CRLV_ADMIN_TOKEN)) {
    return res.status(401).json({ error: "nao_autorizado", mensagem: "Não autorizado." });
  }

  const plate = normalizePlate(req.body && req.body.placa);
  if (!validPlate(plate)) {
    return res.status(400).json({ error: "placa_invalida", mensagem: "Placa inválida. Use 7 caracteres, sem hífen." });
  }

  const finalidade = String((req.body && req.body.finalidade) || "").trim();
  if (finalidade.length < 10 || finalidade.length > 300) {
    return res.status(400).json({ error: "finalidade_invalida", mensagem: "Informe uma finalidade legítima para a emissão (10 a 300 caracteres)." });
  }

  if (!req.body || req.body.autorizado !== true) {
    return res.status(400).json({ error: "autorizacao_ausente", mensagem: "Confirme que a emissão foi solicitada pelo proprietário ou por pessoa devidamente autorizada." });
  }

  if (crlvInFlight.has(plate)) {
    return res.status(409).json({ error: "emissao_em_andamento", mensagem: "Já existe uma emissão desta placa em andamento. Aguarde a conclusão para evitar consulta duplicada." });
  }

  crlvInFlight.add(plate);
  try {
    const response = await desphubRequest({
      produto: "crlv-sp",
      parametros: { Placa: plate },
      finalidade
    });
    const data = response.data;

    if (response.status < 200 || response.status >= 300) {
      const codigo = data && data.erro && data.erro.codigo ? String(data.erro.codigo) : "erro_desphub";
      const original = data && data.erro && data.erro.mensagem ? String(data.erro.mensagem) : null;
      console.error("Desphub respondeu com erro", response.status, codigo);
      return res.status(response.status).json({
        error: codigo,
        mensagem: desphubPublicMessage(codigo, original),
        repetir_automaticamente: false
      });
    }

    if (!data || typeof data !== "object") {
      return res.status(502).json({ error: "resposta_invalida", mensagem: "Resposta inválida da fonte de emissão.", repetir_automaticamente: false });
    }

    // A documentação informa que 201 + tem_dados=false também representa consulta concluída/cobrada.
    if (data.tem_dados !== true) {
      return res.status(200).json({
        ok: false,
        tem_dados: false,
        cobrado: true,
        consulta_id: data.consulta_id || null,
        preco_cobrado: data.preco_cobrado ?? null,
        preco_venda: CRLV_SP_SALE_PRICE,
        currency: "BRL",
        repetir_automaticamente: false,
        mensagem: "A consulta foi concluída, mas a base não retornou o CRLV-e. Não repita automaticamente esta emissão."
      });
    }

    const crlv = data.secoes && data.secoes["VEICULAR.CRLV"];
    const pdfInfo = crlv && crlv.PDF_FILE;
    const pdfBase64 = pdfInfo && pdfInfo.FILE_BASE64;

    if (!pdfBase64 || typeof pdfBase64 !== "string") {
      return res.status(502).json({
        error: "documento_indisponivel",
        cobrado: true,
        consulta_id: data.consulta_id || null,
        preco_cobrado: data.preco_cobrado ?? null,
        preco_venda: CRLV_SP_SALE_PRICE,
        currency: "BRL",
        repetir_automaticamente: false,
        mensagem: "A consulta retornou dados, mas o PDF do CRLV-e não veio na resposta. Não repita automaticamente."
      });
    }

    const pdf = Buffer.from(pdfBase64, "base64");
    if (pdf.length < 100 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return res.status(502).json({
        error: "pdf_invalido",
        cobrado: true,
        consulta_id: data.consulta_id || null,
        preco_cobrado: data.preco_cobrado ?? null,
        preco_venda: CRLV_SP_SALE_PRICE,
        currency: "BRL",
        repetir_automaticamente: false,
        mensagem: "A fonte respondeu, mas o arquivo recebido não parece ser um PDF válido. Não repita automaticamente."
      });
    }

    if (data.consulta_id) res.set("X-Consulta-Id", String(data.consulta_id));
    if (data.preco_cobrado != null) res.set("X-Preco-Cobrado", String(data.preco_cobrado));
    res.set("X-Preco-Venda", CRLV_SP_SALE_PRICE.toFixed(2));
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `attachment; filename="CRLV-${plate}.pdf"`);
    return res.send(pdf);
  } catch (err) {
    console.error("Erro ao consultar CRLV-e na Desphub:", err.message);
    return res.status(502).json({
      error: "falha_comunicacao",
      mensagem: "Falha de comunicação com a fonte de emissão. Não houve repetição automática da consulta.",
      repetir_automaticamente: false
    });
  } finally {
    crlvInFlight.delete(plate);
  }
});

app.all(/^\/api\/consulta-completa(?:\/.*)?$/, (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.status(402).json({ error: "Consulta completa disponível somente após confirmação do pagamento." });
});

app.use("/api", (req, res) => res.status(404).json({ error: "Endpoint não encontrado." }));

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
