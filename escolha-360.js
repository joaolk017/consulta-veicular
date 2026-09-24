"use strict";
/* Escolha 360: compara SOMENTE relatórios já comprados e associados à conta autenticada.
   Não chama provedores, não cria PIX e não consome créditos. */
var Escolha360 = (function () {
  var available = new Map();
  var chosen = [];
  var currency = new Intl.NumberFormat("pt-BR", {style:"currency",currency:"BRL"});
  var checks = [
    {id:"roubo_furto", label:"Roubo e furto", key:"theft", question:"Existe boletim ou documento oficial atualizado que esclareça o indicador de roubo/furto?"},
    {id:"leilao", label:"Leilão", key:"auction", question:"Há laudo cautelar e documentação sobre eventual passagem por leilão?"},
    {id:"sinistro", label:"Sinistro", key:"accidentClaim", question:"Existem laudos e comprovantes sobre eventuais sinistros e reparos?"},
    {id:"gravame", label:"Gravame", key:"lien", question:"O financiamento ou gravame foi quitado e a baixa pode ser comprovada?"},
    {id:"renajud", label:"RENAJUD", key:"renajud", question:"É possível apresentar consulta oficial atualizada sobre restrições judiciais?"},
    {id:"multas", label:"Multas / RENAINF", key:"renainf", question:"Você pode apresentar consulta oficial e comprovantes de quitação das multas?"},
    {id:"ipva", label:"IPVA", key:"ipvaPending", question:"O IPVA está em dia? Há comprovantes atualizados?"},
    {id:"recall", label:"Recall", key:"recall", question:"Existem campanhas de recall e comprovantes de atendimento, quando aplicável?"}
  ];
  function el(id){return document.getElementById(id);}
  function esc(x){return String(x == null ? "" : x).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function money(n){return currency.format(n);}
  function readableDate(raw) {
    if(!raw)return "Data não informada";
    var d=new Date(raw);return isNaN(d.getTime())?"Data não informada":d.toLocaleDateString("pt-BR");
  }
  function getStatus(d, field){
    var r=d.report360 || d.vehicle && d.vehicle.report360 || {};
    var arr=Array.isArray(r.alerts)?r.alerts:[];
    var item=arr.find(function(x){return x.id===field.id;});
    if(item) {
      if(item.status==="atencao")return "attention";
      if(item.status==="sem_ocorrencia_retornada")return "no_record";
      return "unknown";
    }
    var v=d.vehicle||{},i=v.indicators||{};
    return i[field.key]===true?"attention":i[field.key]===false?"no_record":"unknown";
  }
  function statusTag(status){
    return status==="attention" ? '<span class="c360-tag c360-alert">Conferir</span>' :
      status==="no_record" ? '<span class="c360-tag c360-clear">Sem registro retornado</span>' :
      '<span class="c360-tag c360-unknown">Não informado</span>';
  }
  function fipeValue(vehicle){
    var f=vehicle&&vehicle.fipe||{};
    if(typeof f.numericValue==="number"&&isFinite(f.numericValue)&&f.numericValue>0)return f.numericValue;
    if(typeof f.numericValue==="string"&&/^\d+(\.\d+)?$/.test(f.numericValue.trim()))return Number(f.numericValue);
    return parseMoney(f.value);
  }
  function parseMoney(raw){
    if(typeof raw==="number")return isFinite(raw)&&raw>0?raw:null;
    var s=String(raw||"").trim().replace(/[^\d,.-]/g,"");
    if(!s)return null;
    if(s.indexOf(",")>=0)s=s.replace(/\./g,"").replace(",",".");
    else if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,"");
    var n=Number(s);
    return isFinite(n)&&n>0?n:null;
  }
  function accountToken(){
    try{return localStorage.getItem("cv_credit_account")||"";}catch(e){return "";}
  }
  function message(msg,isError){
    var box=el("c360Message");if(box)box.innerHTML=msg?'<div class="'+(isError?"error":"info")+'">'+esc(msg)+"</div>":"";
  }
  function updateBar(){
    if(el("c360Selected"))el("c360Selected").textContent=chosen.length+" de 3 veículos selecionados";
    if(el("c360CompareBtn"))el("c360CompareBtn").disabled=chosen.length<2||chosen.length>3;
    if(el("c360Hint"))el("c360Hint").textContent=available.size<2 ?
      "Você precisa de pelo menos dois relatórios liberados nesta conta para comparar. A comparação não cobra outra consulta." :
      chosen.length<2?"Marque dois ou três relatórios no histórico logo abaixo.":
      chosen.length===3?"Limite de três veículos atingido.":"Você pode selecionar mais um veículo, se quiser.";
  }
  function isChosen(id){return chosen.indexOf(String(id))>=0;}
  function sync(rows){
    available=new Map((rows||[]).filter(function(q){return q.status==="completed"&&q.relatorio_disponivel;}).map(function(q){return [String(q.id),q];}));
    chosen=chosen.filter(function(id){return available.has(id);});
    updateBar();
  }
  function toggle(node){
    var id=String(node&&node.dataset&&node.dataset.compareId||"");
    if(!available.has(id)){node.checked=false;return;}
    if(node.checked){
      if(chosen.length>=3){
        node.checked=false;message("Selecione no máximo três veículos.",true);return;
      }
      if(!isChosen(id))chosen.push(id);
    }else chosen=chosen.filter(function(x){return x!==id;});
    message("");updateBar();
  }
  function renderQuestions(d){
    var questions=checks.filter(function(f){return getStatus(d,f)==="attention";}).map(function(f){return f.question;});
    var unknown=checks.filter(function(f){return getStatus(d,f)==="unknown";});
    if(unknown.length) questions.push("Para os itens não informados ("+unknown.map(function(f){return f.label;}).join(", ")+"), solicite documentos e confirme nos canais oficiais.");
    questions.push("O vendedor autoriza vistoria mecânica e cautelar independente antes do pagamento?");
    questions.push("O número do chassi, os documentos e a identidade do vendedor conferem?");
    return questions.slice(0,6).map(function(q){return "<li>"+esc(q)+"</li>";}).join("");
  }
  function priceBlock(d){
    var v=d.vehicle||{},val=fipeValue(v);
    var id=String(d.consulta&&d.consulta.id||"");
    return '<div class="c360-pricing">'+
      '<div class="c360-fipe"><span>Referência FIPE retornada</span><strong>'+(val?esc(money(val)):"Não informada")+'</strong></div>'+
      '<label class="c360-price-label" for="c360-price-'+esc(id)+'">Preço anunciado (opcional)</label>'+
      '<input id="c360-price-'+esc(id)+'" class="c360-price-input" data-price-id="'+esc(id)+'" inputmode="decimal" autocomplete="off" placeholder="Ex.: 54.900,00" aria-label="Preço anunciado da placa '+esc(v.plate||d.consulta&&d.consulta.plate||"")+'">'+
      '<div class="c360-price-result" aria-live="polite">'+(val?"Informe o preço anunciado para comparar com a FIPE.":"Sem valor FIPE retornado para comparar.")+'</div>'+
      '</div>';
  }
  function renderVehicle(d){
    var v=d.vehicle||{},name=[v.brand,v.model].filter(Boolean).join(" · ")||"Modelo não informado";
    var plate=v.plate||d.consulta&&d.consulta.plate||"Placa não informada";
    var id=String(d.consulta&&d.consulta.id||"");
    var attention=checks.filter(function(f){return getStatus(d,f)==="attention";}).length;
    var missing=checks.filter(function(f){return getStatus(d,f)==="unknown";}).length;
    var y=v.modelYear||v.year||v.fabricationYear||"Ano não informado";
    return '<article class="c360-vehicle-card" data-comparison-id="'+esc(id)+'">'+
      '<div class="c360-vehicle-header"><span class="c360-plate">'+esc(plate)+'</span><strong>'+esc(name)+'</strong><small>Ano-modelo: '+esc(y)+' · Consulta: '+esc(readableDate(d.consulta&&d.consulta.completed_at))+'</small></div>'+
      '<div class="c360-counts"><span class="c360-count-attention">'+attention+' ponto(s) para conferir</span><span>'+missing+' item(ns) sem retorno</span></div>'+
      priceBlock(d)+
      '<h3>Perguntas para o vendedor</h3><ul class="c360-questions">'+renderQuestions(d)+'</ul>'+
      '</article>';
  }
  function renderMatrix(data){
    return '<div class="c360-table-wrap" role="region" aria-label="Comparativo dos indicadores" tabindex="0">'+
      '<table class="c360-matrix"><thead><tr><th scope="col">Indicador</th>'+
      data.map(function(d){return '<th scope="col">'+esc(d.vehicle&&d.vehicle.plate||d.consulta&&d.consulta.plate||"Veículo")+'</th>';}).join("")+
      '</tr></thead><tbody>'+
      checks.map(function(f){return '<tr><th scope="row">'+esc(f.label)+'</th>'+data.map(function(d){return '<td>'+statusTag(getStatus(d,f))+'</td>';}).join("")+'</tr>';}).join("")+
      '</tbody></table></div>';
  }
  function renderAll(data,isDemo){
    return (isDemo ? '<div class="c360-demo-banner"><strong>DEMONSTRAÇÃO ILUSTRATIVA</strong> · Veículos, valores e indicadores fictícios. Não representa consultas reais e não utiliza créditos.</div>' : "") + '<div class="c360-result-head"><span class="c360-eyebrow">COMPARADOR DE PRÉ-COMPRA</span><h2 id="c360CompareTitle">Escolha 360</h2>'+
      '<p>Compare relatórios que você já liberou. Indicador não informado <strong>não</strong> significa ausência de ocorrência. As informações refletem as datas de cada consulta.</p>'+
      '<div class="c360-result-actions"><button type="button" class="btn primary c360-print-btn">IMPRIMIR / SALVAR PDF</button></div></div>'+
      '<h3>Comparativo dos dados retornados</h3>'+renderMatrix(data)+
      '<div class="c360-vehicle-grid">'+data.map(renderVehicle).join("")+'</div>'+
      '<div class="c360-warning"><strong>Antes de fechar negócio:</strong> a FIPE é apenas uma referência, não um preço garantido. Confirme documentos, débitos e restrições nos canais oficiais, e faça vistoria independente. A comparação não indica automaticamente qual veículo comprar e não realiza novas consultas.</div>';
  }
  function compare(){
    if(chosen.length<2||chosen.length>3)return;
    var token=accountToken();
    if(!token){message("Recupere sua conta por e-mail antes de comparar os relatórios.",true);return;}
    var btn=el("c360CompareBtn");btn.disabled=true;btn.textContent="CARREGANDO RELATÓRIOS...";
    message("");
    Promise.all(chosen.map(function(id){
      return fetch("/api/minhas-consultas/"+encodeURIComponent(id),{headers:{"X-Credit-Account":token},cache:"no-store"})
        .then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.mensagem||"Não foi possível carregar o relatório.");return d;});});
    })).then(function(data){
      loadedVehicleById=new Map(data.map(function(d){return [String(d.consulta.id),d];}));
      el("c360CompareContent").innerHTML=renderAll(data);
      el("c360CompareModal").classList.remove("hidden");
      el("c360CompareModal").scrollTop=0;
      document.body.classList.add("c360-modal-open");
      el("c360CompareModal").querySelector(".c360-close").focus();
    }).catch(function(err){message(err.message||"Falha ao comparar os relatórios.",true);})
      .finally(function(){btn.textContent="COMPARAR VEÍCULOS";updateBar();});
  }
  function demo(){
    var data=[
      {consulta:{id:"exemplo-a",plate:"CARRO A",completed_at:"2026-01-01T12:00:00Z"},vehicle:{plate:"CARRO A",brand:"Modelo fictício",model:"A",modelYear:2021,fipe:{numericValue:52000}},report360:{alerts:[{id:"roubo_furto",status:"sem_ocorrencia_retornada"},{id:"leilao",status:"sem_ocorrencia_retornada"},{id:"recall",status:"atencao"}]}},
      {consulta:{id:"exemplo-b",plate:"CARRO B",completed_at:"2026-01-01T12:00:00Z"},vehicle:{plate:"CARRO B",brand:"Modelo fictício",model:"B",modelYear:2022,fipe:{numericValue:59000}},report360:{alerts:[{id:"roubo_furto",status:"sem_ocorrencia_retornada"},{id:"leilao",status:"atencao"},{id:"recall",status:"nao_informado"}]}},
      {consulta:{id:"exemplo-c",plate:"CARRO C",completed_at:"2026-01-01T12:00:00Z"},vehicle:{plate:"CARRO C",brand:"Modelo fictício",model:"C",modelYear:2020,fipe:{numericValue:47000}},report360:{alerts:[{id:"roubo_furto",status:"nao_informado"},{id:"leilao",status:"sem_ocorrencia_retornada"},{id:"recall",status:"sem_ocorrencia_retornada"}]}}
    ];
    loadedVehicleById=new Map(data.map(function(d){return [d.consulta.id,d];}));
    el("c360CompareContent").innerHTML=renderAll(data,true);
    el("c360CompareModal").classList.remove("hidden");
    el("c360CompareModal").scrollTop=0;
    document.body.classList.add("c360-modal-open");
    el("c360CompareModal").querySelector(".c360-close").focus();
  }
  function updatePrice(input){
    var root=input.closest(".c360-vehicle-card");
    if(!root)return;
    var id=String(input.dataset.priceId||"");
    var v=loadedVehicleById.get(id);
    var dest=root.querySelector(".c360-price-result");
    if(!v||!dest)return;
    var fi=fipeValue(v.vehicle),price=parseMoney(input.value);
    if(!fi){dest.textContent="Sem valor FIPE retornado para comparar.";return;}
    if(!price){dest.textContent="Informe o preço anunciado para comparar com a FIPE.";return;}
    var difference=price-fi,pct=(difference/fi)*100;
    if(Math.abs(difference)<.005){dest.textContent="Preço anunciado igual à referência FIPE.";return;}
    dest.textContent=money(Math.abs(difference))+" ("+Math.abs(pct).toFixed(1).replace(".",",")+"%) "+(difference>0?"acima":"abaixo")+" da referência FIPE.";
  }
  var loadedVehicleById=new Map();
  function close(){
    if(el("c360CompareModal"))el("c360CompareModal").classList.add("hidden");
    document.body.classList.remove("c360-modal-open");
    loadedVehicleById.clear();
  }
  document.addEventListener("change",function(e){
    if(e.target.matches(".c360-compare-checkbox"))toggle(e.target);
  });
  document.addEventListener("input",function(e){
    if(e.target.matches(".c360-price-input"))updatePrice(e.target);
  });
  document.addEventListener("click",function(e){
    if(e.target.matches(".c360-print-btn")){document.body.classList.add("c360-print");window.print();}
    if(e.target===el("c360CompareModal"))close();
  });
  document.addEventListener("keydown",function(e){if(e.key==="Escape"&&el("c360CompareModal")&&!el("c360CompareModal").classList.contains("hidden"))close();});
  window.addEventListener("afterprint",function(){document.body.classList.remove("c360-print");});
  // Preenche mapa após carregar; nenhuma informação fica armazenada no navegador.
  window.addEventListener("DOMContentLoaded",function(){if(window.location && /[?&]demo=1(?:&|$)/.test(window.location.search||""))demo();});
  return {sync:sync,isChosen:isChosen,compare:compare,demo:demo,close:close};
})();
