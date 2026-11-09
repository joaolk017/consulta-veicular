'use strict';
// Compila scripts inline da página REAL sem executar browser, APIs, pagamentos ou segredos.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
let checked = 0;
for (const [, attributes, source] of scripts) {
  if (/\bsrc\s*=/.test(attributes) || !source.trim()) continue;
  if (/\btype\s*=\s*['"](?:application\/ld\+json|application\/json|importmap)['"]/i.test(attributes)) continue;
  const isModule = /\btype\s*=\s*['"]module['"]/i.test(attributes);
  if (isModule) {
    // Não executar scripts ES modules: exige parser específico, registrar pendência.
    console.log('AVISO: script module inline exige revisão manual');
    continue;
  }
  try { new vm.Script(source, { filename: 'index.html:inline-' + (checked + 1) }); }
  catch (error) { throw Error('JavaScript inline inválido no script ' + (checked + 1) + ': ' + error.message); }
  checked++;
}
assert.ok(checked > 0, 'Nenhum JavaScript inline encontrado para compilar');
console.log('JavaScript inline real: ' + checked + ' scripts compilados sem executar integrações.');
