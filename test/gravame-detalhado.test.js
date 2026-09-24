"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePlate, summarizeGravame, fetchGravameDetalhado } = require("../gravame-detalhado");

test("aceita placa Mercosul e tradicional", () => {
  assert.equal(normalizePlate("abc1d23"), "ABC1D23");
  assert.equal(normalizePlate("ABC-1234"), "ABC1234");
});
test("rejeita placa inválida", () => assert.throws(() => normalizePlate("123"), /Placa inválida/));
test("não infere ausência de gravame quando campos faltam", () => {
  const data = summarizeGravame({});
  assert.equal(data.situacao, "INDETERMINADO");
  assert.equal(data.agenteFinanceiro.nome, null);
  assert.match(data.observacao, /não comprovam ausência/);
});
test("não executa API com módulo desativado", async () => {
  await assert.rejects(fetchGravameDetalhado("ABC1D23", { apiKey: "test" }), /desativado/);
});
test("não executa API sem chave", async () => {
  await assert.rejects(fetchGravameDetalhado("ABC1D23", { enabled: true }), /não configurada/);
});

test("interpreta o esquema JSON documentado de gravame ativo", () => {
  const data = summarizeGravame({
    temGravame: true, situacao: "ATIVO", situacaoDescricao: "Alienação fiduciária",
    agenteFinanceiro: { nome: "Banco Exemplo", codigo: "123", documento: "00000000000100" },
    restricao: { numero: "R1", data: "2026-09-20", uf: "SP" },
    contrato: { numero: "C1", data: "2026-09-19", uf: "SP" },
    veiculo: { placa: "ABC1D23", chassi: "EXEMPLO", marcaModelo: "Modelo" }
  });
  assert.equal(data.temGravame, true);
  assert.equal(data.agenteFinanceiro.nome, "Banco Exemplo");
  assert.equal(data.contrato.numero, "C1");
  assert.equal(data.agenteFinanceiro.documento, "00000000000100");
  assert.equal(data.veiculo.chassi, "EXEMPLO");
});


test("interpreta resposta documentada com envelope data", () => {
  const data = summarizeGravame({data:{
    veiculo:{placa:"ABC1D23",chassi:"9BWEXEMPLO",marcaModelo:"MODELO"},
    contrato:{uf:"SP",data:"2026-09-20",numero:"C123"},
    situacao:"ATIVO",restricao:{uf:"SP",data:"2026-09-21",numero:"R123"},
    temGravame:true,
    agenteFinanceiro:{nome:"Banco Exemplo",codigo:"001",documento:"00000000000100"},
    situacaoDescricao:"Alienação fiduciária"
  }});
  assert.equal(data.temGravame,true);
  assert.equal(data.veiculo.chassi,"9BWEXEMPLO");
  assert.equal(data.contrato.numero,"C123");
  assert.equal(data.restricao.numero,"R123");
  assert.equal(data.agenteFinanceiro.documento,"00000000000100");
});
