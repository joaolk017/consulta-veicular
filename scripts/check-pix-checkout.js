'use strict';
// Contratos estáticos do checkout Pix real: nunca inicia servidor nem cobra clientes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const checks = [
  [/id="pixFlow"[^>]*role="dialog"[^>]*aria-modal="true"/, 'Modal de pagamento acessível'],
  [/id="pixFormPrice"/, 'Preço visível antes de gerar Pix'],
  [/id="pixCheckoutSummary"/, 'Resumo de contratação'],
  [/id="pixEmail"[^>]*type="email"/, 'E-mail de contato'],
  [/id="pixCreate"[^>]*onclick="gerarPix\(\)"/, 'Botão de geração de Pix'],
  [/id="pixError"[^>]*role="alert"|id="pixError"/, 'Área de erro'],
  [/id="pixPay"/, 'Etapa de pagamento'],
  [/id="pixSuccess"/, 'Etapa de confirmação'],
  [/class="cv360-checkout-disclosure"/, 'Condições da compra'],
  [/liberação ocorre após a confirmação do Pix/i, 'Prazo de liberação'],
  [/href="\/reembolso\.html"/, 'Política de reembolso'],
  [/href="\/termos\.html"/, 'Termos de uso']
];
for (const [pattern, label] of checks) assert.match(html, pattern, label);
assert.match(html, /fetch\(['"]\/api\/pagamento\/pix\/criar['"]/, 'Frontend deve usar endpoint Pix existente');
for (const route of ['/api/pagamento/pix/criar', '/api/pagamento/pix/status', '/api/pagamento/pix/webhook']) {
  assert.ok(server.includes(route), 'Endpoint de pagamento ausente: ' + route);
}
assert.match(server, /PAYMENT_SIGNING_SECRET/, 'Assinatura de pagamento deve ser revisada');
// A cobrança real deve usar o catálogo do servidor, nunca preço/créditos informados pelo navegador.
const createStart = server.indexOf('app.post("/api/pagamento/pix/criar"');
const createEnd = server.indexOf('app.post("/api/pagamento/pix/webhook"', createStart);
assert.ok(createStart >= 0 && createEnd > createStart, 'Rota de criação de Pix ausente');
const createRoute = server.slice(createStart, createEnd);
assert.match(createRoute, /paymentProduct\(String\(\(req\.body && req\.body\.produto\)/, 'Produto deve ser resolvido no catálogo do servidor');
assert.match(createRoute, /createOpenPixCharge\(\{ correlationID, plate, product \}\)/, 'Woovi deve receber produto do catálogo');
assert.match(createRoute, /product\.cents, product\.credits/, 'Valor e créditos gravados devem vir do catálogo');
assert.match(createRoute, /if \(!product\) return res\.status\(400\)/, 'Produtos desconhecidos devem ser recusados');
assert.match(createRoute, /await pool\.query\("INSERT INTO payments/, 'Cobrança precisa ser registrada localmente');
assert.ok(createRoute.indexOf('await pool.query("INSERT INTO payments') < createRoute.indexOf('const paymentToken = signPaymentToken'), 'Não emitir token de pagamento antes de registrar a cobrança');
assert.doesNotMatch(createRoute, /(?:amount|cents|credits):\s*req\.body\./, 'Valores e créditos não podem vir do navegador');

console.log('Checkout Pix: ' + checks.length + ' verificações estáticas e endpoints preservados. Necessário teste real em ambiente seguro antes da publicação.');
