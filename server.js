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
const FONTEDATA_API_KEY = String(process.env.FONTEDATA_API_KEY || "").trim();
const FONTEDATA_TEST_TOKEN = String(process.env.FONTEDATA_TEST_TOKEN || "").trim();
const CREDPRO_TEST_API_KEY = String(process.env.CREDPRO_TEST_API_KEY || "").trim();
const CREDPRO_API_URL = "https://cred-pro.com";
const VEHICLE_PROVIDER_STRATEGY = Object.freeze({
  primary: "falcon",
  complementary: "fontedata",
  complementaryEnabled: false
});
const OPENPIX_APP_ID = String(process.env.OPENPIX_APP_ID || process.env.WOOVI_APP_ID || "").trim();
const OPENPIX_API_URL = String(process.env.OPENPIX_API_URL || "https://api.woovi.com/api/v1").replace(/\/+$/, "");
const WOOVI_API_URL = "https://api.woovi.com/api/v1";
const PAYMENT_SIGNING_SECRET = String(process.env.PAYMENT_SIGNING_SECRET || "").trim();
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || "").trim();
const RESEND_FROM_EMAIL = String(process.env.RESEND_FROM_EMAIL || "Consulta Veicular 360 <onboarding@resend.dev>").trim();
const ADMIN_FUNNEL_SECRET = String(process.env.ADMIN_FUNNEL_SECRET || "").trim();
const OPENPIX_WEBHOOK_SECRET = String(process.env.OPENPIX_WEBHOOK_SECRET || "").trim();
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined }) : null;

const CONSULTA_SALE_PRICE = 18.90;
const CONSULTA_SALE_CENTS = 1890;
// Custos usados apenas para estimativa gerencial no painel.
// API veicular: R$ 3,00 por crédito/consulta vendido. Woovi: 0,80% do valor confirmado.
const VEHICLE_API_COST_CENTS = 300;
const PAYMENT_FEE_RATE = 0.008;
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
const recoveryRateStore = new Map();
const sensitiveRateStore = new Map();
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

function checkSensitiveRateLimit(req, action, max = 60) {
  return useRateLimit(sensitiveRateStore, action + ":" + clientIp(req), max);
}

function enforceSensitiveRateLimit(req, res, action, max) {
  const limit = checkSensitiveRateLimit(req, action, max);
  if (limit.allowed) return true;
  res.set("Retry-After", String(limit.retryAfter));
  res.status(429).json({ error: "limite_requisicoes", mensagem: "Muitas solicitações. Aguarde antes de tentar novamente." });
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateStore) if (now >= entry.resetAt) rateStore.delete(key);
  for (const [key, entry] of paymentRateStore) if (now >= entry.resetAt) paymentRateStore.delete(key);
  for (const [key, entry] of recoveryRateStore) if (now >= entry.resetAt) recoveryRateStore.delete(key);
  for (const [key, entry] of sensitiveRateStore) if (now >= entry.resetAt) sensitiveRateStore.delete(key);
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
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS funnel_session_id TEXT;
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
    ALTER TABLE vehicle_queries ADD COLUMN IF NOT EXISTS result_json JSONB;
    ALTER TABLE credit_accounts ADD COLUMN IF NOT EXISTS email TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_accounts_email_unique ON credit_accounts (LOWER(email)) WHERE email IS NOT NULL;
    CREATE TABLE IF NOT EXISTS credit_recovery_codes (
      id UUID PRIMARY KEY,
      account_id UUID NOT NULL REFERENCES credit_accounts(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_credit_recovery_email ON credit_recovery_codes(LOWER(email), created_at DESC);
    CREATE TABLE IF NOT EXISTS funnel_events (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      event_name TEXT NOT NULL,
      product TEXT,
      plate_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS amount_cents INTEGER;
    ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS correlation_id TEXT;
    ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS device TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_funnel_pix_pago_correlation ON funnel_events(correlation_id) WHERE event_name='pix_pago' AND correlation_id IS NOT NULL;
    -- Migração única: eventos anteriores à separação teste/produção eram da fase de validação.
    -- Marca somente o legado existente; eventos novos permanecem reais por padrão.
    UPDATE funnel_events SET is_test=TRUE WHERE is_test=FALSE AND created_at < TIMESTAMPTZ '2026-09-18 18:30:00-03';
    CREATE INDEX IF NOT EXISTS idx_funnel_events_name_created ON funnel_events(event_name, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_funnel_events_session_created ON funnel_events(session_id, created_at DESC);
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


function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    throw Object.assign(new Error("Informe um e-mail válido para proteger seus créditos."), { status: 400 });
  }
  return email;
}

function recoveryCodeHash(id, code) {
  return crypto.createHmac("sha256", PAYMENT_SIGNING_SECRET).update(id + ":" + code).digest("hex");
}

async function sendRecoveryEmail(email, code) {
  if (!RESEND_API_KEY) throw Object.assign(new Error("Envio de e-mail ainda não configurado."), { status: 503 });
  const payload = JSON.stringify({
    from: RESEND_FROM_EMAIL,
    to: [email],
    subject: "Seu código de recuperação | Consulta Veicular 360",
    html: '<div style="margin:0;padding:32px 12px;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#172033"><div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden"><div style="background:#0b172a;padding:24px 28px;text-align:center"><div style="font-size:24px;font-weight:800;color:#ffffff">Consulta Veicular <span style="color:#f6c445">360</span></div><div style="margin-top:6px;font-size:12px;color:#cbd5e1">Verificação de segurança</div></div><div style="padding:30px 28px"><h1 style="margin:0 0 12px;font-size:22px;color:#111827">Código de recuperação</h1><p style="margin:0 0 22px;line-height:1.6;color:#4b5563">Recebemos uma solicitação para recuperar os créditos vinculados a este e-mail. Digite o código abaixo no Consulta Veicular 360:</p><div style="padding:18px;text-align:center;background:#f8fafc;border:1px solid #dbe3ec;border-radius:12px;font-size:34px;font-weight:800;letter-spacing:8px;color:#0b172a">' + code + '</div><p style="margin:22px 0 0;line-height:1.6;color:#4b5563"><strong>Este código expira em 10 minutos</strong> e pode ser utilizado apenas uma vez.</p><div style="margin-top:24px;padding:14px 16px;background:#fff8e6;border-radius:10px;font-size:13px;line-height:1.5;color:#664d03"><strong>Segurança:</strong> nunca solicitamos sua senha de e-mail. Não compartilhe este código com terceiros.</div><div style="margin-top:24px;text-align:center"><a href="https://consultaveicular360.com.br" style="display:inline-block;padding:12px 20px;background:#0b172a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700">Acessar Consulta Veicular 360</a></div><p style="margin:26px 0 0;font-size:13px;line-height:1.5;color:#6b7280">Se você não solicitou esta recuperação, ignore este e-mail. Nenhuma alteração será feita sem a confirmação do código.</p></div><div style="padding:18px 28px;background:#f8fafc;border-top:1px solid #e5e7eb;text-align:center;font-size:12px;line-height:1.5;color:#6b7280">Este e-mail foi enviado automaticamente. Não responda a esta mensagem.<br>Serviço privado e independente.</div></div></div>',
    text: 'Consulta Veicular 360 - Código de recuperação: ' + code + '. Este código expira em 10 minutos e só pode ser usado uma vez. Nunca solicitamos sua senha de e-mail. Se você não solicitou esta recuperação, ignore esta mensagem.'
  });
  return new Promise((resolve, reject) => {
    const req = https.request("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + RESEND_API_KEY, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
    }, response => {
      let body = "";
      response.on("data", c => body += c);
      response.on("end", () => {
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(body);
        console.error("Resend recusou o envio:", response.statusCode, body.slice(0, 300));
        reject(Object.assign(new Error("Não foi possível enviar o código de recuperação."), { status: 502 }));
      });
    });
    req.on("error", () => reject(Object.assign(new Error("Não foi possível enviar o código de recuperação."), { status: 502 })));
    req.write(payload);
    req.end();
  });
}

async function bindRecoveryEmail(accountId, email) {
  requireDatabase();
  const normalized = normalizeEmail(email);
  const existing = await pool.query("SELECT id FROM credit_accounts WHERE LOWER(email)=LOWER($1) AND id<>$2 LIMIT 1", [normalized, accountId]);
  if (existing.rowCount) throw Object.assign(new Error("Este e-mail já está vinculado a outra conta. Use a opção Recuperar créditos."), { status: 409 });
  await pool.query("UPDATE credit_accounts SET email=$1, updated_at=NOW() WHERE id=$2", [normalized, accountId]);
  return normalized;
}

async function creditPaidPayment(checked) {
  requireDatabase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pay = await client.query("SELECT * FROM payments WHERE correlation_id=$1 FOR UPDATE", [checked.payload.correlationID]);
    if (!pay.rowCount) throw Object.assign(new Error("Pagamento não registrado."), { status: 400 });
    const p = pay.rows[0];
    // Defesa em profundidade: o token assinado deve corresponder exatamente
    // ao pagamento persistido antes de qualquer crédito ser liberado.
    if (
      String(p.account_id) !== String(checked.payload.accountId) ||
      String(p.product) !== String(checked.payload.product) ||
      Number(p.cents) !== Number(checked.payload.cents)
    ) {
      throw Object.assign(new Error("Dados do pagamento não correspondem ao registro original."), { status: 400 });
    }
    const expectedProduct = paymentProduct(p.product);
    if (!expectedProduct || Number(p.credits) !== Number(expectedProduct.credits) || Number(p.cents) !== Number(expectedProduct.cents)) {
      throw Object.assign(new Error("Registro de pagamento inconsistente."), { status: 400 });
    }
    if (p.credited_at) {
      const b = await client.query("SELECT balance FROM credit_accounts WHERE id=$1", [p.account_id]);
      await client.query("COMMIT");
      return { accountId: p.account_id, balance: b.rows[0].balance, alreadyCredited: true };
    }
    if (!checked.paid || Number(p.cents) !== Number(checked.payload.cents)) throw Object.assign(new Error("Pagamento ainda não confirmado."), { status: 402 });
    // A transação de compra é a trava idempotente definitiva. Só incrementa
    // o saldo se esta correlation_id ainda não tiver sido creditada.
    const purchase = await client.query(
      "INSERT INTO credit_transactions(account_id,type,quantity,reference) VALUES($1,'purchase',$2,$3) ON CONFLICT(type,reference) DO NOTHING RETURNING id",
      [p.account_id, p.credits, p.correlation_id]
    );
    if (purchase.rowCount) {
      const credited = await client.query(
        "UPDATE credit_accounts SET balance=balance+$1, updated_at=NOW() WHERE id=$2 RETURNING balance",
        [p.credits, p.account_id]
      );
      if (!credited.rowCount) throw Object.assign(new Error("Conta de créditos não encontrada."), { status: 409 });
    }
    await client.query("UPDATE payments SET status='completed', credited_at=COALESCE(credited_at,NOW()) WHERE correlation_id=$1", [p.correlation_id]);
    // Venda real: registrada somente após confirmação do provedor e dentro da mesma transação do crédito.
    // correlation_id + índice único tornam o evento idempotente e impedem contagem duplicada.
    await client.query(
      "INSERT INTO funnel_events(session_id,event_name,product,amount_cents,is_test,correlation_id) VALUES($1,'pix_pago',$2,$3,FALSE,$4) ON CONFLICT DO NOTHING",
      [p.funnel_session_id || ("pay_" + crypto.createHash("sha256").update(p.correlation_id).digest("hex").slice(0,24)), p.product, Number(p.cents), p.correlation_id]
    );
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

async function finishCreditQuery(accountId, queryId, ok, vehicle = null) {
  requireDatabase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const q = await client.query("SELECT * FROM vehicle_queries WHERE id=$1 AND account_id=$2 FOR UPDATE", [queryId, accountId]);
    if (!q.rowCount) throw new Error("Consulta não encontrada.");
    if (q.rows[0].status !== "pending") { await client.query("COMMIT"); return; }
    if (ok) {
      const storedVehicle = vehicle && typeof vehicle === "object" ? { ...vehicle, report360: buildVehicle360Report(vehicle) } : { report360: buildVehicle360Report({}) };
      await client.query("UPDATE vehicle_queries SET status='completed',completed_at=NOW(),result_json=$2::jsonb WHERE id=$1", [queryId, JSON.stringify(storedVehicle)]);
    } else {
      // O registro de refund é a trava idempotente. O saldo só volta a subir
      // quando este queryId recebe seu primeiro estorno efetivo.
      const refund = await client.query(
        "INSERT INTO credit_transactions(account_id,type,quantity,reference,plate) VALUES($1,'refund',1,$2,$3) ON CONFLICT(type,reference) DO NOTHING RETURNING id",
        [accountId, queryId, q.rows[0].plate]
      );
      if (refund.rowCount) {
        const restored = await client.query(
          "UPDATE credit_accounts SET balance=balance+1,updated_at=NOW() WHERE id=$1 RETURNING balance",
          [accountId]
        );
        if (!restored.rowCount) throw Object.assign(new Error("Conta de créditos não encontrada para estorno."), { status: 409 });
      }
      await client.query("UPDATE vehicle_queries SET status='failed',completed_at=NOW() WHERE id=$1", [queryId]);
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

    const method = String(options.method || "GET").toUpperCase();
    const request = https.request(parsed, { method, headers }, response => {
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
        resolve({
          status: response.statusCode || 502,
          data,
          raw,
          requestUrl: parsed.toString(),
          method,
          location: response.headers.location || null,
          responseHeaders: {
            allow: response.headers.allow || null,
            server: response.headers.server || null,
            contentType: response.headers["content-type"] || null,
            via: response.headers.via || null
          }
        });
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

function firstDefined(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  }
  return null;
}

function boolIndicator(vehicle, keys) {
  const value = firstDefined(vehicle, keys);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true","sim","s","1","consta","positivo","com restricao","com restrição"].includes(v)) return true;
    if (["false","nao","não","n","0","nada consta","negativo","sem restricao","sem restrição"].includes(v)) return false;
  }
  return null;
}

// Whitelist: aproveita somente campos conhecidos do provedor e nunca expõe o JSON bruto.
function safeVehicleDetails(vehicle, plate) {
  const fipeRaw = firstDefined(vehicle, ["fipe","tabelaFipe","valorFipe"]);
  const technicalRaw = firstDefined(vehicle, ["technical","dadosTecnicos","fichaTecnica"]) || {};
  const documentsRaw = firstDefined(vehicle, ["documents","documentos"]) || {};
  const restrictionsRaw = firstDefined(vehicle, ["restrictions","restricoes","restrições"]);
  const restrictions = Array.isArray(restrictionsRaw)
    ? restrictionsRaw.map(x => typeof x === "string" ? x : firstDefined(x, ["description","descricao","tipo","name","nome"])).filter(Boolean).slice(0,50)
    : null;

  let fipe = null;
  if (fipeRaw && typeof fipeRaw === "object") {
    fipe = {
      value: firstDefined(fipeRaw, ["value","valor","preco","preço"]),
      numericValue: firstDefined(fipeRaw, ["numericValue","valorNumerico","valor_numerico"]),
      code: firstDefined(fipeRaw, ["code","codigo","codigoFipe","codigo_fipe"])
    };
  } else if (fipeRaw !== null) {
    fipe = { value: fipeRaw, numericValue: null, code: null };
  }

  return {
    plate,
    brand: firstDefined(vehicle, ["brand","marca"]),
    model: firstDefined(vehicle, ["model","modelo"]),
    year: firstDefined(vehicle, ["year","ano","fabricationYear","anoFabricacao"]),
    modelYear: firstDefined(vehicle, ["modelYear","anoModelo"]),
    color: firstDefined(vehicle, ["color","cor"]),
    city: firstDefined(vehicle, ["city","municipio","cidade"]),
    state: firstDefined(vehicle, ["state","uf"]),
    fuel: firstDefined(vehicle, ["fuel","combustivel"]),
    type: firstDefined(vehicle, ["type","tipo","tipoVeiculo"]),
    renavam: firstDefined(vehicle, ["renavam","RENAVAM"]),
    chassis: firstDefined(vehicle, ["chassis","chassi"]),
    status: firstDefined(vehicle, ["status","situacao","situação"]),
    fipe,
    indicators: {
      theft: boolIndicator(vehicle, ["theft","rouboFurto","roubo_furto"]),
      auction: boolIndicator(vehicle, ["auction","leilao","leilão"]),
      recall: boolIndicator(vehicle, ["recall"]),
      renajud: boolIndicator(vehicle, ["renajud","RENAJUD"]),
      renainf: boolIndicator(vehicle, ["renainf","RENAINF"]),
      saleCommunication: boolIndicator(vehicle, ["saleCommunication","comunicacaoVenda","comunicacao_venda"]),
      documentationPending: boolIndicator(vehicle, ["documentationPending","pendenciaDocumental","pendencia_documental"]),
      rfb: boolIndicator(vehicle, ["rfb","restricaoRfb","restricao_rfb"]),
      alarm: boolIndicator(vehicle, ["alarm","alarme"]),
      siniav: boolIndicator(vehicle, ["siniav","SINIAV"]),
      chassisRemarked: boolIndicator(vehicle, ["chassisRemarked","chassiRemarcado","remarcacaoChassi"])
    },
    restrictions,
    technical: {
      engine: firstDefined(technicalRaw, ["engine","motor"]),
      transmission: firstDefined(technicalRaw, ["transmission","cambio","câmbio"]),
      displacement: firstDefined(technicalRaw, ["displacement","cilindrada"]),
      power: firstDefined(technicalRaw, ["power","potencia","potência"]),
      axles: firstDefined(technicalRaw, ["axles","eixos"]),
      bodyType: firstDefined(technicalRaw, ["bodyType","carroceria"]),
      category: firstDefined(technicalRaw, ["category","categoria"]),
      species: firstDefined(technicalRaw, ["species","especie","espécie"]),
      grossWeight: firstDefined(technicalRaw, ["grossWeight","pesoBrutoTotal"]),
      loadCapacity: firstDefined(technicalRaw, ["loadCapacity","capacidadeCarga"]),
      maxTraction: firstDefined(technicalRaw, ["maxTraction","tracaoMaxima","traçãoMáxima"]),
      passengers: firstDefined(technicalRaw, ["passengers","passageiros"])
    },
    documents: {
      crvIssuedAt: firstDefined(documentsRaw, ["crvIssuedAt","emissaoCrv","emissao_crv"]),
      crlvIssuedAt: firstDefined(documentsRaw, ["crlvIssuedAt","emissaoCrlv","emissao_crlv"])
    }
  };
}

// Matriz estática de cobertura: não chama nenhum provedor e não consome créditos.
// Serve para decidir a arquitetura antes de habilitar qualquer integração paga.
const VEHICLE_PROVIDER_COVERAGE = Object.freeze({
  basicVehicle:       { falcon: true,  fontedata: true,  credpro: true  },
  technicalData:      { falcon: true,  fontedata: true,  credpro: true  },
  fipe:               { falcon: true,  fontedata: true,  credpro: false },
  theft:              { falcon: true,  fontedata: null,  credpro: true  },
  lien:               { falcon: null,  fontedata: null,  credpro: true  },
  auction:            { falcon: null,  fontedata: null,  credpro: true  },
  auctionScore:       { falcon: false, fontedata: false, credpro: true  },
  accidentClaim:      { falcon: null,  fontedata: null,  credpro: true  },
  renajud:            { falcon: null,  fontedata: null,  credpro: true  },
  renainfFines:       { falcon: null,  fontedata: null,  credpro: true  },
  ipvaPending:        { falcon: null,  fontedata: null,  credpro: true  },
  recall:             { falcon: null,  fontedata: null,  credpro: true  },
  ownershipHistory:   { falcon: false, fontedata: false, credpro: true  },
  checklist:          { falcon: false, fontedata: false, credpro: true  }
});

// Mapeamento passivo da CredPro para o modelo interno do relatório.
// Não realiza chamadas externas e não está conectado ao fluxo dos clientes.
function normalizeCredProResult(payload, fallbackPlate = "") {
  const root = payload && typeof payload === "object" ? payload : {};
  const results = Array.isArray(root.resultados) ? root.resultados : [];
  const byItem = Object.fromEntries(results.filter(x => x && x.item).map(x => [x.item, x.dados || {}]));
  const estadual = byItem.bin_estadual?.VEICULAR?.BIN_ESTADUAL || {};
  const nacional = byItem.bin_nacional?.VEICULAR?.BIN_NACIONAL || {};
  const base = Object.keys(estadual).length ? estadual : nacional;
  const restr = estadual.RESTRICOES || nacional.RESTRICOES || {};
  const gravames = byItem.gravame?.dados?.VEICULAR?.GRAVAME?.OCORRENCIAS || [];
  const leilao = byItem.leilao_completo?.VEICULAR?.LEILAO_CONJUGADO || {};
  const sinistro = byItem.sinistro?.VEICULAR?.INDICIO_SINISTRO_CONJUGADO || {};
  const renajudRoot = byItem.renajud?.dados?.VEICULAR || {};
  const recalls = Array.isArray(byItem.recall?.recalls) ? byItem.recall.recalls : [];
  const owners = Array.isArray(byItem.historico_proprietarios?.registros) ? byItem.historico_proprietarios.registros : [];
  const auctionOccurrences = Array.isArray(leilao.OCORRENCIAS) ? leilao.OCORRENCIAS : [];
  const auctionFirst = auctionOccurrences[0] || {};
  const auctionEvents = Array.isArray(auctionFirst.OCORRENCIAS) ? auctionFirst.OCORRENCIAS : [];
  const sinistroEvents = Array.isArray(sinistro.OCORRENCIAS) ? sinistro.OCORRENCIAS : [];
  const fines = Array.isArray(renajudRoot.RENAINF?.OCORRENCIAS) ? renajudRoot.RENAINF.OCORRENCIAS : [];
  return {
    plate: String(base.PLACA || root.placa || fallbackPlate || "").trim().toUpperCase() || null,
    brandModel: base.MARCA_MODELO || null,
    fabricationYear: base.ANO_FABRICACAO || null,
    modelYear: base.ANO_MODELO || null,
    color: base.COR_VEICULO || null,
    city: base.MUNICIPIO || null,
    state: base.UF || null,
    fuel: base.COMBUSTIVEL || null,
    type: base.TIPO_VEICULO || null,
    renavam: base.RENAVAM || null,
    chassis: base.CHASSI || null,
    status: base.SITUACAO || null,
    origin: base.PROCEDENCIA || null,
    category: base.CATEGORIA_VEICULO || null,
    species: base.ESPECIE_VEICULO || null,
    technical: { displacement: base.CILINDRADA || null, power: base.POTENCIA_VEICULO || null, axles: base.NUMERO_EIXOS || null, passengers: base.QUANTIDADE_PASSAGEIROS || null },
    indicators: {
      theft: restr.EXISTE_RESTRICAO_ROUBO_FURTO === "1",
      auction: auctionOccurrences.length > 0,
      accidentClaim: sinistroEvents.some(x => String(x.EXISTE_OCORRENCIA) === "1"),
      lien: gravames.length > 0,
      renajud: String(restr.EXISTE_RESTRICAO_RENAJUD) === "1" || Number(renajudRoot.RENAJUD?.QUANTIDADE_OCORRENCIAS || 0) > 0,
      renainf: fines.length > 0,
      recall: recalls.length > 0,
      ipvaPending: String(restr.IPVA?.EXISTE_PENDENCIA) === "1"
    },
    auction: { count: auctionEvents.length, score: auctionFirst.SCORE?.PONTUACAO || null, damage: auctionFirst.SCORE?.DESCRICAO_PONTUACAO || null, acceptance: auctionFirst.SCORE?.ACEITACAO || null },
    accidentClaim: { count: sinistroEvents.length, descriptions: sinistroEvents.map(x => x.DESCRICAO_OCORRENCIA).filter(Boolean).slice(0, 20) },
    lien: { active: gravames.some(x => /ATIVO/i.test(String(x.STATUS_GRAVAME || ""))), count: gravames.length },
    debts: { ipvaPending: String(restr.IPVA?.EXISTE_PENDENCIA) === "1", ipvaValue: restr.IPVA?.VALOR_PENDENCIA || null, finesCount: fines.length, finesTotal: fines.reduce((sum, x) => sum + (Number(String(x.VALOR || "0").replace(".", "").replace(",", ".")) || 0), 0) },
    recalls: recalls.slice(0, 20).map(x => ({ campaign: x.campanha || null, startDate: x.data_inicio || null, status: x.status || null })),
    ownershipHistory: { count: owners.length, records: owners.slice(0, 20).map(x => ({ year: x.ano || null, transferDate: x.data_transferencia || null, city: x.municipio || null, state: x.uf || null, documentType: x.tp_doc || null })) },
    source: { provider: "credpro", sandbox: root.sandbox === true, chargedValue: Number(root.valor_cobrado || 0) }
  };
}

// Combina relatórios já normalizados sem realizar chamadas externas.
// O provedor principal sempre vence; o complementar só preenche campos ausentes.
function mergeVehicleReports(primary, complementary) {
  const a = primary && typeof primary === "object" ? primary : {};
  const b = complementary && typeof complementary === "object" ? complementary : {};

  const mergeObject = (left, right) => {
    const out = { ...(right && typeof right === "object" ? right : {}), ...(left && typeof left === "object" ? left : {}) };
    for (const key of Object.keys(out)) {
      const lv = left && typeof left === "object" ? left[key] : undefined;
      const rv = right && typeof right === "object" ? right[key] : undefined;
      if (lv && rv && typeof lv === "object" && typeof rv === "object" && !Array.isArray(lv) && !Array.isArray(rv)) {
        out[key] = mergeObject(lv, rv);
      } else if (lv === undefined || lv === null || lv === "") {
        out[key] = rv ?? null;
      }
    }
    return out;
  };

  return mergeObject(a, b);
}


// Relatório 360: camada de apresentação/decisão construída apenas com dados já
// retornados pelos provedores. Não chama APIs e não altera o fluxo de pagamento.
function buildVehicle360Report(vehicle, providerCoverage = VEHICLE_PROVIDER_COVERAGE) {
  const v = vehicle && typeof vehicle === "object" ? vehicle : {};
  const has = value => {
    if (value === null || value === undefined || value === "") return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.values(value).some(has);
    return true;
  };
  const indicator = key => v.indicators && typeof v.indicators[key] === "boolean" ? v.indicators[key] : null;
  const item = (id, title, value, detail, coverageKey) => {
    const available = value !== null && value !== undefined;
    return {
      id, title,
      status: available ? (value ? "atencao" : "sem_ocorrencia_retornada") : "nao_informado",
      detail: available ? detail : "Informação não retornada pelas fontes usadas nesta consulta.",
      coverage: providerCoverage[coverageKey] || null
    };
  };

  const alerts = [
    item("roubo_furto", "Roubo e furto", indicator("theft"), indicator("theft") ? "A fonte retornou indicação de roubo/furto. Confira a ocorrência antes da compra." : "Nenhuma indicação de roubo/furto foi retornada pela fonte consultada.", "theft"),
    item("leilao", "Leilão", indicator("auction"), indicator("auction") ? "Há informação de leilão no retorno consultado." : "Nenhuma informação de leilão foi retornada pela fonte consultada.", "auction"),
    item("sinistro", "Sinistro", indicator("accidentClaim"), indicator("accidentClaim") ? "Há indício de sinistro no retorno consultado." : "Nenhum indício de sinistro foi retornado pela fonte consultada.", "accidentClaim"),
    item("gravame", "Gravame", indicator("lien"), indicator("lien") ? "Há informação de gravame no retorno consultado." : "Nenhum gravame foi retornado pela fonte consultada.", "lien"),
    item("renajud", "RENAJUD", indicator("renajud"), indicator("renajud") ? "Há restrição RENAJUD no retorno consultado." : "Nenhuma restrição RENAJUD foi retornada pela fonte consultada.", "renajud"),
    item("multas", "Multas / RENAINF", indicator("renainf"), indicator("renainf") ? "Há multas/ocorrências RENAINF no retorno consultado." : "Nenhuma multa/ocorrência RENAINF foi retornada pela fonte consultada.", "renainfFines"),
    item("ipva", "IPVA", indicator("ipvaPending"), indicator("ipvaPending") ? "Há pendência de IPVA no retorno consultado." : "Nenhuma pendência de IPVA foi retornada pela fonte consultada.", "ipvaPending"),
    item("recall", "Recall", indicator("recall"), indicator("recall") ? "Há campanha de recall no retorno consultado." : "Nenhuma campanha de recall foi retornada pela fonte consultada.", "recall")
  ];

  const attentionCount = alerts.filter(x => x.status === "atencao").length;
  const informedCount = alerts.filter(x => x.status !== "nao_informado").length;
  const checklist = [
    "Confirme placa, chassi e RENAVAM diretamente no veículo e nos documentos.",
    "Compare o estado físico do veículo com eventuais registros de leilão ou sinistro.",
    "Consulte débitos e restrições novamente próximo da transferência, pois podem mudar.",
    "Verifique recalls pendentes e solicite comprovantes de atendimento quando aplicável.",
    "Faça inspeção mecânica e estrutural independente antes de concluir a compra.",
    "Confira a identidade e a legitimidade do vendedor antes de qualquer pagamento."
  ];

  return {
    version: 1,
    title: "Relatório 360",
    generatedFromProviderData: true,
    summary: {
      attentionCount,
      informedChecks: informedCount,
      totalChecks: alerts.length,
      message: attentionCount
        ? `${attentionCount} ponto(s) merecem conferência antes da compra.`
        : informedCount === alerts.length
          ? "Nenhuma ocorrência foi retornada nos principais indicadores consultados."
          : "Não houve ocorrência nos indicadores informados, mas algumas informações não foram retornadas pelas fontes."
    },
    vehicle: {
      plate: v.plate || null,
      brand: v.brand || null,
      model: v.model || null,
      brandModel: v.brandModel || null,
      fabricationYear: v.fabricationYear || null,
      modelYear: v.modelYear || null,
      color: v.color || null,
      city: v.city || null,
      state: v.state || null,
      fuel: v.fuel || null,
      chassis: v.chassis || null,
      renavam: v.renavam || null
    },
    alerts,
    details: {
      fipe: has(v.fipe) ? v.fipe : null,
      technical: has(v.technical) ? v.technical : null,
      auction: has(v.auction) ? v.auction : null,
      accidentClaim: has(v.accidentClaim) ? v.accidentClaim : null,
      lien: has(v.lien) ? v.lien : null,
      debts: has(v.debts) ? v.debts : null,
      recalls: has(v.recalls) ? v.recalls : null,
      ownershipHistory: has(v.ownershipHistory) ? v.ownershipHistory : null
    },
    checklist,
    disclaimer: "O relatório consolida dados retornados pelas fontes consultadas e não substitui vistoria, consulta oficial atualizada ou análise documental. Ausência de ocorrência no retorno não garante inexistência do fato."
  };
}

function analyzeVehicle360Coverage(vehicle) {
  const v = vehicle && typeof vehicle === "object" ? vehicle : {};
  const i = v.indicators && typeof v.indicators === "object" ? v.indicators : {};
  const present = value => value !== null && value !== undefined && value !== "";
  const explicit = value => typeof value === "boolean";

  const checks = [
    ["Dados básicos", present(v.brand) || present(v.model) || present(v.brandModel)],
    ["Dados técnicos", !!(v.technical && Object.values(v.technical).some(present))],
    ["FIPE", !!(v.fipe && Object.values(v.fipe).some(present))],
    ["Roubo / furto", explicit(i.theft)],
    ["Leilão", explicit(i.auction) || !!v.auction],
    ["Sinistro", explicit(i.accidentClaim) || !!v.accidentClaim],
    ["Gravame", explicit(i.lien) || !!v.lien],
    ["RENAJUD", explicit(i.renajud)],
    ["Multas / RENAINF", explicit(i.renainf) || !!(v.debts && present(v.debts.finesCount))],
    ["IPVA pendente", explicit(i.ipvaPending) || !!(v.debts && explicit(v.debts.ipvaPending))],
    ["Recall", explicit(i.recall) || (Array.isArray(v.recalls) && v.recalls.length > 0)],
    ["Histórico de proprietários", !!(v.ownershipHistory && (present(v.ownershipHistory.count) || (Array.isArray(v.ownershipHistory.records) && v.ownershipHistory.records.length > 0)))]
  ];

  const available = checks.filter(x => x[1]).map(x => x[0]);
  const missing = checks.filter(x => !x[1]).map(x => x[0]);
  return {
    total: checks.length,
    availableCount: available.length,
    missingCount: missing.length,
    available,
    missing,
    note: "Cobertura calculada apenas pelos campos efetivamente presentes no relatório. Campo ausente não significa ausência de ocorrência."
  };
}

function recommendCredProModulesFromCoverage(coverage, maxCost = 5) {
  const missing = new Set(coverage && Array.isArray(coverage.missing) ? coverage.missing : []);
  const catalog = [
    { item:"recall", price:0.90, covers:["Recall"], priority:90 },
    { item:"gravame", price:3.00, covers:["Gravame"], priority:100 },
    { item:"sinistro", price:3.30, covers:["Sinistro"], priority:100 },
    { item:"renajud", price:4.10, covers:["RENAJUD"], priority:95 },
    { item:"renainf", price:4.15, covers:["Multas / RENAINF"], priority:90 },
    { item:"leilao", price:5.50, covers:["Leilão"], priority:100 },
    { item:"historico_proprietarios", price:6.00, covers:["Histórico de proprietários"], priority:70 },
    { item:"leilao_completo", price:11.00, covers:["Leilão","Sinistro"], priority:100 }
  ];

  const wanted = catalog.filter(x => x.covers.some(g => missing.has(g)));
  let best = { items:[], cost:0, score:0, covered:new Set() };
  const n = wanted.length;
  for (let mask=1; mask < (1 << n); mask++) {
    let cost=0, score=0; const items=[], covered=new Set();
    for (let j=0;j<n;j++) if(mask & (1<<j)) {
      const x=wanted[j]; cost+=x.price; items.push(x);
      for(const g of x.covers) if(missing.has(g)) covered.add(g);
    }
    if(cost > maxCost + 1e-9) continue;
    for(const g of covered) {
      const candidates=wanted.filter(x=>x.covers.includes(g));
      score += Math.max(...candidates.map(x=>x.priority));
    }
    const better = score>best.score || (score===best.score && covered.size>best.covered.size) || (score===best.score && covered.size===best.covered.size && cost<best.cost);
    if(better) best={items,cost,score,covered};
  }

  return {
    mode:"budget_optimizer",
    apiCallsMade:0,
    maxCost:Number(maxCost.toFixed(2)),
    estimatedCost:Number(best.cost.toFixed(2)),
    selected:best.items.map(x=>({item:x.item,price:x.price,covers:x.covers.filter(g=>missing.has(g))})),
    coveredMissingGroups:[...best.covered],
    stillMissing:[...missing].filter(g=>!best.covered.has(g)),
    note:"Combinação calculada localmente com preços do catálogo CredPro Sandbox. Não executa módulos nem consome saldo."
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
    `${WOOVI_API_URL}/charge?return_existing=true`,
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

async function listWooviChargesDiagnostic() {
  const response = await requestJson(
    WOOVI_API_URL + "/charge",
    { headers: openPixHeaders(), timeout: 15000 }
  );
  const charges = response.data && Array.isArray(response.data.charges) ? response.data.charges : [];
  console.log("WOOVI LIST cobranças diagnóstico:", JSON.stringify({
    method: "GET",
    requestUrl: WOOVI_API_URL + "/charge",
    httpStatus: response.status,
    totalRetornado: charges.length,
    charges: charges.slice(0, 50).map((charge) => ({
      id: charge.globalID || charge.id || charge.identifier || null,
      correlationID: charge.correlationID || null,
      status: charge.status || null,
      value: charge.value || null,
      createdAt: charge.createdAt || null
    })),
    providerError: response.status >= 200 && response.status < 300 ? null : (response.data || response.raw || null)
  }));
  return { response, charges };
}

async function getOpenPixCharge(correlationID) {
  const key = String(correlationID || "");
  const cached = confirmedPaymentCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.charge;

  const response = await requestJson(
    `${WOOVI_API_URL}/charge/${encodeURIComponent(key)}`,
    { headers: openPixHeaders(), timeout: 15000 }
  );
  const charge = response.data && response.data.charge ? response.data.charge : null;
  if (response.status < 200 || response.status >= 300 || !charge || typeof charge !== "object") {
    const err = new Error("Não foi possível verificar o pagamento na Woovi/OpenPix.");
    err.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    err.providerHttpStatus = response.status;
    err.providerResponse = response.data || null;
    err.providerRaw = response.raw ? String(response.raw).slice(0, 2000) : null;
    err.requestUrl = response.requestUrl || (WOOVI_API_URL + "/charge/" + encodeURIComponent(key));
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

function requireAdminSecret(req, res) {
  const supplied = String(req.get("X-Admin-Secret") || "").trim();
  if (!ADMIN_FUNNEL_SECRET || ADMIN_FUNNEL_SECRET.length < 24 || !secureEqual(supplied, ADMIN_FUNNEL_SECRET)) {
    res.status(404).json({ error: "Endpoint não encontrado." });
    return false;
  }
  return true;
}

app.get("/api/admin/cobrancas-teste", async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  try {
    requireDatabase();
    const rows = await pool.query(
      "SELECT correlation_id, product, cents, credits, status, credited_at, created_at FROM payments WHERE correlation_id LIKE 'cv-%' ORDER BY created_at DESC LIMIT 200"
    );

    // A Woovi é a fonte de verdade para cobranças ainda existentes no provedor.
    // Fazemos uma única listagem e cruzamos pelo correlationID, evitando GETs
    // individuais que retornam 400 para registros locais antigos.
    const listed = await listWooviChargesDiagnostic();
    if (listed.response.status < 200 || listed.response.status >= 300) {
      return res.status(502).json({ error: "Não foi possível sincronizar as cobranças com a Woovi." });
    }
    const byCorrelation = new Map(
      listed.charges
        .filter(c => c && c.correlationID)
        .map(c => [String(c.correlationID), c])
    );

    const cobrancas = [];
    let registrosLocaisAusentesNaWoovi = 0;
    for (const p of rows.rows) {
      const charge = byCorrelation.get(String(p.correlation_id));
      if (!charge) {
        registrosLocaisAusentesNaWoovi += 1;
        continue; // não mostra lixo histórico no painel administrativo
      }
      const providerStatus = String(charge.status || "").toUpperCase() || "DESCONHECIDO";
      cobrancas.push({
        correlationID: p.correlation_id,
        providerChargeID: charge.globalID || charge.id || charge.identifier || null,
        produto: p.product,
        valorCentavos: Number(p.cents),
        creditos: Number(p.credits),
        statusLocal: p.status,
        statusWoovi: providerStatus,
        creditado: Boolean(p.credited_at),
        criadoEm: p.created_at,
        podeExcluir: providerStatus !== "COMPLETED" && !p.credited_at
      });
    }

    console.log("WOOVI SYNC painel:", JSON.stringify({
      locais: rows.rowCount,
      encontradosNaWoovi: cobrancas.length,
      locaisAusentesNaWoovi: registrosLocaisAusentesNaWoovi
    }));
    // Também expõe, separadamente, cobranças que existem na Woovi mas não
    // possuem registro local correspondente. Elas ficam apenas para conferência;
    // não recebem autorização automática de exclusão.
    const localIDs = new Set(rows.rows.map(p => String(p.correlation_id)));
    const somenteWoovi = listed.charges
      .filter(c => c && c.correlationID && !localIDs.has(String(c.correlationID)))
      .map(c => ({
        correlationID: String(c.correlationID),
        providerChargeID: c.globalID || c.id || c.identifier || null,
        valorCentavos: Number(c.value || 0),
        statusWoovi: String(c.status || "").toUpperCase() || "DESCONHECIDO",
        criadoEm: c.createdAt || null,
        somenteWoovi: true,
        podeExcluir: false
      }));

    res.json({
      ok: true,
      total: cobrancas.length,
      cobrancas,
      somenteWoovi,
      sincronizacao: {
        registrosLocais: rows.rowCount,
        encontradosNaWoovi: cobrancas.length,
        ocultadosPorNaoExistiremNaWoovi: registrosLocaisAusentesNaWoovi,
        encontradosSomenteNaWoovi: somenteWoovi.length
      }
    });
  } catch (err) {
    console.error("Falha ao listar cobranças administrativas:", err.message);
    res.status(500).json({ error: "Falha ao listar cobranças." });
  }
});

app.delete("/api/admin/cobrancas-teste-woovi/:correlationID", async (req, res) => {
  const correlationIDEntrada = String(req.params.correlationID || "").trim();
  console.log("ADMIN DELETE Woovi recebido:", JSON.stringify({
    correlationID: correlationIDEntrada,
    method: req.method,
    path: req.path,
    possuiAdminSecret: Boolean(req.get("X-Admin-Secret"))
  }));
  if (!requireAdminSecret(req, res)) {
    console.warn("ADMIN DELETE Woovi bloqueado: autenticação administrativa inválida.", JSON.stringify({
      correlationID: correlationIDEntrada
    }));
    return;
  }
  console.log("ADMIN DELETE Woovi autenticado:", JSON.stringify({ correlationID: correlationIDEntrada }));
  try {
    requireDatabase();
    const correlationID = String(req.params.correlationID || "").trim();
    if (!correlationID.startsWith("cv-") || correlationID.length > 160) {
      return res.status(400).json({ error: "Cobrança inválida." });
    }

    // Segurança: esta rota é exclusiva para órfãs (existem na Woovi, não no banco local).
    const local = await pool.query(
      "SELECT correlation_id, credited_at FROM payments WHERE correlation_id=$1 LIMIT 1",
      [correlationID]
    );
    if (local.rowCount) {
      return res.status(409).json({ error: "Esta cobrança possui registro local e não pode ser excluída por esta rota." });
    }

    // Reconsulta a Woovi imediatamente antes do DELETE.
    const listed = await listWooviChargesDiagnostic();
    if (listed.response.status < 200 || listed.response.status >= 300) {
      return res.status(502).json({ error: "Não foi possível reconferir as cobranças na Woovi." });
    }
    const charge = listed.charges.find(c => String(c.correlationID || "") === correlationID);
    if (!charge) return res.status(404).json({ error: "Cobrança não encontrada na Woovi." });

    const status = String(charge.status || "").toUpperCase();
    if (status !== "EXPIRED") {
      return res.status(409).json({ error: "Somente cobranças EXPIRED podem ser excluídas por esta rota." });
    }

    const providerChargeID = String(charge.globalID || charge.id || charge.identifier || "").trim();
    if (!providerChargeID || providerChargeID.length > 300) {
      return res.status(502).json({ error: "Identificador da Woovi inválido." });
    }

    const deleteUrl = WOOVI_API_URL + "/charge/" + encodeURIComponent(providerChargeID);
    console.log("WOOVI DELETE órfã tentativa:", JSON.stringify({
      correlationID, providerChargeID, status, method: "DELETE", requestUrl: deleteUrl
    }));
    const response = await requestJson(
      deleteUrl,
      { method: "DELETE", headers: openPixHeaders(), timeout: 15000 }
    );
    console.log("WOOVI DELETE órfã resposta:", JSON.stringify({
      correlationID, providerChargeID, httpStatus: response.status,
      location: response.location || null, responseHeaders: response.responseHeaders || {},
      response: response.data || response.raw || null
    }));
    if (response.status < 200 || response.status >= 300) {
      const providerMessage = response.data && (response.data.error || response.data.message);
      return res.status(response.status === 400 ? 409 : 502).json({
        error: providerMessage ? "Woovi: " + String(providerMessage).slice(0, 180) : "A Woovi não confirmou a exclusão.",
        providerHttpStatus: response.status
      });
    }
    confirmedPaymentCache.delete(correlationID);
    res.json({ ok: true, correlationID, providerHttpStatus: response.status });
  } catch (err) {
    console.error("Falha ao excluir cobrança órfã da Woovi:", err.message);
    res.status(500).json({ error: "Falha ao excluir cobrança da Woovi." });
  }
});

app.delete("/api/admin/cobrancas-teste/:correlationID", async (req, res) => {
  console.log("ADMIN DELETE entrada:", JSON.stringify({
    method: req.method,
    path: req.originalUrl,
    correlationID: String(req.params.correlationID || "").slice(0, 160),
    hasAdminSecret: Boolean(req.get("X-Admin-Secret"))
  }));
  if (!requireAdminSecret(req, res)) {
    console.warn("ADMIN DELETE bloqueado: chave administrativa ausente ou inválida.");
    return;
  }
  console.log("ADMIN DELETE autenticado:", String(req.params.correlationID || "").slice(0, 160));
  try {
    requireDatabase();
    const correlationID = String(req.params.correlationID || "").trim();
    if (!correlationID.startsWith("cv-") || correlationID.length > 160) {
      return res.status(400).json({ error: "Cobrança inválida." });
    }
    const found = await pool.query(
      "SELECT correlation_id, credited_at FROM payments WHERE correlation_id=$1 LIMIT 1",
      [correlationID]
    );
    if (!found.rowCount) return res.status(404).json({ error: "Cobrança não encontrada." });
    if (found.rows[0].credited_at) return res.status(409).json({ error: "Cobrança creditada não pode ser excluída." });

    // O endpoint individual da Woovi não aceita nosso correlationID em todos os casos.
    // Resolve primeiro a cobrança pela listagem e usa o ID real retornado pelo provedor.
    const listed = await listWooviChargesDiagnostic();
    if (listed.response.status < 200 || listed.response.status >= 300) {
      return res.status(502).json({ error: "Não foi possível listar as cobranças na Woovi." });
    }
    const charge = listed.charges.find(c => String(c.correlationID || "") === correlationID);
    if (!charge) {
      return res.status(404).json({ error: "Cobrança não encontrada na Woovi." });
    }
    if (String(charge.status || "").toUpperCase() === "COMPLETED") {
      return res.status(409).json({ error: "Pagamento concluído não pode ser excluído." });
    }
    const providerChargeID = String(charge.globalID || charge.id || charge.identifier || "").trim();
    if (!providerChargeID || providerChargeID.length > 300) {
      return res.status(502).json({ error: "A Woovi não retornou um identificador válido para exclusão." });
    }
    const deleteUrl = WOOVI_API_URL + "/charge/" + encodeURIComponent(providerChargeID);
    console.log("WOOVI DELETE tentativa:", JSON.stringify({
      correlationID,
      providerChargeID,
      method: "DELETE",
      requestUrl: deleteUrl
    }));
    const response = await requestJson(
      deleteUrl,
      { method: "DELETE", headers: openPixHeaders(), timeout: 15000 }
    );
    if (response.status < 200 || response.status >= 300) {
      console.error("Woovi DELETE diagnóstico:", JSON.stringify({
        correlationID,
        method: response.method,
        requestUrl: response.requestUrl,
        httpStatus: response.status,
        location: response.location,
        response: response.data || response.raw || null
      }));
      const providerMessage = response.data && (response.data.error || response.data.message);
      return res.status(response.status === 400 ? 409 : 502).json({
        error: providerMessage ? "Woovi: " + String(providerMessage).slice(0, 180) : "A Woovi não confirmou a exclusão da cobrança.",
        providerHttpStatus: response.status,
        providerResponse: response.data || null
      });
    }
    confirmedPaymentCache.delete(correlationID);
    res.json({ ok: true, correlationID });
  } catch (err) {
    console.error("Falha ao excluir cobrança administrativa:", err.message);
    res.status(500).json({ error: "Falha ao excluir cobrança." });
  }
});

app.get("/api/admin/funil", async (req, res) => {
  try {
    requireDatabase();
    const supplied=String(req.get("X-Admin-Secret")||"").trim();
    if(!ADMIN_FUNNEL_SECRET||ADMIN_FUNNEL_SECRET.length<24||supplied.length!==ADMIN_FUNNEL_SECRET.length||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(ADMIN_FUNNEL_SECRET))) return res.status(404).json({error:"Endpoint não encontrado."});
    const days=Math.min(90,Math.max(1,Number(req.query.days)||7));
    // Painel administrativo somente leitura: eventos pix_pago são gravados
    // no processamento transacional do pagamento confirmado, nunca ao abrir o painel.
    const totals=await pool.query(`SELECT event_name,COUNT(*)::int AS total,COUNT(DISTINCT session_id)::int AS sessions FROM funnel_events WHERE created_at>=NOW()-($1::text||' days')::interval AND is_test=FALSE GROUP BY event_name`,[days]);
    const products=await pool.query(`SELECT COALESCE(product,'sem-produto') AS product,event_name,COUNT(DISTINCT session_id)::int AS total,COALESCE(SUM(amount_cents),0)::bigint AS amount_cents FROM funnel_events WHERE created_at>=NOW()-($1::text||' days')::interval AND is_test=FALSE AND event_name IN ('pacote_selecionado','pix_gerado','pix_pago','relatorio_entregue') GROUP BY product,event_name ORDER BY product,event_name`,[days]);
    const devices=await pool.query(`SELECT COALESCE(device,'nao_identificado') AS device,event_name,COUNT(DISTINCT session_id)::int AS total FROM funnel_events WHERE created_at>=NOW()-($1::text||' days')::interval AND is_test=FALSE GROUP BY device,event_name ORDER BY device,event_name`,[days]);
    const daily=await pool.query(`SELECT TO_CHAR(created_at AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AS day,event_name,COUNT(DISTINCT session_id)::int AS total FROM funnel_events WHERE created_at>=NOW()-($1::text||' days')::interval AND is_test=FALSE GROUP BY day,event_name ORDER BY day`,[days]);
    const finance=await pool.query(`SELECT COUNT(*)::int AS paid_orders,COALESCE(SUM(cents),0)::bigint AS revenue_cents,COALESCE(SUM(credits),0)::int AS credits_sold FROM payments WHERE status='completed' AND credited_at IS NOT NULL AND created_at>=NOW()-($1::text||' days')::interval`,[days]);
    { const row=finance.rows[0],revenue=Number(row.revenue_cents)||0,credits=Number(row.credits_sold)||0,apiCost=credits*VEHICLE_API_COST_CENTS,paymentFee=Math.round(revenue*PAYMENT_FEE_RATE),profit=Math.max(0,revenue-apiCost-paymentFee);row.api_cost_cents=apiCost;row.payment_fee_cents=paymentFee;row.estimated_profit_cents=profit;row.estimated_margin_pct=revenue?Number((profit/revenue*100).toFixed(1)):0; }
    const financeDaily=await pool.query(`SELECT TO_CHAR(created_at AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AS day,COUNT(*)::int AS paid_orders,COALESCE(SUM(cents),0)::bigint AS revenue_cents,COALESCE(SUM(credits),0)::int AS credits_sold FROM payments WHERE status='completed' AND credited_at IS NOT NULL AND created_at>=NOW()-($1::text||' days')::interval GROUP BY day ORDER BY day`,[days]);
    financeDaily.rows=financeDaily.rows.map(row=>{const revenue=Number(row.revenue_cents)||0,credits=Number(row.credits_sold)||0,apiCost=credits*VEHICLE_API_COST_CENTS,paymentFee=Math.round(revenue*PAYMENT_FEE_RATE),profit=Math.max(0,revenue-apiCost-paymentFee);return {...row,api_cost_cents:apiCost,payment_fee_cents:paymentFee,estimated_profit_cents:profit,estimated_margin_pct:revenue?Number((profit/revenue*100).toFixed(1)):0};});
    const financeByProduct=await pool.query(`SELECT product,COUNT(*)::int AS paid_orders,COALESCE(SUM(cents),0)::bigint AS revenue_cents,COALESCE(SUM(credits),0)::int AS credits_sold FROM payments WHERE status='completed' AND credited_at IS NOT NULL AND created_at>=NOW()-($1::text||' days')::interval GROUP BY product ORDER BY revenue_cents DESC`,[days]);
    financeByProduct.rows=financeByProduct.rows.map(row=>{const revenue=Number(row.revenue_cents)||0,credits=Number(row.credits_sold)||0,apiCost=credits*VEHICLE_API_COST_CENTS,paymentFee=Math.round(revenue*PAYMENT_FEE_RATE),estimatedProfit=Math.max(0,revenue-apiCost-paymentFee);return {...row,api_cost_cents:apiCost,payment_fee_cents:paymentFee,estimated_profit_cents:estimatedProfit,estimated_margin_pct:revenue?Number((estimatedProfit/revenue*100).toFixed(1)):0};});
    return res.json({ok:true,days,totals:totals.rows,products:products.rows,devices:devices.rows,daily:daily.rows,finance:finance.rows[0],financeDaily:financeDaily.rows,financeByProduct:financeByProduct.rows});
  } catch(err){console.error("Falha no painel do funil:",err.message);return res.status(500).json({mensagem:"Não foi possível carregar o painel."})}
});

app.get("/api/admin/monitor-consultas", async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  try {
    requireDatabase();
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const summary = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status='completed')::int AS concluidas,
        COUNT(*) FILTER (WHERE status='failed')::int AS falhas,
        COUNT(*) FILTER (WHERE status='pending')::int AS pendentes
      FROM vehicle_queries
      WHERE created_at >= NOW()-($1::text||' days')::interval
    `, [days]);
    const refunds = await pool.query(`
      SELECT COUNT(*)::int AS total
      FROM credit_transactions
      WHERE type='refund' AND created_at >= NOW()-($1::text||' days')::interval
    `, [days]);
    const row = summary.rows[0];
    const finalized = Number(row.concluidas) + Number(row.falhas);
    res.json({
      ok: true,
      somenteLeitura: true,
      days,
      total: Number(row.total),
      concluidas: Number(row.concluidas),
      falhas: Number(row.falhas),
      pendentes: Number(row.pendentes),
      estornos: Number(refunds.rows[0].total),
      taxaSucesso: finalized ? Number((Number(row.concluidas) / finalized * 100).toFixed(1)) : 0
    });
  } catch (err) {
    console.error("Falha no monitor de consultas:", err.message);
    res.status(500).json({ error: "Falha ao carregar monitor de consultas." });
  }
});

app.get("/api/admin/saude-integracoes", async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const started = Date.now();
  const health = {
    banco: { ok: false, latenciaMs: null },
    woovi: { ok: false, latenciaMs: null, httpStatus: null },
    apiVeicular: { ok: Boolean(FALCON_TOKEN), modo: "configuracao", observacao: "Token configurado; nenhuma consulta veicular foi consumida." }
  };
  try {
    const t = Date.now();
    requireDatabase();
    await pool.query("SELECT 1");
    health.banco = { ok: true, latenciaMs: Date.now() - t };
  } catch {}
  if (OPENPIX_APP_ID) {
    try {
      const t = Date.now();
      const response = await requestJson(WOOVI_API_URL + "/charge", { headers: openPixHeaders(), timeout: 10000 });
      health.woovi = { ok: response.status >= 200 && response.status < 300, latenciaMs: Date.now() - t, httpStatus: response.status };
    } catch {
      health.woovi = { ok: false, latenciaMs: null, httpStatus: null };
    }
  }
  const todosOperacionais = health.banco.ok && health.woovi.ok && health.apiVeicular.ok;
  res.json({ ok: true, somenteLeitura: true, todosOperacionais, integracoes: health, duracaoMs: Date.now() - started, verificadoEm: new Date().toISOString() });
});

app.get("/api/admin/pre-lancamento", async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const checks = [];
  try {
    requireDatabase();
    await pool.query("SELECT 1");
    checks.push({ id:"banco", nome:"Banco PostgreSQL", ok:true, detalhe:"Conexão disponível." });
  } catch { checks.push({ id:"banco", nome:"Banco PostgreSQL", ok:false, detalhe:"Banco indisponível." }); }

  checks.push({ id:"checkout", nome:"Configuração do checkout", ok:Boolean(OPENPIX_APP_ID && PAYMENT_SIGNING_SECRET), detalhe:OPENPIX_APP_ID && PAYMENT_SIGNING_SECRET ? "Credenciais essenciais configuradas." : "Configuração essencial ausente." });
  checks.push({ id:"api-veicular", nome:"Configuração da API veicular", ok:Boolean(FALCON_TOKEN), detalhe:FALCON_TOKEN ? "Token configurado; nenhuma consulta foi consumida." : "Token não configurado." });

  if (OPENPIX_APP_ID) {
    try {
      const response = await requestJson(WOOVI_API_URL + "/charge", { headers: openPixHeaders(), timeout: 10000 });
      checks.push({ id:"woovi", nome:"Woovi / PIX", ok:response.status>=200 && response.status<300, detalhe:"HTTP "+response.status+" em leitura." });
    } catch { checks.push({ id:"woovi", nome:"Woovi / PIX", ok:false, detalhe:"Não foi possível validar a integração." }); }
  } else checks.push({ id:"woovi", nome:"Woovi / PIX", ok:false, detalhe:"App ID não configurado." });

  if (pool) {
    try {
      const integrity = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS total FROM payments p WHERE p.status='completed' AND p.credited_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM credit_transactions ct WHERE ct.type='purchase' AND ct.reference=p.correlation_id)`),
        pool.query(`SELECT COUNT(*)::int AS total FROM credit_transactions ct WHERE ct.type='purchase' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.correlation_id=ct.reference AND p.status='completed' AND p.credited_at IS NOT NULL)`),
        pool.query(`SELECT COUNT(*)::int AS total FROM vehicle_queries WHERE status='pending' AND created_at < NOW()-INTERVAL '5 minutes'`),
        pool.query(`SELECT COUNT(*)::int AS total FROM vehicle_queries vq WHERE vq.status='failed' AND vq.credit_consumed=TRUE AND NOT EXISTS (SELECT 1 FROM credit_transactions ct WHERE ct.type='refund' AND ct.reference=vq.id::text)`),
        pool.query(`SELECT COUNT(*)::int AS total FROM credit_accounts ca WHERE ca.balance <> COALESCE((SELECT SUM(ct.quantity) FROM credit_transactions ct WHERE ct.account_id=ca.id),0)`)
      ]);
      const problems=integrity.reduce((n,q)=>n+Number(q.rows[0].total||0),0);
      checks.push({ id:"integridade", nome:"Pagamentos e créditos", ok:problems===0, detalhe:problems===0 ? "Nenhuma inconsistência encontrada." : problems+" inconsistência(s) encontrada(s)." });
    } catch { checks.push({ id:"integridade", nome:"Pagamentos e créditos", ok:false, detalhe:"Não foi possível verificar a integridade." }); }
  }

  const pronto = checks.length >= 5 && checks.every(c=>c.ok);
  return res.json({ ok:true, somenteLeitura:true, geraCobranca:false, consomeConsulta:false, prontoParaReceberClientes:pronto, verificacoes:checks, verificadoEm:new Date().toISOString() });
});

app.get("/api/admin/integridade", async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  try {
    requireDatabase();
    const checks = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM payments p WHERE p.status='completed' AND p.credited_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM credit_transactions ct WHERE ct.type='purchase' AND ct.reference=p.correlation_id)`),
      pool.query(`SELECT COUNT(*)::int AS total FROM credit_transactions ct WHERE ct.type='purchase' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.correlation_id=ct.reference AND p.status='completed' AND p.credited_at IS NOT NULL)`),
      pool.query(`SELECT COUNT(*)::int AS total FROM vehicle_queries vq WHERE vq.status='pending' AND vq.created_at < NOW()-INTERVAL '5 minutes'`),
      pool.query(`SELECT COUNT(*)::int AS total FROM vehicle_queries vq WHERE vq.status='failed' AND vq.credit_consumed=TRUE AND NOT EXISTS (SELECT 1 FROM credit_transactions ct WHERE ct.type='refund' AND ct.reference=vq.id::text)`),
      pool.query(`SELECT COUNT(*)::int AS total FROM credit_accounts ca WHERE ca.balance <> COALESCE((SELECT SUM(ct.quantity) FROM credit_transactions ct WHERE ct.account_id=ca.id),0)`)
    ]);
    const integrity = {
      pagamentosCreditadosSemCompra: checks[0].rows[0].total,
      comprasSemPagamentoConfirmado: checks[1].rows[0].total,
      consultasPendentesMais5Min: checks[2].rows[0].total,
      consultasFalhasSemEstorno: checks[3].rows[0].total,
      saldosIncompativeis: checks[4].rows[0].total
    };
    const problemas = Object.values(integrity).reduce((sum, value) => sum + Number(value || 0), 0);
    res.json({ ok: true, somenteLeitura: true, saudavel: problemas === 0, problemas, verificacoes: integrity, verificadoEm: new Date().toISOString() });
  } catch (err) {
    console.error("Falha na checagem de integridade:", err.message);
    res.status(500).json({ error: "Falha ao verificar integridade." });
  }
});

app.post("/api/funil/evento", async (req, res) => {
  try {
    requireDatabase();
    const eventName = String(req.body && req.body.event || "").trim();
    const allowed = new Set(["consulta_iniciada","previa_exibida","pacote_selecionado","pix_modal_aberto","pix_email_preenchido","pix_gerado","pix_copiado","pix_modal_fechado_pendente","pix_pendente_retomado","nova_consulta_clique","relatorio_entregue","upsell_pos_consulta_exibido","upsell_pos_consulta_clique"]);
    // pix_pago nunca é aceito do navegador; ele é criado internamente após confirmação da Woovi/OpenPix.
    if (!allowed.has(eventName)) return res.status(400).json({ ok:false });
    const sessionId = String(req.body && req.body.sessionId || "").trim();
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(sessionId)) return res.status(400).json({ ok:false });
    const product = String(req.body && req.body.product || "").trim().slice(0,40) || null;
    const device = ["mobile","desktop"].includes(String(req.body && req.body.device || "").trim()) ? String(req.body.device).trim() : null;
    const plate = normalizePlate(req.body && req.body.plate);
    const plateHash = validPlate(plate) ? crypto.createHash("sha256").update(plate + "|" + PAYMENT_SIGNING_SECRET).digest("hex").slice(0,32) : null;
    const knownProduct = paymentProduct(product);
    const amountCents = eventName === "pix_pago" && knownProduct ? knownProduct.cents : null;
    const testSecret = String(req.get("X-Funnel-Test-Secret") || "").trim();
    const configuredTestSecret = String(process.env.FUNNEL_TEST_SECRET || "").trim();
    const isTest = Boolean(configuredTestSecret && configuredTestSecret.length >= 24 && testSecret.length === configuredTestSecret.length && crypto.timingSafeEqual(Buffer.from(testSecret), Buffer.from(configuredTestSecret)));
    await pool.query(`INSERT INTO funnel_events(session_id,event_name,product,plate_hash,amount_cents,is_test,device)
      SELECT $1,$2,$3,$4,$5,$6,$7
      WHERE NOT EXISTS (
        SELECT 1 FROM funnel_events
        WHERE session_id=$1 AND event_name=$2 AND is_test=$6
          AND COALESCE(product,'')=COALESCE($3,'')
          AND created_at >= NOW()-INTERVAL '24 hours'
      )`, [sessionId,eventName,product,plateHash,amountCents,isTest,device]);
    return res.status(204).end();
  } catch (err) {
    console.error("Falha ao registrar evento do funil:", err.message);
    return res.status(204).end();
  }
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

app.post("/api/creditos/conta", async (req, res) => {
  try {
    const account = await ensureAccount(req.body && req.body.accountToken);
    // O e-mail é opcional ao apenas restaurar/criar a carteira no navegador.
    // Quando informado explicitamente, vincula a carteira para recuperação.
    if (req.body && req.body.email) await bindRecoveryEmail(account.id, req.body.email);
    return res.json({ ok:true, accountToken:account.token, creditos:account.balance });
  } catch(err) { return res.status(err.status || 503).json({ error:"creditos_indisponiveis", mensagem:err.message }); }
});

app.post("/api/creditos/recuperar/solicitar", async (req, res) => {
  const ipLimit = useRateLimit(recoveryRateStore, "request-ip:" + clientIp(req), 5);
  if (!ipLimit.allowed) {
    res.set("Retry-After", String(ipLimit.retryAfter));
    return res.status(429).json({ mensagem: "Muitas solicitações de recuperação. Aguarde antes de tentar novamente." });
  }
  try {
    requireDatabase();
    const email = normalizeEmail(req.body && req.body.email);
    // Limite adicional por endereço: impede que vários IPs sejam usados para bombardear
    // a mesma caixa de entrada com códigos e protege a reputação do remetente.
    const emailKey = crypto.createHash("sha256").update(email).digest("hex");
    const emailLimit = useRateLimit(recoveryRateStore, "request-email:" + emailKey, 3);
    if (!emailLimit.allowed) {
      res.set("Retry-After", String(emailLimit.retryAfter));
      return res.status(429).json({ mensagem: "Muitas solicitações de recuperação. Aguarde antes de tentar novamente." });
    }
    const recent = await pool.query(
      "SELECT created_at FROM credit_recovery_codes WHERE LOWER(email)=LOWER($1) AND created_at>NOW()-INTERVAL '60 seconds' ORDER BY created_at DESC LIMIT 1",
      [email]
    );
    if (recent.rowCount) {
      res.set("Retry-After", "60");
      return res.status(429).json({ mensagem: "Aguarde 60 segundos antes de solicitar outro código." });
    }
    const found = await pool.query("SELECT id FROM credit_accounts WHERE LOWER(email)=LOWER($1) LIMIT 1", [email]);
    // Resposta neutra para não revelar quais e-mails possuem conta.
    if (!found.rowCount) return res.json({ ok: true, mensagem: "Se o e-mail estiver cadastrado, enviaremos um código de recuperação." });
    const accountId = found.rows[0].id;
    await pool.query("UPDATE credit_recovery_codes SET used_at=NOW() WHERE account_id=$1 AND used_at IS NULL", [accountId]);
    const id = crypto.randomUUID();
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    const hash = recoveryCodeHash(id, code);
    await pool.query("INSERT INTO credit_recovery_codes(id,account_id,email,code_hash,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '10 minutes')", [id, accountId, email, hash]);
    try {
      await sendRecoveryEmail(email, code);
    } catch (e) {
      await pool.query("UPDATE credit_recovery_codes SET used_at=NOW() WHERE id=$1", [id]);
      throw e;
    }
    res.json({ ok: true, mensagem: "Se o e-mail estiver cadastrado, enviaremos um código de recuperação." });
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ mensagem: status >= 500 ? e.message : e.message });
  }
});

app.post("/api/creditos/recuperar/confirmar", async (req, res) => {
  const limit = useRateLimit(recoveryRateStore, "verify:" + clientIp(req), 12);
  if (!limit.allowed) return res.status(429).json({ mensagem: "Muitas tentativas. Solicite um novo código mais tarde." });
  try {
    requireDatabase();
    const email = normalizeEmail(req.body && req.body.email);
    const code = String(req.body && req.body.codigo || "").trim();
    if (!/^\d{6}$/.test(code)) throw Object.assign(new Error("Digite o código de 6 números enviado ao seu e-mail."), { status: 400 });
    const found = await pool.query(
      "SELECT id,account_id,code_hash FROM credit_recovery_codes WHERE LOWER(email)=LOWER($1) AND used_at IS NULL AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1",
      [email]
    );
    if (!found.rowCount) throw Object.assign(new Error("Código inválido ou expirado."), { status: 400 });
    const row = found.rows[0];
    if (!secureEqual(row.code_hash, recoveryCodeHash(row.id, code))) throw Object.assign(new Error("Código inválido ou expirado."), { status: 400 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const used = await client.query("UPDATE credit_recovery_codes SET used_at=NOW() WHERE id=$1 AND used_at IS NULL RETURNING account_id", [row.id]);
      if (!used.rowCount) throw Object.assign(new Error("Código já utilizado."), { status: 400 });
      const bal = await client.query("SELECT balance FROM credit_accounts WHERE id=$1", [row.account_id]);
      await client.query("COMMIT");
      res.json({ ok: true, accountToken: signAccountToken(row.account_id), creditos: Number(bal.rows[0].balance) || 0 });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally { client.release(); }
  } catch (e) {
    res.status(e.status || 500).json({ mensagem: e.message || "Não foi possível recuperar os créditos." });
  }
});

app.post("/api/admin/credito-teste", async (req, res) => {
  try {
    requireDatabase();
    const configured=String(process.env.TEST_CREDIT_SECRET||"").trim(), supplied=String(req.get("X-Test-Credit-Secret")||"").trim();
    if(!configured||configured.length<24||configured.length!==supplied.length||!crypto.timingSafeEqual(Buffer.from(configured),Buffer.from(supplied))) return res.status(404).json({error:"Endpoint não encontrado."});
    const accountId=verifyAccountToken(req.body&&req.body.accountToken), marker="admin-test-credit-once";
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      const used=await client.query("SELECT 1 FROM payments WHERE correlation_id=$1 LIMIT 1",[marker]);
      if(used.rowCount){await client.query("ROLLBACK");return res.status(409).json({mensagem:"Crédito de teste já utilizado."});}
      const updated=await client.query("UPDATE credit_accounts SET balance=balance+1,updated_at=NOW() WHERE id=$1 RETURNING balance",[accountId]);
      if(!updated.rowCount) throw Object.assign(new Error("Conta não encontrada."),{status:404});
      await client.query("INSERT INTO payments(correlation_id,account_id,product,cents,credits) VALUES($1,$2,$3,0,1)",[marker,accountId,"admin-test"]);
      await client.query("COMMIT");
      return res.json({ok:true,creditos:Number(updated.rows[0].balance)||0});
    } catch(err){try{await client.query("ROLLBACK")}catch{} throw err} finally{client.release()}
  } catch(err){return res.status(err.status||500).json({mensagem:err.message||"Falha no crédito de teste."})}
});

app.get("/api/creditos/saldo", async (req, res) => {
  try {
    requireDatabase();
    const id = verifyAccountToken(req.get("X-Credit-Account"));
    const r = await pool.query("SELECT balance FROM credit_accounts WHERE id=$1", [id]);
    return res.json({ ok:true, creditos:r.rows[0]?.balance ?? 0 });
  } catch(err) { return res.status(err.status || 401).json({ error:"conta_creditos", mensagem:err.message }); }
});

app.get("/api/minhas-consultas", async (req, res) => {
  if (!enforceSensitiveRateLimit(req, res, "minhas-consultas", 60)) return;
  try {
    requireDatabase();
    const id = verifyAccountToken(req.get("X-Credit-Account"));
    const [account, queries] = await Promise.all([
      pool.query("SELECT balance,email FROM credit_accounts WHERE id=$1", [id]),
      pool.query("SELECT id,plate,status,credit_consumed,created_at,completed_at,(result_json IS NOT NULL) AS relatorio_disponivel FROM vehicle_queries WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100", [id])
    ]);
    if (!account.rowCount) return res.status(404).json({ mensagem:"Conta não encontrada." });
    return res.json({ ok:true, creditos:Number(account.rows[0].balance)||0, email:account.rows[0].email||null, consultas:queries.rows });
  } catch(err) {
    return res.status(err.status || 401).json({ error:"minhas_consultas", mensagem:err.message });
  }
});

app.get("/api/minhas-consultas/:id", async (req, res) => {
  if (!enforceSensitiveRateLimit(req, res, "relatorio-salvo", 60)) return;
  try {
    requireDatabase();
    const accountId = verifyAccountToken(req.get("X-Credit-Account"));
    const q = await pool.query("SELECT id,plate,status,created_at,completed_at,result_json FROM vehicle_queries WHERE id=$1 AND account_id=$2 LIMIT 1", [req.params.id, accountId]);
    if (!q.rowCount) return res.status(404).json({ mensagem:"Consulta não encontrada." });
    const row=q.rows[0];
    if (row.status!=="completed" || !row.result_json) return res.status(409).json({ mensagem:"Relatório ainda não está disponível para esta consulta." });
    const vehicle = row.result_json && typeof row.result_json === "object" ? row.result_json : {};
    const report360 = vehicle.report360 || buildVehicle360Report(vehicle);
    return res.json({ ok:true, consulta:{ id:row.id,plate:row.plate,status:row.status,created_at:row.created_at,completed_at:row.completed_at }, vehicle, report360 });
  } catch(err) {
    return res.status(err.status || 401).json({ error:"relatorio_consulta", mensagem:err.message });
  }
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
  try {
    account = await ensureAccount(req.body && req.body.accountToken);
    // Vincula o e-mail antes de criar a cobrança. Assim, os créditos comprados
    // poderão ser recuperados em outro aparelho após a confirmação do PIX.
    await bindRecoveryEmail(account.id, req.body && req.body.email);
  }
  catch (err) { return res.status(err.status || 503).json({ error: "conta_creditos", mensagem: err.message }); }

  const funnelSessionId = String(req.body && req.body.sessionId || "").trim();
  const validFunnelSessionId = /^[a-zA-Z0-9_-]{16,80}$/.test(funnelSessionId) ? funnelSessionId : null;
  const correlationID = `cv-${plate}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;

  try {
    const charge = await createOpenPixCharge({ correlationID, plate, product });
    const copyPaste = charge.brCode || (charge.pix && charge.pix.brCode) || null;
    let qrcodeUrl = charge.qrCodeImage || null;
    if (!qrcodeUrl && copyPaste) {
      try { qrcodeUrl = await QRCode.toDataURL(copyPaste, { width: 420, margin: 2 }); } catch {}
    }
    await pool.query("INSERT INTO payments(correlation_id,account_id,product,cents,credits,funnel_session_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(correlation_id) DO NOTHING", [correlationID, account.id, product.id, product.cents, product.credits, validFunnelSessionId]);
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
  // Compatibilidade temporária durante a migração do webhook existente.
  // Se Authorization estiver presente, ele deve ser válido. Sem o cabeçalho,
  // o webhook não é confiado: status e valor ainda são confirmados diretamente
  // na Woovi/OpenPix antes de qualquer crédito.
  const suppliedWebhookSecret = String(req.get("Authorization") || "").trim();
  if (!OPENPIX_WEBHOOK_SECRET || !secureEqual(suppliedWebhookSecret, OPENPIX_WEBHOOK_SECRET)) {
    return res.status(401).json({ ok:false });
  }
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
      "SELECT correlation_id, account_id, cents, product, credits FROM payments WHERE correlation_id=$1",
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
        accountId: payment.account_id,
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
  if (!enforceSensitiveRateLimit(req, res, "pix-status", 120)) return;
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

// Normaliza somente campos veiculares úteis já confirmados no retorno da FonteData.
// Não inclui documento do proprietário/faturado e não faz nova chamada ao provedor.
function normalizeFonteDataVehicle(payload, fallbackPlate = "") {
  const root = payload && typeof payload === "object" ? payload : {};
  const v = root.veiculo && typeof root.veiculo === "object" ? root.veiculo : root;
  const fipe = v.fipe && typeof v.fipe === "object" ? v.fipe : {};

  return {
    plate: String(v.placa || fallbackPlate || "").trim().toUpperCase() || null,
    brand: v.marca || fipe.marcaFipe || null,
    model: v.modelo || fipe.modeloFipe || null,
    fabricationYear: v.anoFabricacao || null,
    modelYear: v.anoModelo || fipe.anoModelo || null,
    color: v.cor || null,
    city: v.municipio || null,
    state: v.uf || null,
    fuel: v.combustivel || fipe.combustivel || null,
    type: v.tipo || null,
    renavam: v.renavam || null,
    chassis: v.chassi || null,
    status: v.situacaoVeiculo || null,
    origin: v.procedenciaVeiculo || null,
    category: v.categoria || null,
    species: v.especie || null,
    fipe: {
      value: fipe.valor || null,
      numericValue: Number.isFinite(Number(fipe.valorNumerico)) ? Number(fipe.valorNumerico) : null,
      code: fipe.codigoFipe || null,
      referenceMonth: fipe.mesReferencia || null,
      brand: fipe.marcaFipe || null,
      model: fipe.modeloFipe || null
    },
    technical: {
      engine: v.numeroMotor || null,
      transmission: v.numeroCambio || null,
      displacement: v.cilindrada || null,
      power: v.potencia ?? null,
      axles: v.numeroEixos ?? null,
      bodyType: v.tipoCarroceria || null,
      grossWeight: v.pesoBrutoTotal ?? null,
      loadCapacity: v.capacidaDeCarga ?? v.capacidadeMaximaCarga ?? null,
      maxTraction: v.capacidadeMaximaTracao ?? null,
      passengers: v.capacidadedePassageiros ?? null
    },
    documents: {
      crvIssuedAt: v.dataEmissaoCrv || null,
      crlvIssuedAt: v.dataEmissaoCrlv || null
    },
    restrictions: Array.isArray(v.restricoes) ? v.restricoes : null,
    indicators: v.indicadores && typeof v.indicadores === "object" ? v.indicadores : null,
    chassisRemarked: v.indicadorRemarcacaoChassi ?? null,
    chassisRemarkDescription: v.descricaoRemarcacaoChassi || null
  };
}

// Lista apenas nomes de campos de um relatório já persistido.
// Não inclui valores e não consulta nenhum provedor externo.
function storedFieldNames(value, prefix = "", depth = 0, out = []) {
  if (depth > 6 || value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    if (value.length) storedFieldNames(value[0], prefix, depth + 1, out);
    return out;
  }
  if (typeof value !== "object") return out;
  for (const [key, item] of Object.entries(value)) {
    const field = prefix ? prefix + "." + key : key;
    out.push(field);
    storedFieldNames(item, field, depth + 1, out);
  }
  return out;
}

// Endpoint administrativo: retorna apenas os nomes dos campos do último relatório salvo.
// Não retorna valores e não faz chamada a nenhum provedor.
app.get("/api/admin/estrutura-relatorio-salvo", async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  try {
    requireDatabase();
    const q = await pool.query(
      "SELECT result_json FROM vehicle_queries WHERE result_json IS NOT NULL ORDER BY created_at DESC LIMIT 1"
    );
    if (!q.rowCount) return res.status(404).json({ ok: false, error: "Nenhum relatório salvo encontrado." });
    const fields = [...new Set(storedFieldNames(q.rows[0].result_json))].sort();
    return res.json({ ok: true, fieldCount: fields.length, fields });
  } catch (err) {
    console.error("STORED FIELD AUDIT:", err.message);
    return res.status(500).json({ ok: false, error: "Falha ao auditar estrutura salva." });
  }
});

// Teste administrativo isolado da FonteData; não participa do fluxo dos clientes.
function sanitizeFonteDataAudit(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeFonteDataAudit(item, depth + 1));
  if (typeof value !== "object") return value;
  const blocked = /(cpf|cnpj|propriet|owner|nome.*pessoa|pessoa.*nome|endereco|address|telefone|phone|email|e-mail)/i;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (blocked.test(key)) continue;
    out[key] = sanitizeFonteDataAudit(item, depth + 1);
  }
  return out;
}

async function runFonteDataControlledAuditOnce() {
  if (String(process.env.FONTEDATA_RUN_CONTROLLED_AUDIT || "").trim() !== "1") return;
  if (!FONTEDATA_API_KEY) return console.warn("FONTEDATA AUDIT: chave não configurada.");
  const plate = "DDB0A86";
  try {
    requireDatabase();
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_one_time_actions (action_key TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_provider_audits (
      action_key TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      plate TEXT NOT NULL,
      result_json JSONB,
      http_status INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const actionKey = "fontedata-controlled-test:" + plate;
    const claimed = await pool.query("INSERT INTO admin_one_time_actions(action_key) VALUES($1) ON CONFLICT(action_key) DO NOTHING RETURNING action_key", [actionKey]);
    if (!claimed.rowCount) return console.log("FONTEDATA AUDIT: teste único já utilizado; nenhuma nova chamada feita.");
    const result = await requestJson("https://app.dabradata.com/api/v1/consulta/consulta-veicular?placa=" + encodeURIComponent(plate), { headers: { "X-API-Key": FONTEDATA_API_KEY }, timeout: 120000 });
    const safeData = sanitizeFonteDataAudit(result.data);
    await pool.query(
      "INSERT INTO admin_provider_audits(action_key, provider, plate, result_json, http_status) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(action_key) DO NOTHING",
      [actionKey, "fontedata", plate, JSON.stringify(safeData || {}), Number(result.status || 0)]
    );
    console.log("FONTEDATA AUDIT: status=sucesso; resposta sanitizada armazenada. HTTP", result.status);
  } catch (err) {
    console.error("FONTEDATA AUDIT: status=timeout_or_error; detalhe:", err.message);
  }
}

app.get("/api/admin/fontedata-retry-status", async (req, res) => {
  if (!enforceSensitiveRateLimit(req, res, "fontedata-retry-status", 10)) return;
  const testToken = String(req.get("X-FonteData-Test-Token") || req.query.token || "").trim();
  if (!FONTEDATA_TEST_TOKEN || !testToken || !secureEqual(testToken, FONTEDATA_TEST_TOKEN)) return res.status(404).json({ error: "Endpoint não encontrado." });
  requireDatabase();
  await pool.query(`CREATE TABLE IF NOT EXISTS admin_provider_retry_audits (
    id BIGSERIAL PRIMARY KEY,
    provider TEXT NOT NULL,
    plate TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    duration_ms INTEGER,
    http_status INTEGER,
    error_message TEXT,
    result_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const history = await pool.query(
    "SELECT status, started_at, finished_at, duration_ms, http_status, error_message, created_at FROM admin_provider_retry_audits WHERE provider=$1 AND plate=$2 ORDER BY id DESC LIMIT 5",
    ["fontedata", "DDB0A86"]
  );
  return res.json({
    ok: true,
    provider: "fontedata",
    plate: "DDB0A86",
    retryEnabled: false,
    timeoutMs: 120000,
    mode: "manual_only",
    history: history.rows,
    mensagem: "Segunda tentativa bloqueada. Este endpoint apenas prepara e consulta o histórico; não chama o provedor."
  });
});

app.post("/api/admin/fontedata-retry-manual", async (req, res) => {
  if (!enforceSensitiveRateLimit(req, res, "fontedata-retry-manual", 2)) return;
  const testToken = String(req.get("X-FonteData-Test-Token") || "").trim();
  if (!FONTEDATA_TEST_TOKEN || !testToken || !secureEqual(testToken, FONTEDATA_TEST_TOKEN)) return res.status(404).json({ error: "Endpoint não encontrado." });
  if (!FONTEDATA_API_KEY) return res.status(503).json({ error: "fontedata_nao_configurada" });
  const plate = "DDB0A86";
  requireDatabase();
  await pool.query(`CREATE TABLE IF NOT EXISTS admin_provider_retry_audits (
    id BIGSERIAL PRIMARY KEY, provider TEXT NOT NULL, plate TEXT NOT NULL, status TEXT NOT NULL,
    started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, duration_ms INTEGER, http_status INTEGER,
    error_message TEXT, result_json JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const guardKey = "fontedata-authorized-retry-2:" + plate;
  const guard = await pool.query("INSERT INTO admin_one_time_actions(action_key) VALUES($1) ON CONFLICT(action_key) DO NOTHING RETURNING action_key", [guardKey]);
  if (!guard.rowCount) return res.status(409).json({ error: "retry_ja_utilizado", mensagem: "A segunda tentativa autorizada já foi utilizada." });
  const started = Date.now();
  const audit = await pool.query("INSERT INTO admin_provider_retry_audits(provider,plate,status,started_at) VALUES($1,$2,$3,NOW()) RETURNING id", ["fontedata",plate,"started"]);
  const id = audit.rows[0].id;
  try {
    const result = await requestJson("https://app.dabradata.com/api/v1/consulta/consulta-veicular?placa=" + encodeURIComponent(plate), { headers: { "X-API-Key": FONTEDATA_API_KEY }, timeout: 120000 });
    const duration = Date.now() - started;
    const safe = sanitizeFonteDataAudit(result.data);
    const status = result.status >= 200 && result.status < 300 ? "success" : "http_error";
    await pool.query("UPDATE admin_provider_retry_audits SET status=$1,finished_at=NOW(),duration_ms=$2,http_status=$3,result_json=$4::jsonb WHERE id=$5", [status,duration,result.status,JSON.stringify(safe || {}),id]);
    if (status !== "success") return res.status(502).json({ error:"fontedata_http", status:result.status, durationMs:duration });
    return res.json({ ok:true, provider:"fontedata", plate, durationMs:duration, httpStatus:result.status, data:safe });
  } catch (err) {
    const duration = Date.now() - started;
    await pool.query("UPDATE admin_provider_retry_audits SET status=$1,finished_at=NOW(),duration_ms=$2,error_message=$3 WHERE id=$4", ["timeout_or_error",duration,String(err.message || "erro").slice(0,500),id]);
    console.error("FONTEDATA RETRY: falha:", err.message);
    return res.status(err.status || 502).json({ error:"fontedata_retry", durationMs:duration, mensagem:err.message || "Falha na consulta FonteData." });
  }
});

app.get("/api/admin/fontedata-resultado-salvo", async (req, res) => {
  if (!enforceSensitiveRateLimit(req, res, "fontedata-resultado-salvo", 10)) return;
  const testToken = String(req.get("X-FonteData-Test-Token") || req.query.token || "").trim();
  if (!FONTEDATA_TEST_TOKEN || !testToken || !secureEqual(testToken, FONTEDATA_TEST_TOKEN)) return res.status(404).json({ error: "Endpoint não encontrado." });
  try {
    requireDatabase();
    const saved = await pool.query(
      "SELECT status, duration_ms, http_status, result_json, created_at FROM admin_provider_retry_audits WHERE provider=$1 AND plate=$2 AND status=$3 ORDER BY id DESC LIMIT 1",
      ["fontedata", "DDB0A86", "success"]
    );
    if (!saved.rowCount) return res.status(404).json({ error: "resultado_nao_encontrado" });
    return res.json({ ok:true, provider:"fontedata", plate:"DDB0A86", ...saved.rows[0] });
  } catch (err) {
    console.error("FONTEDATA SAVED RESULT:", err.message);
    return res.status(500).json({ error:"falha_leitura_resultado" });
  }
});

app.get("/api/admin/fontedata-auditoria-unica", async (req, res) => {
  if (!enforceSensitiveRateLimit(req, res, "fontedata-auditoria-unica", 3)) return;
  try {
    const testToken = String(req.get("X-FonteData-Test-Token") || req.query.token || "").trim();
    if (!FONTEDATA_TEST_TOKEN || !testToken || !secureEqual(testToken, FONTEDATA_TEST_TOKEN)) return res.status(404).json({ error: "Endpoint não encontrado." });
    if (!FONTEDATA_API_KEY) return res.status(503).json({ error: "fontedata_nao_configurada" });
    const plate = "DDB0A86";
    requireDatabase();
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_one_time_actions (action_key TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const actionKey = "fontedata-controlled-test:" + plate;
    const claimed = await pool.query("INSERT INTO admin_one_time_actions(action_key) VALUES($1) ON CONFLICT(action_key) DO NOTHING RETURNING action_key", [actionKey]);
    if (!claimed.rowCount) return res.status(409).json({ error: "teste_ja_utilizado", mensagem: "A auditoria controlada já foi utilizada." });
    const result = await requestJson("https://app.dabradata.com/api/v1/consulta/consulta-veicular?placa=" + encodeURIComponent(plate), { headers: { "X-API-Key": FONTEDATA_API_KEY }, timeout: 120000 });
    if (result.status < 200 || result.status >= 300) return res.status(result.status >= 400 && result.status < 500 ? result.status : 502).json({ error: "fontedata_http", status: result.status });
    return res.json({ ok: true, provider: "fontedata", plate, data: sanitizeFonteDataAudit(result.data) });
  } catch (err) {
    console.error("Erro na auditoria única FonteData:", err.message);
    return res.status(err.status || 502).json({ error: "fontedata_auditoria", mensagem: err.message || "Falha na consulta FonteData." });
  }
});


// Endpoint interno temporário para validar o sandbox CredPro sem tocar no fluxo dos clientes.
// Retorna somente o catálogo/estrutura do sandbox; não faz pesquisa veicular nem consome saldo.
app.get("/api/admin/credpro-sandbox-catalogo", async (req, res) => {
  if (!enforceSensitiveRateLimit(req, res, "credpro-sandbox-catalogo", 5)) return;
  if (!requireAdminSecret(req, res)) return;
  if (!CREDPRO_TEST_API_KEY || !CREDPRO_TEST_API_KEY.startsWith("cpk_test_")) {
    return res.status(503).json({ error: "credpro_sandbox_nao_configurado" });
  }
  try {
    const result = await requestJson(CREDPRO_API_URL + "/v1/pesquisas/itens", {
      headers: { "Authorization": "Bearer " + CREDPRO_TEST_API_KEY },
      timeout: 30000
    });
    if (result.status < 200 || result.status >= 300) {
      return res.status(502).json({ error: "credpro_http", status: result.status });
    }
    const data = result.data || {};
    const itens = Array.isArray(data.itens) ? data.itens.map(item => ({
      codigo: item && item.codigo,
      nome: item && item.nome,
      inclui: item && Array.isArray(item.inclui) ? item.inclui : undefined,
      preco: item && (item.preco ?? item.valor ?? item.preco_reais ?? item.valor_reais ?? null),
      creditos: item && (item.creditos ?? item.custo_creditos ?? null)
    })) : [];
    return res.json({ ok: true, provider: "credpro", sandbox: data.sandbox === true, itemCount: itens.length, itens });
  } catch (err) {
    console.error("CREDPRO SANDBOX CATALOGO:", err.message);
    return res.status(502).json({ error: "credpro_sandbox", mensagem: "Falha ao consultar catálogo sandbox." });
  }
});


// Demonstração interna e protegida do relatório CredPro Sandbox.
// Somente lê uma pesquisa fictícia já existente; não cria pesquisa, não consome crédito do site e não cobra saldo CredPro.
app.get("/api/admin/credpro-sandbox-relatorio", async (req, res) => {
  if (!enforceSensitiveRateLimit(req, res, "credpro-sandbox-relatorio", 5)) return;
  if (!requireAdminSecret(req, res)) return;
  if (!CREDPRO_TEST_API_KEY || !CREDPRO_TEST_API_KEY.startsWith("cpk_test_")) {
    return res.status(503).json({ error: "credpro_sandbox_nao_configurado" });
  }
  try {
    const result = await requestJson(CREDPRO_API_URL + "/v1/pesquisas/208", {
      headers: { "Authorization": "Bearer " + CREDPRO_TEST_API_KEY },
      timeout: 30000
    });
    if (result.status < 200 || result.status >= 300 || !result.data || result.data.sandbox !== true) {
      return res.status(502).json({ error: "credpro_sandbox_resultado_indisponivel" });
    }
    const vehicle = normalizeCredProResult(result.data, "ABC1D29");
    return res.json({
      ok: true,
      demo: true,
      sandbox: true,
      chargedValue: vehicle.source?.chargedValue || 0,
      aviso: "Demonstração com dados fictícios do sandbox CredPro. Nenhuma cobrança realizada.",
      vehicle
    });
  } catch (err) {
    console.error("CREDPRO SANDBOX RELATORIO:", String(err.message || "erro").slice(0, 300));
    return res.status(502).json({ error: "credpro_sandbox_relatorio", mensagem: "Falha ao carregar demonstração sandbox." });
  }
});

async function runCredProCatalogMetadataOnce() {
  if (String(process.env.CREDPRO_INSPECT_CATALOG_METADATA_ONCE || "").trim() !== "1") return;
  if (!CREDPRO_TEST_API_KEY || !CREDPRO_TEST_API_KEY.startsWith("cpk_test_")) return console.warn("CREDPRO CATALOGO META: sandbox não configurado.");
  try {
    requireDatabase();
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_one_time_actions (action_key TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const actionKey = "credpro-catalog-metadata-v1";
    const claimed = await pool.query("INSERT INTO admin_one_time_actions(action_key) VALUES($1) ON CONFLICT(action_key) DO NOTHING RETURNING action_key", [actionKey]);
    if (!claimed.rowCount) return console.log("CREDPRO CATALOGO META: inspeção já executada; nenhuma nova chamada feita.");
    const result = await requestJson(CREDPRO_API_URL + "/v1/pesquisas/itens", { headers: { "Authorization": "Bearer " + CREDPRO_TEST_API_KEY }, timeout: 30000 });
    const items = Array.isArray(result.data?.itens) ? result.data.itens : [];
    const safe = items.map(item => ({
      codigo: item?.codigo || null,
      nome: item?.nome || null,
      preco: item?.preco ?? item?.valor ?? item?.preco_reais ?? item?.valor_reais ?? null,
      creditos: item?.creditos ?? item?.custo_creditos ?? null,
      campos: item && typeof item === "object" ? Object.keys(item).filter(k => !/token|authorization|api.?key|secret/i.test(k)).sort() : []
    }));
    console.log("CREDPRO CATALOGO META:", JSON.stringify({ httpStatus: result.status, sandbox: result.data?.sandbox === true, itens: safe }));
  } catch (err) { console.error("CREDPRO CATALOGO META: falha:", err.message); }
}

async function runFonteDataStoredCoverageOnce() {
  if (String(process.env.FONTEDATA_STORED_COVERAGE_ONCE || "").trim() !== "1") return;
  try {
    requireDatabase();
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_one_time_actions (action_key TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const actionKey = "fontedata-stored-coverage-v1";
    const claimed = await pool.query("INSERT INTO admin_one_time_actions(action_key) VALUES($1) ON CONFLICT(action_key) DO NOTHING RETURNING action_key", [actionKey]);
    if (!claimed.rowCount) return console.log("FONTEDATA COVERAGE: inspeção já executada.");
    const q = await pool.query(`
      SELECT result_json FROM (
        SELECT result_json, created_at FROM admin_provider_retry_audits WHERE provider='fontedata' AND status='success' AND result_json IS NOT NULL
        UNION ALL
        SELECT result_json, created_at FROM admin_provider_audits WHERE provider='fontedata' AND result_json IS NOT NULL
      ) x ORDER BY created_at DESC LIMIT 1
    `);
    if (!q.rowCount) return console.log("FONTEDATA COVERAGE: nenhum resultado armazenado.");
    const root = q.rows[0].result_json || {};
    const keys = new Set();
    const walk = (v, prefix="", depth=0) => {
      if (depth > 7 || v == null) return;
      if (Array.isArray(v)) return v.slice(0,3).forEach((x,i)=>walk(x, prefix+"[]", depth+1));
      if (typeof v !== "object") return;
      for (const [k,val] of Object.entries(v)) {
        const p = prefix ? prefix+"."+k : k;
        keys.add(p.toLowerCase());
        walk(val,p,depth+1);
      }
    };
    walk(root);
    const terms = {
      gravame:["gravame","financ","alienacao"],
      leilao:["leilao","auction"],
      sinistro:["sinistro","indenizacao","perda_total"],
      multas:["multa","renainf","debito"],
      recall:["recall"],
      proprietarios:["proprietario","historico_propriet"],
      roubo_furto:["roubo","furto"],
      renajud:["renajud","judicial"]
    };
    const coverage = {};
    for (const [name, needles] of Object.entries(terms)) {
      const matches = [...keys].filter(k => needles.some(n => k.includes(n))).slice(0,12);
      coverage[name] = { encontrado: matches.length > 0, caminhos: matches };
    }
    console.log("FONTEDATA COVERAGE:", JSON.stringify(coverage));
  } catch (err) { console.error("FONTEDATA COVERAGE: falha:", err.message); }
}

app.post("/api/consulta-completa", async (req, res) => {
  if (!enforceSensitiveRateLimit(req, res, "consulta-completa", 30)) return;
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
      let safeVehicle = safeVehicleDetails(vehicle, plate);

      // Aproveita um retorno FonteData já armazenado para a mesma placa, quando existir.
      // Esta etapa é somente leitura do PostgreSQL: não chama o provedor e não consome crédito.
      if (pool) {
        try {
          const fonteSaved = await pool.query(`
            SELECT result_json FROM (
              SELECT result_json, created_at, plate FROM admin_provider_retry_audits
                WHERE provider='fontedata' AND status='success' AND result_json IS NOT NULL
              UNION ALL
              SELECT result_json, created_at, plate FROM admin_provider_audits
                WHERE provider='fontedata' AND result_json IS NOT NULL
            ) x
            WHERE UPPER(plate)=UPPER($1)
            ORDER BY created_at DESC LIMIT 1
          `, [plate]);
          if (fonteSaved.rowCount) {
            const fonteVehicle = normalizeFonteDataVehicle(fonteSaved.rows[0].result_json, plate);
            safeVehicle = mergeVehicleReports(safeVehicle, fonteVehicle);
          }
        } catch (mergeErr) {
          console.warn("Relatório 360: FonteData salva não pôde ser combinada:", mergeErr.message);
        }
      }

      const report360 = buildVehicle360Report(safeVehicle);
      const coverage360 = analyzeVehicle360Coverage(safeVehicle);
      report360.coverage = coverage360;
      report360.credproRecommendation = recommendCredProModulesFromCoverage(coverage360);
      const deliveredVehicle = { ...safeVehicle, report360 };
      await finishCreditQuery(accountId, debit.queryId, true, deliveredVehicle);
      return res.json({ ok:true, paid:true, vehicle:deliveredVehicle, report360, creditosRestantes:debit.balance, price:CONSULTA_SALE_PRICE, currency:"BRL" });
    } catch (err) {
      try {
        await finishCreditQuery(accountId, debit.queryId, false);
      } catch (refundErr) {
        console.error("Falha crítica ao estornar crédito da consulta:", JSON.stringify({
          queryId: debit.queryId,
          erro: refundErr.message
        }));
        const protectedErr = new Error("A consulta falhou e o estorno automático precisa de verificação. Não tente novamente agora.");
        protectedErr.status = 503;
        protectedErr.code = "ESTORNO_PENDENTE";
        throw protectedErr;
      }
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

// Health check mínimo para hospedagem/monitoramento.
// Não expõe chaves, banco, fornecedor ou informações internas.
app.get("/health", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(200).json({ status: "ok" });
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
  const server = runCredProCatalogMetadataOnce();
runFonteDataStoredCoverageOnce();
app.listen(PORT, () => console.log(`Consulta Veicular 360 ativa na porta ${PORT}. Checkout PIX: Woovi/OpenPix. Créditos: ${pool ? "PostgreSQL" : "indisponível"}.`));
// Auditoria FonteData permanece manual; nunca é executada automaticamente em deploy/startup.

  // Validação passiva de uso único do catálogo CredPro Sandbox.
  // Não pesquisa placa, não consome saldo e nunca registra a chave.
  if (String(process.env.CREDPRO_VALIDATE_CATALOG_ONCE || "").trim() === "1" && CREDPRO_TEST_API_KEY) {
    setTimeout(async () => {
      try {
        if (!pool) return console.log("CREDPRO SANDBOX VALIDATION: banco indisponível; teste não executado.");
        await pool.query(`CREATE TABLE IF NOT EXISTS admin_one_time_actions (action_key TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        const actionKey = "credpro-sandbox-catalog-validation-v1";
        const claimed = await pool.query("INSERT INTO admin_one_time_actions(action_key) VALUES($1) ON CONFLICT(action_key) DO NOTHING RETURNING action_key", [actionKey]);
        if (!claimed.rowCount) return console.log("CREDPRO SANDBOX VALIDATION: validação única já executada; nenhuma chamada feita.");
        const result = await requestJson(CREDPRO_API_URL + "/v1/pesquisas/itens", {
          headers: { "Authorization": "Bearer " + CREDPRO_TEST_API_KEY },
          timeout: 30000
        });
        const data = result.data || {};
        const itens = Array.isArray(data.itens) ? data.itens.map(item => ({ codigo: item && item.codigo, nome: item && item.nome })) : [];
        console.log("CREDPRO SANDBOX VALIDATION:", JSON.stringify({ httpStatus: result.status, sandbox: data.sandbox === true, itemCount: itens.length, itens }));
      } catch (err) {
        console.error("CREDPRO SANDBOX VALIDATION: falha sem nova tentativa automática:", String(err.message || "erro").slice(0,300));
      }
    }, 6000);
  }

  // Consulta fictícia CredPro de uso único, restrita ao sandbox.
  // A placa termina em 9 para acionar o cenário fictício "com histórico" documentado pelo sandbox.
  if (String(process.env.CREDPRO_RUN_SANDBOX_HISTORY_ONCE || "").trim() === "1") {
    setTimeout(async () => {
      if (!CREDPRO_TEST_API_KEY || !CREDPRO_TEST_API_KEY.startsWith("cpk_test_")) {
        return console.log("CREDPRO SANDBOX HISTORY: bloqueado; chave de sandbox ausente.");
      }
      try {
        if (!pool) return console.log("CREDPRO SANDBOX HISTORY: banco indisponível; teste não executado.");
        await pool.query(`CREATE TABLE IF NOT EXISTS admin_one_time_actions (action_key TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        const actionKey = "credpro-sandbox-history-query-v2";
        const claimed = await pool.query("INSERT INTO admin_one_time_actions(action_key) VALUES($1) ON CONFLICT(action_key) DO NOTHING RETURNING action_key", [actionKey]);
        if (!claimed.rowCount) return console.log("CREDPRO SANDBOX HISTORY: teste único já executado; nenhuma nova consulta feita.");
        const result = await requestJson(CREDPRO_API_URL + "/v1/pesquisas", {
          method: "POST",
          headers: { "Authorization": "Bearer " + CREDPRO_TEST_API_KEY },
          timeout: 30000
        }, { placa: "ABC1D29", itens: ["pesquisa_completa"] });
        const data = result.data || {};
        const safe = JSON.parse(JSON.stringify(data, (key, value) => /token|authorization|api.?key|secret/i.test(key) ? "[REDACTED]" : value));
        console.log("CREDPRO SANDBOX HISTORY:", JSON.stringify({ httpStatus: result.status, resposta: safe }));
      } catch (err) {
        console.error("CREDPRO SANDBOX HISTORY: falha sem nova tentativa automática:", String(err.message || "erro").slice(0,300));
      }
    }, 9000);
  }

  // Leitura única do resultado da pesquisa fictícia CredPro #208.
  // GET apenas: não cria nova pesquisa e permanece restrito à chave de sandbox.
  if (String(process.env.CREDPRO_FETCH_SANDBOX_RESULT_ONCE || "").trim() === "1") {
    setTimeout(async () => {
      if (!CREDPRO_TEST_API_KEY || !CREDPRO_TEST_API_KEY.startsWith("cpk_test_")) {
        return console.log("CREDPRO SANDBOX RESULT: bloqueado; chave de sandbox ausente.");
      }
      try {
        if (!pool) return console.log("CREDPRO SANDBOX RESULT: banco indisponível; leitura não executada.");
        await pool.query(`CREATE TABLE IF NOT EXISTS admin_one_time_actions (action_key TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        const actionKey = "credpro-sandbox-result-208-v1";
        const claimed = await pool.query("INSERT INTO admin_one_time_actions(action_key) VALUES($1) ON CONFLICT(action_key) DO NOTHING RETURNING action_key", [actionKey]);
        if (!claimed.rowCount) return console.log("CREDPRO SANDBOX RESULT: leitura única já executada; nenhuma nova chamada feita.");
        const result = await requestJson(CREDPRO_API_URL + "/v1/pesquisas/208", {
          headers: { "Authorization": "Bearer " + CREDPRO_TEST_API_KEY },
          timeout: 30000
        });
        const data = result.data || {};
        const safe = JSON.parse(JSON.stringify(data, (key, value) => /token|authorization|api.?key|secret/i.test(key) ? "[REDACTED]" : value));
        console.log("CREDPRO SANDBOX RESULT:", JSON.stringify({ httpStatus: result.status, resposta: safe }));
      } catch (err) {
        console.error("CREDPRO SANDBOX RESULT: falha sem nova tentativa automática:", String(err.message || "erro").slice(0,300));
      }
    }, 12000);
  }

  // Segunda tentativa FonteData autorizada: dispara internamente uma única vez após o deploy.
  // A própria rota usa trava persistente, então reinícios posteriores não repetem a consulta.
  if (String(process.env.FONTEDATA_AUTHORIZED_RETRY_ONCE || "").trim() === "1" && FONTEDATA_TEST_TOKEN) {
    setTimeout(async () => {
      try {
        const base = "http://127.0.0.1:" + PORT;
        const response = await fetch(base + "/api/admin/fontedata-retry-manual", {
          method: "POST",
          headers: { "X-FonteData-Test-Token": FONTEDATA_TEST_TOKEN }
        });
        console.log("FONTEDATA RETRY TRIGGER: HTTP", response.status);
      } catch (err) {
        console.error("FONTEDATA RETRY TRIGGER:", err.message);
      }
    }, 5000);
  }

  // Exporta uma única vez apenas a estrutura sanitizada do resultado FonteData já salvo.
  // Não chama o provedor e não consome créditos.
  if (String(process.env.FONTEDATA_LOG_SAVED_SUMMARY_ONCE || "").trim() === "1") {
    setTimeout(async () => {
      try {
        const saved = await pool.query(
          "SELECT result_json, duration_ms, http_status FROM admin_provider_retry_audits WHERE provider=$1 AND plate=$2 AND status=$3 ORDER BY id DESC LIMIT 1",
          ["fontedata", "DDB0A86", "success"]
        );
        if (!saved.rowCount) return console.log("FONTEDATA SAVED SUMMARY: nenhum resultado success encontrado.");
        const data = sanitizeFonteDataAudit(saved.rows[0].result_json || {});
        const summarize = (v, depth = 0) => {
          if (depth > 5) return "[depth-limit]";
          if (Array.isArray(v)) return { type:"array", count:v.length, sample:v.slice(0,2).map(x=>summarize(x,depth+1)) };
          if (v && typeof v === "object") {
            const out={}; for (const [k,val] of Object.entries(v)) out[k]=summarize(val,depth+1); return out;
          }
          // Nunca grava valores do provedor no log. Mantemos somente o tipo
          // para auditar a estrutura dos campos já salvos sem expor placa,
          // chassi, RENAVAM, documentos ou outros identificadores.
          if (v === null) return "null";
          return typeof v;
        };
        console.log("FONTEDATA SAVED SUMMARY:", JSON.stringify({
          httpStatus:saved.rows[0].http_status,
          durationMs:saved.rows[0].duration_ms,
          data:summarize(data)
        }));
      } catch (err) { console.error("FONTEDATA SAVED SUMMARY ERROR:", err.message); }
    }, 5000);
  }

  // Auditoria passiva: lê uma única vez o último relatório já persistido e
  // grava somente os nomes dos campos. Não chama Falcon/FonteData e não expõe valores.
  setTimeout(async () => {
    try {
      if (!pool) return;
      const saved = await pool.query(
        "SELECT result_json FROM vehicle_queries WHERE result_json IS NOT NULL ORDER BY created_at DESC LIMIT 1"
      );
      if (!saved.rowCount) return console.log("STORED REPORT FIELDS: nenhum relatório salvo encontrado.");
      const fields = [...new Set(storedFieldNames(saved.rows[0].result_json))].sort();
      console.log("STORED REPORT FIELDS:", JSON.stringify({ fieldCount: fields.length, fields }));
    } catch (err) {
      console.error("STORED REPORT FIELDS ERROR:", err.message);
    }
  }, 7000);

  let shuttingDown = false;
  const shutdown = signal => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} recebido. Encerrando servidor com segurança...`);

    server.close(async () => {
      try {
        if (pool) await pool.end();
      } catch (err) {
        console.error("Erro ao encerrar PostgreSQL:", err.message);
      } finally {
        process.exit(0);
      }
    });

    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}).catch(err => {
  console.error("Falha ao inicializar banco de créditos:", err);
  process.exit(1);
});
