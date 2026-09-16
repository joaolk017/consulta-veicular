'use strict';

const http = require('http');
const path = require('path');

const IS_OUTER_UI = path.basename(String(process.argv[1] || '')).toLowerCase() === 'recovery-ui-proxy.js';

if (IS_OUTER_UI) {
  const originalCreateServer = http.createServer.bind(http);

  const INJECT = `
<script id="cv-no-auto-scroll-script">
(function(){
  var nativeScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function(){
    try{
      if(this && (this.id==='result' || this.id==='status' || (this.closest && this.closest('#cv-inline-result')))) return;
    }catch(e){}
    return nativeScrollIntoView.apply(this, arguments);
  };

  var lockUntil = 0;
  var lockY = 0;
  var restoring = false;

  function armScrollLock(){
    lockY = window.scrollY || window.pageYOffset || 0;
    lockUntil = Date.now() + 1200;
  }

  document.addEventListener('click', function(e){
    var btn = e.target && e.target.closest ? e.target.closest('button') : null;
    if(!btn) return;
    var text = String(btn.textContent || '').toUpperCase();
    if(btn.id === 'cv-consult-btn' || btn.id === 'landing-consult-btn' || text.indexOf('CONSULTAR PLACA') >= 0 || text.indexOf('CONSULTAR VEÍCULO') >= 0 || text.indexOf('CONSULTAR VEICULO') >= 0){
      armScrollLock();
    }
  }, true);

  document.addEventListener('keydown', function(e){
    if(e.key !== 'Enter') return;
    var el = e.target;
    if(el && (el.id === 'cv-plate' || el.id === 'plate' || el.id === 'landing-plate')) armScrollLock();
  }, true);

  window.addEventListener('scroll', function(){
    if(restoring || Date.now() >= lockUntil) return;
    var nowY = window.scrollY || window.pageYOffset || 0;
    if(Math.abs(nowY - lockY) < 2) return;
    restoring = true;
    window.scrollTo(0, lockY);
    requestAnimationFrame(function(){ restoring = false; });
  }, {passive:true});
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
        } else captured.headers = statusMessageOrHeaders || {};
        return res;
      };

      res.end = function (chunk, encoding, callback) {
        try {
          if (chunk != null) {
            let body = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
            const headers = captured && captured.headers ? captured.headers : {};
            const contentType = String(headers['content-type'] || headers['Content-Type'] || res.getHeader('content-type') || '');
            if (contentType.includes('text/html') && !body.includes('id="cv-no-auto-scroll-script"')) {
              body = body.replace('</head>', INJECT + '\n</head>');
              chunk = Buffer.from(body, 'utf8');
              headers['content-length'] = String(chunk.length);
              delete headers['Content-Length'];
              if (captured) captured.headers = headers;
            }
          }
        } catch (err) {
          console.error('NO_AUTO_SCROLL:', err.message);
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

    return originalCreateServer(...args);
  };
}
