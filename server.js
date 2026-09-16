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

// Mistic Pay (cash-in PIX).
const MISTIC_PAY_URL = String(process.env.MISTIC_PAY_URL || "https://api.misticpay.com/api").replace(/\/+$/, "");
const MISTIC_CLIENT_ID = process.env.MISTIC_CLIENT_ID;
const MISTIC_CLIENT_SECRET = process.env.MISTIC_CLIENT_SECRET;
const MISTIC_AUTH_HEADER = process.env.MISTIC_AUTH_HEADER;
const MISTIC_WEBHOOK_URL = process.env.MISTIC_WEBHOOK_URL;
const PAYMENT_SIGNING_SECRET = process.env.PAYMENT_SIGNING_SECRET;

const CONSULTA_SALE_PRICE = 18.90;
const CRLV_SP_SALE_PRICE = 59.90;
const PAYMENT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

if (!FALCON_TOKEN) console.warn("FALCON_TOKEN não configurado.");
if (!DESPHUB_API_KEY) console.warn("DESPHUB_CHAVE/DESPHUB_API_KEY não configurada.");
if (!CRLV_ADMIN_TOKEN) console.warn("CRLV_ADMIN_TOKEN não configurado. A emissão de CRLV ficará bloqueada.");
if (!MISTIC_CLIENT_ID && !MISTIC_AUTH_HEADER) console.warn("MISTIC_CLIENT_ID/MISTIC_AUTH_HEADER não configurado.");
if (!MISTIC_CLIENT_SECRET && !MISTIC_AUTH_HEADER) console.warn("MISTIC_CLIENT_SECRET/MISTIC_AUTH_HEADER não configurado.");
if (!PAYMENT_SIGNING_SECRET) console.warn("PAYMENT_SIGNING_SECRET não configurado. O checkout PIX ficará bloqueado.");

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname), { dotfiles: "deny", index: "index.html" }));

const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_PREVIEWS_PER_HOUR = 3;
const MAX_PAYMENT_CREATES_PER_HOUR = 12;
const CACHE_TTL_MS = 10 * 60 * 1000;
const rateStore = new Map();
const paymentRateStore = new Map();
const previewCache = new Map();
const confirmedPaymentCache = new Map();
// Evita duas emissões simultâneas da mesma placa por duplo clique/requisições concorrentes.
const crlvInFlight = new Set();

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function useRateLimit(store, key, max) {
  const now = Date.now();
  let entry = store.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    store.set(key, entry);
  }
  if (entry.count >= max) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  entry.count += 1;
  return { allowed: true, remaining: max - entry.count };
}

function checkRateLimit(req) {
  return useRateLimit(rateStore, clientIp(req), MAX_PREVIEWS_PER_HOUR);
}

function checkPaymentRateLimit(req) {
  return useRateLimit(paymentRateStore, clientIp(req), MAX_PAYMENT_CREATES_PER_HOUR);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateStore) if (now >= entry.resetAt) rateStore.delete(key);
  for (const [key, entry] of paymentRateStore) if (now >= entry.resetAt) paymentRateStore.delete(key);
  for (const [plate, entry] of previewCache) if (now >= entry.expiresAt) previewCache.delete(plate);
  for (const [tx, entry] of confirmedPaymentCache) if (now >= entry.expiresAt) confirmedPaymentCache.delete(tx);
}, 10 * 60 * 1000).unref();

function normalizePlate(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function validPlate(plate) {
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate) || /^[A-Z]{3}[0-9]{4}$/.test(plate);
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function validCpf(value) {
  const cpf = digits(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let t = 9; t < 11; t += 1) {
    let sum = 0;
    for (let i = 0; i < t; i += 1) sum += Number(cpf[i]) * ((t + 1) - i);
    const digit = ((sum * 10) % 11) % 10;
    if (digit !== Number(cpf[t])) return false;
  }
  return true;
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

function misticAuthorization() {
  const configured = String(MISTIC_AUTH_HEADER || "").trim().replace(/^Authorization\s*:\s*/i, "");
  if (configured) return /^Basic\s+/i.test(configured) ? configured : `Basic ${configured}`;
  if (!MISTIC_CLIENT_ID || !MISTIC_CLIENT_SECRET) return null;
  return `Basic ${Buffer.from(`${MISTIC_CLIENT_ID}:${MISTIC_CLIENT_SECRET}`).toString("base64")}`;
}

function misticRequest(endpoint, payload) {
  return new Promise((resolve, reject) => {
    const authorization = misticAuthorization();
    if (!authorization) return reject(new Error("Credenciais da Mistic Pay não configuradas."));

    let url;
    try {
      url = new URL(`${MISTIC_PAY_URL}${endpoint}`);
    } catch {
      return reject(new Error("MISTIC_PAY_URL inválida."));
    }
    if (url.protocol !== "https:") return reject(new Error("MISTIC_PAY_URL deve usar HTTPS."));

    const body = JSON.stringify(payload || {});
    const request = https.request(url, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    }, response => {
      const chunks = [];
      let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > 2_000_000) {
          request.destroy(new Error("Resposta da Mistic Pay excedeu o limite permitido."));
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
    request.setTimeout(20000, () => request.destroy(new Error("Tempo limite da Mistic Pay excedido.")));
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function paymentProduct(product) {
  if (product === "consulta-completa") {
    return { id: "consulta-completa", amount: CONSULTA_SALE_PRICE, description: "Consulta veicular completa" };
  }
  return null;
}

function signPaymentToken(payload) {
  if (!PAYMENT_SIGNING_SECRET) throw new Error("PAYMENT_SIGNING_SECRET não configurado.");
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", PAYMENT_SIGNING_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyPaymentToken(token) {
  if (!PAYMENT_SIGNING_SECRET) throw new Error("PAYMENT_SIGNING_SECRET não configurado.");
  const parts = String(token || "").split(".");
  if (parts.length !== 2) throw new Error("Token de pagamento inválido.");
  const expected = crypto.createHmac("sha256", PAYMENT_SIGNING_SECRET).update(parts[0]).digest("base64url");
  if (!secureEqual(parts[1], expected)) throw new Error("Token de pagamento inválido.");

  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { payload = null; }
  if (!payload || payload.v !== 1 || !payload.tx || !payload.product || !payload.plate || !payload.exp) {
    throw new Error("Token de pagamento inválido.");
  }
  if (Date.now() > Number(payload.exp)) throw new Error("Token de pagamento expirado.");
  return payload;
}

function misticAmountMatches(value, expected) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return false;
  // A documentação da Mistic Pay contém exemplos em reais e outros aparentando centavos.
  return Math.abs(amount - expected) < 0.011 || Math.abs((amount / 100) - expected) < 0.011;
}

async function getMisticTransaction(transactionId) {
  const key = String(transactionId || "");
  const cached = confirmedPaymentCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.transaction;

  const response = await misticRequest("/transactions/check", { transactionId: key });
  if (response.status < 200 || response.status >= 300 || !response.data || typeof response.data !== "object") {
    const err = new Error("Não foi possível verificar o pagamento na Mistic Pay.");
    err.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw err;
  }

  const transaction = response.data.transaction || response.data.data || response.data;
  if (!transaction || typeof transaction !== "object") {
    const err = new Error("Resposta inválida ao verificar o pagamento.");
    err.status = 502;
    throw err;
  }

  const state = String(transaction.transactionState || transaction.status || "").toUpperCase();
  if (state === "COMPLETO") {
    confirmedPaymentCache.set(key, { transaction, expiresAt: Date.now() + 30 * 60 * 1000 });
  }
  return transaction;
}

async function verifyPaidToken(token, requiredProduct) {
  const payload = verifyPaymentToken(token);
  if (requiredProduct && payload.product !== requiredProduct) {
    const err = new Error("Este pagamento não pertence a este produto.");
    err.status = 400;
    throw err;
  }

  const product = paymentProduct(payload.product);
  if (!product || Math.abs(Number(payload.amount) - product.amount) > 0.001) {
    const err = new Error("Produto ou valor do pagamento inválido.");
    err.status = 400;
    throw err;
  }

  const transaction = await getMisticTransaction(payload.tx);
  const state = String(transaction.transactionState || transaction.status || "").toUpperCase();
  const type = String(transaction.transactionType || "").toUpperCase();
  const method = String(transaction.transactionMethod || "").toUpperCase();
  const value = transaction.value ?? transaction.transactionAmount ?? transaction.amount;

  return {
    paid: state === "COMPLETO" && (!type || type === "DEPOSITO") && (!method || method === "PIX") && misticAmountMatches(value, product.amount),
    state: state || "DESCONHECIDO",
    payload,
    transaction
  };
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

function safeVehicleDetails(vehicle, plate) {
  return {
    plate,
    brand: vehicle.brand || vehicle.marca || null,
    model: vehicle.model || vehicle.modelo || null,
    year: vehicle.year || vehicle.ano || vehicle.fabricationYear || vehicle.anoFabricacao || null,
    modelYear: vehicle.modelYear || vehicle.anoModelo || null,
    color: vehicle.color || vehicle.cor || null,
    city: vehicle.city || vehicle.municipio || vehicle.cidade || null,
    state: vehicle.state || vehicle.uf || null,
    fuel: vehicle.fuel || vehicle.combustivel || null,
    type: vehicle.type || vehicle.tipo || vehicle.tipoVeiculo || null
  };
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
      lockedFields: ["year", "modelYear", "color", "city", "state", "fuel", "type"],
      price: CONSULTA_SALE_PRICE,
      currency: "BRL"
    });
  } catch (err) {
    console.error("Erro na consulta pública:", err.message);
    return res.status(err.status || 502).json({ error: err.message || "Falha ao realizar a consulta." });
  }
});

// Diagnóstico seguro da integração PIX. Nunca retorna credenciais.
app.get("/api/pagamento/pix/diagnostico", (req, res) => {
  res.set("Cache-Control", "no-store");
  const authConfigured = Boolean(misticAuthorization());
  const signingConfigured = Boolean(PAYMENT_SIGNING_SECRET);
  return res.json({
    provedor: "misticpay",
    url_base_configurada: Boolean(MISTIC_PAY_URL),
    autenticacao_configurada: authConfigured,
    webhook_configurado: Boolean(MISTIC_WEBHOOK_URL),
    assinatura_interna_configurada: signingConfigured,
    pronto_para_cobrar: authConfigured && signingConfigured
  });
});

// Cria uma cobrança PIX para a consulta veicular completa.
app.post("/api/pagamento/pix/criar", async (req, res) => {
  res.set("Cache-Control", "no-store");

  if (!misticAuthorization() || !PAYMENT_SIGNING_SECRET) {
    return res.status(503).json({ error: "pagamento_nao_configurado", mensagem: "Integração PIX não configurada no servidor." });
  }

  const limit = checkPaymentRateLimit(req);
  if (!limit.allowed) {
    res.set("Retry-After", String(limit.retryAfter));
    return res.status(429).json({ error: "limite_pagamentos", mensagem: "Muitas tentativas de cobrança. Tente novamente mais tarde." });
  }

  const product = paymentProduct(String((req.body && req.body.produto) || "consulta-completa"));
  if (!product) return res.status(400).json({ error: "produto_invalido", mensagem: "Produto de pagamento inválido." });

  const plate = normalizePlate(req.body && req.body.placa);
  if (!validPlate(plate)) return res.status(400).json({ error: "placa_invalida", mensagem: "Placa inválida." });

  const payerName = String((req.body && req.body.nome) || "").trim().replace(/\s+/g, " ");
  const payerDocument = digits(req.body && req.body.cpf);
  if (payerName.length < 2 || payerName.length > 120) {
    return res.status(400).json({ error: "nome_invalido", mensagem: "Informe o nome do pagador." });
  }
  if (!validCpf(payerDocument)) {
    return res.status(400).json({ error: "cpf_invalido", mensagem: "Informe um CPF válido do pagador." });
  }

  const clientTransactionId = `cv-${plate}-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
  const payload = {
    amount: product.amount,
    payerName,
    payerDocument,
    transactionId: clientTransactionId,
    description: `${product.description} - ${plate}`
  };
  if (MISTIC_WEBHOOK_URL) payload.projectWebhook = MISTIC_WEBHOOK_URL;

  try {
    const response = await misticRequest("/transactions/create", payload);
    const data = response.data && response.data.data ? response.data.data : response.data;
    if (response.status < 200 || response.status >= 300 || !data || typeof data !== "object") {
      console.error("Mistic Pay respondeu com erro ao criar cobrança", response.status);
      return res.status(response.status >= 400 && response.status < 500 ? response.status : 502).json({
        error: "falha_criar_pix",
        mensagem: "Não foi possível gerar o PIX. Tente novamente."
      });
    }

    const transactionId = data.transactionId;
    if (transactionId === undefined || transactionId === null || transactionId === "") {
      console.error("Mistic Pay não retornou transactionId na criação da cobrança.");
      return res.status(502).json({ error: "resposta_pix_invalida", mensagem: "A operadora não retornou o identificador da cobrança." });
    }

    const paymentToken = signPaymentToken({
      v: 1,
      product: product.id,
      plate,
      amount: product.amount,
      tx: String(transactionId),
      clientTx: clientTransactionId,
      exp: Date.now() + PAYMENT_TOKEN_TTL_MS
    });

    return res.status(201).json({
      ok: true,
      produto: product.id,
      placa: plate,
      valor: product.amount,
      moeda: "BRL",
      transactionId: String(transactionId),
      clientTransactionId,
      status: String(data.transactionState || "PENDENTE").toUpperCase(),
      qrCodeBase64: data.qrCodeBase64 || null,
      qrcodeUrl: data.qrcodeUrl || null,
      copyPaste: data.copyPaste || null,
      paymentToken,
      expiraEmSegundos: Math.floor(PAYMENT_TOKEN_TTL_MS / 1000)
    });
  } catch (err) {
    console.error("Erro ao criar cobrança na Mistic Pay:", err.message);
    return res.status(502).json({ error: "falha_comunicacao_pix", mensagem: "Falha de comunicação com a operadora PIX." });
  }
});

// Consulta o pagamento diretamente na Mistic Pay. Não confia apenas no webhook recebido.
app.post("/api/pagamento/pix/status", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const checked = await verifyPaidToken(req.body && req.body.paymentToken, "consulta-completa");
    return res.json({
      ok: true,
      pago: checked.paid,
      status: checked.state,
      produto: checked.payload.product,
      placa: checked.payload.plate,
      valor: checked.payload.amount,
      moeda: "BRL"
    });
  } catch (err) {
    return res.status(err.status || 400).json({ error: "pagamento_invalido", mensagem: err.message || "Não foi possível verificar o pagamento." });
  }
});

// Webhook da Mistic Pay. A documentação pública não informa assinatura do webhook;
// por isso o payload recebido NUNCA libera conteúdo sozinho: a transação é revalidada pela API autenticada.
app.post("/api/misticpay/webhook", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const transactionId = req.body && req.body.transactionId;
  if (transactionId === undefined || transactionId === null || transactionId === "") {
    return res.status(400).json({ ok: false });
  }

  try {
    await getMisticTransaction(String(transactionId));
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Falha ao revalidar webhook Mistic Pay:", err.message);
    return res.status(502).json({ ok: false });
  }
});

// Libera somente os campos técnicos previstos no site após confirmar o PIX na operadora.
app.post("/api/consulta-completa", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const checked = await verifyPaidToken(req.body && req.body.paymentToken, "consulta-completa");
    if (!checked.paid) {
      return res.status(402).json({ error: "pagamento_pendente", mensagem: "Pagamento ainda não confirmado." });
    }

    const plate = checked.payload.plate;
    const vehicle = await getVehicle(plate);
    return res.json({
      ok: true,
      paid: true,
      vehicle: safeVehicleDetails(vehicle, plate),
      price: CONSULTA_SALE_PRICE,
      currency: "BRL"
    });
  } catch (err) {
    console.error("Erro ao liberar consulta completa:", err.message);
    return res.status(err.status || 400).json({ error: "falha_desbloqueio", mensagem: err.message || "Não foi possível liberar a consulta." });
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

// Diagnóstico seguro: informa somente se as variáveis necessárias existem.
// Nunca retorna o conteúdo de nenhuma chave/token.
app.get("/api/crlv/sp/diagnostico", (req, res) => {
  res.set("Cache-Control", "no-store");
  const desphubConfigurada = Boolean(DESPHUB_API_KEY);
  const protecaoConfigurada = Boolean(CRLV_ADMIN_TOKEN);
  return res.json({
    servico: "crlv-sp",
    desphub_configurada: desphubConfigurada,
    protecao_crlv_configurada: protecaoConfigurada,
    pronto_para_emissao: desphubConfigurada && protecaoConfigurada
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

// Outros métodos/caminhos de consulta completa permanecem bloqueados.
app.all(/^\/api\/consulta-completa(?:\/.*)?$/, (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.status(402).json({ error: "Consulta completa disponível somente após confirmação do pagamento." });
});

app.use("/api", (req, res) => res.status(404).json({ error: "Endpoint não encontrado." }));

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
