const http = require('http');
const net = require('net');
const { fork } = require('child_process');

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const INNER_PORT = Number(process.env.WHY_INNER_PORT || 11001);
const MAX_HTML_BYTES = 3 * 1024 * 1024;

const WHY_BLOCK = `
<section id="porque-consultar" class="why-buy-section" aria-labelledby="why-buy-title">
  <div class="why-buy-shell">
    <div class="why-buy-heading">
      <span class="why-buy-kicker">ANTES DE FECHAR NEGÓCIO</span>
      <h2 id="why-buy-title">Por que consultar antes de comprar?</h2>
      <p>Uma consulta veicular pode ajudar você a conhecer melhor o histórico e as pendências disponíveis do veículo antes de tomar uma decisão.</p>
    </div>

    <div class="why-buy-grid">
      <article class="why-buy-card">
        <div class="why-buy-icon">🧾</div>
        <h3>Débitos e restrições</h3>
        <p>Veja pendências e restrições que estiverem disponíveis nas fontes consultadas.</p>
      </article>
      <article class="why-buy-card">
        <div class="why-buy-icon">🏷️</div>
        <h3>Leilão e histórico</h3>
        <p>Identifique apontamentos históricos, inclusive passagem por leilão, quando houver registro disponível.</p>
      </article>
      <article class="why-buy-card">
        <div class="why-buy-icon">🔒</div>
        <h3>Gravame</h3>
        <p>Confira indícios de restrições financeiras ou gravames registrados para o veículo.</p>
      </article>
      <article class="why-buy-card">
        <div class="why-buy-icon">🛠️</div>
        <h3>Recall</h3>
        <p>Consulte informações de campanhas de recall quando elas estiverem disponíveis.</p>
      </article>
    </div>

    <div class="why-buy-bottom">
      <div>
        <strong>Tenha mais informações antes da compra.</strong>
        <span>A disponibilidade dos dados depende das fontes integradas e dos registros existentes.</span>
      </div>
      <a href="#consulta">CONSULTAR UMA PLACA · R$ 18,90</a>
    </div>
  </div>
</section>`;

const WHY_CSS = `
<style id="why-buy-style">
.why-buy-section{
  position:relative;
  padding:88px 0;
  background:
    radial-gradient(circle at 50% 0,rgba(20,111,210,.16),transparent 34%),
    linear-gradient(180deg,#07111e,#050b14);
  color:#f5f9ff;
}
.why-buy-shell{width:min(1160px,90vw);margin:auto}
.why-buy-heading{max-width:760px;margin:0 auto 34px;text-align:center}
.why-buy-kicker{display:inline-block;color:#5bbcff;font-size:11px;font-weight:950;letter-spacing:1.6px}
.why-buy-heading h2{margin:10px 0 12px;font-size:clamp(32px,4.5vw,52px);line-height:1.02;letter-spacing:-1.5px}
.why-buy-heading p{margin:0;color:#8ea1b7;font-size:14px;line-height:1.7}
.why-buy-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:13px}
.why-buy-card{padding:22px;border:1px solid #20344b;border-radius:18px;background:linear-gradient(180deg,#0b1929,#08131f);box-shadow:0 18px 42px rgba(0,0,0,.2)}
.why-buy-icon{display:grid;place-items:center;width:44px;height:44px;border:1px solid #28517a;border-radius:13px;background:#0d2540;font-size:22px}
.why-buy-card h3{margin:15px 0 7px;font-size:15px}
.why-buy-card p{margin:0;color:#8093a9;font-size:11px;line-height:1.65}
.why-buy-bottom{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-top:20px;padding:18px 20px;border:1px solid #25415f;border-radius:16px;background:linear-gradient(90deg,rgba(11,31,52,.96),rgba(7,18,31,.96))}
.why-buy-bottom div{display:grid;gap:4px}.why-buy-bottom strong{font-size:14px}.why-buy-bottom span{color:#7f94aa;font-size:10px;line-height:1.5}
.why-buy-bottom a{flex:0 0 auto;padding:14px 18px;border-radius:11px;background:linear-gradient(135deg,#1b96ff,#0969df);color:#fff;text-decoration:none;font-size:11px;font-weight:950;box-shadow:0 12px 28px rgba(15,117,229,.25)}
@media(max-width:900px){.why-buy-grid{grid-template-columns:repeat(2,1fr)}.why-buy-bottom{align-items:flex-start;flex-direction:column}.why-buy-bottom a{width:100%;text-align:center}}
@media(max-width:560px){.why-buy-section{padding:62px 0}.why-buy-grid{grid-template-columns:1fr}.why-buy-heading{margin-bottom:25px}.why-buy-heading h2{font-size:33px}.why-buy-card{padding:18px;box-shadow:none}.why-buy-bottom{padding:16px}.why-buy-bottom a{padding:13px 12px;font-size:10px}}
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
      if (!html.includes('id="why-buy-style"')) html = html.replace('</head>', `${WHY_CSS}\n</head>`);
      if (!html.includes('id="porque-consultar"')) {
        const resultMarker = '<div id="cv-result" class="cv-result"></div>';
        if (html.includes(resultMarker)) html = html.replace(resultMarker, `${resultMarker}\n${WHY_BLOCK}`);
        else if (html.includes('<section id="dados"')) html = html.replace('<section id="dados"', `${WHY_BLOCK}\n<section id="dados"`);
      }

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
    console.error('WHY_PROXY:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'servico_indisponivel' }));
    }
  });

  req.pipe(upstream);
}

async function start() {
  const child = fork(require.resolve('./perf-start.js'), [], {
    env: { ...process.env, PORT: String(INNER_PORT) },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc']
  });

  child.on('exit', code => {
    console.error(`WHY_PROXY: aplicação interna encerrou (código ${code}).`);
    process.exit(code || 1);
  });

  try {
    await waitForPort(INNER_PORT);
  } catch (err) {
    console.error('WHY_PROXY:', err.message);
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const isHome = req.method === 'GET' && (pathname === '/' || pathname === '/index.html');
    proxy(req, res, isHome);
  });

  server.listen(PUBLIC_PORT, () => console.log(`Bloco por que consultar ativo na porta ${PUBLIC_PORT}`));
}

start();
