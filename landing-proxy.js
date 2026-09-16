const http = require('http');
const net = require('net');
const { fork } = require('child_process');

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const APP_PORT = Number(process.env.THEME_INTERNAL_PORT || 10001);
const ORDERS_INTERNAL_PORT = Number(process.env.INTERNAL_APP_PORT || 10002);
const MAX_HTML_BYTES = 2 * 1024 * 1024;

const LANDING_UI = `
<div id="cv-home" class="cv-home">
  <div class="cv-top-strip">
    <span>🔒 Serviço privado e independente</span>
    <span>•</span>
    <span>Consulta veicular por placa</span>
    <span>•</span>
    <span>Suporte disponível</span>
  </div>

  <header class="cv-nav">
    <a class="cv-brand" href="#inicio" aria-label="Início">
      <span class="cv-logo">✓</span><span>Consulta Veicular</span>
    </a>
    <nav class="cv-links" aria-label="Navegação principal">
      <a href="#dados">O que consulta</a>
      <a href="#previa">Exemplo de relatório</a>
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
        <div class="cv-hero-left">
          <div class="cv-hero-copy">
            <span class="cv-kicker">CONSULTA VEICULAR ONLINE</span>
            <h1>Antes de comprar,<br><em>consulte o veículo.</em></h1>
            <p>Digite a placa e veja as informações disponíveis antes de fechar negócio. Um fluxo simples para ajudar você a analisar o veículo com mais clareza.</p>
            <div class="cv-badges">
              <span>✓ Consulta rápida</span>
              <span>✓ Resultado organizado</span>
              <span>✓ Suporte disponível</span>
            </div>
          </div>

          <div id="consulta" class="cv-search-card">
            <div class="cv-search-head">
              <div>
                <span class="cv-search-label">CONSULTE AGORA</span>
                <h2>Digite a placa do veículo</h2>
              </div>
              <div class="cv-search-price"><small>Consulta completa</small><strong>R$ 18,90</strong></div>
            </div>
            <p>Use placa Mercosul ou padrão antigo.</p>
            <div class="cv-search-row">
              <input id="cv-plate" maxlength="8" autocomplete="off" inputmode="text" placeholder="ABC1D23" aria-label="Digite a placa do veículo">
              <button id="cv-consult-btn" type="button" onclick="consultarCV()">🔎 CONSULTAR VEÍCULO</button>
            </div>
            <div id="cv-error" class="cv-error" aria-live="polite"></div>
            <div class="cv-safe-row">
              <span>🔒 Pagamento identificado pelo sistema</span>
              <span>📄 PDF quando disponível</span>
            </div>
          </div>
        </div>

        <aside class="cv-crlv-hero" aria-label="Emissão de CRLV-e SP">
          <div class="cv-crlv-glow"></div>
          <div class="cv-crlv-icon">📄</div>
          <span class="cv-crlv-tag">DOCUMENTAÇÃO · SÃO PAULO</span>
          <h2>Emissão de<br><strong>CRLV-e SP</strong></h2>
          <p>Solicitação privada para obtenção do CRLV-e em PDF de veículo registrado no Estado de São Paulo.</p>
          <div class="cv-crlv-hero-list">
            <span>✓ Documento em PDF quando disponibilizado</span>
            <span>✓ Validação de dados e finalidade</span>
            <span>✓ Proprietário ou autorização legítima</span>
          </div>
          <div class="cv-crlv-hero-price"><small>Serviço privado de emissão/assessoria</small><strong>R$ 59,90</strong></div>
          <button type="button" onclick="abrirCRLVCV()">📄 EMITIR CRLV-e SP AGORA</button>
          <div class="cv-crlv-disclaimer">Serviço privado e independente. Não somos DETRAN-SP, SENATRAN ou GOV.BR.</div>
        </aside>
      </div>

      <div class="cv-trustbar">
        <div><b>🔎 Consulta por placa</b><span>Fluxo simples e direto</span></div>
        <div><b>🔐 Processo protegido</b><span>Credenciais ficam no servidor</span></div>
        <div><b>💬 Suporte</b><span>Contato disponível antes da compra</span></div>
        <div><b>📄 Resultado organizado</b><span>Informações separadas por categoria</span></div>
      </div>
    </section>

    <div id="cv-result" class="cv-result"></div>

    <section class="cv-why">
      <div class="cv-shell cv-why-grid">
        <div class="cv-why-copy">
          <span class="cv-kicker">ANTES DE FECHAR NEGÓCIO</span>
          <h2>Uma consulta pode revelar pontos que merecem atenção.</h2>
          <p>Use o relatório como uma fonte adicional de informação antes da compra. Os dados disponíveis variam de acordo com o veículo e as fontes integradas.</p>
          <a href="#consulta">CONSULTAR UMA PLACA →</a>
        </div>
        <div class="cv-risk-grid">
          <article><span>🚨</span><b>Restrições</b><small>Indicadores disponíveis relacionados ao veículo.</small></article>
          <article><span>🏷️</span><b>Leilão</b><small>Apontamentos quando houver registro disponível.</small></article>
          <article><span>💳</span><b>Gravame</b><small>Indícios de restrições financeiras registradas.</small></article>
          <article><span>🧾</span><b>Débitos</b><small>Pendências conforme a fonte consultada.</small></article>
        </div>
      </div>
    </section>

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

    <section id="previa" class="cv-section cv-preview-section">
      <div class="cv-shell cv-preview-grid">
        <div class="cv-preview-copy">
          <span class="cv-kicker">EXEMPLO ILUSTRATIVO</span>
          <h2>Veja como o relatório pode ser organizado</h2>
          <p>Esta prévia é apenas demonstrativa e não contém dados reais nem informações pessoais. O conteúdo final depende dos dados disponíveis para a placa consultada.</p>
          <div class="cv-preview-points">
            <span>✓ Resumo do veículo</span>
            <span>✓ Alertas separados por categoria</span>
            <span>✓ Informações fáceis de localizar</span>
            <span>✓ Opção de PDF quando disponível</span>
          </div>
          <a class="cv-main-cta cv-left-cta" href="#consulta">FAZER MINHA CONSULTA</a>
        </div>
        <div class="cv-report-mock" aria-label="Prévia ilustrativa de relatório">
          <div class="cv-report-top"><div><b>Consulta Veicular</b><small>Relatório ilustrativo</small></div><span>EXEMPLO</span></div>
          <div class="cv-report-vehicle"><div class="cv-report-car">🚙</div><div><small>VEÍCULO</small><b>Modelo demonstrativo</b><span>Placa: ABC1D23 · Ano: 20XX</span></div></div>
          <div class="cv-report-row"><span>🚨 Roubo e furto</span><b class="cv-neutral">Consultar fonte</b></div>
          <div class="cv-report-row"><span>🏷️ Leilão</span><b class="cv-neutral">Verificar dados</b></div>
          <div class="cv-report-row"><span>🔒 Gravame</span><b class="cv-neutral">Verificar dados</b></div>
          <div class="cv-report-row"><span>🧾 Multas e débitos</span><b class="cv-neutral">Verificar dados</b></div>
          <div class="cv-report-foot">Prévia sem dados reais ou pessoais</div>
        </div>
      </div>
    </section>

    <section id="como" class="cv-section cv-dark-section">
      <div class="cv-shell">
        <div class="cv-heading">
          <span class="cv-kicker">COMO FUNCIONA</span>
          <h2>Do início ao relatório em quatro etapas</h2>
        </div>
        <div class="cv-progress-line" aria-hidden="true"><span></span></div>
        <div class="cv-steps cv-steps-four">
          <article><strong>01</strong><div><h3>Digite a placa</h3><p>Informe a placa no campo de consulta.</p></div></article>
          <article><strong>02</strong><div><h3>Veja o resultado inicial</h3><p>O sistema apresenta o que estiver disponível.</p></div></article>
          <article><strong>03</strong><div><h3>Faça a liberação</h3><p>Quando necessário, siga o fluxo de pagamento.</p></div></article>
          <article><strong>04</strong><div><h3>Acesse o relatório</h3><p>Consulte os detalhes liberados e salve quando houver opção de PDF.</p></div></article>
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

    <section class="cv-section cv-trust-section">
      <div class="cv-shell">
        <div class="cv-heading">
          <span class="cv-kicker">TRANSPARÊNCIA</span>
          <h2>Informação clara em cada etapa</h2>
        </div>
        <div class="cv-trust-cards">
          <article><span>🔐</span><h3>Credenciais no servidor</h3><p>Chaves de integração não são exibidas ao visitante no navegador.</p></article>
          <article><span>💳</span><h3>Pagamento identificado</h3><p>A liberação depende da confirmação válida do pagamento pelo sistema.</p></article>
          <article><span>💬</span><h3>Suporte antes da compra</h3><p>Em caso de dúvida, use nossa página de contato antes de concluir a solicitação.</p><a href="/contato.html">Acessar suporte →</a></article>
        </div>
      </div>
    </section>

    <section class="cv-section cv-faq-section">
      <div class="cv-shell cv-faq-grid">
        <div class="cv-heading cv-left-heading">
          <span class="cv-kicker">DÚVIDAS FREQUENTES</span>
          <h2>Perguntas comuns</h2>
          <p>Informações rápidas antes de fazer sua consulta.</p>
          <a class="cv-support-link" href="/contato.html">Ainda tem dúvida? Fale com o suporte →</a>
        </div>
        <div class="cv-faq">
          <details><summary>Quais informações aparecem?</summary><p>Os dados variam conforme o veículo e a disponibilidade das fontes integradas.</p></details>
          <details><summary>A consulta é oficial do governo?</summary><p>Não. O serviço é privado e independente. Para procedimentos oficiais, consulte os canais públicos competentes.</p></details>
          <details><summary>Posso salvar o relatório?</summary><p>Quando o recurso estiver disponível após a liberação, o relatório poderá ser salvo ou impresso em PDF.</p></details>
          <details><summary>O que acontece se um dado não estiver disponível?</summary><p>Algumas categorias podem não retornar informação para todos os veículos. O conteúdo depende das fontes integradas e dos registros existentes.</p></details>
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

  <a class="cv-floating-support" href="/contato.html" aria-label="Abrir suporte">💬 <span>Suporte</span></a>
  <div class="cv-mobile-bar" aria-label="Ações rápidas">
    <a href="#consulta">🔎 Consultar · R$ 18,90</a>
    <button type="button" onclick="abrirCRLVCV()">📄 CRLV-e · R$ 59,90</button>
  </div>
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
    if(f){f.classList.remove('hidden');document.body.classList.add('no-scroll');}
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
.cv-home{min-height:100vh;background:#050914;color:#f4f8ff;padding-top:28px}
.cv-shell{width:min(1180px,91vw);margin:auto}
.cv-top-strip{position:fixed;z-index:100;top:0;left:0;right:0;height:28px;display:flex;align-items:center;justify-content:center;gap:10px;background:#03101f;color:#8da4bb;border-bottom:1px solid #142944;font-size:9px;font-weight:800;letter-spacing:.2px}
.cv-nav{position:fixed;z-index:90;top:28px;left:0;right:0;height:72px;display:flex;align-items:center;gap:28px;padding:0 max(4.5vw,24px);background:rgba(4,10,20,.93);border-bottom:1px solid rgba(106,174,255,.14);backdrop-filter:blur(14px)}
.cv-brand{display:flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-size:17px;font-weight:950;white-space:nowrap}.cv-logo{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#1996ff,#0751be);box-shadow:0 8px 24px rgba(16,125,242,.35)}
.cv-links{display:flex;gap:20px;margin-left:auto}.cv-links a{color:#b8c6d8;text-decoration:none;font-size:12px;font-weight:800}.cv-links a:hover{color:#fff}.cv-nav-btn{padding:11px 16px;border-radius:10px;background:#168cff;color:#fff;text-decoration:none;font-size:11px;font-weight:950;box-shadow:0 9px 26px rgba(19,126,235,.28)}
.cv-hero{position:relative;min-height:850px;padding:140px 0 115px;overflow:hidden;background:#06101e}.cv-hero:before{content:"";position:absolute;inset:0;background-image:url('ChatGPT%20Image%2016%20de%20set.%20de%202026,%2012_01_50.png?v=12');background-size:cover;background-position:center;opacity:.16;filter:saturate(.9)}.cv-hero-overlay{position:absolute;inset:0;background:radial-gradient(circle at 76% 28%,rgba(16,113,221,.22),transparent 30%),linear-gradient(90deg,#040a14 0%,rgba(4,10,20,.94) 48%,rgba(4,10,20,.74) 100%)}
.cv-hero-grid{position:relative;z-index:4;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(390px,.82fr);gap:55px;align-items:center;min-height:600px}.cv-hero-left{display:grid;gap:26px}.cv-kicker{display:inline-block;color:#58b9ff;font-size:11px;font-weight:950;letter-spacing:1.7px}.cv-hero-copy h1{margin:15px 0 18px;font-size:clamp(48px,5.4vw,72px);line-height:.98;letter-spacing:-3px}.cv-hero-copy h1 em{font-style:normal;color:#2f9fff}.cv-hero-copy>p{max-width:620px;margin:0;color:#a8b8cc;font-size:16px;line-height:1.7}.cv-badges{display:flex;flex-wrap:wrap;gap:9px;margin-top:22px}.cv-badges span{padding:8px 11px;border:1px solid #243a56;border-radius:999px;background:#0b1727;color:#d5dfeb;font-size:10px;font-weight:800}
.cv-search-card{padding:24px;border:1px solid #2a537e;border-radius:22px;background:linear-gradient(180deg,rgba(12,27,46,.98),rgba(7,16,29,.99));box-shadow:0 28px 85px rgba(0,0,0,.5)}.cv-search-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.cv-search-label{color:#59baff;font-size:9px;font-weight:950;letter-spacing:1.6px}.cv-search-card h2{margin:6px 0 3px;font-size:22px}.cv-search-card>p{margin:0 0 15px;color:#8496ac;font-size:11px}.cv-search-price{text-align:right;white-space:nowrap}.cv-search-price small{display:block;color:#7e91a7;font-size:9px}.cv-search-price strong{display:block;color:#fff;font-size:26px}.cv-search-row{display:grid;grid-template-columns:minmax(0,1fr) 190px;gap:9px}.cv-search-card input{width:100%;height:56px;border:1px solid #dce5ed;border-radius:12px;background:#f7f9fb;color:#101820;outline:0;padding:0 15px;text-align:center;text-transform:uppercase;font-size:24px;font-weight:950;letter-spacing:4px}.cv-search-card input:focus{box-shadow:0 0 0 4px rgba(39,145,245,.18)}.cv-search-card button{width:100%!important;height:56px;margin:0!important;border:0!important;border-radius:12px!important;background:linear-gradient(135deg,#1c98ff,#0866db)!important;color:#fff!important;font-size:12px!important;font-weight:950!important;box-shadow:0 13px 32px rgba(15,117,229,.3)!important;cursor:pointer}.cv-search-card button:disabled{opacity:.6}.cv-error{min-height:15px;margin-top:5px;color:#ffbbc5;text-align:center;font-size:10px;font-weight:800}.cv-safe-row{display:flex;gap:16px;flex-wrap:wrap;padding-top:10px;border-top:1px solid #21344a;color:#75899f;font-size:9px}
.cv-crlv-hero{position:relative;overflow:hidden;padding:34px;border:1px solid rgba(55,143,230,.78);border-radius:28px;background:linear-gradient(155deg,rgba(18,55,92,.98),rgba(7,19,34,.99));box-shadow:0 35px 100px rgba(0,0,0,.54),0 0 55px rgba(17,118,225,.14)}.cv-crlv-glow{position:absolute;width:250px;height:250px;right:-80px;top:-80px;border-radius:50%;background:#168cff;filter:blur(80px);opacity:.2}.cv-crlv-icon{position:relative;display:grid;place-items:center;width:58px;height:58px;border:1px solid #3d79b4;border-radius:17px;background:#0e3155;font-size:27px}.cv-crlv-tag{position:relative;display:block;margin-top:20px;color:#65c0ff;font-size:10px;font-weight:950;letter-spacing:1.4px}.cv-crlv-hero h2{position:relative;margin:8px 0 12px;font-size:clamp(36px,4vw,52px);line-height:.98;letter-spacing:-1.8px}.cv-crlv-hero h2 strong{color:#62bdff}.cv-crlv-hero>p{position:relative;color:#a2b6ca;font-size:13px;line-height:1.65}.cv-crlv-hero-list{position:relative;display:grid;gap:8px;margin:18px 0}.cv-crlv-hero-list span{color:#d0dbe6;font-size:11px}.cv-crlv-hero-price{position:relative;padding:14px 0;border-top:1px solid #294765;border-bottom:1px solid #294765}.cv-crlv-hero-price small{display:block;color:#8298ae;font-size:9px}.cv-crlv-hero-price strong{display:block;margin-top:2px;font-size:38px}.cv-crlv-hero button{position:relative;width:100%!important;height:56px;margin:15px 0 0!important;border:0!important;border-radius:13px!important;background:linear-gradient(135deg,#309dff,#1061bf)!important;color:#fff!important;font-size:13px!important;font-weight:950!important;box-shadow:0 16px 38px rgba(18,110,211,.34)!important;cursor:pointer}.cv-crlv-disclaimer{position:relative;margin-top:10px;color:#6f879f;font-size:8.5px;line-height:1.45;text-align:center}
.cv-trustbar{position:absolute;z-index:5;left:50%;bottom:18px;transform:translateX(-50%);width:min(1110px,90vw);display:grid;grid-template-columns:repeat(4,1fr);gap:1px;overflow:hidden;border:1px solid #1d3148;border-radius:15px;background:#1d3148}.cv-trustbar div{padding:12px 16px;background:rgba(6,16,28,.96)}.cv-trustbar b{display:block;font-size:10px}.cv-trustbar span{color:#75889e;font-size:8.5px}
.cv-result{width:min(900px,92vw);margin:0 auto;padding-top:22px}.cv-result>#status:not(:empty),.cv-result>#result:not(.hidden){margin:0 0 18px!important;padding:18px!important;border:1px solid #2d4867!important;border-radius:18px!important;background:#081525!important;box-shadow:0 18px 50px rgba(0,0,0,.36)!important}
.cv-why{padding:72px 0;background:linear-gradient(135deg,#061525,#07101d)}.cv-why-grid{display:grid;grid-template-columns:.9fr 1.1fr;gap:55px;align-items:center}.cv-why-copy h2{margin:9px 0 12px;font-size:clamp(31px,4vw,46px);line-height:1.08}.cv-why-copy p{color:#8ea2b8;font-size:13px;line-height:1.7}.cv-why-copy a{display:inline-block;margin-top:10px;color:#60bdff;text-decoration:none;font-size:11px;font-weight:900}.cv-risk-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.cv-risk-grid article{padding:18px;border:1px solid #21405f;border-radius:16px;background:#0a1929}.cv-risk-grid span{font-size:23px}.cv-risk-grid b{display:block;margin:9px 0 4px;font-size:13px}.cv-risk-grid small{color:#8195aa;line-height:1.5}
.cv-section{padding:88px 0;background:#07101d}.cv-section:nth-of-type(even){background:#050b14}.cv-heading{text-align:center;max-width:710px;margin:0 auto 34px}.cv-heading h2{margin:9px 0 10px;font-size:clamp(30px,4vw,46px);letter-spacing:-1.4px}.cv-heading p{margin:0;color:#8da0b6;font-size:14px;line-height:1.6}.cv-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.cv-cards article,.cv-trust-cards article{padding:20px;border:1px solid #1d3047;border-radius:17px;background:linear-gradient(180deg,#0b1828,#08121f);transition:transform .22s ease,border-color .22s ease}.cv-cards article:hover,.cv-trust-cards article:hover{transform:translateY(-3px);border-color:#31577d}.cv-cards article>span,.cv-trust-cards article>span{font-size:24px}.cv-cards h3,.cv-trust-cards h3{margin:10px 0 6px;font-size:14px}.cv-cards p,.cv-trust-cards p{margin:0;color:#8295aa;font-size:11px;line-height:1.6}
.cv-preview-section{background:radial-gradient(circle at 75% 45%,#0e2e52 0,#07111e 38%,#050b14 78%)}.cv-preview-grid{display:grid;grid-template-columns:.85fr 1.15fr;gap:65px;align-items:center}.cv-preview-copy h2{margin:9px 0 12px;font-size:clamp(32px,4vw,48px);line-height:1.06}.cv-preview-copy>p{color:#8fa4ba;font-size:13px;line-height:1.7}.cv-preview-points{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:20px 0}.cv-preview-points span{color:#c5d4e3;font-size:11px}.cv-left-cta{margin:24px 0 0!important}.cv-report-mock{padding:24px;border:1px solid #335b83;border-radius:23px;background:linear-gradient(180deg,#f7f9fb,#e8eef4);color:#13202e;box-shadow:0 30px 80px rgba(0,0,0,.38);transform:rotate(1deg)}.cv-report-top{display:flex;justify-content:space-between;align-items:center;padding-bottom:14px;border-bottom:1px solid #cbd5df}.cv-report-top div{display:grid}.cv-report-top b{font-size:15px}.cv-report-top small{color:#657384;font-size:9px}.cv-report-top>span{padding:6px 9px;border-radius:7px;background:#dbeeff;color:#1262a5;font-size:9px;font-weight:950}.cv-report-vehicle{display:flex;gap:13px;align-items:center;padding:17px 0}.cv-report-car{display:grid;place-items:center;width:55px;height:55px;border-radius:14px;background:#dfe8f0;font-size:25px}.cv-report-vehicle>div:last-child{display:grid;gap:2px}.cv-report-vehicle small{color:#7a8795;font-size:8px}.cv-report-vehicle b{font-size:14px}.cv-report-vehicle span{color:#687788;font-size:9px}.cv-report-row{display:flex;justify-content:space-between;gap:15px;padding:12px 0;border-top:1px solid #d7dee6;font-size:10px}.cv-report-row span{font-weight:800}.cv-report-row b{font-size:9px}.cv-neutral{color:#47728e}.cv-report-foot{margin-top:12px;padding:9px;border-radius:9px;background:#e1e8ef;color:#657586;text-align:center;font-size:8px;font-weight:800}
.cv-dark-section{background:linear-gradient(180deg,#061525,#050b14)}.cv-progress-line{position:relative;width:78%;height:2px;margin:0 auto -29px;background:#18324e}.cv-progress-line span{display:block;width:100%;height:100%;background:linear-gradient(90deg,#168cff,#60bdff)}.cv-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.cv-steps-four{grid-template-columns:repeat(4,1fr)}.cv-steps article{position:relative;z-index:2;display:flex;gap:13px;padding:20px;border:1px solid #203b58;border-radius:18px;background:#091827}.cv-steps strong{display:grid;place-items:center;flex:0 0 42px;height:42px;border-radius:50%;background:#0d2e50;color:#42a8ff;font-size:16px;border:1px solid #275985}.cv-steps h3{margin:2px 0 6px;font-size:13px}.cv-steps p{margin:0;color:#8397ad;font-size:10px;line-height:1.55}.cv-main-cta{display:block;width:max-content;margin:28px auto 0;padding:14px 20px;border-radius:11px;background:#168cff;color:#fff;text-decoration:none;font-size:11px;font-weight:950}
.cv-crlv-section{background:radial-gradient(circle at 15% 50%,#12335b 0,#07111f 34%,#050b14 75%)}.cv-crlv-grid{display:grid;grid-template-columns:1.1fr .7fr;gap:70px;align-items:center}.cv-crlv-grid h2{margin:9px 0 10px;font-size:clamp(34px,4.5vw,52px)}.cv-crlv-grid>div>p{color:#91a4b9;line-height:1.7}.cv-crlv-list{display:grid;gap:9px;margin:20px 0}.cv-crlv-list span{color:#c4d2e1;font-size:12px}.cv-legal{padding:12px;border:1px solid #2a405a;border-radius:11px;background:#07111c;color:#70859d;font-size:10px;line-height:1.5}.cv-crlv-card{padding:26px;border:1px solid #34699e;border-radius:20px;background:linear-gradient(180deg,#0e2947,#081728);box-shadow:0 26px 70px rgba(0,0,0,.3);text-align:center}.cv-crlv-card small{display:block;color:#8ca2b8;font-size:10px}.cv-crlv-card strong{display:block;margin:8px 0 14px;font-size:43px}.cv-crlv-card button{width:100%!important;margin:0!important;padding:15px!important;border:0!important;border-radius:11px!important;background:linear-gradient(135deg,#298cff,#135ab5)!important;color:#fff!important;font-size:13px!important;font-weight:950!important;cursor:pointer}.cv-crlv-card>span{display:block;margin-top:10px;color:#7590aa;font-size:9px;line-height:1.45}.cv-trust-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:13px}.cv-trust-cards a{display:inline-block;margin-top:10px;color:#55b7ff;text-decoration:none;font-size:11px;font-weight:850}.cv-faq-section{background:#050b14}.cv-faq-grid{display:grid;grid-template-columns:.72fr 1.28fr;gap:60px}.cv-left-heading{text-align:left;margin:0}.cv-support-link{display:inline-block;margin-top:16px;color:#5fbdff;text-decoration:none;font-size:11px;font-weight:900}.cv-faq{display:grid;gap:9px}.cv-faq details{border:1px solid #1e3249;border-radius:13px;background:#081421;padding:15px 16px}.cv-faq details[open]{border-color:#315a83;background:#0a1929}.cv-faq summary{cursor:pointer;font-size:12px;font-weight:900}.cv-faq p{color:#8498ae;font-size:11px;line-height:1.6;margin:10px 0 0}
.cv-footer{padding:32px 0;border-top:1px solid #14243a;background:#030812}.cv-footer-grid{display:grid;grid-template-columns:1fr auto auto;gap:40px;align-items:center}.cv-footer strong{font-size:14px}.cv-footer p,.cv-footer-note{color:#657991;font-size:9px}.cv-footer-grid>div:nth-child(2){display:flex;gap:16px}.cv-footer a{color:#8799ad;text-decoration:none;font-size:10px}.cv-floating-support{position:fixed;z-index:80;right:18px;bottom:18px;display:flex;align-items:center;gap:7px;padding:11px 14px;border:1px solid #29577e;border-radius:999px;background:#0a1c2d;color:#dcecff;text-decoration:none;font-size:10px;font-weight:900;box-shadow:0 12px 35px rgba(0,0,0,.35)}.cv-mobile-bar{display:none}body>.flow-overlay{z-index:99999!important}
@media(max-width:1000px){.cv-links{display:none}.cv-nav{padding:0 18px}.cv-nav-btn{margin-left:auto}.cv-hero{min-height:auto;padding:130px 0 130px}.cv-hero-grid{grid-template-columns:1fr;gap:32px}.cv-hero-left{gap:22px}.cv-crlv-hero{max-width:720px}.cv-trustbar{bottom:14px;grid-template-columns:1fr 1fr}.cv-trustbar div:nth-child(3),.cv-trustbar div:nth-child(4){display:none}.cv-why-grid,.cv-preview-grid,.cv-crlv-grid,.cv-faq-grid{grid-template-columns:1fr;gap:32px}.cv-cards{grid-template-columns:repeat(2,1fr)}.cv-steps-four{grid-template-columns:repeat(2,1fr)}.cv-progress-line{display:none}.cv-left-heading{text-align:center;margin:auto}.cv-footer-grid{grid-template-columns:1fr;text-align:center;gap:14px}.cv-footer-grid>div:nth-child(2){justify-content:center}}
@media(max-width:600px){.cv-home{padding-top:24px;padding-bottom:66px}.cv-top-strip{height:24px;gap:5px;font-size:7px}.cv-top-strip span:nth-child(2),.cv-top-strip span:nth-child(4),.cv-top-strip span:nth-child(5){display:none}.cv-nav{top:24px;height:62px}.cv-brand span:last-child{font-size:14px}.cv-nav-btn{padding:9px 10px;font-size:9px}.cv-hero{padding:108px 0 120px}.cv-hero:before{background-position:62% center;opacity:.11}.cv-hero-grid{gap:24px}.cv-hero-copy h1{font-size:42px;letter-spacing:-2px}.cv-hero-copy>p{font-size:13px}.cv-badges{gap:6px}.cv-badges span{font-size:8.5px;padding:7px 9px}.cv-search-card{padding:17px;border-radius:17px}.cv-search-head{display:block}.cv-search-price{text-align:left;margin-top:9px}.cv-search-price small,.cv-search-price strong{display:inline;margin-right:5px}.cv-search-price strong{font-size:21px}.cv-search-card h2{font-size:20px}.cv-search-row{grid-template-columns:1fr}.cv-search-card input{height:52px;font-size:22px}.cv-search-card button{height:50px}.cv-safe-row{display:grid;gap:4px}.cv-crlv-hero{padding:22px;border-radius:21px}.cv-crlv-hero h2{font-size:38px}.cv-crlv-hero-price strong{font-size:34px}.cv-crlv-hero button{height:52px;font-size:12px!important}.cv-trustbar{width:92vw;grid-template-columns:1fr}.cv-trustbar div:nth-child(2){display:none}.cv-why{padding:60px 0}.cv-risk-grid{grid-template-columns:1fr 1fr}.cv-section{padding:65px 0}.cv-cards{grid-template-columns:1fr}.cv-preview-points{grid-template-columns:1fr}.cv-report-mock{padding:17px;transform:none}.cv-steps-four{grid-template-columns:1fr}.cv-heading h2{font-size:31px}.cv-trust-cards{grid-template-columns:1fr}.cv-crlv-card strong{font-size:36px}.cv-floating-support{display:none}.cv-mobile-bar{position:fixed;z-index:95;left:0;right:0;bottom:0;height:62px;display:grid;grid-template-columns:1fr 1fr;gap:7px;padding:7px;background:rgba(3,9,18,.97);border-top:1px solid #23415f;backdrop-filter:blur(10px)}.cv-mobile-bar a,.cv-mobile-bar button{display:grid!important;place-items:center;width:100%!important;height:48px!important;margin:0!important;padding:0 7px!important;border-radius:10px!important;text-decoration:none;font-size:10px!important;font-weight:950!important}.cv-mobile-bar a{background:#168cff;color:#fff}.cv-mobile-bar button{border:1px solid #315f8b!important;background:#102a45!important;color:#e7f3ff!important;box-shadow:none!important}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.cv-cards article,.cv-trust-cards article{transition:none}}
@media print{.cv-top-strip,.cv-nav,.cv-hero,.cv-footer,.cv-mobile-bar,.cv-floating-support{display:none!important}}
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
      if(!html.includes('id="cv-theme"')) html=html.replace('</head>',`${THEME_CSS}\n</head>`);
      if(!html.includes('id="cv-home"')) html=html.replace(/<body([^>]*)>/i,(m,attrs)=>`<body${attrs}>\n${LANDING_UI}`);
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
  server.listen(PUBLIC_PORT,()=>console.log(`Landing page otimizada ativa na porta ${PUBLIC_PORT}`));
}

start();