const http = require('http');
const net = require('net');
const { fork } = require('child_process');

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const INNER_PORT = Number(process.env.WHATSAPP_INNER_PORT || 13001);
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const WHATSAPP_URL = 'https://wa.me/5577920006292?text=Ol%C3%A1%2C%20preciso%20de%20ajuda%20com%20uma%20consulta%20veicular.';

const WHATSAPP_HTML = `
<a id="floating-whatsapp" class="floating-whatsapp" href="${WHATSAPP_URL}" target="_blank" rel="noopener noreferrer" aria-label="Falar pelo WhatsApp">
  <span class="floating-whatsapp-label">Falar no WhatsApp</span>
  <span class="floating-whatsapp-icon" aria-hidden="true">💬</span>
</a>`;

const WHATSAPP_CSS = `
<style id="floating-whatsapp-style">
.floating-whatsapp{
  position:fixed;
  right:18px;
  bottom:18px;
  z-index:9000;
  display:flex;
  align-items:center;
  gap:9px;
  color:#fff;
  text-decoration:none;
  font:800 11px/1 Inter,system-ui,-apple-system,'Segoe UI',sans-serif;
  filter:drop-shadow(0 10px 22px rgba(0,0,0,.28));
}
.floating-whatsapp-icon{
  width:50px;
  height:50px;
  display:grid;
  place-items:center;
  border:1px solid rgba(255,255,255,.2);
  border-radius:50%;
  background:#20b95a;
  font-size:22px;
  box-shadow:0 10px 26px rgba(32,185,90,.28);
  transition:transform .16s ease,filter .16s ease;
}
.floating-whatsapp-label{
  padding:9px 11px;
  border:1px solid #234d37;
  border-radius:10px;
  background:rgba(6,21,14,.93);
  color:#dff8e9;
  opacity:0;
  transform:translateX(7px);
  pointer-events:none;
  transition:opacity .16s ease,transform .16s ease;
}
.floating-whatsapp:hover .floating-whatsapp-label,
.floating-whatsapp:focus-visible .floating-whatsapp-label{opacity:1;transform:none}
.floating-whatsapp:hover .floating-whatsapp-icon{transform:translateY(-1px);filter:brightness(1.05)}
.floating-whatsapp:focus-visible{outline:2px solid #7ee7a7;outline-offset:4px;border-radius:999px}
@media(max-width:560px){
  .floating-whatsapp{right:13px;bottom:82px}
  .floating-whatsapp-icon{width:46px;height:46px;font-size:20px;box-shadow:0 8px 18px rgba(0,0,0,.24)}
  .floating-whatsapp-label{display:none}
}
</style>`;

function waitForPort(port, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) reject(new Error('Aplicação interna não iniciou a tempo.'));
        else setTimeout(tryConnect, 200);
      });
    };
    tryConnect();
  });
}

function proxy(req, res, injectHome) {
  const headers = { ...req.headers, host: `127.0.0.1:${INNER_PORT}` };
  if (injectHome) headers['accept-encoding'] = 'identity';

  const upstream = http.request({
    hostname: '127.0.0.1',
    port: INNER_PORT,
    path: req.url,
    method: req.method,
    headers
  }, upstreamRes => {
    if (!injectHome) {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
      return;
    }

    const type = String(upstreamRes.headers['content-type'] || '');
    if (!type.includes('text/html')) {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
      return;
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
        res.end('Página excedeu o limite de renderização.');
        return;
      }

      let html = Buffer.concat(chunks).toString('utf8');
      if (!html.includes('id="floating-whatsapp-style"')) html = html.replace('</head>', `${WHATSAPP_CSS}\n</head>`);
      if (!html.includes('id="floating-whatsapp"')) html = html.replace('</body>', `${WHATSAPP_HTML}\n</body>`);

      const body = Buffer.from(html, 'utf8');
      const out = {
        ...upstreamRes.headers,
        'content-length': String(body.length),
        'cache-control': 'no-store, no-cache, must-revalidate, max-age=0'
      };
      delete out['content-encoding'];
      delete out['transfer-encoding'];
      res.writeHead(upstreamRes.statusCode || 200, out);
      res.end(body);
    });
  });

  upstream.on('error', err => {
    console.error('WHATSAPP_PROXY:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'servico_indisponivel' }));
    }
  });

  req.pipe(upstream);
}

async function start() {
  const child = fork(require.resolve('./payment-proxy.js'), [], {
    env: { ...process.env, PORT: String(INNER_PORT) },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc']
  });

  child.on('exit', code => {
    console.error(`WHATSAPP_PROXY: aplicação interna encerrou (código ${code}).`);
    process.exit(code || 1);
  });

  try {
    await waitForPort(INNER_PORT);
  } catch (err) {
    console.error('WHATSAPP_PROXY:', err.message);
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const isHome = req.method === 'GET' && (pathname === '/' || pathname === '/index.html');
    proxy(req, res, isHome);
  });

  server.listen(PUBLIC_PORT, () => console.log(`WhatsApp flutuante ativo na porta ${PUBLIC_PORT}`));
}

start();
