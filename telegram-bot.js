"use strict";
// Primeira etapa: bot informativo. Não consulta APIs, não cobra nem expõe dados pessoais.
// Configure TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET no Render para ativar.
const https = require("https");
const crypto = require("crypto");
const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
// Telegram only accepts A-Z, a-z, 0-9, underscore and hyphen in its secret token.
// Hash the configured secret to a valid fixed-length token without changing Render variables.
const telegramHeaderSecret = secret ? crypto.createHash("sha256").update(secret).digest("hex") : "";
const site = "https://consultaveicular360.com.br";
const keyboard = {inline_keyboard:[
  [{text:"🚗 Digitar placa aqui",callback_data:"placa"}],
  [{text:"🌐 Consultar no site",url:site}],
  [{text:"💳 Ver pacotes e preços",callback_data:"pacotes"}],
  [{text:"📋 Sobre os relatórios",callback_data:"sobre"}]
]};
function send(chatId,text,reply_markup){
  return new Promise((resolve,reject)=>{
    const body=JSON.stringify({chat_id:chatId,text,reply_markup,disable_web_page_preview:true});
    const req=https.request("https://api.telegram.org/bot"+token+"/sendMessage",{
      method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)}
    },r=>{let s="";r.on("data",c=>s+=c);r.on("end",()=>r.statusCode===200?resolve():reject(new Error("Telegram HTTP "+r.statusCode)));});
    req.on("error",reject);req.end(body);
  });
}
function registerWebhook(){
  const body=JSON.stringify({url:site+"/api/telegram/webhook",secret_token:telegramHeaderSecret,allowed_updates:["message","callback_query"]});
  const req=https.request("https://api.telegram.org/bot"+token+"/setWebhook",{
    method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)},timeout:10000
  },response=>{let data="";response.on("data",chunk=>data+=chunk);response.on("end",()=>{
    try{const result=JSON.parse(data);if(response.statusCode===200&&result.ok)console.log("Telegram webhook registrado com sucesso.");
    else console.error("Telegram webhook: registro falhou (HTTP "+response.statusCode+", erro "+String(result.description||"não informado").replaceAll(token,"[redacted]").slice(0,300)+").");}
    catch{console.error("Telegram webhook: resposta inválida.");}
  });});
  req.on("timeout",()=>req.destroy(new Error("tempo esgotado")));
  req.on("error",err=>console.error("Telegram webhook: erro de conexão:",err.message));
  req.end(body);
}
function installTelegramBot(app){
  if(!token||!secret){console.log("Telegram bot desativado: configure token e segredo.");return;}
  registerWebhook();
  app.post("/api/telegram/webhook",async(req,res)=>{
    if(req.get("X-Telegram-Bot-Api-Secret-Token")!==telegramHeaderSecret)return res.sendStatus(403);
    const update=req.body||{};
    const message=update.message;
    const callback=update.callback_query;
    const chatId=message?.chat?.id||callback?.message?.chat?.id;
    if(!chatId)return res.json({ok:true});
    try{
      if(callback?.data==="pacotes"){
        await send(chatId,"💳 Pacotes Consulta Veicular 360:\n\n1 consulta: R$ 18,90\n2 consultas: R$ 32,90\n3 consultas: R$ 44,90\n\nOs créditos podem ser usados em placas diferentes. O pagamento é processado com segurança pelo site oficial.",{inline_keyboard:[[{text:"1 consulta · R$ 18,90",url:site}],[{text:"2 consultas · R$ 32,90",url:site}],[{text:"3 consultas · R$ 44,90",url:site}],[{text:"🚗 Digitar placa",callback_data:"placa"}]]});
      }else if(callback?.data==="placa"){
        await send(chatId,"🚗 Envie a placa do veículo (exemplo: ABC1D23 ou ABC1234). A validação é gratuita; nenhuma consulta paga será feita sem sua confirmação.");
      }else if(callback?.data==="sobre"){
        await send(chatId,"O Consulta Veicular 360 disponibiliza relatórios conforme a cobertura das fontes contratadas. Dados indisponíveis não são garantidos. Consulte condições e preços no site.",keyboard);
      }else if(message?.text?.trim().startsWith("/start")||message?.text?.trim().startsWith("/menu")){
        await send(chatId,"🚗 Bem-vindo ao Consulta Veicular 360!\n\nEscolha uma opção para conhecer nossos relatórios e comprar consultas com segurança.",keyboard);
      }else if(message?.text){
        const plate=message.text.trim().toUpperCase().replace(/[ -]/g,"");
        if(/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate) && (/[0-9]/.test(plate[4]) || /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(plate))){
          await send(chatId,"🚗 Placa recebida: "+plate+"\n\n💳 Consulta completa: R$ 18,90. Toque em PAGAR AGORA para continuar no checkout seguro com sua placa preenchida. O PIX só será gerado após sua confirmação no site.",{inline_keyboard:[[{text:"💳 PAGAR AGORA · R$ 18,90",url:site+"/?placa="+encodeURIComponent(plate)+"&origem=telegram#consultCard"}],[{text:"📦 Ver pacotes",callback_data:"pacotes"}],[{text:"🔄 Outra placa",callback_data:"placa"}]]});
        }else{
          await send(chatId,"Não reconheci uma placa válida. Envie no formato ABC1234 ou ABC1D23. Nenhuma consulta foi cobrada.",keyboard);
        }
      }
      res.json({ok:true});
    }catch(e){console.error("Falha no envio Telegram:",e.message);res.sendStatus(503);}
  });
}
module.exports={installTelegramBot};
