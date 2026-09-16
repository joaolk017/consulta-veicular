'use strict';

const http = require('http');

const originalCreateServer = http.createServer.bind(http);
const WINDOW_MS = 60 * 60 * 1000;
const MAX_STORE_KEYS = 10000;
const generalApiStore = new Map();
const sensitiveStores = new Map();

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'OPTIONS']);
const BLOCKED_EXTENSIONS = /\.(?:js|json|map|md|lock)$/i;
const BLOCKED_PREFIXES = ['/node_modules/', '/.git/', '/.github/', '/.env'];

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

http.createServer = function secureCreateServer(...args) {
  const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
  const listener = args[listenerIndex];

  if (typeof listener !== 'function') return originalCreateServer(...args);

  args[listenerIndex] = function securedListener(req, res) {
    const pathname = pathOf(req);
    applySecurityHeaders(req, res, pathname);

    if (!ALLOWED_METHODS.has(String(req.method || '').toUpperCase())) {
      res.setHeader('Allow', 'GET, HEAD, POST, OPTIONS');
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Método não permitido.');
    }

    if (shouldBlockFile(pathname)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('Página não encontrada.');
    }

    if (!rateLimitFor(req, res, pathname)) return;
    return listener(req, res);
  };

  return originalCreateServer(...args);
};

setInterval(() => {
  cleanupStore(generalApiStore);
  for (const store of sensitiveStores.values()) cleanupStore(store);
}, 10 * 60 * 1000).unref();
