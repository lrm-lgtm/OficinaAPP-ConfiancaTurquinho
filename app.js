const demoOrders=[
  {id:34,ref:"#000123",plate:"ABC1D23",vehicle:"Chevrolet Onix 1.0 2020",customer:"João da Silva",status:"Em orçamento",kind:"waiting",opened:"Hoje 09:12",stage:"Aguardando aprovação",complaint:"Barulho na suspensão dianteira."},
  {id:31,ref:"#000121",plate:"ABC1D23",vehicle:"Chevrolet Onix 1.0",customer:"João da Silva",status:"Em execução",kind:"service",opened:"Hoje 08:40",stage:"Suspensão dianteira",complaint:"Barulho na dianteira."},
  {id:28,ref:"#000119",plate:"XY29A12",vehicle:"Hyundai HB20",customer:"Ana Paula",status:"Aguardando",kind:"waiting",opened:"20/09 16:10",stage:"Troca de óleo",complaint:"Revisão preventiva."},
  {id:25,ref:"#000116",plate:"DEF4G56",vehicle:"Honda Civic",customer:"Marcos Silva",status:"Pronta",kind:"ready",opened:"20/09 10:05",stage:"Aguardando retirada",complaint:"Freio dianteiro."}
];

const demoClients=[
  {id:1,name:"João da Silva",phone:"(19) 99876-1122",vehicle:"Chevrolet Onix · ABC1D23",orders:3},
  {id:2,name:"Ana Paula",phone:"(19) 98810-4421",vehicle:"Hyundai HB20 · XY29A12",orders:2},
  {id:3,name:"Marcos Silva",phone:"(19) 99102-8870",vehicle:"Honda Civic · DEF4G56",orders:5}
];

const views=[...document.querySelectorAll(".view")];
const bottom=[...document.querySelectorAll(".bottomnav button")];
const toastEl=document.getElementById("toast");
const appBack=document.getElementById("appBack");
let currentView="dashboard";
let previousView="dashboard";
let currentFilter="all";
let wizardStep=1;
let requiredPhotos=new Set();
let deferredPrompt=null;

function toast(message){
  toastEl.textContent=message;
  toastEl.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer=setTimeout(()=>toastEl.classList.remove("show"),2300);
}

function go(name){
  previousView=currentView;
  currentView=name;
  const publicMode=name==="client-approval";
  document.body.classList.toggle("public-mode",publicMode);
  views.forEach(v=>v.classList.toggle("active",v.dataset.view===name));
  bottom.forEach(b=>b.classList.toggle("active",b.dataset.go===name));
  const moreBtn=document.getElementById("moreNavBtn");
  if(moreBtn) moreBtn.classList.toggle("active",["stock","mechanic"].includes(name));
  appBack.hidden=publicMode || ["dashboard","orders","clients"].includes(name);
  window.scrollTo({top:0,behavior:"smooth"});
  if(name==="orders") renderOrders();
  if(name==="clients") renderClients();
  if(name==="new-os") setWizardStep(1);
  if(name==="client-approval"){
    renderApprovalState();
    setTimeout(resizeApprovalSignature,60);
  }
  queueScrollLock();
}

document.querySelectorAll("[data-go]").forEach(btn=>btn.addEventListener("click",()=>go(btn.dataset.go)));
appBack.addEventListener("click",()=>go(previousView==="client-approval"?"budget":previousView||"dashboard"));

function statusBadge(status){
  let cls="open";
  if(/execução|aprovado/i.test(status)) cls="service";
  else if(/pronta/i.test(status)) cls="ready";
  else if(/aguard|orçamento|revisão/i.test(status)) cls="waiting";
  return '<span class="status '+cls+'">'+status+"</span>";
}

function getDemoApproval(){
  try{
    const record=JSON.parse(localStorage.getItem("oficina-approval-000123")||"null");
    if(record?.status==="approved" && (!record.signatureData || record.consent!==true)){
      localStorage.removeItem("oficina-approval-000123");
      return null;
    }
    return record;
  }catch{return null}
}
function allOrders(){
  const approval=getDemoApproval();
  const demo=demoOrders.map(o=>{
    if(o.id!==34 || !approval) return o;
    if(approval.status==="approved") return {...o,status:"Aprovado",kind:"service",stage:"Liberado para execução"};
    if(approval.status==="revision") return {...o,status:"Revisão solicitada",kind:"waiting",stage:"Cliente solicitou revisão"};
    return o;
  });
  return [...JSON.parse(localStorage.getItem("oficina-orders")||"[]"),...demo];
}

function allClients(){
  return [...JSON.parse(localStorage.getItem("oficina-clients")||"[]"),...demoClients];
}

function contextualAction(o){
  if(/aprovação|orçamento/i.test(o.stage+" "+o.status)) return "Enviar link";
  if(/execução|liberado/i.test(o.stage+" "+o.status)) return "Abrir";
  if(/pronta|retirada/i.test(o.stage+" "+o.status)) return "Entrega";
  return "Continuar";
}

function orderCard(o){
  return '<article class="compact-order-card">'+
    '<button class="compact-order-main" data-open-os="'+o.id+'">'+
      '<div class="compact-order-id"><b>'+o.plate+'</b><span>'+o.ref+'</span></div>'+
      '<div class="compact-order-copy"><b>'+escapeHtml(o.vehicle)+'</b><span>'+escapeHtml(o.customer)+' · '+escapeHtml(o.stage)+'</span></div>'+
      statusBadge(o.status)+
    '</button>'+
    '<button class="context-action" data-order-action="'+o.id+'">'+contextualAction(o)+'</button>'+
  '</article>';
}

function bindOrderOpeners(){
  document.querySelectorAll("[data-open-os]").forEach(btn=>btn.onclick=()=>openDetail(Number(btn.dataset.openOs)));
  document.querySelectorAll("[data-order-action]").forEach(btn=>btn.onclick=()=>{
    const o=allOrders().find(x=>x.id===Number(btn.dataset.orderAction));
    if(!o) return;
    if(/aprovação|orçamento/i.test(o.stage+" "+o.status)) go("budget");
    else openDetail(o.id);
  });
}

function renderDashboard(){
  const orders=allOrders();
  const open=orders.filter(o=>o.kind!=="ready");
  const budgets=orders.filter(o=>/aprovação|orçamento|revisão/i.test(o.stage+" "+o.status));
  const service=orders.filter(o=>/execução|liberado|aprovado/i.test(o.stage+" "+o.status));
  document.getElementById("openCount").textContent=open.length;
  const budgetCount=document.getElementById("budgetCount");
  const serviceCount=document.getElementById("serviceCount");
  if(budgetCount) budgetCount.textContent=budgets.length;
  if(serviceCount) serviceCount.textContent=service.length;

  const attention=[...budgets,...orders.filter(o=>/peça|pendente|retirada/i.test(o.stage))];
  const unique=[...new Map(attention.map(o=>[o.id,o])).values()].slice(0,2);
  const attentionEl=document.getElementById("attentionList");
  if(attentionEl){
    attentionEl.innerHTML=unique.length?unique.map(o=>
      '<button class="attention-item" data-open-os="'+o.id+'"><span class="attention-dot"></span><div><b>'+escapeHtml(o.plate)+' · '+escapeHtml(o.vehicle)+'</b><small>'+escapeHtml(o.stage)+'</small></div><em>›</em></button>'
    ).join(""):'<div class="attention-clear">✓ Nenhuma pendência crítica agora</div>';
  }

  document.getElementById("dashboardOrders").innerHTML=open.slice(0,3).map(orderCard).join("");
  bindOrderOpeners();
  queueScrollLock();
}

function renderOrders(){
  const q=(document.getElementById("orderSearch")?.value||"").toLowerCase().trim();
  const list=allOrders().filter(o=>{
    const filterOk=currentFilter==="all"||o.kind===currentFilter;
    const qOk=!q||[o.ref,o.plate,o.vehicle,o.customer,o.status,o.stage].join(" ").toLowerCase().includes(q);
    return filterOk&&qOk;
  });
  document.getElementById("orderList").innerHTML=list.length?list.map(orderCard).join(""):'<div class="muted">Nenhuma OS encontrada.</div>';
  bindOrderOpeners();
  queueScrollLock();
}

document.getElementById("orderSearch").addEventListener("input",renderOrders);
document.querySelectorAll("[data-filter]").forEach(btn=>btn.addEventListener("click",()=>{
  currentFilter=btn.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach(x=>x.classList.toggle("active",x===btn));
  renderOrders();
}));
document.querySelectorAll("[data-filter-jump]").forEach(btn=>btn.addEventListener("click",()=>{
  currentFilter=btn.dataset.filterJump;
  document.querySelectorAll("[data-filter]").forEach(x=>x.classList.toggle("active",x.dataset.filter===currentFilter));
  go("orders");
}));

function clientCard(c){
  return '<article class="client-card" data-client-id="'+c.id+'"><div class="avatar">'+c.name.charAt(0).toUpperCase()+'</div><div style="flex:1"><h3>'+c.name+'</h3><p>'+c.phone+'</p><p>'+c.vehicle+'</p></div><span class="status open">'+c.orders+' OS</span></article>';
}
function renderClients(){
  const q=(document.getElementById("clientSearch").value||"").toLowerCase().trim();
  const list=allClients().filter(c=>!q||[c.name,c.phone,c.vehicle].join(" ").toLowerCase().includes(q));
  document.getElementById("clientList").innerHTML=list.map(clientCard).join("");
  queueScrollLock();
}
document.getElementById("clientSearch").addEventListener("input",renderClients);

const modal=document.getElementById("clientModal");
document.getElementById("newClientBtn").addEventListener("click",()=>modal.hidden=false);
document.querySelector("[data-close-modal]").addEventListener("click",()=>modal.hidden=true);
modal.addEventListener("click",e=>{if(e.target===modal)modal.hidden=true});
document.getElementById("clientForm").addEventListener("submit",e=>{
  e.preventDefault();
  const fd=new FormData(e.currentTarget);
  const saved=JSON.parse(localStorage.getItem("oficina-clients")||"[]");
  saved.unshift({id:Date.now(),name:String(fd.get("name")).trim(),phone:String(fd.get("phone")||"—"),vehicle:"Sem veículo vinculado",orders:0});
  localStorage.setItem("oficina-clients",JSON.stringify(saved));
  e.currentTarget.reset();modal.hidden=true;renderClients();toast("Cliente cadastrado nesta demo.");
});

const wizard=document.getElementById("osWizard");
const wizardPanels=[...document.querySelectorAll(".wizard-panel")];
const wizardNav=[...document.querySelectorAll("[data-step-nav]")];

function setWizardStep(step){
  wizardStep=step;
  wizardPanels.forEach(p=>p.classList.toggle("active",Number(p.dataset.step)===step));
  wizardNav.forEach(n=>{
    const s=Number(n.dataset.stepNav);
    n.classList.toggle("active",s===step);
    n.classList.toggle("done",s<step);
  });
  const titles={1:"Cliente",2:"Veículo",3:"Vistoria de entrada",4:"Revisar e criar OS"};
  document.getElementById("wizardTitle").textContent=titles[step];
  window.scrollTo({top:0,behavior:"smooth"});
  if(step===4) renderWizardSummary();
  queueScrollLock();
}
wizardNav.forEach(n=>n.addEventListener("click",()=>{
  const target=Number(n.dataset.stepNav);
  if(target===1 || (target===2 && customerValid()) || (target===3 && customerValid()) || (target===4 && requiredPhotos.size===4)) setWizardStep(target);
}));
document.querySelectorAll("[data-next]").forEach(btn=>btn.addEventListener("click",()=>{
  if(!customerValid()) return;
  setWizardStep(Number(btn.dataset.next));
}));
document.querySelectorAll("[data-prev]").forEach(btn=>btn.addEventListener("click",()=>setWizardStep(Number(btn.dataset.prev))));

function customerValid(){
  const input=document.getElementById("wizCustomer");
  if(!input.value.trim()){input.focus();toast("Informe o nome do cliente.");return false}
  return true;
}

document.getElementById("pickExistingClient").addEventListener("click",()=>{
  const c=allClients()[0];
  document.getElementById("wizCustomer").value=c.name;
  toast("Cliente "+c.name+" selecionado.");
});

// ---- voice dictation: initial report ----
const initialReport=document.getElementById("initialReport");
const initialReportVoice=document.getElementById("initialReportVoice");
const initialReportVoiceStatus=document.getElementById("initialReportVoiceStatus");
const SpeechRecognitionCtor=window.SpeechRecognition||window.webkitSpeechRecognition;
let initialReportRecognition=null;
let initialReportListening=false;
let initialReportBaseText="";

function setInitialReportVoiceState(active,message=""){
  initialReportListening=active;
  initialReportVoice?.classList.toggle("listening",active);
  if(initialReportVoice){
    initialReportVoice.querySelector(".voice-label").textContent=active?"Parar":"Ditar";
    initialReportVoice.setAttribute("aria-label",active?"Parar ditado":"Ditar relato inicial");
  }
  if(initialReportVoiceStatus){
    initialReportVoiceStatus.textContent=message;
    initialReportVoiceStatus.classList.toggle("active",active);
  }
  queueScrollLock();
}

function stopInitialReportVoice(){
  try{initialReportRecognition?.stop()}catch{}
}

if(initialReportVoice){
  if(!SpeechRecognitionCtor){
    initialReportVoice.addEventListener("click",()=>{
      toast("Ditado de voz não disponível neste navegador. Use o microfone do teclado.");
    });
  }else{
    initialReportRecognition=new SpeechRecognitionCtor();
    initialReportRecognition.lang="pt-BR";
    initialReportRecognition.continuous=true;
    initialReportRecognition.interimResults=true;

    initialReportRecognition.onstart=()=>{
      initialReportBaseText=(initialReport.value||"").trim();
      setInitialReportVoiceState(true,"Ouvindo agora… pode falar normalmente.");
    };
    initialReportRecognition.onresult=event=>{
      let finalText="";
      let interimText="";
      for(let i=event.resultIndex;i<event.results.length;i++){
        const text=event.results[i][0].transcript.trim();
        if(event.results[i].isFinal) finalText+=(finalText?" ":"")+text;
        else interimText+=(interimText?" ":"")+text;
      }
      if(finalText){
        initialReportBaseText=[initialReportBaseText,finalText].filter(Boolean).join(initialReportBaseText?". ":"");
      }
      const combined=[initialReportBaseText,interimText].filter(Boolean).join(initialReportBaseText&&interimText?". ":"");
      initialReport.value=combined;
    };
    initialReportRecognition.onerror=event=>{
      const msg=event.error==="not-allowed"
        ?"Permissão do microfone negada."
        : event.error==="no-speech"
          ?"Não ouvi fala. Toque no microfone para tentar novamente."
          :"Não foi possível usar o ditado agora.";
      setInitialReportVoiceState(false,msg);
    };
    initialReportRecognition.onend=()=>{
      setInitialReportVoiceState(false,initialReport.value.trim()?"Ditado inserido no relato.":"");
    };

    initialReportVoice.addEventListener("click",()=>{
      if(initialReportListening){stopInitialReportVoice();return}
      try{initialReportRecognition.start()}
      catch{toast("O ditado já está iniciando.")}
    });
  }
}

document.getElementById("quickCreate").addEventListener("click",()=>{
  if(!customerValid()) return;
  const fd=new FormData(wizard);
  createOrder(fd,true);
});

document.querySelectorAll(".capture-card input").forEach(input=>input.addEventListener("change",()=>{
  const card=input.closest(".capture-card");
  const file=input.files?.[0];
  if(!file)return;
  const preview=card.querySelector(".capture-preview");
  const old=preview.querySelector("img");
  if(old) URL.revokeObjectURL(old.src);
  preview.innerHTML='<img alt="'+card.dataset.slot+'">';
  preview.querySelector("img").src=URL.createObjectURL(file);
  card.classList.add("captured");
  if(card.classList.contains("required")) requiredPhotos.add(card.dataset.slot);
  updatePhotoProgress();
}));
function updatePhotoProgress(){
  const count=requiredPhotos.size;
  document.getElementById("wizardPhotoLabel").textContent=count+" de 4 obrigatórias";
  document.getElementById("photoProgressBar").style.width=(count/4*100)+"%";
  document.getElementById("toSummary").disabled=count!==4;
}
document.getElementById("toSummary").addEventListener("click",()=>{
  if(requiredPhotos.size!==4){toast("Faça as quatro fotos obrigatórias.");return}
  setWizardStep(4);
});

function renderWizardSummary(){
  const fd=new FormData(wizard);
  const customer=String(fd.get("customer")||"").trim();
  const vehicle=String(fd.get("vehicle")||"").trim()||"A completar";
  const plate=String(fd.get("plate")||"").trim().toUpperCase()||"A completar";
  const year=String(fd.get("year")||"").trim()||"—";
  const km=String(fd.get("km")||"").trim()||"—";
  const complaint=String(fd.get("complaint")||"").trim()||"Sem relato inicial";
  const panel=document.querySelector('[data-slot="panel"]').classList.contains("captured")?" + painel opcional":"";
  document.getElementById("wizardSummary").innerHTML=
    '<div><dt>Cliente</dt><dd>'+escapeHtml(customer)+'</dd></div>'+
    '<div><dt>Veículo</dt><dd>'+escapeHtml(vehicle)+' · '+escapeHtml(year)+'</dd></div>'+
    '<div><dt>Placa</dt><dd>'+escapeHtml(plate)+'</dd></div>'+
    '<div><dt>Quilometragem</dt><dd>'+escapeHtml(km)+'</dd></div>'+
    '<div><dt>Relato inicial</dt><dd>'+escapeHtml(complaint)+'</dd></div>'+
    '<div><dt>Fotos da vistoria</dt><dd>4 obrigatórias'+panel+'</dd></div>';
}

wizard.addEventListener("submit",e=>{
  e.preventDefault();
  if(!customerValid())return;
  if(requiredPhotos.size!==4){setWizardStep(3);toast("As quatro fotos são obrigatórias para concluir a entrada.");return}
  const fd=new FormData(wizard);
  const order=createOrder(fd,false);
  const goBudget=document.getElementById("goBudgetAfterCreate").checked;
  resetWizard();
  if(goBudget)go("budget"); else openDetail(order.id);
});

function createOrder(fd,quick){
  const saved=JSON.parse(localStorage.getItem("oficina-orders")||"[]");
  const id=Date.now();
  const order={
    id,
    ref:"#D"+String(id).slice(-6),
    plate:String(fd.get("plate")||"").trim().toUpperCase()||"SEM PLACA",
    vehicle:String(fd.get("vehicle")||"").trim()||"Veículo a completar",
    customer:String(fd.get("customer")||"").trim(),
    status:quick?"Aberta":"Em orçamento",
    kind:quick?"waiting":"waiting",
    opened:"Agora",
    stage:quick?"Cadastro/vistoria pendente":"Vistoria concluída",
    complaint:String(fd.get("complaint")||"").trim()||"Sem relato inicial",
    quick
  };
  saved.unshift(order);
  localStorage.setItem("oficina-orders",JSON.stringify(saved));
  renderDashboard();renderOrders();
  toast(quick?"OS rápida criada. Complete veículo e vistoria depois.":"OS criada com vistoria inicial.");
  if(quick){resetWizard();openDetail(order.id)}
  return order;
}
function resetWizard(){
  wizard.reset();requiredPhotos.clear();
  document.querySelectorAll(".capture-card").forEach(card=>{
    card.classList.remove("captured");
    card.querySelector(".capture-preview").innerHTML='<span>'+(card.classList.contains("optional")?"＋":"📷")+'</span>';
  });
  updatePhotoProgress();setWizardStep(1);
}

function budgetActionLabel(o){
  const state=(o.status+" "+o.stage).toLowerCase();
  if(state.includes("aprovado")||state.includes("liberado")) return "Ver orçamento aprovado";
  if(state.includes("aprovação")||state.includes("orçamento")||state.includes("revisão")) return "Abrir orçamento";
  return "Ir para orçamento";
}

function openDetail(id){
  const o=allOrders().find(x=>x.id===id)||demoOrders[0];
  const inspected=!o.quick;
  const detail=document.getElementById("osDetail");
  detail.innerHTML=
  '<article class="os-hero">'+
    '<div class="os-cover"><div class="car-emoji">🚗</div><div class="os-cover-info"><span>'+o.ref+'</span><h1>'+escapeHtml(o.vehicle)+'</h1><span>'+escapeHtml(o.plate)+' · '+escapeHtml(o.customer)+'</span>'+statusBadge(o.status)+'</div></div>'+
    '<div class="os-tabs"><button class="active" data-os-tab="summary">Resumo</button><button data-os-tab="inspection">Vistoria</button><button data-os-tab="estimate">Orçamento</button><button data-os-tab="history">Histórico</button></div>'+
    '<div class="tab-content">'+
      '<section class="tab-pane active" data-pane="summary">'+
        '<div class="info-block"><span>Relato do cliente</span><b>'+escapeHtml(o.complaint||"Sem relato inicial")+'</b></div>'+
        '<div class="info-block"><span>Status atual</span><b>'+escapeHtml(o.stage)+'</b></div>'+
        '<div class="info-block"><span>Entrada</span><b>'+escapeHtml(o.opened)+'</b></div>'+
        (o.quick?'<button class="btn primary full" id="completeEntry">Completar cadastro e vistoria</button>':'')+
      '</section>'+
      '<section class="tab-pane" data-pane="inspection">'+
        '<div class="info-block"><span>Vistoria de entrada</span><b>'+(inspected?"4 fotos obrigatórias registradas":"Pendente")+'</b></div>'+
        '<div class="photo-strip">'+(inspected?'<div class="photo-thumb">🚗</div><div class="photo-thumb">🚘</div><div class="photo-thumb">↔</div><div class="photo-thumb">↔</div><div class="photo-thumb">＋</div>':'<div class="muted">Sem evidências ainda.</div>')+'</div>'+
      '</section>'+
      '<section class="tab-pane" data-pane="estimate"><div class="info-block"><span>Orçamento</span><b>'+(o.status==="Em orçamento"?"Aguardando aprovação":"Disponível para consulta/edição")+'</b></div><div class="info-block"><span>Acesso rápido</span><b>Use o botão fixo abaixo para abrir o orçamento em qualquer aba.</b></div></section>'+
      '<section class="tab-pane" data-pane="history"><div class="info-block"><span>Agora</span><b>OS criada</b></div>'+(inspected?'<div class="info-block"><span>Agora</span><b>Vistoria inicial concluída</b></div>':'')+'</section>'+
    '</div>'+
    '<div class="os-global-actions">'+
      '<button class="btn primary full os-budget-shortcut" data-go="budget"><span>R$</span>'+budgetActionLabel(o)+'</button>'+
    '</div>'+
  '</article>';
  detail.querySelectorAll("[data-os-tab]").forEach(btn=>btn.addEventListener("click",()=>{
    detail.querySelectorAll("[data-os-tab]").forEach(x=>x.classList.toggle("active",x===btn));
    detail.querySelectorAll(".tab-pane").forEach(p=>p.classList.toggle("active",p.dataset.pane===btn.dataset.osTab));
    queueScrollLock();
  }));
  detail.querySelectorAll("[data-go]").forEach(btn=>btn.onclick=()=>go(btn.dataset.go));
  const complete=document.getElementById("completeEntry");
  if(complete)complete.onclick=()=>{
    document.getElementById("wizCustomer").value=o.customer;
    const plate=wizard.elements.plate; const vehicle=wizard.elements.vehicle; const complaint=wizard.elements.complaint;
    plate.value=o.plate==="SEM PLACA"?"":o.plate;vehicle.value=o.vehicle==="Veículo a completar"?"":o.vehicle;complaint.value=o.complaint==="Sem relato inicial"?"":o.complaint;
    go("new-os");setWizardStep(2);
  };
  go("detail");
}

document.getElementById("addBudgetItem").addEventListener("click",()=>toast("Na versão funcional, abre a busca de peça/serviço."));
document.getElementById("copyApproval").addEventListener("click",async()=>{
  const link=location.origin+location.pathname+"?approval=demo-000123#aprovar";
  try{await navigator.clipboard.writeText(link);toast("Link de aprovação copiado.");}
  catch{toast("Link pronto para compartilhar.");}
});
// ---- handwritten approval signature v10.5 ----
const approvalSignature=document.getElementById("approvalSignature");
const signatureBlock=document.getElementById("signatureBlock");
const signaturePlaceholder=document.getElementById("signaturePlaceholder");
const signatureStatus=document.getElementById("signatureStatus");
const clearSignatureBtn=document.getElementById("clearSignature");
const approvalConsent=document.getElementById("approvalConsent");
const approvalName=document.getElementById("approvalName");
const approveBudgetBtn=document.getElementById("approveBudget");
let signatureCtx=null;
let signatureDrawing=false;
let signatureHasInk=false;
let signatureLastPoint=null;
let signatureDistance=0;

function updateApprovalButtonState(){
  if(!approveBudgetBtn) return;
  const validName=Boolean(approvalName?.value.trim());
  const valid=validName && signatureHasInk && signatureDistance>12 && Boolean(approvalConsent?.checked);
  approveBudgetBtn.disabled=!valid;
}

function updateSignatureState(){
  signatureBlock?.classList.toggle("signed",signatureHasInk);
  if(signatureStatus){
    signatureStatus.textContent=signatureHasInk?"✓ Assinada":"Pendente";
    signatureStatus.classList.toggle("ok",signatureHasInk);
  }
  updateApprovalButtonState();
}

function setupSignatureContext(){
  if(!approvalSignature) return;
  const rect=approvalSignature.getBoundingClientRect();
  if(rect.width<20 || rect.height<20) return;
  const ratio=Math.max(1,window.devicePixelRatio||1);
  approvalSignature.width=Math.round(rect.width*ratio);
  approvalSignature.height=Math.round(rect.height*ratio);
  signatureCtx=approvalSignature.getContext("2d");
  signatureCtx.setTransform(ratio,0,0,ratio,0,0);
  signatureCtx.lineWidth=2.4;
  signatureCtx.lineCap="round";
  signatureCtx.lineJoin="round";
  signatureCtx.strokeStyle="#111827";
}

function pointFromXY(clientX,clientY){
  const rect=approvalSignature.getBoundingClientRect();
  return {x:clientX-rect.left,y:clientY-rect.top};
}
function drawSignatureDot(point){
  if(!signatureCtx) return;
  signatureCtx.beginPath();
  signatureCtx.arc(point.x,point.y,1.2,0,Math.PI*2);
  signatureCtx.fillStyle="#111827";
  signatureCtx.fill();
}
function beginSignature(clientX,clientY){
  if(!signatureCtx) setupSignatureContext();
  const point=pointFromXY(clientX,clientY);
  signatureDrawing=true;
  signatureLastPoint=point;
  drawSignatureDot(point);
}
function continueSignature(clientX,clientY){
  if(!signatureDrawing||!signatureCtx||!signatureLastPoint) return;
  const point=pointFromXY(clientX,clientY);
  const dx=point.x-signatureLastPoint.x;
  const dy=point.y-signatureLastPoint.y;
  signatureDistance+=Math.hypot(dx,dy);
  signatureCtx.beginPath();
  signatureCtx.moveTo(signatureLastPoint.x,signatureLastPoint.y);
  signatureCtx.lineTo(point.x,point.y);
  signatureCtx.stroke();
  signatureLastPoint=point;
  signatureHasInk=signatureDistance>6;
  updateSignatureState();
}
function endSignature(){
  signatureDrawing=false;
  signatureLastPoint=null;
  updateSignatureState();
}
function clearApprovalSignature(){
  if(!signatureCtx) setupSignatureContext();
  if(signatureCtx&&approvalSignature){
    const rect=approvalSignature.getBoundingClientRect();
    signatureCtx.clearRect(0,0,rect.width,rect.height);
  }
  signatureHasInk=false;
  signatureDistance=0;
  signatureDrawing=false;
  signatureLastPoint=null;
  updateSignatureState();
}

function bindSignaturePad(){
  if(!approvalSignature) return;
  setupSignatureContext();

  if(window.PointerEvent){
    approvalSignature.addEventListener("pointerdown",event=>{
      event.preventDefault();
      approvalSignature.setPointerCapture?.(event.pointerId);
      beginSignature(event.clientX,event.clientY);
    });
    approvalSignature.addEventListener("pointermove",event=>{
      if(!signatureDrawing) return;
      event.preventDefault();
      continueSignature(event.clientX,event.clientY);
    });
    approvalSignature.addEventListener("pointerup",event=>{
      event.preventDefault();
      endSignature();
      try{approvalSignature.releasePointerCapture?.(event.pointerId)}catch{}
    });
    approvalSignature.addEventListener("pointercancel",endSignature);
  }else{
    approvalSignature.addEventListener("touchstart",event=>{
      const t=event.touches[0];
      if(!t) return;
      event.preventDefault();
      beginSignature(t.clientX,t.clientY);
    },{passive:false});
    approvalSignature.addEventListener("touchmove",event=>{
      const t=event.touches[0];
      if(!t) return;
      event.preventDefault();
      continueSignature(t.clientX,t.clientY);
    },{passive:false});
    approvalSignature.addEventListener("touchend",event=>{event.preventDefault();endSignature()},{passive:false});
    approvalSignature.addEventListener("mousedown",event=>{event.preventDefault();beginSignature(event.clientX,event.clientY)});
    window.addEventListener("mousemove",event=>{if(signatureDrawing)continueSignature(event.clientX,event.clientY)});
    window.addEventListener("mouseup",endSignature);
  }

  clearSignatureBtn?.addEventListener("click",clearApprovalSignature);
  approvalConsent?.addEventListener("change",updateApprovalButtonState);
  approvalName?.addEventListener("input",updateApprovalButtonState);
  window.addEventListener("resize",()=>setTimeout(()=>{
    const existing=getSignatureData();
    setupSignatureContext();
    if(existing){
      const img=new Image();
      img.onload=()=>{
        const rect=approvalSignature.getBoundingClientRect();
        signatureCtx.drawImage(img,0,0,rect.width,rect.height);
      };
      img.src=existing;
    }
  },80),{passive:true});
  updateSignatureState();
}
bindSignaturePad();

function resizeApprovalSignature(){
  setupSignatureContext();
}

function getSignatureData(){
  return signatureHasInk&&approvalSignature?approvalSignature.toDataURL("image/png"):null;
}

function formatDecisionTime(iso){
  try{return new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short"}).format(new Date(iso))}catch{return ""}
}
function saveDemoApproval(status,name,signatureData=null){
  const record={
    budget:"000123",
    revision:2,
    amount:720,
    status,
    name,
    signatureData,
    consent:Boolean(approvalConsent?.checked),
    decidedAt:new Date().toISOString(),
    userAgent:navigator.userAgent
  };
  localStorage.setItem("oficina-approval-000123",JSON.stringify(record));
  renderApprovalState();
  renderDashboard();
  renderOrders();
}
function renderApprovalState(){
  const record=getDemoApproval();
  const input=document.getElementById("approvalName");
  const actions=document.getElementById("approvalActions");
  const out=document.getElementById("decisionResult");
  if(!record){
    input.disabled=false;
    actions.hidden=false;
    if(approvalConsent){approvalConsent.checked=false;approvalConsent.disabled=false}
    if(approvalSignature) approvalSignature.style.pointerEvents="auto";
    if(clearSignatureBtn) clearSignatureBtn.hidden=false;
    out.className="decision-result";
    out.innerHTML="";
    setTimeout(()=>{setupSignatureContext();clearApprovalSignature();updateApprovalButtonState()},60);
    return;
  }
  input.value=record.name||input.value;
  input.disabled=true;
  actions.hidden=true;
  if(approvalConsent){approvalConsent.checked=Boolean(record.consent);approvalConsent.disabled=true}
  if(approvalSignature) approvalSignature.style.pointerEvents="none";
  if(clearSignatureBtn) clearSignatureBtn.hidden=true;
  if(record.status==="approved"){
    out.className="decision-result decision-card approved compact-decision";
    out.innerHTML='<div><b>✓ Orçamento aprovado</b><span>Rev. '+record.revision+' · R$ '+record.amount.toFixed(2).replace(".",",")+' · '+formatDecisionTime(record.decidedAt)+'</span><span>'+escapeHtml(record.name)+'</span></div>'+(record.signatureData?'<div class="signature-receipt"><img src="'+record.signatureData+'" alt="Assinatura registrada"></div>':'');
  }else{
    out.className="decision-result decision-card revision";
    out.innerHTML='<b>↺ Revisão solicitada</b><span>Revisão '+record.revision+' · R$ '+record.amount.toFixed(2).replace(".",",")+'</span><span>Solicitado por '+escapeHtml(record.name)+' em '+formatDecisionTime(record.decidedAt)+'</span><small>A oficina deve ajustar o orçamento e enviar uma nova revisão.</small>';
  }
}
document.getElementById("approveBudget").addEventListener("click",()=>{
  const name=document.getElementById("approvalName").value.trim();
  if(!name){toast("Informe o nome para aprovar.");return}
  if(!signatureHasInk || signatureDistance<=12){toast("Faça sua assinatura no quadro.");return}
  if(!approvalConsent?.checked){toast("Marque o aceite do orçamento.");return}
  const signatureData=getSignatureData();
  if(!signatureData){toast("Não consegui registrar a assinatura. Tente novamente.");return}
  saveDemoApproval("approved",name,signatureData);
});
document.getElementById("rejectBudget").addEventListener("click",()=>{
  const name=document.getElementById("approvalName").value.trim()||"Cliente";
  saveDemoApproval("revision",name);
});
document.getElementById("finishService").addEventListener("click",()=>{
  const pending=[...document.querySelectorAll(".task input")].filter(x=>!x.checked).length;
  if(pending){toast("Ainda existem "+pending+" tarefas pendentes.");return}
  toast("Serviço concluído. Próxima etapa: vistoria de saída.");
});
document.querySelectorAll(".task input").forEach(input=>input.addEventListener("change",()=>input.closest(".task").classList.toggle("done",input.checked)));

function escapeHtml(value){
  return String(value).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}

window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;document.getElementById("installBtn").hidden=false});
document.getElementById("installBtn").addEventListener("click",async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;document.getElementById("installBtn").hidden=true});
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
if(location.hash==="#aprovar")go("client-approval");
window.addEventListener("hashchange",()=>{
  if(location.hash==="#aprovar") go("client-approval");
  else if(currentView==="client-approval") go("dashboard");
});

// ---- viewport-fit scroll lock ----
let scrollLockRaf=0;
function syncScrollLock(){
  const active=document.querySelector(".view.active");
  if(!active) return;
  if(document.body.classList.contains("public-mode") || document.body.classList.contains("sheet-open")){
    document.body.classList.remove("no-scroll");
    return;
  }

  document.body.classList.remove("no-scroll");
  const appbar=document.querySelector(".appbar");
  const nav=document.querySelector(".bottomnav");
  const appbarH=appbar?.offsetHeight||0;
  const navH=nav?.offsetHeight||0;
  const available=Math.max(0,window.innerHeight-appbarH-navH);
  const contentHeight=active.scrollHeight;

  // A tiny tolerance prevents 1–3 px rounding from creating fake scroll.
  document.body.classList.toggle("no-scroll",contentHeight<=available+6);
}
function queueScrollLock(){
  cancelAnimationFrame(scrollLockRaf);
  scrollLockRaf=requestAnimationFrame(()=>requestAnimationFrame(syncScrollLock));
}
window.addEventListener("resize",queueScrollLock,{passive:true});
window.visualViewport?.addEventListener("resize",queueScrollLock,{passive:true});

// ---- v10 compact interaction layer ----
const quickActionSheet=document.getElementById("quickActionSheet");
const moreSheet=document.getElementById("moreSheet");
const searchSheet=document.getElementById("searchSheet");

function openSheet(sheet){
  if(!sheet) return;
  [quickActionSheet,moreSheet,searchSheet].forEach(s=>{if(s && s!==sheet)s.hidden=true});
  sheet.hidden=false;
  document.body.classList.add("sheet-open");
  document.body.classList.remove("no-scroll");
}
function closeSheets(){
  [quickActionSheet,moreSheet,searchSheet].forEach(s=>{if(s)s.hidden=true});
  document.body.classList.remove("sheet-open");
  queueScrollLock();
}
document.querySelectorAll("[data-close-sheet]").forEach(btn=>btn.addEventListener("click",closeSheets));
document.getElementById("quickActionBtn")?.addEventListener("click",()=>openSheet(quickActionSheet));
document.getElementById("moreNavBtn")?.addEventListener("click",()=>openSheet(moreSheet));
document.getElementById("globalSearchBtn")?.addEventListener("click",()=>{
  openSheet(searchSheet);
  setTimeout(()=>document.getElementById("globalSearchInput")?.focus(),80);
});
document.querySelectorAll("[data-sheet-go]").forEach(btn=>btn.addEventListener("click",()=>{
  closeSheets();go(btn.dataset.sheetGo);
}));
document.querySelector("[data-sheet-client]")?.addEventListener("click",()=>{
  closeSheets();modal.hidden=false;
});

const globalSearchInput=document.getElementById("globalSearchInput");
globalSearchInput?.addEventListener("input",()=>{
  const q=globalSearchInput.value.toLowerCase().trim();
  const results=document.getElementById("globalSearchResults");
  if(!q){results.innerHTML='<div class="search-empty">Digite placa, cliente, OS ou veículo.</div>';return}
  const matches=allOrders().filter(o=>[o.ref,o.plate,o.vehicle,o.customer,o.status,o.stage].join(" ").toLowerCase().includes(q)).slice(0,5);
  results.innerHTML=matches.length?matches.map(orderCard).join(""):'<div class="search-empty">Nenhuma OS encontrada.</div>';
  bindOrderOpeners();
});

// Hide bottom navigation while scrolling down; show again on upward scroll.
let lastScrollY=window.scrollY;
window.addEventListener("scroll",()=>{
  if(document.body.classList.contains("sheet-open")||document.body.classList.contains("public-mode")) return;
  const y=window.scrollY;
  const nav=document.querySelector(".bottomnav");
  if(!nav) return;
  if(y>lastScrollY+8 && y>120) nav.classList.add("nav-hidden");
  else if(y<lastScrollY-8) nav.classList.remove("nav-hidden");
  lastScrollY=y;
},{passive:true});

// Close sheets on Escape.
window.addEventListener("keydown",e=>{if(e.key==="Escape")closeSheets()});

renderDashboard();
renderOrders();
renderClients();
updatePhotoProgress();
renderApprovalState();
