const http = require('http');
const https = require('https');
const net = require('net');
const { fork } = require('child_process');

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const INNER_PORT = Number(process.env.ANALYTICS_INNER_PORT || 14001);
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_FIPE_BYTES = 1024 * 1024;
const GA_MEASUREMENT_ID = String(process.env.GA_MEASUREMENT_ID || '').trim();
const GA_ENABLED = /^G-[A-Z0-9]+$/i.test(GA_MEASUREMENT_ID);

const FIPE_HTML = `
<aside id="fipe" class="cv-fipe-hero" aria-label="Consulta gratuita de valor de referência FIPE">
  <div class="cv-fipe-glow"></div>
  <div class="cv-fipe-icon">💰</div>
  <span class="cv-fipe-tag">CONSULTA GRATUITA</span>
  <h2>Valor de referência<br><strong>FIPE</strong></h2>
  <p>Selecione o veículo para consultar gratuitamente um valor médio de referência.</p>
  <div class="cv-fipe-form">
    <select id="fipeTipo" aria-label="Tipo de veículo">
      <option value="carros">Carros e utilitários</option>
      <option value="motos">Motos</option>
      <option value="caminhoes">Caminhões</option>
    </select>
    <select id="fipeMarca" aria-label="Marca" disabled><option value="">Carregando marcas...</option></select>
    <select id="fipeModelo" aria-label="Modelo" disabled><option value="">Selecione a marca</option></select>
    <select id="fipeAno" aria-label="Ano e combustível" disabled><option value="">Selecione o modelo</option></select>
    <button id="fipeConsultar" type="button" disabled>CONSULTAR VALOR GRÁTIS</button>
  </div>
  <div id="fipeStatus" class="cv-fipe-status" aria-live="polite"></div>
  <div id="fipeResultado" class="cv-fipe-result" hidden>
    <small>VALOR MÉDIO DE REFERÊNCIA</small>
    <strong id="fipeValor">—</strong>
    <b id="fipeVeiculo">—</b>
    <span id="fipeDetalhes">—</span>
  </div>
  <div class="cv-fipe-note">Consulta informativa gratuita. Valores de referência podem variar conforme região, estado de conservação, acessórios e condições de mercado. Dados fornecidos por serviço de terceiros baseado na Tabela FIPE; não substitui a consulta oficial.</div>
</aside>`;

const FIPE_CSS = `
<style id="cv-fipe-style">
/* CRLV removido da experiência pública. */
#crlv,#crlvFlow,.cv-crlv-hero,.cv-crlv-section,[id*="crlv" i][class],[class*="crlv" i]{display:none!important}
.cv-fipe-hero{position:relative;overflow:hidden;padding:30px;border:1px solid rgba(64,184,127,.62);border-radius:28px;background:linear-gradient(155deg,rgba(12,54,43,.98),rgba(6,24,27,.99));box-shadow:0 35px 100px rgba(0,0,0,.48),0 0 55px rgba(36,195,121,.10)}
.cv-fipe-glow{position:absolute;width:250px;height:250px;right:-80px;top:-80px;border-radius:50%;background:#25c77b;filter:blur(80px);opacity:.15}.cv-fipe-icon{position:relative;display:grid;place-items:center;width:54px;height:54px;border:1px solid #34765a;border-radius:16px;background:#0b3a2c;font-size:25px}.cv-fipe-tag{position:relative;display:block;margin-top:17px;color:#65e4a6;font-size:10px;font-weight:950;letter-spacing:1.4px}.cv-fipe-hero h2{position:relative;margin:7px 0 9px;font-size:clamp(34px,3.7vw,48px);line-height:1;letter-spacing:-1.6px}.cv-fipe-hero h2 strong{color:#65e4a6}.cv-fipe-hero>p{position:relative;margin:0 0 16px;color:#a7c2b6;font-size:12px;line-height:1.55}
.cv-fipe-form{position:relative;display:grid;grid-template-columns:1fr 1fr;gap:8px}.cv-fipe-form select{min-width:0;width:100%;height:44px;padding:0 10px;border:1px solid #315947;border-radius:10px;background:#081d18;color:#e9f8f0;font:800 10px/1 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;outline:0}.cv-fipe-form select:focus{border-color:#55c993;box-shadow:0 0 0 3px rgba(59,201,137,.12)}.cv-fipe-form select:disabled{opacity:.55}.cv-fipe-form button{grid-column:1/-1;width:100%!important;height:49px!important;margin:2px 0 0!important;border:1px solid #47cf8d!important;border-radius:11px!important;background:linear-gradient(135deg,#25c77b,#128e56)!important;color:#fff!important;font-size:11px!important;font-weight:950!important;box-shadow:0 13px 30px rgba(28,174,104,.22)!important;cursor:pointer}.cv-fipe-form button:disabled{opacity:.48;cursor:not-allowed}.cv-fipe-status{position:relative;min-height:17px;padding-top:6px;color:#9ab7a9;font-size:9px;text-align:center}.cv-fipe-status.cv-fipe-error{color:#ffb8c0}.cv-fipe-result{position:relative;margin-top:7px;padding:14px;border:1px solid #32644d;border-radius:13px;background:rgba(5,26,19,.88);text-align:center}.cv-fipe-result small{display:block;color:#78a990;font-size:8px;font-weight:900;letter-spacing:1px}.cv-fipe-result strong{display:block;margin:4px 0;color:#78efb1;font-size:30px;line-height:1.05}.cv-fipe-result b{display:block;color:#f1faf5;font-size:11px;line-height:1.4}.cv-fipe-result span{display:block;margin-top:4px;color:#8eaa9d;font-size:9px;line-height:1.45}.cv-fipe-note{position:relative;margin-top:10px;color:#718e80;font-size:8px;line-height:1.45;text-align:center}
.cv-mobile-bar .cv-fipe-mobile{border:1px solid #2b7c58!important;background:#0c3c2b!important;color:#dff8e9!important}
@media(max-width:600px){.cv-fipe-hero{padding:20px;border-radius:20px}.cv-fipe-hero h2{font-size:35px}.cv-fipe-form{grid-template-columns:1fr}.cv-fipe-form button{grid-column:auto}.cv-fipe-result strong{font-size:27px}}
</style>`;

const FIPE_SCRIPT = `
<script id="cv-fipe-script">
(function(){
  function $(id){return document.getElementById(id)}
  function option(select,value,label){var o=document.createElement('option');o.value=String(value);o.textContent=label;select.appendChild(o)}
  function reset(select,label){select.innerHTML='';option(select,'',label);select.disabled=true}
  async function api(path){
    var r=await fetch('/api/fipe/'+path,{headers:{'Accept':'application/json'}});
    if(!r.ok)throw new Error('Falha na consulta');
    return r.json();
  }
  function status(msg,error){var s=$('fipeStatus');if(!s)return;s.textContent=msg||'';s.classList.toggle('cv-fipe-error',!!error)}
  function hideResult(){var r=$('fipeResultado');if(r)r.hidden=true}

  async function loadMarcas(){
    var tipo=$('fipeTipo').value, marca=$('fipeMarca');
    reset(marca,'Carregando marcas...');reset($('fipeModelo'),'Selecione a marca');reset($('fipeAno'),'Selecione o modelo');$('fipeConsultar').disabled=true;hideResult();status('Carregando marcas...');
    try{
      var data=await api(tipo+'/marcas');
      marca.innerHTML='';option(marca,'','Selecione a marca');
      data.forEach(function(x){option(marca,x.codigo,x.nome)});marca.disabled=false;status('');
    }catch(e){reset(marca,'Não foi possível carregar');status('Consulta de valor temporariamente indisponível.',true)}
  }
  async function loadModelos(){
    var tipo=$('fipeTipo').value, marca=$('fipeMarca').value, modelo=$('fipeModelo');
    reset(modelo,'Carregando modelos...');reset($('fipeAno'),'Selecione o modelo');$('fipeConsultar').disabled=true;hideResult();if(!marca)return;status('Carregando modelos...');
    try{
      var data=await api(tipo+'/marcas/'+encodeURIComponent(marca)+'/modelos');var lista=Array.isArray(data)?data:(data.modelos||[]);
      modelo.innerHTML='';option(modelo,'','Selecione o modelo');lista.forEach(function(x){option(modelo,x.codigo,x.nome)});modelo.disabled=false;status('');
    }catch(e){reset(modelo,'Não foi possível carregar');status('Não foi possível carregar os modelos.',true)}
  }
  async function loadAnos(){
    var tipo=$('fipeTipo').value, marca=$('fipeMarca').value, modelo=$('fipeModelo').value, ano=$('fipeAno');
    reset(ano,'Carregando anos...');$('fipeConsultar').disabled=true;hideResult();if(!modelo)return;status('Carregando anos...');
    try{
      var data=await api(tipo+'/marcas/'+encodeURIComponent(marca)+'/modelos/'+encodeURIComponent(modelo)+'/anos');
      ano.innerHTML='';option(ano,'','Selecione ano / combustível');data.forEach(function(x){option(ano,x.codigo,x.nome)});ano.disabled=false;status('');
    }catch(e){reset(ano,'Não foi possível carregar');status('Não foi possível carregar os anos.',true)}
  }
  async function consultar(){
    var tipo=$('fipeTipo').value, marca=$('fipeMarca').value, modelo=$('fipeModelo').value, ano=$('fipeAno').value, btn=$('fipeConsultar');
    if(!tipo||!marca||!modelo||!ano)return;btn.disabled=true;btn.textContent='CONSULTANDO...';hideResult();status('Consultando valor de referência...');
    if(typeof window.cvTrack==='function')window.cvTrack('fipe_consulta_iniciada',{tipo_veiculo:tipo});
    try{
      var data=await api(tipo+'/marcas/'+encodeURIComponent(marca)+'/modelos/'+encodeURIComponent(modelo)+'/anos/'+encodeURIComponent(ano));
      var valor=data.Valor||data.valor||'Valor indisponível';var veiculo=[data.Marca||data.marca,data.Modelo||data.modelo].filter(Boolean).join(' · ');
      var detalhes=[];if(data.AnoModelo||data.anoModelo)detalhes.push('Ano '+(data.AnoModelo||data.anoModelo));if(data.Combustivel||data.combustivel)detalhes.push(data.Combustivel||data.combustivel);if(data.CodigoFipe||data.codigoFipe)detalhes.push('Código FIPE '+(data.CodigoFipe||data.codigoFipe));if(data.MesReferencia||data.mesReferencia)detalhes.push(data.MesReferencia||data.mesReferencia);
      $('fipeValor').textContent=valor;$('fipeVeiculo').textContent=veiculo||'Veículo selecionado';$('fipeDetalhes').textContent=detalhes.join(' · ');$('fipeResultado').hidden=false;status('');
      if(typeof window.cvTrack==='function')window.cvTrack('fipe_resultado_exibido',{tipo_veiculo:tipo,codigo_fipe:data.CodigoFipe||data.codigoFipe||''});
    }catch(e){status('Não foi possível consultar o valor agora. Tente novamente em instantes.',true)}finally{btn.disabled=false;btn.textContent='CONSULTAR VALOR GRÁTIS'}
  }
  document.addEventListener('DOMContentLoaded',function(){
    if(!$('fipeTipo'))return;$('fipeTipo').addEventListener('change',loadMarcas);$('fipeMarca').addEventListener('change',loadModelos);$('fipeModelo').addEventListener('change',loadAnos);$('fipeAno').addEventListener('change',function(){$('fipeConsultar').disabled=!this.value;hideResult()});$('fipeConsultar').addEventListener('click',consultar);loadMarcas();
  });
})();
</script>`;

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

function applyPublicChanges(html){
  html=html.replace('<a href="#crlv">CRLV-e</a>','<a href="/consulta-fipe/">Valor FIPE grátis</a>');
  html=html.replace(/<aside class="cv-crlv-hero"[\s\S]*?<\/aside>/i,FIPE_HTML);
  html=html.replace(/<section id="crlv" class="cv-section cv-crlv-section">[\s\S]*?<\/section>/i,'');
  html=html.replace(/<details><summary>Quem pode solicitar o CRLV-e\?<\/summary>[\s\S]*?<\/details>/i,'');
  html=html.replace('Consulta e assessoria documental privada.','Consulta veicular e ferramentas gratuitas de referência.');
  html=html.replace('<button type="button" onclick="abrirCRLVCV()">📄 CRLV-e · R$ 59,90</button>','<a class="cv-fipe-mobile" href="/consulta-fipe/">💰 Valor FIPE grátis</a>');
  html=html.replace(/<article>\s*<div class="transparency-clear-icon">📄<\/div>\s*<div><b>CRLV-e SP · R\$ 59,90<\/b>[\s\S]*?<\/article>/i,'<article><div class="transparency-clear-icon">💰</div><div><b>Consulta de valor gratuita</b><small>Consulte um valor médio de referência por tipo, marca, modelo e ano. É uma ferramenta informativa e não substitui a consulta oficial da FIPE.</small></div></article>');
  html=html.replace(/<span>Antes de contratar, consulte:<\/span>\s*<a href="\/sobre\/">Sobre o Serviço<\/a>\s*<a href="\/termos\.html">Termos de Uso<\/a>\s*<a href="\/privacidade\.html">Política de Privacidade<\/a>\s*<a href="\/contato\.html">Contato e Suporte<\/a>/i,'<span>Ferramentas e informações:</span><a href="/consulta-fipe/">FIPE grátis</a><a href="/consulta-cnpj/">CNPJ grátis</a><a href="/simulador-financiamento/">Financiamento</a><a href="/custo-mensal-veiculo/">Custo mensal</a><a href="/sobre/">Sobre o Serviço</a><a href="/termos.html">Termos de Uso</a><a href="/privacidade.html">Política de Privacidade</a><a href="/contato.html">Contato e Suporte</a>');
  if(!html.includes('id="cv-fipe-style"'))html=html.replace('</head>',FIPE_CSS+'\n</head>');
  if(!html.includes('id="cv-fipe-script"'))html=html.replace('</body>',FIPE_SCRIPT+'\n</body>');
  return html;
}

function handleFipe(req,res,pathname){
  if(req.method!=='GET'){res.writeHead(405,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'metodo_nao_permitido'}))}
  const relative=pathname.slice('/api/fipe'.length);
  const allowed=/^\/(carros|motos|caminhoes)\/marcas(?:\/[A-Za-z0-9-]+\/modelos(?:\/[A-Za-z0-9-]+\/anos(?:\/[A-Za-z0-9-]+)?)?)?$/;
  if(!allowed.test(relative)){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'consulta_fipe_invalida'}))}
  const upstream=https.request({hostname:'parallelum.com.br',port:443,path:'/fipe/api/v1'+relative,method:'GET',headers:{Accept:'application/json','User-Agent':'ConsultaVeicular/1.0'}},u=>{
    const chunks=[];let size=0;
    u.on('data',c=>{size+=c.length;if(size<=MAX_FIPE_BYTES)chunks.push(c)});
    u.on('end',()=>{
      if(size>MAX_FIPE_BYTES){res.writeHead(502,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'resposta_fipe_muito_grande'}))}
      const body=Buffer.concat(chunks);const status=u.statusCode||502;
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':status===200?'public, max-age=600':'no-store','Content-Length':String(body.length)});res.end(body);
    });
  });
  upstream.setTimeout(10000,()=>upstream.destroy(new Error('timeout')));
  upstream.on('error',err=>{console.error('FIPE_PROXY:',err.message);if(!res.headersSent){res.writeHead(502,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'fipe_indisponivel'}))}});
  upstream.end();
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
      html=applyPublicChanges(html);
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
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname.startsWith('/api/fipe/'))return handleFipe(req,res,pathname);
    if(pathname.toLowerCase().includes('crlv')){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});return res.end('Página não encontrada.');}
    const isHome=req.method==='GET'&&(pathname==='/'||pathname==='/index.html');
    proxy(req,res,isHome);
  });
  server.listen(PUBLIC_PORT,()=>console.log(`Analytics ${GA_ENABLED?'ativo':'aguardando GA_MEASUREMENT_ID'} e consulta FIPE ativa na porta ${PUBLIC_PORT}`));
}

start();
