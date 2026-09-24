"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const api = require("./apifull-adapter");
test("adaptador permanece desativado",()=>{assert.equal(api.getStatus().enabled,false);assert.equal(api.getStatus().authVerified,false);});
test("prepara placa válida sem requisição",()=>{const r=api.prepareRequest("debitos",{placa:"abc1d23"});assert.equal(r.method,"POST");assert.equal(r.path,"/api/debitos-veicular");assert.equal(r.body.placa,"ABC1D23");});
test("rejeita placa inválida",()=>assert.throws(()=>api.prepareRequest("debitos",{placa:"INVÁLIDA"})));
test("não executa consulta paga",async()=>await assert.rejects(api.consultAfterConfirmedPayment(),/desativada/));
