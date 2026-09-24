"use strict";
const crypto = require("crypto");
const { normalizePlate, fetchGravameDetalhado } = require("./gravame-detalhado");
const PRODUCT = Object.freeze({ id: "gravame-detalhado", amount: 29.90, cents: 2990, credits: 0, description: "Gravame detalhado" });
const enabled = () => process.env.GRAVAME_DETALHADO_ENABLED === "1";

function installGravameCheckout({ app, pool, ensureAccount, createOpenPixCharge, getOpenPixCharge, signPaymentToken, verifyPaymentToken, requireDatabase, checkPaymentRateLimit }) {
  async function setup() {
    requireDatabase();
    await pool.query(`CREATE TABLE IF NOT EXISTS gravame_purchases (
      correlation_id TEXT PRIMARY KEY,
      account_id UUID NOT NULL REFERENCES credit_accounts(id) ON DELETE CASCADE,
      plate TEXT NOT NULL,
      cents INTEGER NOT NULL CHECK (cents=2990),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','running','completed','review')),
      result_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  }
  async function verifyPurchase(token) {
    const p = verifyPaymentToken(token);
    if (p.product !== PRODUCT.id || Number(p.cents) !== PRODUCT.cents) throw Object.assign(new Error("Pagamento de gravame inválido."), {status:400});
    const q = await pool.query("SELECT * FROM gravame_purchases WHERE correlation_id=$1 AND account_id=$2 AND plate=$3", [p.correlationID,p.accountId,p.plate]);
    if (!q.rowCount) throw Object.assign(new Error("Compra não encontrada."), {status:404});
    return { purchase:q.rows[0], payload:p };
  }
  app.post("/api/gravame/pix/criar", async (req,res) => {
    if (!enabled()) return res.status(404).json({error:"produto_indisponivel"});
    const rate = checkPaymentRateLimit(req);
    if (!rate.allowed) return res.status(429).json({error:"limite_pagamentos"});
    try {
      await setup();
      const plate = normalizePlate(req.body && req.body.placa);
      const account = await ensureAccount(req.body && req.body.accountToken);
      const correlationID = "cv-gravame-" + crypto.randomUUID();
      // Registrar antes de criar cobrança para rastrear tentativas; se falhar, permanece pendente.
      await pool.query("INSERT INTO gravame_purchases(correlation_id,account_id,plate,cents) VALUES($1,$2,$3,$4)",[correlationID,account.id,plate,PRODUCT.cents]);
      const charge = await createOpenPixCharge({correlationID,plate,product:PRODUCT});
      const paymentToken = signPaymentToken({v:3,provider:"openpix",product:PRODUCT.id,accountId:account.id,plate,cents:PRODUCT.cents,amount:PRODUCT.amount,correlationID,exp:Date.now()+24*60*60*1000});
      res.status(201).json({ok:true,produto:PRODUCT.id,placa:plate,valor:PRODUCT.amount,correlationID,paymentToken,accountToken:account.token,status:charge.status,copyPaste:charge.brCode || (charge.pix && charge.pix.brCode) || null,qrcodeUrl:charge.qrCodeImage || null,paymentLinkUrl:charge.paymentLinkUrl || null});
    } catch(e) { res.status(e.status || 502).json({error:"gravame_pix",mensagem:e.message}); }
  });
  app.post("/api/gravame/status", async(req,res) => {
    if (!enabled()) return res.status(404).json({error:"produto_indisponivel"});
    try {
      await setup();
      const {purchase,payload} = await verifyPurchase(req.body && req.body.paymentToken);
      if (purchase.status === "completed") return res.json({ok:true,pago:true,status:"completed",resultado:purchase.result_json});
      if (purchase.status === "review" || purchase.status === "running") return res.json({ok:true,pago:true,status:purchase.status,mensagem:"Consulta em processamento ou análise. Não será cobrada novamente."});
      const charge = await getOpenPixCharge(payload.correlationID);
      const paid = String(charge.status || "").toUpperCase() === "COMPLETED" && Number(charge.value) === PRODUCT.cents;
      if (!paid) return res.json({ok:true,pago:false,status:String(charge.status || "pending")});
      await pool.query("UPDATE gravame_purchases SET status='paid',updated_at=NOW() WHERE correlation_id=$1 AND status='pending'",[payload.correlationID]);
      res.json({ok:true,pago:true,status:"paid",mensagem:"Pagamento confirmado. Consulte o relatório para iniciar a busca."});
    } catch(e) { res.status(e.status || 502).json({error:"gravame_status",mensagem:e.message}); }
  });
  app.post("/api/gravame/relatorio", async(req,res) => {
    if (!enabled()) return res.status(404).json({error:"produto_indisponivel"});
    try {
      await setup();
      const {purchase,payload} = await verifyPurchase(req.body && req.body.paymentToken);
      if (purchase.status === "completed") return res.json({ok:true,status:"completed",resultado:purchase.result_json});
      // Nunca executar com status pending; confirmar pagamento diretamente na Woovi.
      const charge = await getOpenPixCharge(payload.correlationID);
      if (String(charge.status || "").toUpperCase() !== "COMPLETED" || Number(charge.value) !== PRODUCT.cents) return res.status(402).json({error:"pagamento_pendente"});
      const claim = await pool.query("UPDATE gravame_purchases SET status='running',updated_at=NOW() WHERE correlation_id=$1 AND status IN ('pending','paid') RETURNING plate",[payload.correlationID]);
      if (!claim.rowCount) return res.status(202).json({ok:true,status:"processing",mensagem:"Consulta já iniciada. Verifique novamente o status."});
      try {
        const result = await fetchGravameDetalhado(claim.rows[0].plate,{apiKey:process.env.FONTEDATA_API_KEY,enabled:true});
        await pool.query("UPDATE gravame_purchases SET status='completed',result_json=$2::jsonb,updated_at=NOW() WHERE correlation_id=$1",[payload.correlationID,JSON.stringify(result)]);
        return res.json({ok:true,status:"completed",resultado:result});
      } catch(e) {
        // Uma falha de rede pode ocorrer depois de o provedor cobrar: não repetir automaticamente.
        await pool.query("UPDATE gravame_purchases SET status='review',updated_at=NOW() WHERE correlation_id=$1",[payload.correlationID]);
        return res.status(202).json({ok:true,status:"review",mensagem:"Não foi possível concluir a entrega. Encaminhado para análise, sem nova consulta automática."});
      }
    } catch(e) { res.status(e.status || 502).json({error:"gravame_relatorio",mensagem:e.message}); }
  });
}
module.exports = { installGravameCheckout, PRODUCT };
