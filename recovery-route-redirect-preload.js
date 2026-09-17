'use strict';

const path = require('path');
const http = require('http');

const entrypoint = path.basename(String(process.argv[1] || '')).toLowerCase();

if (entrypoint === 'server.js') {
  const priorCreateServer = http.createServer.bind(http);

  http.createServer = function recoveryRouteRedirectCreateServer(...args) {
    const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
    const listener = args[listenerIndex];
    if (typeof listener !== 'function') return priorCreateServer(...args);

    args[listenerIndex] = function recoveryRouteRedirectListener(req, res) {
      try {
        const url = new URL(req.url, 'http://localhost');
        if (req.method === 'POST' && url.pathname === '/api/consulta/recuperar') {
          url.pathname = '/api/consulta/recuperar-v2';
          req.url = `${url.pathname}${url.search}`;
        }
      } catch (_) {}
      return listener(req, res);
    };

    return priorCreateServer(...args);
  };
}
