"use strict";
// Monta configuração de autenticação offline. Não efetua requisições.
const DEFAULT_BASE_URL = "https://api.apifull.com.br";
function getAuthConfig(env = process.env) {
 const token = String(env.APIFULL_TOKEN || "").trim();
 const enabled = String(env.APIFULL_ENABLED || "false").trim().toLowerCase() === "true";
 const url = new URL(String(env.APIFULL_BASE_URL || DEFAULT_BASE_URL));
 if (url.protocol !== "https:" || url.hostname !== "api.apifull.com.br" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
   throw new Error("Host da API Full não autorizado.");
 }
 return {enabled, configured:Boolean(token), baseUrl:url.origin, authScheme:"Bearer"};
}
function buildAuthHeaders(token) {
 const clean=String(token || "").trim();
 if (!clean || /[\r\n]/.test(clean)) throw new Error("Token API Full ausente ou inválido.");
 return {Authorization:"Bearer "+clean, Accept:"application/json"};
}
module.exports={DEFAULT_BASE_URL,getAuthConfig,buildAuthHeaders};
