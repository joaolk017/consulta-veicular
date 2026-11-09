'use strict';
// Servidor exclusivo da prévia visual. Não carrega server.js, banco de dados ou integrações.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const PORT = Number(process.env.PORT || 3000);
const file = path.join(__dirname, 'index.html');
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (req.method !== 'GET' && req.method !== 'HEAD' && !(pathname === '/api/demo-report' && req.method === 'POST')) {
    res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end();
  }
  if (pathname === '/api/demo-report' && req.method === 'POST') {
    // Dados inteiramente fictícios; nenhuma conexão com APIs ou banco.
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 2048) req.destroy(); });
    req.on('end', () => {
      let plate = '';
      try { plate = JSON.parse(raw).plate; } catch {}
      if (typeof plate !== 'string' || !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ message: 'Placa inválida.' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
      return res.end(JSON.stringify({ plate, demo: true, vehicle: { brand: 'Marca fictícia', model: 'Modelo ilustrativo', status: 'Dados simulados' } }));
    });
    return;
  }
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    return res.end(req.method === 'HEAD' ? undefined : 'ok');
  }
  if (pathname !== '/' && pathname !== '/checkout-demo' && pathname !== '/transparencia') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end();
  }
  fs.readFile(pathname === '/checkout-demo' ? path.join(__dirname, 'checkout-demo.html') : pathname === '/transparencia' ? path.join(__dirname, 'transparencia.html') : file, (error, html) => {
    if (error) { res.writeHead(500); return res.end(); }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; connect-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    });
    res.end(req.method === 'HEAD' ? undefined : html);
  });
});
server.listen(PORT, '0.0.0.0', () => console.log('Preview isolada ativa na porta ' + PORT));
