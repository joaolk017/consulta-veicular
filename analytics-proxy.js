const http = require('http');
const net = require('net');
const { fork } = require('child_process');

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const INNER_PORT = Number(process.env.ANALYTICS_INNER_PORT || 14001);
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const GA_MEASUREMENT_ID = String(process.env.GA_MEASUREMENT_ID || '').trim();
const GA_ENABLED = /^G-[A-Z0-9]+$/i.test(GA_MEASUREMENT_ID);

function analyticsMarkup() {
  if (!GA_ENABLED) return '';

  const id = JSON.stringify(GA_MEASUREMENT_ID);
  return `
<style id="cv-analytics-style">
#cv-analytics-consent{position:fixed;left:18px;right:18px;bottom:18px;z-index:12000;max-width:760px;margin:auto;padding:16px;border:1px solid #28425e;border-radius:16px;background:rgba(6,16,27,.98);box-shadow:0 18px 60px rgba(0,0,0,.45);color:#f4f8ff;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
#cv-analytics-consent b{display:block;margin-bottom:5px;font-size:13px}#cv-analytics-consent p{margin:0;color:#91a3b7;font-size:10px;line-height:1.55}#cv-analytics-consent a{color:#8fd1ff}
.cv-analytics-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}.cv-analytics-actions button{width:auto!important;margin:0!important;padding:10px 13px!important;border-radius:10px!important;font-size:10px!important;font-weight:900!important;box-shadow:none!important}.cv-analytics-deny{background:#0c1724!important;border:1px solid #31465e!important;color:#c4d0dc!important}.cv-analytics-accept{background:#147fe8!important;border:1px solid #258fea!important;color:#fff!important}
#cv-analytics-preferences{display:inline-block;width:auto!important;margin:0 0 0 8px!important;padding:0!important;border:0!important;background:none!important;box-shadow:none!important;color:#8fd1ff!important;font:800 10px/1.4 Inter,system-ui,-apple-system,"Segoe UI",sans-serif!important;text-decoration:underline!important;cursor:pointer!important}
@media(max-width:560px){#cv-analytics-consent{left:10px;right:10px;bottom:78px;padding:14px}.cv-analytics-actions{display:grid;grid-template-columns:1fr 1fr}.cv-analytics-actions button{width:100%!important;padding:10px 8px!important}}
</style>
<script id="cv-analytics-script">
(function(){
  var GA_ID=${id};
  var KEY='cv_ga_consent_v1';
  var loaded=false;
  var paidTracked=false;

  function getConsent(){try{return localStorage.getItem(KEY)||''}catch(e){return ''}}
  function setConsent(v){try{localStorage.setItem(KEY,v)}catch(e){}}
  function loadGA(){
    if(loaded||!GA_ID)return;
    loaded=true;
    window.dataLayer=window.dataLayer||[];
    window.gtag=window.gtag||function(){window.dataLayer.push(arguments)};
    window.gtag('js',new Date());
    window.gtag('config',GA_ID,{send_page_view:true,anonymize_ip:true});
    var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(GA_ID);document.head.appendChild(s);
  }
  function track(name,params){
    if(getConsent()!=='granted')return;
    loadGA();
    window.gtag('event',name,params||{});
  }
  window.cvTrack=track;

  function removeBanner(){var b=document.getElementById('cv-analytics-consent');if(b)b.remove()}
  function showBanner(){
    removeBanner();
    var box=document.createElement('div');
    box.id='cv-analytics-consent';box.setAttribute('role','dialog');box.setAttribute('aria-label','Preferências de cookies de análise');
    box.innerHTML='<b>Cookies de análise</b><p>Usamos Google Analytics para entender o uso do site e melhorar o funil de consulta. O Analytics só é carregado se você aceitar. <a href="/privacidade.html">Saiba mais</a>.</p><div class="cv-analytics-actions"><button type="button" class="cv-analytics-deny">CONTINUAR SEM ANALYTICS</button><button type="button" class="cv-analytics-accept">ACEITAR ANALYTICS</button></div>';
    document.body.appendChild(box);
    box.querySelector('.cv-analytics-deny').addEventListener('click',function(){setConsent('denied');removeBanner()});
    box.querySelector('.cv-analytics-accept').addEventListener('click',function(){setConsent('granted');loadGA();track('analytics_consent_granted');removeBanner()});
  }
  function addPreferences(){
    if(document.getElementById('cv-analytics-preferences'))return;
    var target=document.querySelector('.cv-footer')||document.querySelector('.transparency-clear-links');
    if(!target)return;
    var btn=document.createElement('button');btn.id='cv-analytics-preferences';btn.type='button';btn.textContent='Preferências de cookies';btn.addEventListener('click',showBanner);target.appendChild(btn);
  }

  document.addEventListener('click',function(e){
    var el=e.target.closest('button,a');if(!el)return;
    if(el.id==='cv-consult-btn')track('consulta_iniciada',{value:18.90,currency:'BRL'});
    if(el.matches('.unlock .paybtn'))track('pagamento_iniciado',{value:18.90,currency:'BRL'});
    if(el.id==='pixCreateBtn')track('pix_geracao_solicitada',{value:18.90,currency:'BRL'});
    if(el.id==='floating-whatsapp')track('whatsapp_click');
    var onclick=el.getAttribute('onclick')||'';
    if(/abrirCRLVCV|abrirFluxoCRLV/.test(onclick))track('crlv_iniciado',{value:59.90,currency:'BRL'});
  },true);

  function detectPaid(){
    if(paidTracked)return;
    var success=document.getElementById('pixSuccessStep');
    var badge=document.querySelector('.paid-badge');
    if(badge||(success&&!success.classList.contains('hidden'))){paidTracked=true;track('pagamento_confirmado',{value:18.90,currency:'BRL'});track('relatorio_liberado')}
  }

  document.addEventListener('DOMContentLoaded',function(){
    addPreferences();
    var consent=getConsent();if(consent==='granted')loadGA();else if(!consent)showBanner();
    var observer=new MutationObserver(detectPaid);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
    detectPaid();
  });
})();
</script>`;
}

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

  const upstream = http.request({ hostname:'127.0.0.1', port:INNER_PORT, path:req.url, method:req.method, headers }, upstreamRes => {
    if (!injectHome) { res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers); upstreamRes.pipe(res); return; }
    const type = String(upstreamRes.headers['content-type'] || '');
    if (!type.includes('text/html')) { res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers); upstreamRes.pipe(res); return; }

    const chunks=[];let size=0;
    upstreamRes.on('data', chunk => { size += chunk.length; if(size <= MAX_HTML_BYTES) chunks.push(chunk); });
    upstreamRes.on('end', () => {
      if(size > MAX_HTML_BYTES){res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8'});res.end('Página excedeu o limite de renderização.');return;}
      let html=Buffer.concat(chunks).toString('utf8');
      const markup=analyticsMarkup();
      if(markup && !html.includes('id="cv-analytics-script"')) html=html.replace('</body>',`${markup}\n</body>`);
      const body=Buffer.from(html,'utf8');
      const out={...upstreamRes.headers,'content-length':String(body.length),'cache-control':'no-store, no-cache, must-revalidate, max-age=0'};
      delete out['content-encoding'];delete out['transfer-encoding'];
      res.writeHead(upstreamRes.statusCode || 200,out);res.end(body);
    });
  });

  upstream.on('error', err => {console.error('ANALYTICS_PROXY:',err.message);if(!res.headersSent){res.writeHead(502,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'servico_indisponivel'}));}});
  req.pipe(upstream);
}

async function start(){
  const child=fork(require.resolve('./whatsapp-proxy.js'),[],{env:{...process.env,PORT:String(INNER_PORT)},stdio:['inherit','inherit','inherit','ipc']});
  child.on('exit',code=>{console.error(`ANALYTICS_PROXY: aplicação interna encerrou (código ${code}).`);process.exit(code||1)});
  try{await waitForPort(INNER_PORT)}catch(err){console.error('ANALYTICS_PROXY:',err.message);process.exit(1)}
  const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const isHome=req.method==='GET'&&(pathname==='/'||pathname==='/index.html');proxy(req,res,isHome)});
  server.listen(PUBLIC_PORT,()=>console.log(`Analytics ${GA_ENABLED?'ativo':'aguardando GA_MEASUREMENT_ID'} na porta ${PUBLIC_PORT}`));
}

start();
