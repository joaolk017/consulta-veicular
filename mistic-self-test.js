const https = require("https");

const base = String(process.env.MISTIC_PAY_URL || "https://api.misticpay.com/api").replace(/\/+$/, "");
const clientId = process.env.MISTIC_CLIENT_ID;
const clientSecret = process.env.MISTIC_CLIENT_SECRET;
const configuredHeader = String(process.env.MISTIC_AUTH_HEADER || "").trim().replace(/^Authorization\s*:\s*/i, "");

function authorization() {
  if (configuredHeader) return /^Basic\s+/i.test(configuredHeader) ? configuredHeader : `Basic ${configuredHeader}`;
  if (!clientId || !clientSecret) return null;
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

(async () => {
  const auth = authorization();
  if (!auth) {
    console.log("MISTIC_TEST: FAIL - credenciais não configuradas");
    process.exit(0);
  }

  let url;
  try {
    url = new URL(`${base}/users/transactions/list/1`);
  } catch {
    console.log("MISTIC_TEST: FAIL - URL inválida");
    process.exit(0);
  }

  const req = https.request(url, {
    method: "GET",
    headers: {
      Authorization: auth,
      Accept: "application/json"
    }
  }, res => {
    const chunks = [];
    let size = 0;
    res.on("data", chunk => {
      size += chunk.length;
      if (size <= 200000) chunks.push(chunk);
    });
    res.on("end", () => {
      const status = res.statusCode || 0;
      if (status >= 200 && status < 300) {
        console.log(`MISTIC_TEST: OK - autenticação e permissão de consulta funcionando (HTTP ${status})`);
      } else if (status === 401) {
        console.log("MISTIC_TEST: FAIL - credenciais rejeitadas (HTTP 401)");
      } else if (status === 403) {
        console.log("MISTIC_TEST: FAIL - chave sem permissão para consultar transações (HTTP 403)");
      } else {
        console.log(`MISTIC_TEST: WARN - Mistic Pay respondeu HTTP ${status}`);
      }
      process.exit(0);
    });
  });

  req.setTimeout(15000, () => req.destroy(new Error("timeout")));
  req.on("error", err => {
    console.log(`MISTIC_TEST: FAIL - comunicação: ${err.message}`);
    process.exit(0);
  });
  req.end();
})();
