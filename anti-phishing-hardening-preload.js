'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const path = require('path');
const QRCode = require('qrcode');

const originalCreateServer = http.createServer.bind(http);
const IS_BACKEND_SERVER = path.basename(String(process.argv[1] || '')).toLowerCase() === 'server.js';
const OPENPIX_APP_ID = String(process.env.OPENPIX_APP_ID || process.env.WOOVI_APP_ID || '').trim();
const OPENPIX_API_URL = String(process.env.OPENPIX_API_URL || 'https://api.openpix.com.br/api/v1').replace(/\/+$/, '');
const PAYMENT_SIGNING_SECRET = String(process.env.PAYMENT_SIGNING_SECRET || '').trim();
const MAX_BODY_BYTES = 32 * 1024;

function pathnameOf(req) {
  try { return new URL(req.url, 'http://localhost').pathname; }
  catch (_) { return '/'; }
}

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyPaymentToken(token) {
  if (!PAYMENT_SIGNING_SECRET) throw new Error('Assinatura interna de pagamento indisponível.');
  const parts = String(token || '').split('.');
  if (parts.length !== 2) throw new Error('Token de pagamento inválido.');
  const expected = crypto.createHmac('sha256', PAYMENT_SIGNING_SECRET).update(parts[0]).digest('base64url');
  if (!secureEqual(parts[1], expected)) throw new Error('Token de pagamento inválido.');

  let payload = null;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (_) {}
  if (!payload || payload.v !== 2 || payload.provider !== 'openpix' || !payload.correlationID || !payload.product || !payload.plate || !payload.exp) {
    throw new Error('Token de pagamento inválido.');
  }
  if (payload.product !== 'consulta-completa') throw new Error('Token de pagamento incompatível com esta operação.');
  if (Date.now() > Number(payload.exp)) throw new Error('Token de pagamento expirado.');
  return payload;
}

function collectJson(req, limitBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('Requisição muito grande.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (_) {
        reject(Object.assign(new Error('JSON inválido.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (_) { return reject(new Error('URL de integração inválida.')); }
    if (parsed.protocol !== 'https:') return reject(new Error('Integração deve usar HTTPS.'));

    const request = https.request(parsed, {
      method: options.method || 'GET',
      headers: options.headers || { Accept: 'application/json' }
    }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 2_000_000) {
          request.destroy(new Error('Resposta da integração excedeu o limite permitido.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
        resolve({ status: response.statusCode || 502, data });
      });
    });
    request.setTimeout(options.timeout || 15000, () => request.destroy(new Error('Tempo limite da integração excedido.')));
    request.on('error', reject);
    request.end();
  });
}

async function openPixBrCode(correlationID) {
  if (!OPENPIX_APP_ID) throw new Error('Integração PIX indisponível.');
  const response = await requestJson(`${OPENPIX_API_URL}/charge/${encodeURIComponent(correlationID)}`, {
    headers: { Accept: 'application/json', Authorization: OPENPIX_APP_ID },
    timeout: 15000
  });
  const charge = response.data && response.data.charge ? response.data.charge : null;
  if (response.status < 200 || response.status >= 300 || !charge) throw new Error('Não foi possível carregar o QR Code do PIX.');
  const brCode = charge.brCode || (charge.pix && charge.pix.brCode) || null;
  if (!brCode) throw new Error('Código PIX indisponível para esta cobrança.');
  return String(brCode);
}

async function handleSameOriginQr(req, res) {
  try {
    const body = await collectJson(req);
    const payload = verifyPaymentToken(body && body.paymentToken);
    const brCode = await openPixBrCode(payload.correlationID);
    const png = await QRCode.toBuffer(brCode, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320
    });
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': String(png.length),
      'Cache-Control': 'no-store, private, max-age=0',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline; filename="pix-qrcode.png"'
    });
    return res.end(png);
  } catch (err) {
    const status = Number(err && err.status) || 400;
    const body = Buffer.from(JSON.stringify({
      error: 'qrcode_indisponivel',
      mensagem: err && err.message ? err.message : 'Não foi possível gerar o QR Code.'
    }));
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(body.length),
      'Cache-Control': 'no-store'
    });
    return res.end(body);
  }
}

function cspFor(pathname) {
  const connect = ["'self'"];
  if (pathname.startsWith('/consulta-cnpj/')) connect.push('https://brasilapi.com.br');
  if (pathname.startsWith('/consulta-fipe/')) connect.push('https://parallelum.com.br');
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src ${connect.join(' ')}`,
    "font-src 'self' data:",
    "manifest-src 'self'",
    "worker-src 'none'",
    'upgrade-insecure-requests'
  ].join('; ');
}

function applyHardeningHeaders(res, pathname) {
  res.setHeader('Content-Security-Policy', cspFor(pathname));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), usb=(), payment=()');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.removeHeader('X-Powered-By');
}

const CLIENT_HARDENING_SCRIPT = `
<script id="cv-same-origin-pix-hardening">
(function(){
  var qrObjectUrl='';
  async function carregarQrLocal(x){
    var img=document.getElementById('pixQr');
    if(!img||!x||!x.paymentToken)return;
    try{
      if(qrObjectUrl){URL.revokeObjectURL(qrObjectUrl);qrObjectUrl='';}
      img.classList.add('hidden');
      img.removeAttribute('src');
      var r=await fetch('/api/pagamento/pix/qrcode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paymentToken:x.paymentToken}),cache:'no-store',credentials:'same-origin'});
      if(!r.ok)throw new Error('QR indisponível');
      var blob=await r.blob();
      if(!blob.type||blob.type.indexOf('image/png')!==0)throw new Error('QR inválido');
      qrObjectUrl=URL.createObjectURL(blob);
      img.src=qrObjectUrl;
      img.classList.remove('hidden');
    }catch(e){
      img.classList.add('hidden');
      img.removeAttribute('src');
      var st=document.getElementById('pixStatus');
      if(st&&/Aguardando pagamento/i.test(st.textContent||'')) st.textContent='Use o código PIX copia e cola abaixo. O QR Code não pôde ser exibido.';
    }
  }
  window.showPix=function(x){
    setStep('pay');
    $('pixCode').value=x.copyPaste||'';
    var img=$('pixQr');
    img.classList.add('hidden');
    img.removeAttribute('src');
    $('pixStatus').className='info';
    $('pixStatus').textContent='Aguardando pagamento...';
    startPoll();
    carregarQrLocal(x);
  };
})();
</script>`;

function rewriteHomeHtml(html) {
  let output = String(html || '');
  const lockedSequence = "${lock('Ano / Ano-modelo')}${lock('Cor')}${lock('Município / UF')}${lock('Combustível')}${lock('Tipo do veículo')}";
  const transparentNotice = '<div class="info" style="margin-top:12px"><b>O que a consulta completa pode apresentar</b><br>Os campos, indicadores e ocorrências exibidos dependem exclusivamente dos dados realmente disponíveis nas fontes integradas para este veículo.</div>';
  output = output.replace(lockedSequence, transparentNotice);
  output = output.replace(/const lock=l=>`<div class="row"><span>\$\{esc\(l\)\}<\/span><span class="locked">██████ 🔒<\/span><\/div>`;/, 'const lock=function(){return ""};');
  // Keep the checkout's current showPix implementation; the legacy injected script
  // overwrote it and used an incompatible v2-only QR endpoint.

  return output;
}

function wrapResponse(req, res, pathname) {
  const originalEnd = res.end.bind(res);
  const chunks = [];
  let captured = false;

  const isHome = req.method === 'GET' && (pathname === '/' || pathname === '/index.html');
  const isPreview = req.method === 'GET' && /^\/api\/consulta\/[^/]+$/.test(pathname);
  const isPixCreate = req.method === 'POST' && pathname === '/api/pagamento/pix/criar';
  if (!isHome && !isPreview && !isPixCreate) return;

  res.write = function hardeningWrite(chunk, encoding, callback) {
    captured = true;
    if (chunk != null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8'));
    if (typeof callback === 'function') callback();
    return true;
  };

  res.end = function hardeningEnd(chunk, encoding, callback) {
    if (chunk != null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8'));
    if (!captured && chunks.length === 0) return originalEnd(chunk, encoding, callback);

    let body = Buffer.concat(chunks);
    try {
      const type = String(res.getHeader('Content-Type') || '');
      if (isHome && type.includes('text/html')) {
        body = Buffer.from(rewriteHomeHtml(body.toString('utf8')), 'utf8');
      } else if ((isPreview || isPixCreate) && type.includes('application/json')) {
        const data = JSON.parse(body.toString('utf8'));
        if (data && typeof data === 'object') {
          if (isPreview) {
            delete data.lockedFields;
            data.availabilityNotice = 'A consulta completa apresenta somente os dados realmente disponíveis nas fontes integradas para o veículo.';
          }
          if (isPixCreate) {
            // Preserve the locally generated QR image and SVG from the current checkout.
            // The legacy endpoint expects v2 tokens; current payment tokens are v3.
          }
          body = Buffer.from(JSON.stringify(data), 'utf8');
        }
      }
      res.removeHeader('ETag');
      res.setHeader('Content-Length', String(body.length));
    } catch (_) {}

    if (typeof encoding === 'function') return originalEnd(body, encoding);
    if (typeof callback === 'function') return originalEnd(body, callback);
    return originalEnd(body);
  };
}

http.createServer = function hardeningCreateServer(...args) {
  const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
  const listener = args[listenerIndex];
  if (!IS_BACKEND_SERVER || typeof listener !== 'function') return originalCreateServer(...args);

  args[listenerIndex] = function hardeningListener(req, res) {
    const pathname = pathnameOf(req);
    const enforcedCsp = cspFor(pathname);
    applyHardeningHeaders(res, pathname);

    const downstreamSetHeader = res.setHeader.bind(res);
    res.setHeader = function enforcedSetHeader(name, value) {
      if (String(name || '').toLowerCase() === 'content-security-policy') {
        return downstreamSetHeader(name, enforcedCsp);
      }
      return downstreamSetHeader(name, value);
    };

    if (req.method === 'POST' && pathname === '/api/pagamento/pix/qrcode') {
      return void handleSameOriginQr(req, res);
    }

    wrapResponse(req, res, pathname);
    return listener(req, res);
  };

  return originalCreateServer(...args);
};

console.log('HARDENING: campos simulados removidos, QR PIX same-origin e CSP reforçada.');
