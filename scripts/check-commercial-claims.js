'use strict';
// Verificação estática de comunicação comercial; não substitui revisão jurídica ou Google Ads.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const visible = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const checks = [
  ['identificação privada', /plataforma privada e independente/i],
  ['sem vínculo governamental', /sem vínculo com DETRAN, SENATRAN ou GOV\.BR/i],
  ['limitações de cobertura', /cobertura do relatório varia/i],
  ['vistoria não substituída', /não substitui vistoria/i],
  ['termos de uso', /href="\/termos\.html"/i],
  ['privacidade', /href="\/privacidade\.html"/i],
  ['reembolso', /href="\/reembolso\.html"/i],
  ['atendimento', /href="\/contato\.html"/i]
];
for (const [label, pattern] of checks) {
  assert.match(label.includes('href') ? html : (['termos de uso','privacidade','reembolso','atendimento'].includes(label) ? html : visible), pattern, label);
}
const price = server.match(/const CONSULTA_SALE_CENTS = (\d+);/);
assert.ok(price, 'Preço de referência não localizado no servidor');
const formatted = 'R$ ' + (Number(price[1]) / 100).toFixed(2).replace('.', ',');
assert.ok(visible.includes(formatted), 'Preço público não corresponde ao preço base do servidor: ' + formatted);
const suspicious = [
  [/\b100% garantid[oa]s?\b/i, 'Promessa absoluta de garantia'],
  [/\baprova(?:ção|do) garantid[oa]\b/i, 'Promessa de aprovação'],
  [/\b(?:somos|site) oficial do detran\b/i, 'Alegação de órgão público']
];
for (const [pattern, label] of suspicious) assert.doesNotMatch(visible, pattern, label);
console.log('Comunicação comercial: ' + checks.length + ' verificações, preço base ' + formatted + ', sem promessas absolutas detectadas.');
