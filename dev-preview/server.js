'use strict';
// Servidor exclusivo da prévia visual. Não carrega server.js, banco de dados ou integrações.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const PORT = Number(process.env.PORT || 3000);
const file = path.join(__dirname, 'index.html');
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end();
  }
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    return res.end(req.method === 'HEAD' ? undefined : 'ok');
  }
  if (pathname !== '/') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end();
  }
  fs.readFile(file, (error, html) => {
    if (error) { res.writeHead(500); return res.end(); }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    });
    res.end(req.method === 'HEAD' ? undefined : html);
  });
});
server.listen(PORT, '0.0.0.0', () => console.log('Preview isolada ativa na porta ' + PORT));
