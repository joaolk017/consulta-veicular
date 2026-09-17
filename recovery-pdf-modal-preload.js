'use strict';

const path = require('path');
const http = require('http');

const entrypoint = path.basename(String(process.argv[1] || '')).toLowerCase();

if (entrypoint === 'recovery-ui-proxy.js') {
  const priorCreateServer = http.createServer.bind(http);

  const INJECT = String.raw`<style id="cv-recovery-pdf-modal-style">
#cv-recover-pdf-submit{width:100%!important;height:50px!important;margin:10px 0 0!important;border:1px solid #2d6f95!important;border-radius:11px!important;background:linear-gradient(135deg,#103a57,#0b2940)!important;color:#dff3ff!important;font-size:12px!important;font-weight:950!important;cursor:pointer}
#cv-recover-pdf-submit:hover{filter:brightness(1.08)}
#cv-recover-pdf-submit:disabled{opacity:.58!important;cursor:wait!important}
</style>
<script id="cv-recovery-pdf-modal-script">
(function(){
  function plate(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7)}
  function digits(v){return String(v||'').replace(/\D/g,'').slice(0,11)}
  function msg(text,ok){var el=document.getElementById('cv-recover-msg');if(!el)return;el.textContent=text||'';el.className='cv-recover-msg '+(ok?'ok':'bad')}

  function addButton(){
    var recover=document.getElementById('cv-recover-submit');
    if(!recover||document.getElementById('cv-recover-pdf-submit'))return;
    var btn=document.createElement('button');
    btn.id='cv-recover-pdf-submit';
    btn.type='button';
    btn.textContent='📄 RECUPERAR EM PDF';
    btn.onclick=function(){window.cvRecoverPaidPdf()};
    recover.insertAdjacentElement('afterend',btn);
  }

  window.cvRecoverPaidPdf=function(){
    var p=plate((document.getElementById('cv-recover-plate')||{}).value);
    var cpf=digits((document.getElementById('cv-recover-cpf')||{}).value);
    var btn=document.getElementById('cv-recover-pdf-submit');
    if(p.length!==7||cpf.length!==11){msg('Informe a placa e o CPF usados no pagamento.',false);return}

    if(btn){btn.disabled=true;btn.textContent='GERANDO PDF...'}
    msg('Validando o pagamento e preparando o PDF...',true);

    var xhr=new XMLHttpRequest();
    xhr.open('POST','/api/consulta/recuperar-pdf?t='+Date.now(),true);
    xhr.responseType='blob';
    xhr.timeout=65000;
    xhr.setRequestHeader('Content-Type','application/json');
    xhr.setRequestHeader('Cache-Control','no-store');

    function finish(){if(btn){btn.disabled=false;btn.textContent='📄 RECUPERAR EM PDF'}}

    xhr.onload=function(){
      if(xhr.status>=200&&xhr.status<300){
        var url=URL.createObjectURL(xhr.response),a=document.createElement('a');
        a.href=url;a.download='consulta_veicular_'+p+'.pdf';
        document.body.appendChild(a);a.click();a.remove();
        setTimeout(function(){URL.revokeObjectURL(url)},15000);
        msg('PDF da consulta recuperado com sucesso.',true);
        finish();
        return;
      }
      if(xhr.status===403||xhr.status===404)msg('Não encontramos uma consulta paga válida para essa placa e CPF.',false);
      else msg('Não foi possível gerar o PDF agora. Tente novamente.',false);
      finish();
    };
    xhr.onerror=function(){msg('Falha de conexão ao gerar o PDF. Tente novamente.',false);finish()};
    xhr.ontimeout=function(){msg('A geração do PDF demorou além do esperado. Tente novamente.',false);finish()};
    xhr.send(JSON.stringify({placa:p,cpf:cpf}));
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',addButton);else addButton();
  var obs=new MutationObserver(addButton);
  document.addEventListener('DOMContentLoaded',function(){obs.observe(document.body,{childList:true,subtree:true})});
})();
</script>`;

  http.createServer = function recoveryPdfModalCreateServer(...args) {
    const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
    const listener = args[listenerIndex];
    if (typeof listener !== 'function') return priorCreateServer(...args);

    args[listenerIndex] = function recoveryPdfModalListener(req, res) {
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
        } else captured.headers = statusMessageOrHeaders || {};
        return res;
      };

      res.end = function(chunk, encoding, callback) {
        try {
          if (chunk != null) {
            let body = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
            const headers = captured && captured.headers ? captured.headers : {};
            const type = String(headers['content-type'] || headers['Content-Type'] || res.getHeader('content-type') || '');
            if (type.includes('text/html') && !body.includes('id="cv-recovery-pdf-modal-script"')) {
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
          console.error('RECOVERY_PDF_MODAL:', err.message);
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
