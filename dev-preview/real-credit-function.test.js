'use strict';
// Executa a função REAL creditPaidPayment extraída do servidor, sem iniciar servidor,
// APIs externas, webhooks ou conexão ao Render. Somente PostgreSQL local descartável.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {Client}=require('pg');
const url=process.env.TEST_DATABASE_URL;
assert.equal(url,'postgresql://test_user:test_password@127.0.0.1:5432/test_db','Somente Postgres local descartável');
const source=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
const start=source.indexOf('async function creditPaidPayment(checked) {');
const end=source.indexOf('\nasync function ',start+1);
assert.ok(start>=0 && end>start,'Função real não localizada');
const fnSource=source.slice(start,end);
const account='00000000-0000-4000-8000-000000000002';
const packages={
 'consulta-completa':{id:'consulta-completa',cents:1890,credits:1},
 'pacote-2':{id:'pacote-2',cents:3290,credits:2},
 'pacote-3':{id:'pacote-3',cents:4490,credits:3},
 'upsell-2':{id:'upsell-2',cents:2490,credits:2}
};
async function main(){
 const db=new Client({connectionString:url});
 await db.connect();
 try{
  await db.query(fs.readFileSync(path.join(__dirname,'test-db-schema.sql'),'utf8'));
  await db.query(`CREATE TABLE IF NOT EXISTS funnel_events(
    id BIGSERIAL PRIMARY KEY,session_id TEXT NOT NULL,event_name TEXT NOT NULL,
    product TEXT,amount_cents INTEGER,is_test BOOLEAN NOT NULL DEFAULT FALSE,
    correlation_id TEXT,created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_test_pix_pago ON funnel_events(correlation_id) WHERE event_name='pix_pago'`);
  await db.query('INSERT INTO credit_accounts(id) VALUES($1)',[account]);
  const context={pool:{connect:async()=>{const client=new Client({connectionString:url});await client.connect();return {query:(...args)=>client.query(...args),release:()=>client.end()};}},requireDatabase:()=>{},paymentProduct:id=>packages[id],crypto};
  const real=vm.runInNewContext(fnSource+'\ncreditPaidPayment',context,{timeout:1000});
  let expected=0;
  for(const [id,p] of Object.entries(packages)){
   const correlationID='cv-real-test-'+id;
   await db.query('INSERT INTO payments(correlation_id,account_id,product,cents,credits) VALUES($1,$2,$3,$4,$5)',[correlationID,account,id,p.cents,p.credits]);
   const checked={paid:true,payload:{correlationID,accountId:account,product:id,cents:p.cents}};
   const first=await real(checked);
   assert.equal(first.alreadyCredited,false);
   expected+=p.credits;
   assert.equal(first.balance,expected);
   const replay=await real(checked);
   assert.equal(replay.alreadyCredited,true);
   assert.equal(replay.balance,expected);
  }
  const concurrent='cv-real-test-concurrent';
  await db.query('INSERT INTO payments(correlation_id,account_id,product,cents,credits) VALUES($1,$2,$3,$4,$5)',[concurrent,account,'consulta-completa',1890,1]);
  const checked={paid:true,payload:{correlationID:concurrent,accountId:account,product:'consulta-completa',cents:1890}};
  const two=await Promise.all([real(checked),real(checked)]);
  assert.equal(two.filter(x=>x.alreadyCredited===false).length,1);
  expected+=1;
  const balance=await db.query('SELECT balance FROM credit_accounts WHERE id=$1',[account]);
  assert.equal(balance.rows[0].balance,expected);
  const count=await db.query("SELECT COUNT(*)::int AS n FROM credit_transactions WHERE type='purchase' AND account_id=$1",[account]);
  assert.equal(count.rows[0].n,5);
  const events=await db.query("SELECT COUNT(*)::int AS n FROM funnel_events WHERE event_name='pix_pago' AND correlation_id LIKE 'cv-real-test-%'");
  assert.equal(events.rows[0].n,5);
  const bad='cv-real-test-bad';
  await db.query('INSERT INTO payments(correlation_id,account_id,product,cents,credits) VALUES($1,$2,$3,$4,$5)',[bad,account,'consulta-completa',1890,1]);
  await assert.rejects(real({paid:true,payload:{correlationID:bad,accountId:account,product:'consulta-completa',cents:1}}),/correspondem/);
  const still=await db.query('SELECT credited_at FROM payments WHERE correlation_id=$1',[bad]);
  assert.equal(still.rows[0].credited_at,null);
  console.log('Função REAL creditPaidPayment: 4 produtos, replay, concorrência, funil e rollback aprovados.');
 }finally{await db.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
