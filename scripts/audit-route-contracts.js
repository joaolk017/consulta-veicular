'use strict';
// Auditoria ESTÁTICA: lê código-fonte, nunca importa server.js e não inicia o sistema real.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const pattern = /app\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
const routes = [...source.matchAll(pattern)].map(m => ({ method: m[1].toUpperCase(), path: m[2] }));
const required = [
  ['GET', '/api/consulta/:plate'],
  ['POST', '/api/consulta-completa'],
  ['POST', '/api/creditos/conta'],
  ['GET', '/api/creditos/saldo'],
  ['GET', '/api/minhas-consultas'],
  ['POST', '/api/pagamento/pix/criar'],
  ['POST', '/api/pagamento/pix/webhook'],
  ['POST', '/api/pagamento/pix/status'],
  ['GET', '/health']
];
for (const [method, route] of required) {
  assert.ok(routes.some(r => r.method === method && r.path === route), 'Contrato ausente: ' + method + ' ' + route);
}
assert.match(source, /DATABASE_URL/, 'Conexão de dados deve ser revisada antes de integrar');
assert.match(source, /OPENPIX_APP_ID/, 'Integração de pagamento deve ser preservada');
assert.match(source, /PAYMENT_SIGNING_SECRET/, 'Assinatura de pagamentos deve ser preservada');
const admin = routes.filter(r => r.path.startsWith('/api/admin/'));
const report = { kind: 'inventario-estatico', checked: required.length, totalRoutes: routes.length, adminRoutes: admin.length, routes };
if (require.main === module) console.log(JSON.stringify(report, null, 2));
module.exports = report;
