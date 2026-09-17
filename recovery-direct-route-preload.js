'use strict';

const path = require('path');
const http = require('http');

const entrypoint = path.basename(String(process.argv[1] || '')).toLowerCase();

if (entrypoint === 'recovery-ui-proxy.js') {
  const priorCreateServer = http.createServer.bind(http);
  const BACKEND_PORT = Number(process.env.RECOVERY_BACKEND_PORT || 10002);
  const RECOVERY_TIMEOUT_MS = 55 * 1000;
  const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

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
    sendBuffer(res, status, Buffer.from(JSON.stringify(payload)), {
      'content-type': 'application/json; charset=utf-8'
    });
  }

  function forwardRecovery(req, res) {
    const headers = { ...req.headers, host: `127.0.0.1:${BACKEND_PORT}` };
    delete headers['accept-encoding'];
    delete headers['connection'];

    let finished = false;
    const fail = (status, message) => {
      if (finished) return;
      finished = true;
      console.error('RECOVERY_DIRECT:', message);
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

      console.log(`RECOVERY_DIRECT: backend respondeu ${upstreamRes.statusCode || 0}; aguardando corpo.`);

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
        let summary = 'corpo não JSON';
        try {
          const parsed = JSON.parse(body.toString('utf8') || '{}');
          summary = `paid=${parsed && parsed.paid === true}, vehicle=${Boolean(parsed && parsed.vehicle)}, bytes=${body.length}`;
        } catch (_) {
          summary = `bytes=${body.length}`;
        }
        console.log(`RECOVERY_DIRECT: resposta concluída (${summary}).`);
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
