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
console.log('Checkout Pix: ' + checks.length + ' verificações estáticas e endpoints preservados. Necessário teste real em ambiente seguro antes da publicação.');
