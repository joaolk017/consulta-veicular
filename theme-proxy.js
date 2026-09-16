const http = require('http');
const net = require('net');
const { fork } = require('child_process');

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const APP_PORT = Number(process.env.THEME_INTERNAL_PORT || 10001);
const ORDERS_INTERNAL_PORT = Number(process.env.INTERNAL_APP_PORT || 10002);
const MAX_HTML_BYTES = 2 * 1024 * 1024;

const HERO_HTML = `
<section id="main-visual-hero-live" class="main-visual-hero" aria-label="Consulta veicular">
  <div class="main-visual-overlay"></div>
  <div class="main-visual-actions">
    <div class="hero-search-card">
      <div class="hero-search-title">Consulte a placa agora</div>
      <div class="hero-search-subtitle">Digite a placa do veículo no padrão antigo ou Mercosul.</div>
      <div class="hero-plate-shell">
        <div class="hero-plate-top"><span>🇧🇷 BRASIL</span><span>BR</span></div>
        <input id="hero-plate" class="hero-plate-input" maxlength="8" autocomplete="off" placeholder="ABC1D23" inputmode="text" aria-label="Digite a placa do veículo">
      </div>
      <button class="hero-consult-btn" type="button" onclick="heroConsultar()">🔎 CONSULTAR VEÍCULO</button>
      <div id="hero-search-error" class="hero-search-error" aria-live="polite"></div>
    </div>
    <span>Consulta rápida • resultado exibido no próprio site</span>
  </div>
</section>
<script>
(function(){
  var heroInput=document.getElementById('hero-plate');
  if(heroInput){
    heroInput.addEventListener('input',function(e){e.target.value=String(e.target.value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7)});
    heroInput.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();window.heroConsultar();}});
  }
  window.heroConsultar=function(){
    var input=document.getElementById('hero-plate');
    var error=document.getElementById('hero-search-error');
    var plate=String(input&&input.value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    var valid=/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)||/^[A-Z]{3}[0-9]{4}$/.test(plate);
    if(!valid){if(error)error.textContent='Digite uma placa válida, como ABC1D23.';return;}
    if(error)error.textContent='';
    var original=document.getElementById('plate');
    if(!original){if(error)error.textContent='A consulta está temporariamente indisponível.';return;}
    original.value=plate;
    var area=document.getElementById('consulta-area');
    if(area)area.scrollIntoView({behavior:'smooth',block:'start'});
    setTimeout(function(){
      if(typeof window.consultar==='function') window.consultar();
      else {
        var btn=document.getElementById('btn');
        if(btn)btn.click();
        else if(error)error.textContent='Não foi possível iniciar a consulta.';
      }
    },280);
  };
})();
</script>`;

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
  min-height:clamp(620px,100svh,960px);
  position:relative;
  display:flex;
  align-items:flex-end;
  justify-content:center;
  background-image:url('ChatGPT%20Image%2016%20de%20set.%20de%202026,%2010_58_27.png?v=3');
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
  background:linear-gradient(to bottom,rgba(2,6,12,.02) 0%,rgba(2,6,12,.03) 48%,rgba(2,6,12,.72) 83%,#05080d 100%);
}
.main-visual-actions{
  position:relative;
  z-index:2;
  width:min(100% - 28px,560px);
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:10px;
  padding:28px 0 34px;
}
.hero-search-card{
  width:100%;
  padding:18px;
  border-radius:20px;
  background:rgba(5,12,22,.84);
  border:1px solid rgba(77,154,226,.55);
  box-shadow:0 20px 55px rgba(0,0,0,.62),inset 0 1px 0 rgba(255,255,255,.05);
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
}
.hero-search-title{
  text-align:center;
  color:#fff;
  font-size:20px;
  font-weight:950;
  letter-spacing:-.3px;
  margin-bottom:5px;
}
.hero-search-subtitle{
  text-align:center;
  color:#aebfd2;
  font-size:12px;
  line-height:1.45;
  margin-bottom:13px;
}
.hero-plate-shell{
  overflow:hidden;
  border:2px solid #d7dce2;
  border-radius:14px;
  background:#eef1f4;
  box-shadow:0 12px 35px rgba(0,0,0,.45);
}
.hero-plate-top{
  height:25px;
  background:#1556a6;
  color:#fff;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:0 13px;
  font-size:10px;
  font-weight:900;
}
.hero-plate-input{
  width:100%;
  border:0;
  outline:0;
  background:#f4f5f6;
  color:#10151d;
  text-align:center;
  font-size:clamp(29px,5vw,38px);
  font-weight:950;
  letter-spacing:5px;
  text-transform:uppercase;
  padding:13px 10px;
}
.hero-consult-btn{
  width:100%;
  margin-top:12px;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:16px 22px;
  border-radius:13px;
  border:1px solid rgba(118,191,255,.72);
  color:#fff;
  font-size:15px;
  font-weight:950;
  letter-spacing:.2px;
  cursor:pointer;
  background:linear-gradient(135deg,#168fff,#0567d7);
  box-shadow:0 15px 38px rgba(0,116,255,.36),inset 0 1px 0 rgba(255,255,255,.2);
}
.hero-consult-btn:hover{transform:translateY(-1px);filter:brightness(1.06)}
.hero-search-error{min-height:16px;margin-top:8px;text-align:center;color:#ffb7c0;font-size:11px;font-weight:700}
.main-visual-actions>span{font-size:11px;color:#b8c8d9;text-shadow:0 2px 8px #000}
#consulta-area{scroll-margin-top:18px}
.card,.details-panel,.benefit,.private-notice{
  backdrop-filter:blur(14px);
  -webkit-backdrop-filter:blur(14px);
}
.card{box-shadow:0 28px 90px rgba(0,0,0,.48),inset 0 1px 0 rgba(255,255,255,.035)!important}
.top,.hero,.private-notice,.services-grid,.details-panel,.why,.footer{position:relative;z-index:1}
.logo{box-shadow:0 12px 34px rgba(229,29,60,.28),0 0 0 1px rgba(255,255,255,.03)!important}
.eyebrow,.badge{box-shadow:inset 0 1px 0 rgba(255,255,255,.035)}
@media(max-width:900px){
  .main-visual-hero{min-height:78svh;background-position:center top}
}
@media(max-width:650px){
  body{background-attachment:scroll!important}
  body::before{background-size:40px 40px;opacity:.72}
  body::after{right:-55vw;bottom:-20vw}
  .main-visual-hero{min-height:72svh;background-position:center top}
  .main-visual-actions{padding-bottom:20px}
  .hero-search-card{padding:14px;border-radius:17px}
  .hero-search-title{font-size:18px}
  .hero-plate-input{font-size:31px;padding:12px 8px}
  .hero-consult-btn{padding:14px 18px;font-size:14px}
  .main-visual-actions>span{font-size:10px}
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
      if (!html.includes('id="professional-background-theme"')) {
        html = html.replace('</head>', `${THEME_CSS}\n</head>`);
      }
      if (!html.includes('id="main-visual-hero-live"')) {
        html = html.replace('<body>', `<body>\n${HERO_HTML}`);
      }
      if (!html.includes('id="consulta-area"')) {
        html = html.replace('<main class="card">', '<main class="card" id="consulta-area">');
      }
      const body = Buffer.from(html);
      const outHeaders = { ...upstreamRes.headers, 'content-length': String(body.length) };
      delete outHeaders['transfer-encoding'];
      outHeaders['cache-control'] = 'no-store, no-cache, must-revalidate';
      outHeaders['pragma'] = 'no-cache';
      outHeaders['expires'] = '0';
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
