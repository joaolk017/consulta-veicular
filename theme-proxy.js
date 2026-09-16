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
    <a class="theme-hotspot hs-home" href="/" aria-label="Início"></a>
    <button class="theme-hotspot hs-como" type="button" onclick="abrirInfoTema('como')" aria-label="Como funciona"></button>
    <button class="theme-hotspot hs-consultas" type="button" onclick="abrirInfoTema('consultas')" aria-label="O que você consulta"></button>
    <a class="theme-hotspot hs-contato" href="/contato.html" aria-label="Contato"></a>
    <button class="theme-hotspot hs-conta" type="button" onclick="abrirInfoTema('conta')" aria-label="Minha conta"></button>

    <div class="desktop-live-form">
      <input id="desktop-plate" maxlength="8" autocomplete="off" inputmode="text" placeholder="Digite a placa do veículo" aria-label="Digite a placa do veículo">
      <button id="desktop-consult-btn" type="button" onclick="consultarPelaImagem('desktop')">CONSULTAR AGORA →</button>
      <div id="desktop-consult-error" class="consult-error" aria-live="polite"></div>
    </div>

    <button class="crlv-art-button" type="button" onclick="abrirCrlvPeloTema()" aria-label="Emitir CRLV-e SP"></button>
  </div>

  <div class="mobile-actions" aria-label="Ações principais">
    <input id="mobile-plate" maxlength="8" autocomplete="off" inputmode="text" placeholder="Digite a placa do veículo" aria-label="Digite a placa do veículo">
    <button id="mobile-consult-btn" type="button" onclick="consultarPelaImagem('mobile')">🔎 CONSULTAR AGORA</button>
    <button class="mobile-crlv-btn" type="button" onclick="abrirCrlvPeloTema()">📄 EMITIR CRLV-e SP</button>
    <div id="mobile-consult-error" class="consult-error" aria-live="polite"></div>
  </div>

  <div id="image-result-panel"></div>

  <div id="theme-info" class="theme-info hidden" role="dialog" aria-modal="true" aria-labelledby="theme-info-title">
    <div class="theme-info-card">
      <button class="theme-info-close" type="button" onclick="fecharInfoTema()" aria-label="Fechar">✕</button>
      <h2 id="theme-info-title">Informações</h2>
      <div id="theme-info-body"></div>
    </div>
  </div>
</section>

<script id="image-consult-script">
(function(){
  function normalizar(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7)}
  function valida(v){return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(v)||/^[A-Z]{3}[0-9]{4}$/.test(v)}

  function ids(modo){
    return modo==='mobile'
      ? {input:'mobile-plate',botao:'mobile-consult-btn',erro:'mobile-consult-error'}
      : {input:'desktop-plate',botao:'desktop-consult-btn',erro:'desktop-consult-error'};
  }

  window.consultarPelaImagem=async function(modo){
    var ref=ids(modo);
    var input=document.getElementById(ref.input);
    var erro=document.getElementById(ref.erro);
    var botao=document.getElementById(ref.botao);
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
      if(botao){
        botao.disabled=false;
        botao.textContent=modo==='mobile'?'🔎 CONSULTAR AGORA':'CONSULTAR AGORA →';
      }
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

  window.abrirInfoTema=function(tipo){
    var overlay=document.getElementById('theme-info');
    var titulo=document.getElementById('theme-info-title');
    var body=document.getElementById('theme-info-body');
    if(!overlay||!titulo||!body) return;

    if(tipo==='como'){
      titulo.textContent='Como funciona';
      body.innerHTML='<p>Digite a placa, consulte os dados disponíveis e, quando houver informações adicionais, desbloqueie o relatório completo pelo fluxo de pagamento do site.</p>';
    }else if(tipo==='consultas'){
      titulo.textContent='O que você pode consultar';
      body.innerHTML='<p>Roubo e furto, leilão, multas, gravame, recall, histórico veicular e outras informações quando disponibilizadas pelas fontes integradas.</p>';
    }else{
      titulo.textContent='Área do cliente';
      body.innerHTML='<p>A área de conta ainda não está disponível. Para suporte, use a página de contato.</p><p><a href="/contato.html">Ir para o suporte</a></p>';
    }
    overlay.classList.remove('hidden');
  };

  window.fecharInfoTema=function(){
    var overlay=document.getElementById('theme-info');
    if(overlay) overlay.classList.add('hidden');
  };

  window.addEventListener('DOMContentLoaded',function(){
    ['desktop-plate','mobile-plate'].forEach(function(id){
      var input=document.getElementById(id);
      if(!input) return;
      input.addEventListener('input',function(e){e.target.value=normalizar(e.target.value)});
      input.addEventListener('keydown',function(e){
        if(e.key==='Enter'){
          e.preventDefault();
          window.consultarPelaImagem(id==='mobile-plate'?'mobile':'desktop');
        }
      });
    });

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
  width:100%;height:100%;min-height:100%;
  margin:0!important;padding:0!important;overflow:hidden!important;
  background:#030812!important;
}
body > .wrap{display:none!important}

.image-stage{
  position:fixed;inset:0;z-index:10;
  width:100vw;height:100vh;height:100dvh;
  overflow:hidden;background:#030812;
  font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
}

.image-artboard{
  position:absolute;left:50%;top:50%;
  width:max(100vw,177.7778dvh);
  aspect-ratio:16/9;
  transform:translate(-50%,-50%);
  background-image:url('ChatGPT%20Image%2016%20de%20set.%20de%202026,%2012_01_50.png?v=1');
  background-position:center center;
  background-size:100% 100%;
  background-repeat:no-repeat;
  background-color:#030812;
}

.desktop-live-form{
  position:absolute;
  left:23.65%;top:35.15%;width:36.9%;height:7.45%;
  display:grid;grid-template-columns:58% 42%;align-items:stretch;
}
#desktop-plate{
  width:100%;height:100%;min-width:0;box-sizing:border-box;
  border:0;outline:0;border-radius:10px 0 0 10px;
  background:#fff;color:#15202d;
  padding:0 clamp(12px,1.2vw,22px);
  text-transform:uppercase;
  font:700 clamp(13px,1.18vw,21px)/1 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
}
#desktop-plate::placeholder{color:#7d8794;text-transform:none;opacity:1}
#desktop-consult-btn{
  width:100%!important;height:100%;margin:0!important;padding:0 10px!important;
  border:0!important;border-radius:0 10px 10px 0!important;
  background:linear-gradient(135deg,#168fff,#076be2)!important;
  color:#fff!important;
  font:950 clamp(9px,1vw,16px)/1 Inter,system-ui,-apple-system,"Segoe UI",sans-serif!important;
  box-shadow:none!important;cursor:pointer;white-space:nowrap;
}
#desktop-consult-btn:disabled,#mobile-consult-btn:disabled{opacity:.65;cursor:not-allowed}

.consult-error{
  position:absolute;left:0;right:0;top:108%;
  text-align:center;color:#ffd1d7;
  font:800 clamp(10px,.72vw,12px)/1.35 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
  text-shadow:0 2px 8px #000;
}

.crlv-art-button{
  position:absolute;left:30.45%;top:85.05%;width:14.15%;height:4.7%;
  margin:0!important;padding:0!important;border:0!important;border-radius:12px!important;
  background:transparent!important;box-shadow:none!important;cursor:pointer;
}
.crlv-art-button:hover,.crlv-art-button:focus-visible{
  outline:2px solid #4aa7ff;outline-offset:2px;background:rgba(10,113,230,.12)!important;
}

.theme-hotspot{
  position:absolute;margin:0!important;padding:0!important;border:0!important;
  background:transparent!important;box-shadow:none!important;cursor:pointer;z-index:3;
}
.theme-hotspot:focus-visible{outline:2px solid #4aa7ff;outline-offset:2px}
.hs-home{left:30.6%;top:1.5%;width:4.7%;height:5.6%}
.hs-como{left:36.2%;top:1.5%;width:7.2%;height:5.6%}
.hs-consultas{left:45.0%;top:1.5%;width:9.2%;height:5.6%}
.hs-contato{left:56.2%;top:1.5%;width:4.6%;height:5.6%}
.hs-conta{left:83.4%;top:1.3%;width:10.1%;height:5.8%}

.mobile-actions{display:none}

#image-result-panel{
  position:fixed;z-index:70;
  left:50%;top:45%;transform:translateX(-50%);
  width:min(92vw,760px);max-height:45dvh;
  overflow:auto;scrollbar-width:thin;overscroll-behavior:contain;
}
#image-result-panel>#status:not(:empty),
#image-result-panel>#result:not(.hidden){
  margin-top:8px!important;padding:14px!important;border-radius:15px!important;
  background:rgba(5,12,20,.97)!important;
  border:1px solid rgba(65,116,165,.58)!important;
  box-shadow:0 18px 45px rgba(0,0,0,.62)!important;
}

.theme-info{
  position:fixed;inset:0;z-index:120;
  display:grid;place-items:center;padding:18px;
  background:rgba(2,7,13,.82);backdrop-filter:blur(8px);
}
.theme-info.hidden{display:none!important}
.theme-info-card{
  position:relative;width:min(92vw,540px);
  padding:25px;border:1px solid #2867aa;border-radius:20px;
  background:linear-gradient(180deg,#0d1d31,#07111d);
  color:#f5f8fc;box-shadow:0 25px 90px #000b;
}
.theme-info-card h2{margin:0 45px 10px 0;font-size:24px}
.theme-info-card p{color:#aebdce;font-size:14px;line-height:1.6}
.theme-info-card a{color:#55b7ff}
.theme-info-close{
  position:absolute;right:14px;top:14px;width:36px!important;height:36px!important;
  margin:0!important;padding:0!important;border:1px solid #2c4967!important;
  border-radius:10px!important;background:#0a1624!important;color:#dcecff!important;
  box-shadow:none!important;
}

body > .flow-overlay{z-index:99999!important}

@media(max-width:700px){
  .image-artboard{
    left:50%;top:0;width:177.7778svh;min-width:100vw;height:100svh;
    aspect-ratio:auto;transform:translateX(-50%);
    background-size:cover;background-position:center top;
  }
  .desktop-live-form,.crlv-art-button,.theme-hotspot{display:none!important}
  .mobile-actions{
    display:grid;position:fixed;z-index:45;
    left:50%;top:35%;transform:translateX(-50%);
    width:min(91vw,520px);grid-template-columns:1fr;gap:8px;
    padding:10px;border-radius:16px;box-sizing:border-box;
    border:1px solid rgba(77,165,255,.58);
    background:rgba(4,12,22,.88);
    box-shadow:0 18px 55px rgba(0,0,0,.6);
    backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);
  }
  #mobile-plate,#mobile-consult-btn,.mobile-crlv-btn{
    width:100%!important;height:50px;min-height:50px;margin:0!important;
    box-sizing:border-box;border-radius:11px!important;
  }
  #mobile-plate{
    border:0;outline:0;background:#fff;color:#15202d;
    padding:0 13px;text-align:center;text-transform:uppercase;
    font:800 18px/1 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
  }
  #mobile-plate::placeholder{color:#7d8794;text-transform:none}
  #mobile-consult-btn{
    border:0!important;background:linear-gradient(135deg,#168fff,#076be2)!important;
    color:#fff!important;font-size:14px!important;font-weight:950!important;box-shadow:none!important;
  }
  .mobile-crlv-btn{
    border:1px solid #3378bc!important;background:linear-gradient(135deg,#133d70,#0b2749)!important;
    color:#e8f5ff!important;font-size:13px!important;font-weight:900!important;box-shadow:none!important;
  }
  .mobile-actions .consult-error{
    position:static;min-height:0;font-size:11px;text-shadow:none;
  }
  #image-result-panel{
    top:58%;width:92vw;max-height:37dvh;
  }
}

@media(max-width:420px){
  .mobile-actions{top:33%;width:93vw;padding:8px}
  #mobile-plate,#mobile-consult-btn,.mobile-crlv-btn{height:48px;min-height:48px}
  #mobile-plate{font-size:17px}
  #image-result-panel{top:59%;max-height:35dvh}
}

@media(max-height:540px) and (orientation:landscape){
  .mobile-actions{
    top:24%;width:min(84vw,720px);
    grid-template-columns:minmax(0,1fr) 190px 190px;
  }
  #mobile-plate,#mobile-consult-btn,.mobile-crlv-btn{height:46px;min-height:46px}
  .mobile-actions .consult-error{grid-column:1/-1}
  #image-result-panel{top:47%;max-height:47dvh}
}

@media print{.image-stage{display:none!important}}
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
      if (!html.includes('id="image-stage"')) {
        html = html.replace('<body>', `<body>\n${CONSULT_UI}`);
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
    console.log(`Nova tela principal profissional ativa na porta ${PUBLIC_PORT}`);
  });
}

start();