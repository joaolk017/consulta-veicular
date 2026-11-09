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
  // Visualização da interface REAL de desenvolvimento, com scripts e formulários bloqueados.
  // Apenas arquivos públicos explicitamente permitidos; nenhuma API, pagamento ou banco.
  const realPages = {
    '/site-real': 'index.html',
    '/sobre/': 'sobre/index.html',
    '/contato.html': 'contato.html',
    '/termos.html': 'termos.html',
    '/privacidade.html': 'privacidade.html',
    '/reembolso.html': 'reembolso.html',
    '/minhas-consultas.html': 'minhas-consultas.html'
  };
  const realAssets = {
    '/assistente-compra.css': 'assistente-compra.css',
    '/logo-consulta-veicular-360.webp': 'logo-consulta-veicular-360.webp',
    '/suv-consulta-veicular-360.webp': 'suv-consulta-veicular-360.webp',
    '/file_00000000d76c820e88ceb6c39ce70f0d.png': 'file_00000000d76c820e88ceb6c39ce70f0d.png'
  };
  if (Object.hasOwn(realPages, pathname) || Object.hasOwn(realAssets, pathname)) {
    const isPage = Object.hasOwn(realPages, pathname);
    const relative = isPage ? realPages[pathname] : realAssets[pathname];
    const mime = isPage ? 'text/html; charset=utf-8' : relative.endsWith('.css') ? 'text/css; charset=utf-8' : relative.endsWith('.png') ? 'image/png' : 'image/webp';
    fs.readFile(path.join(__dirname, '..', relative), (error, bytes) => {
      if (error) { res.writeHead(404); return res.end(); }
      let output = bytes;
      if (isPage) {
        let html = bytes.toString('utf8').replace(/<meta name="robots"[^>]*>/gi, '');
        html = html.replace(/<head([^>]*)>/i, '<head$1><meta name="robots" content="noindex,nofollow,noarchive">');
        html = html.replace(/<body([^>]*)>/i, '<body$1><div style="position:sticky;top:0;z-index:2147483647;background:#fff1b8;color:#352900;padding:12px;text-align:center;font:700 13px system-ui">PRÉVIA VISUAL REAL — botões, consultas, login e pagamentos desativados. <a href="/">Voltar à demonstração</a></div>');
        html = html.replace(/href="\/"(?=[\s>])/g, 'href="/site-real"');
        output = Buffer.from(html);
      }
      res.writeHead(200, {
        'Content-Type': mime,
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"
      });
      res.end(req.method === 'HEAD' ? undefined : output);
    });
    return;
  }
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    return res.end(req.method === 'HEAD' ? undefined : 'ok');
  }
  if (pathname !== '/' && pathname !== '/checkout-demo' && pathname !== '/transparencia' && pathname !== '/admin-demo') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end();
  }
  fs.readFile(pathname === '/checkout-demo' ? path.join(__dirname, 'checkout-demo.html') : pathname === '/transparencia' ? path.join(__dirname, 'transparencia.html') : pathname === '/admin-demo' ? path.join(__dirname, 'admin-demo.html') : file, (error, html) => {
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
