'use strict';
// Auditoria estática de páginas institucionais. Não publica dados nem executa produção.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const files = ['contato.html', 'termos.html', 'privacidade.html', 'reembolso.html'];
const clean = html => html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
const data = files.map(file => ({ file, html: fs.readFileSync(path.join(root, file), 'utf8') }));
for (const { file, html } of data) {
  const text = clean(html);
  assert.match(html, /<html[^>]+lang=["']pt-BR["']/i, file + ': idioma ausente');
  assert.match(html, /<meta[^>]+name=["']viewport["']/i, file + ': responsividade ausente');
  assert.match(text, /Consulta Veicular 360/i, file + ': nome do serviço ausente');
  assert.match(text, /privad[ao]/i, file + ': independência não descrita');
  assert.match(text, /69\.184\.344\/0001-02/, file + ': CNPJ divergente');
  assert.match(text, /consultaveicular360\.com\.br/i, file + ': domínio divergente');
  assert.ok(html.includes('href="/"'), file + ': retorno ao site não localizado');
}
const contato = clean(data[0].html);
assert.match(contato, /WhatsApp/i, 'Canal WhatsApp não localizado');
assert.match(contato, /E-mail/i, 'Canal de e-mail não localizado');
const termos = clean(data[1].html);
assert.match(termos, /pagamento/i);
assert.match(termos, /não substitui/i);
const privacidade = clean(data[2].html);
assert.match(privacidade, /placa/i);
assert.match(privacidade, /Woovi\/OpenPix/i);
const reembolso = clean(data[3].html);
assert.match(reembolso, /7 dias/i);
assert.match(reembolso, /reembolso/i);
console.log('Páginas institucionais: ' + files.length + ' arquivos verificados; identidade, serviço e temas essenciais consistentes. Revisão jurídica e operacional ainda necessária.');
