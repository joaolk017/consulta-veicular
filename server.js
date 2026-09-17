const express = require("express");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const FALCON_TOKEN = String(process.env.FALCON_TOKEN || "").trim();
const MISTIC_PAY_URL = String(process.env.MISTIC_PAY_URL || "https://api.misticpay.com/api").replace(/\/+$/, "");
const MISTIC_CLIENT_ID = String(process.env.MISTIC_CLIENT_ID || "").trim();
const MISTIC_CLIENT_SECRET = String(process.env.MISTIC_CLIENT_SECRET || "").trim();
const MISTIC_AUTH_HEADER = String(process.env.MISTIC_AUTH_HEADER || "").trim();
const MISTIC_WEBHOOK_URL = String(process.env.MISTIC_WEBHOOK_URL || "").trim();
const PAYMENT_SIGNING_SECRET = String(process.env.PAYMENT_SIGNING_SECRET || "").trim();

const CONSULTA_SALE_PRICE = 18.90;
const PAYMENT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_PREVIEWS_PER_HOUR = 10;
const MAX_PAYMENT_CREATES_PER_HOUR = 12;

const rateStore = new Map();
const paymentRateStore = new Map();
const previewCache = new Map();
const confirmedPaymentCache = new Map();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));

app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), usb=(), payment=()");
  res.set("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
  res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (req.path.startsWith("/api/")) {
    res.set("Cache-Control", "no-store");
    res.set("Pragma", "no-cache");
    res.set("X-Robots-Tag", "noindex, nofollow, nosnippet");
  }
  next();
});

// Evita exposição acidental do código-fonte e arquivos internos pelo servidor estático.
app.use((req, res, next) => {
  const pathname = String(req.path || "/").toLowerCase();
  const blocked =
    pathname.startsWith("/.") ||
    pathname.startsWith("/node_modules/") ||
    /\.(?:js|json|map|md|lock|env)$/i.test(pathname);
  if (blocked) return res.status(404).type("text/plain").send("Página não encontrada.");
  next();
});

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
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
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
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "ConsultaVeicular360/1.0"
      }
    }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => {
        body += chunk;
        if (body.length > 2_000_000) request.destroy(new Error("Resposta da fonte veicular excedeu o limite."));
      });
      response.on("end", () => resolve({ status: response.statusCode || 502, body }));
    });
    request.setTimeout(20000, () => request.destroy(new Error("Tempo limite da fonte veicular excedido.")));
    request.on("error", reject);
  });
}

function falconRetryableError(err) {
  const code = String((err && err.code) || "").toUpperCase();
  const message = String((err && err.message) || "");
  return message.includes("Tempo limite") ||
    ["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED"].includes(code);
}

async function falconRequestWithRetry(url, token) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await falconRequest(url, token);
      if (response.status < 500 || response.status > 599 || attempt === 2) return response;
    } catch (err) {
      if (!falconRetryableError(err) || attempt === 2) throw err;
    }
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  throw new Error("Falha temporária da fonte veicular.");
}

function misticAuthorization() {
  const configured = MISTIC_AUTH_HEADER.replace(/^Authorization\s*:\s*/i, "");
  if (configured) return /^Basic\s+/i.test(configured) ? configured : `Basic ${configured}`;
  if (!MISTIC_CLIENT_ID || !MISTIC_CLIENT_SECRET) return null;
  return `Basic ${Buffer.from(`${MISTIC_CLIENT_ID}:${MISTIC_CLIENT_SECRET}`).toString("base64")}`;
}

function misticRequest(endpoint, payload) {
  return new Promise((resolve, reject) => {
    const authorization = misticAuthorization();
    if (!authorization) return reject(new Error("Credenciais da MisticPay não configuradas."));

    let url;
    try {
      url = new URL(`${MISTIC_PAY_URL}${endpoint}`);
    } catch {
      return reject(new Error("URL da MisticPay inválida."));
    }
    if (url.protocol !== "https:") return reject(new Error("A integração de pagamento deve usar HTTPS."));

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
        if (size > 2_000_000) return request.destroy(new Error("Resposta da MisticPay excedeu o limite."));
        chunks.push(chunk);
      });
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch {}
        resolve({ status: response.statusCode || 502, data });
      });
    });
    request.setTimeout(20000, () => request.destroy(new Error("Tempo limite da MisticPay excedido.")));
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
  if (!PAYMENT_SIGNING_SECRET) throw new Error("Assinatura interna de pagamento não configurada.");
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", PAYMENT_SIGNING_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyPaymentToken(token) {
  if (!PAYMENT_SIGNING_SECRET) throw new Error("Assinatura interna de pagamento não configurada.");
  const parts = String(token || "").split(".");
  if (parts.length !== 2) throw new Error("Token de pagamento inválido.");
  const expected = crypto.createHmac("sha256", PAYMENT_SIGNING_SECRET).update(parts[0]).digest("base64url");
  if (!secureEqual(parts[1], expected)) throw new Error("Token de pagamento inválido.");

  let payload = null;
  try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch {}
  if (!payload || payload.v !== 1 || !payload.tx || !payload.product || !payload.plate || !payload.exp) {
    throw new Error("Token de pagamento inválido.");
  }
  if (Date.now() > Number(payload.exp)) throw new Error("Token de pagamento expirado.");
  return payload;
}

function misticAmountMatches(value, expected) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return false;
  return Math.abs(amount - expected) < 0.011 || Math.abs((amount / 100) - expected) < 0.011;
}

async function getMisticTransaction(transactionId) {
  const key = String(transactionId || "");
  const cached = confirmedPaymentCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.transaction;

  const response = await misticRequest("/transactions/check", { transactionId: key });
  if (response.status < 200 || response.status >= 300 || !response.data || typeof response.data !== "object") {
    const err = new Error("Não foi possível verificar o pagamento na MisticPay.");
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
    paid: state === "COMPLETO" &&
      (!type || type === "DEPOSITO") &&
      (!method || method === "PIX") &&
      misticAmountMatches(value, product.amount),
    state: state || "DESCONHECIDO",
    payload
  };
}

async function getVehicle(plate) {
  const cached = previewCache.get(plate);
  if (cached && Date.now() < cached.expiresAt) return cached.vehicle;

  if (!FALCON_TOKEN) {
    const err = new Error("Consulta veicular temporariamente indisponível.");
    err.status = 503;
    throw err;
  }

  const url = `https://beta.falcon-server.com.br/data-hub/private/v1/vehicles/${encodeURIComponent(plate)}/search`;
  const response = await falconRequestWithRetry(url, FALCON_TOKEN);

  let data = null;
  try { data = JSON.parse(response.body); } catch {}

  if (response.status < 200 || response.status >= 300) {
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

app.get("/healthz", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, service: "consulta-veicular-360" });
});

app.get("/api/consulta/:plate", async (req, res) => {
  const plate = normalizePlate(req.params.plate);
  if (!validPlate(plate)) return res.status(400).json({ error: "Placa inválida." });

  const limit = checkRateLimit(req);
  if (!limit.allowed) {
    res.set("Retry-After", String(limit.retryAfter));
    return res.status(429).json({ error: "Limite de consultas gratuitas atingido. Tente novamente mais tarde." });
  }

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

app.get("/api/pagamento/pix/diagnostico", (req, res) => {
  const authConfigured = Boolean(misticAuthorization());
  const signingConfigured = Boolean(PAYMENT_SIGNING_SECRET);
  return res.json({
    provedor: "misticpay",
    autenticacao_configurada: authConfigured,
    webhook_configurado: Boolean(MISTIC_WEBHOOK_URL),
    assinatura_interna_configurada: signingConfigured,
    pronto_para_cobrar: authConfigured && signingConfigured
  });
});

app.post("/api/pagamento/pix/criar", async (req, res) => {
  if (!misticAuthorization() || !PAYMENT_SIGNING_SECRET) {
    return res.status(503).json({
      error: "pagamento_nao_configurado",
      mensagem: "Integração PIX temporariamente indisponível."
    });
  }

  const limit = checkPaymentRateLimit(req);
  if (!limit.allowed) {
    res.set("Retry-After", String(limit.retryAfter));
    return res.status(429).json({
      error: "limite_pagamentos",
      mensagem: "Muitas tentativas de cobrança. Tente novamente mais tarde."
    });
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
      console.error("MisticPay respondeu com erro ao criar cobrança:", response.status);
      return res.status(response.status >= 400 && response.status < 500 ? response.status : 502).json({
        error: "falha_criar_pix",
        mensagem: "Não foi possível gerar o PIX. Tente novamente."
      });
    }

    const transactionId = data.transactionId;
    if (transactionId === undefined || transactionId === null || transactionId === "") {
      return res.status(502).json({
        error: "resposta_pix_invalida",
        mensagem: "A processadora não retornou o identificador da cobrança."
      });
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
    console.error("Erro ao criar cobrança na MisticPay:", err.message);
    return res.status(502).json({
      error: "falha_comunicacao_pix",
      mensagem: "Falha de comunicação com a processadora PIX."
    });
  }
});

app.post("/api/pagamento/pix/status", async (req, res) => {
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
    return res.status(err.status || 400).json({
      error: "pagamento_invalido",
      mensagem: err.message || "Não foi possível verificar o pagamento."
    });
  }
});

// O webhook nunca libera conteúdo sozinho. A transação é revalidada pela API autenticada.
app.post("/api/misticpay/webhook", async (req, res) => {
  const transactionId = req.body && req.body.transactionId;
  if (transactionId === undefined || transactionId === null || transactionId === "") {
    return res.status(400).json({ ok: false });
  }
  try {
    await getMisticTransaction(String(transactionId));
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Falha ao revalidar webhook MisticPay:", err.message);
    return res.status(502).json({ ok: false });
  }
});

app.post("/api/consulta-completa", async (req, res) => {
  try {
    const checked = await verifyPaidToken(req.body && req.body.paymentToken, "consulta-completa");
    if (!checked.paid) {
      return res.status(402).json({
        error: "pagamento_pendente",
        mensagem: "Pagamento ainda não confirmado."
      });
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
    return res.status(err.status || 400).json({
      error: "falha_desbloqueio",
      mensagem: err.message || "Não foi possível liberar a consulta."
    });
  }
});

app.all(/^\/api\/consulta-completa(?:\/.*)?$/, (req, res) => {
  return res.status(405).json({ error: "Método não permitido." });
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Endpoint não encontrado." });
});

app.use(express.static(path.join(__dirname), {
  dotfiles: "deny",
  index: "index.html",
  extensions: ["html"]
}));

app.use((req, res) => {
  const notFound = path.join(__dirname, "404.html");
  res.status(404).sendFile(notFound, err => {
    if (err) res.status(404).type("text/plain").send("Página não encontrada.");
  });
});

if (!FALCON_TOKEN) console.warn("FALCON_TOKEN não configurado.");
if (!misticAuthorization()) console.warn("Credenciais MisticPay não configuradas.");
if (!PAYMENT_SIGNING_SECRET) console.warn("PAYMENT_SIGNING_SECRET não configurado.");

app.listen(PORT, () => {
  console.log(`Consulta Veicular 360 ativa na porta ${PORT}.`);
});
