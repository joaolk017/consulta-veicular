'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const path = require('path');

const PROCESS_FILE = path.basename(String(process.argv[1] || '')).toLowerCase();
const IS_BACKEND_SERVER = PROCESS_FILE === 'server.js';
const IS_OUTER_UI = PROCESS_FILE === 'recovery-ui-proxy.js';

const PRODUCT_ID = 'gravame-detalhado';
const SALE_PRICE = 9.90;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const FONTEDATA_API_KEY = String(process.env.FONTEDATA_API_KEY || '').trim();
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const PAYMENT_SIGNING_SECRET = String(process.env.PAYMENT_SIGNING_SECRET || '').trim();
const MISTIC_PAY_URL = String(process.env.MISTIC_PAY_URL || 'https://api.misticpay.com/api').replace(/\/+$/, '');
const MISTIC_CLIENT_ID = process.env.MISTIC_CLIENT_ID;
const MISTIC_CLIENT_SECRET = process.env.MISTIC_CLIENT_SECRET;
const MISTIC_AUTH_HEADER = process.env.MISTIC_AUTH_HEADER;
const MISTIC_WEBHOOK_URL = process.env.MISTIC_WEBHOOK_URL;

function normalizePlate(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}
function validPlate(value) {
  const plate = normalizePlate(value);
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate) || /^[A-Z]{3}[0-9]{4}$/.test(plate);
}
function digits(value) { return String(value || '').replace(/\D/g, ''); }
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
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function tokenHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}
function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(v => v.trim()).filter(Boolean);
  return forwarded.length ? forwarded[forwarded.length - 1] : (req.socket.remoteAddress || 'unknown');
}

if (IS_BACKEND_SERVER) {
  const { Pool } = require('pg');
  const priorCreateServer = http.createServer.bind(http);
  const rateStores = new Map();
  const transactionCache = new Map();
  const inFlight = new Map();
  let pool = null;
  let initPromise = null;

  function rateAllowed(req, bucket, limit) {
    const now = Date.now();
    const key = bucket + ':' + clientIp(req);
    let item = rateStores.get(key);
    if (!item || now >= item.resetAt) item = { count: 0, resetAt: now + 60 * 60 * 1000 };
    if (item.count >= limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((item.resetAt - now) / 1000)) };
    item.count += 1;
    rateStores.set(key, item);
    return { ok: true };
  }

  async function initDb() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (!DATABASE_URL) return null;
      pool = new Pool({
        connectionString: DATABASE_URL,
        max: 3,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        ssl: DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1') ? false : { rejectUnauthorized: false }
      });
      await pool.query(`
        CREATE TABLE IF NOT EXISTS gravame_orders (
          payment_token_hash CHAR(64) PRIMARY KEY,
          plate VARCHAR(8) NOT NULL,
          provider_status VARCHAR(20),
          provider_http_status INTEGER,
          result_json JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          paid_at TIMESTAMPTZ,
          expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_gravame_orders_plate_expiry
          ON gravame_orders(plate, expires_at DESC);
        DELETE FROM gravame_orders WHERE expires_at < NOW();
      `);
      console.log('GRAVAME: checkout e armazenamento persistente prontos.');
      return pool;
    })().catch(err => {
      console.error('GRAVAME: falha ao iniciar armazenamento:', err.message);
      pool = null;
      return null;
    });
    return initPromise;
  }

  function misticAuthorization() {
    const configured = String(MISTIC_AUTH_HEADER || '').trim().replace(/^Authorization\s*:\s*/i, '');
    if (configured) return /^Basic\s+/i.test(configured) ? configured : `Basic ${configured}`;
    if (!MISTIC_CLIENT_ID || !MISTIC_CLIENT_SECRET) return null;
    return `Basic ${Buffer.from(`${MISTIC_CLIENT_ID}:${MISTIC_CLIENT_SECRET}`).toString('base64')}`;
  }

  function misticRequest(endpoint, payload) {
    return new Promise((resolve, reject) => {
      const authorization = misticAuthorization();
      if (!authorization) return reject(new Error('Credenciais de pagamento não configuradas.'));
      let url;
      try { url = new URL(`${MISTIC_PAY_URL}${endpoint}`); }
      catch (_) { return reject(new Error('URL da operadora de pagamento inválida.')); }
      if (url.protocol !== 'https:') return reject(new Error('A operadora de pagamento deve usar HTTPS.'));
      const body = JSON.stringify(payload || {});
      const request = https.request(url, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, response => {
        const chunks = [];
        let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 2_000_000) return request.destroy(new Error('Resposta da operadora excedeu o limite.'));
          chunks.push(chunk);
        });
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
          resolve({ status: response.statusCode || 502, data });
        });
      });
      request.setTimeout(20000, () => request.destroy(new Error('Tempo limite da operadora de pagamento excedido.')));
      request.on('error', reject);
      request.write(body);
      request.end();
    });
  }

  function signPaymentToken(payload) {
    if (!PAYMENT_SIGNING_SECRET) throw new Error('Assinatura interna não configurada.');
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', PAYMENT_SIGNING_SECRET).update(encoded).digest('base64url');
    return `${encoded}.${sig}`;
  }

  function verifyPaymentToken(token) {
    if (!PAYMENT_SIGNING_SECRET) throw new Error('Assinatura interna não configurada.');
    const parts = String(token || '').split('.');
    if (parts.length !== 2) throw new Error('Token de pagamento inválido.');
    const expected = crypto.createHmac('sha256', PAYMENT_SIGNING_SECRET).update(parts[0]).digest('base64url');
    if (!secureEqual(parts[1], expected)) throw new Error('Token de pagamento inválido.');
    let payload = null;
    try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (_) {}
    if (!payload || payload.v !== 1 || payload.product !== PRODUCT_ID || !payload.tx || !payload.plate || Number(payload.amount) !== SALE_PRICE || !payload.exp) {
      throw new Error('Token de pagamento inválido.');
    }
    if (Date.now() > Number(payload.exp)) throw new Error('Token de pagamento expirado.');
    return payload;
  }

  function amountMatches(value) {
    const amount = Number(value);
    return Number.isFinite(amount) && (Math.abs(amount - SALE_PRICE) < 0.011 || Math.abs((amount / 100) - SALE_PRICE) < 0.011);
  }

  async function getTransaction(transactionId) {
    const key = String(transactionId || '');
    const cached = transactionCache.get(key);
    if (cached && Date.now() < cached.expiresAt) return cached.transaction;
    const response = await misticRequest('/transactions/check', { transactionId: key });
    if (response.status < 200 || response.status >= 300 || !response.data || typeof response.data !== 'object') {
      const err = new Error('Não foi possível verificar o pagamento.');
      err.status = response.status >= 400 && response.status < 500 ? response.status : 502;
      throw err;
    }
    const transaction = response.data.transaction || response.data.data || response.data;
    const state = String(transaction && (transaction.transactionState || transaction.status) || '').toUpperCase();
    if (state === 'COMPLETO') transactionCache.set(key, { transaction, expiresAt: Date.now() + 30 * 60 * 1000 });
    return transaction;
  }

  async function verifyPaid(token) {
    const payload = verifyPaymentToken(token);
    const transaction = await getTransaction(payload.tx);
    const state = String(transaction && (transaction.transactionState || transaction.status) || '').toUpperCase();
    const type = String(transaction && transaction.transactionType || '').toUpperCase();
    const method = String(transaction && transaction.transactionMethod || '').toUpperCase();
    const value = transaction && (transaction.value ?? transaction.transactionAmount ?? transaction.amount);
    return {
      payload,
      paid: state === 'COMPLETO' && (!type || type === 'DEPOSITO') && (!method || method === 'PIX') && amountMatches(value),
      state: state || 'DESCONHECIDO'
    };
  }

  function fonteDataRequest(plate) {
    return new Promise((resolve, reject) => {
      const url = new URL('https://app.fontedata.com/api/v1/consulta/gravame-veicular');
      url.searchParams.set('placa', plate);
      const request = https.request(url, {
        method: 'POST',
        headers: {
          'X-API-Key': FONTEDATA_API_KEY,
          Accept: 'application/json',
          'Content-Length': '0'
        }
      }, response => {
        const chunks = [];
        let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 2_000_000) return request.destroy(new Error('Resposta da consulta de gravame excedeu o limite.'));
          chunks.push(chunk);
        });
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
          resolve({ status: response.statusCode || 502, data });
        });
      });
      request.setTimeout(105000, () => request.destroy(new Error('A consulta de gravame excedeu o tempo limite.')));
      request.on('error', reject);
      request.end();
    });
  }

  function maskIdentifier(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    if (text.length <= 4) return text;
    if (text.length <= 8) return '*'.repeat(Math.max(2, text.length - 4)) + text.slice(-4);
    return text.slice(0, 3) + '*'.repeat(Math.min(8, text.length - 7)) + text.slice(-4);
  }

  function cleanResult(input, plate) {
    const data = input && input.data && typeof input.data === 'object' ? input.data : input;
    const vehicle = data && data.veiculo && typeof data.veiculo === 'object' ? data.veiculo : {};
    const agent = data && data.agenteFinanceiro && typeof data.agenteFinanceiro === 'object' ? data.agenteFinanceiro : null;
    const restriction = data && data.restricao && typeof data.restricao === 'object' ? data.restricao : null;
    const contract = data && data.contrato && typeof data.contrato === 'object' ? data.contrato : null;
    return {
      plate: normalizePlate(vehicle.placa || plate),
      chassis: maskIdentifier(vehicle.chassi),
      brandModel: vehicle.marcaModelo || null,
      hasLien: typeof data.temGravame === 'boolean' ? data.temGravame : null,
      status: data.situacao || null,
      statusDescription: data.situacaoDescricao || null,
      financialAgent: agent ? {
        name: agent.nome || null,
        document: agent.documento || null,
        code: agent.codigo || null
      } : null,
      restriction: restriction ? {
        number: maskIdentifier(restriction.numero),
        date: restriction.data || null,
        state: restriction.uf || null
      } : null,
      contract: contract ? {
        number: maskIdentifier(contract.numero),
        date: contract.data || null,
        state: contract.uf || null
      } : null,
      source: 'fontedata-gravame'
    };
  }

  function readJson(req, maxBytes = 32 * 1024) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          reject(Object.assign(new Error('Requisição muito grande.'), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw ? JSON.parse(raw) : {});
        } catch (_) {
          reject(Object.assign(new Error('Dados inválidos.'), { status: 400 }));
        }
      });
      req.on('error', reject);
    });
  }

  function sendJson(res, status, data, headers = {}) {
    const body = Buffer.from(JSON.stringify(data));
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length),
      ...headers
    });
    res.end(body);
  }

  async function createPix(req, res) {
    const limited = rateAllowed(req, 'create', 10);
    if (!limited.ok) return sendJson(res, 429, { error: 'limite_pagamentos', mensagem: 'Muitas tentativas. Tente novamente mais tarde.' }, { 'Retry-After': String(limited.retryAfter) });
    if (!FONTEDATA_API_KEY || !misticAuthorization() || !PAYMENT_SIGNING_SECRET) {
      return sendJson(res, 503, { error: 'servico_indisponivel', mensagem: 'A consulta de gravame está temporariamente indisponível.' });
    }
    const db = await initDb();
    if (!db) return sendJson(res, 503, { error: 'armazenamento_indisponivel', mensagem: 'A consulta de gravame está temporariamente indisponível.' });
    let input;
    try { input = await readJson(req); } catch (err) { return sendJson(res, err.status || 400, { error: 'dados_invalidos', mensagem: err.message }); }
    const plate = normalizePlate(input.placa);
    const name = String(input.nome || '').trim().replace(/\s+/g, ' ');
    const cpf = digits(input.cpf);
    if (!validPlate(plate)) return sendJson(res, 400, { error: 'placa_invalida', mensagem: 'Informe uma placa válida.' });
    if (name.length < 2 || name.length > 120) return sendJson(res, 400, { error: 'nome_invalido', mensagem: 'Informe o nome do pagador.' });
    if (!validCpf(cpf)) return sendJson(res, 400, { error: 'cpf_invalido', mensagem: 'Informe um CPF válido.' });
    const clientTx = `grav-${plate}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
    const payload = { amount: SALE_PRICE, payerName: name, payerDocument: cpf, transactionId: clientTx, description: `Consulta de gravame detalhado - ${plate}` };
    if (MISTIC_WEBHOOK_URL) payload.projectWebhook = MISTIC_WEBHOOK_URL;
    try {
      const response = await misticRequest('/transactions/create', payload);
      const data = response.data && response.data.data ? response.data.data : response.data;
      if (response.status < 200 || response.status >= 300 || !data || typeof data !== 'object' || data.transactionId == null) {
        console.error('GRAVAME: falha ao criar PIX', response.status);
        return sendJson(res, response.status >= 400 && response.status < 500 ? response.status : 502, { error: 'falha_criar_pix', mensagem: 'Não foi possível gerar o PIX. Tente novamente.' });
      }
      const token = signPaymentToken({ v: 1, product: PRODUCT_ID, plate, amount: SALE_PRICE, tx: String(data.transactionId), clientTx, exp: Date.now() + TOKEN_TTL_MS });
      await db.query(
        `INSERT INTO gravame_orders (payment_token_hash, plate, expires_at, updated_at)
         VALUES ($1,$2,NOW() + INTERVAL '24 hours',NOW())
         ON CONFLICT (payment_token_hash) DO UPDATE SET plate=EXCLUDED.plate, updated_at=NOW()`,
        [tokenHash(token), plate]
      );
      return sendJson(res, 201, {
        ok: true,
        produto: PRODUCT_ID,
        placa: plate,
        valor: SALE_PRICE,
        moeda: 'BRL',
        transactionId: String(data.transactionId),
        status: String(data.transactionState || 'PENDENTE').toUpperCase(),
        qrCodeBase64: data.qrCodeBase64 || null,
        qrcodeUrl: data.qrcodeUrl || null,
        copyPaste: data.copyPaste || null,
        paymentToken: token,
        expiresAt: Date.now() + TOKEN_TTL_MS
      });
    } catch (err) {
      console.error('GRAVAME: erro ao criar PIX:', err.message);
      return sendJson(res, 502, { error: 'falha_comunicacao_pix', mensagem: 'Falha de comunicação com a operadora PIX.' });
    }
  }

  async function paymentStatus(req, res) {
    const limited = rateAllowed(req, 'status', 240);
    if (!limited.ok) return sendJson(res, 429, { error: 'limite_status', mensagem: 'Muitas verificações. Aguarde alguns minutos.' }, { 'Retry-After': String(limited.retryAfter) });
    let input;
    try { input = await readJson(req); } catch (err) { return sendJson(res, err.status || 400, { error: 'dados_invalidos', mensagem: err.message }); }
    try {
      const checked = await verifyPaid(input.paymentToken);
      if (checked.paid && pool) {
        void pool.query(`UPDATE gravame_orders SET paid_at=COALESCE(paid_at,NOW()),updated_at=NOW() WHERE payment_token_hash=$1`, [tokenHash(input.paymentToken)]).catch(() => {});
      }
      return sendJson(res, 200, { ok: true, pago: checked.paid, status: checked.state, produto: PRODUCT_ID, placa: checked.payload.plate, valor: SALE_PRICE, moeda: 'BRL' });
    } catch (err) {
      return sendJson(res, err.status || 400, { error: 'pagamento_invalido', mensagem: err.message || 'Não foi possível verificar o pagamento.' });
    }
  }

  async function consultLien(req, res) {
    const limited = rateAllowed(req, 'consult', 20);
    if (!limited.ok) return sendJson(res, 429, { error: 'limite_consultas', mensagem: 'Muitas tentativas. Tente novamente mais tarde.' }, { 'Retry-After': String(limited.retryAfter) });
    if (!FONTEDATA_API_KEY) return sendJson(res, 503, { error: 'fonte_indisponivel', mensagem: 'A consulta de gravame está temporariamente indisponível.' });
    let input;
    try { input = await readJson(req); } catch (err) { return sendJson(res, err.status || 400, { error: 'dados_invalidos', mensagem: err.message }); }
    let checked;
    try { checked = await verifyPaid(input.paymentToken); }
    catch (err) { return sendJson(res, err.status || 400, { error: 'pagamento_invalido', mensagem: err.message }); }
    if (!checked.paid) return sendJson(res, 402, { error: 'pagamento_pendente', mensagem: 'Pagamento ainda não confirmado.' });
    const db = await initDb();
    if (!db) return sendJson(res, 503, { error: 'armazenamento_indisponivel', mensagem: 'Não foi possível liberar a consulta agora.' });
    const hash = tokenHash(input.paymentToken);
    const plate = checked.payload.plate;
    try {
      const existing = await db.query(`SELECT provider_status, provider_http_status, result_json FROM gravame_orders WHERE payment_token_hash=$1 AND expires_at>NOW() LIMIT 1`, [hash]);
      const row = existing.rows[0];
      if (row && row.provider_status === 'success' && row.result_json) {
        return sendJson(res, 200, { ok: true, paid: true, cached: true, price: SALE_PRICE, currency: 'BRL', gravame: row.result_json });
      }
      if (row && row.provider_status === 'error') {
        return sendJson(res, 502, { error: 'consulta_nao_concluida', mensagem: row.result_json && row.result_json.mensagem ? row.result_json.mensagem : 'A fonte não concluiu a consulta. Não repetimos automaticamente para evitar nova cobrança.' });
      }
      if (!row) {
        await db.query(`INSERT INTO gravame_orders (payment_token_hash,plate,paid_at,expires_at) VALUES ($1,$2,NOW(),NOW()+INTERVAL '24 hours') ON CONFLICT DO NOTHING`, [hash, plate]);
      }
      if (inFlight.has(hash)) {
        const result = await inFlight.get(hash);
        return sendJson(res, 200, { ok: true, paid: true, cached: true, price: SALE_PRICE, currency: 'BRL', gravame: result });
      }
      const task = (async () => {
        const provider = await fonteDataRequest(plate);
        if (provider.status < 200 || provider.status >= 300 || !provider.data || typeof provider.data !== 'object') {
          const publicMessage = provider.status === 422
            ? 'A placa não foi localizada pela fonte de gravame. A consulta não será repetida automaticamente.'
            : provider.status === 503 || provider.status === 504
              ? 'A fonte de gravame não concluiu a consulta agora. Não repetimos automaticamente para evitar uma segunda cobrança.'
              : 'Não foi possível concluir a consulta de gravame. Não repetimos automaticamente para evitar uma segunda cobrança.';
          await db.query(`UPDATE gravame_orders SET provider_status='error',provider_http_status=$2,result_json=$3::jsonb,paid_at=COALESCE(paid_at,NOW()),updated_at=NOW() WHERE payment_token_hash=$1`, [hash, provider.status, JSON.stringify({ mensagem: publicMessage })]);
          const err = new Error(publicMessage); err.status = 502; throw err;
        }
        const cleaned = cleanResult(provider.data, plate);
        await db.query(`UPDATE gravame_orders SET provider_status='success',provider_http_status=$2,result_json=$3::jsonb,paid_at=COALESCE(paid_at,NOW()),updated_at=NOW() WHERE payment_token_hash=$1`, [hash, provider.status, JSON.stringify(cleaned)]);
        console.log(`GRAVAME: consulta concluída para ${plate.slice(0, 3)}****.`);
        return cleaned;
      })();
      inFlight.set(hash, task);
      try {
        const result = await task;
        return sendJson(res, 200, { ok: true, paid: true, cached: false, price: SALE_PRICE, currency: 'BRL', gravame: result });
      } finally {
        inFlight.delete(hash);
      }
    } catch (err) {
      console.error('GRAVAME: falha na liberação:', err.message);
      return sendJson(res, err.status || 500, { error: 'falha_gravame', mensagem: err.message || 'Não foi possível liberar a consulta de gravame.' });
    }
  }

  http.createServer = function gravameBackendCreateServer(...args) {
    const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
    const listener = args[listenerIndex];
    if (typeof listener !== 'function') return priorCreateServer(...args);
    args[listenerIndex] = function gravameBackendListener(req, res) {
      let pathname = '/';
      try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (_) {}
      if (req.method === 'POST' && pathname === '/api/gravame/pix/criar') return void createPix(req, res);
      if (req.method === 'POST' && pathname === '/api/gravame/pix/status') return void paymentStatus(req, res);
      if (req.method === 'POST' && pathname === '/api/gravame/consultar') return void consultLien(req, res);
      return listener(req, res);
    };
    return priorCreateServer(...args);
  };

  void initDb();
  setInterval(async () => {
    const now = Date.now();
    for (const [key, item] of rateStores) if (now >= item.resetAt) rateStores.delete(key);
    for (const [key, item] of transactionCache) if (now >= item.expiresAt) transactionCache.delete(key);
    const db = await initDb();
    if (db) void db.query(`DELETE FROM gravame_orders WHERE expires_at < NOW()`).catch(() => {});
  }, 60 * 60 * 1000).unref();
}

if (IS_OUTER_UI) {
  const priorCreateServer = http.createServer.bind(http);
  const UI = String.raw`
<style id="cv-gravame-style">
.cv-gravame-box{margin:14px 0;padding:18px;border:1px solid #6e5520;border-radius:16px;background:linear-gradient(145deg,#231c0b,#111006);text-align:center}.cv-gravame-box h3{margin:0 0 6px;font-size:17px;color:#fff1bd}.cv-gravame-box p{margin:0;color:#b7a875;font-size:11px;line-height:1.55}.cv-gravame-btn{width:100%!important;margin:13px 0 0!important;padding:16px!important;border:1px solid #d8a52f!important;border-radius:12px!important;background:linear-gradient(135deg,#e7b22e,#a86f06)!important;color:#151005!important;font-size:12px!important;font-weight:950!important;box-shadow:0 12px 28px rgba(188,132,20,.25)!important}.cv-gravame-price{font-size:27px;font-weight:950;color:#ffe18c;margin-top:8px}.cv-gravame-price small{font-size:9px;color:#a99561}.cv-gravame-overlay{position:fixed;z-index:110000;inset:0;display:grid;place-items:center;padding:18px;background:rgba(2,5,9,.9);backdrop-filter:blur(7px)}.cv-gravame-overlay.cv-hidden{display:none!important}.cv-gravame-modal{width:min(100%,510px);max-height:92vh;overflow:auto;padding:22px;border:1px solid #7b6023;border-radius:20px;background:linear-gradient(180deg,#171307,#090a0b);box-shadow:0 30px 100px rgba(0,0,0,.7);color:#f7f7f7}.cv-gravame-top{display:flex;justify-content:space-between;gap:15px}.cv-gravame-top h2{margin:0 0 5px;font-size:21px}.cv-gravame-top p{margin:0;color:#9f9473;font-size:10px;line-height:1.5}.cv-gravame-close{width:36px!important;height:36px!important;margin:0!important;padding:0!important;border:1px solid #4d4125!important;border-radius:10px!important;background:#171309!important;color:#e9dfc0!important;box-shadow:none!important}.cv-gravame-field{margin-top:13px}.cv-gravame-field label{display:block;margin-bottom:6px;color:#d9ceb0;font-size:10px;font-weight:850}.cv-gravame-field input{width:100%;height:46px;border:1px solid #4b4027;border-radius:11px;background:#08090b;color:#fff;padding:0 12px;outline:none}.cv-gravame-pay{width:100%!important;margin-top:15px!important;padding:15px!important;border:0!important;border-radius:11px!important;background:linear-gradient(135deg,#e6b22e,#a76f06)!important;color:#171005!important;font-weight:950!important}.cv-gravame-msg{margin-top:10px;min-height:18px;color:#d9c68c;font-size:10px;line-height:1.5;text-align:center}.cv-gravame-qr{display:block;width:220px;max-width:82%;margin:16px auto;border-radius:12px;background:white;padding:8px}.cv-gravame-copy{width:100%;min-height:82px;margin-top:10px;border:1px solid #4b4027;border-radius:10px;background:#08090b;color:#d8d0bc;padding:10px;resize:none;font-size:9px}.cv-gravame-copybtn{width:100%!important;margin-top:8px!important;padding:12px!important;border:1px solid #5b4d2a!important;border-radius:10px!important;background:#19150b!important;color:#f5df9c!important;box-shadow:none!important;font-size:10px!important}.cv-gravame-result{margin-top:14px;padding:16px;border:1px solid #365c47;border-radius:15px;background:#0a1711}.cv-gravame-result h3{margin:0 0 10px;font-size:16px}.cv-gravame-row{display:flex;justify-content:space-between;gap:15px;padding:10px 0;border-bottom:1px solid #243229;font-size:10px}.cv-gravame-row span:first-child{color:#85998b}.cv-gravame-row span:last-child{text-align:right;font-weight:850;color:#e9f5ed}.cv-gravame-status{margin:8px 0 12px;padding:12px;border-radius:11px;font-weight:900;font-size:11px;text-align:center}.cv-gravame-status.ok{border:1px solid #236444;background:#0c281a;color:#89edb3}.cv-gravame-status.warn{border:1px solid #7c5c1f;background:#2a210b;color:#ffe090}.cv-gravame-status.neutral{border:1px solid #445263;background:#111a23;color:#cbd6e2}.cv-gravame-note{margin-top:12px;color:#728078;font-size:9px;line-height:1.5}.cv-hidden-step{display:none!important}@media(max-width:560px){.cv-gravame-overlay{padding:0;align-items:end}.cv-gravame-modal{border-radius:20px 20px 0 0;padding:18px}.cv-gravame-qr{width:190px}}
</style>
<div id="cv-gravame-modal" class="cv-gravame-overlay cv-hidden" role="dialog" aria-modal="true">
 <div class="cv-gravame-modal">
  <div class="cv-gravame-top"><div><h2>Gravame detalhado</h2><p>Consulta adicional da placa selecionada. Pagamento único de R$ 9,90.</p></div><button class="cv-gravame-close" type="button" onclick="cvCloseGravame()">✕</button></div>
  <div id="cv-gravame-form">
   <div class="cv-gravame-field"><label>Placa</label><input id="cv-gravame-plate" readonly></div>
   <div class="cv-gravame-field"><label>Nome do pagador</label><input id="cv-gravame-name" autocomplete="name" maxlength="120" placeholder="Nome completo"></div>
   <div class="cv-gravame-field"><label>CPF do pagador</label><input id="cv-gravame-cpf" inputmode="numeric" autocomplete="off" maxlength="14" placeholder="000.000.000-00"></div>
   <button id="cv-gravame-pay" class="cv-gravame-pay" type="button" onclick="cvCreateGravamePix()">GERAR PIX · R$ 9,90</button>
  </div>
  <div id="cv-gravame-pix" class="cv-hidden-step"><div id="cv-gravame-pixcontent"></div></div>
  <div id="cv-gravame-msg" class="cv-gravame-msg"></div>
 </div>
</div>
<script id="cv-gravame-script">
(function(){
 var state={plate:'',paymentToken:'',expiresAt:0,poll:null};
 function plate(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7)}
 function digits(v){return String(v||'').replace(/\D/g,'').slice(0,11)}
 function esc(v){return String(v===undefined||v===null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})}
 function cpfMask(v){var d=digits(v);return d.replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2')}
 function currentPlate(){var p=document.querySelector('#result .plate-result');return plate((p&&p.textContent)||((document.getElementById('cv-plate')||document.getElementById('plate')||{}).value))}
 function msg(t){var e=document.getElementById('cv-gravame-msg');if(e)e.textContent=t||''}
 function storageKey(p){return 'cv_gravame_pago_24h_'+plate(p)}
 function saved(p){try{var x=JSON.parse(localStorage.getItem(storageKey(p))||'null');if(!x||!x.paymentToken||!x.expiresAt||Date.now()>=Number(x.expiresAt)){localStorage.removeItem(storageKey(p));return null}return x}catch(e){return null}}
 function save(p,token,exp){try{localStorage.setItem(storageKey(p),JSON.stringify({paymentToken:token,expiresAt:Number(exp)||Date.now()+86400000}))}catch(e){}}
 function row(a,b){if(b===undefined||b===null||String(b).trim()==='')return '';return '<div class="cv-gravame-row"><span>'+esc(a)+'</span><span>'+esc(b)+'</span></div>'}
 function render(g){
  var holder=document.getElementById('cv-gravame-result-live');if(!holder){holder=document.createElement('div');holder.id='cv-gravame-result-live';holder.className='cv-gravame-result';var result=document.getElementById('result');if(result)result.appendChild(holder)}
  var status=String(g.status||'INDETERMINADO').toUpperCase(),cls=status==='SEM_GRAVAME'?'ok':status==='ATIVO'?'warn':'neutral';
  var label=status==='SEM_GRAVAME'?'✅ Nenhum gravame ativo informado':status==='ATIVO'?'⚠️ Gravame ativo identificado':status==='BAIXADO'?'ℹ️ Gravame baixado / histórico':'ℹ️ Situação do gravame: '+status;
  var h='<h3>🔐 Gravame detalhado</h3><div class="cv-gravame-status '+cls+'">'+esc(label)+'</div>';
  h+=row('Placa',g.plate)+row('Veículo',g.brandModel)+row('Chassi',g.chassis)+row('Situação',g.statusDescription||g.status);
  if(g.financialAgent){h+=row('Agente financeiro',g.financialAgent.name)+row('CNPJ do agente',g.financialAgent.document)+row('Código do agente',g.financialAgent.code)}
  if(g.restriction){h+=row('Restrição nº',g.restriction.number)+row('Data da restrição',g.restriction.date)+row('UF da restrição',g.restriction.state)}
  if(g.contract){h+=row('Contrato nº',g.contract.number)+row('Data do contrato',g.contract.date)+row('UF do contrato',g.contract.state)}
  h+='<div class="cv-gravame-note">Resultado correspondente à fonte consultada no momento da pesquisa. Números sensíveis de chassi, restrição e contrato são parcialmente mascarados.</div>';holder.innerHTML=h;
  setTimeout(function(){holder.scrollIntoView({behavior:'smooth',block:'start'})},100)
 }
 async function consult(token){msg('Pagamento confirmado. Consultando o gravame — isso pode levar até cerca de 90 segundos...');var r=await fetch('/api/gravame/consultar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paymentToken:token}),cache:'no-store'});var d={};try{d=await r.json()}catch(e){}if(!r.ok||!d.gravame)throw new Error(d.mensagem||'Não foi possível concluir a consulta de gravame.');render(d.gravame);window.cvCloseGravame();return d}
 async function poll(){if(!state.paymentToken)return;try{var r=await fetch('/api/gravame/pix/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paymentToken:state.paymentToken}),cache:'no-store'});var d={};try{d=await r.json()}catch(e){}if(!r.ok)throw new Error(d.mensagem||'Não foi possível verificar o pagamento.');if(d.pago){if(state.poll){clearInterval(state.poll);state.poll=null}save(state.plate,state.paymentToken,state.expiresAt);await consult(state.paymentToken);return}msg('Aguardando confirmação do PIX...')}catch(e){msg(e.message||'Falha ao verificar pagamento.')}}
 function addButton(){var result=document.getElementById('result');if(!result||result.classList.contains('hidden')||!currentPlate())return;if(document.getElementById('cv-gravame-box'))return;var box=document.createElement('div');box.id='cv-gravame-box';box.className='cv-gravame-box';box.innerHTML='<h3>🔐 Consulte o gravame detalhado</h3><p>Veja se existe alienação/gravame ativo e, quando disponível, agente financeiro, data e dados do contrato.</p><div class="cv-gravame-price">R$ 9,90 <small>consulta adicional</small></div><button class="cv-gravame-btn" type="button" onclick="cvOpenGravame()">CONSULTAR GRAVAME DETALHADO · R$ 9,90</button>';var actions=result.querySelector('.report-actions'),unlock=result.querySelector('.unlock');if(unlock)unlock.insertAdjacentElement('afterend',box);else if(actions)actions.insertAdjacentElement('beforebegin',box);else result.appendChild(box)}
 window.cvOpenGravame=async function(){state.plate=currentPlate();if(!state.plate)return;var old=saved(state.plate);if(old){state.paymentToken=old.paymentToken;state.expiresAt=old.expiresAt;var modal=document.getElementById('cv-gravame-modal');if(modal)modal.classList.remove('cv-hidden');msg('Abrindo sua consulta de gravame já paga...');try{await consult(old.paymentToken)}catch(e){try{localStorage.removeItem(storageKey(state.plate))}catch(_){}msg(e.message)}return}document.getElementById('cv-gravame-plate').value=state.plate;document.getElementById('cv-gravame-form').classList.remove('cv-hidden-step');document.getElementById('cv-gravame-pix').classList.add('cv-hidden-step');document.getElementById('cv-gravame-pixcontent').innerHTML='';msg('');document.getElementById('cv-gravame-modal').classList.remove('cv-hidden');document.body.classList.add('no-scroll')};
 window.cvCloseGravame=function(){document.getElementById('cv-gravame-modal').classList.add('cv-hidden');document.body.classList.remove('no-scroll')};
 window.cvCreateGravamePix=async function(){var name=(document.getElementById('cv-gravame-name').value||'').trim(),cpf=digits(document.getElementById('cv-gravame-cpf').value),btn=document.getElementById('cv-gravame-pay');if(name.length<2||cpf.length!==11){msg('Informe o nome e um CPF válido do pagador.');return}btn.disabled=true;btn.textContent='GERANDO PIX...';msg('Gerando cobrança segura...');try{var r=await fetch('/api/gravame/pix/criar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({placa:state.plate,nome:name,cpf:cpf}),cache:'no-store'});var d={};try{d=await r.json()}catch(e){}if(!r.ok||!d.paymentToken)throw new Error(d.mensagem||'Não foi possível gerar o PIX.');state.paymentToken=d.paymentToken;state.expiresAt=Number(d.expiresAt)||Date.now()+86400000;var html='<div style="text-align:center;margin-top:14px"><b>PIX de R$ 9,90 gerado</b><br><small style="color:#9f9473">Pague e aguarde a confirmação automática.</small></div>';if(d.qrCodeBase64)html+='<img class="cv-gravame-qr" alt="QR Code PIX" src="data:image/png;base64,'+esc(String(d.qrCodeBase64).replace(/^data:image\/[^;]+;base64,/,''))+'">';if(d.copyPaste)html+='<textarea id="cv-gravame-copy" class="cv-gravame-copy" readonly>'+esc(d.copyPaste)+'</textarea><button class="cv-gravame-copybtn" type="button" onclick="cvCopyGravamePix()">COPIAR PIX COPIA E COLA</button>';document.getElementById('cv-gravame-pixcontent').innerHTML=html;document.getElementById('cv-gravame-form').classList.add('cv-hidden-step');document.getElementById('cv-gravame-pix').classList.remove('cv-hidden-step');msg('Aguardando pagamento...');if(state.poll)clearInterval(state.poll);state.poll=setInterval(poll,3000);poll()}catch(e){msg(e.message||'Falha ao gerar PIX.')}finally{btn.disabled=false;btn.textContent='GERAR PIX · R$ 9,90'}};
 window.cvCopyGravamePix=function(){var e=document.getElementById('cv-gravame-copy');if(!e)return;var text=e.value;if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(function(){msg('PIX copiado.')}).catch(function(){e.select();document.execCommand('copy')})}else{e.select();document.execCommand('copy');msg('PIX copiado.')}};
 document.addEventListener('DOMContentLoaded',function(){var cpf=document.getElementById('cv-gravame-cpf');if(cpf)cpf.addEventListener('input',function(e){e.target.value=cpfMask(e.target.value)});var result=document.getElementById('result');if(result){new MutationObserver(function(){setTimeout(addButton,0)}).observe(result,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});addButton()}var modal=document.getElementById('cv-gravame-modal');if(modal)modal.addEventListener('click',function(e){if(e.target===modal)window.cvCloseGravame()})});
})();
</script>`;

  http.createServer = function gravameUiCreateServer(...args) {
    const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
    const listener = args[listenerIndex];
    if (typeof listener !== 'function') return priorCreateServer(...args);
    args[listenerIndex] = function gravameUiListener(req, res) {
      let pathname = '/';
      try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (_) {}
      const isHome = req.method === 'GET' && (pathname === '/' || pathname === '/index.html');
      if (!isHome) return listener(req, res);
      const originalWriteHead = res.writeHead.bind(res);
      const originalEnd = res.end.bind(res);
      let captured = null;
      res.writeHead = function (statusCode, statusMessageOrHeaders, headersMaybe) {
        captured = { statusCode, statusMessage: null, headers: {} };
        if (typeof statusMessageOrHeaders === 'string') { captured.statusMessage = statusMessageOrHeaders; captured.headers = headersMaybe || {}; }
        else captured.headers = statusMessageOrHeaders || {};
        return res;
      };
      res.end = function (chunk, encoding, callback) {
        try {
          if (chunk != null) {
            let body = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
            const headers = captured && captured.headers ? captured.headers : {};
            const contentType = String(headers['content-type'] || headers['Content-Type'] || res.getHeader('content-type') || '');
            if (contentType.includes('text/html') && !body.includes('id="cv-gravame-script"')) {
              body = body.replace('</body>', UI + '\n</body>');
              chunk = Buffer.from(body, 'utf8');
              headers['content-length'] = String(chunk.length);
              delete headers['Content-Length'];
              if (captured) captured.headers = headers;
            }
          }
        } catch (_) {}
        if (captured) {
          if (captured.statusMessage) originalWriteHead(captured.statusCode, captured.statusMessage, captured.headers);
          else originalWriteHead(captured.statusCode, captured.headers);
          captured = null;
        }
        if (typeof encoding === 'function') return originalEnd(chunk, encoding);
        if (typeof callback === 'function') return originalEnd(chunk, encoding, callback);
        return originalEnd(chunk, encoding);
      };
      return listener(req, res);
    };
    return priorCreateServer(...args);
  };
}
