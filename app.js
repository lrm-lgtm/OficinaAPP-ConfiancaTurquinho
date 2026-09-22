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
  appBack.hidden=publicMode || ["dashboard","orders","clients","stock"].includes(name);
  window.scrollTo({top:0,behavior:"smooth"});
  if(name==="orders") renderOrders();
  if(name==="clients") renderClients();
  if(name==="new-os") setWizardStep(1);
  if(name==="client-approval") renderApprovalState();
}

document.querySelectorAll("[data-go]").forEach(btn=>btn.addEventListener("click",()=>go(btn.dataset.go)));
appBack.addEventListener("click",()=>go(previousView==="client-approval"?"budget":previousView||"dashboard"));

function statusBadge(status){
  let cls="open";
  if(/execução/i.test(status)) cls="service";
  else if(/pronta/i.test(status)) cls="ready";
  else if(/aguard|orçamento/i.test(status)) cls="waiting";
  return '<span class="status '+cls+'">'+status+"</span>";
}

function getDemoApproval(){
  try{return JSON.parse(localStorage.getItem("oficina-approval-000123")||"null")}catch{return null}
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

function orderCard(o){
  return '<button class="order-card" data-open-os="'+o.id+'">'+
    '<div class="order-top"><div><small>'+o.ref+" · "+o.plate+'</small><h3>'+o.vehicle+'</h3><small>'+o.customer+"</small></div>"+statusBadge(o.status)+"</div>"+
    '<div class="order-meta"><span>'+o.opened+'</span><span>'+o.stage+"</span></div></button>";
}

function bindOrderOpeners(){
  document.querySelectorAll("[data-open-os]").forEach(btn=>btn.onclick=()=>openDetail(Number(btn.dataset.openOs)));
}

function renderDashboard(){
  const orders=allOrders();
  document.getElementById("openCount").textContent=orders.filter(o=>o.kind!=="ready").length;
  document.getElementById("dashboardOrders").innerHTML=orders.slice(0,3).map(orderCard).join("");
  bindOrderOpeners();
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
      '<section class="tab-pane" data-pane="estimate"><div class="info-block"><span>Orçamento</span><b>'+(o.status==="Em orçamento"?"Aguardando aprovação":"Ainda não enviado")+'</b></div><button class="btn primary full" data-go="budget">Abrir orçamento</button></section>'+
      '<section class="tab-pane" data-pane="history"><div class="info-block"><span>Agora</span><b>OS criada</b></div>'+(inspected?'<div class="info-block"><span>Agora</span><b>Vistoria inicial concluída</b></div>':'')+'</section>'+
    '</div>'+
  '</article>';
  detail.querySelectorAll("[data-os-tab]").forEach(btn=>btn.addEventListener("click",()=>{
    detail.querySelectorAll("[data-os-tab]").forEach(x=>x.classList.toggle("active",x===btn));
    detail.querySelectorAll(".tab-pane").forEach(p=>p.classList.toggle("active",p.dataset.pane===btn.dataset.osTab));
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
function formatDecisionTime(iso){
  try{return new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short"}).format(new Date(iso))}catch{return ""}
}
function saveDemoApproval(status,name){
  const record={
    budget:"000123",
    revision:2,
    amount:720,
    status,
    name,
    decidedAt:new Date().toISOString()
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
    out.className="decision-result";
    out.innerHTML="";
    return;
  }
  input.value=record.name||input.value;
  input.disabled=true;
  actions.hidden=true;
  if(record.status==="approved"){
    out.className="decision-result decision-card approved";
    out.innerHTML='<b>✓ Orçamento aprovado</b><span>Revisão '+record.revision+' · R$ '+record.amount.toFixed(2).replace(".",",")+'</span><span>Confirmado por '+escapeHtml(record.name)+' em '+formatDecisionTime(record.decidedAt)+'</span><small>A oficina já pode visualizar esta decisão na demonstração.</small>';
  }else{
    out.className="decision-result decision-card revision";
    out.innerHTML='<b>↺ Revisão solicitada</b><span>Revisão '+record.revision+' · R$ '+record.amount.toFixed(2).replace(".",",")+'</span><span>Solicitado por '+escapeHtml(record.name)+' em '+formatDecisionTime(record.decidedAt)+'</span><small>A oficina deve ajustar o orçamento e enviar uma nova revisão.</small>';
  }
}
document.getElementById("approveBudget").addEventListener("click",()=>{
  const name=document.getElementById("approvalName").value.trim();
  if(!name){toast("Informe o nome para aprovar.");return}
  saveDemoApproval("approved",name);
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

renderDashboard();
renderOrders();
renderClients();
updatePhotoProgress();
renderApprovalState();
