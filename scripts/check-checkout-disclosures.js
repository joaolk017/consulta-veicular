'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function part(a,b){const i=html.indexOf(a),j=html.indexOf(b,i+1);assert.ok(i>=0&&j>i,'Checkout alterado: '+a);return html.slice(i,j)}
const checkout=part('<div id="pixFlow"','<section id="pixPay"');
for(const id of ['pixProductLabel','pixFormPrice','pixCheckoutSummary','pixEmail','pixCreate','pixPlate']) assert.ok(checkout.includes('id="'+id+'"'),'Falta '+id);
for(const text of ['pagamento único','Sem assinatura','valor total','fontes integradas','após a confirmação','serviço privado']) assert.ok(checkout.toLowerCase().includes(text.toLowerCase()),'Falta informação: '+text);
for(const file of ['termos.html','privacidade.html','reembolso.html','contato.html']) assert.ok(checkout.includes('/'+file),'Falta link '+file);
assert.ok(checkout.indexOf('id="pixFormPrice"')<checkout.indexOf('id="pixCreate"'),'Preço deve anteceder gerar Pix');
assert.ok(checkout.indexOf('cv360-checkout-disclosure')<checkout.indexOf('id="pixCreate"'),'Avisos devem anteceder gerar Pix');
const beforePayment=checkout.slice(0,checkout.indexOf('id="pixCreate"'));
for(const label of ['id="pixProductLabel"','id="pixFormPrice"','id="pixCheckoutSummary"','id="pixPlate"','id="pixEmail"','cv360-checkout-disclosure']) assert.ok(beforePayment.includes(label),'Informação obrigatória não aparece antes do botão Pix: '+label);
assert.ok(/<label[^>]+for="pixEmail"/.test(beforePayment),'E-mail precisa ter rótulo acessível antes do Pix');
assert.ok(/<input[^>]+id="pixEmail"[^>]+type="email"/.test(beforePayment),'Campo de e-mail precisa validar formato');
for(const term of ['pagamento único','sem assinatura','valor total','fontes integradas','após a confirmação']) assert.ok(beforePayment.toLowerCase().includes(term),'Aviso obrigatório ausente antes do Pix: '+term);
assert.ok(beforePayment.includes('href="/reembolso.html"')&&beforePayment.includes('href="/contato.html"'),'Reembolso e contato devem estar acessíveis antes do Pix');
console.log('Checkout real: preço, produto, e-mail, placa, avisos e links presentes antes de gerar Pix (auditoria estática).');
