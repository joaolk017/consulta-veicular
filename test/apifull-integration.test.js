"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { buildRequest, classifyResponse, mergeReport, normalizePlate, normalizeChassis } = require("../apifull-integration");
test("normaliza placa sem chamar provedor", () => {
  assert.equal(normalizePlate("abc-1d23"), "ABC1D23");
  assert.throws(() => normalizePlate("123"), /inválida/);
});
test("gravame exige chassi completo", () => {
  assert.equal(normalizeChassis("9BWZZZ377VT004251"), "9BWZZZ377VT004251");
  assert.throws(() => buildRequest("gravame", { placa:"ABC1D23" }), /Chassi/);
});
test("prepara somente serviços conhecidos", () => {
  assert.deepEqual(buildRequest("debitos", { placa:"ABC1D23" }), {
    path:"/api/debitos-veicular", method:"POST", body:{ link:"debitos-veicular", placa:"ABC1D23" }
  });
  assert.throws(() => buildRequest("sinistro", { placa:"ABC1D23" }), /não autorizado/);
});
test("não sobrescreve relatório base nem inventa resultados", () => {
  const base = { placa:"ABC1D23", indicators:{ auction:null } };
  const merged = mergeReport(base, { leilao:{ok:true,data:{status:"sem retorno conclusivo"}}, debitos:{ok:false,data:{valor:0}} });
  assert.deepEqual(base, { placa:"ABC1D23", indicators:{ auction:null } });
  assert.equal(merged.indicators.auction, null);
  assert.deepEqual(Object.keys(merged.complementosApiFull), ["leilao"]);
  assert.equal(merged.complementosApiFull.leilao.source, "API Full");
});

test("rejeita erro de saldo retornado com HTTP 200", () => {
  assert.deepEqual(classifyResponse(200, {status:"erro",dados:"Saldo insuficiente"}), {ok:false,reason:"provider_error"});
  assert.deepEqual(classifyResponse(200, {status:"desconhecido",dados:{}}), {ok:false,reason:"unconfirmed_status"});
  assert.deepEqual(classifyResponse(503, {status:"sucesso",dados:{}}), {ok:false,reason:"http_error"});
});
test("aceita apenas resposta explicitamente bem-sucedida com dados", () => {
  assert.deepEqual(classifyResponse(200, {status:"sucesso",dados:{leilao:[]}}), {ok:true,data:{leilao:[]}});
  assert.deepEqual(classifyResponse(200, {status:"sucesso"}), {ok:false,reason:"missing_data"});
});

test("usa a rota atual de roubo e furto por placa", () => {
  assert.deepEqual(buildRequest("rouboFurto", {placa:"ABC1D23"}), {
    path:"/api/roubo-furto", method:"POST", body:{link:"roubo-furto",placa:"ABC1D23"}
  });
});
