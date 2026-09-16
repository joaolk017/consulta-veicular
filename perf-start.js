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
  .cv-section,.cv-footer{
    content-visibility:auto;
    contain-intrinsic-size:850px;
  }
  @media (max-width:560px){
    .cv-nav{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;background:#040a14!important}
    .cv-search-card,.cv-hero-crlv,.cv-report-preview,.cv-sticky-mobile{box-shadow:none!important}
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
