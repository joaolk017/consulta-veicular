"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const html=fs.readFileSync(require("node:path").join(__dirname,"index.html"),"utf8");
test("seção API Full está conectada ao relatório pago",()=>{
 assert.match(html,/function renderApiFullComplement\(v\)/);
 assert.match(html,/h\+=renderApiFullComplement\(v\)/);
 assert.match(html,/id="paidApiFull"/);
});
test("site informa cobertura sem prometer nada consta",()=>{
 assert.match(html,/Não consultado ou sem dados não significa ausência/);
 assert.match(html,/const details=status==='ok'/);
 assert.match(html,/esc\(JSON\.stringify\(v\.complementosApiFull\[key\]/);
});
test("API Full não é chamada pela apresentação",()=>{
 const section=html.split("function renderApiFullComplement(v){")[1].split("function renderReport(v){")[0];
 assert.doesNotMatch(section,/fetch\s*\(|XMLHttpRequest|sendBeacon/);
});
