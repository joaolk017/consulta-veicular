'use strict';

const http = require('http');
const path = require('path');

// Camada final da página pública usada como landing page de anúncios.
const IS_OUTER_UI = path.basename(String(process.argv[1] || '')).toLowerCase() === 'recovery-ui-proxy.js';

if (IS_OUTER_UI) {
  const originalCreateServer = http.createServer.bind(http);

  const FOCUS_STYLE = `
<style id="cv-ads-focus-style">
/* Google Ads: uma oferta principal, um CTA principal. */
.cv-hero-grid{grid-template-columns:minmax(0,900px)!important;justify-content:center!important}
.cv-hero-left{width:100%!important;max-width:900px!important;margin:0 auto!important}
.cv-hero-copy{text-align:center!important;max-width:780px!important;margin-left:auto!important;margin-right:auto!important}
.cv-hero-copy p{max-width:690px!important;margin-left:auto!important;margin-right:auto!important}
.cv-badges{justify-content:center!important}
.cv-search-card{max-width:780px!important;margin-left:auto!important;margin-right:auto!important}
.cv-search-head{align-items:center!important}
.cv-search-label{letter-spacing:1.2px!important}
.cv-search-price strong{font-size:30px!important}
.cv-safe-row{justify-content:center!important;gap:20px!important;flex-wrap:wrap!important}
.cv-trustbar{max-width:1120px!important;margin-left:auto!important;margin-right:auto!important}
.services-grid.cv-with-gravame-home{grid-template-columns:1fr!important}
.cv-main-cta,.cv-nav-btn,#cv-consult-btn{letter-spacing:.25px!important}
@media(max-width:700px){.cv-hero-copy{text-align:left!important}.cv-badges{justify-content:flex-start!important}.cv-search-head{align-items:flex-start!important}.cv-safe-row{justify-content:flex-start!important}}
</style>`;

  function removeElement(html, startPattern) {
    let output = html;
    for (let pass = 0; pass < 12; pass += 1) {
      startPattern.lastIndex = 0;
      const match = startPattern.exec(output);
      if (!match) break;

      const opening = match[0];
      const tagMatch = opening.match(/^<([a-z0-9-]+)/i);
      if (!tagMatch) break;
      const tag = tagMatch[1];
      const tagPattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi');
      tagPattern.lastIndex = match.index + opening.length;
      let depth = 1;
      let end = -1;
      let token;

      while ((token = tagPattern.exec(output))) {
        const text = token[0];
        const closing = new RegExp(`^<\\/${tag}\\b`, 'i').test(text);
        const selfClosing = /\/\s*>$/.test(text);
        if (closing) depth -= 1;
        else if (!selfClosing) depth += 1;
        if (depth === 0) {
          end = tagPattern.lastIndex;
          break;
        }
      }

      if (end < 0) break;
      output = output.slice(0, match.index) + output.slice(end);
    }
    return output;
  }

  function cleanAdsHome(html) {
    let body = String(html || '');

    // Retira serviços governamentais/documentais da landing de anúncios.
    body = removeElement(body, /<aside\b[^>]*class=["'][^"']*\bcv-crlv-hero\b[^"']*["'][^>]*>/i);
    body = removeElement(body, /<section\b[^>]*id=["']crlv["'][^>]*>/i);
    body = removeElement(body, /<section\b[^>]*class=["'][^"']*\bcard\s+crlv\b[^"']*["'][^>]*>/i);
    body = removeElement(body, /<div\b[^>]*id=["']crlvFlow["'][^>]*>/i);

    // Retira ofertas paralelas da home: gravame/FIPE continuam como informações possíveis
    // dentro do relatório principal, mas não competem com o CTA da consulta veicular.
    body = removeElement(body, /<aside\b[^>]*id=["']cv-gravame-home["'][^>]*>/i);
    body = removeElement(body, /<aside\b[^>]*class=["'][^"']*\bcv-fipe-hero\b[^"']*["'][^>]*>/i);

    // Remove navegação e botões dos serviços que não fazem parte da landing principal.
    body = body.replace(/<a\b[^>]*href=["']#crlv["'][^>]*>[\s\S]*?<\/a>/gi, '');
    body = body.replace(/<button\b[^>]*onclick=["'][^"']*(?:abrirCRLVCV|abrirFluxoCRLV)[^"']*["'][^>]*>[\s\S]*?<\/button>/gi, '');

    // Copy focada em intenção de compra de veículo usado.
    body = body.replace(
      /<h1>Antes de comprar,<br><em>consulte o veículo\.<\/em><\/h1>/i,
      '<h1>Consulte a placa<br><em>antes de fechar negócio.</em></h1>'
    );
    body = body.replace(
      /Digite a placa e veja as informações disponíveis antes de fechar negócio\. Um fluxo simples para ajudar você a analisar o veículo com mais clareza\./i,
      'Consulte informações veiculares disponíveis em um relatório organizado antes de comprar, vender ou negociar um veículo.'
    );
    body = body.replace(
      /Consulta veicular e emiss[aã]o de CRLV-e SP reunidas em um s[oó] lugar, com acesso simples pelo celular ou computador\./gi,
      'Consulta veicular por placa em um fluxo simples, com acesso pelo celular ou computador.'
    );
    body = body.replace(
      /<span class="cv-search-label">CONSULTE AGORA<\/span>/i,
      '<span class="cv-search-label">CONSULTA VEICULAR POR PLACA</span>'
    );
    body = body.replace(
      /<h2>Digite a placa do veículo<\/h2>/i,
      '<h2>Consulte antes de comprar</h2>'
    );
    body = body.replace(
      /<p>Use placa Mercosul ou padrão antigo\.<\/p>/i,
      '<p>Digite a placa Mercosul ou padrão antigo para localizar o veículo e iniciar sua consulta.</p>'
    );
    body = body.replace(/>🔎 CONSULTAR VEÍCULO</g, '>🔎 CONSULTAR PLACA AGORA<');
    body = body.replace(
      /<div class="cv-safe-row">[\s\S]*?<\/div>/i,
      '<div class="cv-safe-row"><span>✓ Prévia antes do pagamento</span><span>✓ Consulta completa por R$ 18,90</span><span>✓ Relatório organizado</span></div>'
    );

    // Reforça que gravame, leilão, débitos etc. são partes possíveis de UMA consulta.
    body = body.replace(
      /<h2>O que você pode encontrar na consulta<\/h2>/i,
      '<h2>Uma consulta, vários pontos importantes do veículo</h2>'
    );
    body = body.replace(
      /Os dados exibidos dependem das fontes integradas e dos registros disponíveis para cada veículo\./i,
      'O relatório reúne os dados que estiverem disponíveis nas fontes integradas. A disponibilidade varia conforme o veículo e a atualização das bases.'
    );

    // Evita chamadas do fluxo antigo de CRLV se o HTML-base ainda trouxer o JS legado.
    body = body.replace(
      /const crlvFlow=document\.getElementById\('crlvFlow'\)[\s\S]*?crlvFlow\.addEventListener\('click',[\s\S]*?\);\s*/i,
      ''
    );
    body = body.replace(
      /document\.addEventListener\('keydown',e=>\{if\(e\.key==='Escape'\)\{if\(!pixFlow\.classList\.contains\('hidden'\)\)fecharPix\(\);else if\(!crlvFlow\.classList\.contains\('hidden'\)\)fecharFluxoCRLV\(\)\}\}\);/g,
      "document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!pixFlow.classList.contains('hidden'))fecharPix()});"
    );

    if (!body.includes('id="cv-ads-focus-style"')) body = body.replace('</head>', `${FOCUS_STYLE}\n</head>`);
    return body;
  }

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
            if (contentType.includes('text/html')) {
              body = cleanAdsHome(body);
              chunk = Buffer.from(body, 'utf8');
              headers['content-length'] = String(chunk.length);
              delete headers['Content-Length'];
              if (captured) captured.headers = headers;
            }
          }
        } catch (err) {
          console.error('ADS_CLEANUP:', err.message);
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
