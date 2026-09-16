'use strict';

const http = require('http');
const path = require('path');

const IS_OUTER_UI = path.basename(String(process.argv[1] || '')).toLowerCase() === 'recovery-ui-proxy.js';

if (IS_OUTER_UI) {
  const originalCreateServer = http.createServer.bind(http);

  const INJECT = `
<style id="cv-falcon-free-style">
.cv-falcon-free-note{margin:12px 0 0;padding:12px 14px;border:1px solid #246c48;border-radius:12px;background:#0b2118;color:#96e8b7;font-size:11px;line-height:1.55;text-align:center}.cv-falcon-free-note b{color:#dcffea}.found.cv-falcon-free-badge{color:#9cf0bc!important;background:#0d2b1d!important;border-color:#267148!important}
</style>
<script id="cv-falcon-free-script">
(function(){
  function markFreePreview(){
    var result=document.getElementById('result');
    if(!result||result.classList.contains('hidden'))return;
    if(result.querySelector('.paid-badge'))return;
    var found=result.querySelector('.found');
    var card=result.querySelector('.vehicle-card');
    if(!found||!card)return;
    found.textContent='✓ GRÁTIS • FALCON';
    found.classList.add('cv-falcon-free-badge');
    var title=card.querySelector('.vehicle-title h2');
    if(title)title.textContent='Consulta inicial gratuita';
    if(!document.getElementById('cv-falcon-free-note')){
      var note=document.createElement('div');
      note.id='cv-falcon-free-note';
      note.className='cv-falcon-free-note';
      note.innerHTML='✅ <b>Consulta básica gratuita realizada pela Falcon.</b><br>Nenhuma cobrança foi feita. O pagamento de R$ 18,90 é somente para liberar o relatório completo.';
      card.insertAdjacentElement('afterend',note);
    }
    var unlock=result.querySelector('.unlock h3');
    if(unlock)unlock.textContent='Relatório completo com histórico e restrições';
  }
  document.addEventListener('DOMContentLoaded',function(){
    var result=document.getElementById('result');
    if(result){
      new MutationObserver(function(){setTimeout(markFreePreview,0)}).observe(result,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
      markFreePreview();
    }
  });
})();
</script>`;

  http.createServer = function (...args) {
    const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
    const listener = args[listenerIndex];
    if (typeof listener !== 'function') return originalCreateServer(...args);

    args[listenerIndex] = function (req, res) {
      let pathname = '/';
      try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (_) {}
      const isHome = req.method === 'GET' && (pathname === '/' || pathname === '/index.html');
      if (!isHome) return listener(req, res);

      const originalWriteHead = res.writeHead.bind(res);
      const originalEnd = res.end.bind(res);
      let captured = null;

      res.writeHead = function (statusCode, statusMessageOrHeaders, headersMaybe) {
        captured = { statusCode, statusMessage: null, headers: {} };
        if (typeof statusMessageOrHeaders === 'string') {
          captured.statusMessage = statusMessageOrHeaders;
          captured.headers = headersMaybe || {};
        } else {
          captured.headers = statusMessageOrHeaders || {};
        }
        return res;
      };

      res.end = function (chunk, encoding, callback) {
        try {
          if (chunk != null) {
            const enc = typeof encoding === 'string' ? encoding : 'utf8';
            let body = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
            const headers = captured && captured.headers ? captured.headers : {};
            const contentType = String(headers['content-type'] || headers['Content-Type'] || res.getHeader('content-type') || '');
            if (contentType.includes('text/html') && !body.includes('id="cv-falcon-free-script"')) {
              body = body.replace('</body>', INJECT + '\n</body>');
              chunk = Buffer.from(body, 'utf8');
              const length = String(chunk.length);
              headers['content-length'] = length;
              delete headers['Content-Length'];
              if (captured) captured.headers = headers;
            }
          }
        } catch (_) {}

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

    return originalCreateServer(...args);
  };
}
