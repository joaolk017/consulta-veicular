'use strict';
// Compara a simulação isolada aos produtos declarados no servidor real.
// Apenas leitura do código-fonte; nunca importa ou inicia o servidor real.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PRODUCTS } = require('../dev-preview/payment-flow-mock');
const source = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
const start = source.indexOf('const PACKAGES = Object.freeze({');
const end = source.indexOf('\n});', start);
assert.ok(start >= 0 && end > start, 'Tabela de pacotes do servidor não localizada');
const block = source.slice(start, end);
const actual = {};
for (const match of block.matchAll(/"([^"]+)":\s*\{[^}]*?id:\s*"([^"]+)"[^}]*?cents:\s*(\d+)[^}]*?credits:\s*(\d+)/g)) {
  const [, key, id, cents, credits] = match;
  assert.equal(key, id, 'Identificador inconsistente: ' + key);
  actual[id] = { cents: Number(cents), credits: Number(credits) };
}
assert.equal(Object.keys(actual).length, 4, 'Tabela real de produtos mudou; revisar testes');
assert.deepEqual(Object.keys(PRODUCTS).sort(), Object.keys(actual).sort(), 'Produtos fictícios divergentes');
for (const [id, cents] of Object.entries(PRODUCTS)) {
  assert.equal(cents, actual[id].cents, 'Preço divergente: ' + id);
  const expectedCredits = id === 'consulta-completa' ? 1 : id === 'pacote-3' ? 3 : 2;
  assert.equal(actual[id].credits, expectedCredits, 'Quantidade de créditos alterada: ' + id);
}
console.log('Produtos e preços da simulação alinhados ao servidor real: ' + Object.keys(actual).length);
