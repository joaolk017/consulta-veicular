'use strict';

const http = require('http');
const path = require('path');

const IS_OUTER_UI = path.basename(String(process.argv[1] || '')).toLowerCase() === 'recovery-ui-proxy.js';

if (IS_OUTER_UI) {
  const originalCreateServer = http.createServer.bind(http);

  const INJECT = `
<style id="cv-gravame-home-style">
.services-grid.cv-with-gravame-home{grid-template-columns:minmax(360px,1.12fr) minmax(280px,.88fr) minmax(280px,.88fr)!important;align-items:stretch!important}
.services-grid.cv-with-gravame-home>.card,.services-grid.cv-with-gravame-home>.cv-fipe-hero,.services-grid.cv-with-gravame-home>.cv-gravame-home{height:100%}
.cv-gravame-home{position:relative;overflow:hidden;padding:30px;border:1px solid rgba(73,139,225,.68);border-radius:28px;background:linear-gradient(155deg,rgba(14,39,73,.99),rgba(7,21,39,.99));box-shadow:0 35px 100px rgba(0,0,0,.48),0 0 55px rgba(39,112,224,.10)}
.cv-gravame-home-glow{position:absolute;width:250px;height:250px;right:-80px;top:-80px;border-radius:50%;background:#3389f0;filter:blur(80px);opacity:.16}
.cv-gravame-home-icon{position:relative;display:grid;place-items:center;width:54px;height:54px;border:1px solid #315f9a;border-radius:16px;background:#102c50;font-size:25px}
.cv-gravame-home-tag{position:relative;display:block;margin-top:17px;color:#7eb7ff;font-size:10px;font-weight:950;letter-spacing:1.4px}
.cv-gravame-home h2{position:relative;margin:7px 0 9px;font-size:clamp(30px,3.2vw,44px);line-height:1;letter-spacing:-1.4px}
.cv-gravame-home h2 strong{color:#7eb7ff}.cv-gravame-home>p{position:relative;margin:0 0 15px;color:#a7b9d0;font-size:12px;line-height:1.55}
.cv-gravame-home-list{position:relative;display:grid;gap:7px;margin:0 0 15px}.cv-gravame-home-list span{display:flex;gap:7px;align-items:flex-start;color:#afc1d8;font-size:10px;line-height:1.45}.cv-gravame-home-list b{color:#83bcff}
.cv-gravame-home-input{position:relative;width:100%;height:48px;border:1px solid #315a8f;border-radius:11px;background:#08182b;color:#fff;text-align:center;text-transform:uppercase;font-size:18px;font-weight:900;letter-spacing:3px;outline:none}.cv-gravame-home-input:focus{border-color:#4b98f3;box-shadow:0 0 0 3px rgba(75,152,243,.14)}
.cv-gravame-home-price{position:relative;margin:13px 0 6px;font-size:31px;font-weight:950}.cv-gravame-home-price small{font-size:10px;color:#8297b1;font-weight:800}
.cv-gravame-home-btn{position:relative;width:100%!important;height:50px!important;margin:4px 0 0!important;border:1px solid #4a98f3!important;border-radius:11px!important;background:linear-gradient(135deg,#2789ef,#1559b7)!important;color:#fff!important;font-size:11px!important;font-weight:950!important;box-shadow:0 13px 30px rgba(29,110,218,.25)!important;cursor:pointer}
.cv-gravame-home-msg{position:relative;min-height:17px;padding-top:7px;color:#ffb9c3;font-size:9px;text-align:center}.cv-gravame-home-note{position:relative;margin-top:5px;color:#748ba6;font-size:8px;line-height:1.45;text-align:center}
@media(max-width:1050px){.services-grid.cv-with-gravame-home{grid-template-columns:1fr 1fr!important}.services-grid.cv-with-gravame-home>main.card{grid-column:1/-1}}
@media(max-width:700px){.services-grid.cv-with-gravame-home{grid-template-columns:1fr!important}.services-grid.cv-with-gravame-home>main.card{grid-column:auto}.cv-gravame-home{padding:20px;border-radius:20px}.cv-gravame-home h2{font-size:34px}}
</style>
<script id="cv-gravame-home-script">
(function(){
  function normal(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7)}
  function valid(v){return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(v)||/^[A-Z]{3}[0-9]{4}$/.test(v)}
  function msg(t){var e=document.getElementById('cv-gravame-home-msg');if(e)e.textContent=t||''}
  function addCard(){
    if(document.getElementById('cv-gravame-home'))return;
    var fipe=document.querySelector('.cv-fipe-hero');
    if(!fipe)return;
    var grid=fipe.parentElement;
    if(!grid||!grid.classList.contains('services-grid'))return;
    grid.classList.add('cv-with-gravame-home');
    var card=document.createElement('aside');
    card.id='cv-gravame-home';
    card.className='cv-gravame-home';
    card.setAttribute('aria-label','Consulta de gravame detalhado');
    card.innerHTML='<div class="cv-gravame-home-glow"></div><div class="cv-gravame-home-icon">🔐</div><span class="cv-gravame-home-tag">CONSULTA DETALHADA</span><h2>Gravame<br><strong>Veicular</strong></h2><p>Consulte pela placa se existem informações de alienação ou financiamento vinculadas ao veículo.</p><div class="cv-gravame-home-list"><span><b>✓</b> Situação do gravame</span><span><b>✓</b> Agente financeiro, quando disponível</span><span><b>✓</b> Dados de restrição e contrato, quando disponíveis</span></div><input id="cv-gravame-home-plate" class="cv-gravame-home-input" maxlength="7" autocomplete="off" placeholder="ABC1D23" aria-label="Placa para consulta de gravame"><div class="cv-gravame-home-price">R$ 9,90 <small>por consulta</small></div><button class="cv-gravame-home-btn" type="button" id="cv-gravame-home-btn">CONSULTAR GRAVAME DETALHADO</button><div id="cv-gravame-home-msg" class="cv-gravame-home-msg"></div><div class="cv-gravame-home-note">Pagamento via PIX. A disponibilidade dos campos depende da fonte consultada.</div>';
    fipe.insertAdjacentElement('afterend',card);
    var input=document.getElementById('cv-gravame-home-plate');
    var btn=document.getElementById('cv-gravame-home-btn');
    input.addEventListener('input',function(){this.value=normal(this.value);msg('')});
    input.addEventListener('keydown',function(e){if(e.key==='Enter')btn.click()});
    btn.addEventListener('click',function(){
      var p=normal(input.value);
      if(!valid(p)){msg('Digite uma placa válida, como ABC1D23.');input.focus();return}
      var main=document.getElementById('plate');if(main)main.value=p;
      var visible=document.getElementById('cv-plate');if(visible)visible.value=p;
      msg('');
      if(typeof window.cvOpenGravame==='function')window.cvOpenGravame();
      else msg('A consulta de gravame está carregando. Tente novamente em instantes.');
    });
  }
  document.addEventListener('DOMContentLoaded',function(){setTimeout(addCard,0);setTimeout(addCard,300);setTimeout(addCard,1000)});
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
            if (contentType.includes('text/html') && !body.includes('id="cv-gravame-home-script"')) {
              body = body.replace('</body>', INJECT + '\n</body>');
              chunk = Buffer.from(body, 'utf8');
              headers['content-length'] = String(chunk.length);
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
