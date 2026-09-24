"use strict";
// Apresentação compartilhada dos complementos já obtidos. Nenhuma chamada externa.
const LABELS=Object.freeze({debitos:"Débitos",gravame:"Gravame",rouboFurto:"Roubo e furto",historicoRouboFurto:"Histórico de roubo e furto",leilao:"Leilão",fotoLeilao:"Fotos de leilão"});
const STATUS=Object.freeze({nao_consultado:"Não consultado",indisponivel:"Temporariamente indisponível",nao_confirmado:"Não confirmado",sem_dados:"Sem dados retornados",ok:"Dados disponíveis"});
function summarizeComplements(report) {
 if(!report || typeof report!=="object") throw new TypeError("Relatório inválido");
 const statuses=report.fontes?.apiFull || {};
 return Object.entries(LABELS).map(([key,label])=>({service:key,label,status:statuses[key]||"nao_consultado",statusLabel:STATUS[statuses[key]]||STATUS.nao_consultado,data:statuses[key]==="ok"?(report.complementosApiFull?.[key]??null):null}));
}
function telegramComplementText(report) {
 const items=summarizeComplements(report);
 return "DADOS COMPLEMENTARES - API FULL\n"+items.map(x=>x.label+": "+x.statusLabel).join("\n")+"\n\nA ausência de dados não confirma a inexistência de débitos, restrições ou ocorrências.";
}
module.exports={summarizeComplements,telegramComplementText};
