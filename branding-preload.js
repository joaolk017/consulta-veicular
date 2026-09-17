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
.notice.private-notice{border-color:#5d88ad;background:linear-gradient(135deg,#173b5d,#122f4a);box-shadow:0 14px 34px rgba(2,9,17,.22)}
.notice.private-notice strong{display:block;margin-bottom:6px;font-size:13px;color:#fff;letter-spacing:.2px}
.notice.private-notice .provider-note{display:block;margin-top:8px;color:#d8e8f5;font-size:11px;line-height:1.6}
.notice.private-notice .private-links{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}
.notice.private-notice .private-links a{font-size:10px;font-weight:850;text-decoration:none}
@media(max-width:900px){
  .top{justify-content:center;padding:22px 0}
  .brand-logo{width:300px;max-width:72vw;border-radius:14px;padding:6px 8px}
}
@media(max-width:520px){
  .top{padding:18px 0}
  .brand-logo{width:240px;max-width:80vw;border-radius:12px;padding:5px 6px}
  .notice.private-notice strong{font-size:12px}
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

        output = output.replace(
          '<span class="pill">SERVIÇO PRIVADO E INDEPENDENTE</span>',
          '<span class="pill">SERVIÇO PRIVADO E INDEPENDENTE · SEM VÍNCULO GOVERNAMENTAL</span>'
        );

        output = output.replace(
          '<div class="notice"><b>Importante:</b> a Consulta Veicular 360 é uma plataforma privada e independente de intermediação e consolidação de consultas veiculares, sem vínculo governamental.</div>',
          '<div class="notice private-notice"><strong>🔎 Consulta Veicular 360 — serviço privado e independente</strong>A Consulta Veicular 360 é uma plataforma privada de consulta informativa e consolidação de dados veiculares. <b>Não somos DETRAN, SENATRAN, GOV.BR e não representamos nenhum órgão público.</b> O serviço é operado por empresa privada identificada no rodapé do site. As informações dependem das fontes integradas e podem variar conforme o veículo.<span class="provider-note"><b>Integrações transparentes:</b> utilizamos provedores tecnológicos independentes para dados veiculares e a Woovi/OpenPix para processamento do PIX. A utilização ou menção desses serviços <b>não significa sociedade, representação, afiliação institucional, patrocínio ou vínculo governamental</b>.</span><div class="private-links"><a href="/sobre/">Sobre o serviço</a><a href="/termos.html">Termos de Uso</a><a href="/privacidade.html">Política de Privacidade</a><a href="/contato.html">Contato e Suporte</a></div></div>'
        );

        output = output.replace(
          '<div class="identity"><b>Consulta Veicular 360</b><br>consultaveicular360.com.br · Serviço privado e independente.<br>',
          '<div class="identity"><b>Consulta Veicular 360</b><br>consultaveicular360.com.br · <b>Serviço privado e independente, sem vínculo com DETRAN, SENATRAN ou GOV.BR.</b><br>'
        );

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