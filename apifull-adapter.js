"use strict";
// API Full catalog-backed configuration. This module makes NO paid requests.
// Authentication format and account entitlements still require confirmation.
const ENDPOINTS = Object.freeze({
  debitos: Object.freeze({method:"POST",path:"/api/debitos-veicular",link:"debitos-veicular",required:["placa"]}),
  gravame: Object.freeze({method:"POST",path:"/api/gravame",link:"gravame",required:["chassi"]}),
  rouboFurto: Object.freeze({method:"POST",path:"/api/roubo-furto",link:"roubo-furto",required:["placa"]}),
  historicoRouboFurto: Object.freeze({method:"POST",path:"/api/ic-historico-roubo-furto",link:"ic-historico-roubo-furto",required:["placa"]}),
  leilao: Object.freeze({method:"POST",path:"/api/leilao",link:"leilao",required:["placa"]}),
  fotoLeilao: Object.freeze({method:"POST",path:"/api/ic-foto-leilao",link:"ic-foto-leilao",required:["placa"]})
});
function normalizePlate(value) {
  const plate=String(value||"").trim().toUpperCase().replace(/[ -]/g,"");
  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)) throw new Error("Placa inválida.");
  return plate;
}
function prepareRequest(service, vehicle) {
  const endpoint=ENDPOINTS[service];
  if(!endpoint) throw new Error("Serviço não documentado.");
  const body={link:endpoint.link};
  for(const field of endpoint.required) {
    if(field==="placa") body.placa=normalizePlate(vehicle?.placa);
    else if(field==="chassi") {
      const chassis=String(vehicle?.chassi||"").trim().toUpperCase();
      if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(chassis)) throw new Error("Gravame requer chassi válido de 17 caracteres.");
      body.chassi=chassis;
    }
  }
  return {method:endpoint.method,path:endpoint.path,body};
}
function getStatus() {
  return {enabled:false, ready:false, authVerified:false, services:Object.keys(ENDPOINTS)};
}
async function consultAfterConfirmedPayment() {
  throw new Error("API Full desativada: autenticação e permissões não verificadas. Nenhuma consulta paga foi feita.");
}
module.exports={ENDPOINTS,normalizePlate,prepareRequest,getStatus,consultAfterConfirmedPayment};
