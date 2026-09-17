'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const previousCreateServer = http.createServer.bind(http);
const heroPath = path.join(__dirname, 'hero-luxo.webp');

http.createServer = function heroCreateServer(...args) {
  const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
  const listener = args[listenerIndex];

  if (typeof listener !== 'function') return previousCreateServer(...args);

  args[listenerIndex] = function heroListener(req, res) {
    let pathname = '/';
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch (_) {}

    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/hero-luxo.webp') {
      try {
        const stat = fs.statSync(heroPath);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Content-Length', String(stat.size));
        res.setHeader('Cache-Control', 'public, max-age=3600');
        if (req.method === 'HEAD') return res.end();
        return fs.createReadStream(heroPath)
          .on('error', () => {
            if (!res.headersSent) res.statusCode = 500;
            res.end();
          })
          .pipe(res);
      } catch (_) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.end('Imagem não encontrada.');
      }
    }

    return listener(req, res);
  };

  return previousCreateServer(...args);
};
