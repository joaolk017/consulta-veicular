"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { installGravameCheckout } = require("../gravame-checkout");

function fixture() {
  const previous = process.env.GRAVAME_DETALHADO_ENABLED;
  process.env.GRAVAME_DETALHADO_ENABLED = "1";
  const routes = {};
  let status = "pending";
  let report = null;
  let providerError = false;
  let apiCalls = 0;
  let pixCalls = 0;
  const purchase = {
    correlation_id:"cv-gravame-simulado",account_id:"account-test",plate:"ABC1D23",
    cents:2990,status:"pending",result_json:null
  };
  const pool = { async query(sql, args=[]) {
    if (sql.includes("CREATE TABLE")) return {rowCount:0,rows:[]};
    if (sql.startsWith("INSERT INTO gravame_purchases")) return {rowCount:1,rows:[]};
    if (sql.startsWith("SELECT * FROM gravame_purchases")) return {rowCount:1,rows:[{...purchase}]};
    if (sql.includes("SET status='paid'")) { if (purchase.status==="pending") purchase.status="paid"; return {rowCount:1,rows:[]}; }
    if (sql.includes("SET status='running'")) {
      if (!["pending","paid"].includes(purchase.status)) return {rowCount:0,rows:[]};
      purchase.status="running";
      return {rowCount:1,rows:[{plate:purchase.plate}]};
    }
    if (sql.includes("SET status='completed'")) {
      purchase.status="completed";purchase.result_json=JSON.parse(args[1]);
      return {rowCount:1,rows:[]};
    }
    if (sql.includes("SET status='review'")) {purchase.status="review";return {rowCount:1,rows:[]};}
    throw new Error("SQL inesperado: "+sql);
  }};
  installGravameCheckout({
    app:{post(path,handler){routes[path]=handler;}},
    pool,requireDatabase(){},
    ensureAccount:async()=>({id:"account-test",token:"account-token"}),
    createOpenPixCharge:async()=>{pixCalls++;return {status:"ACTIVE",brCode:"PIX_SIMULADO"};},
    getOpenPixCharge:async()=>({status,value:2990}),
    signPaymentToken:()=> "token-simulado",
    verifyPaymentToken:()=>({v:3,provider:"openpix",product:"gravame-detalhado",cents:2990,accountId:"account-test",plate:"ABC1D23",correlationID:"cv-gravame-simulado"}),
    checkPaymentRateLimit:()=>({allowed:true}),
    fetchGravame:async()=>{apiCalls++;if(providerError)throw new Error("Falha simulada do fornecedor");return report || {plate:"ABC1D23",details:{temGravame:true,situacao:"ATIVO"}};}
  });
  async function call(path,body={paymentToken:"token-simulado"}) {
    const req={body};let code=200;let output;
    const res={status(value){code=value;return this;},json(value){output=value;return this;}};
    await routes[path](req,res);
    return {code,body:output};
  }
  return {call,purchase,setStatus(v){status=v;},setReport(v){report=v;},setProviderError(v){providerError=v;},get apiCalls(){return apiCalls;},get pixCalls(){return pixCalls;},restore(){if(previous===undefined)delete process.env.GRAVAME_DETALHADO_ENABLED;else process.env.GRAVAME_DETALHADO_ENABLED=previous;}};
}

test("PIX simulado: cobrança separada de R$ 29,90 sem API real",async()=>{
  const f=fixture();
  try {
    const r=await f.call("/api/gravame/pix/criar",{placa:"ABC1D23"});
    assert.equal(r.code,201);
    assert.equal(r.body.valor,29.90);
    assert.equal(r.body.copyPaste,"PIX_SIMULADO");
    assert.equal(f.pixCalls,1);
    assert.equal(f.apiCalls,0);
  } finally {f.restore();}
});

test("PIX pendente não libera relatório nem consulta paga",async()=>{
  const f=fixture();
  try {
    const r=await f.call("/api/gravame/relatorio");
    assert.equal(r.code,402);
    assert.equal(f.apiCalls,0);
    assert.equal(f.purchase.status,"pending");
  } finally {f.restore();}
});

test("PIX pago libera exatamente uma consulta e permite recuperar relatório",async()=>{
  const f=fixture();
  try {
    f.setStatus("COMPLETED");
    const status=await f.call("/api/gravame/status");
    assert.equal(status.body.pago,true);
    const first=await f.call("/api/gravame/relatorio");
    const second=await f.call("/api/gravame/relatorio");
    assert.equal(first.body.status,"completed");
    assert.equal(second.body.status,"completed");
    assert.equal(f.apiCalls,1);
    assert.deepEqual(second.body.resultado,first.body.resultado);
  } finally {f.restore();}
});

test("falha da API entra em revisão sem nova cobrança automática",async()=>{
  const f=fixture();
  try {
    f.setStatus("COMPLETED");
    f.setProviderError(true);
    const first=await f.call("/api/gravame/relatorio");
    assert.equal(first.code,202);
    assert.equal(first.body.status,"review");
    assert.equal(f.apiCalls,1);
    const second=await f.call("/api/gravame/relatorio");
    assert.equal(second.code,202);
    assert.equal(second.body.status,"review");
    assert.equal(f.apiCalls,1);
  } finally {f.restore();}
});
