'use strict';

const http = require('http');
const path = require('path');

const entrypoint = path.basename(String(process.argv[1] || '')).toLowerCase();

if (entrypoint === 'recovery-ui-proxy.js') {
  const priorCreateServer = http.createServer.bind(http);

  function patchHtml(input) {
    let html = String(input || '');
    if (!html.includes('id="cv-gravame-modal"')) return html;

    html = html.replace(
      /<input id="cv-gravame-plate"\s+readonly>/i,
      '<input id="cv-gravame-plate" maxlength="7" autocomplete="off" autocapitalize="characters" placeholder="ABC1D23" style="text-transform:uppercase">'
    );

    html = html.replace(
      /window\.cvOpenGravame=async function\(\)\{[\s\S]*?\};\s*window\.cvCloseGravame=/,
      `window.cvOpenGravame=async function(){
        state.plate=currentPlate();
        if(state.plate){
          var old=saved(state.plate);
          if(old){
            state.paymentToken=old.paymentToken;
            state.expiresAt=old.expiresAt;
            var modal=document.getElementById('cv-gravame-modal');
            if(modal)modal.classList.remove('cv-hidden');
            document.body.classList.add('no-scroll');
            msg('Abrindo sua consulta de gravame já paga...');
            try{await consult(old.paymentToken)}catch(e){try{localStorage.removeItem(storageKey(state.plate))}catch(_){}msg(e.message)}
            return;
          }
        }
        var plateInput=document.getElementById('cv-gravame-plate');
        if(plateInput)plateInput.value=state.plate||'';
        document.getElementById('cv-gravame-form').classList.remove('cv-hidden-step');
        document.getElementById('cv-gravame-pix').classList.add('cv-hidden-step');
        document.getElementById('cv-gravame-pixcontent').innerHTML='';
        msg('');
        document.getElementById('cv-gravame-modal').classList.remove('cv-hidden');
        document.body.classList.add('no-scroll');
        if(!state.plate&&plateInput)setTimeout(function(){plateInput.focus()},80);
      };
      window.cvCloseGravame=`
    );

    html = html.replace(
      "window.cvCreateGravamePix=async function(){var name=",
      "window.cvCreateGravamePix=async function(){var plateInput=document.getElementById('cv-gravame-plate'),entered=plate(plateInput&&plateInput.value);if(!(/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(entered)||/^[A-Z]{3}[0-9]{4}$/.test(entered))){msg('Informe uma placa válida, como ABC1D23.');if(plateInput)plateInput.focus();return}state.plate=entered;if(plateInput)plateInput.value=entered;var existing=saved(entered);if(existing){state.paymentToken=existing.paymentToken;state.expiresAt=existing.expiresAt;msg('Abrindo sua consulta de gravame já paga...');try{await consult(existing.paymentToken)}catch(e){try{localStorage.removeItem(storageKey(entered))}catch(_){}msg(e.message)}return}var name="
    );

    if (!html.includes('id="cv-gravame-direct-mobile-style"')) {
      html = html.replace('</head>', `<style id="cv-gravame-direct-mobile-style">
#cv-gravame-plate{text-transform:uppercase;letter-spacing:2px;font-weight:900}
</style>\n</head>`);
    }

    return html;
  }

  http.createServer = function gravameDirectMobileCreateServer(...args) {
    const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
    const listener = args[listenerIndex];
    if (typeof listener !== 'function') return priorCreateServer(...args);

    args[listenerIndex] = function gravameDirectMobileListener(req, res) {
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
            if (type.includes('text/html')) {
              const patched = patchHtml(body);
              if (patched !== body) {
                chunk = Buffer.from(patched, 'utf8');
                headers['content-length'] = String(chunk.length);
                delete headers['Content-Length'];
                delete headers['content-encoding'];
                delete headers['transfer-encoding'];
                if (captured) captured.headers = headers;
              }
            }
          }
        } catch (err) {
          console.error('GRAVAME_DIRECT_MOBILE:', err.message);
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
