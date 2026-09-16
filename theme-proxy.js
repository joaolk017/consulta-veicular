const http = require('http');
const net = require('net');
const { fork } = require('child_process');

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const APP_PORT = Number(process.env.THEME_INTERNAL_PORT || 10001);
const ORDERS_INTERNAL_PORT = Number(process.env.INTERNAL_APP_PORT || 10002);
const MAX_HTML_BYTES = 2 * 1024 * 1024;

const LANDING_UI = `
<div id="landing-root" class="landing-root">
  <header class="landing-nav">
    <a class="landing-brand" href="#inicio" aria-label="Início"><span class="brand-mark">✓</span><span>Consulta Veicular</span></a>
    <nav class="landing-links" aria-label="Navegação principal">
      <a href="#dados">O que consulta</a>
      <a href="#como-funciona">Como funciona</a>
      <a href="#crlv">CRLV-e</a>
      <a href="/contato.html">Contato</a>
    </nav>
    <a class="nav-cta" href="#consulta">Consultar placa</a>
  </header>

  <main>
    <section id="inicio" class="landing-hero">
      <div class="hero-shade"></div>
      <div class="hero-content">
        <div class="hero-copy">
          <span class="hero-eyebrow">🔎 CONSULTA VEICULAR ONLINE</span>
          <h1>Consulte antes de <span>fechar negócio.</span></h1>
          <p>Informe a placa e consulte os dados disponíveis do veículo antes da compra. O relatório completo pode ser liberado após o pagamento.</p>
          <div class="hero-points">
            <span>✓ Consulta rápida</span><span>✓ Pagamento protegido</span><span>✓ Relatório em PDF</span>
          </div>
        </div>

        <div id="consulta" class="hero-search-card">
          <div class="search-title">Digite a placa do veículo</div>
          <div class="search-row">
            <input id="landing-plate" maxlength="8" autocomplete="off" inputmode="text" placeholder="ABC1D23" aria-label="Digite a placa do veículo">
            <button id="landing-consult-btn" type="button" onclick="consultarLanding()">CONSULTAR AGORA →</button>
          </div>
          <div id="landing-consult-error" class="landing-error" aria-live="polite"></div>
          <div class="search-meta"><span>🔒 Ambiente protegido</span><b>Consulta completa: R$ 18,90</b></div>
        </div>
      </div>
      <button class="hero-crlv-hotspot" type="button" onclick="abrirCrlvLanding()" aria-label="Emitir CRLV-e SP"></button>
      <div class="hero-price-cover"><strong>R$ 18,90</strong><span>consulta completa</span></div>
      <a class="scroll-hint" href="#dados">Conheça o serviço <span>↓</span></a>
    </section>

    <div id="landing-result-panel" class="landing-result-panel"></div>

    <section id="dados" class="landing-section">
      <div class="section-heading">
        <span class="section-kicker">RELATÓRIO VEICULAR</span>
        <h2>Informações que podem aparecer na consulta</h2>
        <p>A disponibilidade depende das fontes integradas e dos registros existentes para cada veículo.</p>
      </div>
      <div class="data-grid">
        <article class="data-card"><span>🚨</span><h3>Roubo e furto</h3><p>Indicadores disponíveis relacionados a ocorrências e restrições.</p></article>
        <article class="data-card"><span>🏷️</span><h3>Leilão</h3><p>Apontamentos de passagem por leilão quando disponíveis.</p></article>
        <article class="data-card"><span>🧾</span><h3>Multas e débitos</h3><p>Informações de débitos e pendências conforme a fonte consultada.</p></article>
        <article class="data-card"><span>🔒</span><h3>Gravame</h3><p>Indícios de restrições financeiras ou gravames registrados.</p></article>
        <article class="data-card"><span>🛠️</span><h3>Recall</h3><p>Chamados de fabricante ou informações de recall quando disponíveis.</p></article>
        <article class="data-card"><span>📋</span><h3>Dados cadastrais</h3><p>Marca, modelo, ano e outros dados cadastrais permitidos.</p></article>
        <article class="data-card"><span>🧭</span><h3>Histórico veicular</h3><p>Registros históricos disponíveis sem exposição indevida de dados pessoais.</p></article>
        <article class="data-card"><span>📄</span><h3>PDF do relatório</h3><p>Após a liberação, salve ou imprima o relatório quando essa opção estiver disponível.</p></article>
      </div>
    </section>

    <section id="como-funciona" class="landing-section alt-section">
      <div class="section-heading">
        <span class="section-kicker">SIMPLES E RÁPIDO</span>
        <h2>Como funciona</h2>
        <p>Um fluxo direto para você consultar antes de tomar uma decisão.</p>
      </div>
      <div class="steps-grid">
        <article class="step-card"><b>01</b><div><h3>Digite a placa</h3><p>Informe a placa no padrão antigo ou Mercosul.</p></div></article>
        <article class="step-card"><b>02</b><div><h3>Veja o que foi localizado</h3><p>O sistema consulta as fontes integradas e apresenta os dados disponíveis.</p></div></article>
        <article class="step-card"><b>03</b><div><h3>Libere o relatório completo</h3><p>Quando houver conteúdo adicional, siga o fluxo de pagamento para desbloquear o relatório.</p></div></article>
      </div>
      <div class="center-cta"><a href="#consulta">CONSULTAR UMA PLACA</a></div>
    </section>

    <section id="crlv" class="landing-section crlv-section">
      <div class="crlv-copy">
        <span class="section-kicker">📄 SÃO PAULO</span>
        <h2>Emissão de CRLV-e SP</h2>
        <p>Solicitação privada para obtenção do CRLV-e em PDF de veículo registrado no Estado de São Paulo.</p>
        <div class="crlv-benefits"><span>✓ Documento em PDF</span><span>✓ Validação de dados e autorização</span><span>✓ Processo online</span></div>
        <div class="crlv-legal">Somente para o proprietário do veículo ou pessoa com autorização legítima. Serviço privado e independente; não somos DETRAN-SP, SENATRAN ou GOV.BR.</div>
      </div>
      <div class="crlv-price-card">
        <span>Serviço privado de emissão/assessoria</span>
        <strong>R$ 59,90</strong>
        <button type="button" onclick="abrirCrlvLanding()">📄 INICIAR SOLICITAÇÃO</button>
        <small>O fluxo inclui placa, RENAVAM, finalidade e confirmação de autorização.</small>
      </div>
    </section>

    <section class="landing-section trust-section">
      <div class="section-heading">
        <span class="section-kicker">CONFIANÇA</span>
        <h2>Uma experiência clara e profissional</h2>
      </div>
      <div class="trust-grid">
        <article><span>🔐</span><h3>Dados protegidos</h3><p>O site usa fluxo próprio para consulta e pagamento, sem expor credenciais no navegador.</p></article>
        <article><span>💳</span><h3>Pagamento identificado</h3><p>A liberação do relatório depende da confirmação do pagamento pelo sistema.</p></article>
        <article><span>💬</span><h3>Suporte</h3><p>Em caso de dúvida, você pode acessar a página de contato antes de concluir a solicitação.</p><a href="/contato.html">Falar com suporte →</a></article>
      </div>
    </section>

    <section class="landing-section faq-section">
      <div class="section-heading">
        <span class="section-kicker">DÚVIDAS FREQUENTES</span>
        <h2>Perguntas sobre a consulta</h2>
      </div>
      <div class="faq-list">
        <details><summary>Quais dados aparecem no relatório?</summary><p>Os dados variam conforme o veículo e as fontes integradas. A página informa os itens disponíveis antes ou durante o fluxo de liberação.</p></details>
        <details><summary>A consulta substitui informações oficiais?</summary><p>Não. O serviço é privado e independente. Para informações oficiais ou procedimentos administrativos, consulte os canais públicos competentes.</p></details>
        <details><summary>Posso salvar o resultado em PDF?</summary><p>Quando o recurso estiver disponível no relatório liberado, você poderá salvar ou imprimir o conteúdo em PDF.</p></details>
        <details><summary>Como funciona o CRLV-e?</summary><p>O fluxo de CRLV-e solicita dados do veículo, finalidade e confirmação de que você é o proprietário ou possui autorização legítima.</p></details>
      </div>
    </section>
  </main>

  <footer class="landing-footer">
    <div><strong>Consulta Veicular</strong><p>Serviço privado e independente de consulta e assessoria documental.</p></div>
    <div class="footer-links"><a href="/contato.html">Contato</a><a href="/privacidade.html">Privacidade</a><a href="/termos.html">Termos de uso</a></div>
    <div class="footer-note">Não somos DETRAN, SENATRAN ou GOV.BR.</div>
  </footer>
</div>

<script id="landing-script">
(function(){
  function normalizar(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7)}
  function valida(v){return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(v)||/^[A-Z]{3}[0-9]{4}$/.test(v)}

  window.consultarLanding=async function(){
    var input=document.getElementById('landing-plate');
    var erro=document.getElementById('landing-consult-error');
    var botao=document.getElementById('landing-consult-btn');
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
        var painel=document.getElementById('landing-result-panel');
        if(painel && painel.children.length) painel.scrollIntoView({behavior:'smooth',block:'start'});
      },250);
    }catch(e){
      if(erro) erro.textContent='Não foi possível realizar a consulta agora.';
    }finally{
      if(botao){botao.disabled=false;botao.textContent='CONSULTAR AGORA →';}
    }
  };

  window.abrirCrlvLanding=function(){
    if(typeof window.abrirFluxoCRLV==='function'){
      window.abrirFluxoCRLV();
      return;
    }
    var fluxo=document.getElementById('crlvFlow');
    if(fluxo) fluxo.classList.remove('hidden');
  };

  window.addEventListener('DOMContentLoaded',function(){
    var input=document.getElementById('landing-plate');
    if(input){
      input.addEventListener('input',function(e){e.target.value=normalizar(e.target.value)});
      input.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();window.consultarLanding();}});
    }
    var painel=document.getElementById('landing-result-panel');
    var status=document.getElementById('status');
    var result=document.getElementById('result');
    if(painel&&status) painel.appendChild(status);
    if(painel&&result) painel.appendChild(result);
  });
})();
</script>`;

const THEME_CSS = `
<style id="background-image-theme">
:root{color-scheme:dark}
*{box-sizing:border-box}
html{scroll-behavior:smooth;background:#030812}
body{margin:0!important;padding:0!important;background:#030812!important;color:#f5f8fc;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;overflow-x:hidden!important}
body > .wrap{display:none!important}
.landing-root{min-height:100vh;background:linear-gradient(#030812,#050b14);color:#f5f8fc}
.landing-nav{position:absolute;z-index:50;top:0;left:0;right:0;height:74px;display:flex;align-items:center;gap:24px;padding:0 clamp(20px,5vw,82px);background:linear-gradient(180deg,rgba(2,8,16,.82),rgba(2,8,16,.18));border-bottom:1px solid rgba(255,255,255,.06)}
.landing-brand{display:flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-weight:950;font-size:17px;white-space:nowrap}.brand-mark{width:31px;height:31px;display:grid;place-items:center;border-radius:9px;background:linear-gradient(135deg,#1c8fff,#0a4dba);box-shadow:0 8px 22px rgba(20,124,239,.35)}
.landing-links{display:flex;align-items:center;gap:24px;margin-left:auto}.landing-links a{color:#d7e2ef;text-decoration:none;font-size:13px;font-weight:800}.landing-links a:hover{color:#fff}.nav-cta{padding:11px 16px;border:1px solid #338cda;border-radius:10px;background:linear-gradient(135deg,#167ed8,#0c4b91);color:#fff;text-decoration:none;font-size:12px;font-weight:900}
.landing-hero{position:relative;min-height:100svh;overflow:hidden;background-image:url('ChatGPT%20Image%2016%20de%20set.%20de%202026,%2012_01_50.png?v=3');background-size:cover;background-position:center top;background-repeat:no-repeat}.hero-shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(2,7,14,.78) 0%,rgba(2,7,14,.28) 48%,rgba(2,7,14,.08) 100%),linear-gradient(180deg,rgba(2,7,14,.2) 55%,#030812 100%)}
.hero-content{position:relative;z-index:5;width:min(1180px,90vw);margin:auto;padding-top:clamp(135px,18vh,190px)}.hero-copy{width:min(610px,52vw)}.hero-eyebrow,.section-kicker{display:inline-flex;align-items:center;gap:7px;color:#6fc3ff;font-size:11px;font-weight:950;letter-spacing:1.5px}.hero-copy h1{font-size:clamp(46px,6.1vw,82px);line-height:.98;letter-spacing:-3px;margin:18px 0}.hero-copy h1 span{display:block;background:linear-gradient(90deg,#ffffff,#48b7ff);-webkit-background-clip:text;background-clip:text;color:transparent}.hero-copy p{max-width:590px;color:#b7c7d8;font-size:clamp(14px,1.3vw,18px);line-height:1.65;margin:0}.hero-points{display:flex;flex-wrap:wrap;gap:10px 18px;margin-top:17px;color:#cfe7ff;font-size:12px;font-weight:800}
.hero-search-card{width:min(720px,62vw);margin-top:28px;padding:14px;border:1px solid rgba(73,159,239,.55);border-radius:18px;background:rgba(5,15,27,.88);box-shadow:0 22px 70px rgba(0,0,0,.4);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}.search-title{font-size:11px;font-weight:900;color:#a9bbce;margin-bottom:8px}.search-row{display:grid;grid-template-columns:minmax(0,1fr) 220px}.search-row input{height:58px;border:0;outline:0;border-radius:12px 0 0 12px;padding:0 18px;background:#fff;color:#122030;text-transform:uppercase;font-size:20px;font-weight:900}.search-row input::placeholder{color:#87909a;text-transform:none;font-weight:700}.search-row button{height:58px;margin:0!important;border:0!important;border-radius:0 12px 12px 0!important;background:linear-gradient(135deg,#1b95ff,#0863d6)!important;color:#fff!important;font-size:13px!important;font-weight:950!important;box-shadow:none!important;cursor:pointer}.search-row button:disabled{opacity:.6}.landing-error{min-height:0;margin-top:7px;color:#ffc0c8;font-size:11px;font-weight:800;text-align:center}.search-meta{display:flex;justify-content:space-between;gap:12px;margin-top:7px;color:#7f94aa;font-size:10px}.search-meta b{color:#d7eaff}
.hero-crlv-hotspot{position:absolute;z-index:8;left:29.8%;bottom:8.5%;width:15.5%;height:6%;margin:0!important;padding:0!important;border:0!important;border-radius:12px!important;background:transparent!important;box-shadow:none!important;cursor:pointer}.hero-crlv-hotspot:hover{outline:2px solid rgba(85,183,255,.75);outline-offset:2px;background:rgba(16,96,176,.12)!important}.hero-price-cover{position:absolute;z-index:7;left:3.5%;bottom:5.3%;width:23%;min-width:230px;padding:13px 17px;border:1px solid rgba(37,124,201,.45);border-radius:14px;background:linear-gradient(135deg,rgba(7,20,35,.98),rgba(4,11,20,.98));box-shadow:0 15px 35px rgba(0,0,0,.45)}.hero-price-cover strong{display:block;color:#fff;font-size:27px}.hero-price-cover span{color:#8fa6bb;font-size:10px}.scroll-hint{position:absolute;z-index:7;left:50%;bottom:18px;transform:translateX(-50%);color:#8ca1b5;text-decoration:none;font-size:10px;font-weight:800;letter-spacing:.5px}.scroll-hint span{display:block;text-align:center;font-size:18px;color:#55b7ff}
.landing-result-panel{width:min(920px,92vw);margin:0 auto;position:relative;z-index:20}.landing-result-panel>#status:not(:empty),.landing-result-panel>#result:not(.hidden){margin:20px 0!important;padding:18px!important;border-radius:17px!important;background:#07111df7!important;border:1px solid #274e73!important;box-shadow:0 20px 60px #0007!important}
.landing-section{width:min(1180px,90vw);margin:auto;padding:92px 0}.alt-section{width:100%;padding-left:max(5vw,calc((100vw - 1180px)/2));padding-right:max(5vw,calc((100vw - 1180px)/2));background:linear-gradient(180deg,#06101b,#050b14);border-top:1px solid #10243a;border-bottom:1px solid #10243a}.section-heading{max-width:720px;margin:0 auto 36px;text-align:center}.section-heading h2{font-size:clamp(30px,4vw,48px);letter-spacing:-1.5px;margin:10px 0}.section-heading p{color:#8fa2b6;font-size:14px;line-height:1.65;margin:0}.data-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:13px}.data-card{min-height:180px;padding:21px;border:1px solid #1d3851;border-radius:18px;background:linear-gradient(180deg,#091725,#06101a);box-shadow:0 18px 45px rgba(0,0,0,.18)}.data-card>span{font-size:25px}.data-card h3{margin:12px 0 6px;font-size:15px}.data-card p{margin:0;color:#8395a7;font-size:12px;line-height:1.55}
.steps-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:15px}.step-card{display:flex;gap:17px;padding:24px;border:1px solid #1e3b55;border-radius:18px;background:#081522}.step-card>b{display:grid;place-items:center;flex:0 0 46px;height:46px;border-radius:13px;background:linear-gradient(135deg,#167ed8,#0c477f);font-size:14px}.step-card h3{margin:2px 0 6px;font-size:16px}.step-card p{margin:0;color:#889bad;font-size:12px;line-height:1.55}.center-cta{text-align:center;margin-top:27px}.center-cta a{display:inline-block;padding:15px 24px;border-radius:12px;background:linear-gradient(135deg,#1a8fff,#0965da);color:#fff;text-decoration:none;font-size:12px;font-weight:950;box-shadow:0 14px 34px rgba(13,111,218,.25)}
.crlv-section{display:grid;grid-template-columns:1.25fr .75fr;gap:32px;align-items:center}.crlv-copy h2{font-size:clamp(34px,4.5vw,54px);margin:10px 0 13px}.crlv-copy>p{max-width:670px;color:#95a9bc;font-size:14px;line-height:1.7}.crlv-benefits{display:grid;gap:8px;margin:20px 0;color:#c9dcef;font-size:12px;font-weight:800}.crlv-legal{max-width:680px;padding:13px;border:1px solid #243d55;border-radius:11px;background:#07131f;color:#71869a;font-size:10px;line-height:1.55}.crlv-price-card{padding:26px;border:1px solid #285f96;border-radius:22px;background:radial-gradient(circle at 50% 0,#11335a,#081522 65%);box-shadow:0 25px 70px rgba(0,0,0,.3)}.crlv-price-card>span{color:#92a9bf;font-size:10px}.crlv-price-card strong{display:block;font-size:43px;margin:8px 0 16px}.crlv-price-card button{width:100%;padding:16px;margin:0;border:0;border-radius:12px;background:linear-gradient(135deg,#2479d8,#15509b);color:#fff;font-size:13px;font-weight:950;cursor:pointer}.crlv-price-card small{display:block;margin-top:10px;color:#71869a;font-size:9px;line-height:1.5;text-align:center}
.trust-section{padding-top:65px}.trust-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.trust-grid article{padding:22px;border:1px solid #1c344b;border-radius:17px;background:#07131f}.trust-grid span{font-size:25px}.trust-grid h3{margin:12px 0 6px;font-size:15px}.trust-grid p{margin:0;color:#8396a9;font-size:12px;line-height:1.6}.trust-grid a{display:inline-block;margin-top:10px;color:#55b7ff;text-decoration:none;font-size:11px;font-weight:900}
.faq-section{padding-top:60px}.faq-list{max-width:840px;margin:auto;display:grid;gap:10px}.faq-list details{border:1px solid #1d3952;border-radius:14px;background:#07131f;padding:0 18px}.faq-list summary{cursor:pointer;list-style:none;padding:17px 0;font-size:13px;font-weight:900}.faq-list summary::-webkit-details-marker{display:none}.faq-list details p{margin:0;padding:0 0 17px;color:#8498aa;font-size:12px;line-height:1.65}
.landing-footer{display:grid;grid-template-columns:1fr auto;gap:22px;align-items:end;padding:35px max(5vw,calc((100vw - 1180px)/2));border-top:1px solid #13283c;background:#02070d}.landing-footer strong{font-size:15px}.landing-footer p{margin:5px 0 0;color:#607589;font-size:10px}.footer-links{display:flex;gap:15px}.footer-links a{color:#93a6b9;text-decoration:none;font-size:10px}.footer-note{grid-column:1/-1;color:#4d6275;font-size:9px}
body > .flow-overlay{z-index:99999!important}
@media(max-width:900px){.landing-links{display:none}.data-grid{grid-template-columns:repeat(2,1fr)}.steps-grid,.trust-grid{grid-template-columns:1fr}.crlv-section{grid-template-columns:1fr}.hero-copy{width:min(700px,86vw)}.hero-search-card{width:min(720px,86vw)}.hero-price-cover{display:none}.hero-crlv-hotspot{display:none}}
@media(max-width:620px){.landing-nav{height:64px;padding:0 14px}.landing-brand{font-size:14px}.brand-mark{width:28px;height:28px}.nav-cta{padding:9px 10px;font-size:10px}.landing-hero{min-height:900px;background-position:center top}.hero-shade{background:linear-gradient(180deg,rgba(2,7,14,.45),rgba(2,7,14,.72) 50%,#030812 100%)}.hero-content{width:92vw;padding-top:105px}.hero-copy{width:100%;text-align:center}.hero-copy h1{font-size:46px;letter-spacing:-2px}.hero-copy p{font-size:14px}.hero-points{justify-content:center;font-size:10px}.hero-search-card{width:100%;margin-top:25px;padding:10px}.search-row{grid-template-columns:1fr;gap:8px}.search-row input,.search-row button{border-radius:11px!important;height:52px}.search-meta{font-size:9px;flex-direction:column;align-items:center}.scroll-hint{bottom:12px}.landing-section{width:92vw;padding:68px 0}.alt-section{width:100%;padding-left:4vw;padding-right:4vw}.data-grid{grid-template-columns:1fr 1fr;gap:9px}.data-card{min-height:150px;padding:15px}.data-card h3{font-size:13px}.data-card p{font-size:10px}.section-heading{margin-bottom:27px}.crlv-price-card{padding:20px}.landing-footer{grid-template-columns:1fr;padding:28px 4vw}.footer-links{flex-wrap:wrap}}
@media(max-width:390px){.data-grid{grid-template-columns:1fr}.landing-hero{min-height:930px}.hero-copy h1{font-size:41px}.hero-eyebrow{font-size:9px}}
@media print{.landing-nav,.scroll-hint,.hero-crlv-hotspot{display:none!important}}
</style>`;

function waitForPort(port, timeoutMs = 25000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - start >= timeoutMs) reject(new Error('Aplicação interna não iniciou a tempo.'));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

function proxyStream(req, res) {
  const headers = { ...req.headers, host: `127.0.0.1:${APP_PORT}` };
  const upstream = http.request({ hostname:'127.0.0.1', port:APP_PORT, path:req.url, method:req.method, headers }, upstreamRes => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on('error', err => {
    console.error('THEME_PROXY: erro no proxy:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type':'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error:'servico_indisponivel' }));
    }
  });
  req.pipe(upstream);
}

function serveThemedHtml(req, res) {
  const headers = { ...req.headers, host: `127.0.0.1:${APP_PORT}` };
  const upstream = http.request({ hostname:'127.0.0.1', port:APP_PORT, path:req.url, method:'GET', headers }, upstreamRes => {
    const type = String(upstreamRes.headers['content-type'] || '');
    if (!type.includes('text/html')) {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      return upstreamRes.pipe(res);
    }
    const chunks = [];
    let size = 0;
    upstreamRes.on('data', chunk => { size += chunk.length; if (size <= MAX_HTML_BYTES) chunks.push(chunk); });
    upstreamRes.on('end', () => {
      if (size > MAX_HTML_BYTES) {
        res.writeHead(502, { 'Content-Type':'text/plain; charset=utf-8' });
        return res.end('Página excedeu o limite de renderização.');
      }
      let html = Buffer.concat(chunks).toString('utf8');
      if (!html.includes('id="background-image-theme"')) html = html.replace('</head>', `${THEME_CSS}\n</head>`);
      if (!html.includes('id="landing-root"')) html = html.replace('<body>', `<body>\n${LANDING_UI}`);
      const body = Buffer.from(html);
      const outHeaders = { ...upstreamRes.headers, 'content-length':String(body.length), 'cache-control':'no-store, no-cache, must-revalidate', pragma:'no-cache', expires:'0' };
      delete outHeaders['transfer-encoding'];
      res.writeHead(upstreamRes.statusCode || 200, outHeaders);
      res.end(body);
    });
  });
  upstream.on('error', err => {
    console.error('THEME_PROXY: erro ao carregar HTML:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type':'text/plain; charset=utf-8' });
      res.end('Serviço temporariamente indisponível.');
    }
  });
  upstream.end();
}

async function start() {
  const child = fork(require.resolve('./orders-proxy.js'), [], {
    env:{ ...process.env, PORT:String(APP_PORT), INTERNAL_APP_PORT:String(ORDERS_INTERNAL_PORT) },
    stdio:['inherit','inherit','inherit','ipc']
  });
  child.on('exit', code => { console.error(`THEME_PROXY: aplicação interna encerrou (código ${code}).`); process.exit(code || 1); });
  try { await waitForPort(APP_PORT); } catch (err) { console.error('THEME_PROXY:', err.message); process.exit(1); }
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) return serveThemedHtml(req, res);
    return proxyStream(req, res);
  });
  server.listen(PUBLIC_PORT, () => console.log(`Página inicial completa ativa na porta ${PUBLIC_PORT}`));
}

start();