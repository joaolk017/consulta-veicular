'use strict';
// Teste HTTP da rota real de histórico com duas contas fictícias e banco descartável.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const express=require('express'),{Pool}=require('pg');
assert.equal(process.env.TEST_DATABASE_URL,'postgresql://test_user:test_password@127.0.0.1:5432/test_db');
const src=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const a=src.indexOf('app.get("/api/minhas-consultas", async (req, res) => {');
const b=src.indexOf('app.get("/api/minhas-consultas/:id",',a);
const c=src.indexOf('function signAccountToken('),d=src.indexOf('async function ensureAccount(',c);
assert.ok(a>=0&&b>a&&c>=0&&d>c,'Rotas/funções reais não localizadas');
const auth={crypto,PAYMENT_SIGNING_SECRET:'history-isolation-test-secret',secureEqual:(x,y)=>{const l=Buffer.from(String(x)),r=Buffer.from(String(y));return l.length===r.length&&crypto.timingSafeEqual(l,r);}};
vm.runInNewContext(src.slice(c,d),auth,{timeout:1000});
const A='00000000-0000-4000-8000-0000000000a1',B='00000000-0000-4000-8000-0000000000b2';
async function main(){
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const app=express();
 try{
  await pool.query('CREATE TABLE IF NOT EXISTS vehicle_queries(id UUID PRIMARY KEY,account_id UUID NOT NULL,plate TEXT NOT NULL,status TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW(),completed_at TIMESTAMPTZ,result_json JSONB)');
  await pool.query('ALTER TABLE credit_accounts ADD COLUMN IF NOT EXISTS email TEXT');
  await pool.query('ALTER TABLE vehicle_queries ADD COLUMN IF NOT EXISTS credit_consumed BOOLEAN DEFAULT TRUE');
  await pool.query('INSERT INTO credit_accounts(id,email,balance) VALUES($1,$2,2),($3,$4,4) ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,balance=EXCLUDED.balance',[A,'a@example.test',B,'b@example.test']);
  for(const [id,owner] of [['00000000-0000-4000-8000-0000000000a2',A],['00000000-0000-4000-8000-0000000000b3',B]]){
   await pool.query('INSERT INTO vehicle_queries(id,account_id,plate,status,result_json) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[id,owner,'ABC1D23','completed',{plate:'ABC1D23'}]);
  }
  vm.runInNewContext(src.slice(a,b),{app,pool,requireDatabase:()=>{},enforceSensitiveRateLimit:()=>true,verifyAccountToken:auth.verifyAccountToken},{timeout:1000});
  const server=app.listen(0,'127.0.0.1');await new Promise(ok=>server.once('listening',ok));
  try{
   async function get(token){const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/minhas-consultas',{headers:token?{'X-Credit-Account':token}:{}});return {status:r.status,data:await r.json()};}
   const ra=await get(auth.signAccountToken(A)),rb=await get(auth.signAccountToken(B));
   assert.equal(ra.status,200);assert.equal(rb.status,200);
   assert.equal(ra.data.email,'a@example.test');assert.equal(rb.data.email,'b@example.test');
   assert.equal(ra.data.creditos,2);assert.equal(rb.data.creditos,4);
   assert.ok(ra.data.consultas.length>0&&rb.data.consultas.length>0,'Ambas as contas precisam de consultas fictícias');
   assert.ok(ra.data.consultas.every(q=>q.id!=='00000000-0000-4000-8000-0000000000b3'),'A não pode ver histórico B');
   assert.ok(rb.data.consultas.every(q=>q.id!=='00000000-0000-4000-8000-0000000000a2'),'B não pode ver histórico A');
   assert.equal((await get()).status,401);
   assert.equal((await get(auth.signAccountToken(A)+'invalid')).status,401);
   console.log('Histórico HTTP: isolamento de consultas, e-mail e créditos entre duas contas aprovado.');
  }finally{await new Promise(ok=>server.close(ok));}
 }finally{await pool.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
