'use strict';

const path = require('path');
const ENTRYPOINT = path.basename(String(process.argv[1] || '')).toLowerCase();
const IS_BACKEND_SERVER = ENTRYPOINT === 'server.js';
const IS_OUTER_UI = ENTRYPOINT === 'recovery-ui-proxy.js';

if (IS_BACKEND_SERVER) {
  const http = require('http');
  const https = require('https');
  const crypto = require('crypto');
  const { Pool } = require('pg');

  const priorCreateServer = http.createServer.bind(http);
  const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
  const PAYMENT_SIGNING_SECRET = String(process.env.PAYMENT_SIGNING_SECRET || '').trim();
  const FONTEDATA_API_KEY = String(process.env.FONTEDATA_API_KEY || '').trim();
  const MISTIC_PAY_URL = String(process.env.MISTIC_PAY_URL || 'https://api.misticpay.com/api').replace(/\/+$/, '');
  const MISTIC_CLIENT_ID = String(process.env.MISTIC_CLIENT_ID || '').trim();
  const MISTIC_CLIENT_SECRET = String(process.env.MISTIC_CLIENT_SECRET || '').trim();
  const MISTIC_AUTH_HEADER = String(process.env.MISTIC_AUTH_HEADER || '').trim();
  const TTL_MS = 24 * 60 * 60 * 1000;
  const MAX_BODY_BYTES = 32 * 1024;
  const REPORT_PRICE = 18.90;
  const ENDPOINT = 'https://app.fontedata.com/api/v1/consulta/consulta-veicular';
  const rebuildInFlight = new Map();
  let pool = null;

  function digits(value) { return String(value || '').replace(/\D/g, ''); }
  function normalizePlate(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }
  function validPlate(value) {
    const p = normalizePlate(value);
    return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p) || /^[A-Z]{3}[0-9]{4}$/.test(p);
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
    return crypto.createHmac('sha256', PAYMENT_SIGNING_SECRET).update(`cpf:${digits(value)}`).digest('hex');
  }
  function cleanText(value, max = 180) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim().replace(/\s+/g, ' ');
    return text ? text.slice(0, max) : null;
  }
  function cleanNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
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
    return value.map(item => cleanText(typeof item === 'string' ? item : (item && (item.descricao || item.description || item.nome || item.tipo)), 240)).filter(Boolean).slice(0, 30);
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
    const indicators = source.indicadores && typeof source.indicadores === 'object' ? source.indicadores : (payload.indicadores && typeof payload.indicadores === 'object' ? payload.indicadores : {});
    const fipe = source.fipe && typeof source.fipe === 'object' ? source.fipe : null;
    return {
      plate: normalizePlate(source.placa || requestedPlate),
      brand: cleanText(source.marca), model: cleanText(source.modelo),
      year: cleanText(source.anoFabricacao), modelYear: cleanText(source.anoModelo),
      color: cleanText(source.cor), city: cleanText(source.municipio), state: cleanText(source.uf, 10),
      fuel: cleanText(source.combustivel), type: cleanText(source.tipo),
      renavam: maskIdentifier(source.renavam, 4), chassis: maskChassis(source.chassi),
      status: cleanText(source.situacaoVeiculo), origin: cleanText(source.procedenciaVeiculo),
      exerciseYear: cleanText(payload.anoExercicio, 12), source: 'fontedata', sourceStatus: 'ok',
      fipe: fipe ? {
        value: cleanText(fipe.valor, 60), numericValue: cleanNumber(fipe.valorNumerico),
        code: cleanText(fipe.codigoFipe, 40), brand: cleanText(fipe.marcaFipe), model: cleanText(fipe.modeloFipe),
        fuel: cleanText(fipe.combustivel), referenceMonth: cleanText(fipe.mesReferencia, 80),
        modelYear: cleanText(fipe.anoModelo, 12), status: cleanText(fipe.status, 80)
      } : null,
      restrictions: sanitizeRestrictions(source.restricoes),
      indicators: {
        theft: boolOrNull(indicators.rouboFurto), auction: boolOrNull(indicators.leilao), recall: boolOrNull(indicators.recall),
        renajud: boolOrNull(indicators.renajud), renainf: boolOrNull(indicators.renainf), saleCommunication: boolOrNull(indicators.comunicadoVenda),
        documentationPending: boolOrNull(indicators.pendenciaEmissao), rfb: boolOrNull(indicators.rfb), alarm: boolOrNull(indicators.alarme),
        siniav: boolOrNull(indicators.siniav), chassisRemarked: boolOrNull(source.indicadorRemarcacaoChassi)
      },
      technical: {
        engine: maskIdentifier(source.numeroMotor, 4), transmission: maskIdentifier(source.numeroCambio, 4), displacement: cleanText(source.cilindrada, 40),
        power: cleanText(source.potencia, 40), axles: cleanText(source.numeroEixos, 20), bodyType: cleanText(source.tipoCarroceria), category: cleanText(source.categoria),
        species: cleanText(source.especie), grossWeight: cleanText(source.pesoBrutoTotal, 60), loadCapacity: cleanText(source.capacidaDeCarga ?? source.capacidadeMaximaCarga, 60),
        maxTraction: cleanText(source.capacidadeMaximaTracao, 60), passengers: cleanText(source.capacidadedePassageiros, 30),
        chassisRemarkDescription: cleanText(source.descricaoRemarcacaoChassi, 220)
      },
      documents: { crvIssuedAt: cleanText(source.dataEmissaoCrv, 60), crlvIssuedAt: cleanText(source.dataEmissaoCrlv, 60) }
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
      if (!authorization) return reject(new Error('Credenciais da Mistic Pay não configuradas.'));
      let url;
      try { url = new URL(`${MISTIC_PAY_URL}/transactions/check`); } catch (_) { return reject(new Error('URL da Mistic Pay inválida.')); }
      const body = JSON.stringify({ transactionId: String(transactionId) });
      const request = https.request(url, {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, response => {
        const chunks = [];
        response.on('data', c => chunks.push(c));
        response.on('end', () => {
          let data = null;
          try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) {}
          const status = response.statusCode || 502;
          if (status < 200 || status >= 300 || !data || typeof data !== 'object') return reject(Object.assign(new Error('Não foi possível verificar o pagamento.'), { status }));
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
    return state === 'COMPLETO' && (!type || type === 'DEPOSITO') && (!method || method === 'PIX') && misticAmountMatches(value);
  }
  function requestFonteData(plate) {
    return new Promise((resolve, reject) => {
      if (!FONTEDATA_API_KEY) return reject(new Error('Fonte veicular não configurada.'));
      const url = new URL(ENDPOINT);
      url.searchParams.set('placa', plate);
      const request = https.get(url, { headers: { 'X-API-Key': FONTEDATA_API_KEY, Accept: 'application/json', 'User-Agent': 'ConsultaVeicular360/1.0' } }, response => {
        const chunks = [];
        let size = 0;
        response.on('data', chunk => { size += chunk.length; if (size <= 4 * 1024 * 1024) chunks.push(chunk); });
        response.on('end', () => {
          if (size > 4 * 1024 * 1024) return reject(new Error('Resposta da fonte veicular excedeu o limite.'));
          let data = null;
          try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) {}
          const status = response.statusCode || 502;
          if (status >= 200 && status < 300 && data && typeof data === 'object') return resolve(data);
          reject(Object.assign(new Error('A base veicular não respondeu agora.'), { status }));
        });
      });
      request.setTimeout(30000, () => request.destroy(new Error('Tempo limite da base veicular excedido.')));
      request.on('error', reject);
    });
  }
  function getPool() {
    if (!DATABASE_URL) return null;
    if (!pool) pool = new Pool({ connectionString: DATABASE_URL, max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000, ssl: DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1') ? false : { rejectUnauthorized: false } });
    return pool;
  }
  function readJson(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('Requisição muito grande.'), { status: 413 })); req.destroy(); return; } chunks.push(chunk); });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (_) { reject(Object.assign(new Error('Dados inválidos.'), { status: 400 })); } });
      req.on('error', reject);
    });
  }
  function sendJson(res, status, data) {
    const body = Buffer.from(JSON.stringify(data));
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': String(body.length) });
    res.end(body);
  }
  function signReportAccess(vehicle, expiresAt) {
    if (!PAYMENT_SIGNING_SECRET || !vehicle || !vehicle.plate) return null;
    const exp = Math.min(Number(expiresAt) || (Date.now() + TTL_MS), Date.now() + TTL_MS);
    if (!Number.isFinite(exp) || exp <= Date.now()) return null;
    const payload = { v: 1, kind: 'report-access', product: 'consulta-completa', plate: String(vehicle.plate).toUpperCase(), vehicle, iat: Date.now(), exp };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', PAYMENT_SIGNING_SECRET).update(encoded).digest('base64url');
    return { token: `${encoded}.${signature}`, expiresAt: exp };
  }
  async function rebuildPaidReport(row, plate) {
    const key = String(row.payment_token_hash || plate);
    if (rebuildInFlight.has(key)) return rebuildInFlight.get(key);
    const promise = (async () => {
      if (!row.provider_transaction_id) throw Object.assign(new Error('Pagamento não pôde ser localizado para recuperação.'), { status: 404 });
      const transaction = await checkMisticTransaction(row.provider_transaction_id);
      if (!isPaidTransaction(transaction)) throw Object.assign(new Error('O pagamento desta consulta ainda não consta como confirmado.'), { status: 402 });
      const raw = await requestFonteData(plate);
      return mapFonteData(raw, plate);
    })();
    rebuildInFlight.set(key, promise);
    try { return await promise; } finally { rebuildInFlight.delete(key); }
  }
  async function handleRecoveryV2(req, res) {
    let data;
    try { data = await readJson(req); } catch (err) { return sendJson(res, err.status || 400, { error: 'dados_invalidos', mensagem: err.message }); }
    const plate = normalizePlate(data.placa);
    const cpf = digits(data.cpf);
    if (!validPlate(plate) || !validCpf(cpf)) return sendJson(res, 400, { error: 'dados_invalidos', mensagem: 'Informe a placa e o CPF usados no pagamento.' });
    const payerHash = hmacCpf(cpf);
    const db = getPool();
    if (!db || !payerHash) return sendJson(res, 503, { error: 'recuperacao_indisponivel', mensagem: 'A recuperação está temporariamente indisponível.' });

    try {
      const found = await db.query(`
        SELECT rr.payment_token_hash, rr.report_json, rr.created_at, rr.paid_at, rr.expires_at,
               EXTRACT(EPOCH FROM rr.expires_at) * 1000 AS expires_at_ms,
               o.provider_transaction_id, o.payment_status, o.paid_at AS order_paid_at
          FROM report_recovery rr
          LEFT JOIN orders o ON o.payment_token_hash = rr.payment_token_hash
         WHERE rr.payer_document_hash=$1
           AND rr.plate=$2
           AND (
             (rr.report_json IS NOT NULL AND rr.expires_at IS NOT NULL AND rr.expires_at > NOW())
             OR rr.created_at > NOW() - INTERVAL '24 hours'
           )
         ORDER BY COALESCE(rr.paid_at, o.paid_at, rr.created_at) DESC
         LIMIT 1`, [payerHash, plate]);
      const row = found.rows[0];
      if (!row) return sendJson(res, 404, { error: 'consulta_nao_encontrada', mensagem: 'Não encontramos uma consulta vinculada a essa placa e CPF nas últimas 24 horas.' });

      let vehicle = row.report_json;
      let expiresAt = Number(row.expires_at_ms || 0);
      if (!vehicle || !expiresAt || expiresAt <= Date.now()) {
        try {
          vehicle = await rebuildPaidReport(row, plate);
        } catch (err) {
          const status = err.status === 402 ? 402 : (err.status === 404 ? 404 : 502);
          return sendJson(res, status, {
            error: status === 402 ? 'pagamento_pendente' : (status === 404 ? 'consulta_nao_encontrada' : 'fonte_veicular_indisponivel'),
            pagamentoConfirmado: status === 502 ? true : undefined,
            mensagem: status === 502 ? 'Pagamento confirmado, mas a base veicular não respondeu agora. Tente recuperar novamente em alguns instantes.' : err.message
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
          [row.payment_token_hash, JSON.stringify(vehicle)]);
        expiresAt = Number(saved.rows[0] && saved.rows[0].expires_at_ms) || (Date.now() + TTL_MS);
        try {
          await db.query(`UPDATE orders SET payment_status='COMPLETO', paid_at=COALESCE(paid_at,NOW()), fulfillment_status='LIBERADO', fulfilled_at=COALESCE(fulfilled_at,NOW()), updated_at=NOW() WHERE payment_token_hash=$1`, [row.payment_token_hash]);
        } catch (_) {}
      }

      const access = signReportAccess(vehicle, expiresAt);
      if (!access) return sendJson(res, 500, { error: 'falha_recuperacao', mensagem: 'Não foi possível gerar o acesso da consulta.' });
      return sendJson(res, 200, { ok: true, paid: true, restored: true, vehicle, price: REPORT_PRICE, currency: 'BRL', reportAccessToken: access.token, reportAccessExpiresAt: access.expiresAt });
    } catch (err) {
      console.error('RECOVERY_V2:', err.message);
      return sendJson(res, 500, { error: 'falha_recuperacao', mensagem: 'Não foi possível recuperar a consulta agora.' });
    }
  }

  http.createServer = function recoveryFallbackCreateServer(...args) {
    const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
    const listener = args[listenerIndex];
    if (typeof listener !== 'function') return priorCreateServer(...args);
    args[listenerIndex] = function recoveryFallbackListener(req, res) {
      let pathname = '/';
      try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (_) {}
      if (req.method === 'POST' && pathname === '/api/consulta/recuperar-v2') return void handleRecoveryV2(req, res);
      return listener(req, res);
    };
    return priorCreateServer(...args);
  };
}

if (IS_OUTER_UI) {
  const http = require('http');
  const priorCreateServer = http.createServer.bind(http);
  const INJECT = `<script id="cv-recovery-v2-route">(function(){var f=window.fetch.bind(window);window.fetch=function(input,init){try{if(typeof input==='string'&&new URL(input,location.href).pathname==='/api/consulta/recuperar')input='/api/consulta/recuperar-v2';}catch(e){}return f(input,init);};})();</script>`;
  http.createServer = function recoveryFallbackUiCreateServer(...args) {
    const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
    const listener = args[listenerIndex];
    if (typeof listener !== 'function') return priorCreateServer(...args);
    args[listenerIndex] = function recoveryFallbackUiListener(req, res) {
      let pathname = '/';
      try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (_) {}
      const isHome = req.method === 'GET' && (pathname === '/' || pathname === '/index.html');
      if (!isHome) return listener(req, res);
      const originalWriteHead = res.writeHead.bind(res);
      const originalEnd = res.end.bind(res);
      let captured = null;
      res.writeHead = function(statusCode, statusMessageOrHeaders, headersMaybe) {
        captured = { statusCode, statusMessage: null, headers: {} };
        if (typeof statusMessageOrHeaders === 'string') { captured.statusMessage = statusMessageOrHeaders; captured.headers = headersMaybe || {}; }
        else captured.headers = statusMessageOrHeaders || {};
        return res;
      };
      res.end = function(chunk, encoding, callback) {
        try {
          if (chunk != null) {
            let body = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
            const headers = captured && captured.headers ? captured.headers : {};
            const type = String(headers['content-type'] || headers['Content-Type'] || res.getHeader('content-type') || '');
            if (type.includes('text/html') && !body.includes('id="cv-recovery-v2-route"')) {
              body = body.replace('</head>', INJECT + '\n</head>');
              chunk = Buffer.from(body, 'utf8');
              headers['content-length'] = String(chunk.length);
              delete headers['Content-Length'];
              if (captured) captured.headers = headers;
            }
          }
        } catch (err) { console.error('RECOVERY_V2_UI:', err.message); }
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
