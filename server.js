const express = require("express");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const sharp = require("sharp");
const QRCode = require("qrcode");
const { Pool } = require("pg");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const FALCON_TOKEN = String(process.env.FALCON_TOKEN || "").trim();
const OPENPIX_APP_ID = String(process.env.OPENPIX_APP_ID || process.env.WOOVI_APP_ID || "").trim();
const OPENPIX_API_URL = String(process.env.OPENPIX_API_URL || "https://api.openpix.com.br/api/v1").replace(/\/+$/, "");
const PAYMENT_SIGNING_SECRET = String(process.env.PAYMENT_SIGNING_SECRET || "").trim();
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined }) : null;

const CONSULTA_SALE_PRICE = 18.90;
const CONSULTA_SALE_CENTS = 1890;
const PACKAGES = Object.freeze({
  "consulta-completa": { id: "consulta-completa", amount: 18.90, cents: 1890, credits: 1, description: "1 consulta veicular completa" },
  "pacote-2": { id: "pacote-2", amount: 32.90, cents: 3290, credits: 2, description: "Pacote com 2 consultas veiculares" },
  "pacote-3": { id: "pacote-3", amount: 44.90, cents: 4490, credits: 3, description: "Pacote com 3 consultas veiculares" },
  "upsell-2": { id: "upsell-2", amount: 24.90, cents: 2490, credits: 2, description: "Oferta adicional com 2 consultas veiculares" }
});
const PAYMENT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const CHARGE_EXPIRES_IN_SECONDS = 30 * 60;
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
  for (const [id, entry] of confirmedPaymentCache) if (now >= entry.expiresAt) confirmedPaymentCache.delete(id);
}, 10 * 60 * 1000).unref();

async function initDatabase() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_accounts (
      id UUID PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id BIGSERIAL PRIMARY KEY,
      account_id UUID NOT NULL REFERENCES credit_accounts(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('purchase','consume','refund')),
      quantity INTEGER NOT NULL,
      reference TEXT NOT NULL,
      plate TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(type, reference)
    );
    CREATE TABLE IF NOT EXISTS payments (
      correlation_id TEXT PRIMARY KEY,
      account_id UUID NOT NULL REFERENCES credit_accounts(id) ON DELETE CASCADE,
      product TEXT NOT NULL,
      cents INTEGER NOT NULL,
      credits INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      credited_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS vehicle_queries (
      id UUID PRIMARY KEY,
      account_id UUID NOT NULL REFERENCES credit_accounts(id) ON DELETE CASCADE,
      plate TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','completed','failed')),
      credit_consumed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_credit_transactions_account ON credit_transactions(account_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_vehicle_queries_account ON vehicle_queries(account_id, created_at DESC);
  `);
}

function requireDatabase() {
  if (!pool) {
    const err = new Error("Banco de créditos não configurado.");
    err.status = 503;
    throw err;
  }
}

function signAccountToken(accountId) {
  if (!PAYMENT_SIGNING_SECRET) throw new Error("PAYMENT_SIGNING_SECRET não configurado.");
  const sig = crypto.createHmac("sha256", PAYMENT_SIGNING_SECRET).update(accountId).digest("base64url");
  return accountId + "." + sig;
}

function verifyAccountToken(token) {
  const [id, sig] = String(token || "").split(".");
  if (!/^[0-9a-f-]{36}$/i.test(id || "") || !sig) throw Object.assign(new Error("Conta de créditos inválida."), { status: 401 });
  const expected = crypto.createHmac("sha256", PAYMENT_SIGNING_SECRET).update(id).digest("base64url");
  if (!secureEqual(sig, expected)) throw Object.assign(new Error("Conta de créditos inválida."), { status: 401 });
  return id;
}

async function ensureAccount(token) {
  requireDatabase();
  if (token) {
    const id = verifyAccountToken(token);
    const found = await pool.query("SELECT id, balance FROM credit_accounts WHERE id=$1", [id]);
    if (found.rowCount) return { id, balance: found.rows[0].balance, token };
  }
  const id = crypto.randomUUID();
  await pool.query("INSERT INTO credit_accounts(id) VALUES($1)", [id]);
  return { id, balance: 0, token: signAccountToken(id) };
}

async function creditPaidPayment(checked) {
  requireDatabase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pay = await client.query("SELECT * FROM payments WHERE correlation_id=$1 FOR UPDATE", [checked.payload.correlationID]);
    if (!pay.rowCount) throw Object.assign(new Error("Pagamento não registrado."), { status: 400 });
    const p = pay.rows[0];
    if (p.credited_at) {
      const b = await client.query("SELECT balance FROM credit_accounts WHERE id=$1", [p.account_id]);
      await client.query("COMMIT");
      return { accountId: p.account_id, balance: b.rows[0].balance, alreadyCredited: true };
    }
    if (!checked.paid || Number(p.cents) !== Number(checked.payload.cents)) throw Object.assign(new Error("Pagamento ainda não confirmado."), { status: 402 });
    await client.query("UPDATE credit_accounts SET balance=balance+$1, updated_at=NOW() WHERE id=$2", [p.credits, p.account_id]);
    await client.query("INSERT INTO credit_transactions(account_id,type,quantity,reference) VALUES($1,'purchase',$2,$3) ON CONFLICT(type,reference) DO NOTHING", [p.account_id, p.credits, p.correlation_id]);
    await client.query("UPDATE payments SET status='completed', credited_at=NOW() WHERE correlation_id=$1", [p.correlation_id]);
    const b = await client.query("SELECT balance FROM credit_accounts WHERE id=$1", [p.account_id]);
    await client.query("COMMIT");
    return { accountId: p.account_id, balance: b.rows[0].balance, alreadyCredited: false };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally { client.release(); }
}

async function consumeCredit(accountId, plate) {
  requireDatabase();
  const client = await pool.connect();
  const queryId = crypto.randomUUID();
  try {
    await client.query("BEGIN");
    const debited = await client.query("UPDATE credit_accounts SET balance=balance-1,updated_at=NOW() WHERE id=$1 AND balance>0 RETURNING balance", [accountId]);
    if (!debited.rowCount) throw Object.assign(new Error("Você não possui consultas disponíveis."), { status: 402, code: "SEM_CREDITOS" });
    await client.query("INSERT INTO vehicle_queries(id,account_id,plate,status,credit_consumed) VALUES($1,$2,$3,'pending',TRUE)", [queryId, accountId, plate]);
    await client.query("INSERT INTO credit_transactions(account_id,type,quantity,reference,plate) VALUES($1,'consume',-1,$2,$3)", [accountId, queryId, plate]);
    await client.query("COMMIT");
    return { queryId, balance: debited.rows[0].balance };
  } catch(e) {
    await client.query("ROLLBACK");
    throw e;
  } finally { client.release(); }
}

async function finishCreditQuery(accountId, queryId, ok) {
  requireDatabase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const q = await client.query("SELECT * FROM vehicle_queries WHERE id=$1 AND account_id=$2 FOR UPDATE", [queryId, accountId]);
    if (!q.rowCount) throw new Error("Consulta não encontrada.");
    if (q.rows[0].status !== "pending") { await client.query("COMMIT"); return; }
    if (ok) {
      await client.query("UPDATE vehicle_queries SET status='completed',completed_at=NOW() WHERE id=$1", [queryId]);
    } else {
      await client.query("UPDATE credit_accounts SET balance=balance+1,updated_at=NOW() WHERE id=$1", [accountId]);
      await client.query("UPDATE vehicle_queries SET status='failed',completed_at=NOW() WHERE id=$1", [queryId]);
      await client.query("INSERT INTO credit_transactions(account_id,type,quantity,reference,plate) VALUES($1,'refund',1,$2,$3) ON CONFLICT(type,reference) DO NOTHING", [accountId, queryId, q.rows[0].plate]);
    }
    await client.query("COMMIT");
  } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}

function normalizePlate(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
}

function validPlate(plate) {
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate) || /^[A-Z]{3}[0-9]{4}$/.test(plate);
}

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requestJson(url, options = {}, payload = null, maxBytes = 2_000_000) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { return reject(new Error("URL de integração inválida.")); }
    if (parsed.protocol !== "https:") return reject(new Error("A integração deve usar HTTPS."));

    const body = payload == null ? null : JSON.stringify(payload);
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (body != null) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(body);
    }

    const request = https.request(parsed, { method: options.method || "GET", headers }, response => {
      const chunks = [];
      let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          request.destroy(new Error("Resposta da integração excedeu o limite permitido."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch {}
        resolve({ status: response.statusCode || 502, data, raw });
      });
    });
    request.setTimeout(options.timeout || 20000, () => request.destroy(new Error("Tempo limite da integração excedido.")));
    request.on("error", reject);
    if (body != null) request.write(body);
    request.end();
  });
}

async function falconRequest(plate) {
  if (!FALCON_TOKEN) {
    const err = new Error("API veicular não configurada no servidor.");
    err.status = 503;
    throw err;
  }

  const url = `https://beta.falcon-server.com.br/data-hub/private/v1/vehicles/${encodeURIComponent(plate)}/search`;
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await requestJson(url, {
        headers: { Authorization: `Bearer ${FALCON_TOKEN}` },
        timeout: 20000
      });
      if (response.status >= 200 && response.status < 300 && response.data && typeof response.data === "object") {
        return response.data;
      }
      if (response.status < 500 && response.status !== 429) {
        const err = new Error("Não foi possível realizar a consulta veicular.");
        err.status = response.status >= 400 && response.status < 500 ? response.status : 502;
        throw err;
      }
      lastError = new Error(`Falcon respondeu HTTP ${response.status}.`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500));
  }
  const err = new Error("A fonte veicular está temporariamente indisponível.");
  err.status = 502;
  err.cause = lastError;
  throw err;
}

async function getVehicle(plate) {
  const cached = previewCache.get(plate);
  if (cached && Date.now() < cached.expiresAt) return cached.vehicle;
  const data = await falconRequest(plate);
  const vehicle = data.vehicle || data.data || data;
  if (!vehicle || typeof vehicle !== "object") {
    const err = new Error("Resposta inválida da fonte veicular.");
    err.status = 502;
    throw err;
  }
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

function paymentProduct(product) {
  return PACKAGES[String(product || "")] || null;
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

  let payload = null;
  try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch {}
  if (!payload || payload.v !== 3 || payload.provider !== "openpix" || !payload.correlationID || !payload.product || !payload.accountId || !payload.exp) {
    throw new Error("Token de pagamento inválido.");
  }
  if (Date.now() > Number(payload.exp)) throw new Error("Token de pagamento expirado.");
  return payload;
}

function openPixHeaders() {
  if (!OPENPIX_APP_ID) throw new Error("OPENPIX_APP_ID não configurado.");
  return { Authorization: OPENPIX_APP_ID };
}

async function createOpenPixCharge({ correlationID, plate, product }) {
  const response = await requestJson(
    `${OPENPIX_API_URL}/charge?return_existing=true`,
    { method: "POST", headers: openPixHeaders(), timeout: 20000 },
    {
      correlationID,
      value: product.cents,
      comment: `Consulta Veicular 360 - ${product.description}${plate ? " - " + plate : ""}`,
      expiresIn: CHARGE_EXPIRES_IN_SECONDS
    }
  );

  const charge = response.data && response.data.charge ? response.data.charge : null;
  if (response.status < 200 || response.status >= 300 || !charge || typeof charge !== "object") {
    console.error("Woovi/OpenPix respondeu com erro ao criar cobrança:", response.status);
    const err = new Error("Não foi possível gerar o PIX. Tente novamente.");
    err.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw err;
  }
  return charge;
}

async function getOpenPixCharge(correlationID) {
  const key = String(correlationID || "");
  const cached = confirmedPaymentCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.charge;

  const response = await requestJson(
    `${OPENPIX_API_URL}/charge/${encodeURIComponent(key)}`,
    { headers: openPixHeaders(), timeout: 15000 }
  );
  const charge = response.data && response.data.charge ? response.data.charge : null;
  if (response.status < 200 || response.status >= 300 || !charge || typeof charge !== "object") {
    const err = new Error("Não foi possível verificar o pagamento na Woovi/OpenPix.");
    err.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw err;
  }
  if (String(charge.status || "").toUpperCase() === "COMPLETED") {
    confirmedPaymentCache.set(key, { charge, expiresAt: Date.now() + 30 * 60 * 1000 });
  }
  return charge;
}

async function verifyPaidToken(token, requiredProduct) {
  const payload = verifyPaymentToken(token);
  if (requiredProduct && payload.product !== requiredProduct) {
    const err = new Error("Este pagamento não pertence a este produto.");
    err.status = 400;
    throw err;
  }
  const product = paymentProduct(payload.product);
  if (!product || Number(payload.cents) !== product.cents) {
    const err = new Error("Produto ou valor do pagamento inválido.");
    err.status = 400;
    throw err;
  }

  const charge = await getOpenPixCharge(payload.correlationID);
  const state = String(charge.status || "").toUpperCase();
  const value = Number(charge.value);
  const paid = state === "COMPLETED" && Number.isFinite(value) && value === product.cents;

  return { paid, state: state || "DESCONHECIDO", payload, charge };
}

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

app.post("/api/creditos/conta", async (req, res) => {
  try {
    const account = await ensureAccount(req.body && req.body.accountToken);
    return res.json({ ok:true, accountToken:account.token, creditos:account.balance });
  } catch(err) { return res.status(err.status || 503).json({ error:"creditos_indisponiveis", mensagem:err.message }); }
});

app.get("/api/creditos/saldo", async (req, res) => {
  try {
    requireDatabase();
    const id = verifyAccountToken(req.get("X-Credit-Account"));
    const r = await pool.query("SELECT balance FROM credit_accounts WHERE id=$1", [id]);
    return res.json({ ok:true, creditos:r.rows[0]?.balance ?? 0 });
  } catch(err) { return res.status(err.status || 401).json({ error:"conta_creditos", mensagem:err.message }); }
});

app.get("/api/pagamento/pix/diagnostico", (req, res) => {
  return res.json({
    provedor: "woovi-openpix",
    api_configurada: Boolean(OPENPIX_APP_ID),
    assinatura_interna_configurada: Boolean(PAYMENT_SIGNING_SECRET),
    pronto_para_cobrar: Boolean(OPENPIX_APP_ID && PAYMENT_SIGNING_SECRET),
    coleta_dados_pagador_no_site: false
  });
});

app.post("/api/pagamento/pix/criar", async (req, res) => {
  if (!OPENPIX_APP_ID || !PAYMENT_SIGNING_SECRET) {
    return res.status(503).json({
      error: "pagamento_nao_configurado",
      mensagem: "Integração PIX Woovi/OpenPix ainda não configurada no servidor."
    });
  }

  const limit = checkPaymentRateLimit(req);
  if (!limit.allowed) {
    res.set("Retry-After", String(limit.retryAfter));
    return res.status(429).json({ error: "limite_pagamentos", mensagem: "Muitas tentativas de cobrança. Tente novamente mais tarde." });
  }

  const product = paymentProduct(String((req.body && req.body.produto) || "consulta-completa"));
  if (!product) return res.status(400).json({ error: "produto_invalido", mensagem: "Produto de pagamento inválido." });

  const plate = normalizePlate(req.body && req.body.placa);
  if (product.id === "consulta-completa" && !validPlate(plate)) return res.status(400).json({ error: "placa_invalida", mensagem: "Placa inválida." });
  let account;
  try { account = await ensureAccount(req.body && req.body.accountToken); }
  catch (err) { return res.status(err.status || 503).json({ error: "conta_creditos", mensagem: err.message }); }

  const correlationID = `cv-${plate}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;

  try {
    const charge = await createOpenPixCharge({ correlationID, plate, product });
    const copyPaste = charge.brCode || (charge.pix && charge.pix.brCode) || null;
    let qrcodeUrl = charge.qrCodeImage || null;
    if (!qrcodeUrl && copyPaste) {
      try { qrcodeUrl = await QRCode.toDataURL(copyPaste, { width: 420, margin: 2 }); } catch {}
    }
    await pool.query("INSERT INTO payments(correlation_id,account_id,product,cents,credits) VALUES($1,$2,$3,$4,$5) ON CONFLICT(correlation_id) DO NOTHING", [correlationID, account.id, product.id, product.cents, product.credits]);
    const paymentToken = signPaymentToken({
      v: 3,
      provider: "openpix",
      product: product.id,
      accountId: account.id,
      plate,
      amount: product.amount,
      cents: product.cents,
      correlationID,
      exp: Date.now() + PAYMENT_TOKEN_TTL_MS
    });

    return res.status(201).json({
      ok: true,
      provedor: "woovi-openpix",
      produto: product.id,
      placa: plate,
      valor: product.amount,
      moeda: "BRL",
      correlationID,
      status: String(charge.status || "ACTIVE").toUpperCase(),
      copyPaste,
      qrcodeUrl,
      paymentLinkUrl: charge.paymentLinkUrl || null,
      paymentToken,
      accountToken: account.token,
      creditosComprados: product.credits,
      expiraEmSegundos: Number(charge.expiresIn) || CHARGE_EXPIRES_IN_SECONDS
    });
  } catch (err) {
    console.error("Erro ao criar cobrança na Woovi/OpenPix:", err.message);
    return res.status(err.status || 502).json({
      error: "falha_criar_pix",
      mensagem: err.message || "Não foi possível gerar o PIX."
    });
  }
});

app.post("/api/pagamento/pix/webhook", async (req, res) => {
  // A notificação inicia a checagem, mas nunca é confiada sozinha:
  // o servidor confirma status e valor diretamente na Woovi/OpenPix antes de creditar.
  try {
    const event = String(req.body && req.body.event || "").toUpperCase();
    const notifiedCharge = req.body && req.body.charge;
    if (event !== "OPENPIX:CHARGE_COMPLETED" || !notifiedCharge) {
      return res.status(200).json({ ok:true, ignored:true });
    }

    const correlationID = String(notifiedCharge.correlationID || "").trim();
    if (!correlationID || !correlationID.startsWith("cv-") || correlationID.length > 160) {
      return res.status(200).json({ ok:true, ignored:true });
    }

    requireDatabase();
    const registered = await pool.query(
      "SELECT correlation_id, cents, product FROM payments WHERE correlation_id=$1",
      [correlationID]
    );
    if (!registered.rowCount) return res.status(200).json({ ok:true, ignored:true });

    // Confirma a cobrança na API oficial; impede crédito por webhook forjado.
    confirmedPaymentCache.delete(correlationID);
    const charge = await getOpenPixCharge(correlationID);
    const state = String(charge.status || "").toUpperCase();
    const providerCents = Number(charge.value);
    const payment = registered.rows[0];

    if (state !== "COMPLETED" || !Number.isFinite(providerCents) || providerCents !== Number(payment.cents)) {
      console.warn("Webhook PIX ignorado após verificação: status/valor divergente.", correlationID);
      return res.status(200).json({ ok:true, ignored:true });
    }

    const product = paymentProduct(payment.product);
    if (!product || product.cents !== Number(payment.cents)) {
      console.error("Webhook PIX: produto local inválido.", correlationID);
      return res.status(200).json({ ok:true, ignored:true });
    }

    const checked = {
      paid: true,
      state,
      payload: {
        correlationID,
        product: product.id,
        cents: product.cents,
        amount: product.amount
      },
      charge
    };
    const wallet = await creditPaidPayment(checked);
    console.log("Webhook PIX confirmado e créditos processados:", correlationID, "saldo:", wallet.balance);
    return res.status(200).json({ ok:true });
  } catch (err) {
    console.error("Erro no webhook Woovi/OpenPix:", err.message);
    return res.status(500).json({ ok:false });
  }
});

app.post("/api/pagamento/pix/status", async (req, res) => {
  try {
    const checked = await verifyPaidToken(req.body && req.body.paymentToken);
    let wallet = null;
    if (checked.paid) wallet = await creditPaidPayment(checked);
    return res.json({
      ok: true,
      pago: checked.paid,
      creditos: wallet ? wallet.balance : undefined,
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

app.post("/api/consulta-completa", async (req, res) => {
  try {
    let accountId, plate;
    if (req.body && req.body.paymentToken) {
      const checked = await verifyPaidToken(req.body.paymentToken);
      if (!checked.paid) return res.status(402).json({ error: "pagamento_pendente", mensagem: "Pagamento ainda não confirmado." });
      const wallet = await creditPaidPayment(checked);
      accountId = wallet.accountId;
      plate = checked.payload.plate || normalizePlate(req.body.placa);
    } else {
      accountId = verifyAccountToken(req.body && req.body.accountToken);
      plate = normalizePlate(req.body && req.body.placa);
    }
    if (!validPlate(plate)) return res.status(400).json({ error: "placa_invalida", mensagem: "Placa inválida." });
    const debit = await consumeCredit(accountId, plate);
    try {
      const vehicle = await getVehicle(plate);
      await finishCreditQuery(accountId, debit.queryId, true);
      return res.json({ ok:true, paid:true, vehicle:safeVehicleDetails(vehicle,plate), creditosRestantes:debit.balance, price:CONSULTA_SALE_PRICE, currency:"BRL" });
    } catch (err) {
      await finishCreditQuery(accountId, debit.queryId, false);
      throw err;
    }
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

app.get("/preview-social.jpg", async (req, res) => {
  try {
    const input = path.join(__dirname, "file_00000000314c820e938dffdddecda774.png");
    const image = await sharp(input)
      .resize(1200, 630, { fit: "cover", position: "centre" })
      .jpeg({ quality: 82, progressive: true })
      .toBuffer();
    res.set("Content-Type", "image/jpeg");
    res.set("Content-Length", String(image.length));
    res.set("Cache-Control", "public, max-age=86400");
    res.send(image);
  } catch (err) {
    res.status(404).type("text/plain").send("Imagem não encontrada.");
  }
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
if (!OPENPIX_APP_ID) console.warn("OPENPIX_APP_ID não configurado. O checkout PIX ficará indisponível.");
if (!PAYMENT_SIGNING_SECRET) console.warn("PAYMENT_SIGNING_SECRET não configurado.");
if (!DATABASE_URL) console.warn("DATABASE_URL não configurado. O controle persistente de créditos ficará indisponível.");

initDatabase().then(() => {
  app.listen(PORT, () => console.log(`Consulta Veicular 360 ativa na porta ${PORT}. Checkout PIX: Woovi/OpenPix. Créditos: ${pool ? "PostgreSQL" : "indisponível"}.`));
}).catch(err => {
  console.error("Falha ao inicializar banco de créditos:", err);
  process.exit(1);
});
