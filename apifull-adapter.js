"use strict";
// API Full adapter: disabled by default. Never call paid services during preview.
// Configure endpoint paths only after checking the contracted API documentation.
const https = require("https");
const BASE = "https://app.apifull.com.br";
const enabled = process.env.APIFULL_ENABLED === "true";
const token = String(process.env.APIFULL_TOKEN || "").trim();
const allowed = Object.freeze({
  debitos: process.env.APIFULL_DEBITOS_PATH || "",
  gravame: process.env.APIFULL_GRAVAME_PATH || "",
  rouboFurto: process.env.APIFULL_ROUBO_FURTO_PATH || ""
});
function configured() {
  return enabled && Boolean(token) && Object.values(allowed).every(p => /^\/api\/[a-z0-9-]+$/.test(p));
}
function getStatus() {
  return {enabled, ready:configured(), configuredServices:Object.fromEntries(Object.entries(allowed).map(([k,v])=>[k,Boolean(v)]))};
}
// Deliberately no request implementation until auth header, request method and
// response schema are verified against the account's API Full documentation.
async function consultAfterConfirmedPayment() {
  throw new Error("API Full ainda não ativada: confirme documentação, autorização e preços antes de consultas pagas.");
}
module.exports = {getStatus, consultAfterConfirmedPayment};
