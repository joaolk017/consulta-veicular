'use strict';

const path = require('path');
const http = require('http');

const entrypoint = path.basename(String(process.argv[1] || '')).toLowerCase();

if (entrypoint === 'recovery-ui-proxy.js') {
  const priorCreateServer = http.createServer.bind(http);

  const INJECT = String.raw`<script id="cv-recovery-browser-render-fix">
(function(){
  function digits(v){return String(v||'').replace(/\D/g,'').slice(0,11)}
  function plate(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7)}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function setMsg(text,ok){var el=document.getElementById('cv-recover-msg');if(!el)return;el.textContent=text||'';el.className='cv-recover-msg '+(ok?'ok':'bad')}
  function finishButton(btn){if(btn){btn.disabled=false;btn.textContent='RECUPERAR CONSULTA'}}
  function remember(data){
    try{
      if(!data||!data.vehicle||!data.reportAccessToken||!data.reportAccessExpiresAt)return;
      var p=plate(data.vehicle.plate);if(!p)return;
      localStorage.setItem('cv_relatorio_pago_24h_'+p,JSON.stringify({plate:p,accessToken:data.reportAccessToken,expiresAt:Number(data.reportAccessExpiresAt),savedAt:Date.now()}));
    }catch(e){}
  }
  function simpleRow(label,value){
    if(value===undefined||value===null||String(value).trim()==='')return '';
    return '<div class="row"><span class="label">'+esc(label)+'</span><span class="value">'+esc(value)+'</span></div>';
  }
  function fallbackRender(v){
    var result=document.getElementById('result');
    if(!result)throw new Error('Área de resultado não encontrada nesta página.');
    var local=[v.city,v.state].filter(Boolean).join(' / ');
    var year=[v.year,v.modelYear].filter(Boolean).join(' / ');
    var rows='';
    rows+=simpleRow('Ano / modelo',year);rows+=simpleRow('Cor',v.color);rows+=simpleRow('Município / UF',local);rows+=simpleRow('Combustível',v.fuel);rows+=simpleRow('Tipo',v.type);rows+=simpleRow('RENAVAM',v.renavam);rows+=simpleRow('Chassi',v.chassis);rows+=simpleRow('Situação',v.status);rows+=simpleRow('Procedência',v.origin);
    var fipe='';
    if(v.fipe&&(v.fipe.value||v.fipe.numericValue)){
      var fv=v.fipe.value||Number(v.fipe.numericValue||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
      fipe='<div class="cv-fipe-card"><div class="cv-fipe-label">Valor de mercado · Tabela FIPE</div><div class="cv-fipe-value">'+esc(fv)+'</div></div>';
    }
    var restrictions='';
    if(Array.isArray(v.restrictions)){
      restrictions=v.restrictions.length?v.restrictions.map(function(x){return '<div class="cv-restriction">⚠️ '+esc(x)+'</div>'}).join(''):'<div class="success">✅ Nenhuma restrição informada na lista retornada.</div>';
    }
    result.innerHTML='<div class="vehicle-card"><div class="vehicle-top"><div class="vehicle-title"><div class="vehicle-icon">🚘</div><h2>Relatório veicular completo</h2></div><span class="paid-badge">✓ PIX CONFIRMADO</span></div><div class="plate-result">'+esc(v.plate||'')+'</div><div class="vehicle-name">'+esc(v.brand||'Não informado')+' · '+esc(v.model||'Não informado')+'</div></div><div class="cv-report-section"><div class="cv-report-section-title">🚘 Identificação do veículo</div><div class="cv-report-section-body">'+rows+'</div></div>'+fipe+(restrictions?'<div class="cv-report-section"><div class="cv-report-section-title">⚠️ Restrições registradas</div><div class="cv-report-section-body cv-restrictions">'+restrictions+'</div></div>':'')+'<div class="success">✅ Pagamento confirmado e consulta recuperada.</div><div class="report-actions"><button class="secondary-btn" onclick="consultar()">🔄 NOVA CONSULTA</button><button class="paybtn" onclick="salvarPDF()">📄 SALVAR / IMPRIMIR PDF</button></div>';
    result.classList.remove('hidden');
  }
  function renderRecovered(data,p){
    remember(data);
    try{window.ultimaPlacaConsultada=p}catch(e){}
    var hidden=document.getElementById('plate'),visible=document.getElementById('cv-plate');
    if(hidden)hidden.value=p;if(visible)visible.value=p;
    var rendered=false;
    try{
      if(typeof window.renderRelatorioCompleto==='function'){
        window.renderRelatorioCompleto(data.vehicle);
        var r=document.getElementById('result');
        rendered=!!(r&&r.innerHTML&&r.innerHTML.length>80&&!r.classList.contains('hidden'));
      }
    }catch(e){rendered=false}
    if(!rendered)fallbackRender(data.vehicle||{});
    try{if(typeof window.steps==='function')window.steps(3)}catch(e){}
  }
  window.cvRecoverPaidReport=function(){
    var p=plate((document.getElementById('cv-recover-plate')||{}).value);
    var cpf=digits((document.getElementById('cv-recover-cpf')||{}).value);
    var btn=document.getElementById('cv-recover-submit');
    if(p.length!==7||cpf.length!==11){setMsg('Informe a placa e o CPF usados no pagamento.',false);return}
    if(btn){btn.disabled=true;btn.textContent='PROCURANDO...'}
    setMsg('Verificando sua consulta paga...',true);

    var xhr=new XMLHttpRequest();
    xhr.open('POST','/api/consulta/recuperar-v2?browser=1&t='+Date.now(),true);
    xhr.timeout=65000;
    xhr.setRequestHeader('Content-Type','application/json');
    xhr.setRequestHeader('Accept','application/json');
    xhr.setRequestHeader('Cache-Control','no-store');

    xhr.onreadystatechange=function(){
      if(xhr.readyState!==4)return;
      var data={};
      try{data=JSON.parse(xhr.responseText||'{}')}catch(e){}
      if(xhr.status<200||xhr.status>=300||!data||data.paid!==true||!data.vehicle){
        finishButton(btn);
        setMsg((data&&data.mensagem)||'Não encontramos uma consulta válida para esses dados.',false);
        return;
      }
      try{
        renderRecovered(data,p);
        setMsg('Consulta recuperada com sucesso.',true);
        if(typeof window.cvCloseRecovery==='function')window.cvCloseRecovery();
        else {var modal=document.getElementById('cv-recovery-modal');if(modal)modal.classList.add('cv-hidden');document.body.classList.remove('no-scroll')}
        setTimeout(function(){var result=document.getElementById('result');if(result)result.scrollIntoView({behavior:'smooth',block:'start'})},100);
      }catch(e){setMsg(e&&e.message?e.message:'O pagamento foi encontrado, mas não foi possível exibir o relatório.',false)}
      finally{finishButton(btn)}
    };
    xhr.onerror=function(){finishButton(btn);setMsg('Falha de conexão ao recuperar a consulta. Tente novamente.',false)};
    xhr.ontimeout=function(){finishButton(btn);setMsg('A recuperação demorou além do esperado. Tente novamente; seu pagamento continua válido.',false)};
    xhr.send(JSON.stringify({placa:p,cpf:cpf}));
  };
})();
</script>`;

  http.createServer = function recoveryBrowserRenderCreateServer(...args) {
    const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
    const listener = args[listenerIndex];
    if (typeof listener !== 'function') return priorCreateServer(...args);

    args[listenerIndex] = function recoveryBrowserRenderListener(req, res) {
      let pathname = '/';
      try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (_) {}
      const isHome = req.method === 'GET' && (pathname === '/' || pathname === '/index.html');
      if (!isHome) return listener(req, res);

      const originalWriteHead = res.writeHead.bind(res);
      const originalEnd = res.end.bind(res);
      let captured = null;

      res.writeHead = function(statusCode, statusMessageOrHeaders, headersMaybe) {
        captured = { statusCode, statusMessage: null, headers: {} };
        if (typeof statusMessageOrHeaders === 'string') {
          captured.statusMessage = statusMessageOrHeaders;
          captured.headers = headersMaybe || {};
        } else {
          captured.headers = statusMessageOrHeaders || {};
        }
        return res;
      };

      res.end = function(chunk, encoding, callback) {
        try {
          if (chunk != null) {
            let body = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
            const headers = captured && captured.headers ? captured.headers : {};
            const type = String(headers['content-type'] || headers['Content-Type'] || res.getHeader('content-type') || '');
            if (type.includes('text/html') && !body.includes('id="cv-recovery-browser-render-fix"')) {
              body = body.replace('</body>', INJECT + '\n</body>');
              chunk = Buffer.from(body, 'utf8');
              headers['content-length'] = String(chunk.length);
              delete headers['Content-Length'];
              delete headers['content-encoding'];
              delete headers['transfer-encoding'];
              if (captured) captured.headers = headers;
            }
          }
        } catch (err) {
          console.error('RECOVERY_BROWSER_RENDER:', err.message);
        }
        if (captured) {
          if (captured.statusMessage) originalWriteHead(captured.statusCode, captured.statusMessage, captured.headers);
          else originalWriteHead(captured.statusCode, captured.headers);
          captured = null;
        }
        if (typeof encoding === 'function') return originalEnd(chunk, encoding);
        if (typeof callback === 'function') return originalEnd(chunk, encoding, callback);
        return originalEnd(chunk, encoding);
      };

      return listener(req, res);
    };

    return priorCreateServer(...args);
  };
}
