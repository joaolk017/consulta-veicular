const http = require("http");
const net = require("net");
const crypto = require("crypto");
const { fork } = require("child_process");
const { Pool } = require("pg");

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const APP_PORT = Number(process.env.INTERNAL_APP_PORT || 10001);
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const MAX_BODY_BYTES = 128 * 1024;

let pool = null;
let dbReady = false;

function tokenHash(value) {
  if (!value) return null;
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function publicCode() {
  return `CV-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
}

function normalizePlate(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

async function initDatabase() {
  if (!DATABASE_URL) {
    console.warn("ORDERS_DB: DATABASE_URL não configurada; persistência de pedidos ficará desativada até a conexão do Postgres.");
    return;
  }

  pool = new Pool({
    connectionString: DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: DATABASE_URL.includes("localhost") || DATABASE_URL.includes("127.0.0.1") ? false : { rejectUnauthorized: false }
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY,
      public_code VARCHAR(32) UNIQUE NOT NULL,
      product VARCHAR(64) NOT NULL,
      plate VARCHAR(8) NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency CHAR(3) NOT NULL DEFAULT 'BRL',
      provider VARCHAR(32) NOT NULL DEFAULT 'misticpay',
      provider_transaction_id VARCHAR(160) UNIQUE,
      client_transaction_id VARCHAR(160) UNIQUE,
      payment_token_hash CHAR(64),
      payment_status VARCHAR(40) NOT NULL DEFAULT 'CRIANDO',
      fulfillment_status VARCHAR(40) NOT NULL DEFAULT 'AGUARDANDO_PAGAMENTO',
      failure_reason VARCHAR(120),
      webhook_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMPTZ,
      fulfilled_at TIMESTAMPTZ,
      last_provider_check_at TIMESTAMPTZ,
      last_webhook_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_orders_provider_tx ON orders(provider_transaction_id);
    CREATE INDEX IF NOT EXISTS idx_orders_token_hash ON orders(payment_token_hash);
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
  `);

  dbReady = true;
  console.log("ORDERS_DB: Postgres conectado e tabela orders pronta.");
}

async function createPendingOrder(body) {
  if (!dbReady) return null;
  const id = crypto.randomUUID();
  const code = publicCode();
  const product = String(body.produto || "consulta-completa").slice(0, 64);
  const plate = normalizePlate(body.placa);
  const amountCents = product === "consulta-completa" ? 1890 : 0;

  await pool.query(
    `INSERT INTO orders (id, public_code, product, plate, amount_cents)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, code, product, plate, amountCents]
  );
  return { id, code };
}

async function markCreateSuccess(orderId, data) {
  if (!dbReady || !orderId) return;
  await pool.query(
    `UPDATE orders
        SET provider_transaction_id=$2,
            client_transaction_id=$3,
            payment_token_hash=$4,
            payment_status=$5,
            failure_reason=NULL,
            updated_at=NOW()
      WHERE id=$1`,
    [
      orderId,
      data.transactionId ? String(data.transactionId) : null,
      data.clientTransactionId ? String(data.clientTransactionId) : null,
      tokenHash(data.paymentToken),
      String(data.status || "PENDENTE").toUpperCase().slice(0, 40)
    ]
  );
}

async function markCreateFailure(orderId, reason) {
  if (!dbReady || !orderId) return;
  await pool.query(
    `UPDATE orders
        SET payment_status='FALHA', failure_reason=$2, updated_at=NOW()
      WHERE id=$1`,
    [orderId, String(reason || "falha_criar_pix").slice(0, 120)]
  );
}

async function updateStatusByToken(paymentToken, responseData) {
  if (!dbReady || !paymentToken) return;
  const status = String(responseData.status || "DESCONHECIDO").toUpperCase().slice(0, 40);
  const paid = responseData.pago === true;
  await pool.query(
    `UPDATE orders
        SET payment_status=$2,
            paid_at=CASE WHEN $3::boolean THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
            fulfillment_status=CASE WHEN $3::boolean AND fulfillment_status='AGUARDANDO_PAGAMENTO' THEN 'PAGO' ELSE fulfillment_status END,
            last_provider_check_at=NOW(),
            updated_at=NOW()
      WHERE payment_token_hash=$1`,
    [tokenHash(paymentToken), status, paid]
  );
}

async function markFulfilledByToken(paymentToken) {
  if (!dbReady || !paymentToken) return;
  await pool.query(
    `UPDATE orders
        SET fulfillment_status='LIBERADO', fulfilled_at=COALESCE(fulfilled_at, NOW()), updated_at=NOW()
      WHERE payment_token_hash=$1`,
    [tokenHash(paymentToken)]
  );
}

async function markWebhook(transactionId) {
  if (!dbReady || !transactionId) return;
  await pool.query(
    `UPDATE orders
        SET webhook_count=webhook_count+1, last_webhook_at=NOW(), updated_at=NOW()
      WHERE provider_transaction_id=$1`,
    [String(transactionId)]
  );
}

async function getPublicOrder(code) {
  if (!dbReady) return null;
  const result = await pool.query(
    `SELECT public_code, product, plate, amount_cents, currency, payment_status,
            fulfillment_status, created_at, updated_at, paid_at, fulfilled_at
       FROM orders
      WHERE public_code=$1
      LIMIT 1`,
    [String(code || "").toUpperCase()]
  );
  return result.rows[0] || null;
}

function safeJson(buffer) {
  try {
    return buffer && buffer.length ? JSON.parse(buffer.toString("utf8")) : {};
  } catch {
    return {};
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Corpo da requisição excedeu o limite."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function copyHeaders(headers) {
  const result = { ...headers };
  delete result.host;
  return result;
}

function sendJson(res, status, data, headers = {}) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
    "Content-Length": body.length
  });
  res.end(body);
}

function proxyBuffered(req, res, requestBody, onResponse) {
  return new Promise(resolve => {
    const headers = copyHeaders(req.headers);
    headers.host = `127.0.0.1:${APP_PORT}`;
    headers["content-length"] = String(requestBody.length);

    const upstream = http.request({
      hostname: "127.0.0.1",
      port: APP_PORT,
      path: req.url,
      method: req.method,
      headers
    }, upstreamRes => {
      const chunks = [];
      upstreamRes.on("data", chunk => chunks.push(chunk));
      upstreamRes.on("end", async () => {
        const raw = Buffer.concat(chunks);
        let outgoing = raw;
        let status = upstreamRes.statusCode || 502;
        const outHeaders = { ...upstreamRes.headers };
        try {
          const changed = await onResponse(status, outHeaders, raw);
          if (changed && changed.body) outgoing = Buffer.isBuffer(changed.body) ? changed.body : Buffer.from(changed.body);
          if (changed && changed.status) status = changed.status;
        } catch (err) {
          console.error("ORDERS_DB: falha ao registrar resposta:", err.message);
        }
        delete outHeaders["transfer-encoding"];
        outHeaders["content-length"] = String(outgoing.length);
        res.writeHead(status, outHeaders);
        res.end(outgoing);
        resolve();
      });
    });
    upstream.on("error", err => {
      console.error("PROXY: erro ao acessar aplicação interna:", err.message);
      if (!res.headersSent) sendJson(res, 502, { error: "servico_indisponivel", mensagem: "Serviço temporariamente indisponível." });
      resolve();
    });
    if (requestBody.length) upstream.write(requestBody);
    upstream.end();
  });
}

function proxyStream(req, res) {
  const headers = copyHeaders(req.headers);
  headers.host = `127.0.0.1:${APP_PORT}`;
  const upstream = http.request({
    hostname: "127.0.0.1",
    port: APP_PORT,
    path: req.url,
    method: req.method,
    headers
  }, upstreamRes => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on("error", err => {
    console.error("PROXY: erro ao acessar aplicação interna:", err.message);
    if (!res.headersSent) sendJson(res, 502, { error: "servico_indisponivel", mensagem: "Serviço temporariamente indisponível." });
  });
  req.pipe(upstream);
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/api/pedidos/diagnostico") {
    return sendJson(res, 200, { configurado: Boolean(DATABASE_URL), conectado: dbReady });
  }

  if (req.method === "GET" && /^\/api\/pedidos\/[A-Za-z0-9-]+$/.test(url.pathname)) {
    if (!dbReady) return sendJson(res, 503, { error: "pedidos_indisponiveis", mensagem: "Sistema de pedidos ainda não está conectado ao banco de dados." });
    const code = decodeURIComponent(url.pathname.split("/").pop());
    try {
      const order = await getPublicOrder(code);
      if (!order) return sendJson(res, 404, { error: "pedido_nao_encontrado", mensagem: "Pedido não encontrado." });
      return sendJson(res, 200, {
        pedido: order.public_code,
        produto: order.product,
        placa: order.plate,
        valor: Number(order.amount_cents) / 100,
        moeda: order.currency,
        pagamento: order.payment_status,
        atendimento: order.fulfillment_status,
        criadoEm: order.created_at,
        atualizadoEm: order.updated_at,
        pagoEm: order.paid_at,
        liberadoEm: order.fulfilled_at
      });
    } catch (err) {
      console.error("ORDERS_DB: falha ao consultar pedido:", err.message);
      return sendJson(res, 500, { error: "falha_pedido", mensagem: "Não foi possível consultar o pedido." });
    }
  }

  const tracked = [
    "/api/pagamento/pix/criar",
    "/api/pagamento/pix/status",
    "/api/misticpay/webhook",
    "/api/consulta-completa",
    "/api/pagamento/pix/diagnostico"
  ].includes(url.pathname);

  if (!tracked) return proxyStream(req, res);

  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return sendJson(res, err.status || 400, { error: "requisicao_invalida", mensagem: err.message });
  }
  const requestData = safeJson(body);

  if (url.pathname === "/api/pagamento/pix/criar" && req.method === "POST") {
    if (DATABASE_URL && !dbReady) {
      return sendJson(res, 503, { error: "pedidos_indisponiveis", mensagem: "Sistema de pedidos está iniciando. Tente novamente em instantes." });
    }

    let pending = null;
    try {
      pending = await createPendingOrder(requestData);
    } catch (err) {
      console.error("ORDERS_DB: falha antes de criar cobrança:", err.message);
      return sendJson(res, 503, { error: "pedidos_indisponiveis", mensagem: "Não foi possível registrar o pedido. Nenhuma cobrança foi criada." });
    }

    return proxyBuffered(req, res, body, async (status, headers, raw) => {
      const data = safeJson(raw);
      if (status >= 200 && status < 300 && data && data.transactionId) {
        try {
          await markCreateSuccess(pending && pending.id, data);
        } catch (err) {
          console.error("ORDERS_DB: cobrança criada, mas atualização do pedido falhou:", err.message);
        }
        if (pending && pending.code) data.pedido = pending.code;
        headers["content-type"] = "application/json; charset=utf-8";
        return { body: JSON.stringify(data) };
      }
      try { await markCreateFailure(pending && pending.id, data.error || `HTTP_${status}`); } catch {}
      return { body: raw };
    });
  }

  if (url.pathname === "/api/pagamento/pix/status" && req.method === "POST") {
    return proxyBuffered(req, res, body, async (status, headers, raw) => {
      const data = safeJson(raw);
      if (status >= 200 && status < 300) {
        try { await updateStatusByToken(requestData.paymentToken, data); } catch (err) { console.error("ORDERS_DB: falha ao atualizar status:", err.message); }
      }
      return { body: raw };
    });
  }

  if (url.pathname === "/api/misticpay/webhook" && req.method === "POST") {
    return proxyBuffered(req, res, body, async (status, headers, raw) => {
      if (status >= 200 && status < 300) {
        try { await markWebhook(requestData.transactionId); } catch (err) { console.error("ORDERS_DB: falha ao registrar webhook:", err.message); }
      }
      return { body: raw };
    });
  }

  if (url.pathname === "/api/consulta-completa" && req.method === "POST") {
    return proxyBuffered(req, res, body, async (status, headers, raw) => {
      if (status >= 200 && status < 300) {
        try { await markFulfilledByToken(requestData.paymentToken); } catch (err) { console.error("ORDERS_DB: falha ao marcar liberação:", err.message); }
      }
      return { body: raw };
    });
  }

  if (url.pathname === "/api/pagamento/pix/diagnostico" && req.method === "GET") {
    return proxyBuffered(req, res, body, async (status, headers, raw) => {
      const data = safeJson(raw);
      if (status >= 200 && status < 300 && data && typeof data === "object") {
        data.pedidos_persistentes_configurados = Boolean(DATABASE_URL);
        data.pedidos_persistentes_conectados = dbReady;
        if (DATABASE_URL) data.pronto_para_cobrar = Boolean(data.pronto_para_cobrar && dbReady);
        headers["content-type"] = "application/json; charset=utf-8";
        return { body: JSON.stringify(data) };
      }
      return { body: raw };
    });
  }

  return proxyBuffered(req, res, body, async () => ({ body }));
}

function waitForChild(timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port: APP_PORT });
      socket.once("connect", () => { socket.destroy(); resolve(); });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - start >= timeoutMs) reject(new Error("Aplicação interna não iniciou a tempo."));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

async function start() {
  try {
    await initDatabase();
  } catch (err) {
    dbReady = false;
    console.error("ORDERS_DB: não foi possível conectar ao Postgres:", err.message);
  }

  const child = fork(require.resolve("./server.js"), [], {
    env: { ...process.env, PORT: String(APP_PORT) },
    stdio: ["inherit", "inherit", "inherit", "ipc"]
  });

  child.on("exit", code => {
    console.error(`PROXY: aplicação interna encerrou (código ${code}).`);
    process.exit(code || 1);
  });

  try {
    await waitForChild();
  } catch (err) {
    console.error("PROXY:", err.message);
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(err => {
      console.error("PROXY: erro não tratado:", err.message);
      if (!res.headersSent) sendJson(res, 500, { error: "erro_interno", mensagem: "Erro interno do servidor." });
      else res.end();
    });
  });

  server.listen(PUBLIC_PORT, () => console.log(`Servidor público com pedidos persistentes rodando na porta ${PUBLIC_PORT}`));
}

start();
