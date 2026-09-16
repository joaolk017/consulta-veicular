const http = require('http');
const net = require('net');
const { fork } = require('child_process');

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const APP_PORT = Number(process.env.THEME_INTERNAL_PORT || 10001);
const ORDERS_INTERNAL_PORT = Number(process.env.INTERNAL_APP_PORT || 10002);
const MAX_HTML_BYTES = 2 * 1024 * 1024;

const CONSULT_UI = `
<section id="image-consult-ui" class="image-consult-ui" aria-label="Consulta veicular">
  <div class="image-consult-box">
    <label for="image-plate">Digite a placa do veículo</label>
    <div class="image-consult-row">
      <input id="image-plate" maxlength="8" autocomplete="off" inputmode="text" placeholder="ABC1D23" aria-label="Digite a placa do veículo">
      <button id="image-consult-btn" type="button" onclick="consultarPelaImagem()">CONSULTAR VEÍCULO</button>
    </div>
    <div id="image-consult-error" aria-live="polite"></div>
    <div id="image-result-panel"></div>
  </div>
</section>
<script id="image-consult-script">
(function(){
  function normalizar(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7)}
  function valida(v){return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(v)||/^[A-Z]{3}[0-9]{4}$/.test(v)}

  window.consultarPelaImagem=async function(){
    var input=document.getElementById('image-plate');
    var erro=document.getElementById('image-consult-error');
    var botao=document.getElementById('image-consult-btn');
    var placa=normalizar(input&&input.value);
    if(input) input.value=placa;

    if(!valida(placa)){
      if(erro) erro.textContent='Digite uma placa válida, como ABC1D23.';
      return;
    }
    if(erro) erro.textContent='';

    var original=document.getElementById('plate');
    if(!original || typeof window.consultar!=='function'){
      if(erro) erro.textContent='A consulta está temporariamente indisponível.';
      return;
    }

    original.value=placa;
    if(botao){botao.disabled=true;botao.textContent='CONSULTANDO...';}
    try{
      await Promise.resolve(window.consultar());
    }catch(e){
      if(erro) erro.textContent='Não foi possível realizar a consulta agora.';
    }finally{
      if(botao){botao.disabled=false;botao.textContent='CONSULTAR VEÍCULO';}
    }
  };

  window.addEventListener('DOMContentLoaded',function(){
    var input=document.getElementById('image-plate');
    if(input){
      input.addEventListener('input',function(e){e.target.value=normalizar(e.target.value)});
      input.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();window.consultarPelaImagem();}});
    }

    var painel=document.getElementById('image-result-panel');
    var status=document.getElementById('status');
    var result=document.getElementById('result');
    if(painel&&status) painel.appendChild(status);
    if(painel&&result) painel.appendChild(result);
  });
})();
</script>`;

const THEME_CSS = `
<style id="background-image-theme">
html,body{
  width:100%;
  height:100%;
  min-height:100%;
  margin:0!important;
  padding:0!important;
  overflow:hidden!important;
  background:#05080d!important;
}

body::before{
  content:"";
  position:fixed;
  inset:0;
  width:100vw;
  height:100vh;
  height:100svh;
  background-image:url('ChatGPT%20Image%2016%20de%20set.%20de%202026,%2010_58_27.png?v=12');
  background-position:center top;
  background-size:cover;
  background-repeat:no-repeat;
  background-color:#05080d;
  z-index:0;
}

body > .wrap{display:none!important}

.image-consult-ui{
  position:fixed;
  inset:0;
  z-index:20;
  pointer-events:none;
  display:flex;
  justify-content:center;
  align-items:flex-end;
  padding:0 16px clamp(42px,8vh,92px);
  box-sizing:border-box;
}
.image-consult-box{
  width:min(92vw,620px);
  pointer-events:auto;
}
.image-consult-box>label{
  display:block;
  text-align:center;
  margin:0 0 9px;
  color:#fff;
  font:900 15px/1.2 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
  text-shadow:0 2px 10px #000,0 1px 2px #000;
}
.image-consult-row{
  display:grid;
  grid-template-columns:minmax(0,1fr) auto;
  gap:9px;
  padding:7px;
  border-radius:16px;
  background:rgba(3,9,17,.82);
  border:1px solid rgba(126,183,235,.55);
  box-shadow:0 18px 55px rgba(0,0,0,.55);
  backdrop-filter:blur(9px);
  -webkit-backdrop-filter:blur(9px);
}
#image-plate{
  min-width:0;
  height:54px;
  border:1px solid #d8e0e8;
  border-radius:11px;
  outline:0;
  background:#f5f7f9;
  color:#10151d;
  text-align:center;
  text-transform:uppercase;
  font:950 25px/1 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
  letter-spacing:4px;
  padding:0 12px;
  box-sizing:border-box;
}
#image-consult-btn{
  width:auto!important;
  min-width:185px;
  height:54px;
  margin:0!important;
  padding:0 18px!important;
  border:0!important;
  border-radius:11px!important;
  background:linear-gradient(135deg,#168fff,#0567d7)!important;
  color:#fff!important;
  font:950 12px/1 Inter,system-ui,-apple-system,"Segoe UI",sans-serif!important;
  box-shadow:0 10px 26px rgba(0,116,255,.35)!important;
  cursor:pointer;
}
#image-consult-btn:disabled{opacity:.6;cursor:not-allowed}
#image-consult-error{
  min-height:17px;
  margin-top:7px;
  text-align:center;
  color:#ffd1d6;
  font:800 11px/1.4 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
  text-shadow:0 2px 8px #000;
}
#image-result-panel{
  max-height:44vh;
  overflow:auto;
  scrollbar-width:thin;
}
#image-result-panel>#status:not(:empty),
#image-result-panel>#result:not(.hidden){
  margin-top:8px!important;
  padding:14px!important;
  border-radius:15px!important;
  background:rgba(5,12,20,.96)!important;
  border:1px solid rgba(65,116,165,.52)!important;
  box-shadow:0 18px 45px rgba(0,0,0,.55)!important;
}

/* Fluxos de pagamento permanecem disponíveis quando acionados */
body > .flow-overlay{z-index:99999!important}

@media(max-width:650px){
  body::before{background-position:center top;background-size:cover}
  .image-consult-ui{padding:0 11px 24px}
  .image-consult-box{width:100%}
  .image-consult-row{grid-template-columns:1fr;gap:7px}
  #image-plate{height:50px;font-size:23px}
  #image-consult-btn{width:100%!important;min-width:0;height:50px}
  #image-result-panel{max-height:38vh}
}

@media print{
  .image-consult-ui{display:none!important}
  body::before{display:block!important}
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
      if(!html.includes('id="image-consult-ui"')) html=html.replace('<body>', `<body>\n${CONSULT_UI}`);
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
  server.listen(PUBLIC_PORT,()=>console.log(`Consulta de placa integrada à imagem inicial na porta ${PUBLIC_PORT}`));
}

start();
