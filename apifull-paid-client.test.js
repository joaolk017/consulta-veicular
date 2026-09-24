"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {enabled,fetchComplements}=require("./apifull-paid-client");
const config={APIFULL_ENABLED:"true",APIFULL_PAID_APPROVED:"confirmed",APIFULL_TOKEN:"test-only",APIFULL_BASE_URL:"https://api.apifull.com.br"};
test("sem aprovação comercial não realiza chamadas",async()=>{
  let calls=0;
  const out=await fetchComplements({placa:"ABC1D23"},()=>{calls++;throw Error("não chamar");},{...config,APIFULL_PAID_APPROVED:""});
  assert.deepEqual(out,{});assert.equal(calls,0);
});
test("com configuração incompleta permanece desativado",()=>{
  assert.equal(enabled({...config,APIFULL_ENABLED:"false"}),false);
  assert.equal(enabled({...config,APIFULL_TOKEN:""}),false);
});
test("simula dois serviços sem rede e trata falha HTTP 200",async()=>{
  const calls=[];
  const out=await fetchComplements({placa:"ABC1D23"},async(url,opts,body)=>{
    calls.push({url,opts,body});
    return url.endsWith("/api/roubo-furto")
      ? {status:200,data:{status:"sucesso",dados:{alerta:false}}}
      : {status:200,data:{status:"erro",dados:"sem saldo"}};
  },config);
  assert.equal(calls.length,2);
  assert.equal(calls[0].opts.method,"POST");
  assert.equal(calls[0].body.placa,"ABC1D23");
  assert.equal(out.rouboFurto.ok,true);
  assert.equal(out.debitos.ok,false);
});

test("rejeita domínio não oficial sem consultar nem interromper relatório",async()=>{
  let calls=0;
  const out=await fetchComplements({placa:"ABC1D23"},()=>{calls++;}, {...config,APIFULL_BASE_URL:"https://example.invalid"});
  assert.deepEqual(out,{});assert.equal(calls,0);
});
