'use strict';

const http = require('http');
const path = require('path');

const IS_OUTER_UI = path.basename(String(process.argv[1] || '')).toLowerCase() === 'recovery-ui-proxy.js';

if (IS_OUTER_UI) {
  const originalCreateServer = http.createServer.bind(http);

  const INJECT = `
<script id="cv-google-ads-conversion-script">
(function(){
  var capturedTransactionId='';
  var lastCaptureAt=0;
  var sentPrefix='cv_ga4_purchase_sent_v1_';

  function consentGranted(){
    try{return localStorage.getItem('cv_ga_consent_v1')==='granted'}catch(e){return false}
  }

  function capturePayment(){
    try{
      var raw=sessionStorage.getItem('consultaPix');
      if(!raw)return;
      var p=JSON.parse(raw);
      if(p&&p.transactionId){
        capturedTransactionId=String(p.transactionId);
        lastCaptureAt=Date.now();
      }
    }catch(e){}
  }

  function purchaseAlreadySent(tx){
    try{return localStorage.getItem(sentPrefix+tx)==='1'}catch(e){return false}
  }

  function markPurchaseSent(tx){
    try{localStorage.setItem(sentPrefix+tx,'1')}catch(e){}
  }

  function checkoutConfirmed(){
    var success=document.getElementById('pixSuccessStep');
    return !!(success&&!success.classList.contains('hidden'));
  }

  function tryTrackPurchase(){
    capturePayment();
    if(!checkoutConfirmed()||!capturedTransactionId)return;
    if(!consentGranted())return;
    if(typeof window.cvTrack!=='function')return;
    if(purchaseAlreadySent(capturedTransactionId))return;

    window.cvTrack('purchase',{
      transaction_id:capturedTransactionId,
      value:18.90,
      currency:'BRL',
      items:[{
        item_id:'consulta-completa',
        item_name:'Consulta Veicular Completa',
        price:18.90,
        quantity:1
      }]
    });
    markPurchaseSent(capturedTransactionId);
  }

  function init(){
    capturePayment();
    setInterval(function(){capturePayment();tryTrackPurchase()},700);
    var target=document.body||document.documentElement;
    if(target&&window.MutationObserver){
      new MutationObserver(tryTrackPurchase).observe(target,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
    }
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
            if (contentType.includes('text/html') && !body.includes('id="cv-google-ads-conversion-script"')) {
              body = body.replace('</body>', INJECT + '\n</body>');
              chunk = Buffer.from(body, 'utf8');
              headers['content-length'] = String(chunk.length);
              delete headers['Content-Length'];
              if (captured) captured.headers = headers;
            }
          }
        } catch (err) {
          console.error('GOOGLE_ADS_CONVERSION:', err.message);
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
