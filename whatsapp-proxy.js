const http = require('http');
const net = require('net');
const { fork } = require('child_process');

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const INNER_PORT = Number(process.env.WHATSAPP_INNER_PORT || 13001);
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const WHATSAPP_URL = 'https://wa.me/5577920006292?text=Ol%C3%A1%2C%20preciso%20de%20ajuda%20com%20uma%20consulta%20veicular.';

const WHATSAPP_HTML = `
<a id="floating-whatsapp" class="floating-whatsapp" href="${WHATSAPP_URL}" target="_blank" rel="noopener noreferrer" aria-label="Falar pelo WhatsApp">
  <span class="floating-whatsapp-label">Falar no WhatsApp</span>
  <span class="floating-whatsapp-icon" aria-hidden="true">💬</span>
</a>`;

const CNPJ_HTML = `
<section id="cnpj-gratis" class="cnpj-free" aria-labelledby="cnpj-free-title">
  <div class="cnpj-free-shell">
    <div class="cnpj-free-copy">
      <span class="cnpj-free-kicker">CONSULTA GRATUITA</span>
      <h2 id="cnpj-free-title">Consulte o CNPJ da loja ou revenda</h2>
      <p>Antes de negociar um veículo, confira gratuitamente os principais dados cadastrais públicos da empresa.</p>
      <div class="cnpj-free-benefits">
        <span>✓ Razão social e nome fantasia</span>
        <span>✓ Situação cadastral</span>
        <span>✓ Atividade principal</span>
        <span>✓ Município e estado</span>
      </div>
      <small>Consulta informativa baseada em dados públicos disponibilizados por serviço de terceiros. O resultado não representa certificação, recomendação ou garantia de idoneidade da empresa.</small>
    </div>

    <div class="cnpj-free-card">
      <div class="cnpj-free-card-head">
        <div><span>🏢</span><b>Consultar CNPJ</b></div>
        <strong>GRÁTIS</strong>
      </div>
      <label for="cnpj-free-input">CNPJ da loja ou revenda</label>
      <div class="cnpj-free-row">
        <input id="cnpj-free-input" inputmode="numeric" autocomplete="off" maxlength="18" placeholder="00.000.000/0000-00" aria-label="Digite o CNPJ da loja ou revenda">
        <button id="cnpj-free-button" type="button">CONSULTAR CNPJ</button>
      </div>
      <div id="cnpj-free-status" class="cnpj-free-status" aria-live="polite"></div>
      <div id="cnpj-free-result" class="cnpj-free-result" hidden></div>
    </div>
  </div>
</section>`;

const TRANSPARENCY_HTML = `
<section id="transparencia-clara" class="transparency-clear" aria-labelledby="transparency-clear-title">
  <div class="transparency-clear-shell">
    <div class="transparency-clear-head">
      <span>TRANSPARÊNCIA</span>
      <h2 id="transparency-clear-title">Informações claras antes de continuar</h2>
      <p>Veja como funcionam os serviços, os valores e a disponibilidade das informações antes de realizar uma solicitação.</p>
    </div>
    <div class="transparency-clear-grid">
      <article>
        <div class="transparency-clear-icon">🏢</div>
        <div><b>Serviço privado e independente</b><small>Não somos DETRAN, SENATRAN, GOV.BR ou outro órgão público. Para serviços oficiais, consulte os canais governamentais competentes.</small></div>
      </article>
      <article>
        <div class="transparency-clear-icon">🔎</div>
        <div><b>Dados conforme disponibilidade</b><small>As informações exibidas variam conforme o veículo, as fontes integradas e os registros existentes. Nem todo dado estará disponível em toda consulta.</small></div>
      </article>
      <article>
        <div class="transparency-clear-icon">💠</div>
        <div><b>Consulta veicular · R$ 18,90</b><small>Pagamento via PIX. A liberação do relatório ocorre somente após a confirmação válida do pagamento pelo sistema.</small></div>
      </article>
      <article>
        <div class="transparency-clear-icon">🎁</div>
        <div><b>Ferramentas gratuitas</b><small>Consulta de valor de referência e consulta cadastral de CNPJ são recursos informativos gratuitos, sujeitos à disponibilidade das fontes utilizadas.</small></div>
      </article>
    </div>
    <div class="transparency-clear-links">
      <span>Antes de contratar, consulte:</span>
      <a href="/termos.html">Termos de Uso</a>
      <a href="/privacidade.html">Política de Privacidade</a>
      <a href="/contato.html">Contato e Suporte</a>
    </div>
  </div>
</section>`;

const WHATSAPP_CSS = `
<style id="floating-whatsapp-style">
.floating-whatsapp{
  position:fixed;
  right:18px;
  bottom:18px;
  z-index:9000;
  display:flex;
  align-items:center;
  gap:9px;
  color:#fff;
  text-decoration:none;
  font:800 11px/1 Inter,system-ui,-apple-system,'Segoe UI',sans-serif;
  filter:drop-shadow(0 10px 22px rgba(0,0,0,.28));
}
.floating-whatsapp-icon{
  width:50px;
  height:50px;
  display:grid;
  place-items:center;
  border:1px solid rgba(255,255,255,.2);
  border-radius:50%;
  background:#20b95a;
  font-size:22px;
  box-shadow:0 10px 26px rgba(32,185,90,.28);
  transition:transform .16s ease,filter .16s ease;
}
.floating-whatsapp-label{
  padding:9px 11px;
  border:1px solid #234d37;
  border-radius:10px;
  background:rgba(6,21,14,.93);
  color:#dff8e9;
  opacity:0;
  transform:translateX(7px);
  pointer-events:none;
  transition:opacity .16s ease,transform .16s ease;
}
.floating-whatsapp:hover .floating-whatsapp-label,
.floating-whatsapp:focus-visible .floating-whatsapp-label{opacity:1;transform:none}
.floating-whatsapp:hover .floating-whatsapp-icon{transform:translateY(-1px);filter:brightness(1.05)}
.floating-whatsapp:focus-visible{outline:2px solid #7ee7a7;outline-offset:4px;border-radius:999px}

.cnpj-free{position:relative;padding:70px 0;background:radial-gradient(circle at 78% 25%,rgba(20,127,232,.16),transparent 28%),linear-gradient(180deg,#06111f,#081624);border-bottom:1px solid #1a2e45;color:#f4f8ff}
.cnpj-free-shell{width:min(1160px,92vw);margin:auto;display:grid;grid-template-columns:.82fr 1.18fr;gap:52px;align-items:center}
.cnpj-free-kicker{color:#5dbaff;font-size:10px;font-weight:950;letter-spacing:1.7px}
.cnpj-free-copy h2{margin:9px 0 13px;font-size:clamp(31px,4vw,48px);line-height:1.04;letter-spacing:-1.5px}
.cnpj-free-copy>p{margin:0;color:#94a8bd;font-size:13px;line-height:1.7}
.cnpj-free-benefits{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:20px 0}
.cnpj-free-benefits span{color:#d2ddea;font-size:11px;font-weight:750}
.cnpj-free-copy>small{display:block;color:#657d94;font-size:9px;line-height:1.55}
.cnpj-free-card{padding:24px;border:1px solid #2a5278;border-radius:22px;background:linear-gradient(180deg,#0d2033,#081525);box-shadow:0 28px 75px rgba(0,0,0,.36)}
.cnpj-free-card-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:18px}
.cnpj-free-card-head>div{display:flex;align-items:center;gap:9px}.cnpj-free-card-head span{font-size:24px}.cnpj-free-card-head b{font-size:17px}.cnpj-free-card-head strong{padding:7px 10px;border:1px solid #2f744f;border-radius:999px;background:#0a2d1d;color:#75dda5;font-size:9px;letter-spacing:1px}
.cnpj-free-card label{display:block;margin-bottom:7px;color:#9db0c3;font-size:10px;font-weight:850}
.cnpj-free-row{display:grid;grid-template-columns:minmax(0,1fr) 170px;gap:9px}
.cnpj-free-row input{width:100%;height:54px;border:1px solid #d8e2eb;border-radius:12px;background:#f7f9fb;color:#111b25;outline:0;padding:0 14px;font-size:18px;font-weight:900;letter-spacing:1px}
.cnpj-free-row input:focus{box-shadow:0 0 0 4px rgba(39,145,245,.18)}
.cnpj-free-row button{height:54px!important;width:100%!important;margin:0!important;border:0!important;border-radius:12px!important;background:linear-gradient(135deg,#1c98ff,#0866db)!important;color:#fff!important;font-size:11px!important;font-weight:950!important;box-shadow:0 12px 30px rgba(15,117,229,.25)!important;cursor:pointer}
.cnpj-free-row button:disabled{opacity:.55;cursor:wait}
.cnpj-free-status{min-height:18px;margin-top:8px;color:#91a5b9;font-size:10px;font-weight:750}
.cnpj-free-status.is-error{color:#ffafb9}
.cnpj-free-result{margin-top:13px;padding:17px;border:1px solid #284660;border-radius:15px;background:#07121f}
.cnpj-free-result-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding-bottom:13px;border-bottom:1px solid #1d3348}
.cnpj-free-result-head div{display:grid;gap:3px}.cnpj-free-result-head small{color:#71879c;font-size:8px}.cnpj-free-result-head b{font-size:16px;line-height:1.25}.cnpj-free-result-head span{color:#9eb0c2;font-size:10px}.cnpj-free-status-badge{flex:0 0 auto;padding:6px 9px;border-radius:999px;background:#102a43;color:#9ed5ff;font-size:8px!important;font-weight:950}
.cnpj-free-status-badge.is-active{background:#0c3020;color:#7de2aa}
.cnpj-free-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:13px}
.cnpj-free-field{padding:11px;border:1px solid #1c3145;border-radius:11px;background:#091827}.cnpj-free-field small{display:block;margin-bottom:3px;color:#6f8498;font-size:8px}.cnpj-free-field b{display:block;color:#dce7f2;font-size:10px;line-height:1.4}
.cnpj-free-cta{display:flex;align-items:center;justify-content:space-between;gap:13px;margin-top:13px;padding-top:13px;border-top:1px solid #1d3348}.cnpj-free-cta span{color:#8196aa;font-size:9px;line-height:1.45}.cnpj-free-cta a{flex:0 0 auto;padding:10px 12px;border-radius:9px;background:#168cff;color:#fff;text-decoration:none;font-size:9px;font-weight:950}

.transparency-clear{
  position:relative;
  padding:54px 0;
  background:linear-gradient(180deg,#07111d,#050b13);
  border-bottom:1px solid #172a40;
  color:#f4f8ff;
}
.transparency-clear-shell{width:min(1160px,92vw);margin:auto}
.transparency-clear-head{text-align:center;max-width:760px;margin:0 auto 24px}
.transparency-clear-head>span{color:#65bfff;font-size:10px;font-weight:950;letter-spacing:1.6px}
.transparency-clear-head h2{margin:8px 0 9px;font-size:clamp(26px,3.6vw,40px);line-height:1.05;letter-spacing:-1px}
.transparency-clear-head p{margin:0;color:#8498ae;font-size:12px;line-height:1.65}
.transparency-clear-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.transparency-clear-grid article{display:flex;align-items:flex-start;gap:12px;padding:18px;border:1px solid #20364e;border-radius:15px;background:linear-gradient(180deg,#0a1827,#07131f)}
.transparency-clear-icon{flex:0 0 auto;width:40px;height:40px;display:grid;place-items:center;border:1px solid #2a5c89;border-radius:11px;background:#0d2944;font-size:18px}
.transparency-clear-grid article>div:last-child{display:grid;gap:5px}
.transparency-clear-grid b{font-size:12px;color:#f7fbff}
.transparency-clear-grid small{font-size:10px;line-height:1.55;color:#8195aa}
.transparency-clear-links{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:18px;padding-top:17px;border-top:1px solid #182b40;color:#72869b;font-size:10px}
.transparency-clear-links a{color:#9fd6ff;text-decoration:none;font-weight:850}
.transparency-clear-links a:hover{text-decoration:underline}

@media(max-width:900px){.cnpj-free-shell{grid-template-columns:1fr;gap:28px}}
@media(max-width:700px){
  .transparency-clear{padding:42px 0}
  .transparency-clear-grid{grid-template-columns:1fr}
  .transparency-clear-grid article{padding:15px}
  .transparency-clear-links{justify-content:flex-start}
  .cnpj-free{padding:54px 0}.cnpj-free-benefits{grid-template-columns:1fr}.cnpj-free-row{grid-template-columns:1fr}.cnpj-free-fields{grid-template-columns:1fr}.cnpj-free-cta{display:grid}.cnpj-free-cta a{text-align:center}
}
@media(max-width:560px){
  .floating-whatsapp{right:13px;bottom:82px}
  .floating-whatsapp-icon{width:46px;height:46px;font-size:20px;box-shadow:0 8px 18px rgba(0,0,0,.24)}
  .floating-whatsapp-label{display:none}
  .transparency-clear-head{text-align:left}
  .transparency-clear-head h2{font-size:29px}
  .cnpj-free-card{padding:17px;border-radius:17px}.cnpj-free-copy h2{font-size:34px}.cnpj-free-row input{font-size:16px}
}
</style>`;

const CNPJ_SCRIPT = `
<script id="cnpj-free-script">
(function(){
  function digits(v){return String(v||'').replace(/\\D/g,'').slice(0,14)}
  function formatCnpj(v){
    var d=digits(v);
    if(d.length<=2)return d;
    if(d.length<=5)return d.slice(0,2)+'.'+d.slice(2);
    if(d.length<=8)return d.slice(0,2)+'.'+d.slice(2,5)+'.'+d.slice(5);
    if(d.length<=12)return d.slice(0,2)+'.'+d.slice(2,5)+'.'+d.slice(5,8)+'/'+d.slice(8);
    return d.slice(0,2)+'.'+d.slice(2,5)+'.'+d.slice(5,8)+'/'+d.slice(8,12)+'-'+d.slice(12);
  }
  function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]})}
  function dateBr(v){if(!v)return 'Não informado';var p=String(v).split('-');return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:String(v)}
  function value(v){return v===null||v===undefined||String(v).trim()===''?'Não informado':String(v)}
  function setStatus(text,error){var s=document.getElementById('cnpj-free-status');if(!s)return;s.textContent=text||'';s.className='cnpj-free-status'+(error?' is-error':'')}

  async function consultar(){
    var input=document.getElementById('cnpj-free-input');
    var btn=document.getElementById('cnpj-free-button');
    var result=document.getElementById('cnpj-free-result');
    var cnpj=digits(input&&input.value);
    if(cnpj.length!==14){setStatus('Digite um CNPJ válido com 14 números.',true);if(result)result.hidden=true;return}
    setStatus('Consultando dados cadastrais...',false);if(result)result.hidden=true;
    if(btn){btn.disabled=true;btn.textContent='CONSULTANDO...'}
    var controller=new AbortController();var timer=setTimeout(function(){controller.abort()},12000);
    try{
      var r=await fetch('https://brasilapi.com.br/api/cnpj/v1/'+encodeURIComponent(cnpj),{headers:{'Accept':'application/json'},signal:controller.signal});
      if(!r.ok){if(r.status===404)throw new Error('CNPJ não encontrado.');throw new Error('Não foi possível consultar esse CNPJ agora.')}
      var d=await r.json();
      var fantasia=value(d.nome_fantasia);
      var razao=value(d.razao_social);
      var situacao=value(d.descricao_situacao_cadastral);
      var ativo=/ATIVA/i.test(situacao);
      var local=[value(d.municipio),value(d.uf)].filter(function(x){return x!=='Não informado'}).join(' / ')||'Não informado';
      var html='';
      html+='<div class="cnpj-free-result-head"><div><small>EMPRESA ENCONTRADA</small><b>'+esc(fantasia==='Não informado'?razao:fantasia)+'</b><span>'+esc(razao)+'</span></div><span class="cnpj-free-status-badge'+(ativo?' is-active':'')+'">'+esc(situacao)+'</span></div>';
      html+='<div class="cnpj-free-fields">';
      html+='<div class="cnpj-free-field"><small>CNPJ</small><b>'+esc(formatCnpj(cnpj))+'</b></div>';
      html+='<div class="cnpj-free-field"><small>Matriz / filial</small><b>'+esc(value(d.descricao_identificador_matriz_filial))+'</b></div>';
      html+='<div class="cnpj-free-field"><small>Atividade principal</small><b>'+esc(value(d.cnae_fiscal_descricao))+'</b></div>';
      html+='<div class="cnpj-free-field"><small>Localidade</small><b>'+esc(local)+'</b></div>';
      html+='<div class="cnpj-free-field"><small>Início da atividade</small><b>'+esc(dateBr(d.data_inicio_atividade))+'</b></div>';
      html+='<div class="cnpj-free-field"><small>Natureza jurídica</small><b>'+esc(value(d.natureza_juridica))+'</b></div>';
      html+='</div>';
      html+='<div class="cnpj-free-cta"><span>Vai comprar um veículo dessa loja ou revenda? Consulte também o histórico do veículo antes de fechar negócio.</span><a href="#consulta">CONSULTAR VEÍCULO · R$ 18,90</a></div>';
      result.innerHTML=html;result.hidden=false;setStatus('Consulta concluída. Dados cadastrais públicos.',false);
      if(typeof window.cvTrack==='function')window.cvTrack('cnpj_consulta_realizada');
    }catch(e){
      var msg=e&&e.name==='AbortError'?'A consulta demorou mais que o esperado. Tente novamente.':(e&&e.message?e.message:'Não foi possível consultar o CNPJ agora.');
      setStatus(msg,true);if(result)result.hidden=true;
    }finally{clearTimeout(timer);if(btn){btn.disabled=false;btn.textContent='CONSULTAR CNPJ'}}
  }

  document.addEventListener('DOMContentLoaded',function(){
    var input=document.getElementById('cnpj-free-input');var btn=document.getElementById('cnpj-free-button');
    if(input){input.addEventListener('input',function(){this.value=formatCnpj(this.value)});input.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();consultar()}})}
    if(btn)btn.addEventListener('click',consultar);
    var nav=document.querySelector('.cv-links');
    if(nav&&!nav.querySelector('a[href="#cnpj-gratis"]')){var a=document.createElement('a');a.href='#cnpj-gratis';a.textContent='Consultar CNPJ';var contato=nav.querySelector('a[href="/contato.html"]');nav.insertBefore(a,contato||null)}
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
      if (!html.includes('id="floating-whatsapp-style"')) html = html.replace('</head>', `${WHATSAPP_CSS}\n</head>`);
      const resultMarker = '<div id="cv-result" class="cv-result"></div>';
      if (html.includes(resultMarker)) {
        const pieces = [];
        if (!html.includes('id="cnpj-gratis"')) pieces.push(CNPJ_HTML);
        if (!html.includes('id="transparencia-clara"')) pieces.push(TRANSPARENCY_HTML);
        if (pieces.length) html = html.replace(resultMarker, `${pieces.join('\n')}\n${resultMarker}`);
      }
      if (!html.includes('id="cnpj-free-script"')) html = html.replace('</body>', `${CNPJ_SCRIPT}\n</body>`);
      if (!html.includes('id="floating-whatsapp"')) html = html.replace('</body>', `${WHATSAPP_HTML}\n</body>`);

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
    console.error('WHATSAPP_PROXY:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'servico_indisponivel' }));
    }
  });

  req.pipe(upstream);
}

async function start() {
  const child = fork(require.resolve('./payment-proxy.js'), [], {
    env: { ...process.env, PORT: String(INNER_PORT) },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc']
  });

  child.on('exit', code => {
    console.error(`WHATSAPP_PROXY: aplicação interna encerrou (código ${code}).`);
    process.exit(code || 1);
  });

  try {
    await waitForPort(INNER_PORT);
  } catch (err) {
    console.error('WHATSAPP_PROXY:', err.message);
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const isHome = req.method === 'GET' && (pathname === '/' || pathname === '/index.html');
    proxy(req, res, isHome);
  });

  server.listen(PUBLIC_PORT, () => console.log(`WhatsApp, CNPJ e transparência ativos na porta ${PUBLIC_PORT}`));
}

start();
