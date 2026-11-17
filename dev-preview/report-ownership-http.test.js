'use strict';
// Isolamento de relatórios usando a rota real extraída do servidor e PostgreSQL descartável.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const express=require('express'),crypto=require('node:crypto'),{Pool}=require('pg');
const url=process.env.TEST_DATABASE_URL;
assert.equal(url,'postgresql://test_user:test_password@127.0.0.1:5432/test_db');
const src=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const start=src.indexOf('app.get("/api/minhas-consultas/:id", async (req, res) => {');
const end=src.indexOf('\napp.post(',start);
assert.ok(start>=0&&end>start,'Rota real de relatório não localizada');
const accountA='00000000-0000-4000-8000-0000000000a1';
const accountB='00000000-0000-4000-8000-0000000000b2';
const secret='test-only-signing-secret-not-production';
const authStart=src.indexOf('function secureEqual(');
const signStart=src.indexOf('function signAccountToken(');
const authEnd=src.indexOf('async function ensureAccount(',signStart);
assert.ok(signStart>=0&&authEnd>signStart,'Autenticação real não localizada');
const authContext={crypto,PAYMENT_SIGNING_SECRET:secret,secureEqual:(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);}};
vm.runInNewContext(src.slice(signStart,authEnd),authContext,{timeout:1000});
const tokenA=authContext.signAccountToken(accountA),tokenB=authContext.signAccountToken(accountB);
assert.equal(authContext.verifyAccountToken(tokenA),accountA);
assert.equal(authContext.verifyAccountToken(tokenB),accountB);
assert.throws(()=>authContext.verifyAccountToken(tokenA+'tampered'),'Token alterado não pode ser aceito');
async function main(){
 const pool=new Pool({connectionString:url});
 const app=express();
 try{
  await pool.query('CREATE TABLE IF NOT EXISTS vehicle_queries(id UUID PRIMARY KEY,account_id UUID NOT NULL,plate TEXT NOT NULL,status TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW(),completed_at TIMESTAMPTZ,result_json JSONB)');
  const reportA='00000000-0000-4000-8000-0000000000a2';
  const reportB='00000000-0000-4000-8000-0000000000b3';
  const pending='00000000-0000-4000-8000-0000000000a4';
  for(const [id,owner,status] of [[reportA,accountA,'completed'],[reportB,accountB,'completed'],[pending,accountA,'pending']]){
   await pool.query('INSERT INTO vehicle_queries(id,account_id,plate,status,result_json) VALUES($1,$2,$3,$4,$5)',[id,owner,'ABC1D23',status,{plate:'ABC1D23'}]);
  }
  vm.runInNewContext(src.slice(start,end),{app,pool,requireDatabase:()=>{},enforceSensitiveRateLimit:()=>true,verifyAccountToken:authContext.verifyAccountToken,buildVehicle360Report:()=>({alerts:[]})},{timeout:1000});
  const server=app.listen(0,'127.0.0.1');await new Promise(ok=>server.once('listening',ok));
  try{
   async function get(id,token){const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/minhas-consultas/'+id,{headers:token?{'X-Credit-Account':token}:{}});return {status:r.status,body:await r.json()};}
   assert.equal((await get(reportA,tokenA)).status,200,'Titular A deve ler seu relatório');
   assert.equal((await get(reportB,tokenB)).status,200,'Titular B deve ler seu relatório');
   assert.equal((await get(reportA,tokenB)).status,404,'B não pode ler relatório de A');
   assert.equal((await get(reportB,tokenA)).status,404,'A não pode ler relatório de B');
   assert.equal((await get(reportA)).status,401,'Acesso sem token deve falhar');
   assert.equal((await get(pending,tokenA)).status,409,'Relatório pendente não pode ser exibido');
   assert.equal((await get('00000000-0000-4000-8000-000000000099',tokenA)).status,404,'Relatório inexistente não deve aparecer');
   assert.equal((await get(reportA,tokenA+'tampered')).status,401,'Token com assinatura adulterada deve falhar');
   console.log('Isolamento entre duas contas: oito cenários HTTP com PostgreSQL descartável e assinatura HMAC real aprovados.');
  }finally{await new Promise(ok=>server.close(ok));}
 }finally{await pool.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
