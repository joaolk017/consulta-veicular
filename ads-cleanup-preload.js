'use strict';

const http = require('http');
const path = require('path');

// Aplica somente na camada pública final, depois que as demais UIs já foram montadas.
const IS_OUTER_UI = path.basename(String(process.argv[1] || '')).toLowerCase() === 'recovery-ui-proxy.js';

if (IS_OUTER_UI) {
  const originalCreateServer = http.createServer.bind(http);

  function removeElement(html, startPattern) {
    let output = html;
    for (let pass = 0; pass < 8; pass += 1) {
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

    // Remove os dois blocos públicos de CRLV-e: o layout novo e o layout base antigo.
    body = removeElement(body, /<aside\b[^>]*class=["'][^"']*\bcv-crlv-hero\b[^"']*["'][^>]*>/i);
    body = removeElement(body, /<section\b[^>]*id=["']crlv["'][^>]*>/i);
    body = removeElement(body, /<section\b[^>]*class=["'][^"']*\bcard\s+crlv\b[^"']*["'][^>]*>/i);
    body = removeElement(body, /<div\b[^>]*id=["']crlvFlow["'][^>]*>/i);

    // Remove navegação e CTAs que levavam ao CRLV-e.
    body = body.replace(/<a\b[^>]*href=["']#crlv["'][^>]*>[\s\S]*?<\/a>/gi, '');
    body = body.replace(/<button\b[^>]*onclick=["'][^"']*(?:abrirCRLVCV|abrirFluxoCRLV)[^"']*["'][^>]*>[\s\S]*?<\/button>/gi, '');

    // A mensagem principal passa a tratar somente da consulta veicular.
    body = body.replace(
      /Consulta veicular e emiss[aã]o de CRLV-e SP reunidas em um s[oó] lugar, com acesso simples pelo celular ou computador\./gi,
      'Consulta veicular por placa em um fluxo simples, com acesso pelo celular ou computador.'
    );

    // Evita qualquer chamada automática do fluxo antigo caso o HTML-base ainda traga o JavaScript legado.
    body = body.replace(
      /const crlvFlow=document\.getElementById\('crlvFlow'\)[\s\S]*?crlvFlow\.addEventListener\('click',[\s\S]*?\);\s*/i,
      ''
    );
    body = body.replace(
      /document\.addEventListener\('keydown',e=>\{if\(e\.key==='Escape'\)\{if\(!pixFlow\.classList\.contains\('hidden'\)\)fecharPix\(\);else if\(!crlvFlow\.classList\.contains\('hidden'\)\)fecharFluxoCRLV\(\)\}\}\);/g,
      "document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!pixFlow.classList.contains('hidden'))fecharPix()});"
    );

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
