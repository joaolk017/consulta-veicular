'use strict';

const path = require('path');
const http = require('http');

const ENTRYPOINT = path.basename(String(process.argv[1] || '')).toLowerCase();

if (ENTRYPOINT === 'recovery-ui-proxy.js') {
  const priorCreateServer = http.createServer.bind(http);

  const NOTICE = String.raw`
<style id="cv-private-service-style">
.cv-private-service{position:relative;z-index:7;width:min(1180px,91vw);margin:0 auto 24px;padding:14px 16px;border:1px solid #2b5279;border-radius:14px;background:rgba(7,22,38,.96);box-shadow:0 12px 35px rgba(0,0,0,.28);color:#dce8f5;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
.cv-private-service strong{display:block;margin-bottom:5px;color:#fff;font-size:12px;font-weight:950;letter-spacing:.2px}
.cv-private-service p{margin:0;color:#9fb3c8;font-size:10px;line-height:1.55}
.cv-private-service a{color:#69bfff;font-weight:850;text-decoration:none}.cv-private-service a:hover{text-decoration:underline}
.cv-private-service-links{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}
.cv-private-service-links a{font-size:9px}
@media(max-width:600px){.cv-private-service{margin-bottom:16px;padding:12px 13px;border-radius:12px}.cv-private-service strong{font-size:11px}.cv-private-service p{font-size:9px}.cv-private-service-links{gap:8px}}
</style>
<div id="cv-private-service" class="cv-private-service" role="note" aria-label="Identificação do serviço">
  <strong>🔎 Consulta Veicular 360 — serviço privado e independente</strong>
  <p>Somos uma plataforma privada de consulta informativa. <b>Não somos DETRAN, SENATRAN, GOV.BR e não representamos nenhum órgão público.</b> As informações exibidas dependem das fontes integradas e podem variar conforme o veículo. Quando solicitado, o CPF é usado somente para identificar o pagamento e permitir a recuperação de uma consulta paga.</p>
  <div class="cv-private-service-links">
    <a href="/sobre/">Sobre o serviço</a>
    <a href="/termos.html">Termos de Uso</a>
    <a href="/privacidade.html">Política de Privacidade</a>
    <a href="/contato.html">Contato e Suporte</a>
  </div>
</div>`;

  http.createServer = function transparencyCreateServer(...args) {
    const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
    const listener = args[listenerIndex];
    if (typeof listener !== 'function') return priorCreateServer(...args);

    args[listenerIndex] = function transparencyListener(req, res) {
      let pathname = '/';
      try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (_) {}
      const isHome = req.method === 'GET' && (pathname === '/' || pathname === '/index.html');
      if (!isHome) return listener(req, res);

      const originalWrite = res.write.bind(res);
      const originalEnd = res.end.bind(res);
      const chunks = [];
      let buffering = true;

      res.write = function(chunk, encoding, callback) {
        if (!buffering) return originalWrite(chunk, encoding, callback);
        if (chunk != null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8'));
        if (typeof callback === 'function') callback();
        return true;
      };

      res.end = function(chunk, encoding, callback) {
        if (!buffering) return originalEnd(chunk, encoding, callback);
        buffering = false;
        if (chunk != null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8'));

        try {
          let body = Buffer.concat(chunks);
          const type = String(res.getHeader('content-type') || '');
          if (type.includes('text/html')) {
            let html = body.toString('utf8');
            if (!html.includes('id="cv-private-service"')) {
              const marker = '<div class="cv-hero-overlay"></div>';
              if (html.includes(marker)) html = html.replace(marker, marker + NOTICE);
              else html = html.replace('<main>', '<main>' + NOTICE);
              html = html.replace('🔒 Serviço privado e independente', '🔒 Consulta Veicular 360 · Serviço privado e independente · Sem vínculo com órgãos públicos');
              body = Buffer.from(html, 'utf8');
              res.removeHeader('content-encoding');
              res.removeHeader('transfer-encoding');
              res.setHeader('content-length', String(body.length));
            }
          }
          if (typeof callback === 'function') return originalEnd(body, callback);
          return originalEnd(body);
        } catch (err) {
          console.error('TRANSPARENCY:', err.message);
          const body = Buffer.concat(chunks);
          if (typeof callback === 'function') return originalEnd(body, callback);
          return originalEnd(body);
        }
      };

      return listener(req, res);
    };

    return priorCreateServer(...args);
  };

  console.log('TRANSPARENCY: identificação de serviço privado reforçada na página inicial.');
}
