#!/usr/bin/env node
/**
 * API Full: read-only OpenAPI catalog inspection.
 * Usage: APIFULL_OPENAPI_URL=https://doc.apifull.com.br/... node scripts/apifull-catalog.js
 * Does not send bearer tokens or execute paid consultations.
 */
const fs = require('node:fs');
const url = process.env.APIFULL_OPENAPI_URL;
const output = process.env.APIFULL_CATALOG_OUTPUT || 'apifull-catalog.json';
const keywords = /leil[aã]o|gravame|d[eé]bito|roubo|furto|sinistro/i;
async function main() {
  if (!url) throw new Error('Configure APIFULL_OPENAPI_URL com a URL exata do JSON OpenAPI da API Full.');
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.hostname !== 'doc.apifull.com.br') {
    throw new Error('Somente URLs HTTPS de doc.apifull.com.br são permitidas.');
  }
  const response = await fetch(target, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('Falha ao ler contrato OpenAPI: HTTP ' + response.status);
  const spec = await response.json();
  if (!spec.paths || typeof spec.paths !== 'object') throw new Error('Resposta não contém paths OpenAPI.');
  const operations = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods || {})) {
      if (!['get','post','put','patch','delete'].includes(method) || !op || typeof op !== 'object') continue;
      const description = [path, op.summary, op.description, ...(op.tags || [])].join(' ');
      if (!keywords.test(description)) continue;
      operations.push({
        method: method.toUpperCase(), path, summary: op.summary || '',
        deprecated: !!op.deprecated,
        parameters: (op.parameters || []).map(p => ({ name: p.name, in: p.in, required: !!p.required, schema: p.schema || null })),
        requestBody: op.requestBody?.content?.['application/json']?.schema || null,
        responses: Object.fromEntries(Object.entries(op.responses || {}).map(([status, value]) => [status, value.description || '']))
      });
    }
  }
  const result = { generatedAt: new Date().toISOString(), source: target.origin + target.pathname, operations };
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.log('Catálogo salvo em ' + output + ': ' + operations.length + ' operações encontradas. Nenhuma consulta paga executada.');
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
