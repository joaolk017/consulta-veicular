"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {getAuthConfig,buildAuthHeaders}=require("./apifull-auth-config");
test("desativada por padrão e não revela token",()=>{
 const config=getAuthConfig({APIFULL_TOKEN:"segredo",APIFULL_ENABLED:"false"});
 assert.equal(config.enabled,false);
 assert.equal(config.configured,true);
 assert.equal(JSON.stringify(config).includes("segredo"),false);
});
test("prepara cabeçalho Bearer sem chamada externa",()=>assert.equal(buildAuthHeaders("abc").Authorization,"Bearer abc"));
test("rejeita host externo e token com quebra de linha",()=>{
 assert.throws(()=>getAuthConfig({APIFULL_BASE_URL:"https://example.com"}));
 assert.throws(()=>buildAuthHeaders("abc\r\nInjected: 1"));
});
