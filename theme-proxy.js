const http = require('http');
const net = require('net');
const { fork } = require('child_process');

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const APP_PORT = Number(process.env.THEME_INTERNAL_PORT || 10001);
const ORDERS_INTERNAL_PORT = Number(process.env.INTERNAL_APP_PORT || 10002);
const MAX_HTML_BYTES = 2 * 1024 * 1024;

const CONSULT_UI = `
<section id="image-stage" class="image-stage" aria-label="Consulta veicular">
  <div class="image-artboard">
    <div class="image-live-form">
      <input id="image-plate" maxlength="8" autocomplete="off" inputmode="text" placeholder="Digite a placa do veículo" aria-label="Digite a placa do veículo">
      <button id="image-consult-btn" type="button" onclick="consultarPelaImagem()">🔎 CONSULTAR</button>
      <div id="image-consult-error" aria-live="polite"></div>
      <div id="image-result-panel"></div>
    </div>
  </div>

  <aside id="crlv-mini-card" class="crlv-mini-card" aria-label="Emissão de CRLV-e SP">
    <div class="crlv-mini-top">
      <span class="crlv-mini-tag">📄 SÃO PAULO</span>
      <button class="crlv-mini-toggle" type="button" onclick="alternarCrlvCard()" aria-label="Expandir ou recolher informações do CRLV-e">⌄</button>
    </div>
    <h2>Emissão de CRLV-e SP</h2>
    <p class="crlv-mini-lead">Solicitação privada para obtenção do CRLV-e em PDF de veículo registrado no Estado de São Paulo.</p>

    <div class="crlv-mini-body" id="crlv-mini-body">
      <div class="crlv-mini-features">
        <div>✅ <span><b>Documento em PDF</b><small>Pronto para salvar ou imprimir quando disponibilizado.</small></span></div>
        <div>🔐 <span><b>Solicitação protegida</b><small>Fluxo com validação de dados, autorização e finalidade.</small></span></div>
        <div>⚡ <span><b>Processo online</b><small>Inicie a solicitação diretamente pelo site.</small></span></div>
      </div>
      <div class="crlv-mini-price">R$ 59,90 <small>serviço privado de emissão/assessoria</small></div>
      <button class="crlv-mini-btn" type="button" onclick="abrirCrlvPeloTema()">📄 EMITIR CRLV-e SP</button>
      <div class="crlv-mini-note">Somente para proprietário do veículo ou pessoa com autorização legítima. Serviço privado e independente; não somos DETRAN-SP, SENATRAN ou GOV.BR.</div>
    </div>
  </aside>
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
      if(botao){botao.disabled=false;botao.textContent='🔎 CONSULTAR';}
    }
  };

  window.abrirCrlvPeloTema=function(){
    if(typeof window.abrirFluxoCRLV==='function'){
      window.abrirFluxoCRLV();
      return;
    }
    var fluxo=document.getElementById('crlvFlow');
    if(fluxo){
      fluxo.classList.remove('hidden');
      document.body.classList.add('no-scroll');
    }
  };

  window.alternarCrlvCard=function(){
    var card=document.getElementById('crlv-mini-card');
    if(card) card.classList.toggle('crlv-mini-collapsed');
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

    if(window.matchMedia&&window.matchMedia('(max-width:700px)').matches){
      var card=document.getElementById('crlv-mini-card');
      if(card) card.classList.add('crlv-mini-collapsed');
    }
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
body > .wrap{display:none!important}

.image-stage{
  position:fixed;
  inset:0;
  z-index:10;
  width:100vw;
  height:100vh;
  height:100dvh;
  overflow:hidden;
  background:#05080d;
  font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
}

.image-artboard{
  position:absolute;
  left:50%;
  top:50%;
  width:max(100vw,150dvh);
  aspect-ratio:3/2;
  transform:translate(-50%,-50%);
  background-image:url('ChatGPT%20Image%2016%20de%20set.%20de%202026,%2010_58_27.png?v=15');
  background-position:center center;
  background-size:100% 100%;
  background-repeat:no-repeat;
  background-color:#05080d;
}

.image-live-form{
  position:absolute;
  left:31.35%;
  top:35.15%;
  width:40.55%;
  height:6.85%;
  display:grid;
  grid-template-columns:60.8% 36.2%;
  column-gap:3%;
  align-items:stretch;
}
#image-plate{
  width:100%;
  height:100%;
  min-width:0;
  box-sizing:border-box;
  border:0;
  outline:0;
  border-radius:7px;
  background:#fff;
  color:#18202a;
  padding:0 clamp(10px,1.2vw,20px);
  text-transform:uppercase;
  font:700 clamp(13px,1.18vw,22px)/1 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
  box-shadow:none;
}
#image-plate::placeholder{color:#7f8792;text-transform:none;opacity:1}
#image-consult-btn{
  width:100%!important;
  height:100%;
  min-width:0;
  margin:0!important;
  padding:0 clamp(6px,1vw,16px)!important;
  border:0!important;
  border-radius:7px!important;
  background:linear-gradient(135deg,#149cff,#0873f2)!important;
  color:#fff!important;
  font:950 clamp(9px,1vw,18px)/1 Inter,system-ui,-apple-system,"Segoe UI",sans-serif!important;
  box-shadow:none!important;
  cursor:pointer;
  white-space:nowrap;
}
#image-consult-btn:disabled{opacity:.65;cursor:not-allowed}
#image-consult-error{
  position:absolute;
  left:0;
  right:0;
  top:112%;
  text-align:center;
  color:#ffd0d6;
  font:800 clamp(10px,.75vw,12px)/1.35 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
  text-shadow:0 2px 8px #000;
}
#image-result-panel{
  position:absolute;
  left:-8%;
  top:155%;
  width:116%;
  max-height:46vh;
  max-height:46dvh;
  overflow:auto;
  scrollbar-width:thin;
  overscroll-behavior:contain;
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

.crlv-mini-card{
  position:absolute;
  right:clamp(14px,2.2vw,34px);
  bottom:clamp(14px,2.6vh,30px);
  z-index:40;
  width:min(340px,27vw);
  padding:16px;
  border:1px solid rgba(67,142,220,.68);
  border-radius:18px;
  background:linear-gradient(180deg,rgba(12,31,52,.96),rgba(6,15,25,.97));
  color:#f3f8ff;
  box-shadow:0 22px 65px rgba(0,0,0,.58);
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
  box-sizing:border-box;
}
.crlv-mini-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.crlv-mini-tag{
  display:inline-flex;align-items:center;padding:5px 9px;border-radius:999px;
  border:1px solid #2867aa;background:#123c70;color:#cce7ff;font-size:10px;font-weight:900;
}
.crlv-mini-toggle{
  display:none;width:34px!important;height:30px!important;margin:0!important;padding:0!important;
  border:1px solid #345b83!important;border-radius:9px!important;background:#0c1b2b!important;
  color:#d5e9ff!important;box-shadow:none!important;font-size:18px!important;line-height:1!important;
}
.crlv-mini-card h2{margin:10px 0 6px;font-size:clamp(17px,1.55vw,24px);line-height:1.05}
.crlv-mini-lead{margin:0;color:#adbdcf;font-size:11px;line-height:1.45}
.crlv-mini-features{display:grid;gap:7px;margin:12px 0}
.crlv-mini-features>div{
  display:flex;align-items:flex-start;gap:7px;padding:8px 9px;border:1px solid #28435f;border-radius:10px;
  background:rgba(7,22,37,.85);font-size:11px;line-height:1.3;color:#bfd0e1;
}
.crlv-mini-features span{display:grid;gap:2px}
.crlv-mini-features b{color:#fff;font-size:11px}
.crlv-mini-features small{color:#8fa2b6;font-size:9px;line-height:1.35}
.crlv-mini-price{font-size:28px;font-weight:950;line-height:1;margin:10px 0 9px}
.crlv-mini-price small{display:block;margin-top:4px;color:#8fa2b6;font-size:9px;font-weight:700;line-height:1.3}
.crlv-mini-btn{
  width:100%!important;margin:0!important;padding:13px!important;border:0!important;border-radius:11px!important;
  background:linear-gradient(135deg,#2479d8,#15509b)!important;color:white!important;
  font-size:12px!important;font-weight:950!important;box-shadow:0 12px 30px rgba(23,98,184,.29)!important;cursor:pointer;
}
.crlv-mini-note{margin-top:9px;color:#788da3;font-size:8.5px;line-height:1.45;text-align:center}

body > .flow-overlay{z-index:99999!important}

@media(min-width:701px) and (max-width:1100px){
  .image-live-form{width:44%;left:29%}
  #image-plate{font-size:clamp(13px,1.7vw,19px)}
  #image-consult-btn{font-size:clamp(10px,1.35vw,15px)!important}
  #image-result-panel{left:-12%;width:124%;max-height:42dvh}
  .crlv-mini-card{width:min(300px,30vw);padding:13px;bottom:12px;right:12px}
  .crlv-mini-features>div:nth-child(2){display:none}
  .crlv-mini-price{font-size:24px}
}

@media(max-width:700px){
  .image-stage{height:100vh;height:100svh}
  .image-artboard{
    left:50%;top:0;width:150svh;min-width:100vw;height:100svh;aspect-ratio:auto;
    transform:translateX(-50%);background-size:cover;background-position:center top;
  }
  .image-live-form{
    left:50%;top:34.5%;width:min(90vw,520px);height:auto;transform:translateX(-50%);
    display:grid;grid-template-columns:1fr;gap:8px;padding:9px;border-radius:14px;
    background:rgba(3,9,17,.88);border:1px solid rgba(126,183,235,.55);
    box-shadow:0 16px 45px rgba(0,0,0,.58);box-sizing:border-box;
    backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);
  }
  #image-plate,#image-consult-btn{height:50px;min-height:50px}
  #image-plate{padding:0 12px;font-size:18px;text-align:center;border-radius:10px}
  #image-consult-btn{width:100%!important;font-size:14px!important;border-radius:10px!important}
  #image-consult-error{position:static;grid-column:1;margin-top:-2px;min-height:0;font-size:11px}
  #image-result-panel{position:static;grid-column:1;width:100%;max-height:31vh;max-height:31dvh}

  .crlv-mini-card{
    position:fixed;left:10px;right:10px;bottom:10px;width:auto;max-height:48svh;overflow:auto;
    padding:12px;border-radius:15px;
  }
  .crlv-mini-toggle{display:block}
  .crlv-mini-card h2{font-size:17px;margin:8px 0 4px}
  .crlv-mini-lead{font-size:10px}
  .crlv-mini-features{grid-template-columns:1fr;gap:5px;margin:9px 0}
  .crlv-mini-features>div{padding:7px 8px}
  .crlv-mini-price{font-size:23px;margin:8px 0}
  .crlv-mini-btn{padding:12px!important}
  .crlv-mini-note{font-size:8px}
  .crlv-mini-collapsed .crlv-mini-body{display:none}
  .crlv-mini-collapsed .crlv-mini-lead{display:none}
  .crlv-mini-collapsed h2{margin:6px 0 0}
  .crlv-mini-collapsed .crlv-mini-toggle{transform:rotate(180deg)}
}

@media(max-width:420px){
  .image-live-form{width:92vw;top:33.5%;padding:8px}
  #image-plate,#image-consult-btn{height:48px;min-height:48px}
  #image-plate{font-size:17px}
  #image-consult-btn{font-size:13px!important}
  #image-result-panel{max-height:29dvh}
  .crlv-mini-card{left:8px;right:8px;bottom:8px;padding:10px}
}

@media(max-height:540px) and (orientation:landscape){
  .image-live-form{
    top:31%;width:min(82vw,680px);grid-template-columns:minmax(0,1fr) 180px;padding:7px;gap:7px;
  }
  #image-plate,#image-consult-btn{height:46px;min-height:46px}
  #image-consult-error,#image-result-panel{grid-column:1/-1}
  #image-result-panel{max-height:27dvh}
  .crlv-mini-card{left:auto;right:8px;bottom:8px;width:250px;max-height:75vh}
  .crlv-mini-card h2{font-size:15px}
}

@media print{.image-stage{display:none!important}}
</style>`;

function waitForPort(port, timeoutMs = 25000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host:'127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if(Date.now()-start>=timeoutMs) reject(new Error('Aplicação interna não iniciou a tempo.'));
        else setTimeout(attempt,200);
      });
    };
    attempt();
  });
}

function proxyStream(req,res){
  const headers={...req.headers,host:`127.0.0.1:${APP_PORT}`};
  const upstream=http.request({hostname:'127.0.0.1',port:APP_PORT,path:req.url,method:req.method,headers},upstreamRes=>{
    res.writeHead(upstreamRes.statusCode||502,upstreamRes.headers);upstreamRes.pipe(res);
  });
  upstream.on('error',err=>{
    console.error('THEME_PROXY: erro no proxy:',err.message);
    if(!res.headersSent){res.writeHead(502,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'servico_indisponivel'}));}
  });
  req.pipe(upstream);
}

function serveThemedHtml(req,res){
  const headers={...req.headers,host:`127.0.0.1:${APP_PORT}`};
  const upstream=http.request({hostname:'127.0.0.1',port:APP_PORT,path:req.url,method:'GET',headers},upstreamRes=>{
    const type=String(upstreamRes.headers['content-type']||'');
    if(!type.includes('text/html')){res.writeHead(upstreamRes.statusCode||502,upstreamRes.headers);return upstreamRes.pipe(res);}
    const chunks=[];let size=0;
    upstreamRes.on('data',chunk=>{size+=chunk.length;if(size<=MAX_HTML_BYTES)chunks.push(chunk);});
    upstreamRes.on('end',()=>{
      if(size>MAX_HTML_BYTES){res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Página excedeu o limite de renderização.');}
      let html=Buffer.concat(chunks).toString('utf8');
      if(!html.includes('id="background-image-theme"')) html=html.replace('</head>',`${THEME_CSS}\n</head>`);
      if(!html.includes('id="image-stage"')) html=html.replace('<body>',`<body>\n${CONSULT_UI}`);
      const body=Buffer.from(html);
      const outHeaders={...upstreamRes.headers,'content-length':String(body.length),'cache-control':'no-store, no-cache, must-revalidate',pragma:'no-cache',expires:'0'};
      delete outHeaders['transfer-encoding'];
      res.writeHead(upstreamRes.statusCode||200,outHeaders);res.end(body);
    });
  });
  upstream.on('error',err=>{
    console.error('THEME_PROXY: erro ao carregar HTML:',err.message);
    if(!res.headersSent){res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8'});res.end('Serviço temporariamente indisponível.');}
  });
  upstream.end();
}

async function start(){
  const child=fork(require.resolve('./orders-proxy.js'),[],{env:{...process.env,PORT:String(APP_PORT),INTERNAL_APP_PORT:String(ORDERS_INTERNAL_PORT)},stdio:['inherit','inherit','inherit','ipc']});
  child.on('exit',code=>{console.error(`THEME_PROXY: aplicação interna encerrou (código ${code}).`);process.exit(code||1);});
  try{await waitForPort(APP_PORT);}catch(err){console.error('THEME_PROXY:',err.message);process.exit(1);}
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(req.method==='GET'&&(pathname==='/'||pathname==='/index.html')) return serveThemedHtml(req,res);
    return proxyStream(req,res);
  });
  server.listen(PUBLIC_PORT,()=>console.log(`Site responsivo com consulta veicular e CRLV-e SP na porta ${PUBLIC_PORT}`));
}

start();
