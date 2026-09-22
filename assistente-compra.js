"use strict";
/* Assistente de Compra 360: interface local orientativa.
   Não consulta APIs, não gera cobranças nem declara que um veículo é seguro para comprar. */
var AssistenteCompra = (function () {
  var guideTasks = [
    {group:"preparar",id:"anuncio",title:"Salvar o anúncio, o valor pedido e os dados do vendedor"},
    {group:"preparar",id:"placa",title:"Conferir se a placa e os dados informados correspondem ao veículo"},
    {group:"preparar",id:"documentos",title:"Solicitar documentação atualizada antes de viajar"},
    {group:"preparar",id:"historico",title:"Pedir histórico de manutenção, revisões e reparos, se houver"},
    {group:"preparar",id:"vistoria",title:"Agendar vistoria cautelar e avaliação mecânica independentes"},
    {group:"preparar",id:"contato",title:"Confirmar endereço, horário e condições da visita"},
    {group:"visita",id:"identificacao",title:"Conferir chassi, placa e documentação do veículo"},
    {group:"visita",id:"carroceria",title:"Examinar pintura, estrutura aparente e alinhamento da carroceria"},
    {group:"visita",id:"vidros",title:"Verificar vidros, etiquetas e sinais de substituição"},
    {group:"visita",id:"pneus",title:"Conferir pneus, estepe, macaco e chave de roda"},
    {group:"visita",id:"vazamentos",title:"Observar vazamentos, fumaça ou ruídos anormais"},
    {group:"visita",id:"eletrica",title:"Testar faróis, setas, travas, vidros e painel"},
    {group:"visita",id:"ar",title:"Testar ar-condicionado e ventilação"},
    {group:"visita",id:"quilometragem",title:"Comparar quilometragem com o histórico de manutenção"},
    {group:"visita",id:"chaves",title:"Verificar chave reserva e manual, quando anunciados"},
    {group:"visita",id:"teste",title:"Realizar teste de rodagem autorizado, quando possível"},
    {group:"visita",id:"mecanico",title:"Submeter motor, freios, suspensão e estrutura a profissionais independentes"},
    {group:"visita",id:"laudo",title:"Conferir laudo cautelar, se disponível, e verificar sua autenticidade"},
    {group:"negociar",id:"confirmar",title:"Esclarecer os alertas e itens sem informação do relatório"},
    {group:"negociar",id:"custos",title:"Solicitar comprovantes de débitos, manutenção e reparos relevantes"},
    {group:"negociar",id:"proposta",title:"Registrar por escrito o preço e as condições combinadas"},
    {group:"negociar",id:"pagamento",title:"Validar vendedor, titularidade e documentos antes de qualquer pagamento"},
    {group:"depois",id:"atpve",title:"Confirmar os documentos necessários à transferência, inclusive ATPV-e quando aplicável"},
    {group:"depois",id:"detran",title:"Consultar as orientações e os prazos vigentes do Detran do seu estado"},
    {group:"depois",id:"transferencia",title:"Providenciar transferência e confirmar atualização do registro"},
    {group:"depois",id:"seguro",title:"Revisar as opções de seguro conforme seu uso e necessidade"},
    {group:"depois",id:"recall",title:"Consultar campanhas de recall pendentes em canais oficiais"},
    {group:"depois",id:"revisao",title:"Programar revisão preventiva e guardar comprovantes de serviços"},
    {group:"depois",id:"arquivo",title:"Arquivar contrato, recibos, laudos e demais documentos da compra"}
  ];
  var labels={
    theft:["Roubo ou furto","Peça um documento oficial atualizado sobre a situação de roubo/furto e esclareça qualquer ocorrência."],
    auction:["Leilão","Pergunte sobre eventual passagem por leilão e peça documentação ou laudo cautelar."],
    accidentClaim:["Sinistro","Solicite histórico de sinistro, reparos e laudo estrutural, quando aplicável."],
    lien:["Gravame","Peça comprovante da quitação e da baixa de eventual gravame."],
    renajud:["RENAJUD","Solicite certidão ou consulta oficial atualizada sobre restrições judiciais."],
    renainf:["Multas e infrações","Solicite comprovantes de multas e consulte a situação atualizada nos órgãos competentes."],
    ipvaPending:["IPVA","Solicite documentos e comprovantes da situação atual do IPVA."],
    recall:["Recall","Peça comprovante de atendimento dos recalls, caso existam campanhas registradas."]
  };
  var mapping=[
    ["roubo_furto","theft"],["leilao","auction"],["sinistro","accidentClaim"],["gravame","lien"],
    ["renajud","renajud"],["multas","renainf"],["ipva","ipvaPending"],["recall","recall"]
  ];
  var money=new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"});
  function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(x){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x];});}
  function status(v,report,id,key){
    var alerts=report&&Array.isArray(report.alerts)?report.alerts:[];
    var a=alerts.find(function(item){return item.id===id;});
    if(a)return a.status==="atencao"?"attention":a.status==="sem_ocorrencia_retornada"?"no_record":"unknown";
    var b=v&&v.indicators&&v.indicators[key];
    return b===true?"attention":b===false?"no_record":"unknown";
  }
  function reportFor(v,options){return options&&options.report360||v&&v.report360||{};}
  function reportAlerts(v,opt){
    var report=reportFor(v,opt);
    return mapping.map(function(pair){return {id:pair[0],key:pair[1],title:labels[pair[1]][0],question:labels[pair[1]][1],status:status(v,report,pair[0],pair[1])};});
  }
  function formatFipe(v){
    var f=v&&v.fipe||{},n=null;
    if(typeof f.numericValue==="number"&&isFinite(f.numericValue)&&f.numericValue>0)n=f.numericValue;
    else if(f.numericValue&&/^\d+(\.\d+)?$/.test(String(f.numericValue)))n=Number(f.numericValue);
    else if(f.value)n=parsePrice(f.value);
    return n&&n>0?n:null;
  }
  function parsePrice(raw){
    if(typeof raw==="number")return raw>0&&isFinite(raw)?raw:null;
    var s=String(raw||"").trim().replace(/[^\d.,]/g,"");
    if(!s)return null;
    if(s.includes(","))s=s.replace(/\./g,"").replace(",",".");
    else if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,"");
    var n=Number(s);
    return isFinite(n)&&n>0?n:null;
  }
  function storageKey(v,opt) {
    if(opt&&opt.demo)return "";
    var id=String(opt&&opt.reportId||"").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,80);
    var plate=String(v&&v.plate||"").replace(/[^A-Z0-9]/gi,"").toUpperCase().slice(0,7);
    return id||plate?"cv_guia_compra_v1_"+(id||plate):"";
  }
  function saved(key){
    if(!key)return {};
    try{
      var result=JSON.parse(localStorage.getItem(key)||"{}");
      if(!result||typeof result!=="object"||Array.isArray(result))return {};
      var cleaned={};
      guideTasks.forEach(function(task){if(result[task.id]===true)cleaned[task.id]=true;});
      return cleaned;
    }catch(e){return {};}
  }
  function taskList(group,completed){
    return guideTasks.filter(function(t){return t.group===group;}).map(function(t){
      return '<label class="ac360-task"><input type="checkbox" data-ac360-task="'+esc(t.id)+'" '+(completed[t.id]?'checked':'')+'><span>'+esc(t.title)+'</span></label>';
    }).join("");
  }
  function questions(alerts){
    var attention=alerts.filter(function(x){return x.status==="attention";});
    var unknown=alerts.filter(function(x){return x.status==="unknown";});
    var html=attention.map(function(x){return '<li><strong>'+esc(x.title)+':</strong> '+esc(x.question)+'</li>';}).join("");
    if(unknown.length)html+='<li><strong>Dados não informados:</strong> peça documentação sobre '+esc(unknown.map(function(x){return x.title.toLowerCase();}).join(", "))+'. Ausência de retorno não comprova ausência de ocorrência.</li>';
    html+='<li>Você é o titular do veículo ou possui autorização verificável para vendê-lo?</li>';
    html+='<li>Você autoriza uma vistoria cautelar e uma avaliação mecânica independentes?</li>';
    html+='<li>Há notas de manutenção, laudos ou reparos importantes que eu deva conhecer?</li>';
    return html;
  }
  function docList(){
    return '<ul class="ac360-docs">'+[
      "CRLV-e e identificação de quem está vendendo, conforme a situação do veículo",
      "Consulta oficial atualizada de débitos e restrições",
      "Documentação de transferência e, quando aplicável, ATPV-e",
      "Laudo cautelar e histórico de revisões, se disponíveis",
      "Comprovantes de reparos importantes e atendimento de recalls",
      "Comprovantes de quitação de financiamentos ou outros ônus, se houver"
    ].map(function(x){return "<li>"+esc(x)+"</li>";}).join("")+"</ul>";
  }
  function panel(id,heading,intro,body,active,uid){
    return '<section id="'+esc(uid)+"-"+esc(id)+'" class="ac360-panel" data-ac360-panel="'+id+'" role="tabpanel" aria-label="'+esc(heading)+'" '+(active?'':'hidden')+'><h3>'+esc(heading)+'</h3><p>'+esc(intro)+'</p>'+body+'</section>';
  }
  function summary(alerts){
    var count=alerts.filter(function(x){return x.status==="attention";}).length;
    var missing=alerts.filter(function(x){return x.status==="unknown";}).length;
    return '<div class="ac360-summary"><div><span>Indicadores a conferir</span><strong>'+count+'</strong></div><div><span>Informações não disponíveis</span><strong>'+missing+'</strong></div><div><span>Checklist concluído</span><strong data-ac360-progress>0/'+guideTasks.length+'</strong></div></div>';
  }
  function renderHTML(vehicle,options){
    var v=vehicle&&typeof vehicle==="object"?vehicle:{},opt=options||{},alerts=reportAlerts(v,opt),key=storageKey(v,opt),done=saved(key);
    var plate=String(v.plate||"").replace(/[^a-zA-Z0-9]/g,"").toUpperCase().slice(0,7);
    var model=[v.brand,v.model].filter(Boolean).join(" · ");
    var fipe=formatFipe(v);
    var id=String(opt.id||"ac360-main").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,60);
    var statusInfo=alerts.map(function(a){
      var text=a.status==="attention"?"Conferir":a.status==="no_record"?"Sem registro retornado":"Não informado";
      return '<li class="ac360-status ac360-status-'+a.status+'"><span>'+esc(a.title)+'</span><strong>'+text+'</strong></li>';
    }).join("");
    var steps=[
      ["preparar","1. Antes da visita"],["visita","2. Durante a visita"],
      ["negociar","3. Negociação"],["depois","4. Depois da compra"]
    ];
    var tabs=steps.map(function(item,idx){
      return '<button type="button" role="tab" data-ac360-tab="'+item[0]+'" aria-controls="'+id+'-'+item[0]+'" aria-selected="'+(idx===0?'true':'false')+'" class="'+(idx===0?"ac360-active":"")+'">'+item[1]+'</button>';
    }).join("");
    var before='<h4>Resumo dos indicadores retornados</h4><ul class="ac360-status-grid">'+statusInfo+'</ul>'+
      '<h4>Perguntas personalizadas para o vendedor</h4><ul class="ac360-questions">'+questions(alerts)+'</ul>'+
      '<h4>Documentos que vale solicitar</h4>'+docList()+
      '<h4>Checklist de preparação</h4><div class="ac360-task-grid">'+taskList("preparar",done)+'</div>';
    var visit='<div class="ac360-note">Use este roteiro durante a visita. Ele não substitui avaliação mecânica ou vistoria cautelar independente.</div>'+
      '<div class="ac360-task-grid">'+taskList("visita",done)+'</div>'+
      '<label class="ac360-notes-label">Anotações da visita (ficam apenas nesta página)<textarea data-ac360-notes="visita" rows="3" placeholder="Ex.: pneus gastos, revisão pendente, dúvidas para o mecânico"></textarea></label>';
    var price='<div class="ac360-price">'+
      '<div class="ac360-fipe"><span>FIPE retornada pela fonte</span><strong>'+(fipe?esc(money.format(fipe)):"Não informada")+'</strong></div>'+
      '<label>Preço anunciado (opcional)<input type="text" inputmode="decimal" data-ac360-price="pedido" placeholder="Ex.: 54.900,00"></label>'+
      '<label>Preço proposto (opcional)<input type="text" inputmode="decimal" data-ac360-price="proposta" placeholder="Ex.: 52.000,00"></label>'+
      '<div data-ac360-difference class="ac360-price-result">'+(fipe?"Informe o preço anunciado para comparar com a referência FIPE.":"A FIPE não foi retornada nesta consulta.")+'</div>'+
      '<small>Comparações ilustram diferenças de valor, não determinam o preço justo nem garantem as condições do carro.</small></div>';
    var negotiation='<h4>Conversa sobre preço e condições</h4>'+price+
      '<h4>Antes de qualquer pagamento</h4><div class="ac360-task-grid">'+taskList("negociar",done)+'</div>'+
      '<label class="ac360-notes-label">Condições acertadas (ficam apenas nesta página)<textarea data-ac360-notes="negociar" rows="3" placeholder="Ex.: incluir vistoria, prazo para documentos, revisões combinadas"></textarea></label>'+
      '<a class="ac360-compare" href="/minhas-consultas.html#comparar">Comparar com outros veículos já consultados →</a>';
    var after='<div class="ac360-note">Os requisitos e prazos de transferência dependem do estado e da situação do veículo. Confirme as regras nos órgãos competentes.</div>'+
      '<div class="ac360-task-grid">'+taskList("depois",done)+'</div>'+
      '<h4>Guarde seus documentos</h4><p>Organize comprovantes de pagamento, contrato, comprovantes de transferência, laudos e notas de serviços em local seguro.</p>'+
      '<a class="ac360-compare" href="https://www.gov.br/pt-br/servicos/consultar-dados-de-veiculo-na-base-renavam" target="_blank" rel="noopener noreferrer">Consultar serviços oficiais do veículo ↗</a>';
    var body=panel("preparar","Prepare sua visita","Saiba o que conferir no relatório e o que perguntar antes de sair de casa.",before,true,id)+
      panel("visita","Inspecione com atenção","Siga o checklist no celular e marque o que já conferiu.",visit,false,id)+
      panel("negociar","Negocie com informações","Compare a FIPE com o anúncio e registre as condições, sem promessas sobre o valor de mercado.",negotiation,false,id)+
      panel("depois","Organize os próximos passos","Confira documentos, transferência, seguro e manutenção após fechar negócio.",after,false,id);
    return '<section class="ac360-guide" data-ac360-key="'+esc(key)+'" data-ac360-fipe="'+(fipe||"")+'"'+(opt.demo?' data-ac360-demo="true"':'')+' aria-label="Assistente de Compra 360">'+
      (opt.demo?'<div class="ac360-demo-banner"><strong>DEMONSTRAÇÃO</strong> · Placa, FIPE e alertas fictícios. Nenhuma consulta ou crédito utilizado.</div>':'')+
      '<div class="ac360-heading"><span class="ac360-eyebrow">ASSISTENTE DE COMPRA 360</span><h2>Da consulta à negociação, tudo em um só lugar.</h2>'+
      '<p>'+(plate?'Guia para a placa <strong>'+esc(plate)+'</strong>'+(model?' · '+esc(model):'')+'. ':"")+'Prepare sua visita, confira os alertas, negocie e organize o pós-compra.</p>'+summary(alerts)+'</div>'+
      '<div class="ac360-tabs" role="tablist" aria-label="Etapas da compra">'+tabs+'</div>'+
      '<div class="ac360-panels">'+body+'</div>'+
      '<div class="ac360-guide-footer"><span data-ac360-save-note>As marcações são salvas apenas neste dispositivo; preços e anotações não são armazenados.</span>'+
      '<button class="ac360-print" type="button" data-ac360-print>📄 IMPRIMIR / SALVAR GUIA EM PDF</button></div>'+
      '<p class="ac360-disclaimer">Este assistente oferece um roteiro informativo baseado no que as fontes retornaram. Não substitui documentos oficiais atualizados, vistoria independente, orientação especializada ou análise contratual.</p>'+
      '</section>';
  }
  function progress(root){
    var ticks=[].slice.call(root.querySelectorAll("input[data-ac360-task]"));
    var marked=ticks.filter(function(input){return input.checked;}).length;
    var out=root.querySelector("[data-ac360-progress]");
    if(out)out.textContent=marked+"/"+ticks.length;
    return marked;
  }
  function updatePrice(root){
    var price=root.querySelector('[data-ac360-price="pedido"]');
    var proposal=root.querySelector('[data-ac360-price="proposta"]');
    var out=root.querySelector("[data-ac360-difference]");
    if(!price||!out)return;
    var fipe=Number(root.dataset.ac360Fipe)||null,asked=parsePrice(price.value),proposed=proposal?parsePrice(proposal.value):null;
    var parts=[];
    if(asked && fipe){
      var diff=asked-fipe;
      parts.push(Math.abs(diff)<.01?"Preço anunciado igual à FIPE retornada.":money.format(Math.abs(diff))+" ("+(Math.abs(diff)/fipe*100).toFixed(1).replace(".",",")+"%) "+(diff>0?"acima":"abaixo")+" da FIPE retornada.");
    }else parts.push(fipe?"Informe o preço anunciado para comparar com a FIPE.":"Sem FIPE retornada para comparação.");
    if(asked&&proposed)parts.push("Sua proposta é "+money.format(Math.abs(asked-proposed))+(proposed<=asked?" abaixo do anúncio.":" acima do anúncio."));
    out.textContent=parts.join(" ");
  }
  function printGuide(root){
    var clone=root.cloneNode(true);
    var inputs=[].slice.call(root.querySelectorAll("input[data-ac360-task]"));
    var printInputs=[].slice.call(clone.querySelectorAll("input[data-ac360-task]"));
    inputs.forEach(function(input,i){if(printInputs[i]){if(input.checked)printInputs[i].setAttribute("checked","checked");else printInputs[i].removeAttribute("checked");}});
    var realFields=[].slice.call(root.querySelectorAll("input[data-ac360-price],textarea[data-ac360-notes]"));
    var printFields=[].slice.call(clone.querySelectorAll("input[data-ac360-price],textarea[data-ac360-notes]"));
    realFields.forEach(function(f,i){if(printFields[i]){var replacement=document.createElement("div");replacement.className="ac360-printed-value";replacement.textContent=f.value||"Não informado";printFields[i].replaceWith(replacement);}});
    var orig=root.querySelector("[data-ac360-difference]");
    var copy=clone.querySelector("[data-ac360-difference]");if(orig&&copy)copy.textContent=orig.textContent;
    clone.querySelectorAll(".ac360-panel").forEach(function(panel){panel.removeAttribute("hidden");});
    clone.querySelectorAll(".ac360-tabs,.ac360-guide-footer").forEach(function(e){e.remove();});
    var popup=window.open("","_blank");
    if(!popup){
      var note=root.querySelector("[data-ac360-save-note]");
      if(note)note.textContent="Seu navegador bloqueou a janela de impressão. Permita pop-ups e tente novamente.";
      return;
    }
    var css='body{font:12px Arial,sans-serif;color:#142a3b;margin:24px}h2{font-size:23px}h3{font-size:17px;break-after:avoid}h4{margin-bottom:7px}.ac360-guide{width:100%}.ac360-panel{display:block!important;border-top:2px solid #ced9df;margin-top:18px;padding-top:12px;break-inside:avoid}.ac360-summary{display:flex;gap:24px}.ac360-summary div{padding:8px}.ac360-summary span,.ac360-summary strong{display:block}.ac360-status-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px;list-style:none;padding:0}.ac360-status{display:flex;justify-content:space-between;gap:10px;padding:6px;border:1px solid #ddd}.ac360-task-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}.ac360-task{display:flex;gap:7px}.ac360-price label{display:block;margin:9px 0}.ac360-printed-value{font-weight:bold}.ac360-demo-banner{padding:9px;background:#ffeec9}.ac360-compare,.ac360-guide-footer{display:none}.ac360-disclaimer{border-top:1px solid #ddd;margin-top:18px;padding-top:10px;font-size:10px}@page{size:A4;margin:13mm}@media print{.ac360-panel{break-inside:auto}}';
    popup.document.open();
    popup.document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Guia de Compra 360</title><style>'+css+'</style></head><body>'+clone.outerHTML+'</body></html>');
    popup.document.close();popup.focus();
    popup.setTimeout(function(){popup.print();},300);
  }
  function mount(target,vehicle,options){
    var element=typeof target==="string"?document.getElementById(target):target;
    if(!element)return false;
    var opt=options||{},v=vehicle||{};
    element.innerHTML=renderHTML(v,opt);
    var root=element.querySelector(".ac360-guide");
    if(!root)return false;
    root.addEventListener("click",function(evt){
      var tab=evt.target.closest("[data-ac360-tab]");
      if(tab){
        var stage=tab.dataset.ac360Tab;
        root.querySelectorAll("[data-ac360-tab]").forEach(function(item){var active=item.dataset.ac360Tab===stage;item.classList.toggle("ac360-active",active);item.setAttribute("aria-selected",active?"true":"false");});
        root.querySelectorAll("[data-ac360-panel]").forEach(function(panel){panel.hidden=panel.dataset.ac360Panel!==stage;});
        return;
      }
      if(evt.target.closest("[data-ac360-print]"))printGuide(root);
    });
    root.addEventListener("change",function(evt){
      var input=evt.target.closest("input[data-ac360-task]");
      if(!input)return;
      progress(root);
      var key=root.dataset.ac360Key;if(!key)return;
      var state=saved(key);
      if(input.checked)state[input.dataset.ac360Task]=true;else delete state[input.dataset.ac360Task];
      try{localStorage.setItem(key,JSON.stringify(state));}catch(e){
        var note=root.querySelector("[data-ac360-save-note]");
        if(note)note.textContent="As marcações funcionam nesta página, mas o navegador não permitiu salvá-las neste dispositivo.";
      }
    });
    root.addEventListener("input",function(evt){
      if(evt.target.matches("[data-ac360-price]"))updatePrice(root);
    });
    progress(root);
    return true;
  }
  function demo(target){
    return mount(target,{
      plate:"ABC1D23",brand:"Veículo fictício",model:"Modelo A",modelYear:2021,
      fipe:{numericValue:52800},
      indicators:{theft:false,auction:true,recall:true}
    },{demo:true,id:"ac360-demo"});
  }
  return {renderHTML:renderHTML,mount:mount,demo:demo,parsePrice:parsePrice};
})();
window.AssistenteCompra=AssistenteCompra;
