const express = require("express");
const path = require("path");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;
const FALCON_TOKEN = process.env.FALCON_TOKEN;

if (!FALCON_TOKEN) console.warn("FALCON_TOKEN não configurado.");

app.use(express.static(path.join(__dirname)));

function falconRequest(url, token) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json"
      }
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({
        status: response.statusCode || 502,
        body
      }));
    });

    request.setTimeout(15000, () => {
      request.destroy(new Error("Tempo limite da API Falcon excedido."));
    });
    request.on("error", reject);
  });
}

app.get("/api/consulta/:plate", async (req, res) => {
  const plate = String(req.params.plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate) &&
      !/^[A-Z]{3}[0-9]{4}$/.test(plate)) {
    return res.status(400).json({ error: "Placa inválida." });
  }

  if (!FALCON_TOKEN) {
    return res.status(500).json({ error: "API não configurada no servidor." });
  }

  try {
    const url = `https://beta.falcon-server.com.br/data-hub/private/v1/vehicles/${encodeURIComponent(plate)}/search`;
    const response = await falconRequest(url, FALCON_TOKEN);

    let data;
    try {
      data = JSON.parse(response.body);
    } catch {
      data = { raw: response.body };
    }

    if (response.status < 200 || response.status >= 300) {
      console.error("Falcon respondeu com erro:", response.status, data);
      return res.status(response.status).json({
        error: data?.message || data?.error || `A API Falcon respondeu com HTTP ${response.status}.`,
        details: data
      });
    }

    return res.json(data);
  } catch (err) {
    console.error("Erro ao comunicar com a Falcon:", err);
    return res.status(502).json({
      error: "Falha ao comunicar com a API veicular.",
      details: err?.message || String(err)
    });
  }
});

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
