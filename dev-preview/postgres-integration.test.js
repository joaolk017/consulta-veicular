'use strict';
// Teste de transação SQL real em Postgres descartável do GitHub Actions.
// NÃO importa server.js, NÃO conecta ao Render, NÃO usa credenciais de produção.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const url = process.env.TEST_DATABASE_URL;
if (!url || !/^postgres(?:ql)?:\/\/test_user:test_password@127\.0\.0\.1:5432\/test_db$/.test(url)) {
  throw new Error('Este teste só pode usar o Postgres local descartável do CI');
}
const account = '00000000-0000-4000-8000-000000000001';
const products = [
  ['consulta-completa',1890,1],['pacote-2',3290,2],
  ['pacote-3',4490,3],['upsell-2',2490,2]
];
async function credit(client, id, product, cents, qty) {
  await client.query('BEGIN');
  try {
    const {rows:[p]} = await client.query('SELECT * FROM payments WHERE correlation_id=$1 FOR UPDATE',[id]);
    if (!p || p.product!==product || p.cents!==cents || p.credits!==qty) throw Error('Pagamento divergente');
    if (p.credited_at) { await client.query('COMMIT'); return false; }
    const tx=await client.query("INSERT INTO credit_transactions(account_id,type,quantity,reference) VALUES($1,'purchase',$2,$3) ON CONFLICT(type,reference) DO NOTHING RETURNING id",[p.account_id,qty,id]);
    if (tx.rowCount) await client.query('UPDATE credit_accounts SET balance=balance+$1 WHERE id=$2',[qty,p.account_id]);
    await client.query("UPDATE payments SET status='paid',credited_at=NOW() WHERE correlation_id=$1",[id]);
    await client.query('COMMIT');
    return !!tx.rowCount;
  } catch(e) { await client.query('ROLLBACK'); throw e; }
}
(async()=>{
  const db=new Client({connectionString:url});
  await db.connect();
  try {
    await db.query(fs.readFileSync(path.join(__dirname,'test-db-schema.sql'),'utf8'));
    await db.query('INSERT INTO credit_accounts(id) VALUES($1)',[account]);
    let expected=0;
    for (const [product,cents,qty] of products) {
      const id='test-'+product;
      await db.query('INSERT INTO payments(correlation_id,account_id,product,cents,credits) VALUES($1,$2,$3,$4,$5)',[id,account,product,cents,qty]);
      assert.equal(await credit(db,id,product,cents,qty),true);
      assert.equal(await credit(db,id,product,cents,qty),false,'Repetição não pode creditar');
      expected+=qty;
      const balance=await db.query('SELECT balance FROM credit_accounts WHERE id=$1',[account]);
      assert.equal(balance.rows[0].balance,expected);
      const count=await db.query("SELECT COUNT(*)::int AS n FROM credit_transactions WHERE type='purchase' AND reference=$1",[id]);
      assert.equal(count.rows[0].n,1);
    }
    await db.query('INSERT INTO payments(correlation_id,account_id,product,cents,credits) VALUES($1,$2,$3,$4,$5)',['invalid',account,'consulta-completa',1890,1]);
    await assert.rejects(()=>credit(db,'invalid','consulta-completa',1,1),/divergente/);
    const pending=await db.query('SELECT credited_at FROM payments WHERE correlation_id=$1',['invalid']);
    assert.equal(pending.rows[0].credited_at,null);
    const balance=await db.query('SELECT balance FROM credit_accounts WHERE id=$1',[account]);
    assert.equal(balance.rows[0].balance,expected);
    // Simula duas notificações simultâneas com conexões independentes.
    const concurrentId='test-concurrent';
    await db.query('INSERT INTO payments(correlation_id,account_id,product,cents,credits) VALUES($1,$2,$3,$4,$5)',[concurrentId,account,'consulta-completa',1890,1]);
    const db2=new Client({connectionString:url});
    await db2.connect();
    try {
      const outcomes=await Promise.all([
        credit(db,concurrentId,'consulta-completa',1890,1),
        credit(db2,concurrentId,'consulta-completa',1890,1)
      ]);
      assert.deepEqual(outcomes.sort(),[false,true],'Apenas uma confirmação concorrente deve creditar');
      const final=await db.query('SELECT balance FROM credit_accounts WHERE id=$1',[account]);
      assert.equal(final.rows[0].balance,expected+1);
      const tx=await db.query("SELECT COUNT(*)::int AS n FROM credit_transactions WHERE type='purchase' AND reference=$1",[concurrentId]);
      assert.equal(tx.rows[0].n,1);
    } finally { await db2.end(); }
    console.log('Postgres descartável: 4 produtos, idempotência, concorrência, rollback e saldo aprovados.');
  } finally { await db.end(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
