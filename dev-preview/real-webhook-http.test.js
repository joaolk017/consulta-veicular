'use strict';
// Executa a rota HTTP e a função de crédito extraídas do server.js real.
// Provedor Woovi totalmente simulado: nenhuma chamada de rede ao provedor.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const express=require('express'),{Pool,Client}=require('pg');
const url=process.env.TEST_DATABASE_URL;
assert.equal(url,'postgresql://test_user:test_password@127.0.0.1:5432/test_db');
const src=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
function extract(startText,endText){
 const start=src.indexOf(startText),end=src.indexOf(endText,start+startText.length);
 assert.ok(start>=0&&end>start,'Trecho do servidor não encontrado: '+startText);
 return src.slice(start,end);
}
const credit=extract('async function creditPaidPayment(checked) {','\nasync function ');
const route=extract('app.post("/api/pagamento/pix/webhook", async (req, res) => {','\n// QR servido');
const account='00000000-0000-4000-8000-000000000003';
const id='cv-http-test-001';
const secret='test-only-webhook-secret';
const product={id:'consulta-completa',cents:1890,credits:1,amount:18.90};
async function main(){
 const db=new Client({connectionString:url});await db.connect();
 const pool=new Pool({connectionString:url});
 let providerCalls=0;
 let provider={status:'COMPLETED',value:1890};
 try{
  await db.query(fs.readFileSync(path.join(__dirname,'test-db-schema.sql'),'utf8'));
  await db.query(`CREATE TABLE IF NOT EXISTS funnel_events(id BIGSERIAL PRIMARY KEY,session_id TEXT NOT NULL,event_name TEXT NOT NULL,product TEXT,amount_cents INTEGER,is_test BOOLEAN DEFAULT FALSE,correlation_id TEXT,created_at TIMESTAMPTZ DEFAULT NOW())`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_http_pix_pago ON funnel_events(correlation_id) WHERE event_name='pix_pago'`);
  await db.query('INSERT INTO credit_accounts(id) VALUES($1)',[account]);
  await db.query('INSERT INTO payments(correlation_id,account_id,product,cents,credits) VALUES($1,$2,$3,$4,$5)',[id,account,product.id,product.cents,product.credits]);
  const app=express();app.use(express.json());
  const context={app,pool,crypto,console,OPENPIX_WEBHOOK_SECRET:secret,confirmedPaymentCache:new Map(),requireDatabase:()=>{},paymentProduct:x=>x===product.id?product:null,secureEqual:(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y)},getOpenPixCharge:async()=>{providerCalls++;return {...provider}}};
  vm.runInNewContext(credit+'\n'+route,context,{timeout:1000});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  async function send(authorization,event='OPENPIX:CHARGE_COMPLETED',correlationID=id){
   const res=await fetch(base+'/api/pagamento/pix/webhook',{method:'POST',headers:{'Content-Type':'application/json',...(authorization===null?{}:{Authorization:authorization})},body:JSON.stringify({event,charge:{correlationID}})});
   return {status:res.status,body:await res.json()};
  }
  try{
   assert.equal((await send(null)).status,401);
   assert.equal((await send('wrong')).status,401);
   assert.equal(providerCalls,0);
   assert.equal((await send(secret,'OPENPIX:CHARGE_CREATED')).body.ignored,true);
   assert.equal((await send(secret,'OPENPIX:CHARGE_COMPLETED','not-cv')).body.ignored,true);
   provider={status:'ACTIVE',value:1890};
   assert.equal((await send(secret)).body.ignored,true);
   provider={status:'COMPLETED',value:100};
   assert.equal((await send(secret)).body.ignored,true);
   let balance=await db.query('SELECT balance FROM credit_accounts WHERE id=$1',[account]);
   assert.equal(balance.rows[0].balance,0);
   provider={status:'COMPLETED',value:1890};
   const two=await Promise.all([send(secret),send(secret)]);
   assert.deepEqual(two.map(x=>x.status),[200,200]);
   assert.ok(two.every(x=>x.body.ok===true));
   assert.equal((await send(secret)).status,200);
   balance=await db.query('SELECT balance FROM credit_accounts WHERE id=$1',[account]);
   assert.equal(balance.rows[0].balance,1);
   const tx=await db.query("SELECT COUNT(*)::int AS n FROM credit_transactions WHERE account_id=$1 AND type='purchase'",[account]);
   assert.equal(tx.rows[0].n,1);
   const ev=await db.query("SELECT COUNT(*)::int AS n FROM funnel_events WHERE correlation_id=$1 AND event_name='pix_pago'",[id]);
   assert.equal(ev.rows[0].n,1);
   console.log('Webhook HTTP REAL: segredo, eventos ignorados, estado/valor, concorrência e crédito único aprovados (Woovi simulada).');
  }finally{await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
 }finally{await pool.end();await db.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
