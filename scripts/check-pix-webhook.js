'use strict';
// Auditoria estática das proteções do webhook Pix. Não inicia servidor nem acessa Woovi.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const server = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
const start = server.indexOf('app.post("/api/pagamento/pix/webhook"');
const end = server.indexOf('app.post("/api/pagamento/pix/qr"', start);
assert.ok(start >= 0 && end > start, 'Bloco do webhook não encontrado');
const webhook = server.slice(start, end);
for (const [name, expression] of [
  ['Segredo obrigatório', /!OPENPIX_WEBHOOK_SECRET/],
  ['Comparação segura do segredo', /secureEqual\(suppliedWebhookSecret, OPENPIX_WEBHOOK_SECRET\)/],
  ['Recusa de autorização inválida', /res\.status\(401\)/],
  ['Evento de pagamento concluído', /OPENPIX:CHARGE_COMPLETED/],
  ['Cobrança registrada em banco', /FROM payments WHERE correlation_id=\$1/],
  ['Confirmação na Woovi', /await getOpenPixCharge\(correlationID\)/],
  ['Status concluído', /state !== "COMPLETED"/],
  ['Valor idêntico', /providerCents !== Number\(payment\.cents\)/],
  ['Produto válido', /product\.cents !== Number\(payment\.cents\)/],
  ['Crédito após validação', /await creditPaidPayment\(checked\)/]
]) assert.match(webhook, expression, 'Proteção ausente: ' + name);
assert.ok(webhook.indexOf('await creditPaidPayment(checked)') > webhook.indexOf('providerCents !== Number(payment.cents)'), 'Crédito antes da validação de valor');
assert.ok(webhook.indexOf('await creditPaidPayment(checked)') > webhook.indexOf('await getOpenPixCharge(correlationID)'), 'Crédito antes de verificar provedor');
console.log('Webhook Pix: 10 proteções estruturais presentes. Testes de integração e idempotência transacional ainda necessários.');
