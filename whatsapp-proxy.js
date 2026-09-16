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

const CNPJ_HTML = `
<section id="cnpj-gratis" class="cnpj-free" aria-labelledby="cnpj-free-title">
  <div class="tool-shell tool-grid">
    <div class="tool-copy">
      <span class="tool-kicker">CONSULTA GRATUITA</span>
      <h2 id="cnpj-free-title">Consulte o CNPJ da loja ou revenda</h2>
      <p>Antes de negociar um veículo, confira gratuitamente os principais dados cadastrais públicos da empresa.</p>
      <div class="tool-benefits">
        <span>✓ Razão social e nome fantasia</span>
        <span>✓ Situação cadastral</span>
        <span>✓ Atividade principal</span>
        <span>✓ Município e estado</span>
      </div>
      <small>Consulta informativa baseada em dados públicos disponibilizados por serviço de terceiros. O resultado não representa certificação, recomendação ou garantia de idoneidade da empresa.</small>
    </div>

    <div class="tool-card">
      <div class="tool-card-head">
        <div><span>🏢</span><b>Consultar CNPJ</b></div>
        <strong>GRÁTIS</strong>
      </div>
      <label for="cnpj-free-input">CNPJ da loja ou revenda</label>
      <div class="cnpj-free-row">
        <input id="cnpj-free-input" inputmode="numeric" autocomplete="off" maxlength="18" placeholder="00.000.000/0000-00" aria-label="Digite o CNPJ da loja ou revenda">
        <button id="cnpj-free-button" type="button">CONSULTAR CNPJ</button>
      </div>
      <div id="cnpj-free-status" class="tool-status" aria-live="polite"></div>
      <div id="cnpj-free-result" class="cnpj-free-result" hidden></div>
    </div>
  </div>
</section>`;

const FINANCE_HTML = `
<section id="simulador-financiamento" class="finance-free" aria-labelledby="finance-title">
  <div class="tool-shell tool-grid finance-grid">
    <div class="tool-copy">
      <span class="tool-kicker">SIMULADOR GRATUITO</span>
      <h2 id="finance-title">Simule o financiamento do seu veículo</h2>
      <p>Informe o valor do veículo, sua entrada, o prazo e a taxa de juros para visualizar uma estimativa das parcelas antes de fechar negócio.</p>
      <div class="tool-benefits">
        <span>✓ Parcela mensal estimada</span>
        <span>✓ Total financiado</span>
        <span>✓ Total aproximado de juros</span>
        <span>✓ Total pago com a entrada</span>
      </div>
      <small>Simulação meramente informativa. Bancos e financeiras podem aplicar CET, tarifas, seguros, impostos e outras condições não incluídas neste cálculo.</small>
    </div>

    <div class="tool-card finance-card">
      <div class="tool-card-head">
        <div><span>🚗</span><b>Simular financiamento</b></div>
        <strong>GRÁTIS</strong>
      </div>
      <div class="finance-form">
        <label>Valor do veículo
          <input id="finance-value" inputmode="decimal" autocomplete="off" placeholder="Ex.: 60.000,00">
        </label>
        <label>Entrada
          <input id="finance-down" inputmode="decimal" autocomplete="off" placeholder="Ex.: 15.000,00">
        </label>
        <label>Número de parcelas
          <select id="finance-months" aria-label="Número de parcelas">
            <option value="12">12 parcelas</option>
            <option value="24">24 parcelas</option>
            <option value="36">36 parcelas</option>
            <option value="48" selected>48 parcelas</option>
            <option value="60">60 parcelas</option>
            <option value="72">72 parcelas</option>
          </select>
        </label>
        <label>Juros ao mês (%)
          <input id="finance-rate" inputmode="decimal" autocomplete="off" placeholder="Ex.: 1,59">
        </label>
      </div>
      <button id="finance-button" class="tool-action-button" type="button">CALCULAR FINANCIAMENTO</button>
      <div id="finance-status" class="tool-status" aria-live="polite"></div>
      <div id="finance-result" class="finance-result" hidden></div>
    </div>
  </div>
</section>`;

const MONTHLY_COST_HTML = `
<section id="custo-mensal" class="monthly-cost-free" aria-labelledby="monthly-cost-title">
  <div class="tool-shell tool-grid monthly-cost-grid">
    <div class="tool-copy">
      <span class="tool-kicker">CALCULADORA GRATUITA</span>
      <h2 id="monthly-cost-title">Descubra quanto seu veículo custa por mês</h2>
      <p>Some combustível, seguro, manutenção, IPVA, financiamento e outros gastos para visualizar uma estimativa do custo real de manter o veículo.</p>
      <div class="tool-benefits">
        <span>✓ Custo mensal estimado</span>
        <span>✓ Custo anual estimado</span>
        <span>✓ Gasto mensal com combustível</span>
        <span>✓ Custo aproximado por km</span>
      </div>
      <small>Os valores são estimativas informadas pelo próprio usuário. Depreciação, imprevistos, multas e despesas não preenchidas não entram no cálculo.</small>
    </div>

    <div class="tool-card monthly-cost-card">
      <div class="tool-card-head">
        <div><span>🧮</span><b>Calcular custo mensal</b></div>
        <strong>GRÁTIS</strong>
      </div>
      <div class="monthly-cost-form">
        <label>Km rodados por mês
          <input id="monthly-km" inputmode="decimal" autocomplete="off" placeholder="Ex.: 1.000">
        </label>
        <label>Consumo médio (km/L)
          <input id="monthly-consumption" inputmode="decimal" autocomplete="off" placeholder="Ex.: 10,5">
        </label>
        <label>Preço do combustível (R$/L)
          <input id="monthly-fuel-price" inputmode="decimal" autocomplete="off" placeholder="Ex.: 6,20">
        </label>
        <label>Seguro anual (R$)
          <input id="monthly-insurance" inputmode="decimal" autocomplete="off" placeholder="Ex.: 2.400,00">
        </label>
        <label>Manutenção anual (R$)
          <input id="monthly-maintenance" inputmode="decimal" autocomplete="off" placeholder="Ex.: 2.000,00">
        </label>
        <label>IPVA anual estimado (R$)
          <input id="monthly-ipva" inputmode="decimal" autocomplete="off" placeholder="Ex.: 2.400,00">
        </label>
        <label>Parcela do financiamento (R$)
          <input id="monthly-financing" inputmode="decimal" autocomplete="off" placeholder="Opcional">
        </label>
        <label>Outros custos mensais (R$)
          <input id="monthly-other" inputmode="decimal" autocomplete="off" placeholder="Estacionamento, pedágio etc.">
        </label>
      </div>
      <button id="monthly-cost-button" class="tool-action-button monthly-cost-button" type="button">CALCULAR CUSTO MENSAL</button>
      <div id="monthly-cost-status" class="tool-status" aria-live="polite"></div>
      <div id="monthly-cost-result" class="monthly-cost-result" hidden></div>
    </div>
  </div>
</section>`;

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
        <div class="transparency-clear-icon">🎁</div>
        <div><b>Ferramentas gratuitas</b><small>Valor de referência, CNPJ, financiamento e custo mensal são recursos informativos gratuitos, sujeitos às condições e fontes indicadas em cada ferramenta.</small></div>
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
.floating-whatsapp{position:fixed;right:18px;bottom:18px;z-index:9000;display:flex;align-items:center;gap:9px;color:#fff;text-decoration:none;font:800 11px/1 Inter,system-ui,-apple-system,'Segoe UI',sans-serif;filter:drop-shadow(0 10px 22px rgba(0,0,0,.28))}
.floating-whatsapp-icon{width:50px;height:50px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.2);border-radius:50%;background:#20b95a;font-size:22px;box-shadow:0 10px 26px rgba(32,185,90,.28);transition:transform .16s ease,filter .16s ease}
.floating-whatsapp-label{padding:9px 11px;border:1px solid #234d37;border-radius:10px;background:rgba(6,21,14,.93);color:#dff8e9;opacity:0;transform:translateX(7px);pointer-events:none;transition:opacity .16s ease,transform .16s ease}
.floating-whatsapp:hover .floating-whatsapp-label,.floating-whatsapp:focus-visible .floating-whatsapp-label{opacity:1;transform:none}.floating-whatsapp:hover .floating-whatsapp-icon{transform:translateY(-1px);filter:brightness(1.05)}.floating-whatsapp:focus-visible{outline:2px solid #7ee7a7;outline-offset:4px;border-radius:999px}

.cnpj-free,.finance-free,.monthly-cost-free{position:relative;padding:70px 0;border-bottom:1px solid #1a2e45;color:#f4f8ff}.cnpj-free{background:radial-gradient(circle at 78% 25%,rgba(20,127,232,.16),transparent 28%),linear-gradient(180deg,#06111f,#081624)}.finance-free{background:radial-gradient(circle at 20% 30%,rgba(37,155,113,.12),transparent 28%),linear-gradient(180deg,#07141f,#06101b)}.monthly-cost-free{background:radial-gradient(circle at 78% 28%,rgba(138,98,255,.12),transparent 30%),linear-gradient(180deg,#08111f,#07101b)}
.tool-shell{width:min(1160px,92vw);margin:auto}.tool-grid{display:grid;grid-template-columns:.82fr 1.18fr;gap:52px;align-items:center}.finance-grid,.monthly-cost-grid{grid-template-columns:.86fr 1.14fr}.tool-kicker{color:#5dbaff;font-size:10px;font-weight:950;letter-spacing:1.7px}.tool-copy h2{margin:9px 0 13px;font-size:clamp(31px,4vw,48px);line-height:1.04;letter-spacing:-1.5px}.tool-copy>p{margin:0;color:#94a8bd;font-size:13px;line-height:1.7}.tool-benefits{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:20px 0}.tool-benefits span{color:#d2ddea;font-size:11px;font-weight:750}.tool-copy>small{display:block;color:#657d94;font-size:9px;line-height:1.55}
.tool-card{padding:24px;border:1px solid #2a5278;border-radius:22px;background:linear-gradient(180deg,#0d2033,#081525);box-shadow:0 28px 75px rgba(0,0,0,.36)}.finance-card{border-color:#315c66;background:linear-gradient(180deg,#0c2027,#08161f)}.monthly-cost-card{border-color:#474c76;background:linear-gradient(180deg,#121b2d,#091522)}.tool-card-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:18px}.tool-card-head>div{display:flex;align-items:center;gap:9px}.tool-card-head span{font-size:24px}.tool-card-head b{font-size:17px}.tool-card-head strong{padding:7px 10px;border:1px solid #2f744f;border-radius:999px;background:#0a2d1d;color:#75dda5;font-size:9px;letter-spacing:1px}.tool-card label{display:block;color:#9db0c3;font-size:10px;font-weight:850}
.cnpj-free-row{display:grid;grid-template-columns:minmax(0,1fr) 170px;gap:9px}.cnpj-free-row input,.finance-form input,.finance-form select,.monthly-cost-form input{width:100%;height:54px;border:1px solid #d8e2eb;border-radius:12px;background:#f7f9fb;color:#111b25;outline:0;padding:0 14px;font-size:16px;font-weight:850}.cnpj-free-row input{font-size:18px;letter-spacing:1px}.cnpj-free-row input:focus,.finance-form input:focus,.finance-form select:focus,.monthly-cost-form input:focus{box-shadow:0 0 0 4px rgba(39,145,245,.18)}
.cnpj-free-row button,.tool-action-button{height:54px!important;width:100%!important;margin:0!important;border:0!important;border-radius:12px!important;background:linear-gradient(135deg,#1c98ff,#0866db)!important;color:#fff!important;font-size:11px!important;font-weight:950!important;box-shadow:0 12px 30px rgba(15,117,229,.25)!important;cursor:pointer}.cnpj-free-row button:disabled,.tool-action-button:disabled{opacity:.55;cursor:wait}.monthly-cost-button{background:linear-gradient(135deg,#6f78ff,#3d55d8)!important;box-shadow:0 12px 30px rgba(72,84,218,.24)!important}
.tool-status{min-height:18px;margin-top:8px;color:#91a5b9;font-size:10px;font-weight:750}.tool-status.is-error{color:#ffafb9}
.cnpj-free-result,.finance-result,.monthly-cost-result{margin-top:13px;padding:17px;border:1px solid #284660;border-radius:15px;background:#07121f}.cnpj-free-result-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding-bottom:13px;border-bottom:1px solid #1d3348}.cnpj-free-result-head div{display:grid;gap:3px}.cnpj-free-result-head small{color:#71879c;font-size:8px}.cnpj-free-result-head b{font-size:16px;line-height:1.25}.cnpj-free-result-head span{color:#9eb0c2;font-size:10px}.cnpj-free-status-badge{flex:0 0 auto;padding:6px 9px;border-radius:999px;background:#102a43;color:#9ed5ff;font-size:8px!important;font-weight:950}.cnpj-free-status-badge.is-active{background:#0c3020;color:#7de2aa}.cnpj-free-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:13px}.cnpj-free-field{padding:11px;border:1px solid #1c3145;border-radius:11px;background:#091827}.cnpj-free-field small{display:block;margin-bottom:3px;color:#6f8498;font-size:8px}.cnpj-free-field b{display:block;color:#dce7f2;font-size:10px;line-height:1.4}
.cnpj-free-cta,.finance-cta,.monthly-cost-cta{display:flex;align-items:center;justify-content:space-between;gap:13px;margin-top:13px;padding-top:13px;border-top:1px solid #1d3348}.cnpj-free-cta span,.finance-cta span,.monthly-cost-cta span{color:#8196aa;font-size:9px;line-height:1.45}.cnpj-free-cta a,.finance-cta a,.monthly-cost-cta a{flex:0 0 auto;padding:10px 12px;border-radius:9px;background:#168cff;color:#fff;text-decoration:none;font-size:9px;font-weight:950}
.finance-form,.monthly-cost-form{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:13px}.finance-form label,.monthly-cost-form label{display:grid;gap:7px}.finance-result-main,.monthly-cost-result-main{display:grid;grid-template-columns:1.15fr .85fr;gap:10px}.finance-result-hero,.monthly-cost-result-hero{padding:16px;border:1px solid #246079;border-radius:13px;background:linear-gradient(135deg,#0c2634,#0a1c27)}.monthly-cost-result-hero{border-color:#414e82;background:linear-gradient(135deg,#171d3b,#0c1930)}.finance-result-hero small,.monthly-cost-result-hero small{display:block;color:#7894a8;font-size:8px}.finance-result-hero strong,.monthly-cost-result-hero strong{display:block;margin-top:3px;color:#fff;font-size:28px;line-height:1}.finance-result-hero span,.monthly-cost-result-hero span{display:block;margin-top:6px;color:#8aa2b6;font-size:9px}.finance-result-side,.monthly-cost-result-side{display:grid;gap:8px}.finance-mini,.monthly-cost-mini{padding:10px;border:1px solid #1c3546;border-radius:10px;background:#091824}.monthly-cost-mini{border-color:#293550}.finance-mini small,.monthly-cost-mini small{display:block;color:#71899d;font-size:8px}.finance-mini b,.monthly-cost-mini b{display:block;margin-top:3px;color:#e3edf6;font-size:11px}.finance-note,.monthly-cost-note{margin-top:10px;color:#6f8499;font-size:8.5px;line-height:1.5}.monthly-cost-breakdown{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}.monthly-cost-breakdown .monthly-cost-mini{text-align:left}

.transparency-clear{position:relative;padding:54px 0;background:linear-gradient(180deg,#07111d,#050b13);border-bottom:1px solid #172a40;color:#f4f8ff}.transparency-clear-shell{width:min(1160px,92vw);margin:auto}.transparency-clear-head{text-align:center;max-width:760px;margin:0 auto 24px}.transparency-clear-head>span{color:#65bfff;font-size:10px;font-weight:950;letter-spacing:1.6px}.transparency-clear-head h2{margin:8px 0 9px;font-size:clamp(26px,3.6vw,40px);line-height:1.05;letter-spacing:-1px}.transparency-clear-head p{margin:0;color:#8498ae;font-size:12px;line-height:1.65}.transparency-clear-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.transparency-clear-grid article{display:flex;align-items:flex-start;gap:12px;padding:18px;border:1px solid #20364e;border-radius:15px;background:linear-gradient(180deg,#0a1827,#07131f)}.transparency-clear-icon{flex:0 0 auto;width:40px;height:40px;display:grid;place-items:center;border:1px solid #2a5c89;border-radius:11px;background:#0d2944;font-size:18px}.transparency-clear-grid article>div:last-child{display:grid;gap:5px}.transparency-clear-grid b{font-size:12px;color:#f7fbff}.transparency-clear-grid small{font-size:10px;line-height:1.55;color:#8195aa}.transparency-clear-links{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:18px;padding-top:17px;border-top:1px solid #182b40;color:#72869b;font-size:10px}.transparency-clear-links a{color:#9fd6ff;text-decoration:none;font-weight:850}.transparency-clear-links a:hover{text-decoration:underline}

@media(max-width:900px){.tool-grid,.finance-grid,.monthly-cost-grid{grid-template-columns:1fr;gap:28px}}
@media(max-width:700px){.transparency-clear{padding:42px 0}.transparency-clear-grid{grid-template-columns:1fr}.transparency-clear-grid article{padding:15px}.transparency-clear-links{justify-content:flex-start}.cnpj-free,.finance-free,.monthly-cost-free{padding:54px 0}.tool-benefits{grid-template-columns:1fr}.cnpj-free-row{grid-template-columns:1fr}.cnpj-free-fields,.finance-form,.finance-result-main,.monthly-cost-form,.monthly-cost-result-main{grid-template-columns:1fr}.monthly-cost-breakdown{grid-template-columns:1fr 1fr}.cnpj-free-cta,.finance-cta,.monthly-cost-cta{display:grid}.cnpj-free-cta a,.finance-cta a,.monthly-cost-cta a{text-align:center}}
@media(max-width:560px){.floating-whatsapp{right:13px;bottom:82px}.floating-whatsapp-icon{width:46px;height:46px;font-size:20px;box-shadow:0 8px 18px rgba(0,0,0,.24)}.floating-whatsapp-label{display:none}.transparency-clear-head{text-align:left}.transparency-clear-head h2{font-size:29px}.tool-card{padding:17px;border-radius:17px}.tool-copy h2{font-size:34px}.cnpj-free-row input{font-size:16px}.finance-result-hero strong,.monthly-cost-result-hero strong{font-size:25px}.monthly-cost-breakdown{grid-template-columns:1fr}}
</style>`;

const CNPJ_SCRIPT = `
<script id="cnpj-free-script">
(function(){
  function digits(v){return String(v||'').replace(/\\D/g,'').slice(0,14)}
  function formatCnpj(v){var d=digits(v);if(d.length<=2)return d;if(d.length<=5)return d.slice(0,2)+'.'+d.slice(2);if(d.length<=8)return d.slice(0,2)+'.'+d.slice(2,5)+'.'+d.slice(5);if(d.length<=12)return d.slice(0,2)+'.'+d.slice(2,5)+'.'+d.slice(5,8)+'/'+d.slice(8);return d.slice(0,2)+'.'+d.slice(2,5)+'.'+d.slice(5,8)+'/'+d.slice(8,12)+'-'+d.slice(12)}
  function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]})}
  function dateBr(v){if(!v)return 'Não informado';var p=String(v).split('-');return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:String(v)}
  function value(v){return v===null||v===undefined||String(v).trim()===''?'Não informado':String(v)}
  function setStatus(text,error){var s=document.getElementById('cnpj-free-status');if(!s)return;s.textContent=text||'';s.className='tool-status'+(error?' is-error':'')}
  async function consultar(){
    var input=document.getElementById('cnpj-free-input'),btn=document.getElementById('cnpj-free-button'),result=document.getElementById('cnpj-free-result'),cnpj=digits(input&&input.value);
    if(cnpj.length!==14){setStatus('Digite um CNPJ válido com 14 números.',true);if(result)result.hidden=true;return}
    setStatus('Consultando dados cadastrais...',false);if(result)result.hidden=true;if(btn){btn.disabled=true;btn.textContent='CONSULTANDO...'}
    var controller=new AbortController(),timer=setTimeout(function(){controller.abort()},12000);
    try{
      var r=await fetch('https://brasilapi.com.br/api/cnpj/v1/'+encodeURIComponent(cnpj),{headers:{'Accept':'application/json'},signal:controller.signal});
      if(!r.ok){if(r.status===404)throw new Error('CNPJ não encontrado.');throw new Error('Não foi possível consultar esse CNPJ agora.')}
      var d=await r.json(),fantasia=value(d.nome_fantasia),razao=value(d.razao_social),situacao=value(d.descricao_situacao_cadastral),ativo=/ATIVA/i.test(situacao),local=[value(d.municipio),value(d.uf)].filter(function(x){return x!=='Não informado'}).join(' / ')||'Não informado',html='';
      html+='<div class="cnpj-free-result-head"><div><small>EMPRESA ENCONTRADA</small><b>'+esc(fantasia==='Não informado'?razao:fantasia)+'</b><span>'+esc(razao)+'</span></div><span class="cnpj-free-status-badge'+(ativo?' is-active':'')+'">'+esc(situacao)+'</span></div>';
      html+='<div class="cnpj-free-fields"><div class="cnpj-free-field"><small>CNPJ</small><b>'+esc(formatCnpj(cnpj))+'</b></div><div class="cnpj-free-field"><small>Matriz / filial</small><b>'+esc(value(d.descricao_identificador_matriz_filial))+'</b></div><div class="cnpj-free-field"><small>Atividade principal</small><b>'+esc(value(d.cnae_fiscal_descricao))+'</b></div><div class="cnpj-free-field"><small>Localidade</small><b>'+esc(local)+'</b></div><div class="cnpj-free-field"><small>Início da atividade</small><b>'+esc(dateBr(d.data_inicio_atividade))+'</b></div><div class="cnpj-free-field"><small>Natureza jurídica</small><b>'+esc(value(d.natureza_juridica))+'</b></div></div>';
      html+='<div class="cnpj-free-cta"><span>Vai comprar um veículo dessa loja ou revenda? Consulte também o histórico do veículo antes de fechar negócio.</span><a href="#consulta">CONSULTAR VEÍCULO · R$ 18,90</a></div>';
      result.innerHTML=html;result.hidden=false;setStatus('Consulta concluída. Dados cadastrais públicos.',false);if(typeof window.cvTrack==='function')window.cvTrack('cnpj_consulta_realizada');
    }catch(e){var msg=e&&e.name==='AbortError'?'A consulta demorou mais que o esperado. Tente novamente.':(e&&e.message?e.message:'Não foi possível consultar o CNPJ agora.');setStatus(msg,true);if(result)result.hidden=true}
    finally{clearTimeout(timer);if(btn){btn.disabled=false;btn.textContent='CONSULTAR CNPJ'}}
  }
  document.addEventListener('DOMContentLoaded',function(){
    var input=document.getElementById('cnpj-free-input'),btn=document.getElementById('cnpj-free-button');if(input){input.addEventListener('input',function(){this.value=formatCnpj(this.value)});input.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();consultar()}})}if(btn)btn.addEventListener('click',consultar);
    var nav=document.querySelector('.cv-links');if(nav&&!nav.querySelector('a[href="#cnpj-gratis"]')){var a=document.createElement('a');a.href='#cnpj-gratis';a.textContent='Consultar CNPJ';var contato=nav.querySelector('a[href="/contato.html"]');nav.insertBefore(a,contato||null)}
  });
})();
</script>`;

const FINANCE_SCRIPT = `
<script id="finance-free-script">
(function(){
  function parseMoney(v){var s=String(v||'').trim().replace(/R\\$/gi,'').replace(/\\s/g,'');if(!s)return 0;if(s.indexOf(',')>=0)s=s.replace(/\\./g,'').replace(',','.');else if((s.match(/\\./g)||[]).length>1)s=s.replace(/\\./g,'');s=s.replace(/[^0-9.-]/g,'');var n=Number(s);return Number.isFinite(n)?n:0}
  function parseRate(v){var n=Number(String(v||'').trim().replace(',','.').replace(/[^0-9.-]/g,''));return Number.isFinite(n)?n:0}
  function brl(v){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v)}
  function pct(v){return new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v)+'% a.m.'}
  function setStatus(text,error){var s=document.getElementById('finance-status');if(!s)return;s.textContent=text||'';s.className='tool-status'+(error?' is-error':'')}
  function calcular(){
    var value=parseMoney(document.getElementById('finance-value')&&document.getElementById('finance-value').value),down=parseMoney(document.getElementById('finance-down')&&document.getElementById('finance-down').value),months=Number(document.getElementById('finance-months')&&document.getElementById('finance-months').value),rate=parseRate(document.getElementById('finance-rate')&&document.getElementById('finance-rate').value),result=document.getElementById('finance-result');
    if(value<=0){setStatus('Informe o valor do veículo.',true);if(result)result.hidden=true;return}if(down<0||down>=value){setStatus('A entrada deve ser menor que o valor do veículo.',true);if(result)result.hidden=true;return}if(!months||months<1||months>84){setStatus('Escolha um prazo válido.',true);if(result)result.hidden=true;return}if(rate<0||rate>15){setStatus('Informe uma taxa mensal entre 0% e 15%.',true);if(result)result.hidden=true;return}
    var financed=value-down,i=rate/100,payment=i===0?financed/months:(financed*i*Math.pow(1+i,months))/(Math.pow(1+i,months)-1),installmentsTotal=payment*months,interest=Math.max(0,installmentsTotal-financed),grand=down+installmentsTotal;
    var html='<div class="finance-result-main"><div class="finance-result-hero"><small>PARCELA ESTIMADA</small><strong>'+brl(payment)+'</strong><span>'+months+'x · '+pct(rate)+'</span></div><div class="finance-result-side"><div class="finance-mini"><small>Valor financiado</small><b>'+brl(financed)+'</b></div><div class="finance-mini"><small>Juros estimados</small><b>'+brl(interest)+'</b></div><div class="finance-mini"><small>Total estimado pago</small><b>'+brl(grand)+'</b></div></div></div>';
    html+='<div class="finance-note">Estimativa pelo sistema de parcelas fixas (Tabela Price). Não inclui CET, IOF, tarifas, seguros, serviços agregados ou condições específicas da instituição financeira.</div><div class="finance-cta"><span>Antes de financiar, consulte o histórico do veículo que pretende comprar.</span><a href="#consulta">CONSULTAR VEÍCULO · R$ 18,90</a></div>';
    result.innerHTML=html;result.hidden=false;setStatus('Simulação calculada. Compare sempre com o CET informado pela financeira.',false);if(typeof window.cvTrack==='function')window.cvTrack('financiamento_simulado',{value_vehicle:Math.round(value),down_payment:Math.round(down),installments:months,monthly_rate:rate});
  }
  document.addEventListener('DOMContentLoaded',function(){var btn=document.getElementById('finance-button');if(btn)btn.addEventListener('click',calcular);['finance-value','finance-down','finance-rate'].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();calcular()}})});var nav=document.querySelector('.cv-links');if(nav&&!nav.querySelector('a[href="#simulador-financiamento"]')){var a=document.createElement('a');a.href='#simulador-financiamento';a.textContent='Financiamento';var contato=nav.querySelector('a[href="/contato.html"]');nav.insertBefore(a,contato||null)}});
})();
</script>`;

const MONTHLY_COST_SCRIPT = `
<script id="monthly-cost-script">
(function(){
  function parseNumber(v){var s=String(v||'').trim().replace(/R\\$/gi,'').replace(/\\s/g,'');if(!s)return 0;if(s.indexOf(',')>=0)s=s.replace(/\\./g,'').replace(',','.');else if((s.match(/\\./g)||[]).length>1)s=s.replace(/\\./g,'');s=s.replace(/[^0-9.-]/g,'');var n=Number(s);return Number.isFinite(n)?n:0}
  function brl(v){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v)}
  function setStatus(text,error){var s=document.getElementById('monthly-cost-status');if(!s)return;s.textContent=text||'';s.className='tool-status'+(error?' is-error':'')}
  function get(id){var el=document.getElementById(id);return parseNumber(el&&el.value)}
  function calcular(){
    var km=get('monthly-km'),consumption=get('monthly-consumption'),fuelPrice=get('monthly-fuel-price'),insurance=get('monthly-insurance'),maintenance=get('monthly-maintenance'),ipva=get('monthly-ipva'),financing=get('monthly-financing'),other=get('monthly-other'),result=document.getElementById('monthly-cost-result');
    if(km<=0){setStatus('Informe quantos quilômetros você roda por mês.',true);if(result)result.hidden=true;return}
    if(consumption<=0){setStatus('Informe o consumo médio do veículo em km/L.',true);if(result)result.hidden=true;return}
    if(fuelPrice<=0){setStatus('Informe o preço do combustível por litro.',true);if(result)result.hidden=true;return}
    if(km>20000||consumption>100||fuelPrice>50){setStatus('Confira os valores informados para km, consumo e combustível.',true);if(result)result.hidden=true;return}
    var values=[insurance,maintenance,ipva,financing,other];if(values.some(function(v){return v<0||v>1000000})){setStatus('Confira os valores dos demais custos.',true);if(result)result.hidden=true;return}
    var fuel=(km/consumption)*fuelPrice,monthlyInsurance=insurance/12,monthlyMaintenance=maintenance/12,monthlyIpva=ipva/12,total=fuel+monthlyInsurance+monthlyMaintenance+monthlyIpva+financing+other,annual=total*12,costPerKm=total/km;
    var html='<div class="monthly-cost-result-main"><div class="monthly-cost-result-hero"><small>CUSTO MENSAL ESTIMADO</small><strong>'+brl(total)+'</strong><span>'+brl(annual)+' por ano · '+brl(costPerKm)+' por km</span></div><div class="monthly-cost-result-side"><div class="monthly-cost-mini"><small>Combustível / mês</small><b>'+brl(fuel)+'</b></div><div class="monthly-cost-mini"><small>Custos anuais rateados / mês</small><b>'+brl(monthlyInsurance+monthlyMaintenance+monthlyIpva)+'</b></div><div class="monthly-cost-mini"><small>Financiamento + outros / mês</small><b>'+brl(financing+other)+'</b></div></div></div>';
    html+='<div class="monthly-cost-breakdown"><div class="monthly-cost-mini"><small>Seguro mensalizado</small><b>'+brl(monthlyInsurance)+'</b></div><div class="monthly-cost-mini"><small>Manutenção mensalizada</small><b>'+brl(monthlyMaintenance)+'</b></div><div class="monthly-cost-mini"><small>IPVA mensalizado</small><b>'+brl(monthlyIpva)+'</b></div></div>';
    html+='<div class="monthly-cost-note">Estimativa baseada nos valores informados. Não inclui depreciação do veículo, multas, imprevistos ou despesas que não tenham sido preenchidas.</div><div class="monthly-cost-cta"><span>Está avaliando comprar esse veículo? Consulte o histórico antes de fechar negócio.</span><a href="#consulta">CONSULTAR VEÍCULO · R$ 18,90</a></div>';
    result.innerHTML=html;result.hidden=false;setStatus('Cálculo concluído com base nos valores informados.',false);if(typeof window.cvTrack==='function')window.cvTrack('custo_mensal_calculado',{monthly_cost:Math.round(total),monthly_km:Math.round(km),fuel_cost:Math.round(fuel)});
  }
  document.addEventListener('DOMContentLoaded',function(){var btn=document.getElementById('monthly-cost-button');if(btn)btn.addEventListener('click',calcular);['monthly-km','monthly-consumption','monthly-fuel-price','monthly-insurance','monthly-maintenance','monthly-ipva','monthly-financing','monthly-other'].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();calcular()}})});});
})();
</script>`;

function waitForPort(port, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => { socket.destroy(); if (Date.now() - started >= timeoutMs) reject(new Error('Aplicação interna não iniciou a tempo.')); else setTimeout(tryConnect, 200); });
    };
    tryConnect();
  });
}

function proxy(req, res, injectHome) {
  const headers = { ...req.headers, host: `127.0.0.1:${INNER_PORT}` };
  if (injectHome) headers['accept-encoding'] = 'identity';
  const upstream = http.request({ hostname: '127.0.0.1', port: INNER_PORT, path: req.url, method: req.method, headers }, upstreamRes => {
    if (!injectHome) { res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers); upstreamRes.pipe(res); return; }
    const type = String(upstreamRes.headers['content-type'] || '');
    if (!type.includes('text/html')) { res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers); upstreamRes.pipe(res); return; }
    const chunks = []; let size = 0;
    upstreamRes.on('data', chunk => { size += chunk.length; if (size <= MAX_HTML_BYTES) chunks.push(chunk); });
    upstreamRes.on('end', () => {
      if (size > MAX_HTML_BYTES) { res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Página excedeu o limite de renderização.'); return; }
      let html = Buffer.concat(chunks).toString('utf8');
      if (!html.includes('id="floating-whatsapp-style"')) html = html.replace('</head>', `${WHATSAPP_CSS}\n</head>`);
      const resultMarker = '<div id="cv-result" class="cv-result"></div>';
      if (html.includes(resultMarker)) {
        const pieces = [];
        if (!html.includes('id="cnpj-gratis"')) pieces.push(CNPJ_HTML);
        if (!html.includes('id="simulador-financiamento"')) pieces.push(FINANCE_HTML);
        if (!html.includes('id="custo-mensal"')) pieces.push(MONTHLY_COST_HTML);
        if (!html.includes('id="transparencia-clara"')) pieces.push(TRANSPARENCY_HTML);
        if (pieces.length) html = html.replace(resultMarker, `${pieces.join('\n')}\n${resultMarker}`);
      }
      if (!html.includes('id="cnpj-free-script"')) html = html.replace('</body>', `${CNPJ_SCRIPT}\n</body>`);
      if (!html.includes('id="finance-free-script"')) html = html.replace('</body>', `${FINANCE_SCRIPT}\n</body>`);
      if (!html.includes('id="monthly-cost-script"')) html = html.replace('</body>', `${MONTHLY_COST_SCRIPT}\n</body>`);
      if (!html.includes('id="floating-whatsapp"')) html = html.replace('</body>', `${WHATSAPP_HTML}\n</body>`);
      const body = Buffer.from(html, 'utf8');
      const out = { ...upstreamRes.headers, 'content-length': String(body.length), 'cache-control': 'no-store, no-cache, must-revalidate, max-age=0' };
      delete out['content-encoding']; delete out['transfer-encoding']; res.writeHead(upstreamRes.statusCode || 200, out); res.end(body);
    });
  });
  upstream.on('error', err => { console.error('WHATSAPP_PROXY:', err.message); if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: 'servico_indisponivel' })); } });
  req.pipe(upstream);
}

async function start() {
  const child = fork(require.resolve('./payment-proxy.js'), [], { env: { ...process.env, PORT: String(INNER_PORT) }, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
  child.on('exit', code => { console.error(`WHATSAPP_PROXY: aplicação interna encerrou (código ${code}).`); process.exit(code || 1); });
  try { await waitForPort(INNER_PORT); } catch (err) { console.error('WHATSAPP_PROXY:', err.message); process.exit(1); }
  const server = http.createServer((req, res) => { const pathname = new URL(req.url, 'http://localhost').pathname; const isHome = req.method === 'GET' && (pathname === '/' || pathname === '/index.html'); proxy(req, res, isHome); });
  server.listen(PUBLIC_PORT, () => console.log(`WhatsApp, CNPJ, simuladores e transparência ativos na porta ${PUBLIC_PORT}`));
}

start();
