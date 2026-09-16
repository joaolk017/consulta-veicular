const http = require('http');
const net = require('net');
const { fork } = require('child_process');

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const INNER_PORT = Number(process.env.PAYMENT_INNER_PORT || 12001);
const MAX_HTML_BYTES = 3 * 1024 * 1024;

const PAYMENT_CSS = `
<style id="payment-cta-style">
.unlock .paybtn,
#pixCreateBtn{
  min-height:60px!important;
  padding:17px 18px!important;
  border:1px solid #36d788!important;
  border-radius:14px!important;
  background:linear-gradient(135deg,#27d47e,#0f944f)!important;
  color:#fff!important;
  font-size:14px!important;
  font-weight:950!important;
  letter-spacing:.2px;
  box-shadow:0 14px 34px rgba(26,177,99,.30)!important;
  transition:transform .16s ease,box-shadow .16s ease,filter .16s ease;
}
.unlock .paybtn:hover,
#pixCreateBtn:hover{
  transform:translateY(-1px);
  filter:brightness(1.05);
  box-shadow:0 18px 38px rgba(26,177,99,.34)!important;
}
.unlock .paybtn:active,
#pixCreateBtn:active{
  transform:translateY(1px) scale(.995);
}
.unlock .secure{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  margin-top:10px;
  padding:7px 10px;
  border:1px solid #284939;
  border-radius:999px;
  background:#0a1710;
  color:#95b6a2;
  font-size:10px;
  font-weight:800;
}
#pixCreateBtn{margin-top:8px!important}
@media(max-width:560px){
  .unlock .paybtn,#pixCreateBtn{min-height:56px!important;font-size:12px!important;padding:15px 12px!important}
  .unlock .secure{font-size:9px}
}
</style>`;

function waitForPort(port, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) reject(new Error('Aplicação interna não iniciou a tempo.'));
        else setTimeout(tryConnect, 200);
      });
    };
    tryConnect();
  });
}

function proxy(req, res, injectHome) {
  const headers = { ...req.headers, host: `127.0.0.1:${INNER_PORT}` };
  if (injectHome) headers['accept-encoding'] = 'identity';

  const upstream = http.request({
    hostname: '127.0.0.1',
    port: INNER_PORT,
    path: req.url,
    method: req.method,
    headers
  }, upstreamRes => {
    if (!injectHome) {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
      return;
    }

    const type = String(upstreamRes.headers['content-type'] || '');
    if (!type.includes('text/html')) {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
      return;
    }

    const chunks = [];
    let size = 0;
    upstreamRes.on('data', chunk => {
      size += chunk.length;
      if (size <= MAX_HTML_BYTES) chunks.push(chunk);
    });
    upstreamRes.on('end', () => {
      if (size > MAX_HTML_BYTES) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Página excedeu o limite de renderização.');
        return;
      }

      let html = Buffer.concat(chunks).toString('utf8');
      html = html.replace('💠 PAGAR COM PIX E DESBLOQUEAR', '🔓 LIBERAR RELATÓRIO COMPLETO · R$ 18,90');
      html = html.replace('💠 GERAR PIX DE R$ 18,90', '💠 GERAR PIX E CONTINUAR · R$ 18,90');
      html = html.replace('🔒 Pagamento via PIX • Liberação após confirmação', '🔒 PIX seguro • pagamento único • liberação após confirmação');
      if (!html.includes('id="payment-cta-style"')) html = html.replace('</head>', `${PAYMENT_CSS}\n</head>`);

      const body = Buffer.from(html, 'utf8');
      const out = {
        ...upstreamRes.headers,
        'content-length': String(body.length),
        'cache-control': 'no-store, no-cache, must-revalidate, max-age=0'
      };
      delete out['content-encoding'];
      delete out['transfer-encoding'];
      res.writeHead(upstreamRes.statusCode || 200, out);
      res.end(body);
    });
  });

  upstream.on('error', err => {
    console.error('PAYMENT_PROXY:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'servico_indisponivel' }));
    }
  });

  req.pipe(upstream);
}

async function start() {
  const child = fork(require.resolve('./why-proxy.js'), [], {
    env: { ...process.env, PORT: String(INNER_PORT) },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc']
  });

  child.on('exit', code => {
    console.error(`PAYMENT_PROXY: aplicação interna encerrou (código ${code}).`);
    process.exit(code || 1);
  });

  try {
    await waitForPort(INNER_PORT);
  } catch (err) {
    console.error('PAYMENT_PROXY:', err.message);
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const isHome = req.method === 'GET' && (pathname === '/' || pathname === '/index.html');
    proxy(req, res, isHome);
  });

  server.listen(PUBLIC_PORT, () => console.log(`Botão de pagamento otimizado na porta ${PUBLIC_PORT}`));
}

start();
