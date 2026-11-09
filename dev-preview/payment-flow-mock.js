'use strict';
// Simulação local do ciclo de compra. NÃO acessa Woovi, API ou banco de produção.
const { randomUUID } = require('node:crypto');
const PRODUCTS = Object.freeze({ consulta: 1890, pacote2: 3290, pacote3: 4490 });
function createPurchase({ product, plate, email }) {
  if (!Object.hasOwn(PRODUCTS, product)) throw Error('Produto inválido');
  if (typeof plate !== 'string' || !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)) throw Error('Placa inválida');
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error('E-mail inválido');
  return { id: 'DEMO-' + randomUUID(), product, plate, email, amountCents: PRODUCTS[product], status: 'pending', credits: 0, confirmedEvents: new Set() };
}
function confirmMockPayment(purchase, eventId, paidAmountCents) {
  if (!eventId || typeof eventId !== 'string') throw Error('Evento inválido');
  if (paidAmountCents !== purchase.amountCents) throw Error('Valor divergente');
  if (purchase.confirmedEvents.has(eventId)) return purchase;
  purchase.confirmedEvents.add(eventId);
  if (purchase.status === 'pending') {
    purchase.status = 'paid';
    purchase.credits = purchase.product === 'pacote3' ? 3 : purchase.product === 'pacote2' ? 2 : 1;
  }
  return purchase;
}
function deliverMockReport(purchase) {
  if (purchase.status !== 'paid' || purchase.credits < 1) throw Error('Pagamento não confirmado ou créditos insuficientes');
  purchase.credits--;
  return { demo: true, plate: purchase.plate, message: 'Relatório fictício entregue somente no teste' };
}
module.exports = { PRODUCTS, createPurchase, confirmMockPayment, deliverMockReport };
