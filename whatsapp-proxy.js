const http = require('http');
const net = require('net');
const { fork } = require('child_process');

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const INNER_PORT = Number(process.env.WHATSAPP_INNER_PORT || 13001);
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const WHATSAPP_URL = 'https://wa.me/5577920006292?text=Ol%C3%A1%2C%20preciso%20de%20ajuda%20com%20uma%20consulta%20veicular.';

const WHATSAPP_HTML = `
<a id="floating-whatsapp" class="floating-whatsapp" href="${WHATSAPP_URL}" target="_blank" rel="noopener noreferrer" aria-label="Falar pelo WhatsApp">
  <span class="floating-whatsapp-label">Falar no WhatsApp</span>
  <span class="floating-whatsapp-icon" aria-hidden="true">💬</span>
</a>`;

const TRANSPARENCY_HTML = `
<section id="transparencia-clara" class="transparency-clear" aria-labelledby="transparency-clear-title">
  <div class="transparency-clear-shell">
    <div class="transparency-clear-head">
      <span>TRANSPARÊNCIA</span>
      <h2 id="transparency-clear-title">Informações claras antes de continuar</h2>
      <p>Veja como funcionam os serviços, os valores e a disponibilidade das informações antes de realizar uma solicitação.</p>
    </div>
    <div class="transparency-clear-grid">
      <article>
        <div class="transparency-clear-icon">🏢</div>
        <div><b>Serviço privado e independente</b><small>Não somos DETRAN, SENATRAN, GOV.BR ou outro órgão público. Para serviços oficiais, consulte os canais governamentais competentes.</small></div>
      </article>
      <article>
        <div class="transparency-clear-icon">🔎</div>
        <div><b>Dados conforme disponibilidade</b><small>As informações exibidas variam conforme o veículo, as fontes integradas e os registros existentes. Nem todo dado estará disponível em toda consulta.</small></div>
      </article>
      <article>
        <div class="transparency-clear-icon">💠</div>
        <div><b>Consulta veicular · R$ 18,90</b><small>Pagamento via PIX. A liberação do relatório ocorre somente após a confirmação válida do pagamento pelo sistema.</small></div>
      </article>
      <article>
        <div class="transparency-clear-icon">📄</div>
        <div><b>CRLV-e SP · R$ 59,90</b><small>Serviço privado de emissão/assessoria para São Paulo, sujeito à validação dos dados, finalidade e confirmação de propriedade ou autorização legítima.</small></div>
      </article>
    </div>
    <div class="transparency-clear-links">
      <span>Antes de contratar, consulte:</span>
      <a href="/termos.html">Termos de Uso</a>
      <a href="/privacidade.html">Política de Privacidade</a>
      <a href="/contato.html">Contato e Suporte</a>
    </div>
  </div>
</section>`;

const WHATSAPP_CSS = `
<style id="floating-whatsapp-style">
.floating-whatsapp{
  position:fixed;
  right:18px;
  bottom:18px;
  z-index:9000;
  display:flex;
  align-items:center;
  gap:9px;
  color:#fff;
  text-decoration:none;
  font:800 11px/1 Inter,system-ui,-apple-system,'Segoe UI',sans-serif;
  filter:drop-shadow(0 10px 22px rgba(0,0,0,.28));
}
.floating-whatsapp-icon{
  width:50px;
  height:50px;
  display:grid;
  place-items:center;
  border:1px solid rgba(255,255,255,.2);
  border-radius:50%;
  background:#20b95a;
  font-size:22px;
  box-shadow:0 10px 26px rgba(32,185,90,.28);
  transition:transform .16s ease,filter .16s ease;
}
.floating-whatsapp-label{
  padding:9px 11px;
  border:1px solid #234d37;
  border-radius:10px;
  background:rgba(6,21,14,.93);
  color:#dff8e9;
  opacity:0;
  transform:translateX(7px);
  pointer-events:none;
  transition:opacity .16s ease,transform .16s ease;
}
.floating-whatsapp:hover .floating-whatsapp-label,
.floating-whatsapp:focus-visible .floating-whatsapp-label{opacity:1;transform:none}
.floating-whatsapp:hover .floating-whatsapp-icon{transform:translateY(-1px);filter:brightness(1.05)}
.floating-whatsapp:focus-visible{outline:2px solid #7ee7a7;outline-offset:4px;border-radius:999px}

.transparency-clear{
  position:relative;
  padding:54px 0;
  background:linear-gradient(180deg,#07111d,#050b13);
  border-bottom:1px solid #172a40;
  color:#f4f8ff;
}
.transparency-clear-shell{width:min(1160px,92vw);margin:auto}
.transparency-clear-head{text-align:center;max-width:760px;margin:0 auto 24px}
.transparency-clear-head>span{color:#65bfff;font-size:10px;font-weight:950;letter-spacing:1.6px}
.transparency-clear-head h2{margin:8px 0 9px;font-size:clamp(26px,3.6vw,40px);line-height:1.05;letter-spacing:-1px}
.transparency-clear-head p{margin:0;color:#8498ae;font-size:12px;line-height:1.65}
.transparency-clear-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.transparency-clear-grid article{display:flex;align-items:flex-start;gap:12px;padding:18px;border:1px solid #20364e;border-radius:15px;background:linear-gradient(180deg,#0a1827,#07131f)}
.transparency-clear-icon{flex:0 0 auto;width:40px;height:40px;display:grid;place-items:center;border:1px solid #2a5c89;border-radius:11px;background:#0d2944;font-size:18px}
.transparency-clear-grid article>div:last-child{display:grid;gap:5px}
.transparency-clear-grid b{font-size:12px;color:#f7fbff}
.transparency-clear-grid small{font-size:10px;line-height:1.55;color:#8195aa}
.transparency-clear-links{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:18px;padding-top:17px;border-top:1px solid #182b40;color:#72869b;font-size:10px}
.transparency-clear-links a{color:#9fd6ff;text-decoration:none;font-weight:850}
.transparency-clear-links a:hover{text-decoration:underline}

@media(max-width:700px){
  .transparency-clear{padding:42px 0}
  .transparency-clear-grid{grid-template-columns:1fr}
  .transparency-clear-grid article{padding:15px}
  .transparency-clear-links{justify-content:flex-start}
}
@media(max-width:560px){
  .floating-whatsapp{right:13px;bottom:82px}
  .floating-whatsapp-icon{width:46px;height:46px;font-size:20px;box-shadow:0 8px 18px rgba(0,0,0,.24)}
  .floating-whatsapp-label{display:none}
  .transparency-clear-head{text-align:left}
  .transparency-clear-head h2{font-size:29px}
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
      if (!html.includes('id="floating-whatsapp-style"')) html = html.replace('</head>', `${WHATSAPP_CSS}\n</head>`);
      if (!html.includes('id="transparencia-clara"')) {
        const resultMarker = '<div id="cv-result" class="cv-result"></div>';
        if (html.includes(resultMarker)) html = html.replace(resultMarker, `${TRANSPARENCY_HTML}\n${resultMarker}`);
      }
      if (!html.includes('id="floating-whatsapp"')) html = html.replace('</body>', `${WHATSAPP_HTML}\n</body>`);

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
    console.error('WHATSAPP_PROXY:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'servico_indisponivel' }));
    }
  });

  req.pipe(upstream);
}

async function start() {
  const child = fork(require.resolve('./payment-proxy.js'), [], {
    env: { ...process.env, PORT: String(INNER_PORT) },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc']
  });

  child.on('exit', code => {
    console.error(`WHATSAPP_PROXY: aplicação interna encerrou (código ${code}).`);
    process.exit(code || 1);
  });

  try {
    await waitForPort(INNER_PORT);
  } catch (err) {
    console.error('WHATSAPP_PROXY:', err.message);
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const isHome = req.method === 'GET' && (pathname === '/' || pathname === '/index.html');
    proxy(req, res, isHome);
  });

  server.listen(PUBLIC_PORT, () => console.log(`WhatsApp e transparência ativos na porta ${PUBLIC_PORT}`));
}

start();
