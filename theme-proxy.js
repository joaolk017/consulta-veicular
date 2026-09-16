const http = require('http');
const net = require('net');
const { fork } = require('child_process');

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const APP_PORT = Number(process.env.THEME_INTERNAL_PORT || 10001);
const ORDERS_INTERNAL_PORT = Number(process.env.INTERNAL_APP_PORT || 10002);
const MAX_HTML_BYTES = 2 * 1024 * 1024;

const HERO_HTML = `
<section class="main-visual-hero" aria-label="Consulta veicular">
  <div class="main-visual-overlay"></div>
  <div class="main-visual-actions">
    <a class="hero-consult-btn" href="#consulta-area">🔎 CONSULTAR PLACA</a>
    <span>Role para continuar e usar a consulta real do site</span>
  </div>
</section>`;

const THEME_CSS = `
<style id="professional-background-theme">
body{
  background:
    radial-gradient(circle at 12% 2%,rgba(40,132,255,.22) 0,rgba(40,132,255,0) 32%),
    radial-gradient(circle at 88% 8%,rgba(255,48,82,.17) 0,rgba(255,48,82,0) 30%),
    radial-gradient(circle at 50% 100%,rgba(21,94,150,.13) 0,rgba(21,94,150,0) 38%),
    linear-gradient(135deg,#04070c 0%,#07111c 42%,#080d16 70%,#04070c 100%)!important;
  background-attachment:fixed!important;
  position:relative;
  isolation:isolate;
  overflow-x:hidden;
}
body::before{
  content:"";
  position:fixed;
  inset:0;
  z-index:-2;
  pointer-events:none;
  background-image:
    linear-gradient(rgba(255,255,255,.022) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,255,255,.022) 1px,transparent 1px);
  background-size:54px 54px;
  -webkit-mask-image:linear-gradient(to bottom,rgba(0,0,0,.72),transparent 88%);
  mask-image:linear-gradient(to bottom,rgba(0,0,0,.72),transparent 88%);
}
body::after{
  content:"";
  position:fixed;
  width:62vw;
  height:62vw;
  min-width:420px;
  min-height:420px;
  right:-28vw;
  bottom:-38vw;
  z-index:-1;
  pointer-events:none;
  border-radius:50%;
  background:radial-gradient(circle,rgba(35,121,216,.13),rgba(35,121,216,0) 68%);
  filter:blur(8px);
}
.main-visual-hero{
  width:100%;
  min-height:clamp(560px,100svh,920px);
  position:relative;
  display:flex;
  align-items:flex-end;
  justify-content:center;
  background-image:url('ChatGPT%20Image%2016%20de%20set.%20de%202026,%2010_58_27.png');
  background-size:cover;
  background-position:center top;
  background-repeat:no-repeat;
  border-bottom:1px solid rgba(58,124,190,.45);
  box-shadow:0 30px 80px rgba(0,0,0,.55);
  overflow:hidden;
  isolation:isolate;
}
.main-visual-overlay{
  position:absolute;
  inset:0;
  z-index:0;
  pointer-events:none;
  background:linear-gradient(to bottom,rgba(2,6,12,.03) 0%,rgba(2,6,12,.04) 55%,rgba(2,6,12,.72) 88%,#05080d 100%);
}
.main-visual-actions{
  position:relative;
  z-index:2;
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:9px;
  padding:28px 18px 34px;
}
.hero-consult-btn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:260px;
  padding:16px 26px;
  border-radius:14px;
  text-decoration:none;
  color:#fff;
  font-size:15px;
  font-weight:950;
  letter-spacing:.25px;
  background:linear-gradient(135deg,#168fff,#0567d7);
  border:1px solid rgba(118,191,255,.7);
  box-shadow:0 15px 38px rgba(0,116,255,.36),inset 0 1px 0 rgba(255,255,255,.2);
}
.hero-consult-btn:hover{transform:translateY(-1px);filter:brightness(1.06)}
.main-visual-actions span{font-size:11px;color:#b8c8d9;text-shadow:0 2px 8px #000}
#consulta-area{scroll-margin-top:18px}
.card,.details-panel,.benefit,.private-notice{
  backdrop-filter:blur(14px);
  -webkit-backdrop-filter:blur(14px);
}
.card{
  box-shadow:0 28px 90px rgba(0,0,0,.48),inset 0 1px 0 rgba(255,255,255,.035)!important;
}
.top,.hero,.private-notice,.services-grid,.details-panel,.why,.footer{position:relative;z-index:1}
.logo{box-shadow:0 12px 34px rgba(229,29,60,.28),0 0 0 1px rgba(255,255,255,.03)!important}
.eyebrow,.badge{box-shadow:inset 0 1px 0 rgba(255,255,255,.035)}
@media(max-width:900px){
  .main-visual-hero{
    min-height:72svh;
    background-size:cover;
    background-position:center top;
  }
}
@media(max-width:650px){
  body{background-attachment:scroll!important}
  body::before{background-size:40px 40px;opacity:.72}
  body::after{right:-55vw;bottom:-20vw}
  .main-visual-hero{
    min-height:62svh;
    background-size:cover;
    background-position:center top;
  }
  .main-visual-actions{padding-bottom:22px}
  .hero-consult-btn{min-width:230px;padding:14px 20px;font-size:14px}
  .main-visual-actions span{font-size:10px}
}
@media print{
  body{background:#fff!important}
  body::before,body::after,.main-visual-hero{display:none!important}
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
  const upstream = http.request({ hostname: '127.0.0.1', port: APP_PORT, path: req.url, method: req.method, headers }, upstreamRes => {
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
  const upstream = http.request({ hostname: '127.0.0.1', port: APP_PORT, path: req.url, method: 'GET', headers }, upstreamRes => {
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
      if (!html.includes('professional-background-theme')) {
        html = html.replace('</head>', `${THEME_CSS}\n</head>`);
      }
      if (!html.includes('main-visual-hero')) {
        html = html.replace('<body>', `<body>\n${HERO_HTML}`);
      }
      if (!html.includes('id="consulta-area"')) {
        html = html.replace('<main class="card">', '<main class="card" id="consulta-area">');
      }
      const body = Buffer.from(html);
      const outHeaders = { ...upstreamRes.headers, 'content-length': String(body.length) };
      delete outHeaders['transfer-encoding'];
      outHeaders['cache-control'] = 'no-cache';
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
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) return serveThemedHtml(req, res);
    return proxyStream(req, res);
  });

  server.listen(PUBLIC_PORT, () => console.log(`Tema profissional ativo na porta ${PUBLIC_PORT}`));
}

start();
