const http = require('http');
const net = require('net');
const { fork } = require('child_process');

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const APP_PORT = Number(process.env.THEME_INTERNAL_PORT || 10001);
const ORDERS_INTERNAL_PORT = Number(process.env.INTERNAL_APP_PORT || 10002);
const MAX_HTML_BYTES = 2 * 1024 * 1024;

const THEME_CSS = `
<style id="background-image-theme">
html,body{min-height:100%}
body{
  margin:0!important;
  background-color:#05080d!important;
  background-image:url('ChatGPT%20Image%2016%20de%20set.%20de%202026,%2010_58_27.png?v=6')!important;
  background-position:center top!important;
  background-size:cover!important;
  background-repeat:no-repeat!important;
  background-attachment:fixed!important;
  color:#f7f9fc;
  overflow-x:hidden;
}
body > .wrap{display:block!important;position:relative;z-index:1}
.card,.details-panel,.benefit,.private-notice{
  background-color:rgba(7,13,22,.90)!important;
  backdrop-filter:blur(8px);
  -webkit-backdrop-filter:blur(8px);
}
@media(max-width:650px){
  body{
    background-attachment:scroll!important;
    background-position:center top!important;
    background-size:auto 100vh!important;
  }
}
@media print{
  body{background:#fff!important}
}
</style>`;

function waitForPort(port, timeoutMs = 25000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - start >= timeoutMs) reject(new Error('Aplicação interna não iniciou a tempo.'));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

function proxyStream(req, res) {
  const headers = { ...req.headers, host: `127.0.0.1:${APP_PORT}` };
  const upstream = http.request({
    hostname: '127.0.0.1',
    port: APP_PORT,
    path: req.url,
    method: req.method,
    headers
  }, upstreamRes => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });

  upstream.on('error', err => {
    console.error('THEME_PROXY: erro no proxy:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'servico_indisponivel' }));
    }
  });

  req.pipe(upstream);
}

function serveThemedHtml(req, res) {
  const headers = { ...req.headers, host: `127.0.0.1:${APP_PORT}` };
  const upstream = http.request({
    hostname: '127.0.0.1',
    port: APP_PORT,
    path: req.url,
    method: 'GET',
    headers
  }, upstreamRes => {
    const type = String(upstreamRes.headers['content-type'] || '');
    if (!type.includes('text/html')) {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      return upstreamRes.pipe(res);
    }

    const chunks = [];
    let size = 0;
    upstreamRes.on('data', chunk => {
      size += chunk.length;
      if (size <= MAX_HTML_BYTES) chunks.push(chunk);
    });

    upstreamRes.on('end', () => {
      if (size > MAX_HTML_BYTES) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Página excedeu o limite de renderização.');
      }

      let html = Buffer.concat(chunks).toString('utf8');
      if (!html.includes('id="background-image-theme"')) {
        html = html.replace('</head>', `${THEME_CSS}\n</head>`);
      }

      const body = Buffer.from(html);
      const outHeaders = {
        ...upstreamRes.headers,
        'content-length': String(body.length),
        'cache-control': 'no-store, no-cache, must-revalidate',
        pragma: 'no-cache',
        expires: '0'
      };
      delete outHeaders['transfer-encoding'];

      res.writeHead(upstreamRes.statusCode || 200, outHeaders);
      res.end(body);
    });
  });

  upstream.on('error', err => {
    console.error('THEME_PROXY: erro ao carregar HTML:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Serviço temporariamente indisponível.');
    }
  });

  upstream.end();
}

async function start() {
  const child = fork(require.resolve('./orders-proxy.js'), [], {
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      INTERNAL_APP_PORT: String(ORDERS_INTERNAL_PORT)
    },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc']
  });

  child.on('exit', code => {
    console.error(`THEME_PROXY: aplicação interna encerrou (código ${code}).`);
    process.exit(code || 1);
  });

  try {
    await waitForPort(APP_PORT);
  } catch (err) {
    console.error('THEME_PROXY:', err.message);
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      return serveThemedHtml(req, res);
    }
    return proxyStream(req, res);
  });

  server.listen(PUBLIC_PORT, () => {
    console.log(`Imagem aplicada apenas como fundo na porta ${PUBLIC_PORT}`);
  });
}

start();
