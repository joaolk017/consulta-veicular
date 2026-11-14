'use strict';
// Smoke test HTTP da prévia pública. Somente GET/HEAD; sem produção, banco ou pagamento.
const assert = require('node:assert/strict');
const base = process.env.PREVIEW_BASE_URL || 'https://consulta-veicular-360-preview.onrender.com';
const routes = [
  ['/', /SEM CONSULTAS OU PAGAMENTOS REAIS/],
  ['/checkout-demo', /NÃO EXISTE PAGAMENTO/],
  ['/transparencia', /plataforma privada e independente/],
  ['/admin-demo', /DADOS 100% FICTÍCIOS/]
];
async function request(path) {
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(25000), redirect: 'error' });
      return response;
    } catch (error) {
      last = error;
      if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  throw last;
}
(async () => {
  const health = await request('/healthz');
  assert.equal(health.status, 200, 'Healthcheck');
  assert.equal((await health.text()).trim(), 'ok');
  for (const [route, pattern] of routes) {
    const response = await request(route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('x-robots-tag') || '', /noindex/i, route + ': deve impedir indexação');
    assert.match(await response.text(), pattern, route);
    console.log('OK', route);
  }
  for (const route of ['/server.js', '/.env', '/package.json']) {
    const response = await request(route);
    assert.equal(response.status, 404, 'Arquivo interno não pode ser exposto: ' + route);
  }
  console.log('Prévia HTTP: saúde, quatro páginas, noindex e arquivos privados verificados.');
})().catch(error => { console.error('Falha no smoke test da prévia:', error); process.exitCode = 1; });
