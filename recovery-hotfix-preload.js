'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const originalJsLoader = Module._extensions['.js'];
const FALLBACK_PATH = path.resolve(__dirname, 'recovery-paid-fallback-preload.js');
const UI_PATH = path.resolve(__dirname, 'recovery-ui-proxy.js');

Module._extensions['.js'] = function recoveryHotfixLoader(module, filename) {
  const resolved = path.resolve(filename);
  if (resolved !== FALLBACK_PATH && resolved !== UI_PATH) {
    return originalJsLoader(module, filename);
  }

  let source = fs.readFileSync(filename, 'utf8');

  if (resolved === FALLBACK_PATH) {
    const oldPaymentCheck = `      const transaction = await checkMisticTransaction(row.provider_transaction_id);\n      if (!isPaidTransaction(transaction)) throw Object.assign(new Error('O pagamento desta consulta ainda não consta como confirmado.'), { status: 402 });\n      const raw = await requestFonteData(plate);`;
    const newPaymentCheck = `      const locallyVerified = String(row.payment_status || '').toUpperCase() === 'COMPLETO' && Boolean(row.order_paid_at);\n      if (!locallyVerified) {\n        const transaction = await checkMisticTransaction(row.provider_transaction_id);\n        if (!isPaidTransaction(transaction)) throw Object.assign(new Error('O pagamento desta consulta ainda não consta como confirmado.'), { status: 402 });\n      }\n      const raw = await requestFonteData(plate);`;
    if (!source.includes(oldPaymentCheck)) {
      throw new Error('RECOVERY_HOTFIX: ponto de verificacao do pagamento nao encontrado.');
    }
    source = source.replace(oldPaymentCheck, newPaymentCheck);
  }

  if (resolved === UI_PATH) {
    const oldFetch = `    if(btn){btn.disabled=true;btn.textContent='PROCURANDO...'}msg('Verificando sua consulta paga...',true);\n    try{\n      var r=await fetch('/api/consulta/recuperar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({placa:p,cpf:cpf}),cache:'no-store'});`;
    const newFetch = `    if(btn){btn.disabled=true;btn.textContent='PROCURANDO...'}msg('Verificando sua consulta paga...',true);\n    var recoveryController=typeof AbortController==='function'?new AbortController():null;\n    var recoveryTimeout=setTimeout(function(){if(recoveryController)recoveryController.abort()},65000);\n    var recoveryProgress=setTimeout(function(){msg('Ainda verificando o pagamento e preparando o relatório...',true)},12000);\n    try{\n      var recoveryOptions={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({placa:p,cpf:cpf}),cache:'no-store'};\n      if(recoveryController)recoveryOptions.signal=recoveryController.signal;\n      var r=await fetch('/api/consulta/recuperar',recoveryOptions);`;
    if (!source.includes(oldFetch)) {
      throw new Error('RECOVERY_HOTFIX: ponto de fetch da recuperacao nao encontrado.');
    }
    source = source.replace(oldFetch, newFetch);

    const oldFinally = `    }catch(e){msg(e.message||'Não foi possível recuperar a consulta.',false)}finally{if(btn){btn.disabled=false;btn.textContent='RECUPERAR CONSULTA'}}`;
    const newFinally = `    }catch(e){if(e&&e.name==='AbortError')msg('A verificação demorou além do esperado. Tente novamente; se o pagamento já estiver confirmado, ele continua válido.',false);else msg(e.message||'Não foi possível recuperar a consulta.',false)}finally{clearTimeout(recoveryTimeout);clearTimeout(recoveryProgress);if(btn){btn.disabled=false;btn.textContent='RECUPERAR CONSULTA'}}`;
    if (!source.includes(oldFinally)) {
      throw new Error('RECOVERY_HOTFIX: ponto final da recuperacao nao encontrado.');
    }
    source = source.replace(oldFinally, newFinally);
  }

  module._compile(source, filename);
};
