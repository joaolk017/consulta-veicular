"use strict";
// Complementos pagos: desligados por padrão. Não registrar token nem payload sensível.
const {planComplementaryQueries, classifyResponse} = require("./apifull-integration");
function enabled(env) {
  return env.APIFULL_ENABLED === "true" && env.APIFULL_PAID_APPROVED === "confirmed"
    && Boolean(env.APIFULL_TOKEN && env.APIFULL_BASE_URL);
}
async function fetchComplements(identifiers, requestJson, env=process.env) {
  if (!enabled(env)) return {};
  const base = new URL(env.APIFULL_BASE_URL);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash)
    throw new Error("URL base API Full inválida.");
  const jobs = planComplementaryQueries(identifiers, ["rouboFurto","debitos"]);
  const results = {};
  for (const job of jobs) {
    if (job.status !== "ready_for_review") continue;
    try {
      const endpoint = new URL(job.request.path, base.origin);
      if (endpoint.origin !== base.origin) throw new Error("Origem API Full inválida.");
      const response = await requestJson(endpoint.href, {
        method:"POST",
        headers:{Authorization:"Bearer "+env.APIFULL_TOKEN,Accept:"application/json","Content-Type":"application/json"},
        timeout:30000
      }, job.request.body);
      const classified = classifyResponse(response.status,response.data);
      results[job.service] = classified.ok ? classified : {ok:false,reason:classified.reason};
    } catch (error) {
      results[job.service] = {ok:false,reason:"request_failed"};
    }
  }
  return results;
}
module.exports={enabled,fetchComplements};
