const http = require('http');
const net = require('net');
const { fork } = require('child_process');

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const APP_PORT = Number(process.env.THEME_INTERNAL_PORT || 10001);
const ORDERS_INTERNAL_PORT = Number(process.env.INTERNAL_APP_PORT || 10002);
const MAX_HTML_BYTES = 2 * 1024 * 1024;

const CONSULT_UI = `
<section id="image-stage" class="image-stage" aria-label="Consulta veicular">
  <div class="image-live-form">
    <input id="image-plate" maxlength="8" autocomplete="off" inputmode="text" placeholder="Digite a placa do veículo" aria-label="Digite a placa do veículo">
    <button id="image-consult-btn" type="button" onclick="consultarPelaImagem()">🔎 CONSULTAR</button>
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
      if(botao){botao.disabled=false;botao.textContent='🔎 CONSULTAR';}
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
  width:100%;height:100%;min-height:100%;margin:0!important;padding:0!important;
  overflow:hidden!important;background:#05080d!important;
}
body > .wrap{display:none!important}
.image-stage{
  position:fixed;inset:0;z-index:10;width:100vw;height:100vh;height:100svh;
  background-image:url('ChatGPT%20Image%2016%20de%20set.%20de%202026,%2010_58_27.png?v=13');
  background-position:center center;background-size:100% 100%;background-repeat:no-repeat;background-color:#05080d;
  font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
}
/* O formulário vivo ocupa exatamente o campo e o botão já desenhados na imagem. */
.image-live-form{
  position:absolute;left:31.35%;top:35.15%;width:40.55%;height:6.85%;
  display:grid;grid-template-columns:60.8% 36.2%;column-gap:3%;align-items:stretch;
}
#image-plate{
  width:100%;height:100%;min-width:0;box-sizing:border-box;border:0;outline:0;
  border-radius:7px;background:#fff;color:#18202a;padding:0 18px;
  text-transform:uppercase;font:700 clamp(14px,1.25vw,22px)/1 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
  box-shadow:none;
}
#image-plate::placeholder{color:#7f8792;text-transform:none;opacity:1}
#image-consult-btn{
  width:100%!important;height:100%;min-width:0;margin:0!important;padding:0 10px!important;
  border:0!important;border-radius:7px!important;background:linear-gradient(135deg,#149cff,#0873f2)!important;
  color:#fff!important;font:950 clamp(10px,1.05vw,18px)/1 Inter,system-ui,-apple-system,"Segoe UI",sans-serif!important;
  box-shadow:none!important;cursor:pointer;white-space:nowrap;
}
#image-consult-btn:disabled{opacity:.65;cursor:not-allowed}
#image-consult-error{
  position:absolute;left:0;right:0;top:112%;text-align:center;color:#ffd0d6;
  font:800 clamp(10px,.75vw,12px)/1.35 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
  text-shadow:0 2px 8px #000;
}
#image-result-panel{
  position:absolute;left:-8%;top:155%;width:116%;max-height:46vh;overflow:auto;scrollbar-width:thin;
}
#image-result-panel>#status:not(:empty),#image-result-panel>#result:not(.hidden){
  margin-top:8px!important;padding:14px!important;border-radius:15px!important;
  background:rgba(5,12,20,.96)!important;border:1px solid rgba(65,116,165,.52)!important;
  box-shadow:0 18px 45px rgba(0,0,0,.55)!important;
}
body > .flow-overlay{z-index:99999!important}

@media(max-width:700px){
  .image-stage{background-size:cover;background-position:center top}
  .image-live-form{
    left:8%;top:36%;width:84%;height:auto;display:grid;grid-template-columns:1fr;gap:8px;
    padding:8px;border-radius:14px;background:rgba(3,9,17,.82);border:1px solid rgba(126,183,235,.5);
    box-shadow:0 16px 45px rgba(0,0,0,.5);box-sizing:border-box;
  }
  #image-plate,#image-consult-btn{height:50px}
  #image-plate{font-size:20px;border-radius:10px}
  #image-consult-btn{font-size:14px;border-radius:10px!important}
  #image-consult-error{position:static;grid-column:1;margin-top:-2px;min-height:0}
  #image-result-panel{position:static;grid-column:1;width:100%;max-height:37vh}
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
  server.listen(PUBLIC_PORT,()=>console.log(`Consulta integrada ao campo da imagem inicial na porta ${PUBLIC_PORT}`));
}

start();
