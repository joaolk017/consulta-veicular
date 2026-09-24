"use strict";
// Bot de consulta com pagamento PIX integrado ao servidor.
// Configure TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET no Render para ativar.
const https = require("https");
const crypto = require("crypto");
const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
// Telegram only accepts A-Z, a-z, 0-9, underscore and hyphen in its secret token.
// Hash the configured secret to a valid fixed-length token without changing Render variables.
const telegramHeaderSecret = secret ? crypto.createHash("sha256").update(secret).digest("hex") : "";
const site = "https://consultaveicular360.com.br";
let paymentServices = null;
function configureTelegramPayments(services){paymentServices=services;}
const keyboard = {inline_keyboard:[
  [{text:"🚗 Consultar placa",callback_data:"placa"}],
  [{text:"💳 Ver pacotes",callback_data:"pacotes"}],
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
function sendPixPhoto(chatId,png,caption){
  return new Promise((resolve,reject)=>{
    const boundary="cv360"+crypto.randomBytes(12).toString("hex");
    const part=(name,value)=>Buffer.from("--"+boundary+"\\r\\nContent-Disposition: form-data; name=\\\""+name+"\\\"\\r\\n\\r\\n"+value+"\\r\\n");
    const imageHeader=Buffer.from("--"+boundary+"\\r\\nContent-Disposition: form-data; name=\\\"photo\\\"; filename=\\\"pix.png\\\"\\r\\nContent-Type: image/png\\r\\n\\r\\n");
    const body=Buffer.concat([part("chat_id",String(chatId)),part("caption",caption),imageHeader,png,Buffer.from("\\r\\n--"+boundary+"--\\r\\n")]);
    const req=https.request("https://api.telegram.org/bot"+token+"/sendPhoto",{
      method:"POST",headers:{"Content-Type":"multipart/form-data; boundary="+boundary,"Content-Length":body.length},timeout:15000
    },r=>{let response="";r.on("data",chunk=>{if(response.length<1000)response+=chunk;});r.on("end",()=>r.statusCode===200?resolve():reject(new Error("Telegram sendPhoto HTTP "+r.statusCode)));});
    req.on("timeout",()=>req.destroy(new Error("Telegram photo timeout")));
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
        await send(chatId,"💳 Pacotes:\n1 consulta: R$ 18,90\n2 consultas: R$ 32,90\n3 consultas: R$ 44,90\n\nEnvie a placa primeiro para iniciar a compra.",keyboard);
      }else if(callback?.data==="placa"){
        await send(chatId,"🚗 Digite a placa (ABC1234 ou ABC1D23).");
      }else if(callback?.data?.startsWith("buy:")){
        if(!paymentServices)throw new Error("Serviço de pagamentos indisponível.");
        const parts=callback.data.split(":");
        const plate=parts[1],product=parts[2];
        if(!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)||!["consulta-completa","pacote-2","pacote-3"].includes(product))throw new Error("Pedido inválido.");
        await paymentServices.start(chatId,plate,product);
      }else if(callback?.data==="sobre"){
        await send(chatId,"Os relatórios reúnem dados conforme a cobertura das fontes contratadas. Informações indisponíveis não são garantidas.",keyboard);
      }else if(message?.text?.trim().startsWith("/start")||message?.text?.trim().startsWith("/menu")){
        await send(chatId,"🚗 Bem-vindo ao Consulta Veicular 360!\n\nDigite uma placa para receber seu PIX e, após a confirmação, o relatório aqui no Telegram.",keyboard);
      }else if(message?.text){
        const plate=message.text.trim().toUpperCase().replace(/[ -]/g,"");
        if(/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)){
          await send(chatId,"🚗 Placa: "+plate+"\n\nEscolha o pacote. O PIX será criado somente após sua escolha.",{inline_keyboard:[
            [{text:"💳 1 consulta · R$ 18,90",callback_data:"buy:"+plate+":consulta-completa"}],
            [{text:"💳 2 consultas · R$ 32,90",callback_data:"buy:"+plate+":pacote-2"}],
            [{text:"💳 3 consultas · R$ 44,90",callback_data:"buy:"+plate+":pacote-3"}],
            [{text:"🔄 Outra placa",callback_data:"placa"}]
          ]});
        }else await send(chatId,"Placa inválida. Use ABC1234 ou ABC1D23.",keyboard);
      }
      res.json({ok:true});
    }catch(e){console.error("Falha no envio Telegram:",e.message);res.sendStatus(503);}
  });
}
module.exports={installTelegramBot,configureTelegramPayments,sendTelegramMessage:send,sendPixPhoto};
