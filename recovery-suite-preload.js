'use strict';

const path = require('path');
const http = require('http');

const ENTRYPOINT = path.basename(String(process.argv[1] || '')).toLowerCase();
const IS_BACKEND = ENTRYPOINT === 'server.js';
const IS_OUTER_UI = ENTRYPOINT === 'recovery-ui-proxy.js';

const REPORT_PRICE = 18.90;
const TTL_MS = 24 * 60 * 60 * 1000;

if (IS_BACKEND) {
  const https = require('https');
  const crypto = require('crypto');
  const express = require('express');
  const { Pool } = require('pg');

  const priorCreateServer = http.createServer.bind(http);
  const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
  const PAYMENT_SIGNING_SECRET = String(process.env.PAYMENT_SIGNING_SECRET || '').trim();
  const FONTEDATA_API_KEY = String(process.env.FONTEDATA_API_KEY || '').trim();
  const MISTIC_PAY_URL = String(process.env.MISTIC_PAY_URL || 'https://api.misticpay.com/api').replace(/\/+$/, '');
  const MISTIC_CLIENT_ID = String(process.env.MISTIC_CLIENT_ID || '').trim();
  const MISTIC_CLIENT_SECRET = String(process.env.MISTIC_CLIENT_SECRET || '').trim();
  const MISTIC_AUTH_HEADER = String(process.env.MISTIC_AUTH_HEADER || '').trim();
  const ENDPOINT = 'https://app.fontedata.com/api/v1/consulta/consulta-veicular';
  const MAX_BODY_BYTES = 32 * 1024;
  const recoveryAttempts = new Map();
  const rebuildInFlight = new Map();

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
    if (!PAYMENT_SIGNING_SECRET || !validCpf(value)) return null;
    return crypto.createHmac('sha256', PAYMENT_SIGNING_SECRET)
      .update(`cpf:${digits(value)}`)
      .digest('hex');
  }

  function tokenHash(value) {
    if (!value) return null;
    return crypto.createHash('sha256').update(String(value)).digest('hex');
  }

  function clientIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);
    return forwarded.length ? forwarded[forwarded.length - 1] : (req.socket.remoteAddress || 'unknown');
  }

  function allowRecoveryAttempt(req) {
    const key = clientIp(req);
    const now = Date.now();
    let entry = recoveryAttempts.get(key);
    if (!entry || now >= entry.resetAt) entry = { count: 0, resetAt: now + 60 * 60 * 1000 };
    if (entry.count >= 12) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
    }
    entry.count += 1;
    recoveryAttempts.set(key, entry);
    return { allowed: true };
  }

  function cleanText(value, max = 180) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim().replace(/\s+/g, ' ');
    return text ? text.slice(0, max) : null;
  }

  function cleanNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function boolOrNull(value) {
    if (value === true || value === false) return value;
    if (value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
    if (value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false;
    return null;
  }

  function maskIdentifier(value, visibleEnd = 4) {
    const text = cleanText(value, 80);
    if (!text) return null;
    const compact = text.replace(/\s/g, '');
    if (compact.length <= visibleEnd) return compact;
    return `${'•'.repeat(Math.min(8, Math.max(3, compact.length - visibleEnd)))}${compact.slice(-visibleEnd)}`;
  }

  function maskChassis(value) {
    const text = cleanText(value, 40);
    if (!text) return null;
    const compact = text.replace(/\s/g, '').toUpperCase();
    if (compact.length <= 8) return maskIdentifier(compact, 4);
    return `${compact.slice(0, 3)}${'•'.repeat(Math.min(10, compact.length - 7))}${compact.slice(-4)}`;
  }

  function sanitizeRestrictions(value) {
    if (!Array.isArray(value)) return value == null ? null : [];
    return value
      .map(item => cleanText(
        typeof item === 'string'
          ? item
          : (item && (item.descricao || item.description || item.nome || item.tipo)),
        240
      ))
      .filter(Boolean)
      .slice(0, 30);
  }

  function pickPayload(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.veiculo && typeof data.veiculo === 'object') return data;
    if (data.data && typeof data.data === 'object' && data.data.veiculo) return data.data;
    if (data.resultado && typeof data.resultado === 'object' && data.resultado.veiculo) return data.resultado;
    return data;
  }

  function mapFonteData(data, requestedPlate) {
    const payload = pickPayload(data) || {};
    const source = payload.veiculo && typeof payload.veiculo === 'object' ? payload.veiculo : {};
    const indicators = source.indicadores && typeof source.indicadores === 'object'
      ? source.indicadores
      : (payload.indicadores && typeof payload.indicadores === 'object' ? payload.indicadores : {});
    const fipe = source.fipe && typeof source.fipe === 'object' ? source.fipe : null;

    return {
      plate: normalizePlate(source.placa || requestedPlate),
      brand: cleanText(source.marca),
      model: cleanText(source.modelo),
      year: cleanText(source.anoFabricacao),
      modelYear: cleanText(source.anoModelo),
      color: cleanText(source.cor),
      city: cleanText(source.municipio),
      state: cleanText(source.uf, 10),
      fuel: cleanText(source.combustivel),
      type: cleanText(source.tipo),
      renavam: maskIdentifier(source.renavam, 4),
      chassis: maskChassis(source.chassi),
      status: cleanText(source.situacaoVeiculo),
      origin: cleanText(source.procedenciaVeiculo),
      exerciseYear: cleanText(payload.anoExercicio, 12),
      source: 'fontedata',
      sourceStatus: 'ok',
      fipe: fipe ? {
        value: cleanText(fipe.valor, 60),
        numericValue: cleanNumber(fipe.valorNumerico),
        code: cleanText(fipe.codigoFipe, 40),
        brand: cleanText(fipe.marcaFipe),
        model: cleanText(fipe.modeloFipe),
        fuel: cleanText(fipe.combustivel),
        referenceMonth: cleanText(fipe.mesReferencia, 80),
        modelYear: cleanText(fipe.anoModelo, 12),
        status: cleanText(fipe.status, 80)
      } : null,
      restrictions: sanitizeRestrictions(source.restricoes),
      indicators: {
        theft: boolOrNull(indicators.rouboFurto),
        auction: boolOrNull(indicators.leilao),
        recall: boolOrNull(indicators.recall),
        renajud: boolOrNull(indicators.renajud),
        renainf: boolOrNull(indicators.renainf),
        saleCommunication: boolOrNull(indicators.comunicadoVenda),
        documentationPending: boolOrNull(indicators.pendenciaEmissao),
        rfb: boolOrNull(indicators.rfb),
        alarm: boolOrNull(indicators.alarme),
        siniav: boolOrNull(indicators.siniav),
        chassisRemarked: boolOrNull(source.indicadorRemarcacaoChassi)
      },
      technical: {
        engine: maskIdentifier(source.numeroMotor, 4),
        transmission: maskIdentifier(source.numeroCambio, 4),
        displacement: cleanText(source.cilindrada, 40),
        power: cleanText(source.potencia, 40),
        axles: cleanText(source.numeroEixos, 20),
        bodyType: cleanText(source.tipoCarroceria),
        category: cleanText(source.categoria),
        species: cleanText(source.especie),
        grossWeight: cleanText(source.pesoBrutoTotal, 60),
        loadCapacity: cleanText(source.capacidaDeCarga ?? source.capacidadeMaximaCarga, 60),
        maxTraction: cleanText(source.capacidadeMaximaTracao, 60),
        passengers: cleanText(source.capacidadedePassageiros, 30),
        chassisRemarkDescription: cleanText(source.descricaoRemarcacaoChassi, 220)
      },
      documents: {
        crvIssuedAt: cleanText(source.dataEmissaoCrv, 60),
        crlvIssuedAt: cleanText(source.dataEmissaoCrlv, 60)
      }
    };
  }

  function misticAuthorization() {
    const configured = MISTIC_AUTH_HEADER.replace(/^Authorization\s*:\s*/i, '');
    if (configured) return /^Basic\s+/i.test(configured) ? configured : `Basic ${configured}`;
    if (!MISTIC_CLIENT_ID || !MISTIC_CLIENT_SECRET) return null;
    return `Basic ${Buffer.from(`${MISTIC_CLIENT_ID}:${MISTIC_CLIENT_SECRET}`).toString('base64')}`;
  }

  function misticAmountMatches(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return false;
    return Math.abs(amount - REPORT_PRICE) < 0.011 || Math.abs((amount / 100) - REPORT_PRICE) < 0.011;
  }

  function checkMisticTransaction(transactionId) {
    return new Promise((resolve, reject) => {
      const authorization = misticAuthorization();
      if (!authorization) return reject(new Error('Credenciais de pagamento não configuradas.'));

      let url;
      try {
        url = new URL(`${MISTIC_PAY_URL}/transactions/check`);
      } catch (_) {
        return reject(new Error('URL da operadora de pagamento inválida.'));
      }

      const body = JSON.stringify({ transactionId: String(transactionId) });
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
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          let data = null;
          try {
            data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          } catch (_) {}
          const status = response.statusCode || 502;
          if (status < 200 || status >= 300 || !data || typeof data !== 'object') {
            return reject(Object.assign(new Error('Não foi possível verificar o pagamento.'), { status }));
          }
          resolve(data.transaction || data.data || data);
        });
      });

      request.setTimeout(20000, () => request.destroy(new Error('Tempo limite ao verificar o pagamento.')));
      request.on('error', reject);
      request.write(body);
      request.end();
    });
  }

  function isPaidTransaction(transaction) {
    if (!transaction || typeof transaction !== 'object') return false;
    const state = String(transaction.transactionState || transaction.status || '').toUpperCase();
    const type = String(transaction.transactionType || '').toUpperCase();
    const method = String(transaction.transactionMethod || '').toUpperCase();
    const value = transaction.value ?? transaction.transactionAmount ?? transaction.amount;

    return state === 'COMPLETO'
      && (!type || type === 'DEPOSITO')
      && (!method || method === 'PIX')
      && misticAmountMatches(value);
  }

  function requestFonteData(plate) {
    return new Promise((resolve, reject) => {
      if (!FONTEDATA_API_KEY) return reject(new Error('Fonte veicular não configurada.'));

      const url = new URL(ENDPOINT);
      url.searchParams.set('placa', plate);

      const request = https.get(url, {
        headers: {
          'X-API-Key': FONTEDATA_API_KEY,
          Accept: 'application/json',
          'User-Agent': 'ConsultaVeicular360/1.0'
        }
      }, response => {
        const chunks = [];
        let size = 0;

        response.on('data', chunk => {
          size += chunk.length;
          if (size <= 4 * 1024 * 1024) chunks.push(chunk);
        });

        response.on('end', () => {
          if (size > 4 * 1024 * 1024) {
            return reject(new Error('Resposta da fonte veicular excedeu o limite.'));
          }

          let data = null;
          try {
            data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          } catch (_) {}

          const status = response.statusCode || 502;
          if (status >= 200 && status < 300 && data && typeof data === 'object') return resolve(data);
          reject(Object.assign(new Error('A base veicular não respondeu agora.'), { status }));
        });
      });

      request.setTimeout(30000, () => request.destroy(new Error('Tempo limite da base veicular excedido.')));
      request.on('error', reject);
    });
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
        ssl: DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1')
          ? false
          : { rejectUnauthorized: false }
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

      console.log('RECOVERY_SUITE: backend de recuperação e PDF pronto.');
      return pool;
    })().catch(err => {
      console.error('RECOVERY_SUITE: falha ao iniciar armazenamento:', err.message);
      pool = null;
      return null;
    });

    return initPromise;
  }

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
    if (res.headersSent) return;
    const body = Buffer.from(JSON.stringify(data));
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length),
      ...extraHeaders
    });
    res.end(body);
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
    const signature = crypto
      .createHmac('sha256', PAYMENT_SIGNING_SECRET)
      .update(encoded)
      .digest('base64url');

    return { token: `${encoded}.${signature}`, expiresAt: exp };
  }

  async function rememberPayment(req, responseBody) {
    if (!responseBody || !responseBody.paymentToken) return;

    const plate = normalizePlate(req.body && req.body.placa);
    const payerHash = hmacCpf(req.body && req.body.cpf);
    const db = await initDb();

    if (!db || !validPlate(plate) || !payerHash) return;

    await db.query(
      `INSERT INTO report_recovery (payment_token_hash, plate, payer_document_hash, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (payment_token_hash)
       DO UPDATE SET plate=EXCLUDED.plate,
                     payer_document_hash=EXCLUDED.payer_document_hash,
                     updated_at=NOW()`,
      [tokenHash(responseBody.paymentToken), plate, payerHash]
    );
  }

  async function rememberReport(req, responseBody) {
    if (!responseBody || responseBody.paid !== true || !responseBody.vehicle || !responseBody.vehicle.plate) return;

    const paymentToken = req.body && req.body.paymentToken;
    const db = await initDb();

    if (!db || !paymentToken) return;

    await db.query(
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
  express.response.json = function recoverySuiteAwareJson(body) {
    try {
      const req = this.req;
      const pathname = req ? new URL(req.url, 'http://localhost').pathname : '';
      const ok = this.statusCode >= 200 && this.statusCode < 300;

      if (ok && pathname === '/api/pagamento/pix/criar') {
        void rememberPayment(req, body).catch(err =>
          console.error('RECOVERY_SUITE: falha ao vincular pagamento:', err.message)
        );
      } else if (ok && pathname === '/api/consulta-completa') {
        void rememberReport(req, body).catch(err =>
          console.error('RECOVERY_SUITE: falha ao salvar relatório:', err.message)
        );
      }
    } catch (_) {}

    return originalJson.call(this, body);
  };

  async function rebuildPaidReport(row, plate) {
    const key = String(row.payment_token_hash || plate);
    if (rebuildInFlight.has(key)) return rebuildInFlight.get(key);

    const promise = (async () => {
      if (!row.provider_transaction_id) {
        throw Object.assign(new Error('Pagamento não pôde ser localizado para recuperação.'), { status: 404 });
      }

      const locallyVerified =
        String(row.payment_status || '').toUpperCase() === 'COMPLETO'
        && Boolean(row.order_paid_at);

      if (!locallyVerified) {
        const transaction = await checkMisticTransaction(row.provider_transaction_id);
        if (!isPaidTransaction(transaction)) {
          throw Object.assign(
            new Error('O pagamento desta consulta ainda não consta como confirmado.'),
            { status: 402 }
          );
        }
      }

      const raw = await requestFonteData(plate);
      return mapFonteData(raw, plate);
    })();

    rebuildInFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      rebuildInFlight.delete(key);
    }
  }

  async function handleRecovery(req, res) {
    const limit = allowRecoveryAttempt(req);
    if (!limit.allowed) {
      return sendJson(
        res,
        429,
        {
          error: 'muitas_tentativas',
          mensagem: 'Muitas tentativas de recuperação. Tente novamente mais tarde.'
        },
        { 'Retry-After': String(limit.retryAfter) }
      );
    }

    let data;
    try {
      data = await readJson(req);
    } catch (err) {
      return sendJson(res, err.status || 400, {
        error: 'dados_invalidos',
        mensagem: err.message
      });
    }

    const plate = normalizePlate(data.placa);
    const cpf = digits(data.cpf);

    if (!validPlate(plate) || !validCpf(cpf)) {
      return sendJson(res, 400, {
        error: 'dados_invalidos',
        mensagem: 'Informe a placa e o CPF usados no pagamento.'
      });
    }

    const db = await initDb();
    const payerHash = hmacCpf(cpf);

    if (!db || !payerHash) {
      return sendJson(res, 503, {
        error: 'recuperacao_indisponivel',
        mensagem: 'A recuperação está temporariamente indisponível.'
      });
    }

    try {
      const found = await db.query(`
        SELECT rr.payment_token_hash,
               rr.report_json,
               rr.created_at,
               rr.paid_at,
               rr.expires_at,
               EXTRACT(EPOCH FROM rr.expires_at) * 1000 AS expires_at_ms,
               o.provider_transaction_id,
               o.payment_status,
               o.paid_at AS order_paid_at
          FROM report_recovery rr
          LEFT JOIN orders o ON o.payment_token_hash = rr.payment_token_hash
         WHERE rr.payer_document_hash=$1
           AND rr.plate=$2
           AND (
             (rr.report_json IS NOT NULL AND rr.expires_at IS NOT NULL AND rr.expires_at > NOW())
             OR rr.created_at > NOW() - INTERVAL '24 hours'
           )
         ORDER BY COALESCE(rr.paid_at, o.paid_at, rr.created_at) DESC
         LIMIT 1`,
        [payerHash, plate]
      );

      const row = found.rows[0];

      if (!row) {
        return sendJson(res, 404, {
          error: 'consulta_nao_encontrada',
          mensagem: 'Não encontramos uma consulta vinculada a essa placa e CPF nas últimas 24 horas.'
        });
      }

      let vehicle = row.report_json;
      let expiresAt = Number(row.expires_at_ms || 0);

      if (!vehicle || !expiresAt || expiresAt <= Date.now()) {
        try {
          vehicle = await rebuildPaidReport(row, plate);
        } catch (err) {
          const status = err.status === 402 ? 402 : (err.status === 404 ? 404 : 502);
          return sendJson(res, status, {
            error: status === 402
              ? 'pagamento_pendente'
              : (status === 404 ? 'consulta_nao_encontrada' : 'fonte_veicular_indisponivel'),
            pagamentoConfirmado: status === 502 ? true : undefined,
            mensagem: status === 502
              ? 'Pagamento confirmado, mas a base veicular não respondeu agora. Tente recuperar novamente em alguns instantes.'
              : err.message
          });
        }

        const saved = await db.query(`
          UPDATE report_recovery
             SET report_json=$2::jsonb,
                 paid_at=COALESCE(paid_at, NOW()),
                 expires_at=NOW() + INTERVAL '24 hours',
                 updated_at=NOW()
           WHERE payment_token_hash=$1
           RETURNING EXTRACT(EPOCH FROM expires_at) * 1000 AS expires_at_ms`,
          [row.payment_token_hash, JSON.stringify(vehicle)]
        );

        expiresAt =
          Number(saved.rows[0] && saved.rows[0].expires_at_ms)
          || (Date.now() + TTL_MS);

        try {
          await db.query(
            `UPDATE orders
                SET payment_status='COMPLETO',
                    paid_at=COALESCE(paid_at,NOW()),
                    fulfillment_status='LIBERADO',
                    fulfilled_at=COALESCE(fulfilled_at,NOW()),
                    updated_at=NOW()
              WHERE payment_token_hash=$1`,
            [row.payment_token_hash]
          );
        } catch (_) {}
      }

      const access = signReportAccess(vehicle, expiresAt);

      if (!access) {
        return sendJson(res, 500, {
          error: 'falha_recuperacao',
          mensagem: 'Não foi possível gerar o acesso da consulta.'
        });
      }

      console.log(`RECOVERY_SUITE: consulta recuperada (${plate.slice(0, 3)}****).`);

      return sendJson(res, 200, {
        ok: true,
        paid: true,
        restored: true,
        vehicle,
        price: REPORT_PRICE,
        currency: 'BRL',
        reportAccessToken: access.token,
        reportAccessExpiresAt: access.expiresAt
      });
    } catch (err) {
      console.error('RECOVERY_SUITE: falha na recuperação:', err.message);
      return sendJson(res, 500, {
        error: 'falha_recuperacao',
        mensagem: 'Não foi possível recuperar a consulta agora.'
      });
    }
  }

  http.createServer = function recoverySuiteBackendCreateServer(...args) {
    const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
    const listener = args[listenerIndex];

    if (typeof listener !== 'function') return priorCreateServer(...args);

    args[listenerIndex] = function recoverySuiteBackendListener(req, res) {
      let pathname = '/';
      try {
        pathname = new URL(req.url, 'http://localhost').pathname;
      } catch (_) {}

      if (
        req.method === 'POST'
        && (pathname === '/api/consulta/recuperar' || pathname === '/api/consulta/recuperar-v2')
      ) {
        return void handleRecovery(req, res);
      }

      return listener(req, res);
    };

    return priorCreateServer(...args);
  };

  void initDb();

  setInterval(async () => {
    const db = await initDb();
    if (db) {
      try {
        await db.query(`
          DELETE FROM report_recovery
           WHERE (expires_at IS NOT NULL AND expires_at < NOW())
              OR (expires_at IS NULL AND created_at < NOW() - INTERVAL '48 hours')
        `);
      } catch (_) {}
    }

    const now = Date.now();
    for (const [key, entry] of recoveryAttempts) {
      if (now >= entry.resetAt) recoveryAttempts.delete(key);
    }
  }, 60 * 60 * 1000).unref();
}

if (IS_OUTER_UI) {
  const crypto = require('crypto');
  const PDFDocument = require('pdfkit');

  const priorCreateServer = http.createServer.bind(http);
  const BACKEND_PORT = Number(process.env.RECOVERY_BACKEND_PORT || 10002);
  const PAYMENT_SIGNING_SECRET = String(process.env.PAYMENT_SIGNING_SECRET || '').trim();
  const RECOVERY_TIMEOUT_MS = 55 * 1000;
  const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
  const MAX_PDF_REQUEST_BYTES = 64 * 1024;

  function sendBuffer(res, status, buffer, headers = {}) {
    if (res.headersSent) return;

    const out = { ...headers };
    delete out['transfer-encoding'];
    delete out['content-encoding'];
    delete out['connection'];

    out['content-type'] = out['content-type'] || 'application/json; charset=utf-8';
    out['cache-control'] = 'no-store';
    out['content-length'] = String(buffer.length);

    res.writeHead(status, out);
    res.end(buffer);
  }

  function sendJson(res, status, payload) {
    sendBuffer(
      res,
      status,
      Buffer.from(JSON.stringify(payload)),
      { 'content-type': 'application/json; charset=utf-8' }
    );
  }

  function forwardRecovery(req, res) {
    const headers = { ...req.headers, host: `127.0.0.1:${BACKEND_PORT}` };
    delete headers['accept-encoding'];
    delete headers['connection'];

    let finished = false;

    const fail = (status, message) => {
      if (finished) return;
      finished = true;
      console.error('RECOVERY_SUITE_PROXY:', message);

      sendJson(res, status, {
        error: status === 504 ? 'tempo_limite_recuperacao' : 'falha_recuperacao',
        mensagem: status === 504
          ? 'A verificação demorou além do esperado. Tente novamente em alguns instantes; se o pagamento já estiver confirmado, ele continua válido.'
          : 'Não foi possível concluir a recuperação agora. Tente novamente em instantes.'
      });
    };

    const upstream = http.request({
      hostname: '127.0.0.1',
      port: BACKEND_PORT,
      path: '/api/consulta/recuperar-v2',
      method: 'POST',
      headers
    }, upstreamRes => {
      const chunks = [];
      let size = 0;
      let overflow = false;

      upstreamRes.setTimeout(RECOVERY_TIMEOUT_MS, () => {
        upstreamRes.destroy(new Error('Tempo limite ao receber o corpo da recuperação.'));
      });

      upstreamRes.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          overflow = true;
          upstreamRes.destroy(new Error('Resposta da recuperação excedeu o limite.'));
          return;
        }
        chunks.push(chunk);
      });

      upstreamRes.on('end', () => {
        if (finished || overflow) return;
        finished = true;

        const body = Buffer.concat(chunks);
        try {
          const parsed = JSON.parse(body.toString('utf8') || '{}');
          console.log(
            `RECOVERY_SUITE_PROXY: resposta ${upstreamRes.statusCode || 0} `
            + `(paid=${parsed && parsed.paid === true}, vehicle=${Boolean(parsed && parsed.vehicle)}, bytes=${body.length}).`
          );
        } catch (_) {
          console.log(
            `RECOVERY_SUITE_PROXY: resposta ${upstreamRes.statusCode || 0} (bytes=${body.length}).`
          );
        }

        sendBuffer(res, upstreamRes.statusCode || 502, body, upstreamRes.headers);
      });

      upstreamRes.on('error', err => fail(504, err.message));
    });

    upstream.setTimeout(RECOVERY_TIMEOUT_MS, () => {
      upstream.destroy(new Error('Tempo limite da recuperação excedido.'));
    });

    upstream.on('error', err => fail(504, err.message));

    req.on('aborted', () => {
      if (!finished) upstream.destroy(new Error('Cliente encerrou a recuperação antes da resposta.'));
    });

    req.pipe(upstream);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;

      req.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_PDF_REQUEST_BYTES) {
          reject(new Error('Corpo da requisição excedeu o limite.'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  function safeEqual(a, b) {
    const left = Buffer.from(String(a || ''));
    const right = Buffer.from(String(b || ''));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  function verifyReportAccess(token) {
    if (!PAYMENT_SIGNING_SECRET) throw new Error('Assinatura interna não configurada.');

    const parts = String(token || '').split('.');
    if (parts.length !== 2) throw new Error('Acesso do relatório inválido.');

    const expected = crypto
      .createHmac('sha256', PAYMENT_SIGNING_SECRET)
      .update(parts[0])
      .digest('base64url');

    if (!safeEqual(parts[1], expected)) throw new Error('Acesso do relatório inválido.');

    let payload;
    try {
      payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    } catch (_) {
      throw new Error('Acesso do relatório inválido.');
    }

    if (
      !payload
      || payload.v !== 1
      || payload.kind !== 'report-access'
      || payload.product !== 'consulta-completa'
      || !payload.vehicle
      || !payload.plate
      || !payload.exp
      || Date.now() >= Number(payload.exp)
    ) {
      throw new Error('Acesso do relatório expirado ou inválido.');
    }

    return payload;
  }

  function validateRecovery(body) {
    return new Promise((resolve, reject) => {
      const headers = {
        'content-type': 'application/json',
        accept: 'application/json',
        'content-length': String(body.length),
        host: `127.0.0.1:${BACKEND_PORT}`
      };

      const upstream = http.request({
        hostname: '127.0.0.1',
        port: BACKEND_PORT,
        path: '/api/consulta/recuperar-v2',
        method: 'POST',
        headers
      }, upstreamRes => {
        const chunks = [];
        let size = 0;

        upstreamRes.on('data', chunk => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            upstreamRes.destroy(new Error('Resposta da recuperação excedeu o limite.'));
            return;
          }
          chunks.push(chunk);
        });

        upstreamRes.on('end', () => {
          let data = {};
          try {
            data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          } catch (_) {}
          resolve({ status: upstreamRes.statusCode || 502, data });
        });

        upstreamRes.on('error', reject);
      });

      upstream.setTimeout(RECOVERY_TIMEOUT_MS, () => {
        upstream.destroy(new Error('Tempo limite da recuperação.'));
      });

      upstream.on('error', reject);
      upstream.end(body);
    });
  }

  function clean(value) {
    return value === undefined || value === null || String(value).trim() === ''
      ? 'Não informado'
      : String(value);
  }

  function boolText(value) {
    if (value === true) return 'Ocorrência indicada';
    if (value === false) return 'Nada consta';
    return 'Não verificado';
  }

  function makePdf(vehicle) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 42,
        info: { Title: `Consulta veicular ${clean(vehicle.plate)}` }
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('error', reject);
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const pageBottom = 790;

      function need(height = 48) {
        if (doc.y + height > pageBottom) doc.addPage();
      }

      function title(text) {
        need(45);
        doc.moveDown(0.35).font('Helvetica-Bold').fontSize(14).text(text);
        doc.moveDown(0.25).moveTo(42, doc.y).lineTo(553, doc.y).stroke();
        doc.moveDown(0.45);
      }

      function row(label, value) {
        need(28);
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(9.5).text(label, 42, y, { width: 180 });
        doc.font('Helvetica').fontSize(9.5).text(clean(value), 225, y, { width: 328 });
        doc.y = Math.max(doc.y, y + 18);
      }

      doc.font('Helvetica-Bold').fontSize(20).text('Consulta Veicular 360');
      doc.moveDown(0.15).fontSize(11).font('Helvetica').text('Relatório veicular - consulta paga recuperada');
      doc.moveDown(0.65).font('Helvetica-Bold').fontSize(25).text(clean(vehicle.plate));
      doc.moveDown(0.1).fontSize(13).text(`${clean(vehicle.brand)} · ${clean(vehicle.model)}`);
      doc.moveDown(0.25).font('Helvetica').fontSize(9.5)
        .text('Pagamento confirmado. Relatório recuperado a partir da consulta já liberada.');

      title('Identificação do veículo');
      row(
        'Ano / Ano-modelo',
        vehicle.year && vehicle.modelYear
          ? `${vehicle.year} / ${vehicle.modelYear}`
          : (vehicle.modelYear || vehicle.year)
      );
      row('Cor', vehicle.color);
      row('Município / UF', [vehicle.city, vehicle.state].filter(Boolean).join(' / '));
      row('Combustível', vehicle.fuel);
      row('Tipo do veículo', vehicle.type);
      row('RENAVAM', vehicle.renavam);
      row('Chassi', vehicle.chassis);
      row('Situação', vehicle.status);
      row('Procedência', vehicle.origin);
      row('Ano de exercício', vehicle.exerciseYear);

      if (vehicle.fipe) {
        title('Tabela FIPE');
        row(
          'Valor',
          vehicle.fipe.value
          || (
            vehicle.fipe.numericValue
              ? Number(vehicle.fipe.numericValue).toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL'
                })
              : null
          )
        );
        row('Código FIPE', vehicle.fipe.code);
        row('Modelo FIPE', vehicle.fipe.model);
        row('Combustível FIPE', vehicle.fipe.fuel);
        row('Referência', vehicle.fipe.referenceMonth);
      }

      title('Indicadores e ocorrências');
      const indicators = vehicle.indicators || {};
      [
        ['Roubo / furto', indicators.theft],
        ['Leilão', indicators.auction],
        ['Recall', indicators.recall],
        ['RENAJUD', indicators.renajud],
        ['RENAINF / infrações', indicators.renainf],
        ['Comunicação de venda', indicators.saleCommunication],
        ['Pendência documental', indicators.documentationPending],
        ['Remarcação de chassi', indicators.chassisRemarked]
      ].forEach(item => row(item[0], boolText(item[1])));

      title('Restrições retornadas');
      if (Array.isArray(vehicle.restrictions) && vehicle.restrictions.length) {
        vehicle.restrictions.forEach((restriction, index) => {
          row(`Restrição ${index + 1}`, restriction);
        });
      } else {
        row('Resultado', 'Nenhuma restrição informada na lista retornada.');
      }

      const technical = vehicle.technical || {};
      if (Object.keys(technical).length) {
        title('Dados técnicos');
        row('Motor', technical.engine);
        row('Espécie', technical.species);
        row('Categoria', technical.category);
        row('Carroceria', technical.bodyType);
        row('Cilindrada', technical.displacement);
        row('Peso bruto', technical.grossWeight);
        row('Capacidade de carga', technical.loadCapacity);
        row('Passageiros', technical.passengers);
        row('Descrição do chassi', technical.chassisRemarkDescription);
      }

      const documents = vehicle.documents || {};
      if (Object.keys(documents).length) {
        title('Documentos');
        row('Emissão do CRV', documents.crvIssuedAt);
        row('Emissão do CRLV', documents.crlvIssuedAt);
      }

      need(90);
      doc.moveDown(0.8).font('Helvetica').fontSize(8).text(
        'Aviso: este relatório é informativo e reproduz os dados retornados pela fonte da consulta no momento da pesquisa. Ele não substitui documento oficial nem consulta aos órgãos públicos competentes.',
        { align: 'justify' }
      );
      doc.moveDown(0.45)
        .text(`Fonte registrada: ${clean(vehicle.source)} · Status da fonte: ${clean(vehicle.sourceStatus)}`);

      doc.end();
    });
  }

  async function serveRecoveredPdf(req, res) {
    let body;

    try {
      body = await readBody(req);
    } catch (_) {
      return sendJson(res, 400, {
        error: 'requisicao_invalida',
        mensagem: 'Dados inválidos.'
      });
    }

    let requestData = {};
    try {
      requestData = JSON.parse(body.toString('utf8') || '{}');
    } catch (_) {
      return sendJson(res, 400, {
        error: 'requisicao_invalida',
        mensagem: 'Dados inválidos.'
      });
    }

    try {
      let vehicle = null;

      if (requestData.reportAccessToken) {
        const access = verifyReportAccess(requestData.reportAccessToken);
        vehicle = access.vehicle;
      } else {
        const recoveryBody = Buffer.from(JSON.stringify({
          placa: requestData.placa,
          cpf: requestData.cpf
        }));

        const checked = await validateRecovery(recoveryBody);
        const data = checked.data || {};

        if (
          checked.status < 200
          || checked.status >= 300
          || data.paid !== true
          || !data.vehicle
        ) {
          return sendJson(res, checked.status === 404 ? 404 : 403, {
            error: 'consulta_nao_liberada',
            mensagem: data.mensagem || 'Consulta paga não localizada.'
          });
        }

        vehicle = data.vehicle;
      }

      const pdf = await makePdf(vehicle);
      const plate = String(vehicle.plate || 'consulta')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '') || 'consulta';

      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="consulta_veicular_${plate}.pdf"`,
        'Cache-Control': 'private, no-store, max-age=0',
        Pragma: 'no-cache',
        'Content-Length': String(pdf.length),
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(pdf);

      console.log(`RECOVERY_SUITE_PDF: PDF entregue (${plate.slice(0, 3)}****).`);
    } catch (err) {
      console.error('RECOVERY_SUITE_PDF:', err.message);
      return sendJson(res, 500, {
        error: 'pdf_indisponivel',
        mensagem: 'Não foi possível gerar o PDF desta consulta agora.'
      });
    }
  }

  const INJECT = String.raw`<style id="cv-recovery-suite-style">
#cv-recover-pdf-submit{width:100%!important;height:50px!important;margin:10px 0 0!important;border:1px solid #2d6f95!important;border-radius:11px!important;background:linear-gradient(135deg,#103a57,#0b2940)!important;color:#dff3ff!important;font-size:12px!important;font-weight:950!important;cursor:pointer}
#cv-recover-pdf-submit:hover{filter:brightness(1.08)}
#cv-recover-pdf-submit:disabled{opacity:.58!important;cursor:wait!important}
#cv-download-recovered-pdf{width:100%!important}
</style>
<script id="cv-recovery-suite-ui">
(function(){
  var lastBody=null,lastPlate='',lastAccessToken='';

  function digits(v){return String(v||'').replace(/\D/g,'').slice(0,11)}
  function plate(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7)}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function setMsg(text,ok){var el=document.getElementById('cv-recover-msg');if(!el)return;el.textContent=text||'';el.className='cv-recover-msg '+(ok?'ok':'bad')}
  function finishButton(btn,label){if(btn){btn.disabled=false;btn.textContent=label}}

  function remember(data){
    try{
      if(!data||!data.vehicle||!data.reportAccessToken||!data.reportAccessExpiresAt)return;
      var p=plate(data.vehicle.plate);if(!p)return;
      localStorage.setItem('cv_relatorio_pago_24h_'+p,JSON.stringify({
        plate:p,
        accessToken:data.reportAccessToken,
        expiresAt:Number(data.reportAccessExpiresAt),
        savedAt:Date.now()
      }));
    }catch(e){}
  }

  function simpleRow(label,value){
    if(value===undefined||value===null||String(value).trim()==='')return '';
    return '<div class="row"><span class="label">'+esc(label)+'</span><span class="value">'+esc(value)+'</span></div>';
  }

  function fallbackRender(v){
    var result=document.getElementById('result');
    if(!result)throw new Error('Área de resultado não encontrada nesta página.');

    var local=[v.city,v.state].filter(Boolean).join(' / ');
    var year=[v.year,v.modelYear].filter(Boolean).join(' / ');
    var rows='';
    rows+=simpleRow('Ano / modelo',year);
    rows+=simpleRow('Cor',v.color);
    rows+=simpleRow('Município / UF',local);
    rows+=simpleRow('Combustível',v.fuel);
    rows+=simpleRow('Tipo',v.type);
    rows+=simpleRow('RENAVAM',v.renavam);
    rows+=simpleRow('Chassi',v.chassis);
    rows+=simpleRow('Situação',v.status);
    rows+=simpleRow('Procedência',v.origin);

    var fipe='';
    if(v.fipe&&(v.fipe.value||v.fipe.numericValue)){
      var fv=v.fipe.value||Number(v.fipe.numericValue||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
      fipe='<div class="cv-fipe-card"><div class="cv-fipe-label">Valor de mercado · Tabela FIPE</div><div class="cv-fipe-value">'+esc(fv)+'</div></div>';
    }

    var restrictions='';
    if(Array.isArray(v.restrictions)){
      restrictions=v.restrictions.length
        ?v.restrictions.map(function(x){return '<div class="cv-restriction">⚠️ '+esc(x)+'</div>'}).join('')
        :'<div class="success">✅ Nenhuma restrição informada na lista retornada.</div>';
    }

    result.innerHTML=
      '<div class="vehicle-card"><div class="vehicle-top"><div class="vehicle-title"><div class="vehicle-icon">🚘</div><h2>Relatório veicular completo</h2></div><span class="paid-badge">✓ PIX CONFIRMADO</span></div>'+
      '<div class="plate-result">'+esc(v.plate||'')+'</div>'+
      '<div class="vehicle-name">'+esc(v.brand||'Não informado')+' · '+esc(v.model||'Não informado')+'</div></div>'+
      '<div class="cv-report-section"><div class="cv-report-section-title">🚘 Identificação do veículo</div><div class="cv-report-section-body">'+rows+'</div></div>'+
      fipe+
      (restrictions?'<div class="cv-report-section"><div class="cv-report-section-title">⚠️ Restrições registradas</div><div class="cv-report-section-body cv-restrictions">'+restrictions+'</div></div>':'')+
      '<div class="success">✅ Pagamento confirmado e consulta recuperada.</div>'+
      '<div class="report-actions"><button class="secondary-btn" onclick="consultar()">🔄 NOVA CONSULTA</button></div>';

    result.classList.remove('hidden');
  }

  function renderRecovered(data,p){
    remember(data);
    lastBody={placa:p,cpf:digits((document.getElementById('cv-recover-cpf')||{}).value)};
    lastPlate=p;
    lastAccessToken=String(data.reportAccessToken||'');

    try{window.ultimaPlacaConsultada=p}catch(e){}

    var hidden=document.getElementById('plate');
    var visible=document.getElementById('cv-plate');
    if(hidden)hidden.value=p;
    if(visible)visible.value=p;

    var rendered=false;
    try{
      if(typeof window.renderRelatorioCompleto==='function'){
        window.renderRelatorioCompleto(data.vehicle);
        var result=document.getElementById('result');
        rendered=!!(result&&result.innerHTML&&result.innerHTML.length>80&&!result.classList.contains('hidden'));
      }
    }catch(e){rendered=false}

    if(!rendered)fallbackRender(data.vehicle||{});
    try{if(typeof window.steps==='function')window.steps(3)}catch(e){}
    setTimeout(addResultPdfButton,60);
  }

  function pdfPayload(){
    if(lastAccessToken)return {reportAccessToken:lastAccessToken};
    return lastBody;
  }

  function downloadPdf(payload,silent,btn){
    if(!payload)return;

    if(btn){
      btn.disabled=true;
      btn.textContent='GERANDO PDF...';
    }

    var xhr=new XMLHttpRequest();
    xhr.open('POST','/api/consulta/recuperar-pdf?t='+Date.now(),true);
    xhr.responseType='blob';
    xhr.timeout=65000;
    xhr.setRequestHeader('Content-Type','application/json');
    xhr.setRequestHeader('Cache-Control','no-store');

    function finish(){
      if(btn){
        btn.disabled=false;
        btn.textContent=btn.id==='cv-recover-pdf-submit'
          ?'📄 RECUPERAR EM PDF'
          :'📄 BAIXAR PDF DA CONSULTA';
      }
    }

    xhr.onload=function(){
      if(xhr.status>=200&&xhr.status<300){
        var url=URL.createObjectURL(xhr.response);
        var a=document.createElement('a');
        a.href=url;
        a.download='consulta_veicular_'+(lastPlate||'consulta')+'.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function(){URL.revokeObjectURL(url)},15000);
        if(!silent)setMsg('PDF da consulta recuperado com sucesso.',true);
        finish();
        return;
      }

      if(!silent){
        if(xhr.status===403||xhr.status===404)setMsg('Não encontramos uma consulta paga válida para essa placa e CPF.',false);
        else setMsg('Não foi possível gerar o PDF agora. Tente novamente.',false);
      }
      finish();
    };

    xhr.onerror=function(){
      if(!silent)setMsg('Falha de conexão ao gerar o PDF. Tente novamente.',false);
      finish();
    };

    xhr.ontimeout=function(){
      if(!silent)setMsg('A geração do PDF demorou além do esperado. Tente novamente.',false);
      finish();
    };

    xhr.send(JSON.stringify(payload));
  }

  function addResultPdfButton(){
    var result=document.getElementById('result');
    if(!result||!pdfPayload()||document.getElementById('cv-download-recovered-pdf'))return;

    var holder=result.querySelector('.report-actions');
    if(!holder){
      holder=document.createElement('div');
      holder.className='report-actions';
      holder.style.marginTop='12px';
      result.appendChild(holder);
    }

    var btn=document.createElement('button');
    btn.id='cv-download-recovered-pdf';
    btn.type='button';
    btn.className='paybtn';
    btn.textContent='📄 BAIXAR PDF DA CONSULTA';
    btn.onclick=function(){downloadPdf(pdfPayload(),false,btn)};
    holder.appendChild(btn);
  }

  function addModalPdfButton(){
    var recover=document.getElementById('cv-recover-submit');
    if(!recover||document.getElementById('cv-recover-pdf-submit'))return;

    var btn=document.createElement('button');
    btn.id='cv-recover-pdf-submit';
    btn.type='button';
    btn.textContent='📄 RECUPERAR EM PDF';
    btn.onclick=function(){window.cvRecoverPaidPdf()};
    recover.insertAdjacentElement('afterend',btn);
  }

  window.cvRecoverPaidReport=function(){
    var p=plate((document.getElementById('cv-recover-plate')||{}).value);
    var cpf=digits((document.getElementById('cv-recover-cpf')||{}).value);
    var btn=document.getElementById('cv-recover-submit');

    if(p.length!==7||cpf.length!==11){
      setMsg('Informe a placa e o CPF usados no pagamento.',false);
      return;
    }

    if(btn){
      btn.disabled=true;
      btn.textContent='PROCURANDO...';
    }

    setMsg('Verificando sua consulta paga...',true);

    var xhr=new XMLHttpRequest();
    xhr.open('POST','/api/consulta/recuperar-v2?browser=1&t='+Date.now(),true);
    xhr.timeout=65000;
    xhr.setRequestHeader('Content-Type','application/json');
    xhr.setRequestHeader('Accept','application/json');
    xhr.setRequestHeader('Cache-Control','no-store');

    var progress=setTimeout(function(){
      setMsg('Ainda verificando o pagamento e preparando o relatório...',true);
    },12000);

    xhr.onreadystatechange=function(){
      if(xhr.readyState!==4)return;
      clearTimeout(progress);

      var data={};
      try{data=JSON.parse(xhr.responseText||'{}')}catch(e){}

      if(xhr.status<200||xhr.status>=300||!data||data.paid!==true||!data.vehicle){
        finishButton(btn,'RECUPERAR CONSULTA');
        setMsg((data&&data.mensagem)||'Não encontramos uma consulta válida para esses dados.',false);
        return;
      }

      try{
        renderRecovered(data,p);
        setMsg('Consulta recuperada com sucesso.',true);

        if(typeof window.cvCloseRecovery==='function')window.cvCloseRecovery();
        else{
          var modal=document.getElementById('cv-recovery-modal');
          if(modal)modal.classList.add('cv-hidden');
          document.body.classList.remove('no-scroll');
        }

        setTimeout(function(){
          var result=document.getElementById('result');
          if(result)result.scrollIntoView({behavior:'smooth',block:'start'});
        },100);

        setTimeout(function(){
          downloadPdf(pdfPayload(),true,null);
        },350);
      }catch(e){
        setMsg(e&&e.message?e.message:'O pagamento foi encontrado, mas não foi possível exibir o relatório.',false);
      }finally{
        finishButton(btn,'RECUPERAR CONSULTA');
      }
    };

    xhr.onerror=function(){
      clearTimeout(progress);
      finishButton(btn,'RECUPERAR CONSULTA');
      setMsg('Falha de conexão ao recuperar a consulta. Tente novamente.',false);
    };

    xhr.ontimeout=function(){
      clearTimeout(progress);
      finishButton(btn,'RECUPERAR CONSULTA');
      setMsg('A recuperação demorou além do esperado. Tente novamente; seu pagamento continua válido.',false);
    };

    xhr.send(JSON.stringify({placa:p,cpf:cpf}));
  };

  window.cvRecoverPaidPdf=function(){
    var p=plate((document.getElementById('cv-recover-plate')||{}).value);
    var cpf=digits((document.getElementById('cv-recover-cpf')||{}).value);
    var btn=document.getElementById('cv-recover-pdf-submit');

    if(p.length!==7||cpf.length!==11){
      setMsg('Informe a placa e o CPF usados no pagamento.',false);
      return;
    }

    lastPlate=p;
    lastBody={placa:p,cpf:cpf};
    lastAccessToken='';
    setMsg('Validando o pagamento e preparando o PDF...',true);
    downloadPdf(lastBody,false,btn);
  };

  function bind(){
    addModalPdfButton();
    addResultPdfButton();

    var result=document.getElementById('result');
    if(result&&!result.__cvRecoverySuiteObserved){
      result.__cvRecoverySuiteObserved=true;
      new MutationObserver(function(){setTimeout(addResultPdfButton,30)})
        .observe(result,{childList:true,subtree:true,attributes:true});
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);
  else bind();

  document.addEventListener('DOMContentLoaded',function(){
    var body=document.body;
    if(body&&!body.__cvRecoverySuiteObserved){
      body.__cvRecoverySuiteObserved=true;
      new MutationObserver(function(){setTimeout(addModalPdfButton,30)})
        .observe(body,{childList:true,subtree:true});
    }
  });
})();
</script>`;

  function injectHome(listener, req, res) {
    const originalWriteHead = res.writeHead.bind(res);
    const originalEnd = res.end.bind(res);
    const chunks = [];

    let statusCode = res.statusCode || 200;
    let statusMessage = null;
    let capturedHeaders = null;
    let ended = false;

    res.writeHead = function recoverySuiteWriteHead(code, statusMessageOrHeaders, headersMaybe) {
      statusCode = code || statusCode;

      if (typeof statusMessageOrHeaders === 'string') {
        statusMessage = statusMessageOrHeaders;
        capturedHeaders = headersMaybe || {};
      } else {
        capturedHeaders = statusMessageOrHeaders || {};
      }

      return res;
    };

    res.write = function recoverySuiteWrite(chunk, encoding, callback) {
      if (chunk != null) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : undefined));
      }
      if (typeof callback === 'function') callback();
      return true;
    };

    res.end = function recoverySuiteEnd(chunk, encoding, callback) {
      if (ended) return res;
      ended = true;

      try {
        if (chunk != null) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : undefined));
        }

        let body = Buffer.concat(chunks);
        const headerSnapshot = {
          ...res.getHeaders(),
          ...(capturedHeaders || {})
        };

        const contentType = String(
          headerSnapshot['content-type']
          || headerSnapshot['Content-Type']
          || ''
        );

        let text = body.toString('utf8');
        const looksHtml =
          contentType.includes('text/html')
          || /<!doctype html|<html[\s>]/i.test(text.slice(0, 500));

        if (looksHtml && !text.includes('id="cv-recovery-suite-ui"')) {
          text = text.replace('</body>', INJECT + '\n</body>');
          body = Buffer.from(text, 'utf8');
        }

        delete headerSnapshot['Content-Length'];
        delete headerSnapshot['content-length'];
        delete headerSnapshot['content-encoding'];
        delete headerSnapshot['transfer-encoding'];
        delete headerSnapshot['connection'];

        headerSnapshot['content-length'] = String(body.length);
        headerSnapshot['cache-control'] = 'no-store, max-age=0';

        if (statusMessage) originalWriteHead(statusCode, statusMessage, headerSnapshot);
        else originalWriteHead(statusCode, headerSnapshot);

        if (typeof encoding === 'function') return originalEnd(body, encoding);
        if (typeof callback === 'function') return originalEnd(body, encoding, callback);
        return originalEnd(body, encoding);
      } catch (err) {
        console.error('RECOVERY_SUITE_UI:', err.message);

        const body = Buffer.concat(chunks);
        if (!res.headersSent) {
          if (statusMessage) originalWriteHead(statusCode, statusMessage, capturedHeaders || {});
          else originalWriteHead(statusCode, capturedHeaders || {});
        }

        if (typeof callback === 'function') return originalEnd(body, encoding, callback);
        return originalEnd(body, encoding);
      }
    };

    return listener(req, res);
  }

  http.createServer = function recoverySuiteOuterCreateServer(...args) {
    const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
    const listener = args[listenerIndex];

    if (typeof listener !== 'function') return priorCreateServer(...args);

    args[listenerIndex] = function recoverySuiteOuterListener(req, res) {
      let pathname = '/';
      try {
        pathname = new URL(req.url, 'http://localhost').pathname;
      } catch (_) {}

      if (
        req.method === 'POST'
        && (pathname === '/api/consulta/recuperar' || pathname === '/api/consulta/recuperar-v2')
      ) {
        return forwardRecovery(req, res);
      }

      if (req.method === 'POST' && pathname === '/api/consulta/recuperar-pdf') {
        return void serveRecoveredPdf(req, res);
      }

      const isHome = req.method === 'GET' && (pathname === '/' || pathname === '/index.html');
      if (isHome) return injectHome(listener, req, res);

      return listener(req, res);
    };

    return priorCreateServer(...args);
  };

  console.log('RECOVERY_SUITE: interface, proxy e PDF centralizados em um único módulo.');
}
