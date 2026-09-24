"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const {mergeReports} = require("./unified-report");
test("preserva FonteData e agrega API Full sem duplicar consulta", () => {
 const original = {plate:"ABC1D23",source:"fontedata",indicators:{theft:false}};
 const merged = mergeReports(original,{leilao:{status:"ok",dados:{ocorrencias:1}}});
 assert.equal(merged.plate,"ABC1D23");
 assert.equal(merged.indicators.theft,false);
 assert.equal(merged.complementosApiFull.leilao.ocorrencias,1);
 assert.equal(merged.fontes.apiFull.debitos,"nao_consultado");
 assert.equal(original.complementosApiFull,undefined);
});
test("falha parcial nao vira resultado negativo",()=>{
 const merged=mergeReports({plate:"ABC1D23"},{debitos:{status:"erro",error:"timeout"},rouboFurto:{status:"pendente",dados:{ocorrencias:0}}});
 assert.equal(merged.fontes.apiFull.debitos,"indisponivel");
 assert.equal(merged.fontes.apiFull.rouboFurto,"nao_confirmado");
 assert.equal(merged.complementosApiFull.debitos,undefined);
});
test("divergencias ficam visiveis",()=>{
 const merged=mergeReports({plate:"ABC1D23"},{leilao:{status:"ok",dados:true}},{baselineByService:{leilao:false}});
 assert.equal(merged.divergencias.length,1);
});
test("rejeita relatorio FonteData invalido",()=>assert.throws(()=>mergeReports(null),TypeError));

test("não declara duas fontes sem retorno da API Full",()=>{
 const onlyFonteData=mergeReports({plate:"ABC1D23"},{});
 assert.equal(onlyFonteData.relatorioUnificado,false);
 assert.ok(Object.values(onlyFonteData.fontes.apiFull).every(x=>x==="nao_consultado"));
 const withComplement=mergeReports({plate:"ABC1D23"},{leilao:{status:"ok",dados:{ocorrencias:1}}});
 assert.equal(withComplement.relatorioUnificado,true);
});
