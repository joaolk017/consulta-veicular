'use strict';

const path = require('path');
const IS_BACKEND_SERVER = path.basename(String(process.argv[1] || '')).toLowerCase() === 'server.js';

if (IS_BACKEND_SERVER) {
  const http = require('http');
  const crypto = require('crypto');
  const express = require('express');
  const { Pool } = require('pg');

  const priorCreateServer = http.createServer.bind(http);
  const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
  const PAYMENT_SIGNING_SECRET = String(process.env.PAYMENT_SIGNING_SECRET || '').trim();
  const TTL_MS = 24 * 60 * 60 * 1000;
  const MAX_BODY_BYTES = 32 * 1024;
  const recoveryAttempts = new Map();
  let pool = null;
  let initPromise = null;

  function digits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function normalizePlate(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  }

  function validPlate(value) {
    const plate = normalizePlate(value);
    return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate) || /^[A-Z]{3}[0-9]{4}$/.test(plate);
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

  function hmacCpf(value) {
    const cpf = digits(value);
    if (!PAYMENT_SIGNING_SECRET || !validCpf(cpf)) return null;
    return crypto.createHmac('sha256', PAYMENT_SIGNING_SECRET).update(`cpf:${cpf}`).digest('hex');
  }

  function tokenHash(value) {
    if (!value) return null;
    return crypto.createHash('sha256').update(String(value)).digest('hex');
  }

  function clientIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(v => v.trim()).filter(Boolean);
    return forwarded.length ? forwarded[forwarded.length - 1] : (req.socket.remoteAddress || 'unknown');
  }

  function allowRecoveryAttempt(req) {
    const key = clientIp(req);
    const now = Date.now();
    let entry = recoveryAttempts.get(key);
    if (!entry || now >= entry.resetAt) entry = { count: 0, resetAt: now + 60 * 60 * 1000 };
    if (entry.count >= 12) return { allowed: false, retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
    entry.count += 1;
    recoveryAttempts.set(key, entry);
    return { allowed: true };
  }

  function signReportAccess(vehicle, expiresAt) {
    if (!PAYMENT_SIGNING_SECRET || !vehicle || !vehicle.plate) return null;
    const exp = Math.min(Number(expiresAt) || (Date.now() + TTL_MS), Date.now() + TTL_MS);
    if (!Number.isFinite(exp) || exp <= Date.now()) return null;
    const payload = {
      v: 1,
      kind: 'report-access',
      product: 'consulta-completa',
      plate: String(vehicle.plate).toUpperCase(),
      vehicle,
      iat: Date.now(),
      exp
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', PAYMENT_SIGNING_SECRET).update(encoded).digest('base64url');
    return { token: `${encoded}.${signature}`, expiresAt: exp };
  }

  async function initDb() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (!DATABASE_URL || !PAYMENT_SIGNING_SECRET) return null;
      pool = new Pool({
        connectionString: DATABASE_URL,
        max: 3,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        ssl: DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1') ? false : { rejectUnauthorized: false }
      });
      await pool.query(`
        CREATE TABLE IF NOT EXISTS report_recovery (
          payment_token_hash CHAR(64) PRIMARY KEY,
          plate VARCHAR(8) NOT NULL,
          payer_document_hash CHAR(64) NOT NULL,
          report_json JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          paid_at TIMESTAMPTZ,
          expires_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_report_recovery_lookup
          ON report_recovery(payer_document_hash, plate, expires_at DESC);
        DELETE FROM report_recovery
          WHERE (expires_at IS NOT NULL AND expires_at < NOW())
             OR (expires_at IS NULL AND created_at < NOW() - INTERVAL '48 hours');
      `);
      console.log('RECOVERY_24H: recuperação por CPF + placa pronta.');
      return pool;
    })().catch(err => {
      console.error('RECOVERY_24H: falha ao iniciar armazenamento:', err.message);
      pool = null;
      return null;
    });
    return initPromise;
  }

  async function rememberPayment(req, responseBody) {
    if (!responseBody || !responseBody.paymentToken) return;
    const plate = normalizePlate(req.body && req.body.placa);
    const payerHash = hmacCpf(req.body && req.body.cpf);
    const p = await initDb();
    if (!p || !validPlate(plate) || !payerHash) return;
    await p.query(
      `INSERT INTO report_recovery (payment_token_hash, plate, payer_document_hash, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (payment_token_hash)
       DO UPDATE SET plate=EXCLUDED.plate, payer_document_hash=EXCLUDED.payer_document_hash, updated_at=NOW()`,
      [tokenHash(responseBody.paymentToken), plate, payerHash]
    );
  }

  async function rememberReport(req, responseBody) {
    if (!responseBody || responseBody.paid !== true || !responseBody.vehicle || !responseBody.vehicle.plate) return;
    const paymentToken = req.body && req.body.paymentToken;
    const p = await initDb();
    if (!p || !paymentToken) return;
    await p.query(
      `UPDATE report_recovery
          SET report_json=$2::jsonb,
              paid_at=COALESCE(paid_at, NOW()),
              expires_at=COALESCE(expires_at, NOW() + INTERVAL '24 hours'),
              updated_at=NOW()
        WHERE payment_token_hash=$1`,
      [tokenHash(paymentToken), JSON.stringify(responseBody.vehicle)]
    );
  }

  const originalJson = express.response.json;
  express.response.json = function recoveryAwareJson(body) {
    try {
      const req = this.req;
      const pathname = req ? new URL(req.url, 'http://localhost').pathname : '';
      const ok = this.statusCode >= 200 && this.statusCode < 300;
      if (ok && pathname === '/api/pagamento/pix/criar') {
        void rememberPayment(req, body).catch(err => console.error('RECOVERY_24H: falha ao vincular CPF ao pagamento:', err.message));
      } else if (ok && pathname === '/api/consulta-completa') {
        void rememberReport(req, body).catch(err => console.error('RECOVERY_24H: falha ao salvar relatório temporário:', err.message));
      }
    } catch (_) {}
    return originalJson.call(this, body);
  };

  function readJson(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
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

  function sendJson(res, status, data, extraHeaders = {}) {
    const body = Buffer.from(JSON.stringify(data));
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length),
      ...extraHeaders
    });
    res.end(body);
  }

  async function handleRecovery(req, res) {
    const limit = allowRecoveryAttempt(req);
    if (!limit.allowed) {
      return sendJson(res, 429, { error: 'muitas_tentativas', mensagem: 'Muitas tentativas de recuperação. Tente novamente mais tarde.' }, { 'Retry-After': String(limit.retryAfter) });
    }

    let data;
    try { data = await readJson(req); }
    catch (err) { return sendJson(res, err.status || 400, { error: 'dados_invalidos', mensagem: err.message }); }

    const plate = normalizePlate(data.placa);
    const cpf = digits(data.cpf);
    if (!validPlate(plate) || !validCpf(cpf)) {
      return sendJson(res, 400, { error: 'dados_invalidos', mensagem: 'Informe a placa e o CPF usados no pagamento.' });
    }

    const p = await initDb();
    const payerHash = hmacCpf(cpf);
    if (!p || !payerHash) {
      return sendJson(res, 503, { error: 'recuperacao_indisponivel', mensagem: 'A recuperação está temporariamente indisponível.' });
    }

    try {
      const found = await p.query(
        `SELECT report_json, EXTRACT(EPOCH FROM expires_at) * 1000 AS expires_at_ms
           FROM report_recovery
          WHERE payer_document_hash=$1
            AND plate=$2
            AND report_json IS NOT NULL
            AND expires_at IS NOT NULL
            AND expires_at > NOW()
          ORDER BY expires_at DESC
          LIMIT 1`,
        [payerHash, plate]
      );
      const row = found.rows[0];
      if (!row || !row.report_json) {
        return sendJson(res, 404, { error: 'consulta_nao_encontrada', mensagem: 'Não encontramos uma consulta paga válida nas últimas 24 horas para os dados informados.' });
      }
      const access = signReportAccess(row.report_json, Number(row.expires_at_ms));
      if (!access) return sendJson(res, 404, { error: 'consulta_nao_encontrada', mensagem: 'Não encontramos uma consulta paga válida nas últimas 24 horas para os dados informados.' });

      return sendJson(res, 200, {
        ok: true,
        paid: true,
        restored: true,
        vehicle: row.report_json,
        price: 18.90,
        currency: 'BRL',
        reportAccessToken: access.token,
        reportAccessExpiresAt: access.expiresAt
      });
    } catch (err) {
      console.error('RECOVERY_24H: falha na recuperação:', err.message);
      return sendJson(res, 500, { error: 'falha_recuperacao', mensagem: 'Não foi possível recuperar a consulta agora.' });
    }
  }

  http.createServer = function recoveryCreateServer(...args) {
    const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
    const listener = args[listenerIndex];
    if (typeof listener !== 'function') return priorCreateServer(...args);

    args[listenerIndex] = function recoveryListener(req, res) {
      let pathname = '/';
      try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (_) {}
      if (req.method === 'POST' && pathname === '/api/consulta/recuperar') {
        return void handleRecovery(req, res);
      }
      return listener(req, res);
    };
    return priorCreateServer(...args);
  };

  void initDb();
  setInterval(async () => {
    const p = await initDb();
    if (!p) return;
    try {
      await p.query(`DELETE FROM report_recovery WHERE (expires_at IS NOT NULL AND expires_at < NOW()) OR (expires_at IS NULL AND created_at < NOW() - INTERVAL '48 hours')`);
    } catch (_) {}
    const now = Date.now();
    for (const [key, entry] of recoveryAttempts) if (now >= entry.resetAt) recoveryAttempts.delete(key);
  }, 60 * 60 * 1000).unref();
}
