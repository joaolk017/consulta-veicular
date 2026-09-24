"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {summarizeComplements,telegramComplementText}=require("./apifull-presentation");
test("dados indisponíveis não viram nada consta",()=>{
 const report={fontes:{apiFull:{debitos:"indisponivel",leilao:"ok"}},complementosApiFull:{leilao:{ocorrencias:1}}};
 const items=summarizeComplements(report);
 assert.equal(items.find(x=>x.service==="debitos").data,null);
 assert.equal(items.find(x=>x.service==="leilao").data.ocorrencias,1);
 assert.match(telegramComplementText(report),/ausência de dados não confirma/);
});
test("relatório sem API Full informa não consultado",()=>{
 const items=summarizeComplements({source:"fontedata"});
 assert.ok(items.every(x=>x.status==="nao_consultado"));
});
