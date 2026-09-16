const http = require('http');
const net = require('net');
const { fork } = require('child_process');

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const INNER_PORT = Number(process.env.PAYMENT_INNER_PORT || 12001);
const MAX_HTML_BYTES = 3 * 1024 * 1024;

const TRUST_BAND = `
<section id="trust-band" class="trust-band" aria-label="Informações de confiança">
  <div class="trust-band-shell">
    <div class="trust-band-item">
      <span class="trust-band-icon">💠</span>
      <div><b>Pagamento via PIX</b><small>Relatório liberado por até 24h neste navegador</small></div>
    </div>
    <div class="trust-band-item">
      <span class="trust-band-icon">🔐</span>
      <div><b>Credenciais no servidor</b><small>Chaves de integração não ficam expostas no navegador</small></div>
    </div>
    <div class="trust-band-item">
      <span class="trust-band-icon">📄</span>
      <div><b>Relatório organizado</b><small>Opção de PDF quando o recurso estiver disponível</small></div>
    </div>
    <div class="trust-band-item">
      <span class="trust-band-icon">✓</span>
      <div><b>Serviço privado</b><small>Independente de DETRAN, SENATRAN e GOV.BR</small></div>
    </div>
  </div>
</section>`;

const PAYMENT_CSS = `
<style id="payment-cta-style">
.unlock .paybtn,
#pixCreateBtn{
  min-height:60px!important;
  padding:17px 18px!important;
  border:1px solid #36d788!important;
  border-radius:14px!important;
  background:linear-gradient(135deg,#27d47e,#0f944f)!important;
  color:#fff!important;
  font-size:14px!important;
  font-weight:950!important;
  letter-spacing:.2px;
  box-shadow:0 14px 34px rgba(26,177,99,.30)!important;
  transition:transform .16s ease,box-shadow .16s ease,filter .16s ease;
}
.unlock .paybtn:hover,
#pixCreateBtn:hover{
  transform:translateY(-1px);
  filter:brightness(1.05);
  box-shadow:0 18px 38px rgba(26,177,99,.34)!important;
}
.unlock .paybtn:active,
#pixCreateBtn:active{
  transform:translateY(1px) scale(.995);
}
.unlock .secure{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  margin-top:10px;
  padding:7px 10px;
  border:1px solid #284939;
  border-radius:999px;
  background:#0a1710;
  color:#95b6a2;
  font-size:10px;
  font-weight:800;
}
#pixCreateBtn{margin-top:8px!important}
.cv-report-24h{
  margin:12px 0 0;
  padding:12px 14px;
  border:1px solid #2f7350;
  border-radius:12px;
  background:#0a2117;
  color:#a8d9bd;
  font-size:11px;
  line-height:1.55;
  text-align:center;
}
.cv-report-24h b{color:#d9f7e6}

/* Faixa de confiança separada do hero para não competir com a consulta. */
.cv-hero .cv-trustbar{display:none!important}
.trust-band{
  position:relative;
  z-index:8;
  border-top:1px solid #1d334b;
  border-bottom:1px solid #1d334b;
  background:linear-gradient(180deg,#081522,#06101b);
  color:#f4f8ff;
}
.trust-band-shell{
  width:min(1160px,92vw);
  margin:auto;
  display:grid;
  grid-template-columns:repeat(4,1fr);
}
.trust-band-item{
  min-width:0;
  display:flex;
  align-items:center;
  gap:11px;
  padding:17px 18px;
  border-right:1px solid #1d334b;
}
.trust-band-item:first-child{border-left:1px solid #1d334b}
.trust-band-icon{
  flex:0 0 auto;
  display:grid;
  place-items:center;
  width:36px;
  height:36px;
  border:1px solid #27547e;
  border-radius:11px;
  background:#0d2944;
  font-size:17px;
}
.trust-band-item div{display:grid;gap:3px;min-width:0}
.trust-band-item b{font-size:11px;line-height:1.25;color:#f6f9fd}
.trust-band-item small{color:#7f94aa;font-size:9px;line-height:1.4}

@media(max-width:900px){
  .trust-band-shell{grid-template-columns:repeat(2,1fr)}
  .trust-band-item:nth-child(2){border-right:1px solid #1d334b}
  .trust-band-item:nth-child(3){border-left:1px solid #1d334b;border-top:1px solid #1d334b}
  .trust-band-item:nth-child(4){border-top:1px solid #1d334b}
}
@media(max-width:560px){
  .unlock .paybtn,#pixCreateBtn{min-height:56px!important;font-size:12px!important;padding:15px 12px!important}
  .unlock .secure{font-size:9px}
  .trust-band-shell{grid-template-columns:1fr 1fr;width:100%}
  .trust-band-item{padding:13px 10px;gap:8px}
  .trust-band-icon{width:31px;height:31px;border-radius:9px;font-size:14px}
  .trust-band-item b{font-size:9.5px}
  .trust-band-item small{font-size:8px}
  .cv-report-24h{font-size:10px;padding:11px}
}
</style>`;

const REPORT_RETENTION_SCRIPT = `
<script id="cv-report-retention-script">
(function(){
  var PREFIX='cv_relatorio_pago_24h_';
  var baseFetch=window.fetch.bind(window);

  function normalPlate(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7)}
  function key(plate){return PREFIX+normalPlate(plate)}
  function removeSaved(plate){try{localStorage.removeItem(key(plate))}catch(e){}}
  function getSaved(plate){
    plate=normalPlate(plate);if(!plate)return null;
    try{
      var raw=localStorage.getItem(key(plate));if(!raw)return null;
      var data=JSON.parse(raw);
      if(!data||data.plate!==plate||!data.accessToken||!data.expiresAt||Date.now()>=Number(data.expiresAt)){removeSaved(plate);return null}
      return data;
    }catch(e){removeSaved(plate);return null}
  }
  function saveAccess(data){
    try{
      if(!data||!data.reportAccessToken||!data.reportAccessExpiresAt||!data.vehicle)return;
      var plate=normalPlate(data.vehicle.plate);if(!plate)return;
      localStorage.setItem(key(plate),JSON.stringify({
        plate:plate,
        accessToken:data.reportAccessToken,
        expiresAt:Number(data.reportAccessExpiresAt),
        savedAt:Date.now()
      }));
    }catch(e){}
  }
  function formatExpiry(ms){
    try{return new Date(Number(ms)).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}catch(e){return ''}
  }
  function showNote(plate){
    var saved=getSaved(plate),result=document.getElementById('result');if(!saved||!result)return;
    var old=document.getElementById('cv-report-24h-note');if(old)old.remove();
    var note=document.createElement('div');note.id='cv-report-24h-note';note.className='cv-report-24h';
    note.innerHTML='🔓 <b>Acesso salvo por 24 horas neste navegador.</b><br>Você pode consultar esta mesma placa novamente sem pagar até '+formatExpiry(saved.expiresAt)+'.';
    var actions=result.querySelector('.report-actions');if(actions)actions.insertAdjacentElement('beforebegin',note);else result.appendChild(note);
  }

  window.fetch=async function(input,init){
    var response=await baseFetch(input,init);
    try{
      var rawUrl=typeof input==='string'?input:(input&&input.url?input.url:'');
      var pathname=new URL(rawUrl,location.href).pathname;
      if(pathname==='/api/consulta-completa'&&response.ok){
        var copy=response.clone();
        var data=await copy.json();
        saveAccess(data);
      }
    }catch(e){}
    return response;
  };

  async function restoreSavedReport(plate){
    var saved=getSaved(plate);if(!saved)return false;
    var btn=document.getElementById('btn'),status=document.getElementById('status'),result=document.getElementById('result');
    if(btn){btn.disabled=true;btn.textContent='ABRINDO RELATÓRIO...'}
    if(status)status.innerHTML='<div class="loading"><span class="spinner"></span>Abrindo sua consulta já paga...</div>';
    try{
      var r=await baseFetch('/api/consulta-salva',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessToken:saved.accessToken}),cache:'no-store'});
      var data={};try{data=await r.json()}catch(e){}
      if(!r.ok||!data||data.paid!==true||!data.vehicle){removeSaved(plate);return false}
      ultimaPlacaConsultada=plate;
      if(typeof renderRelatorioCompleto==='function')renderRelatorioCompleto(data.vehicle);
      if(status)status.innerHTML='';
      if(typeof steps==='function')steps(3);
      showNote(plate);
      if(result){result.classList.remove('hidden');setTimeout(function(){result.scrollIntoView({behavior:'smooth',block:'start'})},100)}
      return true;
    }catch(e){
      removeSaved(plate);
      return false;
    }finally{
      if(btn){btn.disabled=false;btn.textContent='🔎 CONSULTAR VEÍCULO'}
    }
  }

  if(typeof window.consultar==='function'){
    var originalConsultar=window.consultar;
    window.consultar=async function(){
      var input=document.getElementById('plate');
      var plate=normalPlate(input&&input.value);
      if(plate&&getSaved(plate)){
        var restored=await restoreSavedReport(plate);
        if(restored)return;
      }
      return originalConsultar.apply(this,arguments);
    };
  }

  var observer=new MutationObserver(function(){
    try{
      var badge=document.querySelector('#result .paid-badge');
      if(!badge)return;
      var plate=normalPlate((document.querySelector('#result .plate-result')||{}).textContent||'');
      if(plate)getSaved(plate)&&showNote(plate);
    }catch(e){}
  });
  document.addEventListener('DOMContentLoaded',function(){
    var result=document.getElementById('result');if(result)observer.observe(result,{childList:true,subtree:true});
  });
})();
</script>`;

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
      html = html.replace('💠 PAGAR COM PIX E DESBLOQUEAR', '🔓 LIBERAR RELATÓRIO COMPLETO · R$ 18,90');
      html = html.replace('💠 GERAR PIX DE R$ 18,90', '💠 GERAR PIX E CONTINUAR · R$ 18,90');
      html = html.replace('🔒 Pagamento via PIX • Liberação após confirmação', '🔒 PIX seguro • pagamento único • acesso salvo por 24 horas');
      if (!html.includes('id="payment-cta-style"')) html = html.replace('</head>', `${PAYMENT_CSS}\n</head>`);
      if (!html.includes('id="trust-band"')) {
        const resultMarker = '<div id="cv-result" class="cv-result"></div>';
        if (html.includes(resultMarker)) html = html.replace(resultMarker, `${TRUST_BAND}\n${resultMarker}`);
      }
      if (!html.includes('id="cv-report-retention-script"')) html = html.replace('</body>', `${REPORT_RETENTION_SCRIPT}\n</body>`);

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
    console.error('PAYMENT_PROXY:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'servico_indisponivel' }));
    }
  });

  req.pipe(upstream);
}

async function start() {
  const child = fork(require.resolve('./why-proxy.js'), [], {
    env: { ...process.env, PORT: String(INNER_PORT) },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc']
  });

  child.on('exit', code => {
    console.error(`PAYMENT_PROXY: aplicação interna encerrou (código ${code}).`);
    process.exit(code || 1);
  });

  try {
    await waitForPort(INNER_PORT);
  } catch (err) {
    console.error('PAYMENT_PROXY:', err.message);
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const isHome = req.method === 'GET' && (pathname === '/' || pathname === '/index.html');
    proxy(req, res, isHome);
  });

  server.listen(PUBLIC_PORT, () => console.log(`Pagamento e faixa de confiança ativos na porta ${PUBLIC_PORT}`));
}

start();
