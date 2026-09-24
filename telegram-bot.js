"use strict";
// Bot de consulta com pagamento PIX integrado ao servidor.
// Configure TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET no Render para ativar.
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
// Telegram only accepts A-Z, a-z, 0-9, underscore and hyphen in its secret token.
// Hash the configured secret to a valid fixed-length token without changing Render variables.
const telegramHeaderSecret = secret ? crypto.createHash("sha256").update(secret).digest("hex") : "";
const site = "https://consultaveicular360.com.br";
let paymentServices = null;
function configureTelegramPayments(services){paymentServices=services;}
const keyboard = {inline_keyboard:[
  [{text:"🔎 CONSULTAR PLACA",callback_data:"placa"}],
  [{text:"💳 Pacotes e preços",callback_data:"pacotes"},{text:"📦 Meus pedidos",callback_data:"pedidos"}],
  [{text:"💰 Ver pagamento",callback_data:"status"},{text:"❓ Ajuda",callback_data:"ajuda"}]
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
// Send the original welcome artwork when assets/telegram-welcome.png is present.
async function sendWelcome(chatId){
  const caption="🚘 CONSULTA VEICULAR 360\n\n🔎 Envie sua placa ou toque em Consultar placa.\n💳 Pagamento por PIX e entrega do relatório aqui no Telegram.";
  const artworkInAssets=path.join(__dirname,"assets","telegram-welcome.png");
  const artwork=fs.existsSync(artworkInAssets)?artworkInAssets:path.join(__dirname,"telegram-welcome.png");
  if(fs.existsSync(artwork)){
    try{
      const image=fs.readFileSync(artwork);
      if(image.length>0&&image.length<10*1024*1024){
        await sendWelcomePhoto(chatId,image,caption,keyboard);
        return;
      }
    }catch(err){console.error("Telegram: imagem de boas-vindas indisponível:",err.message);}
  }
  await send(chatId,caption,keyboard);
}
function sendWelcomePhoto(chatId,png,caption,reply_markup){
  return new Promise((resolve,reject)=>{
    const boundary="cv360welcome"+crypto.randomBytes(12).toString("hex");
    const part=(name,value)=>Buffer.from("--"+boundary+"\r\nContent-Disposition: form-data; name=\""+name+"\"\r\n\r\n"+value+"\r\n");
    const imageHeader=Buffer.from("--"+boundary+"\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"telegram-welcome.png\"\r\nContent-Type: image/png\r\n\r\n");
    const body=Buffer.concat([part("chat_id",String(chatId)),part("caption",caption),part("reply_markup",JSON.stringify(reply_markup)),imageHeader,png,Buffer.from("\r\n--"+boundary+"--\r\n")]);
    const req=https.request("https://api.telegram.org/bot"+token+"/sendPhoto",{
      method:"POST",headers:{"Content-Type":"multipart/form-data; boundary="+boundary,"Content-Length":body.length},timeout:15000
    },res=>{let response="";res.on("data",chunk=>{if(response.length<1000)response+=chunk;});res.on("end",()=>res.statusCode===200?resolve():reject(new Error("Telegram welcome photo HTTP "+res.statusCode+": "+response.slice(0,180))));});
    req.on("timeout",()=>req.destroy(new Error("Telegram welcome photo timeout")));
    req.on("error",reject);req.end(body);
  });
}
function clearButtons(chatId,messageId){
  if(!Number.isSafeInteger(messageId)||messageId<=0)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const body=JSON.stringify({chat_id:chatId,message_id:messageId,reply_markup:{inline_keyboard:[]}});
    const req=https.request("https://api.telegram.org/bot"+token+"/editMessageReplyMarkup",{
      method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)},timeout:10000
    },r=>{r.resume();r.on("end",()=>r.statusCode===200?resolve():reject(new Error("Telegram clear buttons HTTP "+r.statusCode)));});
    req.on("timeout",()=>req.destroy(new Error("Telegram clear buttons timeout")));
    req.on("error",reject);req.end(body);
  });
}
function sendPixCode(chatId,pix){
  const raw=String(pix||"").trim();
  if(!raw||raw.length>1024)throw new Error("Código PIX inválido para envio.");
  // HTML pre prevents Telegram from auto-linking the payment payload.
  const escaped=raw.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const markup=raw.length<=256?{inline_keyboard:[[{text:"📋 Copiar código PIX",copy_text:{text:raw}}]]}:undefined;
  return new Promise((resolve,reject)=>{
    const body=JSON.stringify({
      chat_id:chatId,
      text:"📋 PIX COPIA E COLA\n\n<pre>"+escaped+"</pre>\n\nCopie o código completo, sem espaços ou quebras de linha. Após o pagamento confirmado, seu relatório será enviado aqui.",
      parse_mode:"HTML",reply_markup:markup,link_preview_options:{is_disabled:true}
    });
    const req=https.request("https://api.telegram.org/bot"+token+"/sendMessage",{
      method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)},timeout:15000
    },r=>{let response="";r.on("data",chunk=>{if(response.length<1000)response+=chunk;});r.on("end",()=>r.statusCode===200?resolve():reject(new Error("Telegram PIX message HTTP "+r.statusCode+": "+response.slice(0,250))));});
    req.on("timeout",()=>req.destroy(new Error("Telegram PIX message timeout")));
    req.on("error",reject);req.end(body);
  });
}
function sendPixPhoto(chatId,png,caption){
  return new Promise((resolve,reject)=>{
    const boundary="cv360"+crypto.randomBytes(12).toString("hex");
    const part=(name,value)=>Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="'+name+'"\r\n\r\n'+value+'\r\n');
    const imageHeader=Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="photo"; filename="pix.png"\r\nContent-Type: image/png\r\n\r\n');
    const body=Buffer.concat([part("chat_id",String(chatId)),part("caption",caption),imageHeader,png,Buffer.from('\r\n--'+boundary+'--\r\n')]);
    const req=https.request("https://api.telegram.org/bot"+token+"/sendPhoto",{
      method:"POST",headers:{"Content-Type":"multipart/form-data; boundary="+boundary,"Content-Length":body.length},timeout:15000
    },r=>{r.resume();r.on("end",()=>r.statusCode===200?resolve():reject(new Error("Telegram sendPhoto HTTP "+r.statusCode)));});
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
      if(callback?.data==="pedidos"||callback?.data==="status"||message?.text?.trim()==="/pedidos"||message?.text?.trim()==="/status"){
        if(!paymentServices?.status)throw new Error("Consulta de pedidos indisponível.");
        const listing=await paymentServices.list(chatId);
        await send(chatId,listing.text,listing.reply_markup?{inline_keyboard:[...listing.reply_markup.inline_keyboard,[{text:"🏠 Menu principal",callback_data:"menu"}]]}:keyboard);
      }else if(callback?.data?.startsWith("pix:")){
        if(!paymentServices?.recover)throw new Error("Recuperação indisponível.");
        await paymentServices.recover(chatId,Number(callback.data.slice(4)));
      }else if(callback?.data?.startsWith("cancelask:")){
        const index=Number(callback.data.slice(10));
        if(!Number.isSafeInteger(index)||index<0||index>4)throw new Error("Pedido inválido.");
        await send(chatId,"⚠️ Deseja cancelar este pedido? A cobrança será cancelada na Woovi somente se ainda não estiver paga.",{inline_keyboard:[[{text:"🚫 Confirmar cancelamento",callback_data:"cancel:"+index+":"+callback.message.message_id}],[{text:"↩️ Voltar aos pedidos",callback_data:"pedidos"}]]});
      }else if(callback?.data?.startsWith("cancel:")){
        if(!paymentServices?.cancel)throw new Error("Cancelamento indisponível.");
        const parts=callback.data.split(":");
        const index=Number(parts[1]),orderListMessageId=Number(parts[2]);
        if(!Number.isSafeInteger(index)||index<0||index>4)throw new Error("Pedido inválido.");
        const cancelled=await paymentServices.cancel(chatId,index);
        if(cancelled){
          // Remove obsolete actions only after Woovi confirms cancellation.
          await Promise.allSettled([
            clearButtons(chatId,callback.message?.message_id),
            clearButtons(chatId,orderListMessageId)
          ]);
        }
      }else if(callback?.data==="ajuda"||message?.text?.trim()==="/ajuda"){
        await send(chatId,"❓ CENTRAL DE AJUDA\n\n1. Envie a placa.\n2. Escolha o pacote.\n3. Receba o QR Code e o PIX Copia e Cola.\n4. Após a confirmação, o relatório chega aqui.\n\n📋 Os dados dependem da cobertura das fontes consultadas.\n\nUse /pedidos para acompanhar compras. Consultar o status não gera novo PIX.",{inline_keyboard:[[{text:"📦 Meus pedidos",callback_data:"pedidos"}],[{text:"🏠 Voltar ao menu",callback_data:"menu"}]]});
      }else if(callback?.data==="pacotes"){
        await send(chatId,"💳 PACOTES E PREÇOS\n\n🚗 1 consulta — R$ 18,90\n🚙 2 consultas — R$ 32,90\n🚘 3 consultas — R$ 44,90\n\nOs créditos podem ser usados em placas diferentes. Envie sua placa para escolher um pacote.",{inline_keyboard:[[{text:"🔎 Consultar placa",callback_data:"placa"}],[{text:"🏠 Voltar ao menu",callback_data:"menu"}]]});
      }else if(callback?.data==="placa"){
        await send(chatId,"🚗 Digite a placa (ABC1234 ou ABC1D23).\n\nVocê só gera um PIX depois de escolher o pacote.",{inline_keyboard:[[{text:"🏠 Menu principal",callback_data:"menu"}]]});
      }else if(callback?.data?.startsWith("buy:")){
        if(!paymentServices)throw new Error("Serviço de pagamentos indisponível.");
        const parts=callback.data.split(":");
        const plate=parts[1],product=parts[2];
        if(!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)||!["consulta-completa","pacote-2","pacote-3"].includes(product))throw new Error("Pedido inválido.");
        await paymentServices.start(chatId,plate,product);
      }else if(callback?.data==="sobre"){
        await send(chatId,"Os relatórios reúnem dados conforme a cobertura das fontes contratadas. Informações indisponíveis não são garantidas.",keyboard);
      }else if(callback?.data==="menu"||message?.text?.trim().startsWith("/start")||message?.text?.trim().startsWith("/menu")){
        await sendWelcome(chatId);
      }else if(message?.text){
        const plate=message.text.trim().toUpperCase().replace(/[ -]/g,"");
        if(/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)){
          await send(chatId,"🚗 Placa: "+plate+"\n\nEscolha o pacote. O PIX será criado somente após sua escolha.",{inline_keyboard:[
            [{text:"💳 1 consulta · R$ 18,90",callback_data:"buy:"+plate+":consulta-completa"}],
            [{text:"💳 2 consultas · R$ 32,90",callback_data:"buy:"+plate+":pacote-2"}],
            [{text:"💳 3 consultas · R$ 44,90",callback_data:"buy:"+plate+":pacote-3"}],
            [{text:"🔄 Outra placa",callback_data:"placa"}],
            [{text:"📦 Meus pedidos",callback_data:"pedidos"},{text:"🏠 Menu principal",callback_data:"menu"}]
          ]});
        }else await send(chatId,"Placa inválida. Use ABC1234 ou ABC1D23.",keyboard);
      }
      res.json({ok:true});
    }catch(e){console.error("Falha no envio Telegram:",e.message);res.sendStatus(503);}
  });
}
module.exports={installTelegramBot,configureTelegramPayments,sendTelegramMessage:send,sendPixPhoto,sendPixCode};
