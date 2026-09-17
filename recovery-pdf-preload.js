'use strict';

const path = require('path');
const http = require('http');
const PDFDocument = require('pdfkit');

const entrypoint = path.basename(String(process.argv[1] || '')).toLowerCase();

if (entrypoint === 'recovery-ui-proxy.js') {
  const priorCreateServer = http.createServer.bind(http);
  const BACKEND_PORT = Number(process.env.RECOVERY_BACKEND_PORT || 10002);
  const TIMEOUT_MS = 55000;

  function sendJson(res, status, payload) {
    const body = Buffer.from(JSON.stringify(payload));
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length)
    });
    res.end(body);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > 64 * 1024) {
          reject(new Error('Corpo da requisição excedeu o limite.'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  function clean(v) {
    return v === undefined || v === null || String(v).trim() === '' ? 'Não informado' : String(v);
  }

  function boolText(v) {
    if (v === true) return 'Ocorrência indicada';
    if (v === false) return 'Nada consta';
    return 'Não verificado';
  }

  function makePdf(vehicle) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 42, info: { Title: `Consulta veicular ${clean(vehicle.plate)}` } });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('error', reject);
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const pageBottom = 790;
      function need(h = 48) {
        if (doc.y + h > pageBottom) doc.addPage();
      }
      function title(text) {
        need(45);
        doc.moveDown(0.35).font('Helvetica-Bold').fontSize(14).text(text);
        doc.moveDown(0.25).moveTo(42, doc.y).lineTo(553, doc.y).stroke();
        doc.moveDown(0.45);
      }
      function row(label, value) {
        need(28);
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(9.5).text(label, 42, y, { width: 180 });
        doc.font('Helvetica').fontSize(9.5).text(clean(value), 225, y, { width: 328 });
        doc.y = Math.max(doc.y, y + 18);
      }

      doc.font('Helvetica-Bold').fontSize(20).text('Consulta Veicular 360');
      doc.moveDown(0.15).fontSize(11).font('Helvetica').text('Relatório veicular - consulta paga recuperada');
      doc.moveDown(0.65).font('Helvetica-Bold').fontSize(25).text(clean(vehicle.plate));
      doc.moveDown(0.1).fontSize(13).text(`${clean(vehicle.brand)} · ${clean(vehicle.model)}`);
      doc.moveDown(0.25).font('Helvetica').fontSize(9.5).text('Pagamento confirmado. Relatório recuperado a partir da consulta já liberada.');

      title('Identificação do veículo');
      row('Ano / Ano-modelo', vehicle.year && vehicle.modelYear ? `${vehicle.year} / ${vehicle.modelYear}` : (vehicle.modelYear || vehicle.year));
      row('Cor', vehicle.color);
      row('Município / UF', [vehicle.city, vehicle.state].filter(Boolean).join(' / '));
      row('Combustível', vehicle.fuel);
      row('Tipo do veículo', vehicle.type);
      row('RENAVAM', vehicle.renavam);
      row('Chassi', vehicle.chassis);
      row('Situação', vehicle.status);
      row('Procedência', vehicle.origin);
      row('Ano de exercício', vehicle.exerciseYear);

      if (vehicle.fipe) {
        title('Tabela FIPE');
        row('Valor', vehicle.fipe.value || (vehicle.fipe.numericValue ? Number(vehicle.fipe.numericValue).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null));
        row('Código FIPE', vehicle.fipe.code);
        row('Modelo FIPE', vehicle.fipe.model);
        row('Combustível FIPE', vehicle.fipe.fuel);
        row('Referência', vehicle.fipe.referenceMonth);
      }

      title('Indicadores e ocorrências');
      const ind = vehicle.indicators || {};
      [
        ['Roubo / furto', ind.theft],
        ['Leilão', ind.auction],
        ['Recall', ind.recall],
        ['RENAJUD', ind.renajud],
        ['RENAINF / infrações', ind.renainf],
        ['Comunicação de venda', ind.saleCommunication],
        ['Pendência documental', ind.documentationPending],
        ['Remarcação de chassi', ind.chassisRemarked]
      ].forEach(x => row(x[0], boolText(x[1])));

      title('Restrições retornadas');
      if (Array.isArray(vehicle.restrictions) && vehicle.restrictions.length) {
        vehicle.restrictions.forEach((r, i) => row(`Restrição ${i + 1}`, r));
      } else {
        row('Resultado', 'Nenhuma restrição informada na lista retornada.');
      }

      const t = vehicle.technical || {};
      if (Object.keys(t).length) {
        title('Dados técnicos');
        row('Motor', t.engine);
        row('Espécie', t.species);
        row('Categoria', t.category);
        row('Carroceria', t.bodyType);
        row('Cilindrada', t.displacement);
        row('Peso bruto', t.grossWeight);
        row('Capacidade de carga', t.loadCapacity);
        row('Passageiros', t.passengers);
        row('Descrição do chassi', t.chassisRemarkDescription);
      }

      const d = vehicle.documents || {};
      if (Object.keys(d).length) {
        title('Documentos');
        row('Emissão do CRV', d.crvIssuedAt);
        row('Emissão do CRLV', d.crlvIssuedAt);
      }

      need(90);
      doc.moveDown(0.8).font('Helvetica').fontSize(8).text(
        'Aviso: este relatório é informativo e reproduz os dados retornados pela fonte da consulta no momento da pesquisa. Ele não substitui documento oficial nem consulta aos órgãos públicos competentes.',
        { align: 'justify' }
      );
      doc.moveDown(0.45).text(`Fonte registrada: ${clean(vehicle.source)} · Status da fonte: ${clean(vehicle.sourceStatus)}`);
      doc.end();
    });
  }

  async function validateRecovery(body) {
    return new Promise((resolve, reject) => {
      const headers = {
        'content-type': 'application/json',
        'accept': 'application/json',
        'content-length': String(body.length),
        'host': `127.0.0.1:${BACKEND_PORT}`
      };
      const upstream = http.request({
        hostname: '127.0.0.1',
        port: BACKEND_PORT,
        path: '/api/consulta/recuperar-v2',
        method: 'POST',
        headers
      }, upstreamRes => {
        const chunks = [];
        upstreamRes.on('data', c => chunks.push(c));
        upstreamRes.on('end', () => {
          let data = {};
          try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) {}
          resolve({ status: upstreamRes.statusCode || 502, data });
        });
      });
      upstream.setTimeout(TIMEOUT_MS, () => upstream.destroy(new Error('Tempo limite da recuperação.')));
      upstream.on('error', reject);
      upstream.end(body);
    });
  }

  async function serveRecoveredPdf(req, res) {
    let body;
    try { body = await readBody(req); }
    catch (_) { return sendJson(res, 400, { error: 'requisicao_invalida', mensagem: 'Dados inválidos.' }); }

    try {
      const checked = await validateRecovery(body);
      const data = checked.data || {};
      if (checked.status < 200 || checked.status >= 300 || data.paid !== true || !data.vehicle) {
        return sendJson(res, 403, { error: 'consulta_nao_liberada', mensagem: data.mensagem || 'Consulta paga não localizada.' });
      }
      const pdf = await makePdf(data.vehicle);
      const plate = String(data.vehicle.plate || 'consulta').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'consulta';
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="consulta_veicular_${plate}.pdf"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'Pragma': 'no-cache',
        'Content-Length': String(pdf.length),
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(pdf);
      console.log(`RECOVERY_PDF: PDF entregue para placa ${plate}.`);
    } catch (err) {
      console.error('RECOVERY_PDF:', err.message);
      return sendJson(res, 500, { error: 'pdf_indisponivel', mensagem: 'Não foi possível gerar o PDF desta consulta agora.' });
    }
  }

  const INJECT = String.raw`<script id="cv-recovery-paid-pdf">
(function(){
  var lastBody=null,lastPlate='';
  var open0=XMLHttpRequest.prototype.open,send0=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(method,url){
    this.__cvRecoveryV2=String(url||'').indexOf('/api/consulta/recuperar-v2')>=0;
    return open0.apply(this,arguments);
  };
  XMLHttpRequest.prototype.send=function(body){
    if(this.__cvRecoveryV2){
      var xhr=this;
      try{
        var parsed=JSON.parse(String(body||'{}'));
        lastBody={placa:String(parsed.placa||''),cpf:String(parsed.cpf||'')};
        lastPlate=String(parsed.placa||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7);
      }catch(e){}
      this.addEventListener('loadend',function(){
        try{
          if(xhr.status<200||xhr.status>=300)return;
          var data=JSON.parse(xhr.responseText||'{}');
          if(!data||data.paid!==true||!data.vehicle||!lastBody)return;
          lastPlate=String(data.vehicle.plate||lastPlate).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7);
          setTimeout(function(){window.cvDownloadRecoveredPdf(true)},300);
        }catch(e){}
      });
    }
    return send0.apply(this,arguments);
  };

  function addPdfButton(){
    var result=document.getElementById('result');
    if(!result||!lastBody||!lastPlate||document.getElementById('cv-download-recovered-pdf'))return;
    var holder=document.createElement('div');
    holder.className='report-actions';holder.style.marginTop='12px';
    var btn=document.createElement('button');
    btn.id='cv-download-recovered-pdf';btn.type='button';btn.className='paybtn';
    btn.textContent='📄 BAIXAR PDF DA CONSULTA';
    btn.onclick=function(){window.cvDownloadRecoveredPdf(false)};
    holder.appendChild(btn);result.appendChild(holder);
  }

  window.cvDownloadRecoveredPdf=function(silent){
    if(!lastBody)return;
    var xhr=new XMLHttpRequest();
    xhr.open('POST','/api/consulta/recuperar-pdf?t='+Date.now(),true);
    xhr.responseType='blob';xhr.timeout=65000;
    xhr.setRequestHeader('Content-Type','application/json');
    xhr.setRequestHeader('Cache-Control','no-store');
    xhr.onload=function(){
      if(xhr.status<200||xhr.status>=300){if(!silent)alert('Não foi possível liberar o PDF agora.');return;}
      var url=URL.createObjectURL(xhr.response),a=document.createElement('a');
      a.href=url;a.download='consulta_veicular_'+(lastPlate||'consulta')+'.pdf';
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(function(){URL.revokeObjectURL(url)},15000);
      setTimeout(addPdfButton,300);
    };
    xhr.onerror=function(){if(!silent)alert('Falha ao baixar o PDF. Tente novamente.');};
    xhr.ontimeout=function(){if(!silent)alert('O download do PDF demorou além do esperado. Tente novamente.');};
    xhr.send(JSON.stringify(lastBody));
  };

  var obs=new MutationObserver(function(){setTimeout(addPdfButton,60)});
  document.addEventListener('DOMContentLoaded',function(){var result=document.getElementById('result');if(result)obs.observe(result,{childList:true,subtree:true,attributes:true});});
})();
</script>`;

  http.createServer = function recoveryPdfCreateServer(...args) {
    const listenerIndex = typeof args[0] === 'function' ? 0 : 1;
    const listener = args[listenerIndex];
    if (typeof listener !== 'function') return priorCreateServer(...args);

    args[listenerIndex] = function recoveryPdfListener(req, res) {
      let pathname = '/';
      try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (_) {}
      if (req.method === 'POST' && pathname === '/api/consulta/recuperar-pdf') return serveRecoveredPdf(req, res);

      const isHome = req.method === 'GET' && (pathname === '/' || pathname === '/index.html');
      if (!isHome) return listener(req, res);

      const originalWriteHead = res.writeHead.bind(res);
      const originalEnd = res.end.bind(res);
      let captured = null;
      res.writeHead = function(statusCode, statusMessageOrHeaders, headersMaybe) {
        captured = { statusCode, statusMessage: null, headers: {} };
        if (typeof statusMessageOrHeaders === 'string') {
          captured.statusMessage = statusMessageOrHeaders;captured.headers = headersMaybe || {};
        } else captured.headers = statusMessageOrHeaders || {};
        return res;
      };
      res.end = function(chunk, encoding, callback) {
        try {
          if (chunk != null) {
            let body = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
            const headers = captured && captured.headers ? captured.headers : {};
            const type = String(headers['content-type'] || headers['Content-Type'] || res.getHeader('content-type') || '');
            if (type.includes('text/html') && !body.includes('id="cv-recovery-paid-pdf"')) {
              body = body.replace('</body>', INJECT + '\n</body>');
              chunk = Buffer.from(body, 'utf8');
              headers['content-length'] = String(chunk.length);
              delete headers['Content-Length'];delete headers['content-encoding'];delete headers['transfer-encoding'];
              if (captured) captured.headers = headers;
            }
          }
        } catch (err) { console.error('RECOVERY_PDF_UI:', err.message); }
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
