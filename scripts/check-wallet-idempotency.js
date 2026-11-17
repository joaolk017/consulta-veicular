'use strict';
// Protege invariantes da carteira real sem conectar ao Postgres.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
const start = source.indexOf('async function creditPaidPayment(checked)');
const end = source.indexOf('async function consumeCredit(', start);
assert.ok(start >= 0 && end > start, 'Função de crédito não encontrada');
const block = source.slice(start, end);
const patterns = [
  ['Transação iniciada', /await client\.query\("BEGIN"\)/],
  ['Bloqueio de pagamento concorrente', /SELECT \* FROM payments WHERE correlation_id=\$1 FOR UPDATE/],
  ['Validação de conta', /String\(p\.account_id\) !== String\(checked\.payload\.accountId\)/],
  ['Validação de produto', /String\(p\.product\) !== String\(checked\.payload\.product\)/],
  ['Validação de valor', /Number\(p\.cents\) !== Number\(checked\.payload\.cents\)/],
  ['Compra já creditada', /if \(p\.credited_at\)/],
  ['Pagamento confirmado', /if \(!checked\.paid/],
  ['Transação de compra única', /ON CONFLICT\(type,reference\) DO NOTHING RETURNING id/],
  ['Saldo só aumenta após inserção', /if \(purchase\.rowCount\)\s*\{[\s\S]*?UPDATE credit_accounts SET balance=balance\+\$1/],
  ['Marcação de pagamento creditado', /credited_at=COALESCE\(credited_at,NOW\(\)\)/],
  ['Commit', /await client\.query\("COMMIT"\)/],
  ['Rollback', /await client\.query\("ROLLBACK"\)/],
  ['Liberação da conexão', /client\.release\(\)/]
];
for (const [label, pattern] of patterns) assert.match(block, pattern, label);
assert.ok(block.indexOf('FOR UPDATE') < block.indexOf('UPDATE credit_accounts SET balance=balance+$1'), 'Crédito antes do bloqueio');
assert.ok(block.indexOf('if (!checked.paid') < block.indexOf('UPDATE credit_accounts SET balance=balance+$1'), 'Crédito antes da confirmação');
console.log('Carteira Pix: ' + patterns.length + ' invariantes estruturais preservadas. Requer teste de concorrência em Postgres isolado.');
