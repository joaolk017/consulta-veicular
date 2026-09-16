'use strict';

const http = require('http');
const path = require('path');

const IS_OUTER_UI = path.basename(String(process.argv[1] || '')).toLowerCase() === 'recovery-ui-proxy.js';

if (IS_OUTER_UI) {
  const originalCreateServer = http.createServer.bind(http);

  const INJECT = `
<style id="cv-inline-result-style">
#cv-inline-result{width:min(100%,780px);margin:16px auto 0;position:relative;z-index:6;overflow-anchor:none}
#cv-inline-result #status{margin:0 0 10px}
#cv-inline-result #result{margin:0!important;width:100%;overflow-anchor:none}
#cv-inline-result #result:not(.hidden){animation:cvInlineAppear .28s ease}
@keyframes cvInlineAppear{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media(max-width:700px){#cv-inline-result{margin-top:12px}}
</style>
<script id="cv-inline-result-script">
(function(){
  var anchorY=null;
  var anchorUntil=0;

  function isInlineTarget(el){
    return !!(el&&(el.id==='result'||el.id==='status'||el.id==='cv-inline-result'));
  }

  try{
    var nativeScrollIntoView=Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView=function(){
      if(isInlineTarget(this))return;
      return nativeScrollIntoView.apply(this,arguments);
    };
  }catch(e){}

  function armPosition(){
    anchorY=window.scrollY||window.pageYOffset||0;
    anchorUntil=Date.now()+30000;
  }

  function restorePosition(){
    if(anchorY===null||Date.now()>anchorUntil)return;
    var current=window.scrollY||window.pageYOffset||0;
    if(Math.abs(current-anchorY)>1){
      try{window.scrollTo({top:anchorY,left:0,behavior:'auto'});}catch(e){window.scrollTo(0,anchorY);}
    }
  }

  function finishRestore(){
    restorePosition();
    setTimeout(restorePosition,80);
    setTimeout(restorePosition,180);
    setTimeout(function(){anchorY=null;anchorUntil=0;},260);
  }

  function placeInline(){
    var search=document.querySelector('.cv-search-card');
    var result=document.getElementById('result');
    var status=document.getElementById('status');
    if(!search||!result)return false;

    var holder=document.getElementById('cv-inline-result');
    if(!holder){
      holder=document.createElement('div');
      holder.id='cv-inline-result';
      holder.setAttribute('aria-live','polite');
      search.insertAdjacentElement('afterend',holder);
    }

    if(status&&status.parentNode!==holder)holder.appendChild(status);
    if(result.parentNode!==holder)holder.appendChild(result);

    try{result.scrollIntoView=function(){};}catch(e){}

    if(!result.dataset.cvNoScrollObserver){
      result.dataset.cvNoScrollObserver='1';
      new MutationObserver(function(){
        if(anchorY===null)return;
        if(!result.classList.contains('hidden')&&result.children.length){finishRestore();}
      }).observe(result,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    }
    return true;
  }

  function bindNoScroll(){
    document.addEventListener('click',function(e){
      var btn=e.target&&e.target.closest?e.target.closest('#cv-consult-btn'):null;
      if(!btn)return;
      armPosition();
      setTimeout(restorePosition,0);
      setTimeout(restorePosition,120);
    },true);

    document.addEventListener('keydown',function(e){
      if(e.key!=='Enter'||!e.target||e.target.id!=='cv-plate')return;
      armPosition();
      setTimeout(restorePosition,0);
      setTimeout(restorePosition,120);
    },true);
  }

  function init(){
    bindNoScroll();
    if(placeInline())return;
    var tries=0;
    var timer=setInterval(function(){
      tries+=1;
      if(placeInline()||tries>40)clearInterval(timer);
    },100);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
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
            if (contentType.includes('text/html') && !body.includes('id="cv-inline-result-script"')) {
              body = body.replace('</body>', INJECT + '\n</body>');
              chunk = Buffer.from(body, 'utf8');
              headers['content-length'] = String(chunk.length);
              delete headers['Content-Length'];
              if (captured) captured.headers = headers;
            }
          }
        } catch (err) {
          console.error('INLINE_RESULT:', err.message);
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
