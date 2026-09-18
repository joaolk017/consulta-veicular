'use strict';

const http = require('http');
const crypto = require('crypto');
const path = require('path');

const originalCreateServer = http.createServer.bind(http);
const WINDOW_MS = 60 * 60 * 1000;
const REPORT_ACCESS_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STORE_KEYS = 10000;
const generalApiStore = new Map();
const sensitiveStores = new Map();

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'OPTIONS']);
const ADMIN_DELETE_CHARGE_PATH = /^\/api\/admin\/cobrancas-teste\/[^/]+$/;
const BLOCKED_EXTENSIONS = /\.(?:js|json|map|md|lock)$/i;
const BLOCKED_PREFIXES = ['/node_modules/', '/.git/', '/.github/', '/.env'];
const PAYMENT_SIGNING_SECRET = String(process.env.PAYMENT_SIGNING_SECRET || '');
const IS_BACKEND_SERVER = path.basename(String(process.argv[1] || '')).toLowerCase() === 'server.js';

function now() {
  return Date.now();
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
  return forwarded.length ? forwarded[forwarded.length - 1] : (req.socket.remoteAddress || 'unknown');
}

function cleanupStore(store) {
  const current = now();
  for (const [key, entry] of store) {
    if (current >= entry.resetAt) store.delete(key);
  }
  while (store.size > MAX_STORE_KEYS) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

function consume(store, key, limit) {
  const current = now();
  let entry = store.get(key);
  if (!entry || current >= entry.resetAt) {
    entry = { count: 0, resetAt: current + WINDOW_MS };
    store.set(key, entry);
  }
  if (entry.count >= limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((entry.resetAt - current) / 1000)) };
  }
  entry.count += 1;
  if (store.size > MAX_STORE_KEYS) cleanupStore(store);
  return { allowed: true, remaining: Math.max(0, limit - entry.count) };
}

function storeFor(name) {
  if (!sensitiveStores.has(name)) sensitiveStores.set(name, new Map());
  return sensitiveStores.get(name);
}

function pathOf(req) {
  try {
    const raw = new URL(req.url, 'http://localhost').pathname;
    try { return decodeURIComponent(raw); } catch (_) { return raw; }
  } catch (_) {
    return '/';
  }
}

function shouldBlockFile(pathname) {
  const lower = pathname.toLowerCase();
  if (BLOCKED_PREFIXES.some(prefix => lower === prefix.slice(0, -1) || lower.startsWith(prefix))) return true;
  if (lower.startsWith('/.')) return true;
  if (BLOCKED_EXTENSIONS.test(lower)) return true;
  return false;
}

function applySecurityHeaders(req, res, pathname) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), usb=(), payment=()');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.removeHeader('X-Powered-By');

  if (pathname.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, nosnippet');
  }
}

function rateLimitFor(req, res, pathname) {
  if (!pathname.startsWith('/api/')) return true;

  const ip = clientIp(req);
  const general = consume(generalApiStore, ip, 900);
  if (!general.allowed) {
    res.setHeader('Retry-After', String(general.retryAfter));
    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Muitas requisições. Tente novamente mais tarde.' }));
    return false;
  }

  let rule = null;
  if (req.method === 'POST' && pathname === '/api/pagamento/pix/criar') rule = ['pix-create', 20];
  else if (req.method === 'POST' && pathname === '/api/pagamento/pix/status') rule = ['pix-status', 300];
  else if (req.method === 'POST' && pathname === '/api/consulta-completa') rule = ['unlock', 60];
  else if (req.method === 'POST' && pathname === '/api/consulta-salva') rule = ['saved-report', 120];
  else if (req.method === 'POST' && pathname === '/api/misticpay/webhook') rule = ['webhook', 600];
  else if (req.method === 'POST' && pathname === '/api/crlv/sp') rule = ['crlv', 30];
  else if (pathname.includes('/diagnostico')) rule = ['diagnostic', 20];

  if (!rule) return true;

  const limited = consume(storeFor(rule[0]), ip, rule[1]);
  if (limited.allowed) return true;

  res.setHeader('Retry-After', String(limited.retryAfter));
  res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Limite de requisições atingido. Tente novamente mais tarde.' }));
  return false;
}

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function signReportAccess(vehicle) {
  if (!PAYMENT_SIGNING_SECRET) return null;
  const issuedAt = now();
  const payload = {
    v: 1,
    kind: 'report-access',
    product: 'consulta-completa',
    plate: String(vehicle && vehicle.plate || '').toUpperCase(),
    vehicle,
    iat: issuedAt,
    exp: issuedAt + REPORT_ACCESS_TTL_MS
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', PAYMENT_SIGNING_SECRET).update(encoded).digest('base64url');
  return { token: `${encoded}.${signature}`, expiresAt: payload.exp };
}

function verifyReportAccess(token) {
  if (!PAYMENT_SIGNING_SECRET) throw new Error('Acesso temporário indisponível.');
  const parts = String(token || '').split('.');
  if (parts.length !== 2) throw new Error('Acesso temporário inválido.');
  const expected = crypto.createHmac('sha256', PAYMENT_SIGNING_SECRET).update(parts[0]).digest('base64url');
  if (!secureEqual(parts[1], expected)) throw new Error('Acesso temporário inválido.');

  let payload = null;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (_) {}
  if (!payload || payload.v !== 1 || payload.kind !== 'report-access' || payload.product !== 'consulta-completa' || !payload.plate || !payload.vehicle || !payload.exp) {
    throw new Error('Acesso temporário inválido.');
  }
  if (now() > Number(payload.exp)) throw new Error('O acesso de 24 horas expirou.');
  if (String(payload.vehicle.plate || '').toUpperCase() !== String(payload.plate).toUpperCase()) {
    throw new Error('Acesso temporário inválido.');
  }
  return payload;
}

function collectJson(req, limitBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('Corpo da requisição muito grande.'), { status: 413 }));
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
        reject(Object.assign(new Error('JSON inválido.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function handleSavedReport(req, res) {
  try {
    const body = await collectJson(req);
    const payload = verifyReportAccess(body && body.accessToken);
    const response = Buffer.from(JSON.stringify({
      ok: true,
      paid: true,
      restored: true,
      vehicle: payload.vehicle,
      price: 18.90,
      currency: 'BRL',
      accessExpiresAt: Number(payload.exp)
    }));
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(response.length),
      'Cache-Control': 'no-store'
    });
    return res.end(response);
  } catch (err) {
    const status = Number(err && err.status) || (/expirou/i.test(String(err && err.message || '')) ? 401 : 401);
    const response = Buffer.from(JSON.stringify({
      error: status === 413 ? 'requisicao_muito_grande' : 'acesso_temporario_invalido',
      mensagem: err && err.message ? err.message : 'Não foi possível validar o acesso temporário.'
    }));
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(response.length),
      'Cache-Control': 'no-store'
    });
    return res.end(response);
  }
}

function wrapPaidReportResponse(res) {
  const originalEnd = res.end.bind(res);
  res.end = function wrappedEnd(chunk, encoding, callback) {
    try {
      if (res.statusCode >= 200 && res.statusCode < 300 && chunk != null) {
        const bodyBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8');
        const data = JSON.parse(bodyBuffer.toString('utf8'));
        if (data && data.ok === true && data.paid === true && data.vehicle && data.vehicle.plate) {
          const access = signReportAccess(data.vehicle);
          if (access) {
            data.reportAccessToken = access.token;
            data.reportAccessExpiresAt = access.expiresAt;
            data.reportAccessHours = 24;
            const updated = Buffer.from(JSON.stringify(data));
            res.setHeader('Content-Length', String(updated.length));
            if (typeof encoding === 'function') return originalEnd(updated, encoding);
            if (typeof callback === 'function') return originalEnd(updated, callback);
            return originalEnd(updated);
          }
        }
      }
    } catch (_) {}
    return originalEnd(chunk, encoding, callback);
  };
}

http.createServer = function secureCreateServer(...args) {
  const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
  const listener = args[listenerIndex];

  if (typeof listener !== 'function') return originalCreateServer(...args);

  args[listenerIndex] = function securedListener(req, res) {
    const pathname = pathOf(req);
    applySecurityHeaders(req, res, pathname);

    const requestMethod = String(req.method || '').toUpperCase();
    const allowedAdminDelete = requestMethod === 'DELETE' && ADMIN_DELETE_CHARGE_PATH.test(pathname);
    if (!ALLOWED_METHODS.has(requestMethod) && !allowedAdminDelete) {
      res.setHeader('Allow', 'GET, HEAD, POST, OPTIONS');
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Método não permitido.');
    }

    if (shouldBlockFile(pathname)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('Página não encontrada.');
    }

    if (!rateLimitFor(req, res, pathname)) return;

    if (IS_BACKEND_SERVER && req.method === 'POST' && pathname === '/api/consulta-salva') {
      return void handleSavedReport(req, res);
    }

    if (IS_BACKEND_SERVER && req.method === 'POST' && pathname === '/api/consulta-completa') {
      wrapPaidReportResponse(res);
    }

    return listener(req, res);
  };

  return originalCreateServer(...args);
};

setInterval(() => {
  cleanupStore(generalApiStore);
  for (const store of sensitiveStores.values()) cleanupStore(store);
}, 10 * 60 * 1000).unref();
