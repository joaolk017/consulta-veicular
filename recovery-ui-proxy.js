const http = require('http');
const net = require('net');
const { fork } = require('child_process');

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const INNER_PORT = Number(process.env.RECOVERY_UI_INNER_PORT || 15001);
const MAX_HTML_BYTES = 4 * 1024 * 1024;

const UI = `
<style id="cv-recovery-style">
#cv-recover-open{width:100%!important;height:42px!important;margin:8px 0 4px!important;border:1px solid #31577d!important;border-radius:11px!important;background:#0a1a2b!important;color:#bfe2ff!important;box-shadow:none!important;font-size:10px!important;font-weight:900!important;cursor:pointer}
#cv-recover-open:hover{background:#0d2741!important;border-color:#4a86bc!important}
.cv-recover-overlay{position:fixed;z-index:100000;inset:0;display:grid;place-items:center;padding:18px;background:rgba(2,6,12,.86);backdrop-filter:blur(6px)}
.cv-recover-overlay.cv-hidden{display:none!important}.cv-recover-modal{width:min(100%,480px);padding:22px;border:1px solid #31577d;border-radius:20px;background:linear-gradient(180deg,#0d1d2e,#07111c);box-shadow:0 30px 100px rgba(0,0,0,.62);color:#f4f8ff}.cv-recover-top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.cv-recover-top h2{margin:0 0 6px;font-size:21px}.cv-recover-top p{margin:0;color:#879bb0;font-size:11px;line-height:1.5}.cv-recover-close{width:36px!important;height:36px!important;margin:0!important;padding:0!important;border:1px solid #2a4058!important;border-radius:10px!important;background:#091522!important;color:#dce8f4!important;box-shadow:none!important}.cv-recover-field{margin-top:14px}.cv-recover-field label{display:block;margin-bottom:6px;color:#cbd8e5;font-size:11px;font-weight:850}.cv-recover-field input{width:100%;height:48px;border:1px solid #2d425a;border-radius:11px;background:#06101b;color:#fff;padding:0 13px;outline:none;font-size:15px}.cv-recover-field input:focus{border-color:#3997e8;box-shadow:0 0 0 3px rgba(57,151,232,.14)}.cv-recover-submit{width:100%!important;height:50px!important;margin:16px 0 0!important;border:0!important;border-radius:11px!important;background:linear-gradient(135deg,#188fff,#0864d2)!important;color:#fff!important;font-size:12px!important;font-weight:950!important;cursor:pointer}.cv-recover-msg{min-height:18px;margin-top:10px;font-size:11px;line-height:1.5;text-align:center}.cv-recover-msg.bad{color:#ffb8c2}.cv-recover-msg.ok{color:#91efba}.cv-recover-note{margin-top:12px;padding:10px;border:1px solid #263b51;border-radius:10px;background:#07121d;color:#71869b;font-size:9px;line-height:1.5}
.cv-report-section{margin:14px 0;border:1px solid #27384d;border-radius:16px;background:#09131f;overflow:hidden}.cv-report-section-title{padding:13px 15px;border-bottom:1px solid #223247;background:#0d1a29;font-size:12px;font-weight:950;color:#e7f1fb;letter-spacing:.2px}.cv-report-section-body{padding:0 14px}.cv-fipe-card{margin:14px 0;padding:17px;border:1px solid #246c48;border-radius:16px;background:linear-gradient(145deg,#0d2a1d,#091810)}.cv-fipe-label{color:#8fbda2;font-size:10px;font-weight:850;text-transform:uppercase;letter-spacing:.7px}.cv-fipe-value{margin:6px 0 3px;font-size:28px;font-weight:950;color:#e6fff0}.cv-fipe-meta{color:#83a893;font-size:10px;line-height:1.55}.cv-risk-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;padding:14px 0}.cv-risk-card{padding:12px;border:1px solid #2a394c;border-radius:12px;background:#0b1622;min-width:0}.cv-risk-card b{display:block;margin-bottom:5px;color:#cbd8e6;font-size:10px}.cv-risk-card span{font-size:10px;font-weight:850;line-height:1.35}.cv-risk-card.ok{border-color:#245b3f;background:#0b2118}.cv-risk-card.ok span{color:#84e9af}.cv-risk-card.warn{border-color:#7c6324;background:#2a230d}.cv-risk-card.warn span{color:#ffe296}.cv-risk-card.neutral span{color:#8494a6}.cv-restrictions{padding:14px 0}.cv-restriction{margin:7px 0;padding:10px 11px;border:1px solid #6d5620;border-radius:10px;background:#251e0b;color:#f6db8d;font-size:11px;line-height:1.45}.cv-report-note{margin:14px 0;padding:12px;border:1px solid #293b50;border-radius:12px;background:#08121e;color:#76899d;font-size:9.5px;line-height:1.55}.cv-report-source{display:inline-flex;align-items:center;gap:6px;margin-top:8px;padding:5px 8px;border:1px solid #28557b;border-radius:999px;background:#0c2236;color:#9acdf3;font-size:9px;font-weight:850}
@media(max-width:560px){.cv-recover-overlay{padding:0;align-items:end}.cv-recover-modal{border-radius:20px 20px 0 0;padding:19px}.cv-recover-top h2{font-size:19px}.cv-risk-grid{grid-template-columns:1fr}.cv-fipe-value{font-size:24px}}
</style>
<div id="cv-recovery-modal" class="cv-recover-overlay cv-hidden" role="dialog" aria-modal="true" aria-labelledby="cv-recover-title">
  <div class="cv-recover-modal">
    <div class="cv-recover-top"><div><h2 id="cv-recover-title">Recuperar consulta paga</h2><p>Use a mesma placa e o mesmo CPF informado no pagamento.</p></div><button class="cv-recover-close" type="button" onclick="cvCloseRecovery()" aria-label="Fechar">✕</button></div>
    <div class="cv-recover-field"><label for="cv-recover-plate">Placa</label><input id="cv-recover-plate" maxlength="8" autocomplete="off" placeholder="ABC1D23"></div>
    <div class="cv-recover-field"><label for="cv-recover-cpf">CPF usado no PIX</label><input id="cv-recover-cpf" inputmode="numeric" autocomplete="off" maxlength="14" placeholder="000.000.000-00"></div>
    <button id="cv-recover-submit" class="cv-recover-submit" type="button" onclick="cvRecoverPaidReport()">RECUPERAR CONSULTA</button>
    <div id="cv-recover-msg" class="cv-recover-msg"></div>
    <div class="cv-recover-note">A recuperação fica disponível por até 24 horas após a liberação. O CPF é usado apenas para localizar a compra correspondente; o sistema armazena uma referência criptográfica, não o número completo.</div>
  </div>
</div>
<script id="cv-recovery-script">
(function(){
  function plate(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7)}
  function digits(v){return String(v||'').replace(/\D/g,'').slice(0,11)}
  function cpfMask(v){var d=digits(v);return d.replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2')}
  function store(data){
    try{
      if(!data||!data.vehicle||!data.reportAccessToken||!data.reportAccessExpiresAt)return;
      var p=plate(data.vehicle.plate);if(!p)return;
      localStorage.setItem('cv_relatorio_pago_24h_'+p,JSON.stringify({plate:p,accessToken:data.reportAccessToken,expiresAt:Number(data.reportAccessExpiresAt),savedAt:Date.now()}));
    }catch(e){}
  }
  function msg(text,ok){var el=document.getElementById('cv-recover-msg');if(!el)return;el.textContent=text||'';el.className='cv-recover-msg '+(ok?'ok':'bad')}
  window.cvOpenRecovery=function(){
    var modal=document.getElementById('cv-recovery-modal'),p=document.getElementById('cv-recover-plate');
    var source=document.getElementById('cv-plate')||document.getElementById('plate');
    if(p&&source&&source.value)p.value=plate(source.value);
    msg('',false);if(modal)modal.classList.remove('cv-hidden');document.body.classList.add('no-scroll');setTimeout(function(){if(p)p.focus()},60);
  };
  window.cvCloseRecovery=function(){var modal=document.getElementById('cv-recovery-modal');if(modal)modal.classList.add('cv-hidden');document.body.classList.remove('no-scroll')};
  window.cvRecoverPaidReport=async function(){
    var p=plate((document.getElementById('cv-recover-plate')||{}).value),cpf=digits((document.getElementById('cv-recover-cpf')||{}).value),btn=document.getElementById('cv-recover-submit');
    if(p.length!==7||cpf.length!==11){msg('Informe a placa e o CPF usados no pagamento.',false);return}
    if(btn){btn.disabled=true;btn.textContent='PROCURANDO...'}msg('Verificando sua consulta paga...',true);
    try{
      var r=await fetch('/api/consulta/recuperar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({placa:p,cpf:cpf}),cache:'no-store'});
      var data={};try{data=await r.json()}catch(e){}
      if(!r.ok||!data||data.paid!==true||!data.vehicle)throw new Error(data.mensagem||'Não encontramos uma consulta válida para esses dados.');
      store(data);
      try{ultimaPlacaConsultada=p}catch(e){}
      var hidden=document.getElementById('plate'),visible=document.getElementById('cv-plate');if(hidden)hidden.value=p;if(visible)visible.value=p;
      if(typeof renderRelatorioCompleto==='function')renderRelatorioCompleto(data.vehicle);else throw new Error('Não foi possível abrir o relatório nesta página.');
      if(typeof steps==='function')steps(3);
      msg('Consulta recuperada com sucesso.',true);window.cvCloseRecovery();
      setTimeout(function(){var result=document.getElementById('result');if(result)result.scrollIntoView({behavior:'smooth',block:'start'})},120);
    }catch(e){msg(e.message||'Não foi possível recuperar a consulta.',false)}finally{if(btn){btn.disabled=false;btn.textContent='RECUPERAR CONSULTA'}}
  };
  document.addEventListener('DOMContentLoaded',function(){
    var cpf=document.getElementById('cv-recover-cpf'),p=document.getElementById('cv-recover-plate'),modal=document.getElementById('cv-recovery-modal');
    if(cpf)cpf.addEventListener('input',function(e){e.target.value=cpfMask(e.target.value)});
    if(p)p.addEventListener('input',function(e){e.target.value=plate(e.target.value)});
    if(modal)modal.addEventListener('click',function(e){if(e.target===modal)window.cvCloseRecovery()});
  });
})();
</script>
<script id="cv-fontedata-report-script">
(function(){
  var previous=window.renderRelatorioCompleto;
  function safe(v){return String(v===undefined||v===null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})}
  function present(v){return v!==undefined&&v!==null&&String(v).trim()!==''}
  function display(v){return present(v)?safe(v):'Não informado'}
  function row(label,value){return '<div class="row"><span class="label">'+safe(label)+'</span><span class="value">'+display(value)+'</span></div>'}
  function section(title,body){return body?'<div class="cv-report-section"><div class="cv-report-section-title">'+safe(title)+'</div><div class="cv-report-section-body">'+body+'</div></div>':''}
  function risk(label,value){var cls='neutral',text='⚪ Não verificado';if(value===true){cls='warn';text='⚠️ Ocorrência indicada'}else if(value===false){cls='ok';text='✅ Nada consta'}return '<div class="cv-risk-card '+cls+'"><b>'+safe(label)+'</b><span>'+text+'</span></div>'}
  function hasTechnical(t){if(!t)return false;return Object.keys(t).some(function(k){return present(t[k])})}

  window.renderRelatorioCompleto=function(v){
    if(!v||v.source!=='fontedata'){
      if(typeof previous==='function')return previous(v||{});
      return;
    }
    var result=document.getElementById('result');if(!result)return;
    var plate=v.plate||'',brand=v.brand||'Não informado',model=v.model||'Não informado';
    var year=(v.year&&v.modelYear&&String(v.year)!==String(v.modelYear))?String(v.year)+' / '+String(v.modelYear):(v.modelYear||v.year||'Não informado');
    var local=[v.city,v.state].filter(Boolean).join(' / ')||'Não informado';
    var id='';
    id+=row('Ano / Ano-modelo',year);id+=row('Cor',v.color);id+=row('Município / UF',local);id+=row('Combustível',v.fuel);id+=row('Tipo do veículo',v.type);id+=row('RENAVAM',v.renavam);id+=row('Chassi',v.chassis);id+=row('Situação do veículo',v.status);id+=row('Procedência',v.origin);if(present(v.exerciseYear))id+=row('Ano de exercício',v.exerciseYear);

    var fipe='';
    if(v.fipe&&(present(v.fipe.value)||present(v.fipe.numericValue))){
      var value=present(v.fipe.value)?v.fipe.value:(Number(v.fipe.numericValue)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
      var meta=[];if(present(v.fipe.model))meta.push(v.fipe.model);if(present(v.fipe.code))meta.push('Código FIPE '+v.fipe.code);if(present(v.fipe.referenceMonth))meta.push('Referência: '+v.fipe.referenceMonth);
      fipe='<div class="cv-fipe-card"><div class="cv-fipe-label">Valor de mercado · Tabela FIPE</div><div class="cv-fipe-value">'+safe(value)+'</div><div class="cv-fipe-meta">'+safe(meta.join(' · ')||'Valor informado pela fonte consultada')+'</div></div>';
    }

    var ind=v.indicators||{};
    var risks='<div class="cv-risk-grid">'+risk('Roubo / furto',ind.theft)+risk('Leilão',ind.auction)+risk('Recall',ind.recall)+risk('RENAJUD',ind.renajud)+risk('RENAINF / infrações',ind.renainf)+risk('Comunicação de venda',ind.saleCommunication)+risk('Pendência documental',ind.documentationPending)+risk('Remarcação de chassi',ind.chassisRemarked)+'</div>';

    var restrictions='';
    if(Array.isArray(v.restrictions)){
      if(v.restrictions.length){restrictions='<div class="cv-restrictions">'+v.restrictions.map(function(item){return '<div class="cv-restriction">⚠️ '+safe(item)+'</div>'}).join('')+'</div>'}
      else restrictions='<div class="success" style="margin:14px 0">✅ Nenhuma restrição informada na lista retornada.</div>';
    }else restrictions='<div class="cv-report-note">⚪ A lista de restrições não foi disponibilizada nesta consulta. Isso não deve ser interpretado como ausência de restrições.</div>';

    var tech='';
    var t=v.technical||{};
    if(hasTechnical(t)){tech+=row('Motor',t.engine);tech+=row('Câmbio',t.transmission);tech+=row('Cilindrada',t.displacement);tech+=row('Potência',t.power);tech+=row('Número de eixos',t.axles);tech+=row('Carroceria',t.bodyType);tech+=row('Categoria',t.category);tech+=row('Espécie',t.species);tech+=row('Peso bruto total',t.grossWeight);tech+=row('Capacidade de carga',t.loadCapacity);tech+=row('Capacidade máxima de tração',t.maxTraction);tech+=row('Passageiros',t.passengers);if(present(t.chassisRemarkDescription))tech+=row('Observação do chassi',t.chassisRemarkDescription)}

    var docs='';var d=v.documents||{};if(present(d.crvIssuedAt))docs+=row('Emissão CRV',d.crvIssuedAt);if(present(d.crlvIssuedAt))docs+=row('Emissão CRLV',d.crlvIssuedAt);

    result.innerHTML='<div class="vehicle-card"><div class="vehicle-top"><div class="vehicle-title"><div class="vehicle-icon">🚘</div><h2>Relatório veicular completo</h2></div><span class="paid-badge">✓ PIX CONFIRMADO</span></div><div class="plate-result">'+safe(plate)+'</div><div class="vehicle-name">'+safe(brand)+' · '+safe(model)+'</div><div class="cv-report-source">✓ Dados veiculares enriquecidos</div></div>'+section('🚘 Identificação do veículo',id)+fipe+section('🛡️ Situação e indicadores',risks)+section('⚠️ Restrições registradas',restrictions)+(tech?section('🔧 Dados técnicos',tech):'')+(docs?section('📄 Documentação',docs):'')+'<div class="cv-report-note"><b>Importante:</b> os dados dependem da disponibilidade e atualização das fontes consultadas. “Não verificado” não significa “Nada consta”. Valores FIPE são referência média de mercado. Identificadores sensíveis são exibidos de forma parcial.</div><div class="success">✅ Pagamento confirmado e relatório liberado. Você pode reabrir esta consulta por até 24 horas sem uma nova cobrança da base veicular.</div><div class="report-actions"><button class="secondary-btn" onclick="consultar()">🔄 NOVA CONSULTA</button><button class="paybtn" onclick="salvarPDF()">📄 SALVAR / IMPRIMIR PDF</button></div>';
    result.classList.remove('hidden');if(typeof steps==='function')steps(3);
  };
})();
</script>`;

function waitForPort(port, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => { socket.destroy(); if (Date.now() - started >= timeoutMs) reject(new Error('Aplicação interna não iniciou a tempo.')); else setTimeout(attempt, 200); });
    };
    attempt();
  });
}

function proxy(req, res, injectHome) {
  const headers = { ...req.headers, host: `127.0.0.1:${INNER_PORT}` };
  if (injectHome) headers['accept-encoding'] = 'identity';
  const upstream = http.request({ hostname: '127.0.0.1', port: INNER_PORT, path: req.url, method: req.method, headers }, upstreamRes => {
    if (!injectHome || !String(upstreamRes.headers['content-type'] || '').includes('text/html')) {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);upstreamRes.pipe(res);return;
    }
    const chunks=[];let size=0;
    upstreamRes.on('data',c=>{size+=c.length;if(size<=MAX_HTML_BYTES)chunks.push(c)});
    upstreamRes.on('end',()=>{
      if(size>MAX_HTML_BYTES){res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Página excedeu o limite de renderização.');}
      let html=Buffer.concat(chunks).toString('utf8');
      const marker='<div id="cv-error" class="cv-error" aria-live="polite"></div>';
      if(html.includes(marker)&&!html.includes('id="cv-recover-open"')) html=html.replace(marker,marker+'<button id="cv-recover-open" type="button" onclick="cvOpenRecovery()">🔓 JÁ PAGOU? RECUPERAR CONSULTA</button>');
      if(!html.includes('id="cv-recovery-style"')) html=html.replace('</body>',UI+'\n</body>');
      html=html.replace('Relatório liberado por até 24h neste navegador','Relatório recuperável por 24h com CPF + placa');
      const body=Buffer.from(html,'utf8');const out={...upstreamRes.headers,'content-length':String(body.length),'cache-control':'no-store, no-cache, must-revalidate, max-age=0'};delete out['content-encoding'];delete out['transfer-encoding'];res.writeHead(upstreamRes.statusCode||200,out);res.end(body);
    });
  });
  upstream.on('error',err=>{console.error('RECOVERY_UI:',err.message);if(!res.headersSent){res.writeHead(502,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'servico_indisponivel'}));}});
  req.pipe(upstream);
}

async function start(){
  const child=fork(require.resolve('./analytics-proxy.js'),[],{env:{...process.env,PORT:String(INNER_PORT)},stdio:['inherit','inherit','inherit','ipc']});
  child.on('exit',code=>{console.error(`RECOVERY_UI: aplicação interna encerrou (código ${code}).`);process.exit(code||1)});
  try{await waitForPort(INNER_PORT)}catch(err){console.error('RECOVERY_UI:',err.message);process.exit(1)}
  const server=http.createServer((req,res)=>{let pathname='/';try{pathname=new URL(req.url,'http://localhost').pathname}catch(_){}const isHome=req.method==='GET'&&(pathname==='/'||pathname==='/index.html');proxy(req,res,isHome)});
  server.listen(PUBLIC_PORT,()=>console.log(`Recuperação de consulta paga ativa na porta ${PUBLIC_PORT}`));
}
start();
