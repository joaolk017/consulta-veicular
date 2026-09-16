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
  <div class="main-shell">
    <div class="main-brand"><span class="main-brand-icon">🚘</span><span>Consulta Veicular</span><em>Serviço privado e independente</em></div>

    <div class="main-hero-copy">
      <span class="main-kicker">🔒 Consulta online</span>
      <h1>Consulte a placa antes de comprar seu veículo.</h1>
      <p>Digite a placa, consulte os dados disponíveis e desbloqueie o relatório completo após o pagamento.</p>
    </div>

    <div class="main-service-grid">
      <div class="hero-search-card">
        <div class="hero-card-head"><span>🔎</span><div><b>Consulta de placa</b><small>Padrão antigo ou Mercosul</small></div></div>
        <div class="hero-plate-shell">
          <div class="hero-plate-top"><span>🇧🇷 BRASIL</span><span>BR</span></div>
          <input id="hero-plate" class="hero-plate-input" maxlength="8" autocomplete="off" placeholder="ABC1D23" inputmode="text" aria-label="Digite a placa do veículo">
        </div>
        <button id="hero-consult-btn" class="hero-consult-btn" type="button" onclick="heroConsultar()">🔎 CONSULTAR VEÍCULO</button>
        <div id="hero-search-error" class="hero-search-error" aria-live="polite"></div>
        <div id="hero-status" class="hero-status"></div>
        <div id="hero-result" class="hero-result"></div>
      </div>

      <div class="hero-crlv-card">
        <div class="hero-crlv-tag">📄 SÃO PAULO</div>
        <div class="hero-card-head"><span>📄</span><div><b>Emissão de CRLV-e SP</b><small>Solicitação privada online</small></div></div>
        <p>Solicite o CRLV-e em PDF para veículo registrado no Estado de São Paulo.</p>
        <div class="hero-crlv-features">
          <span>✅ Documento em PDF</span>
          <span>🔐 Fluxo protegido</span>
          <span>⚡ Processo online</span>
        </div>
        <div class="hero-crlv-price">R$ 59,90 <small>serviço privado de emissão/assessoria</small></div>
        <button class="hero-crlv-btn" type="button" onclick="abrirFluxoCRLV()">📄 EMITIR CRLV-e SP</button>
        <div class="hero-crlv-note">Não somos DETRAN-SP, SENATRAN ou GOV.BR. O valor refere-se ao serviço privado prestado.</div>
      </div>
    </div>

    <div class="main-trust-row">
      <span>⚡ Consulta rápida</span><span>🔒 Dados protegidos</span><span>📄 Relatório em PDF</span>
    </div>

    <div class="main-legal">Serviço privado e independente. Não possuímos vínculo com DETRAN, SENATRAN ou outros órgãos públicos. <a href="termos.html">Termos</a> · <a href="privacidade.html">Privacidade</a> · <a href="contato.html">Suporte</a></div>
  </div>
</section>
<script>
(function(){
  function normalizarHero(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7)}
  function placaHeroValida(v){return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(v)||/^[A-Z]{3}[0-9]{4}$/.test(v)}
  function copyOriginalToHero(){
    var originalResult=document.getElementById('result');
    var originalStatus=document.getElementById('status');
    var heroResult=document.getElementById('hero-result');
    var heroStatus=document.getElementById('hero-status');
    if(heroStatus&&originalStatus) heroStatus.innerHTML=originalStatus.innerHTML;
    if(heroResult&&originalResult){
      heroResult.innerHTML=originalResult.innerHTML;
      heroResult.classList.toggle('has-content',!!originalResult.innerHTML.trim());
    }
  }

  window.heroConsultar=async function(){
    var input=document.getElementById('hero-plate');
    var error=document.getElementById('hero-search-error');
    var btn=document.getElementById('hero-consult-btn');
    var plate=normalizarHero(input&&input.value);
    if(input) input.value=plate;
    if(!placaHeroValida(plate)){if(error)error.textContent='Digite uma placa válida, como ABC1D23.';return;}
    if(error)error.textContent='';
    var original=document.getElementById('plate');
    if(!original||typeof window.consultar!=='function'){if(error)error.textContent='A consulta está temporariamente indisponível.';return;}
    original.value=plate;
    if(btn){btn.disabled=true;btn.textContent='CONSULTANDO...';}
    try{
      await window.consultar();
      copyOriginalToHero();
    }catch(e){if(error)error.textContent='Não foi possível iniciar a consulta.';}
    finally{if(btn){btn.disabled=false;btn.textContent='🔎 CONSULTAR VEÍCULO';}}
  };

  window.addEventListener('DOMContentLoaded',function(){
    var heroInput=document.getElementById('hero-plate');
    if(heroInput){
      heroInput.addEventListener('input',function(e){e.target.value=normalizarHero(e.target.value)});
      heroInput.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();window.heroConsultar();}});
    }

    var originalResult=document.getElementById('result');
    var originalStatus=document.getElementById('status');
    if(originalResult){new MutationObserver(copyOriginalToHero).observe(originalResult,{childList:true,subtree:true,attributes:true,characterData:true});}
    if(originalStatus){new MutationObserver(copyOriginalToHero).observe(originalStatus,{childList:true,subtree:true,attributes:true,characterData:true});}

    if(typeof window.irParaRelatorio==='function'){
      window.irParaRelatorio=function(){
        if(typeof window.fecharPix==='function') window.fecharPix();
        copyOriginalToHero();
        var r=document.getElementById('hero-result');
        if(r) setTimeout(function(){r.scrollIntoView({behavior:'smooth',block:'start'})},80);
      };
    }
  });
})();
</script>`;

const THEME_CSS = `
<style id="professional-background-theme">
html,body{margin:0;min-height:100%;background:#040812!important;color:#fff}
body{overflow-x:hidden!important}
body > .wrap{display:none!important}
.main-visual-hero{
  min-height:100svh;
  position:relative;
  isolation:isolate;
  background-image:url('ChatGPT%20Image%2016%20de%20set.%20de%202026,%2010_58_27.png?v=5');
  background-size:cover;
  background-position:center top;
  background-repeat:no-repeat;
  padding:24px 18px 34px;
}
.main-visual-overlay{position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,rgba(2,6,12,.18) 0%,rgba(2,6,12,.38) 42%,rgba(2,6,12,.82) 72%,#040812 100%)}
.main-shell{width:min(1180px,100%);margin:auto}
.main-brand{display:flex;align-items:center;gap:10px;font-weight:900;font-size:18px;text-shadow:0 2px 14px #000}.main-brand-icon{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:linear-gradient(135deg,#168fff,#0b4eaa);box-shadow:0 10px 30px #006ee855}.main-brand em{margin-left:auto;font-style:normal;font-size:11px;color:#c7d7e8;border:1px solid #426586;background:#07111dcc;padding:7px 10px;border-radius:999px}
.main-hero-copy{text-align:center;max-width:760px;margin:90px auto 28px;text-shadow:0 3px 18px #000}.main-kicker{display:inline-flex;padding:7px 11px;border-radius:999px;background:#081522c9;border:1px solid #315675;font-size:12px;font-weight:800;color:#cfe3f7}.main-hero-copy h1{font-size:clamp(34px,6vw,62px);line-height:1.02;letter-spacing:-2px;margin:15px 0 12px}.main-hero-copy p{margin:auto;max-width:640px;color:#c4d0dd;font-size:15px;line-height:1.55}
.main-service-grid{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(330px,.92fr);gap:18px;align-items:start;margin:0 auto;max-width:1000px}
.hero-search-card,.hero-crlv-card{background:rgba(5,13,23,.88);border:1px solid rgba(72,139,201,.52);border-radius:22px;padding:20px;box-shadow:0 24px 70px rgba(0,0,0,.58);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.hero-card-head{display:flex;align-items:center;gap:11px;margin-bottom:14px}.hero-card-head>span{width:40px;height:40px;display:grid;place-items:center;border-radius:12px;background:#10263b;border:1px solid #315777;font-size:20px}.hero-card-head b{display:block;font-size:18px}.hero-card-head small{display:block;color:#90a6bb;font-size:11px;margin-top:3px}
.hero-plate-shell{overflow:hidden;border:2px solid #d7dce2;border-radius:14px;background:#eef1f4;box-shadow:0 12px 35px rgba(0,0,0,.45)}.hero-plate-top{height:25px;background:#1556a6;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 13px;font-size:10px;font-weight:900}.hero-plate-input{width:100%;border:0;outline:0;background:#f4f5f6;color:#10151d;text-align:center;font-size:clamp(29px,5vw,38px);font-weight:950;letter-spacing:5px;text-transform:uppercase;padding:13px 10px;box-sizing:border-box}
.hero-consult-btn,.hero-crlv-btn{width:100%;margin-top:12px;padding:16px 18px;border:0;border-radius:13px;color:#fff;font-size:14px;font-weight:950;cursor:pointer}.hero-consult-btn{background:linear-gradient(135deg,#168fff,#0567d7);box-shadow:0 14px 34px rgba(0,116,255,.32)}.hero-crlv-btn{background:linear-gradient(135deg,#2479d8,#15509b);box-shadow:0 14px 34px rgba(23,98,184,.28)}.hero-consult-btn:disabled{opacity:.6;cursor:not-allowed}
.hero-search-error{min-height:16px;margin-top:8px;text-align:center;color:#ffb7c0;font-size:11px;font-weight:700}.hero-status{margin-top:10px}.hero-result{margin-top:10px}.hero-result.has-content{padding-top:4px}
.hero-result .vehicle-card,.hero-result .unlock,.hero-result .row,.hero-status .error,.hero-status .loading,.hero-result .success{font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}.hero-result .vehicle-card{border:1px solid #2b3a4f;border-radius:16px;background:linear-gradient(145deg,#142132,#0b121d);padding:16px;margin:12px 0}.hero-result .vehicle-top{display:flex;align-items:center;justify-content:space-between;gap:10px}.hero-result .vehicle-title{display:flex;align-items:center;gap:9px}.hero-result .vehicle-title h2{font-size:17px;margin:0}.hero-result .found,.hero-result .paid-badge{font-size:9px;font-weight:900;color:#5ce59a;background:#0e2b1d;border:1px solid #1c5737;padding:5px 7px;border-radius:999px}.hero-result .plate-result{font-size:25px;font-weight:900;letter-spacing:3px;margin:14px 0 4px}.hero-result .vehicle-name{color:#aab6c6;font-size:13px}.hero-result .row{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #202b3b;padding:11px 2px;gap:16px}.hero-result .label{color:#8f9bad;font-size:12px}.hero-result .value{font-size:12px;font-weight:800;text-align:right}.hero-result .locked{display:inline-flex;align-items:center;gap:7px;color:#778598}.hero-result .blurbar{width:80px;height:11px;border-radius:4px;background:linear-gradient(90deg,#465366,#253043,#465366);filter:blur(2px)}.hero-result .unlock{margin-top:14px;padding:20px 16px;border:1px solid #226843;border-radius:16px;background:radial-gradient(circle at 50% 0,#123424,#0b1712 60%,#09100d);text-align:center}.hero-result .unlock h3{margin:7px 0 5px;font-size:19px}.hero-result .unlock p{margin:0;color:#91a49a;font-size:12px;line-height:1.5}.hero-result .price{font-size:32px;font-weight:950;margin:12px 0 1px}.hero-result .price small{font-size:10px;color:#7e9187}.hero-result .paybtn{width:100%;margin-top:12px;padding:15px;border:0;border-radius:12px;background:linear-gradient(135deg,#2ac978,#12864d);color:#fff;font-size:13px;font-weight:900;cursor:pointer}.hero-result .secure,.hero-result .pdf-feature{font-size:10px;color:#8aa394;margin-top:8px}.hero-result .pdf-feature{padding:10px;border:1px solid #294939;border-radius:10px;background:#0a1710}.hero-result .report-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:14px}.hero-result .secondary-btn{width:100%;padding:13px;border:1px solid #32465f!important;background:#0b1521!important;color:#c4cfdb!important;border-radius:11px}.hero-status .error,.hero-result .success{padding:12px;border-radius:11px;font-size:12px}.hero-status .error{background:#351218;border:1px solid #7d2937;color:#ffc0c8}.hero-result .success{background:#0d2b1d;border:1px solid #236c46;color:#91efba}.hero-status .loading{display:flex;align-items:center;gap:8px;color:#c0ccda;font-size:12px}.hero-status .spinner{width:16px;height:16px;border:2px solid #39475b;border-top-color:#ff3c55;border-radius:50%;animation:heroSpin .8s linear infinite}@keyframes heroSpin{to{transform:rotate(360deg)}}
.hero-crlv-tag{display:inline-block;padding:6px 9px;border-radius:999px;background:#123c70;border:1px solid #2867aa;color:#bcdcff;font-size:10px;font-weight:900;margin-bottom:12px}.hero-crlv-card p{color:#aebdce;font-size:12px;line-height:1.55;margin:0}.hero-crlv-features{display:grid;gap:7px;margin:15px 0}.hero-crlv-features span{padding:10px 11px;border:1px solid #28435f;border-radius:10px;background:#0a1827;color:#c0cfde;font-size:11px}.hero-crlv-price{font-size:34px;font-weight:950;margin-top:15px}.hero-crlv-price small{display:block;font-size:10px;color:#8999ab;font-weight:700;margin-top:3px}.hero-crlv-note{margin-top:12px;padding:10px;border:1px solid #2b4058;border-radius:10px;background:#09131f;color:#7f91a5;font-size:9px;line-height:1.5}
.main-trust-row{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;max-width:760px;margin:18px auto 0}.main-trust-row span{text-align:center;padding:10px;border:1px solid rgba(59,100,139,.55);border-radius:11px;background:rgba(7,17,29,.78);font-size:11px;color:#c6d4e2}.main-legal{max-width:900px;margin:17px auto 0;text-align:center;color:#8292a4;font-size:10px;line-height:1.55}.main-legal a{color:#a9bed2;text-decoration:none}
@media(max-width:860px){.main-service-grid{grid-template-columns:1fr}.main-hero-copy{margin-top:64px}.main-brand em{display:none}}
@media(max-width:650px){.main-visual-hero{padding:16px 10px 26px;background-position:center top}.main-hero-copy{margin:48px auto 20px}.main-hero-copy h1{letter-spacing:-1.2px}.main-service-grid{gap:13px}.hero-search-card,.hero-crlv-card{padding:15px;border-radius:18px}.main-trust-row{grid-template-columns:1fr}.hero-result .report-actions{grid-template-columns:1fr}.hero-result .vehicle-top{align-items:flex-start;flex-direction:column}}
@media print{body>.wrap{display:block!important}.main-visual-hero{display:none!important}}
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
      if (!html.includes('id="professional-background-theme"')) html = html.replace('</head>', `${THEME_CSS}\n</head>`);
      if (!html.includes('id="main-visual-hero-live"')) html = html.replace('<body>', `<body>\n${HERO_HTML}`);
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
    env: { ...process.env, PORT: String(APP_PORT), INTERNAL_APP_PORT: String(ORDERS_INTERNAL_PORT) },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc']
  });

  child.on('exit', code => {
    console.error(`THEME_PROXY: aplicação interna encerrou (código ${code}).`);
    process.exit(code || 1);
  });

  try { await waitForPort(APP_PORT); }
  catch (err) { console.error('THEME_PROXY:', err.message); process.exit(1); }

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) return serveThemedHtml(req, res);
    return proxyStream(req, res);
  });

  server.listen(PUBLIC_PORT, () => console.log(`Tema profissional ativo na porta ${PUBLIC_PORT}`));
}

start();
