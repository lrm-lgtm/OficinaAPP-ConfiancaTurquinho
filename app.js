const demoOrders=[
  {id:34,ref:"OF-0034",plate:"ABC1D23",vehicle:"Toyota Corolla 2.0",customer:"Cliente Exemplo",status:"Em serviço",kind:"service",opened:"Hoje 09:12",stage:"Serviço em execução"},
  {id:31,ref:"OF-0031",plate:"DEF4G56",vehicle:"Honda Civic",customer:"Marcos Silva",status:"Aguardando cliente",kind:"waiting",opened:"19/09 15:22",stage:"Orçamento enviado"},
  {id:28,ref:"OF-0028",plate:"XYZ9A88",vehicle:"VW T-Cross",customer:"Ana Paula",status:"Aguardando peça",kind:"waiting",opened:"17/09 10:05",stage:"Peça em falta"},
  {id:25,ref:"OF-0025",plate:"GHI2J34",vehicle:"Fiat Toro",customer:"Carlos Mendes",status:"Pronta",kind:"ready",opened:"20/09 08:10",stage:"Aguardando retirada"}
];

const views=[...document.querySelectorAll(".view")];
const navButtons=[...document.querySelectorAll("[data-go]")];
const bottom=[...document.querySelectorAll(".bottomnav button")];
const toastEl=document.getElementById("toast");
let currentFilter="all";
let deferredPrompt=null;

function toast(message){
  toastEl.textContent=message;
  toastEl.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer=setTimeout(()=>toastEl.classList.remove("show"),2200);
}

function go(name){
  views.forEach(v=>v.classList.toggle("active",v.dataset.view===name));
  bottom.forEach(b=>b.classList.toggle("active",b.dataset.go===name));
  window.scrollTo({top:0,behavior:"smooth"});
  if(name==="orders") renderOrders();
}

navButtons.forEach(btn=>btn.addEventListener("click",()=>go(btn.dataset.go)));

function badge(status){
  const cls=status==="Pronta"?"success":status==="Em serviço"?"blue":"warn";
  return '<span class="pill '+cls+'">'+status+"</span>";
}

function orderCard(o){
  return '<button class="card order-card" data-open-os="'+o.id+'">'+
    '<div class="order-top"><div><small>'+o.ref+" · "+o.plate+"</small><h4>"+o.vehicle+"</h4><small>"+o.customer+"</small></div>"+badge(o.status)+"</div>"+
    '<div class="order-meta"><span>'+o.opened+'</span><span>'+o.stage+"</span></div></button>";
}

function allOrders(){
  const saved=JSON.parse(localStorage.getItem("oficina-demo-orders")||"[]");
  return [...saved,...demoOrders];
}

function renderDashboard(){
  document.getElementById("dashboardOrders").innerHTML=allOrders().slice(0,3).map(orderCard).join("");
  bindOrderOpeners();
}

function renderOrders(){
  const q=(document.getElementById("orderSearch").value||"").toLowerCase().trim();
  const list=allOrders().filter(o=>{
    const filterOk=currentFilter==="all"||o.kind===currentFilter;
    const qOk=!q||[o.ref,o.plate,o.vehicle,o.customer,o.status].join(" ").toLowerCase().includes(q);
    return filterOk&&qOk;
  });
  document.getElementById("orderList").innerHTML=list.length?list.map(orderCard).join(""):'<div class="hint">Nenhuma OS encontrada.</div>';
  bindOrderOpeners();
}

function bindOrderOpeners(){
  document.querySelectorAll("[data-open-os]").forEach(btn=>{
    btn.onclick=()=>openDetail(Number(btn.dataset.openOs));
  });
}

function openDetail(id){
  const o=allOrders().find(x=>x.id===id)||demoOrders[0];
  const approved=id!==31;
  const exitDone=id===25;
  document.getElementById("osDetail").innerHTML=
    '<article class="card hero-os"><div class="row"><div><span class="muted">'+o.ref+'</span><h2>'+o.vehicle+'</h2><span class="muted">'+o.customer+" · "+o.plate+'</span></div>'+badge(o.status)+'</div></article>'+
    '<div class="timeline"><div class="step"><span>Aberta</span><b>'+o.opened+'</b></div><div class="step"><span>Diagnóstico</span><b>Concluído</b></div><div class="step"><span>Serviço</span><b>'+(o.kind==="ready"?"Concluído":"Em andamento")+'</b></div><div class="step"><span>Entrega</span><b>'+(o.kind==="ready"?"Pendente":"—")+'</b></div></div>'+
    '<article class="card locks"><b>Travas antes da entrega</b>'+
      '<div class="lock '+(approved?"ok":"warn")+'">'+(approved?"✓":"!")+' Orçamento '+(approved?"aprovado":"aguardando aprovação")+'</div>'+
      '<div class="lock ok">✓ Peças controladas por reserva/consumo</div>'+
      '<div class="lock '+(exitDone?"ok":"warn")+'">'+(exitDone?"✓":"!")+' Vistoria de saída '+(exitDone?"concluída":"pendente")+'</div>'+
    '</article>'+
    '<div class="detail-actions"><button class="btn" data-go="inspection">Vistoria</button><button class="btn" data-go="budget">Orçamento</button><button class="btn" data-go="mechanic">Área técnica</button><button class="btn primary" id="deliverBtn">Preparar entrega</button></div>';
  document.querySelectorAll("#osDetail [data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go));
  const deliver=document.getElementById("deliverBtn");
  deliver.onclick=()=>toast(exitDone?"OS apta para entrega.":"Entrega bloqueada: conclua a vistoria de saída.");
  go("detail");
}

document.getElementById("orderSearch").addEventListener("input",renderOrders);
document.querySelectorAll("[data-filter]").forEach(btn=>btn.addEventListener("click",()=>{
  currentFilter=btn.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach(x=>x.classList.toggle("active",x===btn));
  renderOrders();
}));

document.getElementById("newOsForm").addEventListener("submit",e=>{
  e.preventDefault();
  const fd=new FormData(e.currentTarget);
  const saved=JSON.parse(localStorage.getItem("oficina-demo-orders")||"[]");
  const id=Date.now();
  const order={
    id,
    ref:"OF-D"+String(id).slice(-4),
    plate:String(fd.get("plate")||"").toUpperCase()||"SEM PLACA",
    vehicle:String(fd.get("vehicle")||"").trim()||"Veículo a completar",
    customer:String(fd.get("customer")).trim(),
    status:"Aberta",
    kind:"waiting",
    opened:"Agora",
    stage:"Vistoria de entrada"
  };
  saved.unshift(order);
  localStorage.setItem("oficina-demo-orders",JSON.stringify(saved));
  e.currentTarget.reset();
  renderDashboard();
  renderOrders();
  toast("OS criada nesta demo.");
  go("inspection");
});

let requiredPhotos=0;
let optionalPhotos=0;
document.querySelectorAll("[data-shot]").forEach(btn=>btn.addEventListener("click",()=>{
  if(!btn.classList.contains("done")){
    btn.classList.add("done");
    btn.firstChild.textContent="✓";
    if(btn.dataset.required==="1") requiredPhotos++;
    else optionalPhotos++;
    document.getElementById("photoCount").textContent=requiredPhotos+"/4";
    toast("Foto "+btn.dataset.shot+" registrada na demo.");
  }
}));
document.getElementById("finishInspection").addEventListener("click",()=>{
  if(requiredPhotos<4){toast("Ainda faltam "+(4-requiredPhotos)+" fotos obrigatórias.");return}
  toast("Vistoria finalizada e congelada.");
  setTimeout(()=>go("detail"),650);
});

document.getElementById("addBudgetItem").addEventListener("click",()=>{
  const el=document.createElement("article");
  el.className="card lineitem";
  el.innerHTML="<div><b>Item demonstrativo</b><span>1 un × R$ 45,00</span></div><strong>R$ 45,00</strong>";
  document.getElementById("budgetItems").appendChild(el);
  toast("Item adicionado somente à interface demo.");
});
document.getElementById("copyApproval").addEventListener("click",async()=>{
  const link=location.origin+location.pathname+"#cliente";
  try{await navigator.clipboard.writeText(link);toast("Link de demonstração copiado.");}
  catch(e){toast("Link: "+link);}
});
document.getElementById("approveBudget").addEventListener("click",()=>{
  const name=document.getElementById("approvalName").value.trim();
  if(!name){toast("Informe o nome para confirmar.");return}
  const out=document.getElementById("decisionResult");
  out.style.color="#168b45";
  out.textContent="✓ Orçamento aprovado na demonstração por "+name+".";
});
document.getElementById("rejectBudget").addEventListener("click",()=>{
  const out=document.getElementById("decisionResult");
  out.style.color="#c23b3b";
  out.textContent="Orçamento recusado na demonstração.";
});
document.getElementById("finishService").addEventListener("click",()=>{
  const pending=[...document.querySelectorAll(".task input")].filter(x=>!x.checked).length;
  if(pending){toast("Ainda existem "+pending+" tarefas pendentes.");return}
  toast("Serviço concluído. Próxima etapa: vistoria de saída.");
});

document.querySelectorAll(".task input").forEach(input=>input.addEventListener("change",()=>{
  input.closest(".task").classList.toggle("done",input.checked);
}));

window.addEventListener("beforeinstallprompt",e=>{
  e.preventDefault();deferredPrompt=e;
  document.getElementById("installBtn").hidden=false;
});
document.getElementById("installBtn").addEventListener("click",async()=>{
  if(!deferredPrompt)return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt=null;
  document.getElementById("installBtn").hidden=true;
});

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
}

if(location.hash==="#cliente") go("client");
window.addEventListener("hashchange",()=>{if(location.hash==="#cliente")go("client")});

renderDashboard();
renderOrders();
