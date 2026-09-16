'use strict';

const http = require('http');
const path = require('path');

const ENTRYPOINT = path.basename(String(process.argv[1] || '')).toLowerCase();
const IS_OUTER_UI = ENTRYPOINT === 'recovery-ui-proxy.js';
const IS_BACKEND_SERVER = ENTRYPOINT === 'server.js';

if (IS_BACKEND_SERVER) {
  const https = require('https');
  const express = require('express');
  const originalHttpsGet = https.get.bind(https);
  const originalJson = express.response.json;
  const previewCache = new Map();
  const TTL_MS = 10 * 60 * 1000;

  function normalizePlate(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
  }

  function captureVehicle(plate, data) {
    if (!plate || !data || typeof data !== 'object') return;
    const vehicle = data.vehicle || data.data || data;
    if (!vehicle || typeof vehicle !== 'object') return;
    previewCache.set(plate, { vehicle, expiresAt: Date.now() + TTL_MS });
  }

  https.get = function falconAwareGet(...args) {
    let plate = null;
    try {
      const raw = args[0] instanceof URL ? args[0] : new URL(String(args[0]));
      if (raw.hostname === 'beta.falcon-server.com.br') {
        const match = raw.pathname.match(/\/vehicles\/([^/]+)\/search/i);
        if (match) plate = normalizePlate(decodeURIComponent(match[1]));
      }
    } catch (_) {}

    const callbackIndex = typeof args[args.length - 1] === 'function' ? args.length - 1 : -1;
    if (!plate || callbackIndex < 0) return originalHttpsGet(...args);

    const callback = args[callbackIndex];
    args[callbackIndex] = function captureFalconResponse(response) {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size <= 2_000_000) chunks.push(Buffer.from(chunk));
      });
      response.on('end', () => {
        if (size > 2_000_000) return;
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          captureVehicle(plate, raw ? JSON.parse(raw) : null);
        } catch (_) {}
      });
      return callback(response);
    };

    return originalHttpsGet(...args);
  };

  express.response.json = function falconPreviewJson(body) {
    try {
      const req = this.req;
      const pathname = req ? new URL(req.url, 'http://localhost').pathname : '';
      if (body && body.preview === true && body.vehicle && /^\/api\/consulta\//i.test(pathname)) {
        const plate = normalizePlate(body.vehicle.plate || pathname.split('/').pop());
        const cached = previewCache.get(plate);
        if (cached && Date.now() < cached.expiresAt) {
          const vehicle = cached.vehicle || {};
          body = {
            ...body,
            vehicle: {
              ...body.vehicle,
              year: vehicle.year || vehicle.ano || vehicle.fabricationYear || vehicle.anoFabricacao || null,
              modelYear: vehicle.modelYear || vehicle.anoModelo || null,
              color: vehicle.color || vehicle.cor || null,
              city: vehicle.city || vehicle.municipio || vehicle.cidade || null,
              state: vehicle.state || vehicle.uf || null,
              fuel: vehicle.fuel || vehicle.combustivel || null,
              type: vehicle.type || vehicle.tipo || vehicle.tipoVeiculo || null
            },
            freeFields: ['plate', 'brand', 'model', 'year', 'modelYear', 'color', 'city', 'state', 'fuel', 'type']
          };
        }
      }
    } catch (_) {}
    return originalJson.call(this, body);
  };

  setInterval(() => {
    const now = Date.now();
    for (const [plate, entry] of previewCache) if (now >= entry.expiresAt) previewCache.delete(plate);
  }, TTL_MS).unref();
}

if (IS_OUTER_UI) {
  const originalCreateServer = http.createServer.bind(http);

  const INJECT = `
<style id="cv-falcon-free-style">
.cv-falcon-free-note{margin:12px 0 0;padding:12px 14px;border:1px solid #246c48;border-radius:12px;background:#0b2118;color:#96e8b7;font-size:11px;line-height:1.55;text-align:center}.cv-falcon-free-note b{color:#dcffea}.found.cv-falcon-free-badge{color:#9cf0bc!important;background:#0d2b1d!important;border-color:#267148!important}
</style>
<script id="cv-falcon-free-script">
(function(){
  var previewByPlate={};
  var previousFetch=window.fetch.bind(window);

  function normalPlate(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7)}
  function show(v){return v===undefined||v===null||String(v).trim()===''?'Não informado':String(v)}
  function yearLabel(v){
    if(v&&v.year&&v.modelYear&&String(v.year)!==String(v.modelYear))return String(v.year)+' / '+String(v.modelYear);
    return show(v&&(v.modelYear||v.year));
  }
  function localLabel(v){
    var parts=[];if(v&&v.city)parts.push(v.city);if(v&&v.state)parts.push(v.state);return parts.length?parts.join(' / '):'Não informado';
  }
  function replaceRow(result,label,value){
    var rows=result.querySelectorAll('.row');
    for(var i=0;i<rows.length;i++){
      var lab=rows[i].querySelector('.label');if(!lab||lab.textContent.trim()!==label)continue;
      var current=rows[i].querySelector('.locked,.value');if(!current)continue;
      var text=show(value);
      if(!current.classList.contains('value'))current.className='value';
      if(current.textContent.trim()!==text)current.textContent=text;
      break;
    }
  }

  window.fetch=async function(input,init){
    var response=await previousFetch(input,init);
    try{
      var rawUrl=typeof input==='string'?input:(input&&input.url?input.url:'');
      var pathname=new URL(rawUrl,location.href).pathname;
      if(response.ok&&/^\\/api\\/consulta\\/[A-Z0-9]+$/i.test(pathname)){
        var data=await response.clone().json();
        if(data&&data.preview===true&&data.vehicle){
          var p=normalPlate(data.vehicle.plate||pathname.split('/').pop());
          if(p)previewByPlate[p]=data.vehicle;
        }
      }
    }catch(e){}
    return response;
  };

  function markFreePreview(){
    var result=document.getElementById('result');
    if(!result||result.classList.contains('hidden'))return;
    if(result.querySelector('.paid-badge'))return;
    var found=result.querySelector('.found');
    var card=result.querySelector('.vehicle-card');
    if(!found||!card)return;
    if(found.textContent!=='✓ GRÁTIS • FALCON')found.textContent='✓ GRÁTIS • FALCON';
    if(!found.classList.contains('cv-falcon-free-badge'))found.classList.add('cv-falcon-free-badge');
    var title=card.querySelector('.vehicle-title h2');
    if(title&&title.textContent!=='Consulta inicial gratuita')title.textContent='Consulta inicial gratuita';

    var p=normalPlate((result.querySelector('.plate-result')||{}).textContent||'');
    var v=previewByPlate[p];
    if(v){
      replaceRow(result,'Ano / Ano-modelo',yearLabel(v));
      replaceRow(result,'Cor',v.color);
      replaceRow(result,'Município / UF',localLabel(v));
      replaceRow(result,'Combustível',v.fuel);
      replaceRow(result,'Tipo do veículo',v.type);
    }

    if(!document.getElementById('cv-falcon-free-note')){
      var note=document.createElement('div');
      note.id='cv-falcon-free-note';
      note.className='cv-falcon-free-note';
      note.innerHTML='✅ <b>Consulta gratuita realizada pela Falcon.</b><br>Placa, marca, modelo, ano, cor, município/UF, combustível e tipo do veículo aparecem sem cobrança. O PIX de R$ 18,90 é somente para liberar o relatório completo.';
      card.insertAdjacentElement('afterend',note);
    }
    var unlock=result.querySelector('.unlock h3');
    if(unlock&&unlock.textContent!=='Relatório completo com histórico e restrições')unlock.textContent='Relatório completo com histórico e restrições';
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
