const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const FALCON_TOKEN = process.env.FALCON_TOKEN;

if (!FALCON_TOKEN) console.warn("FALCON_TOKEN não configurado.");

app.use(express.static(path.join(__dirname)));

app.get("/api/consulta/:plate", async (req, res) => {
  const plate = String(req.params.plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate) &&
      !/^[A-Z]{3}[0-9]{4}$/.test(plate)) {
    return res.status(400).json({error:"Placa inválida."});
  }
  if (!FALCON_TOKEN) {
    return res.status(500).json({error:"API não configurada no servidor."});
  }

  try {
    const url = `https://beta.falcon-server.com.br/data-hub/private/v1/vehicles/${encodeURIComponent(plate)}/search`;

const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${FALCON_TOKEN}`, "Accept": "application/json" }
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {raw:text}; }

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.message || data?.error || "A API recusou a consulta.",
        details: data
      });
    }
    res.json(data);
  } catch (err) {
    res.status(502).json({error:"Falha ao comunicar com a API veicular."});
  }
});

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
