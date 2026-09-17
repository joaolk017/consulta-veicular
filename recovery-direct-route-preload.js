'use strict';

const path = require('path');
const http = require('http');

const entrypoint = path.basename(String(process.argv[1] || '')).toLowerCase();

if (entrypoint === 'recovery-ui-proxy.js') {
  const priorCreateServer = http.createServer.bind(http);
  const BACKEND_PORT = Number(process.env.RECOVERY_BACKEND_PORT || 10002);
  const RECOVERY_TIMEOUT_MS = 55 * 1000;

  function sendJson(res, status, payload) {
    if (res.headersSent) return;
    const body = Buffer.from(JSON.stringify(payload));
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length)
    });
    res.end(body);
  }

  function forwardRecovery(req, res) {
    const headers = { ...req.headers, host: `127.0.0.1:${BACKEND_PORT}` };
    delete headers['accept-encoding'];

    const upstream = http.request({
      hostname: '127.0.0.1',
      port: BACKEND_PORT,
      path: '/api/consulta/recuperar-v2',
      method: 'POST',
      headers
    }, upstreamRes => {
      console.log(`RECOVERY_DIRECT: backend respondeu ${upstreamRes.statusCode || 0}.`);
      res.writeHead(upstreamRes.statusCode || 502, {
        ...upstreamRes.headers,
        'cache-control': 'no-store'
      });
      upstreamRes.pipe(res);
    });

    upstream.setTimeout(RECOVERY_TIMEOUT_MS, () => {
      upstream.destroy(new Error('Tempo limite da recuperação excedido.'));
    });

    upstream.on('error', err => {
      console.error('RECOVERY_DIRECT:', err.message);
      sendJson(res, 504, {
        error: 'tempo_limite_recuperacao',
        mensagem: 'A verificação demorou além do esperado. Tente novamente em alguns instantes; se o pagamento já estiver confirmado, ele continua válido.'
      });
    });

    req.pipe(upstream);
  }

  http.createServer = function recoveryDirectCreateServer(...args) {
    const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
    const listener = args[listenerIndex];
    if (typeof listener !== 'function') return priorCreateServer(...args);

    args[listenerIndex] = function recoveryDirectListener(req, res) {
      let pathname = '/';
      try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (_) {}

      if (req.method === 'POST' && (pathname === '/api/consulta/recuperar' || pathname === '/api/consulta/recuperar-v2')) {
        console.log('RECOVERY_DIRECT: encaminhando recuperação diretamente ao backend.');
        return forwardRecovery(req, res);
      }

      return listener(req, res);
    };

    return priorCreateServer(...args);
  };
}
