'use strict';
// Teste estático da interface real: não executa JavaScript da página nem integrações.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
assert.match(html, /class="cv360-skip" href="#consultCard"/, 'Link de acesso rápido deve existir');
assert.match(html, /id="consultCard"/, 'Destino do link deve existir');
assert.match(html, /:focus-visible/, 'Foco de teclado deve estar visível');
assert.match(html, /prefers-reduced-motion/, 'Respeitar preferência de movimento reduzido');
for (const required of ['id="btn"', 'onclick="consultar()"', 'id="pacotes"']) {
  assert.ok(html.includes(required), 'Elemento existente foi removido: ' + required);
}
assert.match(html, /id="cv360-disclosure-title"/, 'Aviso de transparência ausente');
assert.match(html, /sem vínculo com DETRAN, SENATRAN ou GOV.BR/, 'Aviso de independência ausente');
for (const page of ['/contato.html', '/termos.html', '/privacidade.html', '/reembolso.html']) {
  assert.ok(html.includes('href="' + page + '"'), 'Link institucional ausente: ' + page);
}
console.log('Interface real: acessibilidade incremental e elementos críticos preservados.');
