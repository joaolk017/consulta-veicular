const http = require('http');
const zlib = require('zlib');

const originalCreateServer = http.createServer.bind(http);
const HERO_URL = '/ChatGPT%20Image%2016%20de%20set.%20de%202026,%2012_01_50.png?v=8';
const HERO_DECLARATION = "background-image:url('ChatGPT%20Image%2016%20de%20set.%20de%202026,%2012_01_50.png?v=8')";

function withHeader(headers, name, value) {
  const out = { ...(headers || {}) };
  const key = Object.keys(out).find(k => k.toLowerCase() === name.toLowerCase());
  if (key && key !== name) delete out[key];
  out[name] = value;
  return out;
}

function mergeVary(current, value) {
  const items = String(current || '').split(',').map(v => v.trim()).filter(Boolean);
  if (!items.some(v => v.toLowerCase() === value.toLowerCase())) items.push(value);
  return items.join(', ');
}

http.createServer = function patchedCreateServer(listener) {
  return originalCreateServer((req, res) => {
    let pathname = '/';
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (_) {}

    const isHome = req.method === 'GET' && (pathname === '/' || pathname === '/index.html');
    const isStatic = /\.(?:png|jpe?g|webp|avif|svg|ico|css|js)$/i.test(pathname);

    if (!isHome && isStatic) {
      const writeHead = res.writeHead.bind(res);
      res.writeHead = function (statusCode, statusMessage, headers) {
        let message = statusMessage;
        let hdrs = headers;
        if (typeof statusMessage === 'object' && statusMessage !== null) {
          hdrs = statusMessage;
          message = undefined;
        }
        hdrs = withHeader(hdrs, 'cache-control', 'public, max-age=31536000, immutable');
        delete hdrs.pragma;
        delete hdrs.expires;
        return message !== undefined ? writeHead(statusCode, message, hdrs) : writeHead(statusCode, hdrs);
      };
      return listener(req, res);
    }

    if (!isHome) return listener(req, res);

    const writeHead = res.writeHead.bind(res);
    const end = res.end.bind(res);
    let pending = null;

    res.writeHead = function (statusCode, statusMessage, headers) {
      let message = statusMessage;
      let hdrs = headers;
      if (typeof statusMessage === 'object' && statusMessage !== null) {
        hdrs = statusMessage;
        message = undefined;
      }
      pending = { statusCode, statusMessage: message, headers: { ...(hdrs || {}) } };
      return res;
    };

    res.end = function (chunk, encoding, callback) {
      let body;
      if (Buffer.isBuffer(chunk)) body = chunk;
      else body = Buffer.from(chunk == null ? '' : String(chunk), typeof encoding === 'string' ? encoding : 'utf8');

      let html = body.toString('utf8');

      // Em telas pequenas, evita baixar a imagem decorativa pesada na primeira carga.
      html = html.replace(HERO_DECLARATION, 'background-image:none');

      if (!html.includes('id="perf-boost"')) {
        const perfHead = `
<link rel="preload" as="image" href="${HERO_URL}" media="(min-width:561px)" fetchpriority="high">
<style id="perf-boost">
  @media (min-width:561px){
    .cv-hero:before{background-image:url('${HERO_URL}')!important}
  }

  /* Hierarquia visual: consulta é a ação principal. */
  .cv-search-card{
    position:relative;
    z-index:3;
    border-color:#268fe8!important;
    box-shadow:0 24px 70px rgba(0,79,165,.28)!important;
  }
  .cv-search-card:before{
    content:'AÇÃO PRINCIPAL';
    position:absolute;
    top:-10px;
    right:18px;
    padding:5px 9px;
    border-radius:999px;
    background:#168cff;
    color:#fff;
    font:900 9px/1 Inter,system-ui,-apple-system,'Segoe UI',sans-serif;
    letter-spacing:.8px;
    box-shadow:0 8px 20px rgba(22,140,255,.26);
  }
  #cv-consult-btn{
    background:linear-gradient(135deg,#1d9dff,#0566df)!important;
    box-shadow:0 14px 34px rgba(15,117,229,.34)!important;
  }

  /* CRLV permanece muito visível, mas com linguagem visual secundária. */
  .cv-hero-crlv{
    position:relative;
    z-index:2;
    border-color:rgba(91,171,230,.48)!important;
    background:linear-gradient(180deg,rgba(9,31,51,.94),rgba(6,19,33,.96))!important;
    box-shadow:0 16px 46px rgba(0,0,0,.28)!important;
  }
  .cv-hero-crlv:before{
    content:'SERVIÇO DOCUMENTAL';
    display:inline-flex;
    align-items:center;
    width:max-content;
    margin-bottom:9px;
    padding:5px 9px;
    border:1px solid rgba(88,178,239,.38);
    border-radius:999px;
    background:rgba(18,80,123,.34);
    color:#8fd4ff;
    font:900 9px/1 Inter,system-ui,-apple-system,'Segoe UI',sans-serif;
    letter-spacing:.9px;
  }
  .cv-hero-crlv h2{
    font-size:clamp(25px,2.7vw,38px)!important;
    line-height:1.02!important;
  }
  .cv-hero-crlv strong{
    font-size:clamp(30px,3vw,42px)!important;
  }
  .cv-hero-crlv button{
    background:rgba(14,72,116,.28)!important;
    border:1px solid #368ccc!important;
    color:#e8f6ff!important;
    box-shadow:none!important;
  }
  .cv-hero-crlv button:hover{
    background:rgba(27,113,174,.38)!important;
    border-color:#61b9f5!important;
  }

  /* Deixa clara a prioridade também no CTA fixo do celular. */
  @media (max-width:560px){
    .cv-nav{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;background:#040a14!important}
    .cv-search-card,.cv-hero-crlv,.cv-report-preview,.cv-sticky-mobile{box-shadow:none!important}
    .cv-search-card:before{top:-9px;right:12px;font-size:8px}
    .cv-hero-crlv{opacity:.98}
    .cv-hero-crlv h2{font-size:25px!important}
    .cv-hero-crlv strong{font-size:30px!important}
    .cv-sticky-mobile{
      grid-template-columns:minmax(0,1.7fr) minmax(0,1fr)!important;
      gap:7px!important;
    }
    .cv-sticky-mobile a[href="#consulta"],
    .cv-sticky-mobile button:first-child{
      background:#168cff!important;
      border-color:#168cff!important;
      color:#fff!important;
      font-weight:950!important;
    }
    .cv-sticky-mobile a[href="#crlv"],
    .cv-sticky-mobile button:last-child{
      background:#0b2034!important;
      border:1px solid #356e9d!important;
      color:#d7efff!important;
      box-shadow:none!important;
    }
  }

  .cv-section,.cv-footer{
    content-visibility:auto;
    contain-intrinsic-size:850px;
  }
</style>`;
        html = html.replace('</head>', `${perfHead}\n</head>`);
      }

      body = Buffer.from(html, 'utf8');
      let headers = { ...((pending && pending.headers) || {}) };
      headers = withHeader(headers, 'cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
      headers = withHeader(headers, 'content-type', headers['content-type'] || headers['Content-Type'] || 'text/html; charset=utf-8');
      headers.vary = mergeVary(headers.vary || headers.Vary, 'Accept-Encoding');
      delete headers.Vary;
      delete headers['transfer-encoding'];
      delete headers['Transfer-Encoding'];

      const acceptsGzip = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(String(req.headers['accept-encoding'] || ''));
      if (acceptsGzip) {
        body = zlib.gzipSync(body, { level: 4 });
        headers['content-encoding'] = 'gzip';
      } else {
        delete headers['content-encoding'];
        delete headers['Content-Encoding'];
      }
      headers['content-length'] = String(body.length);
      delete headers['Content-Length'];

      const statusCode = (pending && pending.statusCode) || 200;
      if (pending && pending.statusMessage !== undefined) writeHead(statusCode, pending.statusMessage, headers);
      else writeHead(statusCode, headers);

      if (typeof encoding === 'function') return end(body, encoding);
      if (typeof callback === 'function') return end(body, callback);
      return end(body);
    };

    return listener(req, res);
  });
};

require('./landing-proxy.js');
