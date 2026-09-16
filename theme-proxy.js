const http = require('http');
const net = require('net');
const { fork } = require('child_process');

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const APP_PORT = Number(process.env.THEME_INTERNAL_PORT || 10001);
const ORDERS_INTERNAL_PORT = Number(process.env.INTERNAL_APP_PORT || 10002);
const MAX_HTML_BYTES = 2 * 1024 * 1024;

const CONSULT_HTML = `
<section id="background-consult-live" class="background-consult" aria-label="Consulta de placa">
  <div class="background-consult-inner">
    <div class="background-plate-shell">
      <div class="background-plate-top"><span>🇧🇷 BRASIL</span><span>BR</span></div>
      <input id="background-plate" maxlength="8" autocomplete="off" placeholder="ABC1D23" inputmode="text" aria-label="Digite a placa do veículo">
    </div>
    <button id="background-consult-btn" type="button" onclick="backgroundConsultar()">🔎 CONSULTAR VEÍCULO</button>
    <div id="background-consult-error" class="background-consult-error" aria-live="polite"></div>
    <div id="background-status"></div>
    <div id="background-result"></div>
  </div>
</section>
<script id="background-consult-script">
(function(){
  function normalizar(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7)}
  function valida(v){return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(v)||/^[A-Z]{3}[0-9]{4}$/.test(v)}

  function copiarResultado(){
    var originalStatus=document.getElementById('status');
    var originalResult=document.getElementById('result');
    var novoStatus=document.getElementById('background-status');
    var novoResult=document.getElementById('background-result');
    if(novoStatus&&originalStatus) novoStatus.innerHTML=originalStatus.innerHTML;
    if(novoResult&&originalResult){
      novoResult.innerHTML=originalResult.innerHTML;
      novoResult.className=originalResult.className.replace(/\\bhidden\\b/g,'').trim();
    }
  }

  window.backgroundConsultar=async function(){
    var input=document.getElementById('background-plate');
    var erro=document.getElementById('background-consult-error');
    var btn=document.getElementById('background-consult-btn');
    var placa=normalizar(input&&input.value);
    if(input) input.value=placa;
    if(!valida(placa)){
      if(erro) erro.textContent='Digite uma placa válida, como ABC1D23.';
      return;
    }
    if(erro) erro.textContent='';

    var original=document.getElementById('plate');
    if(!original){
      if(erro) erro.textContent='A consulta está temporariamente indisponível.';
      return;
    }
    original.value=placa;

    if(btn){btn.disabled=true;btn.textContent='CONSULTANDO...';}
    try{
      if(typeof window.consultar==='function') await window.consultar();
      else {
        var oldBtn=document.getElementById('btn');
        if(oldBtn) oldBtn.click();
        else throw new Error('consulta_indisponivel');
      }
      copiarResultado();
    }catch(e){
      if(erro) erro.textContent='Não foi possível iniciar a consulta.';
    }finally{
      if(btn){btn.disabled=false;btn.textContent='🔎 CONSULTAR VEÍCULO';}
    }
  };

  window.addEventListener('DOMContentLoaded',function(){
    var input=document.getElementById('background-plate');
    if(input){
      input.addEventListener('input',function(e){e.target.value=normalizar(e.target.value)});
      input.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();window.backgroundConsultar();}});
    }
    var originalStatus=document.getElementById('status');
    var originalResult=document.getElementById('result');
    if(originalStatus) new MutationObserver(copiarResultado).observe(originalStatus,{childList:true,subtree:true,attributes:true,characterData:true});
    if(originalResult) new MutationObserver(copiarResultado).observe(originalResult,{childList:true,subtree:true,attributes:true,characterData:true});
  });
})();
</script>`;

const THEME_CSS = `
<style id="background-image-theme">
html,body{min-height:100%}
body{
  margin:0!important;
  background-color:#05080d!important;
  background-image:
    linear-gradient(180deg,rgba(3,7,13,.04) 0%,rgba(3,7,13,.10) 46%,rgba(3,7,13,.58) 76%,#05080d 100%),
    url('ChatGPT%20Image%2016%20de%20set.%20de%202026,%2010_58_27.png?v=8')!important;
  background-position:center top,center top!important;
  background-size:cover,cover!important;
  background-repeat:no-repeat,no-repeat!important;
  background-attachment:fixed,fixed!important;
  color:#f7f9fc;
  overflow-x:hidden;
}

.background-consult{
  min-height:100svh;
  display:flex;
  align-items:flex-end;
  justify-content:center;
  padding:28px 18px 46px;
  position:relative;
  z-index:2;
}
.background-consult-inner{width:min(100%,560px)}
.background-plate-shell{
  overflow:hidden;
  border:2px solid #eef3f7;
  border-radius:15px;
  background:#eef1f4;
  box-shadow:0 20px 55px rgba(0,0,0,.64),0 0 0 1px rgba(255,255,255,.08);
}
.background-plate-top{
  height:27px;
  background:#1556a6;
  color:white;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:0 13px;
  font-size:10px;
  font-weight:900;
}
#background-plate{
  width:100%;
  border:0;
  outline:0;
  background:#f4f5f6;
  color:#10151d;
  text-align:center;
  font-size:clamp(30px,6vw,40px);
  font-weight:950;
  letter-spacing:5px;
  text-transform:uppercase;
  padding:15px 10px;
  box-sizing:border-box;
}
#background-consult-btn{
  width:100%;
  margin-top:13px;
  min-height:58px;
  border:1px solid rgba(125,194,255,.68);
  border-radius:13px;
  background:linear-gradient(135deg,#168fff,#0567d7);
  color:#fff;
  font-size:15px;
  font-weight:950;
  cursor:pointer;
  box-shadow:0 16px 38px rgba(0,116,255,.38);
}
#background-consult-btn:disabled{opacity:.6;cursor:not-allowed}
.background-consult-error{min-height:18px;margin-top:8px;text-align:center;color:#ffb7c0;font-size:12px;font-weight:800;text-shadow:0 2px 8px #000}
#background-status:not(:empty),#background-result:not(:empty){
  margin-top:14px;
  padding:16px;
  border-radius:18px;
  background:rgba(5,12,20,.94);
  border:1px solid rgba(65,116,165,.52);
  box-shadow:0 20px 60px rgba(0,0,0,.54);
  backdrop-filter:blur(10px);
  -webkit-backdrop-filter:blur(10px);
}

body > .wrap{
  display:block!important;
  position:relative;
  z-index:1;
  padding-top:0!important;
}
.top,.hero,.private-notice{display:none!important}

/* remove apenas a consulta antiga da parte de baixo */
.services-grid{
  grid-template-columns:1fr!important;
  max-width:620px;
  margin-left:auto!important;
  margin-right:auto!important;
}
.services-grid > main.card{display:none!important}
.services-grid > .crlv{
  width:100%;
  position:relative!important;
  top:auto!important;
  background:rgba(7,20,35,.92)!important;
  backdrop-filter:blur(12px)!important;
  -webkit-backdrop-filter:blur(12px)!important;
}
.details-panel,.benefit{
  background-color:rgba(7,13,22,.92)!important;
  backdrop-filter:blur(8px);
  -webkit-backdrop-filter:blur(8px);
}

@media(max-width:650px){
  body{
    background-attachment:scroll,scroll!important;
    background-position:center top,center top!important;
    background-size:auto 100vh,auto 100vh!important;
  }
  .background-consult{min-height:100svh;padding:20px 14px 28px}
  #background-plate{font-size:31px;padding:13px 8px}
  #background-consult-btn{min-height:54px;font-size:14px}
}

@media print{body{background:#fff!important}.background-consult{display:none!important}}
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
  const upstream = http.request({ hostname:'127.0.0.1', port:APP_PORT, path:req.url, method:req.method, headers }, upstreamRes => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on('error', err => {
    console.error('THEME_PROXY: erro no proxy:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type':'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error:'servico_indisponivel' }));
    }
  });
  req.pipe(upstream);
}

function serveThemedHtml(req, res) {
  const headers = { ...req.headers, host:`127.0.0.1:${APP_PORT}` };
  const upstream = http.request({ hostname:'127.0.0.1', port:APP_PORT, path:req.url, method:'GET', headers }, upstreamRes => {
    const type = String(upstreamRes.headers['content-type'] || '');
    if (!type.includes('text/html')) {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      return upstreamRes.pipe(res);
    }
    const chunks=[];
    let size=0;
    upstreamRes.on('data', chunk => { size += chunk.length; if(size <= MAX_HTML_BYTES) chunks.push(chunk); });
    upstreamRes.on('end', () => {
      if (size > MAX_HTML_BYTES) {
        res.writeHead(502, { 'Content-Type':'text/plain; charset=utf-8' });
        return res.end('Página excedeu o limite de renderização.');
      }
      let html=Buffer.concat(chunks).toString('utf8');
      if(!html.includes('id="background-image-theme"')) html=html.replace('</head>', `${THEME_CSS}\n</head>`);
      if(!html.includes('id="background-consult-live"')) html=html.replace('<body>', `<body>\n${CONSULT_HTML}`);
      const body=Buffer.from(html);
      const outHeaders={...upstreamRes.headers,'content-length':String(body.length),'cache-control':'no-store, no-cache, must-revalidate',pragma:'no-cache',expires:'0'};
      delete outHeaders['transfer-encoding'];
      res.writeHead(upstreamRes.statusCode || 200, outHeaders);
      res.end(body);
    });
  });
  upstream.on('error', err => {
    console.error('THEME_PROXY: erro ao carregar HTML:', err.message);
    if(!res.headersSent){res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8'});res.end('Serviço temporariamente indisponível.');}
  });
  upstream.end();
}

async function start() {
  const child = fork(require.resolve('./orders-proxy.js'), [], {
    env:{...process.env,PORT:String(APP_PORT),INTERNAL_APP_PORT:String(ORDERS_INTERNAL_PORT)},
    stdio:['inherit','inherit','inherit','ipc']
  });
  child.on('exit', code => { console.error(`THEME_PROXY: aplicação interna encerrou (código ${code}).`); process.exit(code || 1); });
  try { await waitForPort(APP_PORT); } catch(err) { console.error('THEME_PROXY:',err.message); process.exit(1); }
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(req.method==='GET'&&(pathname==='/'||pathname==='/index.html')) return serveThemedHtml(req,res);
    return proxyStream(req,res);
  });
  server.listen(PUBLIC_PORT,()=>console.log(`Consulta na imagem de fundo ativa na porta ${PUBLIC_PORT}`));
}

start();
