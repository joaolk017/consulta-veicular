const http = require('http');
const net = require('net');
const { fork } = require('child_process');

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const APP_PORT = Number(process.env.THEME_INTERNAL_PORT || 10001);
const ORDERS_INTERNAL_PORT = Number(process.env.INTERNAL_APP_PORT || 10002);
const MAX_HTML_BYTES = 2 * 1024 * 1024;

const LANDING_UI = `
<div id="cv-home" class="cv-home">
  <header class="cv-nav">
    <a class="cv-brand" href="#inicio"><span class="cv-logo">✓</span><span>Consulta Veicular</span></a>
    <nav class="cv-links">
      <a href="#dados">O que consulta</a>
      <a href="#como">Como funciona</a>
      <a href="#crlv">CRLV-e</a>
      <a href="/contato.html">Contato</a>
    </nav>
    <a class="cv-nav-btn" href="#consulta">CONSULTAR PLACA</a>
  </header>

  <main>
    <section id="inicio" class="cv-hero">
      <div class="cv-hero-overlay"></div>
      <div class="cv-shell cv-hero-grid">
        <div class="cv-hero-copy">
          <span class="cv-kicker">CONSULTA VEICULAR ONLINE</span>
          <h1>Antes de comprar,<br><em>consulte o veículo.</em></h1>
          <p>Digite a placa e veja as informações disponíveis antes de fechar negócio. Um jeito simples de reduzir dúvidas na hora da compra.</p>
          <div class="cv-badges">
            <span>✓ Consulta rápida</span>
            <span>✓ Relatório organizado</span>
            <span>✓ Suporte disponível</span>
          </div>
          <a class="cv-secondary-link" href="#dados">Ver o que pode aparecer no relatório ↓</a>
        </div>

        <div class="cv-side">
          <div id="consulta" class="cv-search-card">
            <div class="cv-search-label">CONSULTE AGORA</div>
            <h2>Digite a placa do veículo</h2>
            <p>Use placa Mercosul ou padrão antigo.</p>
            <input id="cv-plate" maxlength="8" autocomplete="off" inputmode="text" placeholder="ABC1D23" aria-label="Digite a placa do veículo">
            <button id="cv-consult-btn" type="button" onclick="consultarCV()">🔎 CONSULTAR VEÍCULO</button>
            <div id="cv-error" class="cv-error" aria-live="polite"></div>
            <div class="cv-price-line"><span>Consulta completa</span><strong>R$ 18,90</strong></div>
            <div class="cv-safe">🔒 A liberação depende da confirmação do pagamento pelo sistema.</div>
          </div>

          <div class="cv-mini-grid">
            <article><b>🚨</b><span>Roubo e furto</span></article>
            <article><b>🏷️</b><span>Leilão</span></article>
            <article><b>🧾</b><span>Multas e débitos</span></article>
            <article><b>🔒</b><span>Gravame</span></article>
          </div>
        </div>
      </div>
      <div class="cv-trustbar">
        <div><b>Serviço privado</b><span>Independente de órgãos públicos</span></div>
        <div><b>Consulta por placa</b><span>Fluxo simples e direto</span></div>
        <div><b>Relatório em PDF</b><span>Quando disponível após liberação</span></div>
      </div>
    </section>

    <div id="cv-result" class="cv-result"></div>

    <section id="dados" class="cv-section">
      <div class="cv-shell">
        <div class="cv-heading">
          <span class="cv-kicker">DADOS DO RELATÓRIO</span>
          <h2>O que você pode encontrar na consulta</h2>
          <p>Os dados exibidos dependem das fontes integradas e dos registros disponíveis para cada veículo.</p>
        </div>
        <div class="cv-cards">
          <article><span>🚨</span><h3>Roubo e furto</h3><p>Indicadores e restrições disponíveis relacionados a ocorrências.</p></article>
          <article><span>🏷️</span><h3>Leilão</h3><p>Apontamentos de passagem por leilão quando houver registro disponível.</p></article>
          <article><span>🧾</span><h3>Multas e débitos</h3><p>Pendências financeiras e administrativas conforme a fonte consultada.</p></article>
          <article><span>🔒</span><h3>Gravame</h3><p>Indícios de restrições financeiras ou gravames registrados.</p></article>
          <article><span>🛠️</span><h3>Recall</h3><p>Informações de campanhas de recall quando disponíveis.</p></article>
          <article><span>🚙</span><h3>Dados cadastrais</h3><p>Marca, modelo, ano e outros dados cadastrais permitidos.</p></article>
          <article><span>🧭</span><h3>Histórico veicular</h3><p>Registros históricos disponíveis sem exposição indevida de dados pessoais.</p></article>
          <article><span>📄</span><h3>Relatório em PDF</h3><p>Opção de salvar ou imprimir quando o recurso estiver disponível.</p></article>
        </div>
      </div>
    </section>

    <section id="como" class="cv-section cv-dark-section">
      <div class="cv-shell">
        <div class="cv-heading">
          <span class="cv-kicker">COMO FUNCIONA</span>
          <h2>Três passos para consultar</h2>
        </div>
        <div class="cv-steps">
          <article><strong>01</strong><div><h3>Digite a placa</h3><p>Informe a placa do veículo no campo de consulta.</p></div></article>
          <article><strong>02</strong><div><h3>Veja o que foi localizado</h3><p>O sistema apresenta os dados que estiverem disponíveis nas fontes integradas.</p></div></article>
          <article><strong>03</strong><div><h3>Libere o relatório</h3><p>Quando houver conteúdo adicional, siga o fluxo de pagamento para liberar o relatório completo.</p></div></article>
        </div>
        <a class="cv-main-cta" href="#consulta">CONSULTAR UMA PLACA</a>
      </div>
    </section>

    <section id="crlv" class="cv-section cv-crlv-section">
      <div class="cv-shell cv-crlv-grid">
        <div>
          <span class="cv-kicker">DOCUMENTAÇÃO · SÃO PAULO</span>
          <h2>Emissão de CRLV-e SP</h2>
          <p>Solicitação privada para obtenção do CRLV-e em PDF de veículo registrado no Estado de São Paulo.</p>
          <div class="cv-crlv-list">
            <span>✓ Documento em PDF quando disponibilizado</span>
            <span>✓ Validação de dados e finalidade</span>
            <span>✓ Confirmação de propriedade ou autorização legítima</span>
          </div>
          <div class="cv-legal">Serviço privado e independente. Não somos DETRAN-SP, SENATRAN ou GOV.BR.</div>
        </div>
        <div class="cv-crlv-card">
          <small>Serviço privado de emissão/assessoria</small>
          <strong>R$ 59,90</strong>
          <button type="button" onclick="abrirCRLVCV()">📄 INICIAR SOLICITAÇÃO</button>
          <span>O fluxo solicita placa, RENAVAM, finalidade e autorização.</span>
        </div>
      </div>
    </section>

    <section class="cv-section">
      <div class="cv-shell">
        <div class="cv-heading">
          <span class="cv-kicker">TRANSPARÊNCIA</span>
          <h2>Informação clara em cada etapa</h2>
        </div>
        <div class="cv-trust-cards">
          <article><span>🔐</span><h3>Dados protegidos</h3><p>Credenciais de integração ficam no servidor e não são exibidas ao visitante.</p></article>
          <article><span>💳</span><h3>Pagamento identificado</h3><p>O relatório é liberado somente após a confirmação válida do pagamento.</p></article>
          <article><span>💬</span><h3>Suporte</h3><p>Em caso de dúvida, use nossa página de contato antes de concluir a solicitação.</p><a href="/contato.html">Acessar suporte →</a></article>
        </div>
      </div>
    </section>

    <section class="cv-section cv-faq-section">
      <div class="cv-shell cv-faq-grid">
        <div class="cv-heading cv-left-heading">
          <span class="cv-kicker">DÚVIDAS FREQUENTES</span>
          <h2>Perguntas comuns</h2>
          <p>Informações rápidas antes de fazer sua consulta.</p>
        </div>
        <div class="cv-faq">
          <details><summary>Quais informações aparecem?</summary><p>Os dados variam conforme o veículo e a disponibilidade das fontes integradas.</p></details>
          <details><summary>A consulta é oficial do governo?</summary><p>Não. O serviço é privado e independente. Para procedimentos oficiais, consulte os canais públicos competentes.</p></details>
          <details><summary>Posso salvar o relatório?</summary><p>Quando o recurso estiver disponível após a liberação, o relatório poderá ser salvo ou impresso em PDF.</p></details>
          <details><summary>Quem pode solicitar o CRLV-e?</summary><p>O fluxo exige que a pessoa seja proprietária do veículo ou possua autorização legítima.</p></details>
        </div>
      </div>
    </section>
  </main>

  <footer class="cv-footer">
    <div class="cv-shell cv-footer-grid">
      <div><strong>Consulta Veicular</strong><p>Consulta e assessoria documental privada.</p></div>
      <div><a href="/contato.html">Contato</a><a href="/privacidade.html">Privacidade</a><a href="/termos.html">Termos de uso</a></div>
      <div class="cv-footer-note">Não somos DETRAN, SENATRAN ou GOV.BR.</div>
    </div>
  </footer>
</div>

<script id="cv-script">
(function(){
  function normalizar(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7)}
  function valida(v){return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(v)||/^[A-Z]{3}[0-9]{4}$/.test(v)}

  window.consultarCV=async function(){
    var input=document.getElementById('cv-plate');
    var erro=document.getElementById('cv-error');
    var botao=document.getElementById('cv-consult-btn');
    var placa=normalizar(input&&input.value);
    if(input) input.value=placa;
    if(!valida(placa)){
      if(erro) erro.textContent='Digite uma placa válida, como ABC1D23.';
      return;
    }
    if(erro) erro.textContent='';
    var original=document.getElementById('plate');
    if(!original || typeof window.consultar!=='function'){
      if(erro) erro.textContent='A consulta está temporariamente indisponível.';
      return;
    }
    original.value=placa;
    if(botao){botao.disabled=true;botao.textContent='CONSULTANDO...';}
    try{
      await Promise.resolve(window.consultar());
      setTimeout(function(){
        var painel=document.getElementById('cv-result');
        if(painel && painel.children.length) painel.scrollIntoView({behavior:'smooth',block:'start'});
      },300);
    }catch(e){
      if(erro) erro.textContent='Não foi possível realizar a consulta agora.';
    }finally{
      if(botao){botao.disabled=false;botao.textContent='🔎 CONSULTAR VEÍCULO';}
    }
  };

  window.abrirCRLVCV=function(){
    if(typeof window.abrirFluxoCRLV==='function') return window.abrirFluxoCRLV();
    var f=document.getElementById('crlvFlow');
    if(f) f.classList.remove('hidden');
  };

  window.addEventListener('DOMContentLoaded',function(){
    var input=document.getElementById('cv-plate');
    if(input){
      input.addEventListener('input',function(e){e.target.value=normalizar(e.target.value)});
      input.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();window.consultarCV();}});
    }
    var painel=document.getElementById('cv-result');
    var status=document.getElementById('status');
    var result=document.getElementById('result');
    if(painel&&status) painel.appendChild(status);
    if(painel&&result) painel.appendChild(result);
  });
})();
</script>`;

const THEME_CSS = `
<style id="cv-theme">
:root{color-scheme:dark}
*{box-sizing:border-box}
html{scroll-behavior:smooth;background:#050914}
body{margin:0!important;padding:0!important;overflow-x:hidden!important;background:#050914!important;color:#f4f8ff;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
body>.wrap{display:none!important}
.cv-home{min-height:100vh;background:#050914;color:#f4f8ff}
.cv-shell{width:min(1160px,90vw);margin:auto}
.cv-nav{position:fixed;z-index:90;top:0;left:0;right:0;height:72px;display:flex;align-items:center;gap:28px;padding:0 max(5vw,24px);background:rgba(4,10,20,.92);border-bottom:1px solid rgba(106,174,255,.14);backdrop-filter:blur(14px)}
.cv-brand{display:flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-size:17px;font-weight:950;white-space:nowrap}.cv-logo{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#1996ff,#0751be);box-shadow:0 8px 24px rgba(16,125,242,.35)}
.cv-links{display:flex;gap:25px;margin-left:auto}.cv-links a{color:#b8c6d8;text-decoration:none;font-size:13px;font-weight:800}.cv-links a:hover{color:#fff}.cv-nav-btn{padding:11px 16px;border-radius:10px;background:#168cff;color:#fff;text-decoration:none;font-size:12px;font-weight:950;box-shadow:0 9px 26px rgba(19,126,235,.28)}
.cv-hero{position:relative;min-height:760px;padding:120px 0 110px;overflow:hidden;background:#06101e}.cv-hero:before{content:"";position:absolute;inset:0;background-image:url('ChatGPT%20Image%2016%20de%20set.%20de%202026,%2012_01_50.png?v=8');background-size:cover;background-position:center;opacity:.20;filter:saturate(.9)}.cv-hero-overlay{position:absolute;inset:0;background:radial-gradient(circle at 73% 28%,rgba(16,113,221,.22),transparent 31%),linear-gradient(90deg,#040a14 0%,rgba(4,10,20,.94) 45%,rgba(4,10,20,.72) 100%)}
.cv-hero-grid{position:relative;z-index:4;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(360px,.78fr);gap:70px;align-items:center;min-height:540px}.cv-kicker{display:inline-block;color:#58b9ff;font-size:11px;font-weight:950;letter-spacing:1.7px}.cv-hero-copy h1{margin:15px 0 18px;font-size:clamp(48px,6vw,78px);line-height:.98;letter-spacing:-3px}.cv-hero-copy h1 em{font-style:normal;color:#2f9fff}.cv-hero-copy>p{max-width:620px;margin:0;color:#a8b8cc;font-size:17px;line-height:1.7}.cv-badges{display:flex;flex-wrap:wrap;gap:9px;margin:25px 0 18px}.cv-badges span{padding:8px 11px;border:1px solid #243a56;border-radius:999px;background:#0b1727;color:#d5dfeb;font-size:11px;font-weight:800}.cv-secondary-link{color:#70c2ff;text-decoration:none;font-size:12px;font-weight:850}
.cv-side{display:grid;gap:14px}.cv-search-card{padding:25px;border:1px solid #2a537e;border-radius:22px;background:linear-gradient(180deg,rgba(12,27,46,.97),rgba(7,16,29,.98));box-shadow:0 28px 85px rgba(0,0,0,.5)}.cv-search-label{color:#59baff;font-size:10px;font-weight:950;letter-spacing:1.6px}.cv-search-card h2{margin:7px 0 5px;font-size:25px}.cv-search-card>p{margin:0 0 16px;color:#8496ac;font-size:12px}.cv-search-card input{width:100%;height:58px;border:1px solid #dce5ed;border-radius:12px;background:#f7f9fb;color:#101820;outline:0;padding:0 15px;text-align:center;text-transform:uppercase;font-size:25px;font-weight:950;letter-spacing:4px}.cv-search-card input:focus{box-shadow:0 0 0 4px rgba(39,145,245,.18)}.cv-search-card button{width:100%!important;height:54px;margin:10px 0 0!important;border:0!important;border-radius:12px!important;background:linear-gradient(135deg,#1c98ff,#0866db)!important;color:#fff!important;font-size:14px!important;font-weight:950!important;box-shadow:0 13px 32px rgba(15,117,229,.3)!important;cursor:pointer}.cv-search-card button:disabled{opacity:.6}.cv-error{min-height:16px;margin-top:5px;color:#ffbbc5;text-align:center;font-size:11px;font-weight:800}.cv-price-line{display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:13px;border-top:1px solid #21344a;color:#8fa0b4;font-size:12px}.cv-price-line strong{color:#fff;font-size:22px}.cv-safe{margin-top:8px;color:#708399;font-size:9px;line-height:1.4}
.cv-mini-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.cv-mini-grid article{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid #22354d;border-radius:12px;background:rgba(8,18,31,.92);font-size:10px;font-weight:800;color:#b6c3d2}.cv-mini-grid b{font-size:16px}.cv-trustbar{position:absolute;z-index:5;left:50%;bottom:18px;transform:translateX(-50%);width:min(1060px,88vw);display:grid;grid-template-columns:repeat(3,1fr);gap:1px;overflow:hidden;border:1px solid #1d3148;border-radius:15px;background:#1d3148}.cv-trustbar div{padding:12px 18px;background:rgba(6,16,28,.95)}.cv-trustbar b{display:block;font-size:11px}.cv-trustbar span{color:#75889e;font-size:9px}
.cv-result{width:min(900px,92vw);margin:0 auto;padding-top:22px}.cv-result>#status:not(:empty),.cv-result>#result:not(.hidden){margin:0 0 18px!important;padding:18px!important;border:1px solid #2d4867!important;border-radius:18px!important;background:#081525!important;box-shadow:0 18px 50px rgba(0,0,0,.36)!important}
.cv-section{padding:88px 0;background:#07101d}.cv-section:nth-of-type(even){background:#050b14}.cv-heading{text-align:center;max-width:700px;margin:0 auto 34px}.cv-heading h2{margin:9px 0 10px;font-size:clamp(30px,4vw,46px);letter-spacing:-1.4px}.cv-heading p{margin:0;color:#8da0b6;font-size:14px;line-height:1.6}.cv-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.cv-cards article,.cv-trust-cards article{padding:20px;border:1px solid #1d3047;border-radius:17px;background:linear-gradient(180deg,#0b1828,#08121f)}.cv-cards article>span,.cv-trust-cards article>span{font-size:24px}.cv-cards h3,.cv-trust-cards h3{margin:10px 0 6px;font-size:14px}.cv-cards p,.cv-trust-cards p{margin:0;color:#8295aa;font-size:11px;line-height:1.6}.cv-dark-section{background:linear-gradient(180deg,#061525,#050b14)}.cv-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.cv-steps article{display:flex;gap:15px;padding:22px;border:1px solid #203b58;border-radius:18px;background:#091827}.cv-steps strong{color:#42a8ff;font-size:28px}.cv-steps h3{margin:2px 0 6px;font-size:15px}.cv-steps p{margin:0;color:#8397ad;font-size:11px;line-height:1.55}.cv-main-cta{display:block;width:max-content;margin:28px auto 0;padding:14px 20px;border-radius:11px;background:#168cff;color:#fff;text-decoration:none;font-size:12px;font-weight:950}
.cv-crlv-section{background:radial-gradient(circle at 15% 50%,#12335b 0,#07111f 34%,#050b14 75%)}.cv-crlv-grid{display:grid;grid-template-columns:1.1fr .7fr;gap:70px;align-items:center}.cv-crlv-grid h2{margin:9px 0 10px;font-size:clamp(34px,4.5vw,52px)}.cv-crlv-grid>div>p{color:#91a4b9;line-height:1.7}.cv-crlv-list{display:grid;gap:9px;margin:20px 0}.cv-crlv-list span{color:#c4d2e1;font-size:12px}.cv-legal{padding:12px;border:1px solid #2a405a;border-radius:11px;background:#07111c;color:#70859d;font-size:10px;line-height:1.5}.cv-crlv-card{padding:26px;border:1px solid #34699e;border-radius:20px;background:linear-gradient(180deg,#0e2947,#081728);box-shadow:0 26px 70px rgba(0,0,0,.3);text-align:center}.cv-crlv-card small{display:block;color:#8ca2b8;font-size:10px}.cv-crlv-card strong{display:block;margin:8px 0 14px;font-size:43px}.cv-crlv-card button{width:100%!important;margin:0!important;padding:15px!important;border:0!important;border-radius:11px!important;background:linear-gradient(135deg,#298cff,#135ab5)!important;color:#fff!important;font-size:13px!important;font-weight:950!important;cursor:pointer}.cv-crlv-card>span{display:block;margin-top:10px;color:#7590aa;font-size:9px;line-height:1.45}.cv-trust-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:13px}.cv-trust-cards a{display:inline-block;margin-top:10px;color:#55b7ff;text-decoration:none;font-size:11px;font-weight:850}.cv-faq-section{background:#050b14}.cv-faq-grid{display:grid;grid-template-columns:.72fr 1.28fr;gap:60px}.cv-left-heading{text-align:left;margin:0}.cv-faq{display:grid;gap:9px}.cv-faq details{border:1px solid #1e3249;border-radius:13px;background:#081421;padding:15px 16px}.cv-faq summary{cursor:pointer;font-size:12px;font-weight:900}.cv-faq p{color:#8498ae;font-size:11px;line-height:1.6;margin:10px 0 0}
.cv-footer{padding:32px 0;border-top:1px solid #14243a;background:#030812}.cv-footer-grid{display:grid;grid-template-columns:1fr auto auto;gap:40px;align-items:center}.cv-footer strong{font-size:14px}.cv-footer p,.cv-footer-note{color:#657991;font-size:9px}.cv-footer-grid>div:nth-child(2){display:flex;gap:16px}.cv-footer a{color:#8799ad;text-decoration:none;font-size:10px}body>.flow-overlay{z-index:99999!important}
@media(max-width:900px){.cv-links{display:none}.cv-nav{padding:0 18px}.cv-nav-btn{margin-left:auto}.cv-hero{min-height:auto;padding:110px 0 125px}.cv-hero-grid{grid-template-columns:1fr;gap:34px}.cv-hero-copy{max-width:680px}.cv-trustbar{bottom:14px}.cv-cards{grid-template-columns:repeat(2,1fr)}.cv-crlv-grid{grid-template-columns:1fr;gap:28px}.cv-faq-grid{grid-template-columns:1fr;gap:28px}.cv-left-heading{text-align:center;margin:auto}.cv-footer-grid{grid-template-columns:1fr;text-align:center;gap:14px}.cv-footer-grid>div:nth-child(2){justify-content:center}}
@media(max-width:560px){.cv-nav{height:62px}.cv-brand span:last-child{font-size:14px}.cv-nav-btn{padding:9px 10px;font-size:9px}.cv-hero{padding:95px 0 120px}.cv-hero:before{background-position:62% center;opacity:.13}.cv-hero-grid{gap:25px}.cv-hero-copy h1{font-size:43px;letter-spacing:-2px}.cv-hero-copy>p{font-size:14px}.cv-badges{gap:6px}.cv-badges span{font-size:9px}.cv-search-card{padding:18px;border-radius:17px}.cv-search-card h2{font-size:21px}.cv-search-card input{height:52px;font-size:22px}.cv-search-card button{height:50px}.cv-mini-grid{grid-template-columns:1fr 1fr}.cv-trustbar{width:92vw;grid-template-columns:1fr}.cv-trustbar div:nth-child(2),.cv-trustbar div:nth-child(3){display:none}.cv-section{padding:65px 0}.cv-cards{grid-template-columns:1fr}.cv-steps{grid-template-columns:1fr}.cv-heading h2{font-size:32px}.cv-trust-cards{grid-template-columns:1fr}.cv-crlv-card strong{font-size:36px}}
@media print{.cv-nav,.cv-hero,.cv-footer{display:none!important}}
</style>`;

function waitForPort(port, timeoutMs=25000){
  const start=Date.now();
  return new Promise((resolve,reject)=>{
    const attempt=()=>{
      const socket=net.createConnection({host:'127.0.0.1',port});
      socket.once('connect',()=>{socket.destroy();resolve();});
      socket.once('error',()=>{socket.destroy();if(Date.now()-start>=timeoutMs)reject(new Error('Aplicação interna não iniciou a tempo.'));else setTimeout(attempt,200);});
    };
    attempt();
  });
}

function proxyStream(req,res){
  const headers={...req.headers,host:`127.0.0.1:${APP_PORT}`};
  const upstream=http.request({hostname:'127.0.0.1',port:APP_PORT,path:req.url,method:req.method,headers},u=>{res.writeHead(u.statusCode||502,u.headers);u.pipe(res);});
  upstream.on('error',err=>{console.error('LANDING_PROXY:',err.message);if(!res.headersSent){res.writeHead(502,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'servico_indisponivel'}));}});
  req.pipe(upstream);
}

function serveLanding(req,res){
  const headers={...req.headers,host:`127.0.0.1:${APP_PORT}`};
  const upstream=http.request({hostname:'127.0.0.1',port:APP_PORT,path:req.url,method:'GET',headers},u=>{
    const type=String(u.headers['content-type']||'');
    if(!type.includes('text/html')){res.writeHead(u.statusCode||502,u.headers);return u.pipe(res);}
    const chunks=[];let size=0;
    u.on('data',c=>{size+=c.length;if(size<=MAX_HTML_BYTES)chunks.push(c);});
    u.on('end',()=>{
      if(size>MAX_HTML_BYTES){res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Página excedeu o limite de renderização.');}
      let html=Buffer.concat(chunks).toString('utf8');
      html=html.replace('</head>',`${THEME_CSS}\n</head>`);
      html=html.replace('<body>',`<body>\n${LANDING_UI}`);
      const body=Buffer.from(html);
      const out={...u.headers,'content-length':String(body.length),'cache-control':'no-store, no-cache, must-revalidate, max-age=0',pragma:'no-cache',expires:'0'};
      delete out['transfer-encoding'];
      res.writeHead(u.statusCode||200,out);res.end(body);
    });
  });
  upstream.on('error',err=>{console.error('LANDING_PROXY:',err.message);if(!res.headersSent){res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8'});res.end('Serviço temporariamente indisponível.');}});
  upstream.end();
}

async function start(){
  const child=fork(require.resolve('./orders-proxy.js'),[],{env:{...process.env,PORT:String(APP_PORT),INTERNAL_APP_PORT:String(ORDERS_INTERNAL_PORT)},stdio:['inherit','inherit','inherit','ipc']});
  child.on('exit',code=>{console.error(`LANDING_PROXY: aplicação interna encerrou (código ${code}).`);process.exit(code||1);});
  try{await waitForPort(APP_PORT);}catch(err){console.error('LANDING_PROXY:',err.message);process.exit(1);}
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(req.method==='GET'&&(pathname==='/'||pathname==='/index.html')) return serveLanding(req,res);
    return proxyStream(req,res);
  });
  server.listen(PUBLIC_PORT,()=>console.log(`Nova landing page ativa na porta ${PUBLIC_PORT}`));
}

start();