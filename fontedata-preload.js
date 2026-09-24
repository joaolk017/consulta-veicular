'use strict';

const path = require('path');
const IS_BACKEND_SERVER = path.basename(String(process.argv[1] || '')).toLowerCase() === 'server.js';

if (IS_BACKEND_SERVER) {
  const https = require('https');
  const crypto = require('crypto');
  const express = require('express');
  const { Pool } = require('pg');
  const { mergeReports } = require('./unified-report');
  const { getAuthConfig } = require('./apifull-auth-config');

  const FONTEDATA_API_KEY = String(process.env.FONTEDATA_API_KEY || '').trim();
  const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
  const ENDPOINT = 'https://app.fontedata.com/api/v1/consulta/consulta-veicular';
  const REPORT_TTL_MS = 24 * 60 * 60 * 1000;
  const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
  const resultCache = new Map();
  const inFlight = new Map();
  let pool = null;

  if (!FONTEDATA_API_KEY) {
    console.warn('FONTEDATA_API_KEY não configurada. O relatório pago continuará usando o retorno básico até a chave ser adicionada.');
  } else {
    console.log('FONTEDATA: integração da consulta veicular habilitada para relatórios pagos.');
  }

  function normalizePlate(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
  }

  function tokenHash(value) {
    if (!value) return null;
    return crypto.createHash('sha256').update(String(value)).digest('hex');
  }

  function cleanText(value, max = 180) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim().replace(/\s+/g, ' ');
    if (!text) return null;
    return text.slice(0, max);
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
    if (value === null || value === undefined) return null;
    if (!Array.isArray(value)) return null;
    return value
      .map(item => cleanText(typeof item === 'string' ? item : (item && (item.descricao || item.description || item.nome || item.tipo)), 240))
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

  function mapFonteData(data, fallback, requestedPlate) {
    const payload = pickPayload(data) || {};
    const source = payload.veiculo && typeof payload.veiculo === 'object' ? payload.veiculo : {};
    const indicators = source.indicadores && typeof source.indicadores === 'object'
      ? source.indicadores
      : (payload.indicadores && typeof payload.indicadores === 'object' ? payload.indicadores : {});
    const fipe = source.fipe && typeof source.fipe === 'object' ? source.fipe : null;
    const plate = normalizePlate(source.placa || requestedPlate || (fallback && fallback.plate));

    return {
      plate,
      brand: cleanText(source.marca) || (fallback && fallback.brand) || null,
      model: cleanText(source.modelo) || (fallback && fallback.model) || null,
      year: cleanText(source.anoFabricacao) || (fallback && fallback.year) || null,
      modelYear: cleanText(source.anoModelo) || (fallback && fallback.modelYear) || null,
      color: cleanText(source.cor) || (fallback && fallback.color) || null,
      city: cleanText(source.municipio) || (fallback && fallback.city) || null,
      state: cleanText(source.uf, 10) || (fallback && fallback.state) || null,
      fuel: cleanText(source.combustivel) || (fallback && fallback.fuel) || null,
      type: cleanText(source.tipo) || (fallback && fallback.type) || null,
      renavam: maskIdentifier(source.renavam, 4),
      chassis: maskChassis(source.chassi),
      status: cleanText(source.situacaoVeiculo),
      origin: cleanText(source.procedenciaVeiculo),
      exerciseYear: cleanText(payload.anoExercicio, 12),
      source: 'fontedata',
      sourceStatus: 'ok',
      dataCoverage: {
        auction: boolOrNull(indicators.leilao) !== null,
        theft: boolOrNull(indicators.rouboFurto) !== null,
        recall: boolOrNull(indicators.recall) !== null,
        renajud: boolOrNull(indicators.renajud) !== null,
        renainf: boolOrNull(indicators.renainf) !== null,
        restrictions: Array.isArray(source.restricoes),
        claims: boolOrNull(indicators.sinistro) !== null || boolOrNull(indicators.sinistros) !== null,
        debts: boolOrNull(indicators.debitos) !== null || Array.isArray(source.debitos) || Array.isArray(payload.debitos),
        fines: boolOrNull(indicators.multas) !== null || Array.isArray(source.multas) || Array.isArray(payload.multas),
        ownersHistory: Array.isArray(source.historicoProprietarios) || Array.isArray(payload.historicoProprietarios)
      },
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
      complementary: {
        billedType: cleanText(source.faturado && source.faturado.tipo),
        billedDocument: maskIdentifier(source.faturado && source.faturado.documento, 4),
        importDate: cleanText(source.importacao && source.importacao.data, 60),
        importDeclaration: maskIdentifier(source.importacao && source.importacao.numeroDeclaracao, 4)
      },
      technical: {
        engine: maskIdentifier(source.numeroMotor, 4),
        transmission: maskIdentifier(source.numeroCambio, 4),
        bodyNumber: maskIdentifier(source.numeroCarroceria, 4),
        rearAxleNumber: maskIdentifier(source.numeroEixoTraseiro, 4),
        auxiliaryAxleNumber: maskIdentifier(source.numeroDoEixoAuxiliar, 4),
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

  function requestFonteData(plate) {
    return new Promise((resolve, reject) => {
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
          if (size > MAX_RESPONSE_BYTES) {
            request.destroy(new Error('Resposta da FonteData excedeu o limite permitido.'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
          const status = response.statusCode || 502;
          if (status >= 200 && status < 300 && data && typeof data === 'object') {
            return resolve(data);
          }
          const error = new Error(
            status === 401 ? 'Chave da FonteData inválida ou expirada.' :
            status === 403 ? 'Saldo da FonteData insuficiente ou acesso não autorizado.' :
            status === 429 ? 'Limite temporário da FonteData atingido.' :
            status >= 400 && status < 500 ? 'A FonteData não conseguiu localizar/processar esta placa.' :
            'A FonteData está temporariamente indisponível.'
          );
          error.status = status;
          reject(error);
        });
      });
      request.setTimeout(30000, () => request.destroy(new Error('Tempo limite da FonteData excedido.')));
      request.on('error', reject);
    });
  }

  function getPool() {
    if (!DATABASE_URL) return null;
    if (!pool) {
      pool = new Pool({
        connectionString: DATABASE_URL,
        max: 2,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 8000,
        ssl: DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1') ? false : { rejectUnauthorized: false }
      });
    }
    return pool;
  }

  async function loadStoredReport(paymentToken) {
    const hash = tokenHash(paymentToken);
    const db = getPool();
    if (!hash || !db) return null;
    try {
      const found = await db.query(
        `SELECT report_json
           FROM report_recovery
          WHERE payment_token_hash=$1
            AND report_json IS NOT NULL
            AND expires_at IS NOT NULL
            AND expires_at > NOW()
          LIMIT 1`,
        [hash]
      );
      const report = found.rows[0] && found.rows[0].report_json;
      return report && report.source === 'fontedata' ? report : null;
    } catch (_) {
      return null;
    }
  }

  async function persistStoredReport(paymentToken, vehicle) {
    const hash = tokenHash(paymentToken);
    const db = getPool();
    if (!hash || !db || !vehicle) return;
    try {
      await db.query(
        `UPDATE report_recovery
            SET report_json=$2::jsonb,
                paid_at=COALESCE(paid_at, NOW()),
                expires_at=COALESCE(expires_at, NOW() + INTERVAL '24 hours'),
                updated_at=NOW()
          WHERE payment_token_hash=$1`,
        [hash, JSON.stringify(vehicle)]
      );
    } catch (err) {
      console.error('FONTEDATA: não foi possível antecipar o salvamento do relatório:', err.message);
    }
  }

  async function getEnrichedReport(paymentToken, fallbackVehicle) {
    const plate = normalizePlate(fallbackVehicle && fallbackVehicle.plate);
    if (!plate) throw new Error('Placa ausente na liberação do relatório.');

    const key = tokenHash(paymentToken) || `plate:${plate}`;
    const cached = resultCache.get(key);
    if (cached && Date.now() < cached.expiresAt) return cached.vehicle;

    const stored = await loadStoredReport(paymentToken);
    if (stored) {
      resultCache.set(key, { vehicle: stored, expiresAt: Date.now() + REPORT_TTL_MS });
      return stored;
    }

    if (inFlight.has(key)) return inFlight.get(key);

    const promise = (async () => {
      const raw = await requestFonteData(plate);
      const baseVehicle = mapFonteData(raw, fallbackVehicle, plate);
      // Integração em modo seguro: apenas padroniza a saída; não chama API Full.
      // Quando houver homologação, inserir aqui os complementos já obtidos por serviço.
      const apiFullConfig = getAuthConfig();
      if (apiFullConfig.enabled) {
        console.warn('API Full sinalizada como ativa, mas consultas pagas ainda não foram homologadas; nenhuma chamada será feita.');
      }
      const vehicle = mergeReports(baseVehicle, {});
      resultCache.set(key, { vehicle, expiresAt: Date.now() + REPORT_TTL_MS });
      await persistStoredReport(paymentToken, vehicle);
      return vehicle;
    })();

    inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      inFlight.delete(key);
    }
  }

  const originalJson = express.response.json;
  express.response.json = function fontedataAwareJson(body) {
    try {
      const req = this.req;
      const pathname = req ? new URL(req.url, 'http://localhost').pathname : '';
      const ok = this.statusCode >= 200 && this.statusCode < 300;
      if (FONTEDATA_API_KEY && ok && pathname === '/api/consulta-completa' && body && body.paid === true && body.vehicle && body.vehicle.plate) {
        const res = this;
        const paymentToken = req && req.body && req.body.paymentToken;
        void getEnrichedReport(paymentToken, body.vehicle)
          .then(vehicle => originalJson.call(res, { ...body, vehicle, provider: 'fontedata' }))
          .catch(err => {
            console.error('FONTEDATA: falha ao montar relatório pago:', err.message);
            if (!res.headersSent) res.status(502);
            originalJson.call(res, {
              error: 'fonte_veicular_indisponivel',
              pagamentoConfirmado: true,
              mensagem: 'Pagamento confirmado, mas a base veicular não respondeu agora. Tente novamente em alguns instantes; o pagamento continua válido.'
            });
          });
        return res;
      }
    } catch (err) {
      console.error('FONTEDATA: falha no enriquecimento:', err.message);
    }
    return originalJson.call(this, body);
  };

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of resultCache) if (now >= entry.expiresAt) resultCache.delete(key);
  }, 30 * 60 * 1000).unref();
}
