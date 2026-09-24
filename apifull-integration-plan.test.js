"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {buildPlan,previewUnifiedReport}=require("./apifull-integration-plan");
test("planeja sem consultas e sem expor identificadores",()=>{
 const plan=buildPlan({plate:"ABC1D23",rawChassis:"9BGTT08C01B151499"},["debitos","gravame"]);
 assert.equal(plan.callsExecuted,0);
 assert.equal(plan.enabled,false);
 assert.equal(plan.plan.gravame.eligible,true);
 assert.equal(JSON.stringify(plan).includes("9BGTT08C01B151499"),false);
});
test("chassi mascarado impede gravame",()=>{
 const plan=buildPlan({plate:"ABC1D23",chassi:"*************1499"},["gravame"]);
 assert.equal(plan.plan.gravame.eligible,false);
});
test("fixture gera relatorio sem acesso externo",()=>{
 const report=previewUnifiedReport({plate:"ABC1D23",source:"fontedata"},{debitos:{status:"ok",dados:{total:0}}});
 assert.equal(report.complementosApiFull.debitos.total,0);
});
