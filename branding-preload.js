'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const originalCreateServer = http.createServer.bind(http);
const IS_BACKEND_SERVER = path.basename(String(process.argv[1] || '')).toLowerCase() === 'server.js';

const BRAND_CSS = `
.top{padding:28px 0}
.brand{display:flex;align-items:center}
.brand-link{display:block;text-decoration:none;line-height:0}
.brand-logo{
  display:block;
  width:390px;
  max-width:50vw;
  height:auto;
  border-radius:16px;
  background:linear-gradient(135deg,#ffffff,#eef7ff);
  padding:8px 10px;
  box-shadow:0 16px 42px rgba(2,9,17,.34),0 0 0 1px rgba(255,255,255,.38),0 0 28px rgba(48,152,255,.16);
  transition:transform .18s ease,box-shadow .18s ease;
}
.brand-link:hover .brand-logo{
  transform:translateY(-2px) scale(1.015);
  box-shadow:0 20px 50px rgba(2,9,17,.38),0 0 0 1px rgba(255,255,255,.46),0 0 34px rgba(48,152,255,.22);
}
@media(max-width:900px){
  .top{justify-content:center;padding:22px 0}
  .brand-logo{width:300px;max-width:72vw;border-radius:14px;padding:6px 8px}
}
@media(max-width:520px){
  .top{padding:18px 0}
  .brand-logo{width:240px;max-width:80vw;border-radius:12px;padding:5px 6px}
}
`;

function pathnameOf(req) {
  try { return new URL(req.url, 'http://localhost').pathname; }
  catch (_) { return '/'; }
}

http.createServer = function brandedCreateServer(...args) {
  const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
  const listener = args[listenerIndex];
  if (!IS_BACKEND_SERVER || typeof listener !== 'function') return originalCreateServer(...args);

  args[listenerIndex] = function brandedListener(req, res) {
    const pathname = pathnameOf(req);
    const method = String(req.method || 'GET').toUpperCase();

    if ((method === 'GET' || method === 'HEAD') && pathname === '/brand-logo.svg') {
      const logoPath = path.join(__dirname, 'brand-logo.svg');
      fs.readFile(logoPath, (err, data) => {
        if (err) return listener(req, res);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('Content-Length', String(data.length));
        if (method === 'HEAD') return res.end();
        return res.end(data);
      });
      return;
    }

    if ((method === 'GET' || method === 'HEAD') && (pathname === '/' || pathname === '/index.html')) {
      const indexPath = path.join(__dirname, 'index.html');
      fs.readFile(indexPath, 'utf8', (err, html) => {
        if (err) return listener(req, res);

        let output = html;
        if (!output.includes('brand-logo.svg')) {
          output = output.replace(
            '<div class="brand">🚘 Consulta Veicular 360</div>',
            '<div class="brand"><a class="brand-link" href="/" aria-label="Consulta Veicular 360"><img class="brand-logo" src="/brand-logo.svg?v=3" alt="Consulta Veicular 360" width="920" height="260"></a></div>'
          );
          output = output.replace('</style>', `${BRAND_CSS}</style>`);
        }

        const body = Buffer.from(output, 'utf8');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Content-Length', String(body.length));
        if (method === 'HEAD') return res.end();
        return res.end(body);
      });
      return;
    }

    return listener(req, res);
  };

  return originalCreateServer(...args);
};
