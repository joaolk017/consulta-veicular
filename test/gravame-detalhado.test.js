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

const { EventEmitter } = require("node:events");

function mockTransport(statusCode, body, capture) {
  return {
    request(url, options, callback) {
      capture.url = String(url);
      capture.options = options;
      const req = new EventEmitter();
      req.setTimeout = () => {};
      req.destroy = error => req.emit("error", error);
      req.end = () => {
        const res = new EventEmitter();
        res.statusCode = statusCode;
        process.nextTick(() => {
          callback(res);
          res.emit("data", Buffer.from(JSON.stringify(body)));
          res.emit("end");
        });
      };
      return req;
    }
  };
}

test("consulta simulada: monta POST, autentica e interpreta JSON sem rede", async () => {
  const capture = {};
  const result = await fetchGravameDetalhado("abc1d23", {
    enabled: true,
    apiKey: "CHAVE_FICTICIA_NAO_REAL",
    transport: mockTransport(200, {
      temGravame: true, situacao: "ATIVO",
      agenteFinanceiro: {nome:"Banco Simulado",documento:"DOCUMENTO_FICTICIO"},
      contrato: {numero:"CONTRATO_TESTE"},
      veiculo: {placa:"ABC1D23",chassi:"CHASSI_FICTICIO"}
    }, capture)
  });
  assert.equal(capture.options.method, "POST");
  assert.equal(capture.options.headers["X-API-Key"], "CHAVE_FICTICIA_NAO_REAL");
  assert.equal(new URL(capture.url).searchParams.get("placa"), "ABC1D23");
  assert.equal(result.details.temGravame, true);
  assert.equal(result.details.agenteFinanceiro.nome, "Banco Simulado");
  assert.equal(result.details.contrato.numero, "CONTRATO_TESTE");
});

test("consulta simulada: erro do provedor não é tratado como ausência de gravame", async () => {
  await assert.rejects(fetchGravameDetalhado("ABC1D23", {
    enabled: true,
    apiKey: "CHAVE_FICTICIA_NAO_REAL",
    transport: mockTransport(403, {error:"nao_autorizado"}, {})
  }), /indisponível no provedor/);
});

test("resposta real anonimizada: gravame baixado não é gravame ativo", () => {
  // Estrutura e estados observados em uma consulta real; identificadores substituídos.
  const data = summarizeGravame({
    veiculo: {placa:"ABC1D23",chassi:"CHASSI_FICTICIO",marcaModelo:""},
    temGravame:false,
    situacao:"BAIXADO",
    situacaoDescricao:"Veículo teve gravame baixado pelo agente financeiro(04)",
    agenteFinanceiro:{nome:"FINANCEIRA_EXEMPLO",documento:"DOCUMENTO_FICTICIO",codigo:"2949"},
    restricao:{numero:"RESTRICAO_FICTICIA",data:"28/09/2015",uf:"SP"},
    contrato:{numero:"CONTRATO_FICTICIO",data:"05/07/2013",uf:"SP"}
  });
  assert.equal(data.temGravame,false);
  assert.equal(data.situacao,"BAIXADO");
  assert.match(data.situacaoDescricao,/baixado/);
  assert.equal(data.veiculo.marcaModelo,null);
  assert.equal(data.agenteFinanceiro.nome,"FINANCEIRA_EXEMPLO");
  assert.equal(data.contrato.data,"05/07/2013");
  assert.equal(data.restricao.uf,"SP");
});
