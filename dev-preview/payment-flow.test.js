'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPurchase, confirmMockPayment, deliverMockReport, PRODUCTS } = require('./payment-flow-mock');
test('Compra fictícia: pendente, paga, libera um relatório', () => {
  const p = createPurchase({ product: 'consulta-completa', plate: 'ABC1D23', email: 'teste@example.com' });
  assert.equal(p.status, 'pending');
  assert.equal(p.amountCents, 1890);
  assert.throws(() => deliverMockReport(p), /Pagamento não confirmado/);
  confirmMockPayment(p, 'evt-1', 1890);
  assert.equal(p.status, 'paid');
  assert.equal(p.credits, 1);
  assert.equal(deliverMockReport(p).demo, true);
  assert.equal(p.credits, 0);
  assert.throws(() => deliverMockReport(p), /créditos insuficientes/);
});
test('Webhook fictício repetido não duplica créditos', () => {
  const p = createPurchase({ product: 'pacote-2', plate: 'ABC1234', email: 'teste@example.com' });
  confirmMockPayment(p, 'evt-1', PRODUCTS['pacote-2']);
  confirmMockPayment(p, 'evt-1', PRODUCTS['pacote-2']);
  confirmMockPayment(p, 'evt-2', PRODUCTS['pacote-2']);
  assert.equal(p.credits, 2);
});
test('Valor incorreto não confirma pagamento fictício', () => {
  const p = createPurchase({ product: 'consulta-completa', plate: 'ABC1D23', email: 'teste@example.com' });
  assert.throws(() => confirmMockPayment(p, 'evt-1', 1), /Valor divergente/);
  assert.equal(p.status, 'pending');
  assert.equal(p.credits, 0);
});
test('Pacote fictício de três consultas só libera três relatórios', () => {
  const p = createPurchase({ product: 'pacote-3', plate: 'ABC1D23', email: 'teste@example.com' });
  confirmMockPayment(p, 'evt-1', PRODUCTS['pacote-3']);
  for (let i = 0; i < 3; i++) assert.equal(deliverMockReport(p).demo, true);
  assert.throws(() => deliverMockReport(p), /créditos insuficientes/);
});
test('Entrada inválida não cria compra fictícia', () => {
  for (const input of [
    { product: 'desconhecido', plate: 'ABC1D23', email: 'teste@example.com' },
    { product: 'consulta-completa', plate: '../etc', email: 'teste@example.com' },
    { product: 'consulta-completa', plate: 'ABC1D23', email: 'invalido' }
  ]) assert.throws(() => createPurchase(input));
});

test('Oferta adicional fictícia libera exatamente dois créditos', () => {
  const p = createPurchase({ product: 'upsell-2', plate: 'ABC1D23', email: 'teste@example.com' });
  assert.equal(p.amountCents, 2490);
  confirmMockPayment(p, 'evt-upsell', 2490);
  assert.equal(p.credits, 2);
});
