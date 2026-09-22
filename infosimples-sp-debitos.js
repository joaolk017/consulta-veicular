"use strict";

// Integração complementar e opt-in. Nunca é acionada na prévia gratuita.
const ENDPOINT = "https://api.infosimples.com/api/v2/consultas/detran/sp/debitos";
const string = (v,max=180) => v==null ? "" : String(v).trim().slice(0,max);
const money = v => {
  if(v===null||v===undefined||v==="")return null;
  if(typeof v==="number")return Number.isFinite(v)&&v>=0&&v<1e8?v:null;
  let s=String(v).trim().replace(/[^\d,.-]/g,"");
  if(s.includes(",")&&s.includes("."))s=s.replace(/\./g,"").replace(",",".");
  else if(s.includes(","))s=s.replace(",",".");
  const n=Number(s);
  return Number.isFinite(n)&&n>=0&&n<1e8?n:null;
};
const validDate = v => {
  const s=string(v,24);
  const match=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(!match)return "";
  const day=+match[1],month=+match[2],year=+match[3];
  if(year<1900||year>2100||month<1||month>12||day<1||day>31)return "";
  const d=new Date(Date.UTC(year,month-1,day));
  return d.getUTCDate()===day&&d.getUTCMonth()===month-1?s:"";
};
function normalizeSPDebts(payload,plate,now=new Date()){
  const root=payload&&typeof payload==="object"?payload:{};
  if(root.code!==200)return null;
  const source=Array.isArray(root.data)?root.data[0]:null;
  if(!source||typeof source!=="object")return null;
  const normalized=string(source.normalizado_placa||source.placa,7).replace(/[^A-Z0-9]/gi,"").toUpperCase();
  if(normalized!==String(plate||"").replace(/[^A-Z0-9]/gi,"").toUpperCase())return null;
  const rows=(key, mapper)=>Array.isArray(source[key])?source[key].slice(0,25).map(mapper).filter(Boolean):[];
  const ipva=rows("debitos_ipva",r=>{
    if(!r||typeof r!=="object")return null;
    const amount=money(r.valor);
    if(amount===null)return null;
    return {exercicio:string(r.exercicio,4),cota:string(r.cota,16),nomeCota:string(r.nome_cota,90),vencimento:validDate(r.data_vencimento),valor:amount};
  });
  const licenciamento=rows("debitos_licenciamento",r=>{
    if(!r||typeof r!=="object")return null;
    const amount=money(r.valor);
    return amount===null?null:{exercicio:string(r.exercicio,4),vencimento:validDate(r.data_vencimento),valor:amount};
  });
  const multas=rows("debitos_multas",r=>{
    if(!r||typeof r!=="object")return null;
    const amount=money(r.valor);
    return {
      auto:string(r.auto_infracao,45),descricao:string(r.descricao,240),
      data:validDate(r.data_infracao),vencimento:validDate(r.data_vencimento),
      municipio:string(r.municipio,100),orgao:string(r.orgao_autuador&&r.orgao_autuador.nome,100),
      valor:amount
    };
  });
  const restrictions={};
  for(const [name,key] of Object.entries({
    administrativa:"restricao_administrativa",financeira:"restricao_financeira",
    judiciaria:"restricao_judiciaria",tributaria:"restricao_tributaria",
    guincho:"registro_guincho"
  })){
    const value=string(source[key],180);
    if(value)restrictions[name]=value;
  }
  const vistorias=rows("vistorias",r=>r&&typeof r==="object"&&validDate(r.data)
    ?{data:validDate(r.data),km:string(r.km,40)}:null);
  return {
    source:"Infosimples / DETRAN-SP",checkedAt:now.toISOString(),
    ipva,licenciamento,multas,restrictions,vistorias,
    ipvaInformado:money(source.normalizado_ipva??source.ipva),
    licenciamentoInformado:money(source.licenciamento_valor),
    multasInformadas:money(source.normalizado_multas_total??source.multas_total),
    ultimoLicenciamento:string(source.ultimo_licenciamento,80),
    statusLicenciamento:string(source.status_licenciamento,120),
    mensagemIpva:string(source.ipva_mensagem,200),
    mensagemLicenciamento:string(source.licenciamento_mensagem,200),
    mensagemMultas:string(source.multas_mensagem,200)
  };
}

function canUseSPDebts(vehicle,env=process.env){
  if(String(env.INFOSIMPLES_SP_ENABLED||"").toLowerCase()!=="true")return false;
  if(!string(env.INFOSIMPLES_TOKEN))return false;
  const hasLogin=!!(string(env.INFOSIMPLES_LOGIN_CPF)&&string(env.INFOSIMPLES_LOGIN_SENHA));
  // Sem confirmação explícita da Infosimples, token isolado nunca executa uma consulta cobrada.
  const tokenOnlyConfirmed=String(env.INFOSIMPLES_SP_TOKEN_ONLY_CONFIRMED||"").toLowerCase()==="true";
  if(!hasLogin&&!tokenOnlyConfirmed)return false;
  const uf=string(vehicle&&vehicle.state).toUpperCase();
  const renavam=string(vehicle&&vehicle.renavam).replace(/\D/g,"");
  return (uf==="SP"||uf==="SÃO PAULO"||uf==="SAO PAULO")&&/^\d{9,11}$/.test(renavam)
    &&/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(string(vehicle&&vehicle.plate).toUpperCase());
}

async function fetchSPDebts(vehicle,requestJson,env=process.env){
  if(!canUseSPDebts(vehicle,env))return null;
  const args={
    token:string(env.INFOSIMPLES_TOKEN),
    placa:string(vehicle.plate).toUpperCase(),
    renavam:string(vehicle.renavam).replace(/\D/g,""),
    timeout:"20"
  };
  if(string(env.INFOSIMPLES_LOGIN_CPF)&&string(env.INFOSIMPLES_LOGIN_SENHA)){
    args.login_cpf=string(env.INFOSIMPLES_LOGIN_CPF);
    args.login_senha=string(env.INFOSIMPLES_LOGIN_SENHA);
  }
  try{
    const reply=await requestJson(ENDPOINT,{method:"POST",timeout:25000},args,600_000);
    if(reply.status<200||reply.status>=300)return null;
    return normalizeSPDebts(reply.data,vehicle.plate);
  }catch{
    // Consulta complementar não deve impedir entrega ou estorno do relatório principal.
    return null;
  }
}
module.exports={normalizeSPDebts,canUseSPDebts,fetchSPDebts};
