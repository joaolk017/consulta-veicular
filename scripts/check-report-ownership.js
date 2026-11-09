const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const server = fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
function route(method,url){
 const marker='app.'+method+'("'+url+'",';
 const start=server.indexOf(marker);
 assert.ok(start>=0,'Rota ausente: '+method.toUpperCase()+' '+url);
 const end=server.indexOf('\napp.',start+marker.length);
 return server.slice(start,end<0?undefined:end);
}
const list=route('get','/api/minhas-consultas');
const detail=route('get','/api/minhas-consultas/:id');
for(const [name,body] of [['histórico',list],['relatório individual',detail]]){
 assert.ok(body.includes('verifyAccountToken(req.get("X-Credit-Account"))'),'Autenticação ausente: '+name);
 assert.ok(body.includes('enforceSensitiveRateLimit('),'Limite de acesso ausente: '+name);
}
assert.ok(list.includes('WHERE account_id=$1'),'Histórico deve ser filtrado pela conta autenticada');
assert.ok(list.includes('LIMIT 100'),'Histórico deve ter paginação ou limite');
assert.ok(detail.includes('WHERE id=$1 AND account_id=$2 LIMIT 1'),'Relatório deve verificar ID e titularidade da conta');
assert.ok(detail.includes('[req.params.id, accountId]'),'Consulta deve usar parâmetros SQL seguros');
assert.ok(detail.includes('if (!q.rowCount) return res.status(404)'),'Relatórios de outras contas devem retornar não encontrado');
assert.ok(detail.includes('row.status!=="completed" || !row.result_json'),'Relatórios incompletos não devem ser expostos');
console.log('Controle de acesso a histórico e relatórios: verificações estáticas aprovadas.');
