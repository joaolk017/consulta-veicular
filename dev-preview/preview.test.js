'use strict';
// Testes locais exclusivos da prévia, sem uso de banco, APIs externas ou pagamentos.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const serverFile = path.join(__dirname, 'server.js');
const indexFile = path.join(__dirname, 'index.html');
const checkoutFile = path.join(__dirname, 'checkout-demo.html');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}
const portPromise = freePort();
let child;
after(() => { if (child) child.kill(); });
async function request(url, options) {
  const port = await portPromise;
  if (!child) {
    child = spawn(process.execPath, [serverFile], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
    for (let i = 0; i < 50; i++) {
      if (child.exitCode !== null) throw Error('Servidor terminou antes de iniciar');
      try { const response = await fetch('http://127.0.0.1:' + port + '/healthz'); if (response.ok) break; } catch {}
      await wait(80);
    }
  }
  return fetch('http://127.0.0.1:' + port + url, options);
}
test('Página inicial informa que é demonstração e não indexa', async () => {
  const r = await request('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('x-robots-tag'), /noindex/);
  assert.match(await r.text(), /SEM CONSULTAS OU PAGAMENTOS REAIS/);
});
test('Checkout de demonstração não apresenta pagamento funcional', async () => {
  const r = await request('/checkout-demo');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /NÃO EXISTE PAGAMENTO/);
  assert.match(html, /R\$ 0,00/);
});
test('Transparência informa independência e limitações sem promessas', async () => {
  const r = await request('/transparencia');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /plataforma privada e independente/);
  assert.match(html, /não há garantia de cobertura completa/);
  assert.match(html, /não representam aprovação/);
});
test('Painel público é apenas ilustrativo e não possui dados reais', async () => {
  const r = await request('/admin-demo');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('x-robots-tag'), /noindex/);
  const html = await r.text();
  assert.match(html, /DADOS 100% FICTÍCIOS/);
  assert.match(html, /não concede acesso administrativo/);
  assert.doesNotMatch(html, /DATABASE_URL|FALCON_TOKEN|OPENPIX_APP_ID/);
});
test('Endpoint mock aceita placa brasileira válida', async () => {
  const r = await request('/api/demo-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plate: 'ABC1D23' }) });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.demo, true);
  assert.equal(data.plate, 'ABC1D23');
  assert.match(data.vehicle.status, /simulados/);
});
test('Endpoint mock rejeita placa inválida', async () => {
  const r = await request('/api/demo-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plate: '../abc' }) });
  assert.equal(r.status, 400);
});
test('Rotas desconhecidas não expõem arquivos internos', async () => {
  for (const url of ['/server.js', '/package.json', '/.env', '/checkout-demo.html']) {
    const r = await request(url);
    assert.equal(r.status, 404, url);
  }
});
test('Sem integrações de produção na prévia', () => {
  const source = fs.readFileSync(serverFile, 'utf8');
  for (const marker of ['DATABASE_URL', 'FALCON_TOKEN', 'OPENPIX_APP_ID', 'WOOVI_APP_ID', 'require(\'../server.js\')']) {
    assert.equal(source.includes(marker), false, marker);
  }
  assert.match(fs.readFileSync(indexFile, 'utf8'), /Plataforma privada e independente/);
  assert.match(fs.readFileSync(checkoutFile, 'utf8'), /sem vínculo com DETRAN/);
});

test('Interface real de desenvolvimento abre somente em modo visual seguro', async () => {
  const r = await request('/site-real');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /script-src 'none'/);
  assert.match(r.headers.get('content-security-policy'), /connect-src 'none'/);
  assert.match(r.headers.get('content-security-policy'), /form-action 'none'/);
  assert.match(r.headers.get('x-robots-tag'), /noindex/);
  const html = await r.text();
  assert.match(html, /PRÉVIA VISUAL REAL/);
  assert.match(html, /Consulta Veicular 360/);
  const blocked = await request('/api/pagamento/pix/criar', { method: 'POST' });
  assert.equal(blocked.status, 405);
  const privateFile = await request('/server.js');
  assert.equal(privateFile.status, 404);
});

test('Checkout demonstrativo oferece pacotes com preços e créditos corretos sem integração de pagamento', async () => {
  const r = await request('/checkout-demo');
  const html = await r.text();
  assert.match(html, /2 consultas — R\\$ 32,90/);
  assert.match(html, /3 consultas — R\\$ 44,90/);
  assert.match(html, /'pacote-2':\\{credits:2,cents:3290\\}/);
  assert.match(html, /'pacote-3':\\{credits:3,cents:4490\\}/);
  assert.match(html, /Total cobrado: R\\$ 0,00/);
  assert.doesNotMatch(html, /fetch\\(|XMLHttpRequest|WebSocket|<form/i);
});
