"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const {mergeReports}=require("./unified-report");
const {summarizeComplements,telegramComplementText}=require("./apifull-presentation");
const server=fs.readFileSync(require("node:path").join(__dirname,"server.js"),"utf8");
const preload=fs.readFileSync(require("node:path").join(__dirname,"fontedata-preload.js"),"utf8");
test("relatório fictício percorre a apresentação do site e Telegram sem consultar API",()=>{
 const base={plate:"ABC1D23",brand:"Marca fictícia",model:"Modelo fictício",indicators:{theft:null}};
 const unified=mergeReports(base,{debitos:{status:"ok",dados:{situacao:"exemplo fictício"}},leilao:{status:"erro"}});
 const sections=summarizeComplements(unified);
 assert.equal(sections.find(s=>s.service==="debitos").status,"ok");
 assert.equal(sections.find(s=>s.service==="leilao").status,"indisponivel");
 assert.equal(sections.find(s=>s.service==="gravame").status,"nao_consultado");
 assert.match(telegramComplementText(unified),/Temporariamente indisponível/);
 assert.deepEqual(base,{plate:"ABC1D23",brand:"Marca fictícia",model:"Modelo fictício",indicators:{theft:null}});
});
test("bot só prepara relatório após PIX confirmado e crédito consumido",()=>{
 assert.match(server,/if\(String\(charge\.status\|\|""\)\.toUpperCase\(\)!=="COMPLETED"\|\|Number\(charge\.value\)!==product\.cents\)continue/);
 assert.match(server,/const paidVehicle=await buildPaidVehicleReport\(order\.plate\)/);
 assert.match(server,/const report=telegramReport\(order\.plate,paidVehicle\)/);
 assert.match(server,/telegramComplementText\(vehicle\)/);
});
test("preload une dados já obtidos e não invoca adaptador pago",()=>{
 assert.match(preload,/mergeReports\(baseVehicle, \{\}\)/);
 assert.doesNotMatch(preload,/consultAfterConfirmedPayment\s*\(/);
});
