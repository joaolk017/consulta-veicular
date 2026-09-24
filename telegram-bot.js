"use strict";
// Primeira etapa: bot informativo. Não consulta APIs, não cobra nem expõe dados pessoais.
// Configure TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET no Render para ativar.
const https = require("https");
const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
const site = "https://consultaveicular360.com.br";
const keyboard = {inline_keyboard:[
  [{text:"🚗 Consultar placa no site",url:site}],
  [{text:"💳 Comprar consultas",url:site}],
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
  const body=JSON.stringify({url:site+"/api/telegram/webhook",secret_token:secret,allowed_updates:["message","callback_query"]});
  const req=https.request("https://api.telegram.org/bot"+token+"/setWebhook",{
    method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)},timeout:10000
  },response=>{let data="";response.on("data",chunk=>data+=chunk);response.on("end",()=>{
    try{const result=JSON.parse(data);if(response.statusCode===200&&result.ok)console.log("Telegram webhook registrado com sucesso.");
    else console.error("Telegram webhook: registro falhou (HTTP "+response.statusCode+").");}
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
    if(req.get("X-Telegram-Bot-Api-Secret-Token")!==secret)return res.sendStatus(403);
    const update=req.body||{};
    const message=update.message;
    const callback=update.callback_query;
    const chatId=message?.chat?.id||callback?.message?.chat?.id;
    if(!chatId)return res.json({ok:true});
    try{
      if(callback?.data==="sobre"){
        await send(chatId,"O Consulta Veicular 360 disponibiliza relatórios conforme a cobertura das fontes contratadas. Dados indisponíveis não são garantidos. Consulte condições e preços no site.",keyboard);
      }else if(message?.text?.trim().startsWith("/start")||message?.text?.trim().startsWith("/menu")){
        await send(chatId,"🚗 Bem-vindo ao Consulta Veicular 360!\n\nEscolha uma opção para conhecer nossos relatórios e comprar consultas com segurança.",keyboard);
      }else if(message?.text){
        await send(chatId,"Para consultar uma placa, use o site oficial. Em breve, a consulta poderá ser feita diretamente por aqui.",keyboard);
      }
      res.json({ok:true});
    }catch(e){console.error("Falha no envio Telegram:",e.message);res.sendStatus(503);}
  });
}
module.exports={installTelegramBot};
