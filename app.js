const demoOrders=[
  {id:34,ref:"#000123",plate:"ABC1D23",vehicle:"Chevrolet Onix 1.0 2020",customer:"João da Silva",status:"Em orçamento",kind:"waiting",opened:"Hoje 09:12",stage:"Aguardando aprovação",complaint:"Barulho na suspensão dianteira.",health:"waiting_customer",promised:"Hoje 16:30",owner:"Recepção",blockedReason:"Aguardando aprovação do orçamento",blockedSince:new Date(Date.now()-2*60*60*1000).toISOString()},
  {id:31,ref:"#000121",plate:"ABC1D23",vehicle:"Chevrolet Onix 1.0",customer:"João da Silva",status:"Em execução",kind:"service",opened:"Hoje 08:40",stage:"Suspensão dianteira",complaint:"Barulho na dianteira.",health:"attention",promised:"Hoje 17:30",owner:"Turquinho"},
  {id:28,ref:"#000119",plate:"XY29A12",vehicle:"Hyundai HB20",customer:"Ana Paula",status:"Aguardando",kind:"waiting",opened:"20/09 16:10",stage:"Aguardando peça",complaint:"Revisão preventiva.",health:"waiting_parts",promised:"Amanhã 12:00",owner:"Turquinho",blockedReason:"Fornecedor confirmou peça para amanhã",blockedSince:new Date(Date.now()-5*60*60*1000).toISOString()},
  {id:25,ref:"#000116",plate:"DEF4G56",vehicle:"Honda Civic",customer:"Marcos Silva",status:"Pronta",kind:"ready",opened:"20/09 10:05",stage:"Aguardando retirada",complaint:"Freio dianteiro.",health:"done",promised:"Hoje 11:00",owner:"Recepção"},
  {id:24,ref:"#000115",plate:"GOL2H77",vehicle:"Volkswagen Gol 1.6",customer:"Carlos Mendes",status:"Em execução",kind:"service",opened:"19/09 14:25",stage:"Arrefecimento",complaint:"Aquecendo acima do normal.",health:"overdue",promised:"Ontem 17:00",owner:"Turquinho"}
];

const demoClients=[
  {id:1,name:"João da Silva",phone:"(19) 99876-1122",vehicle:"Chevrolet Onix · ABC1D23",orders:3},
  {id:2,name:"Ana Paula",phone:"(19) 98810-4421",vehicle:"Hyundai HB20 · XY29A12",orders:2},
  {id:3,name:"Marcos Silva",phone:"(19) 99102-8870",vehicle:"Honda Civic · DEF4G56",orders:5}
];

const APP_QUERY=new URLSearchParams(location.search);
const DEMO_MODE=APP_QUERY.get("demo")==="1";
const REAL_MODE=!DEMO_MODE;

const V11_SUPABASE_URL="https://koybcvdrbebeicxzitcf.supabase.co";
const V11_PUBLIC_BUDGET_ENDPOINT=V11_SUPABASE_URL+"/functions/v1/public-budget";
const V11_APPROVE_BUDGET_ENDPOINT=V11_SUPABASE_URL+"/functions/v1/approve-budget";
const V11_CREATE_PIX_ENDPOINT=V11_SUPABASE_URL+"/functions/v1/create-mercadopago-pix";
const V11_PUBLIC_PAYMENT_ENDPOINT=V11_SUPABASE_URL+"/functions/v1/public-payment";
const V11_PILOT_APPROVAL_TOKEN="59de1bbc-cf56-4579-a72b-a8f8e46cfe9d";
const V11_SUPABASE_PUBLISHABLE_KEY="sb_publishable_MxXw0bpUQ0RIXkhwFsILHw_TteIueoe";
const supabaseClient=window.supabase?.createClient
  ? window.supabase.createClient(V11_SUPABASE_URL,V11_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}})
  : null;
let staffSession=null;
let staffProfile=null;
let staffPermissions=[];
let assignableStaff=[];
let teamDirectory=[];
let permissionCatalog=[];
let rolePermissionRows=[];
let currentPermissionRole="manager";
let remoteBudgetState=null;
let remoteApprovalState=null;
let selectedBudgetOrderId=null;
let currentBudgetRevision=null;
let currentBudgetItems=[];
let currentApprovalToken=null;
let serverOrders=[];
let serverClients=[];
let serverDataReady=false;
let serverSyncing=false;
let selectedCustomerId=null;
let selectedCustomerHistory=null;

function hasPermission(permission){
  return DEMO_MODE || staffPermissions.includes("*") || staffPermissions.includes(permission);
}
function hasAnyPermission(...permissions){
  return DEMO_MODE || staffPermissions.includes("*") || permissions.some(permission=>staffPermissions.includes(permission));
}
function canView(name){
  if(name==="client-approval") return true;
  if(DEMO_MODE) return true;
  const map={
    dashboard:()=>hasAnyPermission("work_orders.read_all","work_orders.read_assigned"),
    orders:()=>hasAnyPermission("work_orders.read_all","work_orders.read_assigned"),
    detail:()=>hasAnyPermission("work_orders.read_all","work_orders.read_assigned"),
    mechanic:()=>hasAnyPermission("work_orders.write_all","work_orders.write_assigned"),
    clients:()=>hasPermission("customers.read"),
    "customer-detail":()=>hasPermission("customers.read"),
    "new-os":()=>hasPermission("work_orders.write_all"),
    budget:()=>hasPermission("budgets.read"),
    stock:()=>hasPermission("catalog.read"),
    finance:()=>hasPermission("finance.read"),
    team:()=>hasPermission("team.read")
  };
  return map[name]?map[name]():true;
}
function applyPermissionUI(){
  const navRules={
    dashboard:hasAnyPermission("work_orders.read_all","work_orders.read_assigned"),
    orders:hasAnyPermission("work_orders.read_all","work_orders.read_assigned"),
    clients:hasPermission("customers.read"),
    "new-os":hasPermission("work_orders.write_all"),
    mechanic:hasAnyPermission("work_orders.write_all","work_orders.write_assigned"),
    stock:hasPermission("catalog.read"),
    finance:hasPermission("finance.read"),
    team:hasPermission("team.read")
  };
  document.querySelectorAll("[data-go],[data-sheet-go]").forEach(el=>{
    const target=el.dataset.go||el.dataset.sheetGo;
    if(target in navRules) el.hidden=!navRules[target];
  });

  const setVisible=(selector,visible)=>{
    document.querySelectorAll(selector).forEach(el=>el.hidden=!visible);
  };
  setVisible("#newClientBtn,[data-sheet-client]",hasPermission("customers.write"));
  setVisible("#financeReceiptShortcut,#financeExpenseShortcut",hasPermission("finance.write"));
  setVisible("#addBudgetItem,#newBudgetRevision",hasPermission("budgets.write"));
  setVisible("#copyApproval",hasPermission("budgets.send"));
  setVisible("#inviteStaffBtn",hasPermission("team.manage"));

  const matrix=document.getElementById("permissionMatrix");
  if(matrix) matrix.classList.toggle("readonly",!hasPermission("team.manage"));
}

async function loadMyPermissions(){
  staffPermissions=[];
  if(!staffProfile?.active||!supabaseClient){applyPermissionUI();return}
  const {data,error}=await supabaseClient.rpc("my_permissions");
  if(!error && Array.isArray(data)) staffPermissions=data;
  applyPermissionUI();
}
async function loadAssignableStaff(){
  assignableStaff=[];
  if(!staffProfile?.active||!supabaseClient) return;
  if(!hasAnyPermission("work_orders.write_all","team.read")) return;
  const {data,error}=await supabaseClient.rpc("assignable_staff");
  if(!error) assignableStaff=data||[];
}

function isPublicApprovalRequest(){
  const params=new URLSearchParams(location.search);
  return Boolean(params.get("approval")||params.get("token")) || location.hash==="#aprovar";
}
function syncInternalAccessGate(message=""){
  const gate=document.getElementById("internalAccessGate");
  if(!gate) return;
  const publicMode=document.body.classList.contains("public-mode")||isPublicApprovalRequest();
  const active=Boolean(staffProfile?.active);
  const locked=REAL_MODE && !publicMode && !active;
  gate.hidden=!locked;
  document.body.classList.toggle("staff-locked",locked);
  const textEl=document.getElementById("internalAccessGateText");
  if(textEl){
    textEl.textContent=message || (
      staffSession?.user
        ? "Seu usuário existe, mas ainda precisa ser liberado para operar a oficina."
        : "Entre ou crie seu acesso para trabalhar com dados reais da oficina."
    );
  }
}
function requireActiveStaff(message="Acesso interno necessário."){
  if(DEMO_MODE||staffProfile?.active) return true;
  syncInternalAccessGate(message);
  openSheet(staffAuthSheet);
  return false;
}

function staffRoleLabel(role){
  return ({owner:"Proprietário",manager:"Gerente",reception:"Recepção",mechanic:"Mecânico",finance:"Financeiro"})[role]||role||"Sem perfil";
}
function renderStaffAuthState(message=""){
  const btn=document.getElementById("authStatusBtn");
  const badge=document.getElementById("staffAuthBadge");
  const card=document.getElementById("staffProfileCard");
  const form=document.getElementById("staffAuthForm");
  const logout=document.getElementById("staffLogoutBtn");
  const msg=document.getElementById("staffAuthMessage");
  const logged=Boolean(staffSession?.user);
  const active=Boolean(staffProfile?.active);

  if(btn){
    btn.textContent=active?"●":logged?"◐":"○";
    btn.classList.toggle("active-staff",active);
    btn.classList.toggle("pending-staff",logged&&!active);
    btn.title=active?(staffProfile.full_name+" · "+staffRoleLabel(staffProfile.role)):logged?"Acesso aguardando liberação":"Entrar no acesso interno";
  }
  if(badge){
    badge.textContent=active?"online":logged?"pendente":"offline";
    badge.classList.toggle("ok",active);
  }
  if(card){
    card.hidden=!logged;
    if(logged){
      document.getElementById("staffProfileName").textContent=staffProfile?.full_name||staffSession.user.email||"Usuário";
      document.getElementById("staffProfileRole").textContent=staffRoleLabel(staffProfile?.role);
      document.getElementById("staffProfileState").textContent=active?"Liberado":"Aguardando liberação";
      document.getElementById("staffProfileState").classList.toggle("ok",active);
    }
  }
  if(form) form.hidden=active;
  if(logout) logout.hidden=!logged;
  if(msg){
    msg.textContent=message || (active
      ?"Acesso interno ativo. Próxima etapa: sincronizar OS, fotos e financeiro com o servidor."
      : logged
        ?"Conta criada, mas ainda sem permissão para dados da oficina. Um responsável precisa liberar este usuário."
        :"Entre para acessar os dados reais da oficina.");
  }
  const desktopName=document.getElementById("desktopStaffName");
  const desktopRole=document.getElementById("desktopStaffRole");
  if(desktopName) desktopName.textContent=active?(staffProfile?.full_name||staffSession?.user?.email||"Usuário"):"Acesso interno";
  if(desktopRole) desktopRole.textContent=active?staffRoleLabel(staffProfile?.role):(logged?"Aguardando liberação":"Entrar");
  syncInternalAccessGate(message);
}
async function refreshStaffSession(message=""){
  if(!supabaseClient){renderStaffAuthState("Biblioteca do servidor indisponível neste navegador.");return}
  const {data:{session}}=await supabaseClient.auth.getSession();
  staffSession=session||null;
  staffProfile=null;
  if(staffSession?.user){
    const {data}=await supabaseClient.from("staff_profiles").select("id,full_name,role,active").eq("id",staffSession.user.id).maybeSingle();
    staffProfile=data||null;
  }
  renderStaffAuthState(message);
  if(staffProfile?.active){
    await loadMyPermissions();
    await loadAssignableStaff();
    await syncServerData({quiet:true});
  }else{
    staffPermissions=[];
    assignableStaff=[];
    serverDataReady=false;
    serverOrders=[];
    serverClients=[];
    applyPermissionUI();
  }
  syncInternalAccessGate(message);
}
function friendlyAuthError(error,action="login"){
  const raw=String(error?.message||error||"").trim();
  const lower=raw.toLowerCase();

  if(lower.includes("after ") && lower.includes("seconds")){
    const seconds=(raw.match(/after\s+(\d+)\s+seconds/i)||[])[1];
    return "O pedido já foi enviado. "+(seconds?"Aguarde "+seconds+" segundos e ":"")+"confira seu e-mail antes de tentar novamente.";
  }
  if(lower.includes("rate limit")) return "Muitas tentativas em pouco tempo. Aguarde cerca de 1 minuto e tente novamente.";
  if(lower.includes("email not confirmed")||lower.includes("email_not_confirmed")) return "Seu acesso já foi criado. Confirme o e-mail recebido e depois toque em Entrar.";
  if(lower.includes("user already registered")||lower.includes("already registered")) return "Este e-mail já possui acesso. Use o botão Entrar.";
  if(lower.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if(lower.includes("password")) return action==="signup"?"A senha precisa ter pelo menos 6 caracteres.":"Confira sua senha.";
  return action==="signup"?"Não foi possível criar o acesso agora. Tente novamente em instantes.":"Não foi possível entrar agora. Tente novamente.";
}

async function staffLogin(){
  if(!supabaseClient) return toast("Acesso ao servidor indisponível.");
  const email=document.getElementById("staffAuthEmail").value.trim();
  const password=document.getElementById("staffAuthPassword").value;
  if(!email||!password) return toast("Informe e-mail e senha.");
  const {error}=await supabaseClient.auth.signInWithPassword({email,password});
  if(error){renderStaffAuthState(friendlyAuthError(error,"login"));return}
  await refreshStaffSession("Login realizado.");
}
async function staffSignup(){
  if(!supabaseClient) return toast("Acesso ao servidor indisponível.");
  const fullName=document.getElementById("staffAuthName").value.trim();
  const email=document.getElementById("staffAuthEmail").value.trim();
  const password=document.getElementById("staffAuthPassword").value;
  if(!fullName||!email||password.length<6) return toast("Informe nome, e-mail e senha com 6+ caracteres.");
  const signupBtn=document.getElementById("staffSignupBtn");
  signupBtn.disabled=true;
  try{
    const {data,error}=await supabaseClient.auth.signUp({email,password,options:{data:{full_name:fullName}}});
    if(error){renderStaffAuthState(friendlyAuthError(error,"signup"));return}
    await refreshStaffSession(data.session
      ?"Conta criada. Seu perfil já pode ser validado pela oficina."
      :"Conta criada. Confirme o e-mail recebido e depois toque em Entrar.");
  }finally{
    signupBtn.disabled=false;
  }
}

function approvalTokenFromUrl(){
  const params=new URLSearchParams(location.search);
  const candidate=params.get("approval")||params.get("token");
  if(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(candidate||"")) return candidate;
  if(currentApprovalToken) return currentApprovalToken;
  return DEMO_MODE?V11_PILOT_APPROVAL_TOKEN:null;
}
function moneyBR(value){
  return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(value||0));
}

function isDesktopUI(){
  return window.matchMedia("(min-width:1100px)").matches && !document.body.classList.contains("public-mode");
}

const views=[...document.querySelectorAll(".view")];
const desktopNav=[...document.querySelectorAll(".desktop-nav [data-go]")];
const bottom=[...document.querySelectorAll(".bottomnav button")];
const toastEl=document.getElementById("toast");
const appBack=document.getElementById("appBack");
let currentView="dashboard";
let previousView="dashboard";
let currentFilter="active";
let currentKanbanStage="today";
let currentKanbanHealth="";
let currentMechanicFilter="active";
let stockCatalog=[];
let workOrderPartsCache=new Map();
let reservedPartOrderId=null;
let currentFinanceTab="overview";
let financeTransactions=[];
let financeReceivables=[];
let wizardStep=1;
let requiredPhotos=new Set();
let completingQuickOrderId=null;
let deferredPrompt=null;

function toast(message){
  toastEl.textContent=message;
  toastEl.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer=setTimeout(()=>toastEl.classList.remove("show"),2300);
}

function go(name){
  const publicMode=name==="client-approval";
  if(name!=="detail" && document.body.classList.contains("desktop-drawer-open") && name!==currentView) closeDesktopOsDrawer();
  if(REAL_MODE && !publicMode && !staffProfile?.active){
    syncInternalAccessGate();
    return;
  }
  if(!publicMode && staffProfile?.active && !canView(name)){
    toast("Seu perfil não tem acesso a esta área.");
    return;
  }
  previousView=currentView;
  currentView=name;
  document.body.classList.toggle("public-mode",publicMode);
  views.forEach(v=>v.classList.toggle("active",v.dataset.view===name));
  bottom.forEach(b=>b.classList.toggle("active",b.dataset.go===name));
  desktopNav.forEach(b=>b.classList.toggle("active",b.dataset.go===name));
  const moreBtn=document.getElementById("moreNavBtn");
  if(moreBtn) moreBtn.classList.toggle("active",["stock","mechanic","finance","team"].includes(name));
  appBack.hidden=publicMode || ["dashboard","orders","clients"].includes(name);
  window.scrollTo({top:0,behavior:"smooth"});
  if(name==="orders") renderOrders();
  if(name==="clients") renderClients();
  if(name==="customer-detail") renderCustomerHistory();
  if(name==="finance") renderFinance();
  if(name==="team") renderTeam();
  if(name==="mechanic") renderMechanic();
  if(name==="stock") renderStock();
  if(name==="budget") renderBudget();
  if(name==="new-os") setWizardStep(1);
  if(name==="client-approval"){
    renderApprovalState();
    loadPublicBudgetFromServer();
    setTimeout(resizeApprovalSignature,60);
  }
  queueScrollLock();
}

document.querySelectorAll("[data-go]").forEach(btn=>btn.addEventListener("click",()=>{if(btn.dataset.go==="new-os") resetWizard();go(btn.dataset.go)}));
appBack.addEventListener("click",()=>go(previousView==="client-approval"?"budget":previousView||"dashboard"));

function statusBadge(status){
  let cls="open";
  if(/execução|aprovado/i.test(status)) cls="service";
  else if(/pronta/i.test(status)) cls="ready";
  else if(/aguard|orçamento|revisão/i.test(status)) cls="waiting";
  return '<span class="status '+cls+'">'+status+"</span>";
}

function serverStatusLabel(status){
  return ({
    open:"Aberta",
    inspection:"Vistoria",
    budget:"Em orçamento",
    waiting_approval:"Aguardando",
    approved:"Aprovado",
    in_service:"Em execução",
    ready:"Pronta",
    delivered:"Entregue",
    cancelled:"Cancelada"
  })[status]||status||"Aberta";
}
function serverStageLabel(row){
  if(row.status==="delivered") return "Entregue";
  if(row.status==="cancelled") return "Cancelada";
  if(row.status==="waiting_approval") return "Aguardando aprovação";
  if(row.status==="ready") return "Aguardando retirada";
  if(row.operational_state==="waiting_parts") return "Aguardando peça";
  if(row.operational_state==="waiting_customer") return "Aguardando cliente";
  if(["third_party","technical_difficulty","other"].includes(row.operational_state)) return "Bloqueada";
  if(row.status==="approved") return "Liberado para execução";
  if(row.status==="in_service") return "Em execução";
  if(row.status==="budget") return "Orçamento";
  if(row.status==="inspection") return "Vistoria";
  return "Entrada / diagnóstico";
}
function serverHealth(row){
  if(["ready","delivered","cancelled"].includes(row.status)) return "done";
  if(row.operational_state==="waiting_parts") return "waiting_parts";
  if(row.operational_state==="waiting_customer") return "waiting_customer";
  if(["third_party","technical_difficulty","other"].includes(row.operational_state)) return "blocked";
  if(row.customer_promised_at){
    const deadline=new Date(row.customer_promised_at).getTime();
    const now=Date.now();
    if(deadline<now) return "overdue";
    if(deadline-now<=6*60*60*1000) return "attention";
  }
  return "on_track";
}
function shortDateTime(value){
  if(!value) return "A definir";
  try{
    return new Intl.DateTimeFormat("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(value));
  }catch{return "A definir"}
}
function mapServerOrder(row){
  const customer=row.customers||{name:row.customer_name};
  const vehicle=row.vehicles||{
    plate:row.plate,
    make:row.vehicle_make,
    model:row.vehicle_model,
    version:row.vehicle_version,
    year:row.vehicle_year,
    km:row.vehicle_km
  };
  const vehicleText=[vehicle.make,vehicle.model,vehicle.version].filter(Boolean).join(" ")||"Veículo a completar";
  const kind=["delivered","cancelled"].includes(row.status)?"closed":row.status==="ready"?"ready":["approved","in_service"].includes(row.status)?"service":"waiting";
  return {
    id:row.id,
    server:true,
    customerId:row.customer_id,
    vehicleId:row.vehicle_id,
    ref:"#"+String(row.number||"—").padStart(6,"0"),
    plate:vehicle.plate||"SEM PLACA",
    vehicle:vehicleText,
    customer:customer.name||"Cliente",
    status:serverStatusLabel(row.status),
    kind,
    opened:shortDateTime(row.created_at),
    stage:serverStageLabel(row),
    complaint:row.complaint||"Sem relato inicial",
    health:serverHealth(row),
    promised:shortDateTime(row.customer_promised_at),
    forecast:shortDateTime(row.forecast_at),
    owner:row.assigned_name||(String(row.assigned_to||"")===String(staffProfile?.id||"")?staffProfile?.full_name:"Sem responsável"),
    assignedTo:row.assigned_to||null,
    assignedName:row.assigned_name||null,
    blockedReason:row.blocked_reason||"",
    blockedSince:row.blocked_since||null,
    nextReview:shortDateTime(row.next_review_at),
    raw:row
  };
}
async function syncServerData({quiet=false}={}){
  if(!supabaseClient||!staffProfile?.active||serverSyncing) return false;
  serverSyncing=true;
  try{
    const {data:rows,error}=await supabaseClient.rpc("work_orders_for_app");
    if(error) throw error;
    serverOrders=(rows||[]).map(mapServerOrder);

    let customers=[];
    if(hasPermission("customers.read")){
      const response=await supabaseClient
        .from("customers")
        .select("id,name,phone")
        .order("name",{ascending:true});
      if(response.error) throw response.error;
      customers=response.data||[];
    }
    serverClients=customers.map(c=>{
      const related=serverOrders.filter(o=>String(o.customerId)===String(c.id));
      const first=related.find(o=>o.vehicle&&o.vehicle!=="Veículo a completar");
      return {
        id:c.id,
        name:c.name,
        phone:c.phone||"—",
        vehicle:first?first.vehicle+" · "+first.plate:"Sem veículo vinculado",
        orders:related.length,
        server:true
      };
    });
    serverDataReady=true;
    renderDashboard();
    renderOrders();
    renderClients();
    if(currentView==="mechanic") renderMechanic();
    if(currentView==="stock") renderStock();
    if(!quiet) toast("Dados sincronizados com o servidor.");
    return true;
  }catch(error){
    serverDataReady=false;
    if(!quiet) toast("Não foi possível sincronizar os dados internos.");
    return false;
  }finally{
    serverSyncing=false;
  }
}
async function findOrCreateServerCustomer(name,phone=""){
  const {data:existing}=await supabaseClient.from("customers").select("id,name,phone").ilike("name",name).limit(1).maybeSingle();
  if(existing) return existing;
  const {data,error}=await supabaseClient.from("customers").insert({name,phone:phone||null}).select("id,name,phone").single();
  if(error) throw error;
  return data;
}
async function findOrCreateServerVehicle(customerId,fd){
  const plate=String(fd.get("plate")||"").trim().toUpperCase();
  const vehicleText=String(fd.get("vehicle")||"").trim();
  const yearRaw=parseInt(String(fd.get("year")||"").replace(/\D/g,""),10);
  const kmRaw=parseInt(String(fd.get("km")||"").replace(/\D/g,""),10);

  if(plate){
    const {data:existing}=await supabaseClient.from("vehicles").select("id,customer_id,plate,make,model,version,year,km").eq("plate",plate).maybeSingle();
    if(existing) return existing;
  }
  if(!plate && !vehicleText) return null;
  const {data,error}=await supabaseClient.from("vehicles").insert({
    customer_id:customerId,
    plate:plate||null,
    model:vehicleText||null,
    year:Number.isFinite(yearRaw)?yearRaw:null,
    km:Number.isFinite(kmRaw)?kmRaw:null
  }).select("id,customer_id,plate,make,model,version,year,km").single();
  if(error) throw error;
  return data;
}
async function uploadInspectionPhotos(workOrderId){
  const rows=[];
  for(const card of document.querySelectorAll(".capture-card")){
    const input=card.querySelector("input");
    const file=input?.files?.[0];
    if(!file) continue;
    const slot=card.dataset.slot||"other";
    const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
    const path=workOrderId+"/entry/"+slot+"-"+crypto.randomUUID()+"."+ext;
    const {error:uploadError}=await supabaseClient.storage.from("oficina-evidence").upload(path,file,{contentType:file.type||"image/jpeg",upsert:false});
    if(uploadError) throw uploadError;
    rows.push({
      work_order_id:workOrderId,
      phase:"entry",
      slot,
      storage_path:path,
      required:card.classList.contains("required")
    });
  }
  if(rows.length){
    const {error}=await supabaseClient.from("inspection_photos").insert(rows);
    if(error) throw error;
  }
}
async function uploadQuickCompletionPhotos(workOrderId){
  const {data:existingRows,error:existingError}=await supabaseClient
    .from("inspection_photos")
    .select("slot,phase")
    .eq("work_order_id",workOrderId)
    .eq("phase","entry");
  if(existingError) throw existingError;

  const existingRequired=new Set((existingRows||[]).map(row=>row.slot));
  const rows=[];
  for(const card of document.querySelectorAll(".capture-card")){
    const input=card.querySelector("input");
    const file=input?.files?.[0];
    if(!file) continue;

    const slot=card.dataset.slot||"other";
    if(card.classList.contains("required") && existingRequired.has(slot)) continue;

    const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
    const storagePath=workOrderId+"/entry/"+slot+"-"+crypto.randomUUID()+"."+ext;
    const {error:uploadError}=await supabaseClient.storage
      .from("oficina-evidence")
      .upload(storagePath,file,{contentType:file.type||"image/jpeg",upsert:false});
    if(uploadError) throw uploadError;

    rows.push({
      work_order_id:workOrderId,
      phase:"entry",
      slot,
      storage_path:storagePath,
      required:card.classList.contains("required")
    });
  }

  if(rows.length){
    const {error}=await supabaseClient.from("inspection_photos").insert(rows);
    if(error) throw error;
  }
}

async function completeQuickOrderOnServer(fd){
  const order=allOrders().find(o=>String(o.id)===String(completingQuickOrderId));
  if(!(order?.server&&staffProfile?.active&&supabaseClient)) throw new Error("quick_order_not_available");

  const customerId=order.raw?.customer_id;
  if(!customerId) throw new Error("quick_order_customer_missing");

  const vehicle=await findOrCreateServerVehicle(customerId,fd);
  await uploadQuickCompletionPhotos(order.id);

  const kmRaw=parseInt(String(fd.get("km")||"").replace(/\D/g,""),10);
  const complaint=String(fd.get("complaint")||"").trim()||order.complaint||"Sem relato inicial";

  const {data,error}=await supabaseClient.rpc("complete_quick_work_order",{
    p_work_order_id:order.id,
    p_vehicle_id:vehicle?.id||null,
    p_complaint:complaint,
    p_current_km:Number.isFinite(kmRaw)?kmRaw:null
  });
  if(error) throw error;

  await syncServerData({quiet:true});
  const mapped=serverOrders.find(o=>String(o.id)===String(order.id));
  toast("OS rápida completada sem criar outra OS.");
  return mapped||{...order,raw:{...(order.raw||{}),status:"budget"},status:"Em orçamento",stage:"Orçamento"};
}

async function persistOrderToServer(fd,quick){
  const customerName=String(fd.get("customer")||"").trim();
  const customer=await findOrCreateServerCustomer(customerName);
  const vehicle=await findOrCreateServerVehicle(customer.id,fd);
  const kmRaw=parseInt(String(fd.get("km")||"").replace(/\D/g,""),10);
  const complaint=String(fd.get("complaint")||"").trim()||"Sem relato inicial";

  const {data:order,error}=await supabaseClient.from("work_orders").insert({
    customer_id:customer.id,
    vehicle_id:vehicle?.id||null,
    status:quick?"open":"budget",
    complaint,
    current_km:Number.isFinite(kmRaw)?kmRaw:null,
    created_by:staffSession?.user?.id||null,
    operational_state:"active"
  }).select("id,number").single();
  if(error) throw error;

  if(!quick){
    await uploadInspectionPhotos(order.id);
    await supabaseClient.from("budget_revisions").insert({
      work_order_id:order.id,
      revision:1,
      status:"draft",
      subtotal:0,
      total:0,
      created_by:staffSession?.user?.id||null
    });
  }
  await supabaseClient.from("activity_log").insert({
    work_order_id:order.id,
    actor_user_id:staffSession?.user?.id||null,
    actor_type:"user",
    event_type:quick?"work_order_quick_created":"work_order_created",
    payload:{source:"pwa_v11_5",inspection:!quick}
  });

  await syncServerData({quiet:true});
  const mapped=serverOrders.find(o=>String(o.id)===String(order.id));
  toast(quick?"OS rápida salva no servidor.":"OS e vistoria salvas no servidor.");
  return mapped||{id:order.id,ref:"#"+String(order.number).padStart(6,"0"),customer:customerName};
}

function kanbanOverrides(){
  try{return JSON.parse(localStorage.getItem("oficina-kanban-overrides")||"{}")}catch{return {}}
}
function saveKanbanOverride(id,patch){
  const all=kanbanOverrides();
  all[String(id)]={...(all[String(id)]||{}),...patch,updatedAt:new Date().toISOString()};
  localStorage.setItem("oficina-kanban-overrides",JSON.stringify(all));
}
function applyKanbanOverride(o){
  const patch=kanbanOverrides()[String(o.id)];
  return patch?{...o,...patch}:o;
}

function localOrderHistory(){
  try{return JSON.parse(localStorage.getItem("oficina-os-history")||"{}")}catch{return {}}
}
function appendLocalOrderHistory(id,eventType,payload={}){
  const all=localOrderHistory();
  const key=String(id);
  all[key]=all[key]||[];
  all[key].unshift({
    event_type:eventType,
    payload,
    actor_type:"user",
    created_at:new Date().toISOString()
  });
  all[key]=all[key].slice(0,40);
  localStorage.setItem("oficina-os-history",JSON.stringify(all));
}
function historyLabel(eventType){
  return ({
    work_order_created:"OS criada",
    work_order_quick_created:"OS rápida criada",
    work_order_quick_completed:"OS rápida completada",
    kanban_fields_initialized:"Prazo operacional iniciado",
    work_order_operational_updated:"Andamento atualizado",
    budget_approved:"Orçamento aprovado pelo cliente",
    budget_revision_requested:"Cliente solicitou revisão",
    budget_sent:"Orçamento enviado para aprovação",
    inspection_completed:"Vistoria concluída",
    purchase_receipt_added:"Compra / comprovante anexado",
    expense_added:"Despesa interna vinculada",
    manual_payment_recorded:"Recebimento registrado",
    expense_settled:"Despesa baixada",
    stock_movement_recorded:"Movimentação de estoque",
    reserved_part_consumed:"Peça instalada",
    reserved_part_released:"Reserva de peça liberada",
    work_order_delivered:"Veículo entregue",
    work_order_cancelled:"OS cancelada"
  })[eventType]||"Atualização da OS";
}
function historyDetail(row){
  const p=row.payload||{};
  if(row.event_type==="work_order_quick_completed") return "Cadastro, veículo e vistoria de entrada concluídos na mesma OS.";
  if(row.event_type==="work_order_operational_updated"){
    const bits=[];
    if(p.reason) bits.push(p.reason);
    if(p.customer_promised_at) bits.push("Prazo: "+shortDateTime(p.customer_promised_at));
    if(p.forecast_at) bits.push("Previsão: "+shortDateTime(p.forecast_at));
    return bits.join(" · ")||"Situação operacional alterada.";
  }
  if(row.event_type==="budget_sent") return "Revisão "+(p.revision||"—")+" · "+moneyBR(p.total||0);
  if(row.event_type==="budget_approved") return "Revisão "+(p.revision||"—")+" · "+moneyBR(p.total||0);
  if(row.event_type==="budget_revision_requested") return "Orçamento devolvido para ajuste.";
  if(row.event_type==="purchase_receipt_added") return (p.supplier?String(p.supplier)+" · ":"")+moneyBR(p.total||0);
  if(row.event_type==="expense_added") return String(p.description||"Despesa")+" · "+moneyBR(p.amount||0);
  if(row.event_type==="manual_payment_recorded") return moneyBR(p.amount||0)+" · "+financeMethodLabel(p.method);
  if(row.event_type==="expense_settled") return moneyBR(p.amount||0)+" · "+financeMethodLabel(p.method);
  if(row.event_type==="stock_movement_recorded") return stockMovementLabel(p.movement_type)+" · "+Number(p.quantity_delta||0).toLocaleString("pt-BR");
  if(row.event_type==="reserved_part_consumed") return Number(p.quantity||0).toLocaleString("pt-BR")+" unidade(s)";
  if(row.event_type==="reserved_part_released") return Number(p.quantity||0).toLocaleString("pt-BR")+" unidade(s)";
  if(row.event_type==="work_order_delivered") return (p.final_km?"Saída: "+Number(p.final_km).toLocaleString("pt-BR")+" km · ":"")+"vistoria de saída concluída.";
  if(row.event_type==="work_order_cancelled") return String(p.reason||"Cancelamento registrado.")+(Number(p.released_quantity||0)>0?" · reserva liberada: "+Number(p.released_quantity).toLocaleString("pt-BR"):"");
  return p.inspection?"Vistoria de entrada registrada.":"";
}
async function loadOrderHistory(order){
  const target=document.querySelector(".view[data-view='detail'].active .os-history-list")||document.querySelector("#desktopOsDrawerContent .os-history-list");
  return loadOrderHistoryInto(order,target);
}

async function loadInspectionPhotos(order){
  const target=document.querySelector(".view[data-view='detail'].active .os-inspection-content")||document.querySelector("#desktopOsDrawerContent .os-inspection-content");
  return loadInspectionPhotosInto(order,target);
}


function getDemoApproval(){
  if(REAL_MODE) return null;
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
  if(staffProfile?.active && serverDataReady) return serverOrders;
  if(REAL_MODE) return [];
  const approval=remoteApprovalState||getDemoApproval();
  const demo=demoOrders.map(o=>{
    if(o.id!==34 || !approval) return o;
    const decision=approval.decision||approval.status;
    if(decision==="approved") return {...o,status:"Aprovado",kind:"service",stage:"Liberado para execução"};
    if(decision==="revision_requested"||decision==="revision") return {...o,status:"Revisão solicitada",kind:"waiting",stage:"Cliente solicitou revisão"};
    return o;
  });
  return [...JSON.parse(localStorage.getItem("oficina-orders")||"[]"),...demo].map(applyKanbanOverride);
}

function allClients(){
  if(staffProfile?.active && serverDataReady) return serverClients;
  if(REAL_MODE) return [];
  return [...JSON.parse(localStorage.getItem("oficina-clients")||"[]"),...demoClients];
}

function isClosedOrder(o){
  const status=String(o?.raw?.status||o?.status||"").toLowerCase();
  return o?.kind==="closed" || status==="delivered" || status==="cancelled" || /entregue|cancelada/.test(status);
}
function activeOrders(){
  return allOrders().filter(o=>!isClosedOrder(o));
}

function contextualAction(o){
  if(isClosedOrder(o)) return "Ver histórico";
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
    '<div class="compact-card-actions"><button class="context-action" data-order-action="'+o.id+'">'+contextualAction(o)+'</button>'+(isClosedOrder(o)?'':'<button class="compact-quick" data-quick-os="'+o.id+'" aria-label="Atualizar andamento">•••</button>')+'</div>'+
  '</article>';
}

function bindOrderOpeners(){
  document.querySelectorAll("[data-open-os]").forEach(btn=>btn.onclick=()=>openDetail(btn.dataset.openOs));
  document.querySelectorAll("[data-quick-os]").forEach(btn=>btn.onclick=event=>{
    event.stopPropagation();
    openOsQuickSheet(btn.dataset.quickOs);
  });
  document.querySelectorAll("[data-order-action]").forEach(btn=>btn.onclick=()=>{
    const o=allOrders().find(x=>String(x.id)===String(btn.dataset.orderAction));
    if(!o) return;
    if(/aprovação|orçamento/i.test(o.stage+" "+o.status)){
      selectedBudgetOrderId=o.id;
      go("budget");
    }else if(/pronta|retirada/i.test(o.stage+" "+o.status)){
      openDeliverySheet(o.id);
    }else openDetail(o.id);
  });
}

function kanbanHealth(o){
  const state=(o.health||"").toLowerCase();
  if(state) return state;
  const text=(o.stage+" "+o.status).toLowerCase();
  if(/pronta|retirada|entregue/.test(text)) return "done";
  if(/peça/.test(text)) return "waiting_parts";
  if(/aprovação|cliente/.test(text)) return "waiting_customer";
  if(/bloque/.test(text)) return "blocked";
  return "on_track";
}

function kanbanStage(o){
  const raw=o.raw||{};
  const status=String(raw.status||"").toLowerCase();
  if(status==="delivered"||status==="cancelled"||isClosedOrder(o)) return "closed";
  const operational=String(raw.operational_state||"").toLowerCase();
  const text=(o.stage+" "+o.status).toLowerCase();

  if(status==="ready"||status==="delivered"||/pronta|retirada|entregue/.test(text)) return "ready";
  if(operational==="waiting_parts"||/aguardando peça/.test(text)) return "waiting_parts";
  if(status==="waiting_approval"||operational==="waiting_customer"||/aguardando cliente|aprovação/.test(text)) return "waiting_customer";
  if(status==="approved"||status==="in_service"||/execução|liberado/.test(text)) return "service";
  if(status==="budget"||/orçamento/.test(text)) return "budget";
  return "entry";
}

const stageDefinitions=[
  {key:"today",label:"Hoje",title:"Prioridades de hoje",subtitle:"O que pede ação primeiro"},
  {key:"entry",label:"Entrada",title:"Entrada e diagnóstico",subtitle:"Veículos que ainda estão sendo avaliados"},
  {key:"budget",label:"Orçamento",title:"Em orçamento",subtitle:"Montagem e revisão antes do envio"},
  {key:"waiting_customer",label:"Cliente",title:"Aguardando cliente",subtitle:"Aprovação, retorno ou decisão"},
  {key:"waiting_parts",label:"Peça",title:"Aguardando peça",subtitle:"Dependências de fornecedor e estoque"},
  {key:"service",label:"Execução",title:"Em execução",subtitle:"Serviços liberados na oficina"},
  {key:"ready",label:"Prontas",title:"Prontas para retirada",subtitle:"Serviço concluído"}
];

function compactDuration(ms){
  const abs=Math.max(0,Math.round(ms/60000));
  if(abs<60) return abs+"min";
  const h=Math.round(abs/60);
  if(h<24) return h+"h";
  const d=Math.round(h/24);
  return d+"d";
}
function healthTimingLabel(o){
  const health=kanbanHealth(o);
  const raw=o.raw||{};
  if(["waiting_parts","waiting_customer","blocked"].includes(health) && (o.blockedSince||raw.blocked_since)){
    const since=new Date(o.blockedSince||raw.blocked_since).getTime();
    if(Number.isFinite(since)) return "há "+compactDuration(Date.now()-since);
  }
  const deadline=raw.customer_promised_at?new Date(raw.customer_promised_at).getTime():NaN;
  if(Number.isFinite(deadline)){
    const delta=deadline-Date.now();
    if(delta<0) return compactDuration(-delta)+" atrasada";
    if(delta<=6*60*60*1000) return "vence em "+compactDuration(delta);
  }
  return "";
}

function healthInfo(o){
  const rawStatus=String(o?.raw?.status||"").toLowerCase();
  if(rawStatus==="delivered") return {label:"Entregue",cls:"ready",icon:"✓"};
  if(rawStatus==="cancelled") return {label:"Cancelada",cls:"blocked",icon:"×"};
  const health=kanbanHealth(o);
  const map={
    overdue:{label:"Atrasada",cls:"danger",icon:"●"},
    attention:{label:"Atenção",cls:"warning",icon:"●"},
    waiting_parts:{label:"Aguardando peça",cls:"parts",icon:"●"},
    waiting_customer:{label:"Aguardando cliente",cls:"customer",icon:"●"},
    blocked:{label:"Bloqueada",cls:"blocked",icon:"Ⅱ"},
    done:{label:"Pronta",cls:"ready",icon:"✓"},
    on_track:{label:"No prazo",cls:"track",icon:"●"}
  };
  return map[health]||map.on_track;
}

function priorityRank(o){
  const health=kanbanHealth(o);
  return ({
    overdue:0,
    attention:1,
    blocked:2,
    waiting_parts:3,
    waiting_customer:4,
    on_track:5,
    done:6
  })[health]??7;
}

function kanbanCard(o){
  const health=healthInfo(o);
  const timing=healthTimingLabel(o);
  const forecast=o.forecast && o.forecast!=="A definir" && o.forecast!==o.promised
    ? '<span><em>Previsão</em>'+escapeHtml(o.forecast)+'</span>'
    : "";
  const reason=o.blockedReason
    ? '<div class="flow-reason">'+escapeHtml(o.blockedReason)+'</div>'
    : "";
  return '<article class="flow-card">'+
    '<button class="flow-card-open" data-open-os="'+o.id+'">'+
      '<div class="flow-card-main">'+
        '<div class="flow-card-title"><b>'+escapeHtml(o.plate)+'</b><span>'+escapeHtml(o.ref)+'</span></div>'+
        '<strong>'+escapeHtml(o.vehicle)+'</strong>'+
        '<small>'+escapeHtml(o.stage)+'</small>'+
      '</div>'+
      '<span class="health-badge '+health.cls+'"><i>'+health.icon+'</i><span>'+health.label+(timing?'<small>'+escapeHtml(timing)+'</small>':'')+'</span></span>'+
      '<div class="flow-times">'+
        '<span><em>Prazo cliente</em>'+escapeHtml(o.promised||"A definir")+'</span>'+
        forecast+
        '<span class="flow-owner"><em>Responsável</em>'+escapeHtml(o.owner||"Sem responsável")+'</span>'+
      '</div>'+
      reason+
    '</button>'+
    '<button class="flow-quick-btn" type="button" data-quick-os="'+o.id+'" aria-label="Atualizar andamento">•••</button>'+
  '</article>';
}

function filteredKanbanOrders(orders){
  let list=[...orders];
  if(currentKanbanStage!=="today"){
    list=list.filter(o=>kanbanStage(o)===currentKanbanStage);
  }else{
    list=list.filter(o=>kanbanStage(o)!=="ready" || kanbanHealth(o)==="done");
    list.sort((a,b)=>priorityRank(a)-priorityRank(b));
  }

  if(currentKanbanHealth){
    if(currentKanbanHealth==="blocked"){
      list=list.filter(o=>["blocked","waiting_parts","waiting_customer"].includes(kanbanHealth(o)));
    }else{
      list=list.filter(o=>kanbanHealth(o)===currentKanbanHealth);
    }
  }
  return list;
}

function renderKanban(orders){
  orders=(orders||[]).filter(o=>!isClosedOrder(o));
  const board=document.getElementById("kanbanBoard");
  if(!board) return;

  const count=(...keys)=>orders.filter(o=>keys.includes(kanbanHealth(o))).length;
  document.getElementById("kanbanOverdueCount").textContent=count("overdue");
  document.getElementById("kanbanAttentionCount").textContent=count("attention");
  document.getElementById("kanbanBlockedCount").textContent=count("blocked","waiting_parts","waiting_customer");
  document.getElementById("kanbanReadyCount").textContent=count("done");

  const stageCountMap={
    stageCountToday:orders.filter(o=>kanbanStage(o)!=="ready"||kanbanHealth(o)==="done").length,
    stageCountEntry:orders.filter(o=>kanbanStage(o)==="entry").length,
    stageCountBudget:orders.filter(o=>kanbanStage(o)==="budget").length,
    stageCountCustomer:orders.filter(o=>kanbanStage(o)==="waiting_customer").length,
    stageCountParts:orders.filter(o=>kanbanStage(o)==="waiting_parts").length,
    stageCountService:orders.filter(o=>kanbanStage(o)==="service").length,
    stageCountReady:orders.filter(o=>kanbanStage(o)==="ready").length
  };
  Object.entries(stageCountMap).forEach(([id,value])=>{
    const el=document.getElementById(id);
    if(el) el.textContent=value;
  });

  const stage=stageDefinitions.find(x=>x.key===currentKanbanStage)||stageDefinitions[0];
  const list=filteredKanbanOrders(orders);
  const healthLabel=currentKanbanHealth
    ? ({
        overdue:" · somente atrasadas",
        attention:" · somente atenção",
        blocked:" · somente bloqueadas",
        done:" · somente prontas"
      })[currentKanbanHealth]||""
    : "";

  const title=document.getElementById("kanbanViewTitle");
  const subtitle=document.getElementById("kanbanViewSubtitle");
  const viewCount=document.getElementById("kanbanViewCount");
  if(title) title.textContent=stage.title;
  if(subtitle) subtitle.textContent=stage.subtitle+healthLabel;
  if(viewCount) viewCount.textContent=list.length+" "+(list.length===1?"OS":"OS");

  if(isDesktopUI()){
    const desktopStages=stageDefinitions.filter(s=>s.key!=="today");
    const visibleOrders=currentKanbanHealth
      ? orders.filter(o=>currentKanbanHealth==="blocked"
          ? ["blocked","waiting_parts","waiting_customer"].includes(kanbanHealth(o))
          : kanbanHealth(o)===currentKanbanHealth)
      : orders;
    board.classList.add("desktop-kanban-board");
    board.innerHTML=desktopStages.map(stageDef=>{
      const rows=visibleOrders.filter(o=>kanbanStage(o)===stageDef.key).sort((a,b)=>priorityRank(a)-priorityRank(b));
      return '<section class="desktop-kanban-column">'+
        '<header><div><b>'+escapeHtml(stageDef.label)+'</b><small>'+escapeHtml(stageDef.subtitle)+'</small></div><span>'+rows.length+'</span></header>'+
        '<div class="desktop-kanban-cards">'+(rows.length?rows.map(kanbanCard).join(""):'<div class="desktop-column-empty">Sem OS</div>')+'</div>'+
      '</section>';
    }).join("");
    if(title) title.textContent="Fluxo completo da oficina";
    if(subtitle) subtitle.textContent=currentKanbanHealth?"Filtro de saúde ativo":"Arraste a visão horizontalmente se necessário";
    if(viewCount) viewCount.textContent=visibleOrders.length+" OS";
  }else{
    board.classList.remove("desktop-kanban-board");
    board.innerHTML=list.length
      ? list.map(kanbanCard).join("")
      : '<div class="flow-empty"><b>Nada por aqui</b><span>Nenhuma OS nesta combinação de etapa e alerta.</span></div>';
  }

  board.querySelectorAll("[data-open-os]").forEach(btn=>btn.onclick=()=>openDetail(btn.dataset.openOs));
  board.querySelectorAll("[data-quick-os]").forEach(btn=>btn.onclick=event=>{
    event.stopPropagation();
    openOsQuickSheet(btn.dataset.quickOs);
  });

  document.querySelectorAll("[data-stage-filter]").forEach(btn=>{
    btn.classList.toggle("active",btn.dataset.stageFilter===currentKanbanStage);
    btn.onclick=()=>{
      currentKanbanStage=btn.dataset.stageFilter;
      currentKanbanHealth="";
      renderKanban(activeOrders());
      queueScrollLock();
    };
  });

  document.querySelectorAll("[data-health-filter]").forEach(btn=>{
    const filter=btn.dataset.healthFilter;
    btn.classList.toggle("active",filter===currentKanbanHealth);
    btn.onclick=()=>{
      currentKanbanHealth=currentKanbanHealth===filter?"":filter;
      renderKanban(activeOrders());
      queueScrollLock();
    };
  });
}

function renderDashboard(){
  const orders=activeOrders();
  const budgets=orders.filter(o=>/aprovação|orçamento|revisão/i.test(o.stage+" "+o.status));
  const service=orders.filter(o=>/execução|liberado|aprovado/i.test(o.stage+" "+o.status));
  document.getElementById("openCount").textContent=orders.length;
  const budgetCount=document.getElementById("budgetCount");
  const serviceCount=document.getElementById("serviceCount");
  if(budgetCount) budgetCount.textContent=budgets.length;
  if(serviceCount) serviceCount.textContent=service.length;

  renderKanban(orders);
  const dashboardOrders=document.getElementById("dashboardOrders");
  if(dashboardOrders) dashboardOrders.innerHTML=orders.slice(0,3).map(orderCard).join("");
  bindOrderOpeners();
  queueScrollLock();
}

function desktopOrderRow(o){
  const health=healthInfo(o);
  const timing=healthTimingLabel(o);
  return '<article class="desktop-os-row">'+
    '<button class="desktop-os-main" data-open-os="'+o.id+'">'+
      '<div><b>'+escapeHtml(o.ref)+'</b><small>'+escapeHtml(o.plate)+'</small></div>'+
      '<div><b>'+escapeHtml(o.vehicle)+'</b><small>'+escapeHtml(o.customer)+'</small></div>'+
      '<div><b>'+escapeHtml(o.stage)+'</b><small>'+escapeHtml(o.status)+'</small></div>'+
      '<div><span class="desktop-health '+health.cls+'">'+health.label+(timing?' · '+escapeHtml(timing):'')+'</span></div>'+
      '<div><b>'+escapeHtml(o.promised||"A definir")+'</b><small>'+escapeHtml(o.owner||"Equipe")+'</small></div>'+
    '</button>'+
    '<div class="desktop-os-actions"><button data-order-action="'+o.id+'">'+contextualAction(o)+'</button>'+(isClosedOrder(o)?'':'<button data-quick-os="'+o.id+'">•••</button>')+'</div>'+
  '</article>';
}
function desktopOrdersTable(list){
  return '<div class="desktop-os-table">'+
    '<div class="desktop-os-head"><span>OS / placa</span><span>Veículo / cliente</span><span>Etapa</span><span>Saúde</span><span>Prazo / responsável</span><span>Ações</span></div>'+
    (list.length?list.map(desktopOrderRow).join(""):'<div class="desktop-table-empty">Nenhuma OS encontrada.</div>')+
  '</div>';
}

function renderOrders(){
  const q=(document.getElementById("orderSearch")?.value||"").toLowerCase().trim();
  const list=allOrders().filter(o=>{
    const closed=isClosedOrder(o);
    const filterOk=currentFilter==="closed"
      ? closed
      : currentFilter==="active"
        ? !closed
        : !closed && o.kind===currentFilter;
    const qOk=!q||[o.ref,o.plate,o.vehicle,o.customer,o.status,o.stage].join(" ").toLowerCase().includes(q);
    return filterOk&&qOk;
  });
  document.getElementById("orderList").innerHTML=isDesktopUI()
    ? desktopOrdersTable(list)
    : (list.length?list.map(orderCard).join(""):'<div class="muted">Nenhuma OS encontrada.</div>');
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

function mechanicFilterMatch(o){
  const stage=kanbanStage(o);
  if(currentMechanicFilter==="all") return ["service","waiting_parts","waiting_customer","entry","budget"].includes(stage);
  if(currentMechanicFilter==="waiting") return ["waiting_parts","waiting_customer"].includes(stage)||["blocked"].includes(kanbanHealth(o));
  return stage==="service";
}
function mechanicRealCard(o){
  const health=healthInfo(o);
  const timing=healthTimingLabel(o);
  return '<article class="mechanic-real-card">'+
    '<button class="mechanic-real-main" data-open-os="'+o.id+'">'+
      '<div class="mechanic-real-id"><b>'+escapeHtml(o.plate)+'</b><span>'+escapeHtml(o.ref)+'</span></div>'+
      '<div class="mechanic-real-copy"><b>'+escapeHtml(o.vehicle)+'</b><small>'+escapeHtml(o.complaint||"Sem relato")+'</small><span>'+escapeHtml(o.stage)+'</span></div>'+
      '<span class="health-badge '+health.cls+'"><i>'+health.icon+'</i><span>'+health.label+(timing?'<small>'+escapeHtml(timing)+'</small>':'')+'</span></span>'+
    '</button>'+
    '<button class="mechanic-real-update" data-quick-os="'+o.id+'">Atualizar</button>'+
  '</article>';
}
function renderMechanic(){
  const target=document.getElementById("mechanicList");
  if(!target) return;
  const list=allOrders().filter(mechanicFilterMatch).sort((a,b)=>priorityRank(a)-priorityRank(b));
  target.innerHTML=list.length?list.map(mechanicRealCard).join(""):'<div class="search-empty">Nenhuma OS neste filtro.</div>';
  bindOrderOpeners();
}
document.querySelectorAll("[data-mechanic-filter]").forEach(btn=>btn.addEventListener("click",()=>{
  currentMechanicFilter=btn.dataset.mechanicFilter;
  document.querySelectorAll("[data-mechanic-filter]").forEach(x=>x.classList.toggle("active",x===btn));
  renderMechanic();
}));

async function renderStock(){
  const target=document.getElementById("stockList");
  const summary=document.getElementById("stockSummary");
  if(!target) return;
  if(!(staffProfile?.active&&supabaseClient)){
    target.innerHTML='<div class="search-empty">Entre para consultar dados reais.</div>';
    return;
  }
  target.innerHTML='<div class="search-empty">Carregando catálogo…</div>';
  const {data,error}=await supabaseClient.rpc("stock_catalog_for_app");
  if(error){
    target.innerHTML='<div class="search-empty">Não foi possível carregar o catálogo.</div>';
    return;
  }
  stockCatalog=data||[];
  renderStockRows();
  if(summary){
    const tracked=stockCatalog.filter(x=>x.track_stock);
    const low=tracked.filter(x=>Number(x.available_qty||0)<=Number(x.min_stock_qty||0));
    const shortage=tracked.filter(x=>Number(x.shortage_qty||0)>0);
    summary.innerHTML=
      '<article><span>Catálogo</span><b>'+stockCatalog.length+'</b><small>itens ativos</small></article>'+
      '<article><span>Controlados</span><b>'+tracked.length+'</b><small>estoque ativo</small></article>'+
      '<article><span>Baixo saldo</span><b>'+low.length+'</b><small>disponível ≤ mínimo</small></article>'+
      '<article class="'+(shortage.length?"warn":"")+'"><span>Com falta</span><b>'+shortage.length+'</b><small>reservas sem saldo</small></article>';
  }
}
function renderStockRows(){
  const target=document.getElementById("stockList");
  if(!target) return;
  const q=(document.getElementById("stockSearch")?.value||"").trim().toLowerCase();
  const list=stockCatalog.filter(x=>!q||[x.name,x.sku||"",budgetKindText(x.kind)].join(" ").toLowerCase().includes(q));
  target.innerHTML=list.length?list.map(item=>{
    const tracked=item.track_stock;
    const qty=Number(item.stock_qty||0);
    const reserved=Number(item.reserved_qty||0);
    const available=Number(item.available_qty??qty);
    const shortage=Number(item.shortage_qty||0);
    const min=Number(item.min_stock_qty||0);
    const low=tracked&&(available<=min||shortage>0);
    const action=hasPermission("catalog.write")
      ? '<button class="stock-row-action" data-stock-action="'+item.id+'">'+(tracked?"Movimentar":"Ativar controle")+'</button>'
      : "";
    return '<article class="stock-real-row '+(low?"low":"")+'">'+
      '<div class="stock-real-kind">'+(item.kind==="service"?"🔧":"▦")+'</div>'+
      '<div class="stock-real-copy"><b>'+escapeHtml(item.name)+'</b><small>'+escapeHtml(item.sku||budgetKindText(item.kind))+' · '+escapeHtml(item.unit||"un")+'</small></div>'+
      '<div class="stock-real-price"><span>Venda</span><b>'+moneyBR(item.sale_price)+'</b></div>'+
      '<div class="stock-real-qty"><span>'+ (tracked?"Disponível":"Controle") +'</span><b>'+(tracked?available.toLocaleString("pt-BR")+" "+escapeHtml(item.unit||"un"):"não controlado")+'</b>'+(tracked?'<small>físico '+qty.toLocaleString("pt-BR")+' · reservado '+reserved.toLocaleString("pt-BR")+' · mín. '+min.toLocaleString("pt-BR")+'</small>':'')+(shortage>0?'<em>falta '+shortage.toLocaleString("pt-BR")+'</em>':'')+'</div>'+
      action+
    '</article>';
  }).join(""):'<div class="search-empty">Nenhum item encontrado.</div>';

  target.querySelectorAll("[data-stock-action]").forEach(btn=>btn.addEventListener("click",async()=>{
    const item=stockCatalog.find(x=>String(x.id)===String(btn.dataset.stockAction));
    if(!item) return;
    if(!item.track_stock){
      const {error}=await supabaseClient.from("catalog_items").update({track_stock:true,stock_qty:Number(item.stock_qty||0)}).eq("id",item.id);
      if(error){toast("Não foi possível ativar o controle.");return}
      item.track_stock=true;
      renderStockRows();
      toast("Controle de estoque ativado. Registre a entrada inicial.");
    }
    await openStockMovement(item.id);
  }));
}

document.getElementById("stockSearch")?.addEventListener("input",renderStockRows);
const reservedPartSheet=document.getElementById("reservedPartSheet");
const stockMovementSheet=document.getElementById("stockMovementSheet");

function stockMovementLabel(type){
  return ({entry:"Entrada",consume:"Consumo",return:"Devolução",adjustment:"Ajuste"})[type]||type;
}
async function openStockMovement(itemId){
  const item=stockCatalog.find(x=>String(x.id)===String(itemId));
  if(!item) return;
  document.getElementById("stockMoveItemId").value=item.id;
  document.getElementById("stockMoveName").textContent=item.name;
  document.getElementById("stockMoveMeta").textContent=(item.sku||budgetKindText(item.kind))+" · "+(item.unit||"un");
  document.getElementById("stockMoveBalance").textContent=Number((item.available_qty??item.stock_qty)||0).toLocaleString("pt-BR")+" "+(item.unit||"un")+" disponíveis";
  document.getElementById("stockMoveType").value="entry";
  document.getElementById("stockMoveQty").value="1";
  document.getElementById("stockMoveCost").value="";
  document.getElementById("stockMoveOrder").value="";
  document.getElementById("stockMoveNote").value="";
  document.getElementById("stockMoveCostWrap").hidden=!hasPermission("finance.write");
  syncStockMoveFields();
  openSheet(stockMovementSheet);
  await loadStockMovementHistory(item.id);
}
function syncStockMoveFields(){
  const type=document.getElementById("stockMoveType")?.value||"entry";
  const orderWrap=document.getElementById("stockMoveOrderWrap");
  const hint=document.getElementById("stockMoveHint");
  if(orderWrap) orderWrap.hidden=type==="entry";
  if(hint){
    hint.textContent={
      entry:"Entrada aumenta o saldo disponível.",
      consume:"Consumo reduz o saldo e deve ser vinculado à OS quando possível.",
      return:"Devolução devolve a peça ao saldo.",
      adjustment:"Ajuste aceita quantidade positiva ou negativa para inventário físico."
    }[type];
  }
}
async function loadStockMovementHistory(itemId){
  const target=document.getElementById("stockMoveHistory");
  if(!target) return;
  const {data,error}=await supabaseClient.from("stock_movements")
    .select("id,movement_type,quantity_delta,note,created_at,work_order_id")
    .eq("catalog_item_id",itemId)
    .order("created_at",{ascending:false})
    .limit(12);
  if(error){
    target.innerHTML='<div class="search-empty">Histórico indisponível.</div>';
    return;
  }
  target.innerHTML=(data||[]).length?(data||[]).map(row=>
    '<article class="stock-move-history-row">'+
      '<div><b>'+escapeHtml(stockMovementLabel(row.movement_type))+'</b><small>'+formatDecisionTime(row.created_at)+(row.note?' · '+escapeHtml(row.note):'')+'</small></div>'+
      '<strong class="'+(Number(row.quantity_delta)>=0?"positive":"negative")+'">'+(Number(row.quantity_delta)>=0?"+":"")+Number(row.quantity_delta).toLocaleString("pt-BR")+'</strong>'+
    '</article>'
  ).join(""):'<div class="search-empty">Nenhuma movimentação registrada.</div>';
}
document.getElementById("stockMoveType")?.addEventListener("change",syncStockMoveFields);
document.getElementById("reservedPartForm")?.addEventListener("submit",async event=>{
  event.preventDefault();
  if(!hasAnyPermission("stock.consume_all","stock.consume_assigned")) return toast("Seu perfil não pode confirmar instalação.");
  const reservationId=document.getElementById("reservedPartId").value;
  const qty=parseMoneyInput(document.getElementById("reservedPartQty").value);
  const note=document.getElementById("reservedPartNote").value.trim();
  const submit=event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled=true;
  try{
    const {error}=await supabaseClient.rpc("consume_reserved_stock",{
      p_reservation_id:reservationId,
      p_quantity:qty,
      p_note:note||null
    });
    if(error){
      if(String(error.message||"").includes("invalid_quantity")) toast("A quantidade precisa estar dentro do que está reservado.");
      else if(String(error.message||"").includes("insufficient_stock")) toast("O saldo físico não é suficiente.");
      else toast("Não foi possível confirmar a instalação.");
      return;
    }
    closeSheets();
    await refreshOpenOrderParts(reservedPartOrderId);
    toast("Peça instalada e baixada do estoque.");
  }finally{submit.disabled=false}
});
document.getElementById("releaseReservedPart")?.addEventListener("click",async()=>{
  const reservationId=document.getElementById("reservedPartId").value;
  const note=document.getElementById("reservedPartNote").value.trim()||"Peça não utilizada";
  const btn=document.getElementById("releaseReservedPart");
  btn.disabled=true;
  try{
    const {error}=await supabaseClient.rpc("release_reserved_stock",{p_reservation_id:reservationId,p_note:note});
    if(error){toast("Não foi possível liberar a reserva.");return}
    closeSheets();
    await refreshOpenOrderParts(reservedPartOrderId);
    toast("Reserva restante liberada.");
  }finally{btn.disabled=false}
});

document.getElementById("stockMovementForm")?.addEventListener("submit",async event=>{
  event.preventDefault();
  if(!hasPermission("catalog.write")) return toast("Seu perfil não pode movimentar estoque.");
  const itemId=document.getElementById("stockMoveItemId").value;
  const type=document.getElementById("stockMoveType").value;
  const qty=parseMoneyInput(document.getElementById("stockMoveQty").value);
  const note=document.getElementById("stockMoveNote").value.trim();
  const orderInput=document.getElementById("stockMoveOrder").value.trim();
  const costText=document.getElementById("stockMoveCost").value.trim();
  const cost=costText?parseMoneyInput(costText):null;
  const submit=event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled=true;
  try{
    let orderId=null;
    if(orderInput){
      const order=await resolveWorkOrderFromInput(orderInput);
      if(!order){toast("OS não encontrada.");return}
      orderId=order.id;
    }
    const {error}=await supabaseClient.rpc("record_stock_movement",{
      p_catalog_item_id:itemId,
      p_movement_type:type,
      p_quantity:qty,
      p_work_order_id:orderId,
      p_note:note||null,
      p_unit_cost:hasPermission("finance.write")?cost:null
    });
    if(error){
      if(String(error.message||"").includes("stock_reserved_or_insufficient")) toast("Esse saldo está reservado para outra OS ou é insuficiente.");
      else if(String(error.message||"").includes("insufficient_stock")) toast("Saldo insuficiente para esse consumo.");
      else if(String(error.message||"").includes("stock_not_enabled")) toast("Ative o controle de estoque deste item.");
      else toast("Não foi possível registrar a movimentação.");
      return;
    }
    await renderStock();
    const item=stockCatalog.find(x=>String(x.id)===String(itemId));
    if(item){
      document.getElementById("stockMoveBalance").textContent=Number(item.stock_qty||0).toLocaleString("pt-BR")+" "+(item.unit||"un");
      await loadStockMovementHistory(itemId);
    }
    toast("Movimentação registrada.");
  }finally{submit.disabled=false}
});

document.querySelectorAll("[data-permission-role]").forEach(btn=>btn.addEventListener("click",()=>{
  currentPermissionRole=btn.dataset.permissionRole;
  document.querySelectorAll("[data-permission-role]").forEach(x=>x.classList.toggle("active",x===btn));
  renderPermissionMatrix();
}));
document.getElementById("refreshTeamBtn")?.addEventListener("click",renderTeam);

function teamStatusLabel(member){
  if(member.status==="invited") return "Convite pendente";
  return member.active?"Ativo":"Bloqueado";
}
function teamRoleDescription(role){
  return ({
    owner:"Acesso total ao sistema.",
    manager:"Gerencia operação, orçamento e financeiro. Não administra usuários.",
    reception:"Clientes, OS, vistoria e orçamento. Sem custos internos.",
    mechanic:"Somente OS atribuídas e evidências técnicas. Sem valores.",
    finance:"Financeiro, recebíveis e leitura operacional."
  })[role]||"Perfil interno.";
}
function teamMemberCard(member){
  const initials=(member.full_name||"?").split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase();
  const actionable=Boolean(member.user_id)&&hasPermission("team.manage");
  return '<article class="team-member-card '+(member.active?"active":"")+'">'+
    '<div class="team-avatar">'+escapeHtml(initials)+'</div>'+
    '<div class="team-member-copy"><b>'+escapeHtml(member.full_name||"Usuário")+'</b><small>'+escapeHtml(member.email||"—")+'</small><span>'+escapeHtml(teamRoleLabel(member.role))+' · '+escapeHtml(teamStatusLabel(member))+'</span></div>'+
    '<div class="team-member-actions">'+
      (member.status==="invited"?'<span class="team-pending-badge">aguardando cadastro</span>':
        actionable?'<button type="button" data-edit-staff="'+member.user_id+'">Gerenciar</button>':'<span>'+escapeHtml(teamRoleDescription(member.role))+'</span>')+
    '</div>'+
  '</article>';
}
function teamRoleLabel(role){
  return staffRoleLabel(role);
}
async function renderTeam(){
  const list=document.getElementById("teamList");
  const matrix=document.getElementById("permissionMatrix");
  if(!list||!staffProfile?.active||!hasPermission("team.read")) return;
  list.innerHTML='<div class="search-empty">Carregando equipe…</div>';
  if(matrix) matrix.innerHTML='<div class="search-empty">Carregando permissões…</div>';

  const [directoryResult,catalogResult,rolesResult]=await Promise.all([
    supabaseClient.rpc("staff_directory"),
    supabaseClient.from("permission_catalog").select("permission,category,label,description,sort_order,visible").eq("visible",true).order("sort_order"),
    supabaseClient.from("role_permissions").select("role,permission,enabled")
  ]);

  if(directoryResult.error){
    list.innerHTML='<div class="search-empty">Não foi possível carregar a equipe.</div>';
    return;
  }
  teamDirectory=directoryResult.data||[];
  permissionCatalog=catalogResult.data||[];
  rolePermissionRows=rolesResult.data||[];

  document.getElementById("teamActiveCount").textContent=teamDirectory.filter(x=>x.active).length;
  document.getElementById("teamInviteCount").textContent=teamDirectory.filter(x=>x.status==="invited").length;
  document.getElementById("teamMechanicCount").textContent=teamDirectory.filter(x=>x.active&&x.role==="mechanic").length;

  list.innerHTML=teamDirectory.length?teamDirectory.map(teamMemberCard).join(""):'<div class="search-empty">Nenhum usuário cadastrado.</div>';
  list.querySelectorAll("[data-edit-staff]").forEach(btn=>btn.addEventListener("click",()=>openStaffMember(btn.dataset.editStaff)));
  renderPermissionMatrix();
}
function renderPermissionMatrix(){
  const target=document.getElementById("permissionMatrix");
  if(!target) return;
  const enabled=new Set(rolePermissionRows.filter(x=>x.role===currentPermissionRole&&x.enabled).map(x=>x.permission));
  const groups=new Map();
  permissionCatalog.forEach(item=>{
    if(!groups.has(item.category)) groups.set(item.category,[]);
    groups.get(item.category).push(item);
  });

  target.innerHTML=[...groups.entries()].map(([category,items])=>
    '<section class="permission-group"><h3>'+escapeHtml(category)+'</h3>'+
      items.map(item=>
        '<label class="permission-row">'+
          '<input type="checkbox" data-role-permission="'+escapeHtml(item.permission)+'" '+(enabled.has(item.permission)?"checked":"")+' '+(!hasPermission("team.manage")?"disabled":"")+'>'+
          '<span><b>'+escapeHtml(item.label)+'</b><small>'+escapeHtml(item.description)+'</small></span>'+
        '</label>'
      ).join("")+
    '</section>'
  ).join("");

  target.querySelectorAll("[data-role-permission]").forEach(input=>input.addEventListener("change",async()=>{
    const permission=input.dataset.rolePermission;
    input.disabled=true;
    const {error}=await supabaseClient.from("role_permissions").upsert({
      role:currentPermissionRole,
      permission,
      enabled:input.checked
    },{onConflict:"role,permission"});
    if(error){
      input.checked=!input.checked;
      toast("Não foi possível alterar a permissão.");
    }else{
      const existing=rolePermissionRows.find(x=>x.role===currentPermissionRole&&x.permission===permission);
      if(existing) existing.enabled=input.checked;
      else rolePermissionRows.push({role:currentPermissionRole,permission,enabled:input.checked});
      toast("Permissão atualizada.");
    }
    input.disabled=!hasPermission("team.manage");
  }));
}
function openStaffMember(userId){
  const member=teamDirectory.find(x=>String(x.user_id)===String(userId));
  if(!member) return;
  document.getElementById("staffMemberId").value=member.user_id;
  document.getElementById("staffMemberTitle").textContent=member.full_name;
  document.getElementById("staffMemberEmail").textContent=member.email||"—";
  document.getElementById("staffMemberRole").value=member.role;
  document.getElementById("staffMemberActive").checked=Boolean(member.active);
  document.getElementById("staffMemberStatus").textContent=member.active?"ativo":"bloqueado";
  document.getElementById("staffMemberHint").textContent=teamRoleDescription(member.role);
  openSheet(staffMemberSheet);
}

function desktopClientRow(c){
  return '<article class="desktop-client-row" data-client-id="'+c.id+'">'+
    '<div class="desktop-client-avatar">'+escapeHtml(c.name.charAt(0).toUpperCase())+'</div>'+
    '<div><b>'+escapeHtml(c.name)+'</b><small>'+escapeHtml(c.phone)+'</small></div>'+
    '<div><b>'+escapeHtml(c.vehicle)+'</b><small>Veículo principal</small></div>'+
    '<div><b>'+Number(c.orders||0)+'</b><small>Ordens</small></div>'+
  '</article>';
}
function desktopClientsTable(list){
  return '<div class="desktop-client-table">'+
    '<div class="desktop-client-head"><span></span><span>Cliente</span><span>Veículo</span><span>Histórico</span></div>'+
    (list.length?list.map(desktopClientRow).join(""):'<div class="desktop-table-empty">Nenhum cliente encontrado.</div>')+
  '</div>';
}

function clientCard(c){
  return '<article class="client-card" data-client-id="'+c.id+'"><div class="avatar">'+c.name.charAt(0).toUpperCase()+'</div><div style="flex:1"><h3>'+c.name+'</h3><p>'+c.phone+'</p><p>'+c.vehicle+'</p></div><span class="status open">'+c.orders+' OS</span></article>';
}
function renderClients(){
  const q=(document.getElementById("clientSearch").value||"").toLowerCase().trim();
  const list=allClients().filter(c=>!q||[c.name,c.phone,c.vehicle].join(" ").toLowerCase().includes(q));
  document.getElementById("clientList").innerHTML=isDesktopUI()
    ? desktopClientsTable(list)
    : list.map(clientCard).join("");
  bindClientOpeners();
  queueScrollLock();
}
function bindClientOpeners(){
  document.querySelectorAll("[data-client-id]").forEach(card=>card.addEventListener("click",event=>{
    if(event.target.closest("button,a,input,select,textarea")) return;
    openCustomerHistory(card.dataset.clientId);
  }));
}
async function openCustomerHistory(customerId){
  selectedCustomerId=customerId;
  selectedCustomerHistory=null;
  previousView="clients";
  go("customer-detail");
}
function vehicleHistoryCard(vehicle){
  const name=[vehicle.make,vehicle.model,vehicle.version].filter(Boolean).join(" ")||"Veículo sem modelo";
  return '<article class="customer-vehicle-card">'+
    '<div class="customer-vehicle-icon">🚗</div>'+
    '<div><b>'+escapeHtml(name)+'</b><small>'+escapeHtml(vehicle.plate||"SEM PLACA")+(vehicle.year?' · '+escapeHtml(String(vehicle.year)):'')+'</small>'+
      '<span>'+(vehicle.km!=null?Number(vehicle.km).toLocaleString("pt-BR")+' km':'Quilometragem não informada')+'</span></div>'+
  '</article>';
}
function customerHistoryOrderCard(order,vehicles){
  const vehicle=vehicles.find(v=>String(v.id)===String(order.vehicle_id));
  const vehicleName=vehicle?[vehicle.make,vehicle.model,vehicle.version].filter(Boolean).join(" "):"Veículo";
  const total=order.budget_total==null?"":'<strong>'+moneyBR(order.budget_total)+'</strong>';
  return '<article class="customer-history-order" data-open-history-os="'+order.id+'">'+
    '<div class="history-order-line"></div>'+
    '<div class="history-order-main">'+
      '<div class="history-order-head"><b>OS #'+String(order.number||"—").padStart(6,"0")+'</b><span>'+escapeHtml(serverStatusLabel(order.status))+'</span></div>'+
      '<strong>'+escapeHtml(vehicleName||"Veículo")+(vehicle?.plate?' · '+escapeHtml(vehicle.plate):'')+'</strong>'+
      '<small>'+shortDateTime(order.created_at)+(order.current_km!=null?' · '+Number(order.current_km).toLocaleString("pt-BR")+' km':'')+'</small>'+
      '<p>'+escapeHtml(order.complaint||"Sem relato inicial")+'</p>'+
    '</div>'+total+
  '</article>';
}
async function renderCustomerHistory(){
  const nameEl=document.getElementById("customerHistoryName");
  const contactEl=document.getElementById("customerHistoryContact");
  const vehiclesEl=document.getElementById("customerVehicleHistory");
  const ordersEl=document.getElementById("customerOrderHistory");
  if(!selectedCustomerId||!staffProfile?.active||!hasPermission("customers.read")){
    if(ordersEl) ordersEl.innerHTML='<div class="search-empty">Cliente não selecionado.</div>';
    return;
  }

  if(nameEl) nameEl.textContent="Carregando…";
  if(vehiclesEl) vehiclesEl.innerHTML='<div class="search-empty">Carregando veículos…</div>';
  if(ordersEl) ordersEl.innerHTML='<div class="search-empty">Carregando histórico…</div>';

  const {data,error}=await supabaseClient.rpc("customer_history_for_app",{p_customer_id:selectedCustomerId});
  if(error||!data){
    if(nameEl) nameEl.textContent="Cliente";
    if(ordersEl) ordersEl.innerHTML='<div class="search-empty">Não foi possível carregar o histórico.</div>';
    return;
  }

  selectedCustomerHistory=data;
  const customer=data.customer||{};
  const vehicles=data.vehicles||[];
  const orders=data.orders||[];

  if(nameEl) nameEl.textContent=customer.name||"Cliente";
  if(contactEl) contactEl.textContent=[customer.phone,customer.email].filter(Boolean).join(" · ")||"Sem contato cadastrado";
  document.getElementById("customerHistoryOrderCount").textContent=orders.length;
  document.getElementById("customerHistoryVehicleCount").textContent=vehicles.length;
  const kms=[...vehicles.map(v=>Number(v.km||0)),...orders.map(o=>Number(o.current_km||0))].filter(v=>v>0);
  document.getElementById("customerHistoryLastKm").textContent=kms.length?Math.max(...kms).toLocaleString("pt-BR")+" km":"—";
  const approvedTotal=orders.reduce((sum,o)=>sum+Number(o.budget_total||0),0);
  document.getElementById("customerHistoryApprovedTotal").textContent=hasPermission("budgets.read")?moneyBR(approvedTotal):"Privado";

  if(vehiclesEl) vehiclesEl.innerHTML=vehicles.length?vehicles.map(vehicleHistoryCard).join(""):'<div class="search-empty">Nenhum veículo cadastrado.</div>';
  if(ordersEl) ordersEl.innerHTML=orders.length?orders.map(o=>customerHistoryOrderCard(o,vehicles)).join(""):'<div class="search-empty">Nenhuma OS anterior.</div>';
  ordersEl?.querySelectorAll("[data-open-history-os]").forEach(btn=>btn.addEventListener("click",()=>openDetail(btn.dataset.openHistoryOs,true)));
}
document.getElementById("customerHistoryBack")?.addEventListener("click",()=>go("clients"));
document.getElementById("customerHistoryNewOs")?.addEventListener("click",()=>{
  const customer=selectedCustomerHistory?.customer;
  go("new-os");
  if(customer){
    document.getElementById("wizCustomer").value=customer.name||"";
    setWizardStep(2);
  }
});
document.getElementById("clientSearch").addEventListener("input",renderClients);

const modal=document.getElementById("clientModal");
document.getElementById("newClientBtn").addEventListener("click",()=>modal.hidden=false);
document.querySelector("[data-close-modal]").addEventListener("click",()=>modal.hidden=true);
modal.addEventListener("click",e=>{if(e.target===modal)modal.hidden=true});
document.getElementById("clientForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const fd=new FormData(e.currentTarget);
  const name=String(fd.get("name")).trim();
  const phone=String(fd.get("phone")||"").trim();
  if(staffProfile?.active && supabaseClient){
    try{
      await supabaseClient.from("customers").insert({name,phone:phone||null});
      await syncServerData({quiet:true});
      e.currentTarget.reset();modal.hidden=true;renderClients();toast("Cliente salvo no servidor.");
      return;
    }catch(error){
      toast("Não foi possível salvar o cliente no servidor.");
      return;
    }
  }
  if(REAL_MODE){
    requireActiveStaff("Entre para cadastrar clientes reais.");
    return;
  }
  const saved=JSON.parse(localStorage.getItem("oficina-clients")||"[]");
  saved.unshift({id:Date.now(),name,phone:phone||"—",vehicle:"Sem veículo vinculado",orders:0});
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

document.getElementById("quickCreate").addEventListener("click",async()=>{
  if(!customerValid()) return;
  const fd=new FormData(wizard);
  const order=await createOrder(fd,true);
  if(order && staffProfile?.active){resetWizard();openDetail(order.id)}
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

wizard.addEventListener("submit",async e=>{
  e.preventDefault();
  if(!customerValid())return;
  if(requiredPhotos.size!==4){setWizardStep(3);toast("As quatro fotos são obrigatórias para concluir a entrada.");return}
  const fd=new FormData(wizard);
  const goBudget=document.getElementById("goBudgetAfterCreate").checked;
  const submitBtn=e.submitter;
  if(submitBtn) submitBtn.disabled=true;
  try{
    const order=await createOrder(fd,false);
    if(!order) return;
    resetWizard();
    if(goBudget){selectedBudgetOrderId=order.id;go("budget")} else openDetail(order.id);
  }finally{
    if(submitBtn) submitBtn.disabled=false;
  }
});

async function createOrder(fd,quick){
  if(!quick && completingQuickOrderId && staffProfile?.active && supabaseClient){
    try{
      return await completeQuickOrderOnServer(fd);
    }catch(error){
      toast("Não foi possível completar esta OS. As fotos já enviadas foram preservadas.");
      return null;
    }
  }
  if(staffProfile?.active && supabaseClient){
    try{
      return await persistOrderToServer(fd,quick);
    }catch(error){
      toast("Falha ao salvar OS no servidor. Nada foi perdido no formulário.");
      return null;
    }
  }
  if(REAL_MODE){
    requireActiveStaff("Entre para criar uma Ordem de Serviço real.");
    return null;
  }
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
  appendLocalOrderHistory(order.id,quick?"work_order_quick_created":"work_order_created",{inspection:!quick});
  if(!quick) appendLocalOrderHistory(order.id,"inspection_completed",{inspection:true});
  renderDashboard();renderOrders();
  toast(quick?"OS rápida criada. Complete veículo e vistoria depois.":"OS criada com vistoria inicial.");
  if(quick){resetWizard();openDetail(order.id)}
  return order;
}
function resetWizard(){
  completingQuickOrderId=null;
  wizard.reset();requiredPhotos.clear();
  document.getElementById("wizardModeLabel").textContent="Nova Ordem de Serviço";
  document.getElementById("wizardSubmitBtn").textContent="Criar Ordem de Serviço";
  document.getElementById("wizCustomer").readOnly=false;
  document.getElementById("pickExistingClient").hidden=false;
  document.getElementById("quickCreate").hidden=false;
  document.querySelectorAll(".capture-card").forEach(card=>{
    card.classList.remove("captured");
    const input=card.querySelector("input");
    if(input){input.disabled=false;input.value=""}
    card.querySelector(".capture-preview").innerHTML='<span>'+(card.classList.contains("optional")?"＋":"📷")+'</span>';
  });
  updatePhotoProgress();setWizardStep(1);
}

async function loadQuickCompletionPhotos(order){
  if(!(order?.server&&staffProfile?.active&&supabaseClient)) return;
  const {data,error}=await supabaseClient
    .from("inspection_photos")
    .select("slot")
    .eq("work_order_id",order.id)
    .eq("phase","entry")
    .eq("required",true);
  if(error) return;
  const existing=new Set((data||[]).map(row=>row.slot));
  document.querySelectorAll(".capture-card.required").forEach(card=>{
    const slot=card.dataset.slot;
    if(!existing.has(slot)) return;
    requiredPhotos.add(slot);
    card.classList.add("captured");
    const input=card.querySelector("input");
    if(input) input.disabled=true;
    card.querySelector(".capture-preview").innerHTML="<span>✓</span>";
  });
  updatePhotoProgress();
}

async function startQuickOrderCompletion(order){
  resetWizard();
  completingQuickOrderId=order.id;
  document.getElementById("wizardModeLabel").textContent="Completar "+order.ref;
  document.getElementById("wizardSubmitBtn").textContent="Salvar cadastro e vistoria";
  const customer=document.getElementById("wizCustomer");
  customer.value=order.customer;
  customer.readOnly=true;
  document.getElementById("pickExistingClient").hidden=true;
  document.getElementById("quickCreate").hidden=true;

  wizard.elements.plate.value=order.plate==="SEM PLACA"?"":order.plate;
  wizard.elements.vehicle.value=order.vehicle==="Veículo a completar"?"":order.vehicle;
  wizard.elements.year.value=order.raw?.vehicle_year||"";
  wizard.elements.km.value=order.raw?.current_km||order.raw?.vehicle_km||"";
  wizard.elements.complaint.value=order.complaint==="Sem relato inicial"?"":order.complaint;

  go("new-os");
  setWizardStep(2);
  await loadQuickCompletionPhotos(order);
}

function budgetActionLabel(o){
  const state=(o.status+" "+o.stage).toLowerCase();
  if(state.includes("aprovado")||state.includes("liberado")) return "Ver orçamento aprovado";
  if(state.includes("aprovação")||state.includes("orçamento")||state.includes("revisão")) return "Abrir orçamento";
  return "Ir para orçamento";
}

let desktopDrawerOrderId=null;

function closeDesktopOsDrawer(){
  const drawer=document.getElementById("desktopOsDrawer");
  const content=document.getElementById("desktopOsDrawerContent");
  if(drawer) drawer.hidden=true;
  if(content) content.innerHTML="";
  desktopDrawerOrderId=null;
  document.body.classList.remove("desktop-drawer-open");
}
function shouldUseDesktopDrawer(){
  return isDesktopUI() && ["dashboard","orders","mechanic","stock","finance"].includes(currentView);
}
function renderOrderDetailInto(detail,o,useDrawer=false){
  const inspected=!o.quick;
  detail.innerHTML=
  '<article class="os-hero '+(useDrawer?'os-hero-drawer':'')+'">'+
    '<div class="os-cover"><div class="car-emoji">🚗</div><div class="os-cover-info"><span>'+o.ref+'</span><h1>'+escapeHtml(o.vehicle)+'</h1><span>'+escapeHtml(o.plate)+' · '+escapeHtml(o.customer)+'</span>'+statusBadge(o.status)+'</div></div>'+
    '<div class="os-tabs"><button class="active" data-os-tab="summary">Resumo</button><button data-os-tab="inspection">Vistoria</button><button data-os-tab="estimate">Orçamento</button><button data-os-tab="parts">Peças</button><button data-os-tab="history">Histórico</button></div>'+
    '<div class="tab-content">'+
      '<section class="tab-pane active" data-pane="summary">'+
        '<div class="info-block"><span>Relato do cliente</span><b>'+escapeHtml(o.complaint||"Sem relato inicial")+'</b></div>'+
        '<div class="info-block"><span>Status atual</span><b>'+escapeHtml(o.stage)+'</b></div>'+
        '<div class="info-block"><span>Entrada</span><b>'+escapeHtml(o.opened)+'</b></div>'+
        '<div class="info-block"><span>Responsável</span><b>'+escapeHtml(o.owner||"Sem responsável")+'</b></div>'+
        '<div class="operational-summary">'+
          '<div><span>Prazo cliente</span><b>'+escapeHtml(o.promised||"A definir")+'</b></div>'+
          '<div><span>Previsão atual</span><b>'+escapeHtml(o.forecast||"A definir")+'</b></div>'+
        '</div>'+
        (o.blockedReason?'<div class="info-block operational-alert"><span>Motivo / bloqueio</span><b>'+escapeHtml(o.blockedReason)+'</b></div>':'')+
        (String(o.raw?.status||"").toLowerCase()==="ready"&&hasPermission("work_orders.write_all")?'<button class="btn success full" data-deliver-os>✓ Registrar entrega do veículo</button>':'')+
        (o.quick?'<button class="btn primary full" data-complete-entry>Completar cadastro e vistoria</button>':'')+
        (!isClosedOrder(o)&&hasPermission("work_orders.write_all")?'<button class="btn cancel-outline full" data-cancel-os>Cancelar OS</button>':'')+
      '</section>'+
      '<section class="tab-pane" data-pane="inspection"><div class="os-inspection-content"><div class="inspection-loading">Carregando evidências…</div></div></section>'+
      '<section class="tab-pane" data-pane="estimate"><div class="info-block"><span>Orçamento</span><b>'+(o.status==="Em orçamento"?"Aguardando aprovação":"Disponível para consulta/edição")+'</b></div><div class="info-block"><span>Acesso rápido</span><b>Abra o orçamento sem perder o contexto desta OS.</b></div></section>'+
      '<section class="tab-pane" data-pane="parts"><div class="os-parts-content"><div class="inspection-loading">Carregando peças reservadas…</div></div></section>'+
      '<section class="tab-pane" data-pane="history"><div class="os-history-list"><div class="history-loading">Carregando histórico…</div></div></section>'+
    '</div>'+
    '<div class="os-global-actions os-global-actions-v118">'+
      (isClosedOrder(o)?'':'<button class="btn secondary full os-progress-shortcut" data-update-progress><span>↻</span>Atualizar andamento</button>')+
      '<button class="btn primary full os-budget-shortcut" data-open-budget><span>R$</span>'+budgetActionLabel(o)+'</button>'+
    '</div>'+
  '</article>';

  detail.querySelectorAll("[data-os-tab]").forEach(btn=>btn.addEventListener("click",()=>{
    detail.querySelectorAll("[data-os-tab]").forEach(x=>x.classList.toggle("active",x===btn));
    detail.querySelectorAll(".tab-pane").forEach(p=>p.classList.toggle("active",p.dataset.pane===btn.dataset.osTab));
    queueScrollLock();
  }));

  detail.querySelector("[data-update-progress]")?.addEventListener("click",()=>openOsQuickSheet(o.id));
  detail.querySelector("[data-deliver-os]")?.addEventListener("click",()=>openDeliverySheet(o.id));
  detail.querySelector("[data-cancel-os]")?.addEventListener("click",()=>openCancelWorkOrderSheet(o.id));
  detail.querySelector("[data-open-budget]")?.addEventListener("click",()=>{
    selectedBudgetOrderId=o.id;
    if(useDrawer) closeDesktopOsDrawer();
    go("budget");
  });

  detail.querySelector("[data-complete-entry]")?.addEventListener("click",()=>{
    if(useDrawer) closeDesktopOsDrawer();
    startQuickOrderCompletion(o);
  });

  loadOrderHistoryInto(o,detail.querySelector(".os-history-list"));
  loadInspectionPhotosInto(o,detail.querySelector(".os-inspection-content"));
  loadWorkOrderPartsInto(o,detail.querySelector(".os-parts-content"));
}

function partReservationState(row){
  const required=Number(row.required_qty||0);
  const reserved=Number(row.reserved_qty||0);
  const consumed=Number(row.consumed_qty||0);
  const released=Number(row.released_qty||0);
  const shortage=Number(row.shortage_qty||0);
  if(consumed>=required && required>0) return {label:"Instalada",cls:"done"};
  if(shortage>0) return {label:"Falta "+shortage.toLocaleString("pt-BR"),cls:"shortage"};
  if(consumed>0&&reserved>0) return {label:"Parcial",cls:"partial"};
  if(reserved>0) return {label:"Reservada",cls:"reserved"};
  if(released>0) return {label:"Liberada",cls:"released"};
  return {label:"Pendente",cls:"pending"};
}
async function loadWorkOrderPartsInto(order,target){
  if(!target) return;
  if(!(order.server&&staffProfile?.active&&supabaseClient)){
    target.innerHTML='<div class="search-empty">As reservas de peças aparecem após a aprovação real do orçamento.</div>';
    return;
  }
  target.innerHTML='<div class="inspection-loading">Carregando peças reservadas…</div>';
  const {data,error}=await supabaseClient.rpc("work_order_parts",{p_work_order_id:order.id});
  if(error){
    target.innerHTML='<div class="search-empty">Não foi possível carregar as peças desta OS.</div>';
    return;
  }
  const rows=data||[];
  rows.forEach(row=>workOrderPartsCache.set(String(row.reservation_id),{...row,work_order_id:order.id}));
  if(!rows.length){
    target.innerHTML='<div class="parts-empty"><b>Nenhuma peça reservada</b><span>Somente itens vinculados ao catálogo e com controle de estoque entram na reserva automática.</span></div>';
    return;
  }
  const canHandle=hasAnyPermission("stock.consume_all","stock.consume_assigned");
  target.innerHTML='<div class="parts-summary"><span>'+rows.length+' item'+(rows.length===1?"":"s")+' controlado'+(rows.length===1?"":"s")+'</span><small>Reserva na aprovação · baixa quando instalada</small></div>'+
    '<div class="os-parts-list">'+rows.map(row=>{
      const state=partReservationState(row);
      const required=Number(row.required_qty||0);
      const reserved=Number(row.reserved_qty||0);
      const consumed=Number(row.consumed_qty||0);
      const shortage=Number(row.shortage_qty||0);
      const remaining=Math.max(0,required-consumed-Number(row.released_qty||0));
      return '<article class="os-part-row '+state.cls+'">'+
        '<div class="os-part-copy"><div><b>'+escapeHtml(row.item_name)+'</b><span class="part-state '+state.cls+'">'+escapeHtml(state.label)+'</span></div>'+
          '<small>'+escapeHtml(row.sku||"Sem código")+' · necessário '+required.toLocaleString("pt-BR")+' '+escapeHtml(row.unit||"un")+'</small>'+
          '<div class="part-progress"><span style="width:'+Math.min(100,required?consumed/required*100:0)+'%"></span></div>'+
          '<em>instalado '+consumed.toLocaleString("pt-BR")+' · reservado '+reserved.toLocaleString("pt-BR")+(shortage>0?' · faltando '+shortage.toLocaleString("pt-BR"):'')+'</em>'+
        '</div>'+
        (canHandle&&remaining>0
          ? '<div class="os-part-actions">'+
              (reserved>0?'<button type="button" class="part-install" data-install-reservation="'+row.reservation_id+'">Instalar</button>':'')+
              '<button type="button" class="part-release" data-release-reservation="'+row.reservation_id+'">Liberar</button>'+
            '</div>'
          : '')+
      '</article>';
    }).join("")+'</div>';

  target.querySelectorAll("[data-install-reservation]").forEach(btn=>btn.addEventListener("click",()=>openReservedPartOperation(btn.dataset.installReservation,order.id)));
  target.querySelectorAll("[data-release-reservation]").forEach(btn=>btn.addEventListener("click",()=>releaseReservedPartDirect(btn.dataset.releaseReservation,order.id)));
}
async function openReservedPartOperation(reservationId,orderId){
  const row=workOrderPartsCache.get(String(reservationId));
  if(!row) return;
  reservedPartOrderId=orderId;
  document.getElementById("reservedPartId").value=row.reservation_id;
  document.getElementById("reservedPartName").textContent=row.item_name;
  document.getElementById("reservedPartMeta").textContent=(row.sku||"Sem código")+" · "+(row.unit||"un");
  document.getElementById("reservedPartAvailable").textContent=Number(row.reserved_qty||0).toLocaleString("pt-BR")+" "+(row.unit||"un")+" reservados";
  document.getElementById("reservedPartQty").value=Number(row.reserved_qty||0).toLocaleString("pt-BR");
  document.getElementById("reservedPartNote").value="";
  openSheet(reservedPartSheet);
}
async function refreshOpenOrderParts(orderId){
  const order=allOrders().find(o=>String(o.id)===String(orderId));
  if(!order) return;
  const target=document.querySelector("#desktopOsDrawerContent .os-parts-content")||document.querySelector(".view[data-view='detail'].active .os-parts-content");
  if(target) await loadWorkOrderPartsInto(order,target);
  if(currentView==="stock") await renderStock();
}
async function releaseReservedPartDirect(reservationId,orderId){
  if(!hasAnyPermission("stock.consume_all","stock.consume_assigned")) return toast("Seu perfil não pode liberar reservas.");
  const {error}=await supabaseClient.rpc("release_reserved_stock",{p_reservation_id:reservationId,p_note:"Peça não utilizada"});
  if(error){toast("Não foi possível liberar a reserva.");return}
  await refreshOpenOrderParts(orderId);
  toast("Reserva liberada.");
}
async function loadOrderHistoryInto(order,target){
  if(!target) return;
  let rows=[];
  if(order.server && staffProfile?.active && supabaseClient){
    target.innerHTML='<div class="history-loading">Carregando histórico…</div>';
    const {data,error}=await supabaseClient
      .from("activity_log")
      .select("event_type,payload,actor_type,created_at")
      .eq("work_order_id",order.id)
      .order("created_at",{ascending:false})
      .limit(30);
    if(!error) rows=data||[];
  }else{
    rows=localOrderHistory()[String(order.id)]||[];
    if(!rows.length){
      rows=[
        ...(order.quick?[]:[{event_type:"inspection_completed",payload:{inspection:true},actor_type:"user",created_at:new Date().toISOString()}]),
        {event_type:order.quick?"work_order_quick_created":"work_order_created",payload:{},actor_type:"user",created_at:new Date().toISOString()}
      ];
    }
  }
  target.innerHTML=rows.length
    ? rows.map(row=>{
        const detail=historyDetail(row);
        return '<article class="history-event"><i></i><div><b>'+escapeHtml(historyLabel(row.event_type))+'</b>'+
          (detail?'<small>'+escapeHtml(detail)+'</small>':'')+
          '<time>'+formatDecisionTime(row.created_at)+'</time></div></article>';
      }).join("")
    : '<div class="history-empty">Ainda não há eventos registrados.</div>';
}

async function loadInspectionPhotosInto(order,target){
  if(!target) return;
  if(!(order.server && staffProfile?.active && supabaseClient)){
    const inspected=!order.quick;
    target.innerHTML=inspected
      ? '<div class="info-block"><span>Vistoria de entrada</span><b>4 fotos obrigatórias registradas</b></div><div class="photo-strip"><div class="photo-thumb">🚗</div><div class="photo-thumb">🚘</div><div class="photo-thumb">↔</div><div class="photo-thumb">↔</div><div class="photo-thumb">＋</div></div>'
      : '<div class="info-block"><span>Vistoria de entrada</span><b>Pendente</b></div><div class="muted">Sem evidências ainda.</div>';
    return;
  }

  target.innerHTML='<div class="inspection-loading">Carregando evidências…</div>';
  const {data:photos,error}=await supabaseClient
    .from("inspection_photos")
    .select("id,slot,phase,storage_path,required,created_at")
    .eq("work_order_id",order.id)
    .in("phase",["entry","exit"])
    .order("created_at",{ascending:true});
  if(error){
    target.innerHTML='<div class="inspection-loading">Não foi possível carregar as fotos.</div>';
    return;
  }

  const rows=[];
  for(const photo of (photos||[])){
    const {data:signed}=await supabaseClient.storage.from("oficina-evidence").createSignedUrl(photo.storage_path,600);
    rows.push({...photo,url:signed?.signedUrl||""});
  }

  const slotLabel={front:"Frente",rear:"Traseira",left:"Lateral esquerda",right:"Lateral direita",panel:"Painel / km",other:"Outro"};
  const requiredSlots=["front","rear","left","right"];
  const phaseBlock=(phase,title,emptyText)=>{
    const phaseRows=rows.filter(x=>x.phase===phase);
    const requiredCount=new Set(phaseRows.filter(x=>x.required&&requiredSlots.includes(x.slot)).map(x=>x.slot)).size;
    return '<section class="inspection-phase-block">'+
      '<div class="info-block"><span>'+title+'</span><b>'+requiredCount+' de 4 obrigatórias registradas</b></div>'+
      (phaseRows.length
        ? '<div class="evidence-grid">'+phaseRows.map(photo=>
            '<button class="evidence-photo" type="button" data-evidence-url="'+escapeHtml(photo.url)+'">'+
              (photo.url?'<img src="'+escapeHtml(photo.url)+'" alt="'+escapeHtml(slotLabel[photo.slot]||photo.slot)+'">':'<div class="evidence-missing">Sem prévia</div>')+
              '<span>'+escapeHtml(slotLabel[photo.slot]||photo.slot)+'</span>'+
            '</button>'
          ).join("")+'</div>'
        : '<div class="inspection-loading">'+emptyText+'</div>')+
    '</section>';
  };

  const showExit=rows.some(x=>x.phase==="exit") || ["ready","delivered"].includes(String(order.raw?.status||"").toLowerCase());
  target.innerHTML=
    phaseBlock("entry","Vistoria de entrada","Nenhuma foto de entrada registrada nesta OS.")+
    (showExit?phaseBlock("exit","Vistoria de saída","Ainda não há fotos de saída. Use Registrar entrega para concluir a vistoria."):"");

  target.querySelectorAll("[data-evidence-url]").forEach(btn=>btn.addEventListener("click",()=>{
    const url=btn.dataset.evidenceUrl;
    if(url) window.open(url,"_blank","noopener");
  }));
}

function openDetail(id,forcePage=false){
  const o=allOrders().find(x=>String(x.id)===String(id))||(DEMO_MODE?demoOrders[0]:null);
  if(!o){toast("OS não encontrada no servidor.");return}

  const useDrawer=!forcePage && shouldUseDesktopDrawer();
  const pageDetail=document.getElementById("osDetail");
  const drawer=document.getElementById("desktopOsDrawer");
  const drawerContent=document.getElementById("desktopOsDrawerContent");

  if(useDrawer){
    pageDetail.innerHTML="";
    desktopDrawerOrderId=o.id;
    document.getElementById("desktopOsDrawerTitle").textContent=o.ref+" · "+o.plate;
    renderOrderDetailInto(drawerContent,o,true);
    drawer.hidden=false;
    document.body.classList.add("desktop-drawer-open");
    return;
  }

  closeDesktopOsDrawer();
  renderOrderDetailInto(pageDetail,o,false);
  go("detail");
}

document.getElementById("desktopOsDrawerClose")?.addEventListener("click",closeDesktopOsDrawer);
document.getElementById("desktopOsDrawerBackdrop")?.addEventListener("click",closeDesktopOsDrawer);
document.getElementById("desktopOsDrawerExpand")?.addEventListener("click",()=>{
  if(!desktopDrawerOrderId) return;
  const id=desktopDrawerOrderId;
  closeDesktopOsDrawer();
  openDetail(id,true);
});
document.addEventListener("keydown",event=>{
  if(event.key==="Escape" && document.body.classList.contains("desktop-drawer-open")) closeDesktopOsDrawer();
});

// ---- v12.0 functional budget revisions ----
const budgetItemSheet=document.getElementById("budgetItemSheet");
const budgetItemForm=document.getElementById("budgetItemForm");
let budgetCatalog=[];
let budgetCatalogFilter="all";

function localBudgetStore(){
  try{return JSON.parse(localStorage.getItem("oficina-budgets")||"{}")}catch{return {}}
}
function saveLocalBudgetStore(store){
  localStorage.setItem("oficina-budgets",JSON.stringify(store));
}
function seedLocalBudget(order){
  if(REAL_MODE) throw new Error("real_mode_requires_server");
  if(String(order?.id)==="34"){
    return {
      revision:{id:"local-rev-34-2",revision:2,status:"sent",subtotal:720,total:720,work_order_id:order.id},
      items:[
        {id:"local-item-1",kind:"part",description:"Barra estabilizadora",quantity:1,unit_price:320,line_total:320,sort_order:1},
        {id:"local-item-2",kind:"part",description:"Terminal de direção",quantity:1,unit_price:280,line_total:280,sort_order:2},
        {id:"local-item-3",kind:"service",description:"Alinhamento e balanceamento",quantity:1,unit_price:120,line_total:120,sort_order:3}
      ],
      approvalToken:V11_PILOT_APPROVAL_TOKEN
    };
  }
  return {
    revision:{id:"local-rev-"+String(order?.id||Date.now())+"-1",revision:1,status:"draft",subtotal:0,total:0,work_order_id:order?.id},
    items:[],
    approvalToken:null
  };
}
function budgetStatusText(status){
  return ({
    draft:"Rascunho",
    sent:"Aguardando aprovação",
    approved:"Aprovado",
    revision_requested:"Revisão solicitada",
    superseded:"Substituído",
    cancelled:"Cancelado"
  })[status]||status||"Rascunho";
}
function budgetKindText(kind){
  return ({part:"Peça",service:"Serviço",other:"Outro"})[kind]||kind||"Item";
}
function budgetEditable(){
  return ["draft","revision_requested"].includes(currentBudgetRevision?.status);
}
function renderBudgetState(order){
  const ref=document.getElementById("budgetOrderRef");
  const status=document.getElementById("budgetStatus");
  const rev=document.getElementById("budgetRevisionLabel");
  const lock=document.getElementById("budgetLockHint");
  const lines=document.getElementById("budgetLines");
  const total=document.getElementById("budgetInternalTotal");
  const add=document.getElementById("addBudgetItem");
  const newRev=document.getElementById("newBudgetRevision");
  const approvalHint=document.getElementById("budgetApprovalHint");

  if(ref) ref.textContent=(order?.ref||"OS")+" · "+(order?.plate||"");
  if(status){
    status.textContent=budgetStatusText(currentBudgetRevision?.status);
    status.className="status "+(currentBudgetRevision?.status==="approved"?"service":currentBudgetRevision?.status==="draft"?"open":"waiting");
  }
  if(rev) rev.textContent="R"+(currentBudgetRevision?.revision||1);
  if(lock){
    lock.textContent=budgetEditable()
      ?"Esta revisão pode ser editada."
      :"Revisão fechada. Qualquer alteração gera uma nova revisão e exige nova aprovação.";
  }
  if(total) total.textContent=moneyBR(currentBudgetRevision?.total||0);
  if(add) add.disabled=false;
  if(newRev) newRev.hidden=budgetEditable();
  if(approvalHint){
    const paymentLabel=currentBudgetRevision?.payment_mode==="credit"?"Crediário / pagar depois":"Cobrar após aprovação";
    approvalHint.textContent=currentBudgetRevision?.status==="approved"
      ?"Revisão aprovada · "+paymentLabel+"."
      : currentBudgetRevision?.status==="sent"
        ?"Link enviado · "+paymentLabel+"."
        :"Escolha como esta revisão será cobrada ao enviar.";
  }

  if(lines){
    lines.innerHTML=currentBudgetItems.length
      ? currentBudgetItems.map(item=>
        '<div class="budget-line dynamic-budget-line" data-budget-item="'+item.id+'">'+
          '<div class="budget-line-copy"><b>'+escapeHtml(item.description)+'</b><small>'+budgetKindText(item.kind)+' · '+moneyBR(item.unit_price)+' / un</small></div>'+
          '<div class="budget-line-value"><strong>'+moneyBR(item.line_total??Number(item.quantity||1)*Number(item.unit_price||0))+'</strong>'+
          (budgetEditable()?'<div class="budget-qty-controls"><button type="button" data-budget-qty="'+item.id+'" data-delta="-1">−</button><span>'+Number(item.quantity||1).toLocaleString("pt-BR")+'</span><button type="button" data-budget-qty="'+item.id+'" data-delta="1">＋</button></div><button type="button" class="budget-delete-item" data-delete-budget-item="'+item.id+'" aria-label="Remover item">×</button>':'<small>'+Number(item.quantity||1).toLocaleString("pt-BR")+' un</small>')+
          '</div>'+
        '</div>'
      ).join("")
      : '<div class="budget-empty"><b>Orçamento vazio</b><span>Adicione peças e serviços para começar.</span></div>';

    lines.querySelectorAll("[data-delete-budget-item]").forEach(btn=>btn.addEventListener("click",()=>deleteBudgetItem(btn.dataset.deleteBudgetItem)));
    lines.querySelectorAll("[data-budget-qty]").forEach(btn=>btn.addEventListener("click",()=>changeBudgetItemQuantity(btn.dataset.budgetQty,Number(btn.dataset.delta))));
  }
}
async function loadServerBudget(order){
  const {data:revision,error}=await supabaseClient
    .from("budget_revisions")
    .select("id,work_order_id,revision,status,subtotal,total,payment_mode,payment_due_at,payment_note,created_at,sent_at,approved_at")
    .eq("work_order_id",order.id)
    .order("revision",{ascending:false})
    .limit(1)
    .maybeSingle();
  if(error) throw error;

  let latest=revision;
  if(!latest){
    const {data:newRevision,error:createError}=await supabaseClient
      .from("budget_revisions")
      .insert({work_order_id:order.id,revision:1,status:"draft",subtotal:0,total:0,created_by:staffSession?.user?.id||null})
      .select("id,work_order_id,revision,status,subtotal,total,payment_mode,payment_due_at,payment_note,created_at,sent_at,approved_at")
      .single();
    if(createError) throw createError;
    latest=newRevision;
  }
  const {data:items,error:itemsError}=await supabaseClient
    .from("budget_items")
    .select("id,budget_revision_id,catalog_item_id,kind,description,quantity,unit_price,line_total,sort_order")
    .eq("budget_revision_id",latest.id)
    .order("sort_order",{ascending:true});
  if(itemsError) throw itemsError;

  const {data:token}=await supabaseClient
    .from("approval_tokens")
    .select("token,revoked_at")
    .eq("budget_revision_id",latest.id)
    .is("revoked_at",null)
    .maybeSingle();

  currentBudgetRevision=latest;
  currentBudgetItems=items||[];
  currentApprovalToken=token?.token||null;
}
async function loadLocalBudget(order){
  if(REAL_MODE) throw new Error("real_mode_requires_server");
  const store=localBudgetStore();
  const key=String(order.id);
  if(!store[key]){store[key]=seedLocalBudget(order);saveLocalBudgetStore(store)}
  currentBudgetRevision=store[key].revision;
  currentBudgetItems=store[key].items||[];
  currentApprovalToken=store[key].approvalToken||null;
}
async function renderBudget(){
  if(REAL_MODE && !staffProfile?.active){
    requireActiveStaff("Entre para acessar orçamentos reais.");
    return;
  }
  const order=allOrders().find(o=>String(o.id)===String(selectedBudgetOrderId))||allOrders()[0];
  if(!order){
    document.getElementById("budgetLines").innerHTML='<div class="budget-empty"><b>Nenhuma OS selecionada</b><span>Abra uma OS real para montar o orçamento.</span></div>';
    return;
  }
  selectedBudgetOrderId=order.id;
  document.getElementById("budgetLines").innerHTML='<div class="budget-empty">Carregando orçamento…</div>';
  try{
    if(order.server && staffProfile?.active && supabaseClient) await loadServerBudget(order);
    else await loadLocalBudget(order);
    renderBudgetState(order);
  }catch(error){
    document.getElementById("budgetLines").innerHTML='<div class="budget-empty"><b>Falha ao carregar</b><span>Tente novamente.</span></div>';
    toast("Não foi possível carregar o orçamento.");
  }
}
async function recalcServerBudget(revisionId){
  const {data:items,error}=await supabaseClient
    .from("budget_items")
    .select("line_total")
    .eq("budget_revision_id",revisionId);
  if(error) throw error;
  const total=(items||[]).reduce((sum,item)=>sum+Number(item.line_total||0),0);
  const {data,error:updateError}=await supabaseClient
    .from("budget_revisions")
    .update({subtotal:total,total})
    .eq("id",revisionId)
    .select("id,work_order_id,revision,status,subtotal,total,payment_mode,payment_due_at,payment_note,created_at,sent_at,approved_at")
    .single();
  if(updateError) throw updateError;
  currentBudgetRevision=data;
}
async function createEditableRevision(){
  const order=allOrders().find(o=>String(o.id)===String(selectedBudgetOrderId));
  if(!order) throw new Error("order_not_found");
  if(budgetEditable()) return currentBudgetRevision;

  if(order.server && staffProfile?.active && supabaseClient){
    const old=currentBudgetRevision;
    const nextRevision=Number(old.revision||0)+1;
    const {data:newRevision,error}=await supabaseClient
      .from("budget_revisions")
      .insert({
        work_order_id:order.id,
        revision:nextRevision,
        status:"draft",
        subtotal:Number(old.subtotal||old.total||0),
        total:Number(old.total||0),
        payment_mode:old.payment_mode||"pay_now",
        payment_due_at:old.payment_due_at||null,
        payment_note:old.payment_note||null,
        created_by:staffSession?.user?.id||null
      })
      .select("id,work_order_id,revision,status,subtotal,total,payment_mode,payment_due_at,payment_note,created_at,sent_at,approved_at")
      .single();
    if(error) throw error;

    if(currentBudgetItems.length){
      const copies=currentBudgetItems.map((item,index)=>({
        budget_revision_id:newRevision.id,
        kind:item.kind,
        description:item.description,
        quantity:Number(item.quantity),
        unit_price:Number(item.unit_price),
        sort_order:index+1
      }));
      const {error:copyError}=await supabaseClient.from("budget_items").insert(copies);
      if(copyError) throw copyError;
    }
    await supabaseClient.from("budget_revisions").update({status:"superseded"}).eq("id",old.id);
    await supabaseClient.from("approval_tokens").update({revoked_at:new Date().toISOString()}).eq("budget_revision_id",old.id).is("revoked_at",null);
    await supabaseClient.from("work_orders").update({
      status:"budget",
      operational_state:"active",
      blocked_since:null,
      blocked_reason:null
    }).eq("id",order.id);

    currentBudgetRevision=newRevision;
    currentApprovalToken=null;
    await loadServerBudget(order);
    await syncServerData({quiet:true});
    return currentBudgetRevision;
  }

  const store=localBudgetStore();
  const key=String(order.id);
  const current=store[key]||seedLocalBudget(order);
  current.revision={...current.revision,id:"local-rev-"+key+"-"+(Number(current.revision.revision||0)+1),revision:Number(current.revision.revision||0)+1,status:"draft"};
  current.approvalToken=null;
  store[key]=current;
  saveLocalBudgetStore(store);
  await loadLocalBudget(order);
  return currentBudgetRevision;
}
async function loadBudgetCatalog(){
  if(staffProfile?.active && supabaseClient){
    const {data,error}=await supabaseClient
      .from("catalog_items")
      .select("id,kind,name,sku,unit,sale_price,cost_price,track_stock,stock_qty,favorite,usage_count,last_used_at")
      .eq("active",true)
      .order("favorite",{ascending:false})
      .order("usage_count",{ascending:false})
      .order("last_used_at",{ascending:false,nullsFirst:false});
    if(error) throw error;
    budgetCatalog=data||[];
  }else{
    budgetCatalog=currentBudgetItems.map((item,index)=>({
      id:"demo-"+index,
      kind:item.kind,
      name:item.description,
      sku:null,
      unit:"un",
      sale_price:Number(item.unit_price||0),
      usage_count:1,
      last_used_at:null
    }));
  }
  renderBudgetCatalog();
}
function budgetCatalogMeta(item){
  const bits=[];
  if(item.sku) bits.push(item.sku);
  bits.push(budgetKindText(item.kind));
  if(item.track_stock) bits.push("estoque "+Number(item.stock_qty||0).toLocaleString("pt-BR")+" "+(item.unit||"un"));
  else bits.push(item.unit||"un");
  return bits.join(" · ");
}
function updateBudgetComposerSummary(){
  const el=document.getElementById("budgetComposerSummary");
  if(!el) return;
  el.textContent=currentBudgetItems.length+" "+(currentBudgetItems.length===1?"item":"itens")+" · "+moneyBR(currentBudgetRevision?.total||0);
}
function renderBudgetCatalog(){
  const results=document.getElementById("budgetCatalogResults");
  if(!results) return;
  const query=(document.getElementById("budgetCatalogSearch")?.value||"").trim().toLowerCase();
  const list=budgetCatalog.filter(item=>{
    const typeOk=budgetCatalogFilter==="all"||item.kind===budgetCatalogFilter;
    const qOk=!query||[item.name,item.sku||"",budgetKindText(item.kind)].join(" ").toLowerCase().includes(query);
    return typeOk&&qOk;
  }).slice(0,40);

  results.innerHTML=list.length?list.map(item=>{
    const inBudget=currentBudgetItems.find(line=>String(line.catalog_item_id||"")===String(item.id));
    return '<article class="catalog-result '+(inBudget?"in-budget":"")+'">'+
      '<button type="button" class="catalog-result-main" data-catalog-add="'+item.id+'">'+
        '<span class="catalog-kind-icon">'+(item.kind==="service"?"🔧":item.kind==="part"?"▦":"＋")+'</span>'+
        '<div><b>'+escapeHtml(item.name)+'</b><small>'+escapeHtml(budgetCatalogMeta(item))+'</small></div>'+
        '<strong>'+moneyBR(item.sale_price)+'</strong>'+
        '<span class="catalog-add-mark">'+(inBudget?"＋":"＋")+'</span>'+
      '</button>'+
      (inBudget?'<small class="catalog-in-budget">No orçamento: '+Number(inBudget.quantity||1).toLocaleString("pt-BR")+'</small>':'')+
    '</article>';
  }).join(""):'<div class="catalog-empty"><b>Nenhum item encontrado</b><span>Use “Item que não está no catálogo” abaixo. Depois ele fica salvo para a próxima vez.</span></div>';

  results.querySelectorAll("[data-catalog-add]").forEach(btn=>btn.addEventListener("click",async()=>{
    const item=budgetCatalog.find(x=>String(x.id)===String(btn.dataset.catalogAdd));
    if(!item) return;
    btn.disabled=true;
    try{
      const fd=new FormData();
      fd.set("description",item.name);
      fd.set("kind",item.kind);
      fd.set("quantity","1");
      fd.set("unit_price",String(item.sale_price||0));
      fd.set("catalog_item_id",String(item.id));
      await addBudgetItem(fd);
      updateBudgetComposerSummary();
      renderBudgetCatalog();
    }catch{
      toast("Não foi possível adicionar o item.");
    }finally{
      btn.disabled=false;
    }
  }));
}
async function ensureCatalogItem(fd){
  if(!(staffProfile?.active&&supabaseClient)) return null;
  const kind=String(fd.get("kind")||"other");
  const name=String(fd.get("description")||"").trim();
  const salePrice=parseMoneyInput(fd.get("unit_price"));
  if(!name) return null;

  const {data:existing}=await supabaseClient
    .from("catalog_items")
    .select("id,kind,name,sale_price")
    .eq("kind",kind)
    .ilike("name",name)
    .limit(1)
    .maybeSingle();

  if(existing){
    const {data,error}=await supabaseClient.from("catalog_items").update({
      sale_price:salePrice,
      updated_at:new Date().toISOString()
    }).eq("id",existing.id).select("id,kind,name,sale_price").single();
    if(error) throw error;
    return data;
  }

  const {data,error}=await supabaseClient.from("catalog_items").insert({
    kind,
    name,
    sale_price:salePrice,
    unit:"un",
    created_by:staffSession?.user?.id||null
  }).select("id,kind,name,sale_price").single();
  if(error) throw error;
  return data;
}
async function touchCatalogItem(catalogItemId){
  if(!(catalogItemId&&staffProfile?.active&&supabaseClient)) return;
  const item=budgetCatalog.find(x=>String(x.id)===String(catalogItemId));
  await supabaseClient.from("catalog_items").update({
    usage_count:Number(item?.usage_count||0)+1,
    last_used_at:new Date().toISOString(),
    updated_at:new Date().toISOString()
  }).eq("id",catalogItemId);
}
async function changeBudgetItemQuantity(itemId,delta){
  if(!budgetEditable()) return;
  const order=allOrders().find(o=>String(o.id)===String(selectedBudgetOrderId));
  const item=currentBudgetItems.find(x=>String(x.id)===String(itemId));
  if(!order||!item) return;
  const next=Math.max(0,Number(item.quantity||1)+Number(delta||0));
  if(next<=0){await deleteBudgetItem(itemId);return}

  if(order.server&&staffProfile?.active&&supabaseClient){
    const {error}=await supabaseClient.from("budget_items").update({quantity:next}).eq("id",itemId).eq("budget_revision_id",currentBudgetRevision.id);
    if(error){toast("Não foi possível alterar a quantidade.");return}
    await recalcServerBudget(currentBudgetRevision.id);
    await loadServerBudget(order);
  }else{
    const store=localBudgetStore();const key=String(order.id);const current=store[key]||seedLocalBudget(order);
    const line=(current.items||[]).find(x=>String(x.id)===String(itemId));
    if(line){line.quantity=next;line.line_total=Math.round(next*Number(line.unit_price||0)*100)/100}
    const total=(current.items||[]).reduce((sum,x)=>sum+Number(x.line_total||0),0);
    current.revision.subtotal=total;current.revision.total=total;store[key]=current;saveLocalBudgetStore(store);
    await loadLocalBudget(order);
  }
  renderBudgetState(order);
  updateBudgetComposerSummary();
  renderBudgetCatalog();
}

async function addBudgetItem(fd){
  const order=allOrders().find(o=>String(o.id)===String(selectedBudgetOrderId));
  if(!order) return;
  if(!budgetEditable()) await createEditableRevision();

  const description=String(fd.get("description")||"").trim();
  const kind=String(fd.get("kind")||"other");
  const quantity=parseMoneyInput(fd.get("quantity"))||1;
  const unitPrice=parseMoneyInput(fd.get("unit_price"));
  const catalogItemId=String(fd.get("catalog_item_id")||"").trim()||null;
  if(!description||unitPrice<0){toast("Confira descrição e valor.");return}

  if(order.server && staffProfile?.active && supabaseClient){
    const existing=catalogItemId?currentBudgetItems.find(x=>String(x.catalog_item_id||"")===String(catalogItemId)):null;
    if(existing){
      const {error}=await supabaseClient.from("budget_items").update({
        quantity:Number(existing.quantity||1)+quantity,
        unit_price:unitPrice
      }).eq("id",existing.id).eq("budget_revision_id",currentBudgetRevision.id);
      if(error) throw error;
    }else{
      const {error}=await supabaseClient.from("budget_items").insert({
        budget_revision_id:currentBudgetRevision.id,
        catalog_item_id:catalogItemId,
        kind,
        description,
        quantity,
        unit_price:unitPrice,
        sort_order:currentBudgetItems.length+1
      });
      if(error) throw error;
    }
    await touchCatalogItem(catalogItemId);
    await recalcServerBudget(currentBudgetRevision.id);
    await loadServerBudget(order);
  }else{
    const store=localBudgetStore();
    const key=String(order.id);
    const current=store[key]||seedLocalBudget(order);
    current.items=current.items||[];
    current.items.push({
      id:"local-item-"+crypto.randomUUID(),
      kind,description,quantity,unit_price:unitPrice,
      line_total:Math.round(quantity*unitPrice*100)/100,
      sort_order:current.items.length+1
    });
    const total=current.items.reduce((sum,item)=>sum+Number(item.line_total||0),0);
    current.revision.subtotal=total;current.revision.total=total;
    store[key]=current;saveLocalBudgetStore(store);
    await loadLocalBudget(order);
  }
  renderBudgetState(order);
}
async function deleteBudgetItem(itemId){
  const order=allOrders().find(o=>String(o.id)===String(selectedBudgetOrderId));
  if(!order||!budgetEditable()) return;
  if(order.server && staffProfile?.active && supabaseClient){
    const {error}=await supabaseClient.from("budget_items").delete().eq("id",itemId).eq("budget_revision_id",currentBudgetRevision.id);
    if(error){toast("Não foi possível remover o item.");return}
    await recalcServerBudget(currentBudgetRevision.id);
    await loadServerBudget(order);
  }else{
    const store=localBudgetStore();const key=String(order.id);
    const current=store[key]||seedLocalBudget(order);
    current.items=(current.items||[]).filter(item=>String(item.id)!==String(itemId));
    const total=current.items.reduce((sum,item)=>sum+Number(item.line_total||0),0);
    current.revision.subtotal=total;current.revision.total=total;
    store[key]=current;saveLocalBudgetStore(store);
    await loadLocalBudget(order);
  }
  renderBudgetState(order);
  updateBudgetComposerSummary();
  renderBudgetCatalog();
}
async function sendBudgetForApproval(paymentMode=currentBudgetRevision?.payment_mode||"pay_now",paymentDueAt=null){
  const order=allOrders().find(o=>String(o.id)===String(selectedBudgetOrderId));
  if(!order) return;
  if(Number(currentBudgetRevision?.total||0)<=0){toast("Adicione itens antes de enviar.");return}

  if(order.server && staffProfile?.active && supabaseClient){
    if(currentBudgetRevision.status==="approved"){
      toast("Esta revisão já foi aprovada. Crie uma nova revisão para alterar.");
      return;
    }
    if(currentBudgetRevision.status!=="sent"){
      const {data,error}=await supabaseClient.from("budget_revisions").update({
        status:"sent",
        sent_at:new Date().toISOString(),
        payment_mode:paymentMode,
        payment_due_at:paymentMode==="credit"&&paymentDueAt?new Date(paymentDueAt+"T12:00:00").toISOString():null,
        payment_note:paymentMode==="credit"?"Pagamento combinado para depois da aprovação.":"Pagamento solicitado após a aprovação."
      }).eq("id",currentBudgetRevision.id).select("id,work_order_id,revision,status,subtotal,total,payment_mode,payment_due_at,payment_note,created_at,sent_at,approved_at").single();
      if(error) throw error;
      currentBudgetRevision=data;
    }
    if(currentBudgetRevision.status==="sent"){
      const {data:updated,error:termsError}=await supabaseClient.from("budget_revisions").update({
        payment_mode:paymentMode,
        payment_due_at:paymentMode==="credit"&&paymentDueAt?new Date(paymentDueAt+"T12:00:00").toISOString():null,
        payment_note:paymentMode==="credit"?"Pagamento combinado para depois da aprovação.":"Pagamento solicitado após a aprovação."
      }).eq("id",currentBudgetRevision.id).select("id,work_order_id,revision,status,subtotal,total,payment_mode,payment_due_at,payment_note,created_at,sent_at,approved_at").single();
      if(termsError) throw termsError;
      currentBudgetRevision=updated;
    }
    let token=currentApprovalToken;
    if(!token){
      const {data,error}=await supabaseClient.from("approval_tokens").insert({
        budget_revision_id:currentBudgetRevision.id,
        expires_at:new Date(Date.now()+30*24*60*60*1000).toISOString()
      }).select("token").single();
      if(error) throw error;
      token=data.token;
      currentApprovalToken=token;
    }
    await supabaseClient.from("work_orders").update({
      status:"waiting_approval",
      operational_state:"waiting_customer",
      blocked_since:new Date().toISOString(),
      blocked_reason:"Aguardando aprovação do orçamento"
    }).eq("id",order.id);
    await supabaseClient.from("activity_log").insert({
      work_order_id:order.id,
      actor_user_id:staffSession?.user?.id||null,
      actor_type:"user",
      event_type:"budget_sent",
      payload:{
        budget_revision_id:currentBudgetRevision.id,
        revision:currentBudgetRevision.revision,
        total:currentBudgetRevision.total,
        payment_mode:paymentMode,
        payment_due_at:currentBudgetRevision.payment_due_at||null
      }
    });
    await syncServerData({quiet:true});
    renderBudgetState(order);
  }else{
    currentApprovalToken=currentApprovalToken||(DEMO_MODE?V11_PILOT_APPROVAL_TOKEN:null);
  }

  if(!currentApprovalToken){
    toast("Não foi possível gerar um token de aprovação.");
    return;
  }
  const link=location.origin+location.pathname+"?approval="+encodeURIComponent(currentApprovalToken)+"&v=12.5#aprovar";
  try{await navigator.clipboard.writeText(link);toast("Link da revisão atual copiado.");}
  catch{toast("Revisão pronta para compartilhar.");}
}

document.getElementById("addBudgetItem").addEventListener("click",async()=>{
  if(!currentBudgetRevision) await renderBudget();
  if(!budgetEditable()){
    try{await createEditableRevision();renderBudgetState(allOrders().find(o=>String(o.id)===String(selectedBudgetOrderId)));toast("Nova revisão criada para edição.");}
    catch{toast("Não foi possível criar nova revisão.");return}
  }
  budgetCatalogFilter="all";
  document.querySelectorAll("[data-catalog-filter]").forEach(btn=>btn.classList.toggle("active",btn.dataset.catalogFilter==="all"));
  const search=document.getElementById("budgetCatalogSearch");
  if(search) search.value="";
  budgetItemForm.reset();
  budgetItemForm.elements.quantity.value="1";
  budgetItemForm.elements.save_catalog.checked=true;
  document.getElementById("budgetManualEntry").open=false;
  document.getElementById("budgetItemPreview").textContent="Total do item: R$ 0,00";
  updateBudgetComposerSummary();
  openSheet(budgetItemSheet);
  try{
    await loadBudgetCatalog();
    setTimeout(()=>search?.focus(),80);
  }catch{
    document.getElementById("budgetCatalogResults").innerHTML='<div class="catalog-empty"><b>Catálogo indisponível</b><span>Você ainda pode adicionar um item avulso abaixo.</span></div>';
  }
});
document.getElementById("newBudgetRevision").addEventListener("click",async()=>{
  try{
    await createEditableRevision();
    renderBudgetState(allOrders().find(o=>String(o.id)===String(selectedBudgetOrderId)));
    toast("Nova revisão criada.");
  }catch{toast("Não foi possível criar a revisão.")}
});
budgetItemForm?.addEventListener("input",()=>{
  const fd=new FormData(budgetItemForm);
  const quantity=parseMoneyInput(fd.get("quantity"))||1;
  const price=parseMoneyInput(fd.get("unit_price"));
  document.getElementById("budgetItemPreview").textContent="Total do item: "+moneyBR(quantity*price);
});
budgetItemForm?.addEventListener("submit",async event=>{
  event.preventDefault();
  const btn=document.getElementById("saveBudgetItem");btn.disabled=true;
  try{
    const fd=new FormData(budgetItemForm);
    if(fd.get("save_catalog")){
      const catalogItem=await ensureCatalogItem(fd);
      if(catalogItem) fd.set("catalog_item_id",catalogItem.id);
    }
    await addBudgetItem(fd);
    budgetItemForm.reset();
    budgetItemForm.elements.quantity.value="1";
    budgetItemForm.elements.save_catalog.checked=true;
    document.getElementById("budgetItemPreview").textContent="Total do item: R$ 0,00";
    document.getElementById("budgetManualEntry").open=false;
    await loadBudgetCatalog();
    updateBudgetComposerSummary();
    toast("Item adicionado. Você pode incluir outro.");
  }catch{toast("Não foi possível adicionar o item.");}
  finally{btn.disabled=false}
});
document.getElementById("budgetCatalogSearch")?.addEventListener("input",renderBudgetCatalog);
document.querySelectorAll("[data-catalog-filter]").forEach(btn=>btn.addEventListener("click",()=>{
  budgetCatalogFilter=btn.dataset.catalogFilter;
  document.querySelectorAll("[data-catalog-filter]").forEach(x=>x.classList.toggle("active",x===btn));
  renderBudgetCatalog();
}));
document.getElementById("budgetComposerDone")?.addEventListener("click",()=>{
  closeSheets();
  renderBudgetState(allOrders().find(o=>String(o.id)===String(selectedBudgetOrderId)));
});
const budgetSendSheet=document.getElementById("budgetSendSheet");
function syncBudgetSendMode(){
  const mode=document.querySelector('input[name="budgetPaymentMode"]:checked')?.value||"pay_now";
  document.querySelectorAll("[data-send-mode-card]").forEach(card=>card.classList.toggle("active",card.dataset.sendModeCard===mode));
  const due=document.getElementById("budgetDueField");
  if(due) due.hidden=mode!=="credit";
  const hint=document.getElementById("budgetSendHint");
  if(hint) hint.textContent=mode==="credit"
    ?"O cliente assina a aprovação agora; o valor entra no contas a receber sem exigir pagamento nesta tela."
    :"Depois de assinar, a mesma página passa a funcionar como cobrança/fatura.";
}
document.querySelectorAll('input[name="budgetPaymentMode"]').forEach(input=>input.addEventListener("change",syncBudgetSendMode));

document.getElementById("copyApproval").addEventListener("click",()=>{
  const mode=currentBudgetRevision?.payment_mode||"pay_now";
  const radio=document.querySelector('input[name="budgetPaymentMode"][value="'+mode+'"]');
  if(radio) radio.checked=true;
  const due=document.getElementById("budgetPaymentDueDate");
  if(due&&currentBudgetRevision?.payment_due_at) due.value=new Date(currentBudgetRevision.payment_due_at).toISOString().slice(0,10);
  syncBudgetSendMode();
  openSheet(budgetSendSheet);
});
document.getElementById("confirmBudgetSend").addEventListener("click",async()=>{
  const btn=document.getElementById("confirmBudgetSend");
  const mode=document.querySelector('input[name="budgetPaymentMode"]:checked')?.value||"pay_now";
  const due=document.getElementById("budgetPaymentDueDate")?.value||null;
  btn.disabled=true;
  try{
    await sendBudgetForApproval(mode,due);
    closeSheets();
  }catch{
    toast("Não foi possível preparar a aprovação.");
  }finally{
    btn.disabled=false;
  }
});
document.getElementById("previewBudgetApproval").addEventListener("click",async()=>{
  if(!currentApprovalToken){
    try{await sendBudgetForApproval(currentBudgetRevision?.payment_mode||"pay_now",currentBudgetRevision?.payment_due_at?new Date(currentBudgetRevision.payment_due_at).toISOString().slice(0,10):null)}catch{toast("Prepare o orçamento antes de visualizar.");return}
  }
  go("client-approval");
});
// ---- v11 real public approval backend ----
async function loadPublicBudgetFromServer(){
  const token=approvalTokenFromUrl();
  const meta=document.getElementById("approvalMeta");
  const vehicle=document.getElementById("approvalVehicle");
  const total=document.getElementById("approvalTotal");
  const items=document.getElementById("approvalItems");
  if(!token){
    if(meta) meta.textContent="Link de aprovação inválido";
    if(items) items.innerHTML='<div><span>Este link não contém uma revisão válida.</span><b>!</b></div>';
    const actions=document.getElementById("approvalActions");
    if(actions) actions.hidden=true;
    return null;
  }
  try{
    if(meta) meta.textContent="Carregando orçamento…";
    const response=await fetch(V11_PUBLIC_BUDGET_ENDPOINT+"?token="+encodeURIComponent(token),{cache:"no-store"});
    const payload=await response.json();
    if(!response.ok) throw new Error(payload.error||"Falha ao carregar orçamento");
    remoteBudgetState=payload.budget;
    remoteApprovalState=payload.approval||null;
    remoteBudgetState.payment_request=payload.payment_request||null;

    const order=payload.budget.order||{};
    const v=order.vehicle||{};
    const vehicleText=[v.make,v.model,v.version].filter(Boolean).join(" ")||"Veículo";
    const plate=v.plate||"SEM PLACA";

    if(meta) meta.textContent="FATURA / ORÇAMENTO #"+String(order.number||"—").padStart(6,"0")+" · REVISÃO "+payload.budget.revision;
    if(vehicle) vehicle.textContent=vehicleText+" · "+plate;
    if(total) total.textContent=moneyBR(payload.budget.total);
    renderPublicInvoiceTerms(payload.budget,payload.approval,payload.payment_request);
    if(items){
      items.innerHTML=(payload.budget.items||[]).map(item=>
        '<div><span>'+escapeHtml(item.description)+'</span><b>'+moneyBR(item.line_total)+'</b></div>'
      ).join("")||'<div><span>Sem itens</span><b>—</b></div>';
    }
    const input=document.getElementById("approvalName");
    if(input && order.customer?.name) input.value=order.customer.name;
    renderApprovalState();
    renderPublicInvoiceTerms(remoteBudgetState,remoteApprovalState,remoteBudgetState?.payment_request||null);
    renderDashboard();
    renderOrders();
    return payload;
  }catch(error){
    if(meta) meta.textContent="Não foi possível carregar o orçamento";
    if(items) items.innerHTML='<div><span>Erro ao carregar</span><b>!</b></div>';
    toast("Falha ao carregar orçamento real.");
    return null;
  }
}

function renderPublicInvoiceTerms(budget,approval=null,paymentRequest=null){
  const mode=budget?.payment_mode||"pay_now";
  const title=document.getElementById("invoicePaymentModeTitle");
  const text=document.getElementById("invoicePaymentModeText");
  const panel=document.getElementById("publicPaymentPanel");
  const payTitle=document.getElementById("publicPaymentTitle");
  const payAmount=document.getElementById("publicPaymentAmount");
  const payText=document.getElementById("publicPaymentText");
  const payStatus=document.getElementById("publicPaymentStatus");
  const approveBtn=document.getElementById("approveBudget");

  if(title) title.textContent=mode==="credit"?"Crediário · pagar depois":"Pagamento após aprovação";
  if(text){
    text.textContent=mode==="credit"
      ? (budget.payment_due_at?"Pagamento combinado para "+new Intl.DateTimeFormat("pt-BR").format(new Date(budget.payment_due_at))+".":"Aprovação agora; pagamento combinado diretamente com a oficina.")
      :"Depois de aprovar e assinar, esta mesma página continua como cobrança.";
  }
  if(approveBtn&&!approval){
    approveBtn.textContent=mode==="credit"?"✓ Aprovar e assinar":"✓ Aprovar e ir para pagamento";
  }

  if(!panel) return;
  if(!approval || approval.decision!=="approved"){
    panel.hidden=true;
    return;
  }

  panel.hidden=false;
  if(payAmount) payAmount.textContent=moneyBR(budget.total);
  if(mode==="credit"){
    if(payTitle) payTitle.textContent="Pagamento combinado para depois";
    if(payText) payText.textContent=budget.payment_due_at
      ?"Vencimento combinado: "+new Intl.DateTimeFormat("pt-BR").format(new Date(budget.payment_due_at))+"."
      :"A oficina registrou esta venda em crediário. Nenhum pagamento é exigido nesta tela.";
    if(payStatus) payStatus.textContent="✓ Orçamento aprovado · valor lançado no contas a receber.";
    panel.classList.add("credit");
    return;
  }

  panel.classList.remove("credit");
  if(payTitle) payTitle.textContent=paymentRequest?.status==="approved"?"Pagamento confirmado":"Fatura aguardando pagamento";
  if(payText) payText.textContent="O orçamento foi aprovado. O pagamento pode ser concluído pela cobrança vinculada a esta fatura.";
  if(payStatus){
    if(paymentRequest?.status==="approved") payStatus.textContent="✓ Pagamento confirmado.";
    else if(paymentRequest?.status==="pending"||paymentRequest?.status==="processing") payStatus.textContent="Cobrança Pix gerada · aguardando confirmação.";
    else payStatus.textContent="Cobrança online será disponibilizada após a conexão da conta Mercado Pago.";
  }
}

async function sendRealApproval(decision,name,signatureData){
  const token=approvalTokenFromUrl();
  if(!token) throw new Error("token_required");
  const response=await fetch(V11_APPROVE_BUDGET_ENDPOINT,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      token,
      name,
      decision,
      consent:decision==="approved"?Boolean(approvalConsent?.checked):false,
      signatureDataUrl:decision==="approved"?signatureData:null
    })
  });
  const payload=await response.json();
  if(!response.ok) throw new Error(payload.error||"approval_failed");
  remoteApprovalState={
    customer_name:name,
    decision,
    consent:decision==="approved",
    created_at:payload.decidedAt
  };
  return payload;
}

// ---- v11.4 Mercado Pago Pix shell ----
const pixPaymentSheet=document.getElementById("pixPaymentSheet");
const pixPaymentForm=document.getElementById("pixPaymentForm");
const pixProviderStatus=document.getElementById("pixProviderStatus");
const pixResult=document.getElementById("pixResult");
let lastPixCode="";

async function ensurePilotBudgetLoaded(){
  const selectedOrder=allOrders().find(o=>String(o.id)===String(selectedBudgetOrderId));
  if(selectedOrder && currentBudgetRevision){
    return {
      id:currentBudgetRevision.id,
      revision:currentBudgetRevision.revision,
      total:currentBudgetRevision.total,
      order:{
        id:selectedOrder.id,
        number:selectedOrder.raw?.number||parseInt(String(selectedOrder.ref||"").replace(/\D/g,""),10)||null,
        customer:{name:selectedOrder.customer},
        vehicle:{plate:selectedOrder.plate}
      }
    };
  }
  if(remoteBudgetState) return remoteBudgetState;
  const payload=await loadPublicBudgetFromServer();
  return payload?.budget||remoteBudgetState;
}

async function createMercadoPagoPix(){
  const budget=await ensurePilotBudgetLoaded();
  if(!budget){
    pixProviderStatus.textContent="Não foi possível localizar o orçamento no servidor.";
    return;
  }
  await refreshStaffSession();
  if(!staffSession?.access_token || !staffProfile?.active){
    pixProviderStatus.textContent="Entre com um usuário interno liberado antes de gerar a cobrança.";
    openSheet(staffAuthSheet);
    return;
  }

  const payerEmail=document.getElementById("pixPayerEmail").value.trim();
  const payerDocument=document.getElementById("pixPayerDocument").value.trim();
  const amount=Number(budget.total||0);
  const order=budget.order||{};
  let receivableId=null;
  if(staffProfile?.active && supabaseClient && budget.id){
    const {data:receivable}=await supabaseClient
      .from("receivables")
      .select("id")
      .eq("budget_revision_id",budget.id)
      .maybeSingle();
    receivableId=receivable?.id||null;
  }
  if(!payerEmail || amount<=0){
    pixProviderStatus.textContent="Informe o e-mail do pagador e confira o valor.";
    return;
  }

  document.getElementById("createPixBtn").disabled=true;
  pixProviderStatus.textContent="Criando cobrança no Mercado Pago…";
  try{
    const response=await fetch(V11_CREATE_PIX_ENDPOINT,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":"Bearer "+staffSession.access_token,
        "apikey":V11_SUPABASE_PUBLISHABLE_KEY
      },
      body:JSON.stringify({
        work_order_id:order.id,
        budget_revision_id:budget.id,
        receivable_id:receivableId,
        amount,
        payer_email:payerEmail,
        payer_document:payerDocument,
        description:"Auto Mecânica Confiança · OS #"+String(order.number||"")
      })
    });
    const payload=await response.json();
    if(!response.ok){
      if(payload.error==="provider_not_configured"){
        pixProviderStatus.textContent="Mercado Pago preparado, mas ainda falta conectar as credenciais da conta.";
      }else if(payload.error==="staff_access_required"){
        pixProviderStatus.textContent="Seu usuário ainda não foi liberado para operações internas.";
      }else{
        pixProviderStatus.textContent="Falha ao criar cobrança: "+(payload.error||"erro desconhecido");
      }
      return;
    }

    lastPixCode=payload.pix?.copy_paste||"";
    document.getElementById("pixCopyPaste").value=lastPixCode;
    const qr=document.getElementById("pixQrImage");
    if(payload.pix?.qr_code_base64){
      qr.src="data:image/png;base64,"+payload.pix.qr_code_base64;
      qr.hidden=false;
    }else qr.hidden=true;
    pixResult.hidden=false;
    pixProviderStatus.textContent="Cobrança criada. Status: "+payload.status+".";
  }catch(error){
    pixProviderStatus.textContent="Não foi possível falar com o gateway agora.";
  }finally{
    document.getElementById("createPixBtn").disabled=false;
  }
}

document.getElementById("openPixPayment")?.addEventListener("click",async()=>{
  const budget=await ensurePilotBudgetLoaded();
  if(budget) document.getElementById("pixPaymentAmount").textContent=moneyBR(budget.total);
  pixResult.hidden=true;
  lastPixCode="";
  openSheet(pixPaymentSheet);
});
pixPaymentForm?.addEventListener("submit",event=>{event.preventDefault();createMercadoPagoPix()});
document.getElementById("copyPixCode")?.addEventListener("click",async()=>{
  if(!lastPixCode) return;
  try{await navigator.clipboard.writeText(lastPixCode);toast("Código Pix copiado.");}
  catch{toast("Selecione e copie o código Pix.");}
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
  if(REAL_MODE) return;
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
  const record=remoteApprovalState||getDemoApproval();
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
  input.value=record.name||record.customer_name||input.value;
  input.disabled=true;
  actions.hidden=true;
  if(approvalConsent){approvalConsent.checked=Boolean(record.consent);approvalConsent.disabled=true}
  if(approvalSignature) approvalSignature.style.pointerEvents="none";
  if(clearSignatureBtn) clearSignatureBtn.hidden=true;
  const decision=record.decision||record.status;
  if(decision==="approved"){
    out.className="decision-result decision-card approved compact-decision";
    const rev=record.revision||remoteBudgetState?.revision||1;
    const amount=record.amount??remoteBudgetState?.total??0;
    const decided=record.decidedAt||record.created_at;
    const person=record.name||record.customer_name||"Cliente";
    out.innerHTML='<div><b>✓ Orçamento aprovado</b><span>Rev. '+rev+' · '+moneyBR(amount)+' · '+formatDecisionTime(decided)+'</span><span>'+escapeHtml(person)+'</span></div>'+(record.signatureData?'<div class="signature-receipt"><img src="'+record.signatureData+'" alt="Assinatura registrada"></div>':'');
    if(remoteBudgetState) renderPublicInvoiceTerms(remoteBudgetState,record,remoteBudgetState.payment_request||null);
  }else{
    const rev=record.revision||remoteBudgetState?.revision||1;
    const amount=record.amount??remoteBudgetState?.total??0;
    const decided=record.decidedAt||record.created_at;
    const person=record.name||record.customer_name||"Cliente";
    out.className="decision-result decision-card revision";
    out.innerHTML='<b>↺ Revisão solicitada</b><span>Revisão '+rev+' · '+moneyBR(amount)+'</span><span>Solicitado por '+escapeHtml(person)+' em '+formatDecisionTime(decided)+'</span><small>A oficina deve ajustar o orçamento e enviar uma nova revisão.</small>';
  }
}
document.getElementById("approveBudget").addEventListener("click",async()=>{
  const name=document.getElementById("approvalName").value.trim();
  if(!name){toast("Informe o nome para aprovar.");return}
  if(!signatureHasInk || signatureDistance<=12){toast("Faça sua assinatura no quadro.");return}
  if(!approvalConsent?.checked){toast("Marque o aceite do orçamento.");return}
  const signatureData=getSignatureData();
  if(!signatureData){toast("Não consegui registrar a assinatura. Tente novamente.");return}
  approveBudgetBtn.disabled=true;
  try{
    const result=await sendRealApproval("approved",name,signatureData);
    remoteApprovalState={
      name,
      decision:"approved",
      consent:true,
      created_at:result.decidedAt,
      revision:result.revision,
      amount:result.total,
      signatureData
    };
    renderApprovalState();
    renderDashboard();
    renderOrders();
    toast("Orçamento aprovado e salvo no servidor.");
  }catch(error){
    updateApprovalButtonState();
    if(String(error.message)==="already_decided"){
      await loadPublicBudgetFromServer();
      toast("Este orçamento já recebeu uma decisão.");
    }else{
      toast("Não foi possível registrar a aprovação.");
    }
  }
});
document.getElementById("rejectBudget").addEventListener("click",async()=>{
  const name=document.getElementById("approvalName").value.trim()||"Cliente";
  try{
    const result=await sendRealApproval("revision_requested",name,null);
    remoteApprovalState={
      name,
      decision:"revision_requested",
      consent:false,
      created_at:result.decidedAt,
      revision:result.revision,
      amount:result.total
    };
    renderApprovalState();
    renderDashboard();
    renderOrders();
    toast("Pedido de revisão salvo no servidor.");
  }catch(error){
    if(String(error.message)==="already_decided") await loadPublicBudgetFromServer();
    else toast("Não foi possível solicitar revisão.");
  }
});
// ---- v11.2 internal finance UI ----
const manualPaymentSheet=document.getElementById("manualPaymentSheet");
const settleExpenseSheet=document.getElementById("settleExpenseSheet");
const financeReceiptSheet=document.getElementById("financeReceiptSheet");
const financeExpenseSheet=document.getElementById("financeExpenseSheet");
const financeReceiptInput=document.getElementById("financeReceiptInput");
const financeReceiptForm=document.getElementById("financeReceiptForm");
const financeExpenseForm=document.getElementById("financeExpenseForm");
const receiptPreview=document.getElementById("receiptPreview");

function financeDrafts(){
  try{return JSON.parse(localStorage.getItem("oficina-finance-drafts")||"[]")}catch{return []}
}
function saveFinanceDrafts(rows){
  localStorage.setItem("oficina-finance-drafts",JSON.stringify(rows));
}
function parseMoneyInput(value){
  const normalized=String(value||"").trim().replace(/\./g,"").replace(",",".");
  const number=Number(normalized);
  return Number.isFinite(number)?number:0;
}
function isFinanceOverdue(row){
  return Boolean(row.due_at)
    && new Date(row.due_at).getTime()<Date.now()
    && !["paid","cancelled"].includes(row.status);
}
function financeDueLabel(row){
  if(!row.due_at) return "sem vencimento";
  const date=new Date(row.due_at);
  const formatted=new Intl.DateTimeFormat("pt-BR").format(date);
  return isFinanceOverdue(row)?"vencido em "+formatted:"vence em "+formatted;
}
function financeMethodLabel(method){
  return ({
    pix:"Pix",cash:"Dinheiro",debit_card:"Débito",credit_card:"Crédito",
    transfer:"Transferência",other:"Outro"
  })[method]||method||"Não informado";
}
function receivableDisplay(row){
  const order=row.work_orders||{};
  const customer=order.customers||{};
  const remaining=Math.max(0,Number(row.amount||0)-Number(row.paid_amount||0));
  const mode=row.budget_revisions?.payment_mode||"pay_now";
  return '<article class="finance-detail-row '+(isFinanceOverdue(row)?"overdue":"")+'">'+
    '<div class="finance-detail-copy">'+
      '<div class="finance-detail-title"><b>OS #'+String(order.number||"—").padStart(6,"0")+'</b><span class="finance-mode '+mode+'">'+(mode==="credit"?"Crediário":"Cobrança")+'</span></div>'+
      '<strong>'+escapeHtml(customer.name||"Cliente")+'</strong>'+
      '<small>'+financeDueLabel(row)+' · '+escapeHtml(row.status)+'</small>'+
    '</div>'+
    '<div class="finance-detail-value"><span>Saldo</span><b>'+moneyBR(remaining)+'</b><small>de '+moneyBR(row.amount)+'</small></div>'+
    (hasPermission("finance.write")&&remaining>0?'<button class="finance-row-action" data-receive="'+row.id+'">Receber</button>':'')+
  '</article>';
}
function payableDisplay(row){
  const open=!["paid","cancelled","refunded"].includes(row.status);
  return '<article class="finance-detail-row '+(row.due_at&&new Date(row.due_at)<new Date()&&open?"overdue":"")+'">'+
    '<div class="finance-detail-copy">'+
      '<div class="finance-detail-title"><b>'+escapeHtml(row.category)+'</b><span class="finance-mode expense">Despesa</span></div>'+
      '<strong>'+escapeHtml(row.description)+'</strong>'+
      '<small>'+(row.due_at?financeDueLabel(row):"sem vencimento")+' · '+escapeHtml(row.status)+'</small>'+
    '</div>'+
    '<div class="finance-detail-value"><span>Valor</span><b>'+moneyBR(row.amount)+'</b><small>'+escapeHtml(financeMethodLabel(row.payment_method))+'</small></div>'+
    (hasPermission("finance.write")&&open?'<button class="finance-row-action" data-settle-expense="'+row.id+'">Baixar</button>':'')+
  '</article>';
}
function movementDisplay(row){
  const sign=row.direction==="income"?"+ ":"- ";
  return '<article class="finance-row '+row.direction+'">'+
    '<div class="finance-row-icon">'+(row.direction==="income"?"↙":"↗")+'</div>'+
    '<div class="finance-row-copy"><b>'+escapeHtml(row.description)+'</b><small>'+escapeHtml(row.category)+(row.work_order_id?' · vinculada à OS':'')+'</small></div>'+
    '<div class="finance-row-value"><b>'+sign+moneyBR(row.amount)+'</b><small>'+escapeHtml(row.status)+' · '+escapeHtml(financeMethodLabel(row.payment_method))+'</small></div>'+
  '</article>';
}
function bindFinanceActions(){
  document.querySelectorAll("[data-receive]").forEach(btn=>btn.addEventListener("click",()=>openManualPayment(btn.dataset.receive)));
  document.querySelectorAll("[data-settle-expense]").forEach(btn=>btn.addEventListener("click",()=>openSettleExpense(btn.dataset.settleExpense)));
}
function renderFinanceRows(){
  const list=document.getElementById("financeList");
  const title=document.getElementById("financeListTitle");
  const subtitle=document.getElementById("financeListSubtitle");
  if(!list) return;

  const openReceivables=financeReceivables.filter(r=>!["paid","cancelled"].includes(r.status));
  const creditReceivables=openReceivables.filter(r=>r.budget_revisions?.payment_mode==="credit");
  const payables=financeTransactions.filter(r=>r.direction==="expense");
  const openPayables=payables.filter(r=>!["paid","cancelled","refunded"].includes(r.status));

  if(currentFinanceTab==="receivables"){
    if(title) title.textContent="Contas a receber";
    if(subtitle) subtitle.textContent="Cobranças e saldos em aberto";
    list.innerHTML=openReceivables.length?openReceivables.map(receivableDisplay).join(""):'<div class="search-empty">Nenhum valor em aberto.</div>';
  }else if(currentFinanceTab==="credit"){
    if(title) title.textContent="Crediário";
    if(subtitle) subtitle.textContent="Orçamentos aprovados para pagar depois";
    list.innerHTML=creditReceivables.length?creditReceivables.map(receivableDisplay).join(""):'<div class="search-empty">Nenhum crediário em aberto.</div>';
  }else if(currentFinanceTab==="payables"){
    if(title) title.textContent="Contas a pagar";
    if(subtitle) subtitle.textContent="Compras e despesas da oficina";
    list.innerHTML=payables.length?payables.map(payableDisplay).join(""):'<div class="search-empty">Nenhuma despesa registrada.</div>';
  }else if(currentFinanceTab==="movements"){
    if(title) title.textContent="Movimentos";
    if(subtitle) subtitle.textContent="Entradas e saídas registradas";
    list.innerHTML=financeTransactions.length?financeTransactions.map(movementDisplay).join(""):'<div class="search-empty">Nenhum movimento financeiro.</div>';
  }else{
    if(title) title.textContent="Visão financeira";
    if(subtitle) subtitle.textContent="Pendências que pedem atenção";
    const overdue=openReceivables.filter(isFinanceOverdue);
    const attention=[...overdue.slice(0,6),...openPayables.slice(0,6)];
    list.innerHTML=attention.length
      ? overdue.slice(0,6).map(receivableDisplay).join("")+openPayables.slice(0,6).map(payableDisplay).join("")
      : '<div class="finance-clear">✓ Nenhuma pendência financeira crítica.</div>';
  }
  bindFinanceActions();
}
async function renderFinance(){
  const list=document.getElementById("financeList");
  if(!list) return;

  if(!(staffProfile?.active&&supabaseClient&&hasPermission("finance.read"))){
    document.getElementById("financeReceivableTotal").textContent=moneyBR(0);
    document.getElementById("financeOverdueTotal").textContent=moneyBR(0);
    document.getElementById("financePayableTotal").textContent=moneyBR(0);
    document.getElementById("financeReceivedMonth").textContent=moneyBR(0);
    list.innerHTML='<div class="search-empty">Seu perfil não possui acesso ao financeiro.</div>';
    return;
  }

  list.innerHTML='<div class="search-empty">Carregando financeiro…</div>';
  try{
    const [txResult,recResult]=await Promise.all([
      supabaseClient.from("financial_transactions")
        .select("id,work_order_id,purchase_id,payment_id,direction,category,description,amount,status,due_at,settled_at,payment_method,created_at")
        .order("created_at",{ascending:false})
        .limit(120),
      supabaseClient.from("receivables")
        .select("id,work_order_id,budget_revision_id,amount,paid_amount,status,due_at,created_at,work_orders(number,customers(name)),budget_revisions(payment_mode,payment_due_at)")
        .order("created_at",{ascending:false})
    ]);
    if(txResult.error) throw txResult.error;
    if(recResult.error) throw recResult.error;

    financeTransactions=txResult.data||[];
    financeReceivables=recResult.data||[];

    const openRec=financeReceivables.filter(r=>!["paid","cancelled"].includes(r.status));
    const receivableTotal=openRec.reduce((sum,r)=>sum+Math.max(0,Number(r.amount||0)-Number(r.paid_amount||0)),0);
    const overdueRows=openRec.filter(isFinanceOverdue);
    const overdueTotal=overdueRows.reduce((sum,r)=>sum+Math.max(0,Number(r.amount||0)-Number(r.paid_amount||0)),0);
    const openExpenses=financeTransactions.filter(r=>r.direction==="expense"&&!["paid","cancelled","refunded"].includes(r.status));
    const payableTotal=openExpenses.reduce((sum,r)=>sum+Number(r.amount||0),0);

    const now=new Date();
    const monthStart=new Date(now.getFullYear(),now.getMonth(),1).getTime();
    const receivedRows=financeTransactions.filter(r=>r.direction==="income"&&r.status==="paid"&&new Date(r.settled_at||r.created_at).getTime()>=monthStart);
    const receivedMonth=receivedRows.reduce((sum,r)=>sum+Number(r.amount||0),0);

    document.getElementById("financeReceivableTotal").textContent=moneyBR(receivableTotal);
    document.getElementById("financeReceivableMeta").textContent=openRec.length+" em aberto";
    document.getElementById("financeOverdueTotal").textContent=moneyBR(overdueTotal);
    document.getElementById("financeOverdueMeta").textContent=overdueRows.length+" vencido"+(overdueRows.length===1?"":"s");
    document.getElementById("financePayableTotal").textContent=moneyBR(payableTotal);
    document.getElementById("financeReceivedMonth").textContent=moneyBR(receivedMonth);
    document.getElementById("financeReceivedMeta").textContent=receivedRows.length+" recebimento"+(receivedRows.length===1?"":"s");

    renderFinanceRows();
  }catch(error){
    list.innerHTML='<div class="search-empty">Não foi possível carregar o financeiro do servidor.</div>';
  }
}

async function openManualPayment(receivableId){
  const row=financeReceivables.find(x=>String(x.id)===String(receivableId));
  if(!row) return;
  const remaining=Math.max(0,Number(row.amount||0)-Number(row.paid_amount||0));
  const order=row.work_orders||{};
  const customer=order.customers||{};
  document.getElementById("manualPaymentReceivableId").value=row.id;
  document.getElementById("manualPaymentRef").textContent="OS #"+String(order.number||"—").padStart(6,"0");
  document.getElementById("manualPaymentCustomer").textContent=customer.name||"Cliente";
  document.getElementById("manualPaymentRemaining").textContent=moneyBR(remaining);
  document.getElementById("manualPaymentAmount").value=remaining.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
  document.getElementById("manualPaymentMethod").value="pix";
  document.getElementById("manualPaymentNote").value="";
  openSheet(manualPaymentSheet);
}
function openSettleExpense(transactionId){
  const row=financeTransactions.find(x=>String(x.id)===String(transactionId));
  if(!row) return;
  document.getElementById("settleExpenseId").value=row.id;
  document.getElementById("settleExpenseCategory").textContent=row.category||"Despesa";
  document.getElementById("settleExpenseDescription").textContent=row.description||"—";
  document.getElementById("settleExpenseAmount").textContent=moneyBR(row.amount);
  document.getElementById("settleExpenseMethod").value=row.payment_method||"pix";
  openSheet(settleExpenseSheet);
}

document.querySelectorAll("[data-finance-tab]").forEach(btn=>btn.addEventListener("click",()=>{
  currentFinanceTab=btn.dataset.financeTab;
  document.querySelectorAll("[data-finance-tab]").forEach(x=>x.classList.toggle("active",x===btn));
  renderFinanceRows();
}));
document.getElementById("financeRefreshBtn")?.addEventListener("click",renderFinance);

document.getElementById("manualPaymentForm")?.addEventListener("submit",async event=>{
  event.preventDefault();
  if(!hasPermission("finance.write")) return toast("Seu perfil não pode registrar recebimentos.");
  const id=document.getElementById("manualPaymentReceivableId").value;
  const amount=parseMoneyInput(document.getElementById("manualPaymentAmount").value);
  const method=document.getElementById("manualPaymentMethod").value;
  const note=document.getElementById("manualPaymentNote").value.trim();
  const submit=event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled=true;
  try{
    const {error}=await supabaseClient.rpc("record_manual_payment",{
      p_receivable_id:id,p_amount:amount,p_method:method,p_note:note||null
    });
    if(error) throw error;
    closeSheets();
    await renderFinance();
    toast("Recebimento registrado.");
  }catch(error){
    if(String(error.message||"").includes("invalid_amount")) toast("Confira o valor recebido.");
    else toast("Não foi possível registrar o recebimento.");
  }finally{submit.disabled=false}
});

document.getElementById("settleExpenseForm")?.addEventListener("submit",async event=>{
  event.preventDefault();
  if(!hasPermission("finance.write")) return toast("Seu perfil não pode baixar despesas.");
  const id=document.getElementById("settleExpenseId").value;
  const method=document.getElementById("settleExpenseMethod").value;
  const submit=event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled=true;
  try{
    const {error}=await supabaseClient.rpc("settle_expense",{
      p_transaction_id:id,p_method:method,p_settled_at:new Date().toISOString()
    });
    if(error) throw error;
    closeSheets();
    await renderFinance();
    toast("Despesa baixada.");
  }catch{
    toast("Não foi possível baixar a despesa.");
  }finally{submit.disabled=false}
});

async function resolveWorkOrderFromInput(value){
  const raw=String(value||"").trim();
  if(!raw) return null;
  const number=parseInt(raw.replace(/\D/g,""),10);
  if(!Number.isFinite(number)) return null;
  const {data}=await supabaseClient.from("work_orders").select("id,number").eq("number",number).maybeSingle();
  return data||null;
}
async function findOrCreateSupplier(name){
  const value=String(name||"").trim();
  if(!value) return null;
  const {data:existing}=await supabaseClient.from("suppliers").select("id,name").ilike("name",value).limit(1).maybeSingle();
  if(existing) return existing;
  const {data,error}=await supabaseClient.from("suppliers").insert({name:value}).select("id,name").single();
  if(error) throw error;
  return data;
}
async function saveReceiptPurchaseToServer(fd,file){
  const supplier=await findOrCreateSupplier(fd.get("supplier"));
  const order=await resolveWorkOrderFromInput(fd.get("order"));
  const amount=parseMoneyInput(fd.get("total"));
  if(amount<=0) throw new Error("invalid_amount");

  let receiptPath=null;
  let receiptMime=null;
  if(file){
    const ext=(file.name.split(".").pop()||"bin").replace(/[^a-z0-9]/gi,"").toLowerCase()||"bin";
    receiptPath="finance/receipts/"+new Date().toISOString().slice(0,10)+"/"+crypto.randomUUID()+"."+ext;
    const {error:uploadError}=await supabaseClient.storage.from("oficina-evidence").upload(receiptPath,file,{
      contentType:file.type||"application/octet-stream",
      upsert:false
    });
    if(uploadError) throw uploadError;
    receiptMime=file.type||null;
  }

  const dateRaw=String(fd.get("date")||"").trim();
  const purchasedAt=dateRaw?new Date(dateRaw+"T12:00:00").toISOString():new Date().toISOString();
  const {data:purchase,error}=await supabaseClient.from("purchases").insert({
    supplier_id:supplier?.id||null,
    work_order_id:order?.id||null,
    purchased_at:purchasedAt,
    total:amount,
    payment_status:"open",
    receipt_storage_path:receiptPath,
    receipt_mime:receiptMime,
    extraction_status:"not_requested",
    extracted_payload:{
      original_filename:file?.name||null,
      notes:String(fd.get("notes")||"").trim()||null,
      source:"pwa_v12_2"
    },
    created_by:staffSession?.user?.id||null
  }).select("id").single();
  if(error) throw error;

  const {error:txError}=await supabaseClient.from("financial_transactions").insert({
    work_order_id:order?.id||null,
    purchase_id:purchase.id,
    direction:"expense",
    category:"Peças / compra",
    description:"Compra · "+(supplier?.name||"Fornecedor não informado"),
    amount,
    status:"open",
    internal_notes:String(fd.get("notes")||"").trim()||null,
    created_by:staffSession?.user?.id||null
  });
  if(txError) throw txError;

  if(order?.id){
    await supabaseClient.from("activity_log").insert({
      work_order_id:order.id,
      actor_user_id:staffSession?.user?.id||null,
      actor_type:"user",
      event_type:"purchase_receipt_added",
      payload:{purchase_id:purchase.id,total:amount,supplier:supplier?.name||null,receipt:receiptPath}
    });
  }
  return purchase;
}

document.getElementById("financeReceiptShortcut")?.addEventListener("click",()=>openSheet(financeReceiptSheet));
document.getElementById("financeExpenseShortcut")?.addEventListener("click",()=>openSheet(financeExpenseSheet));

financeReceiptInput?.addEventListener("change",()=>{
  const file=financeReceiptInput.files?.[0];
  if(!file||!receiptPreview) return;
  if(file.type.startsWith("image/")){
    const url=URL.createObjectURL(file);
    receiptPreview.innerHTML='<img src="'+url+'" alt="Prévia da notinha"><div><b>'+escapeHtml(file.name)+'</b><small>Toque para trocar o arquivo</small></div>';
  }else{
    receiptPreview.innerHTML='<span>📄</span><div><b>'+escapeHtml(file.name)+'</b><small>PDF selecionado</small></div>';
  }
});

financeReceiptForm?.addEventListener("submit",async event=>{
  event.preventDefault();
  const fd=new FormData(financeReceiptForm);
  const file=financeReceiptInput?.files?.[0];

  if(staffProfile?.active && supabaseClient){
    const submit=financeReceiptForm.querySelector('button[type="submit"]');
    submit.disabled=true;
    try{
      await saveReceiptPurchaseToServer(fd,file);
      financeReceiptForm.reset();
      if(receiptPreview) receiptPreview.innerHTML='<span>📷</span><b>Fotografar ou anexar</b><small>Imagem ou PDF da nota/comprovante</small>';
      closeSheets();
      await renderFinance();
      toast("Compra e comprovante salvos no servidor.");
    }catch(error){
      toast("Não foi possível salvar a compra.");
    }finally{
      submit.disabled=false;
    }
    return;
  }

  const rows=financeDrafts();
  const supplier=String(fd.get("supplier")||"Fornecedor não informado").trim();
  const amount=parseMoneyInput(fd.get("total"));
  const order=String(fd.get("order")||"").trim();
  rows.unshift({
    id:Date.now(),
    type:"expense",
    title:"Compra · "+supplier,
    meta:[order||"Sem OS vinculada","aguardando envio ao servidor"].join(" · "),
    amount,
    receiptName:file?.name||"",
    receiptType:file?.type||"",
    createdAt:new Date().toISOString()
  });
  saveFinanceDrafts(rows);
  financeReceiptForm.reset();
  if(receiptPreview) receiptPreview.innerHTML='<span>📷</span><b>Fotografar ou anexar</b><small>Imagem ou PDF da nota/comprovante</small>';
  closeSheets();
  renderFinance();
  toast("Rascunho da compra salvo localmente.");
});

financeExpenseForm?.addEventListener("submit",async event=>{
  event.preventDefault();
  const fd=new FormData(financeExpenseForm);
  const desc=String(fd.get("description")||"Despesa").trim();
  const amount=parseMoneyInput(fd.get("amount"));
  const category=String(fd.get("category")||"Despesa");
  const orderInput=String(fd.get("order")||"").trim();

  if(staffProfile?.active && supabaseClient){
    try{
      const order=await resolveWorkOrderFromInput(orderInput);
      const {error}=await supabaseClient.from("financial_transactions").insert({
        work_order_id:order?.id||null,
        direction:"expense",
        category,
        description:desc,
        amount,
        status:"open",
        created_by:staffSession?.user?.id||null
      });
      if(error) throw error;
      if(order?.id){
        await supabaseClient.from("activity_log").insert({
          work_order_id:order.id,
          actor_user_id:staffSession?.user?.id||null,
          actor_type:"user",
          event_type:"expense_added",
          payload:{description:desc,amount,category}
        });
      }
      financeExpenseForm.reset();
      closeSheets();
      await renderFinance();
      toast("Despesa salva no servidor.");
    }catch(error){
      toast("Não foi possível registrar a despesa.");
    }
    return;
  }

  const rows=financeDrafts();
  rows.unshift({
    id:Date.now(),
    type:"expense",
    title:desc,
    meta:[category,orderInput||"Sem OS vinculada"].join(" · "),
    amount,
    createdAt:new Date().toISOString()
  });
  saveFinanceDrafts(rows);
  financeExpenseForm.reset();
  closeSheets();
  renderFinance();
  toast("Despesa registrada como rascunho local.");
});

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

// ---- v11.7 quick operational updates ----
const osQuickSheet=document.getElementById("osQuickSheet");
const osQuickForm=document.getElementById("osQuickForm");
let osQuickSelectedId=null;
let osQuickSelectedState=null;

function toLocalDateTimeInput(value){
  if(!value) return "";
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return "";
  const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,16);
}
function demoIsoFromDisplay(value){
  if(!value||value==="A definir") return null;
  return null;
}
function setQuickState(state){
  osQuickSelectedState=state;
  document.querySelectorAll("[data-os-state]").forEach(btn=>btn.classList.toggle("selected",btn.dataset.osState===state));
  const hint=document.getElementById("osQuickHint");
  const messages={
    active:"Retoma a OS e remove bloqueios ativos.",
    waiting_parts:"Mantém a OS visível como aguardando peça. Informe o motivo/fornecedor.",
    waiting_customer:"Mantém a OS visível enquanto depende de retorno do cliente.",
    technical_difficulty:"Marca bloqueio técnico sem esconder a OS da gestão.",
    ready:"Conclui a execução e move para Prontas."
  };
  if(hint) hint.textContent=messages[state]||"Escolha uma situação e salve.";
}
function openOsQuickSheet(id){
  const order=allOrders().find(o=>String(o.id)===String(id));
  if(order&&isClosedOrder(order)){toast("Esta OS já está encerrada.");return}
  if(!order) return;
  osQuickSelectedId=order.id;
  const raw=order.raw||{};
  const operational=raw.operational_state||(
    kanbanStage(order)==="waiting_parts"?"waiting_parts":
    kanbanStage(order)==="waiting_customer"?"waiting_customer":
    kanbanStage(order)==="ready"?"ready":"active"
  );
  setQuickState(operational);
  document.getElementById("osQuickRef").textContent=order.ref+" · "+order.plate;
  document.getElementById("osQuickTitle").textContent=order.customer;
  document.getElementById("osQuickVehicle").textContent=order.vehicle;
  document.getElementById("osQuickStage").textContent=order.stage;
  document.getElementById("osQuickPromised").value=toLocalDateTimeInput(raw.customer_promised_at);
  document.getElementById("osQuickForecast").value=toLocalDateTimeInput(raw.forecast_at);
  document.getElementById("osQuickReason").value=order.blockedReason||"";
  const assigneeWrap=document.getElementById("osQuickAssigneeWrap");
  const assigneeSelect=document.getElementById("osQuickAssignee");
  const canAssign=hasPermission("work_orders.write_all");
  if(assigneeWrap) assigneeWrap.hidden=!canAssign;
  if(assigneeSelect && canAssign){
    assigneeSelect.innerHTML='<option value="">Sem responsável definido</option>'+assignableStaff.map(person=>
      '<option value="'+person.user_id+'">'+escapeHtml(person.full_name)+' · '+escapeHtml(staffRoleLabel(person.role))+'</option>'
    ).join("");
    assigneeSelect.value=order.assignedTo||"";
  }
  openSheet(osQuickSheet);
}
document.querySelectorAll("[data-os-state]").forEach(btn=>btn.addEventListener("click",()=>setQuickState(btn.dataset.osState)));

async function saveOsQuickUpdate(){
  const order=allOrders().find(o=>String(o.id)===String(osQuickSelectedId));
  if(!order||!osQuickSelectedState) return;
  const reason=document.getElementById("osQuickReason").value.trim();
  const promisedValue=document.getElementById("osQuickPromised").value;
  const forecastValue=document.getElementById("osQuickForecast").value;
  const needsReason=["waiting_parts","waiting_customer","technical_difficulty"].includes(osQuickSelectedState);
  if(needsReason&&!reason){
    document.getElementById("osQuickReason").focus();
    toast("Informe o motivo para esse bloqueio.");
    return;
  }

  const now=new Date().toISOString();
  if(order.server && staffProfile?.active && supabaseClient){
    const raw=order.raw||{};
    const patch={
      operational_state:osQuickSelectedState==="ready"?"active":osQuickSelectedState,
      blocked_since:needsReason?(raw.blocked_since||now):null,
      blocked_reason:needsReason?reason:null
    };
    if(promisedValue) patch.customer_promised_at=new Date(promisedValue).toISOString();
    if(forecastValue) patch.forecast_at=new Date(forecastValue).toISOString();
    if(hasPermission("work_orders.write_all")){
      const assigned=document.getElementById("osQuickAssignee")?.value||null;
      patch.assigned_to=assigned;
    }
    if(osQuickSelectedState==="ready") patch.status="ready";
    else if(osQuickSelectedState==="active" && raw.status==="ready") patch.status="in_service";

    const saveBtn=document.getElementById("osQuickSave");
    saveBtn.disabled=true;
    try{
      const {error}=await supabaseClient.from("work_orders").update(patch).eq("id",order.id);
      if(error) throw error;
      await supabaseClient.from("activity_log").insert({
        work_order_id:order.id,
        actor_user_id:staffSession?.user?.id||null,
        actor_type:"user",
        event_type:"work_order_operational_updated",
        payload:{
          operational_state:patch.operational_state,
          status:patch.status||raw.status||null,
          customer_promised_at:patch.customer_promised_at||raw.customer_promised_at||null,
          forecast_at:patch.forecast_at||raw.forecast_at||null,
          reason:patch.blocked_reason,
          assigned_to:patch.assigned_to??raw.assigned_to??null
        }
      });
      await syncServerData({quiet:true});
      closeSheets();
      renderDashboard();
      if(document.body.classList.contains("desktop-drawer-open")) openDetail(order.id);
      toast("Andamento atualizado no servidor.");
    }catch(error){
      const message=String(error?.message||error||"");
      if(message.includes("ready_requires_approved_work")){
        toast("Só é possível marcar como Pronta após a aprovação e execução do serviço.");
      }else if(message.includes("unresolved_stock_reservations")){
        toast("Ainda há peça pendente. Instale ou libere a reserva antes de marcar como Pronta.");
      }else if(message.includes("closed_work_order_immutable")){
        toast("Esta OS já está encerrada.");
      }else{
        toast("Não foi possível atualizar a OS.");
      }
    }finally{
      saveBtn.disabled=false;
    }
    return;
  }

  const stageMap={
    active:"Em execução",
    waiting_parts:"Aguardando peça",
    waiting_customer:"Aguardando cliente",
    technical_difficulty:"Bloqueada",
    ready:"Aguardando retirada"
  };
  const statusMap={
    active:"Em execução",
    waiting_parts:"Aguardando",
    waiting_customer:"Aguardando",
    technical_difficulty:"Aguardando",
    ready:"Pronta"
  };
  const healthMap={
    active:"on_track",
    waiting_parts:"waiting_parts",
    waiting_customer:"waiting_customer",
    technical_difficulty:"blocked",
    ready:"done"
  };
  const patch={
    stage:stageMap[osQuickSelectedState],
    status:statusMap[osQuickSelectedState],
    kind:osQuickSelectedState==="ready"?"ready":osQuickSelectedState==="active"?"service":"waiting",
    health:healthMap[osQuickSelectedState],
    blockedReason:needsReason?reason:"",
    promised:promisedValue?shortDateTime(new Date(promisedValue).toISOString()):order.promised,
    forecast:forecastValue?shortDateTime(new Date(forecastValue).toISOString()):order.forecast
  };
  saveKanbanOverride(order.id,patch);
  appendLocalOrderHistory(order.id,"work_order_operational_updated",{
    operational_state:osQuickSelectedState,
    customer_promised_at:promisedValue?new Date(promisedValue).toISOString():null,
    forecast_at:forecastValue?new Date(forecastValue).toISOString():null,
    reason:needsReason?reason:null
  });
  closeSheets();
  renderDashboard();
  renderOrders();
  if(document.body.classList.contains("desktop-drawer-open")) openDetail(order.id);
  toast("Andamento atualizado nesta demonstração.");
}

osQuickForm?.addEventListener("submit",event=>{event.preventDefault();saveOsQuickUpdate()});

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
const staffAuthSheet=document.getElementById("staffAuthSheet");
const staffInviteSheet=document.getElementById("staffInviteSheet");
const staffMemberSheet=document.getElementById("staffMemberSheet");
const deliverySheet=document.getElementById("deliverySheet");
const cancelWorkOrderSheet=document.getElementById("cancelWorkOrderSheet");

function openSheet(sheet){
  if(!sheet) return;
  [quickActionSheet,moreSheet,searchSheet,financeReceiptSheet,financeExpenseSheet,manualPaymentSheet,settleExpenseSheet,reservedPartSheet,stockMovementSheet,deliverySheet,cancelWorkOrderSheet,staffAuthSheet,pixPaymentSheet,osQuickSheet,budgetItemSheet,budgetSendSheet,staffInviteSheet,staffMemberSheet].forEach(s=>{if(s && s!==sheet)s.hidden=true});
  sheet.hidden=false;
  document.body.classList.add("sheet-open");
  document.body.classList.remove("no-scroll");
}
function closeSheets(){
  [quickActionSheet,moreSheet,searchSheet,financeReceiptSheet,financeExpenseSheet,manualPaymentSheet,settleExpenseSheet,reservedPartSheet,stockMovementSheet,deliverySheet,cancelWorkOrderSheet,staffAuthSheet,pixPaymentSheet,osQuickSheet,budgetItemSheet,budgetSendSheet,staffInviteSheet,staffMemberSheet].forEach(s=>{if(s)s.hidden=true});
  document.body.classList.remove("sheet-open");
  queueScrollLock();
}
document.querySelectorAll("[data-close-sheet]").forEach(btn=>btn.addEventListener("click",closeSheets));

let cancelWorkOrderSelectedId=null;

function openCancelWorkOrderSheet(id){
  const order=allOrders().find(o=>String(o.id)===String(id));
  if(!order) return toast("OS não encontrada.");
  if(isClosedOrder(order)) return toast("Esta OS já está encerrada.");
  if(!(order.server&&staffProfile?.active&&supabaseClient)) return toast("O cancelamento precisa ser registrado no servidor.");
  if(!hasPermission("work_orders.write_all")) return toast("Seu perfil não pode cancelar uma OS.");

  cancelWorkOrderSelectedId=order.id;
  document.getElementById("cancelWorkOrderRef").textContent=order.ref+" · "+order.plate;
  document.getElementById("cancelWorkOrderReason").value="";
  document.getElementById("cancelWorkOrderStatus").textContent="Nenhuma baixa física ou estorno financeiro será feito automaticamente.";
  document.getElementById("cancelWorkOrderSubmit").disabled=false;
  openSheet(cancelWorkOrderSheet);
  setTimeout(()=>document.getElementById("cancelWorkOrderReason")?.focus(),80);
}

document.getElementById("cancelWorkOrderForm")?.addEventListener("submit",async event=>{
  event.preventDefault();
  const orderId=cancelWorkOrderSelectedId;
  const reason=document.getElementById("cancelWorkOrderReason").value.trim();
  const status=document.getElementById("cancelWorkOrderStatus");
  const submit=document.getElementById("cancelWorkOrderSubmit");
  if(!orderId) return;
  if(reason.length<5){
    status.textContent="Informe um motivo claro para o cancelamento.";
    return;
  }

  submit.disabled=true;
  status.textContent="Conferindo estoque, financeiro e cobranças…";
  try{
    const drawerWasOpen=document.body.classList.contains("desktop-drawer-open");
    const {data,error}=await supabaseClient.rpc("cancel_work_order",{
      p_work_order_id:orderId,
      p_reason:reason
    });
    if(error) throw error;

    await syncServerData({quiet:true});
    closeSheets();
    renderDashboard();
    renderOrders();
    if(drawerWasOpen) openDetail(orderId);
    else if(currentView==="detail") openDetail(orderId,true);
    toast(data?.already_cancelled?"A OS já estava cancelada.":"OS cancelada com segurança.");
  }catch(error){
    const message=String(error?.message||error||"");
    if(message.includes("cancel_requires_stock_adjustment")){
      status.textContent="Há peça já instalada/baixada. Faça o acerto ou devolução de estoque antes de cancelar.";
    }else if(message.includes("cancel_requires_financial_adjustment")){
      status.textContent="Já existe valor recebido. O cancelamento precisa de acerto financeiro antes de encerrar a OS.";
    }else if(message.includes("cancel_has_active_payment_request")){
      status.textContent="Existe uma cobrança eletrônica ativa. Cancele/expire essa cobrança antes de cancelar a OS.";
    }else if(message.includes("delivered_work_order_cannot_cancel")){
      status.textContent="Uma OS já entregue não pode ser cancelada por este fluxo.";
    }else if(message.includes("cancel_reason_required")){
      status.textContent="Informe um motivo claro para o cancelamento.";
    }else if(message.includes("not_allowed")){
      status.textContent="Seu perfil não possui permissão para cancelar esta OS.";
    }else{
      status.textContent="Não foi possível cancelar. Nenhuma alteração parcial foi mantida.";
    }
  }finally{
    submit.disabled=false;
  }
});

let deliverySelectedOrderId=null;
let deliveryExistingSlots=new Set();
let deliverySelectedSlots=new Set();
const deliveryRequiredSlots=["front","rear","left","right"];

function updateDeliveryProgress(){
  const completed=new Set([...deliveryExistingSlots,...deliverySelectedSlots]);
  const count=deliveryRequiredSlots.filter(slot=>completed.has(slot)).length;
  const label=document.getElementById("deliveryPhotoLabel");
  const bar=document.getElementById("deliveryProgressBar");
  const submit=document.getElementById("deliverySubmit");
  if(label) label.textContent=count+" de 4 obrigatórias";
  if(bar) bar.style.width=(count/4*100)+"%";
  if(submit) submit.disabled=count!==4;
}

function resetDeliveryForm(){
  deliveryExistingSlots=new Set();
  deliverySelectedSlots=new Set();
  document.getElementById("deliveryForm")?.reset();
  document.querySelectorAll(".delivery-photo-card").forEach(card=>{
    card.classList.remove("captured");
    const input=card.querySelector("input");
    if(input){input.disabled=false;input.required=true}
    const preview=card.querySelector(".delivery-photo-preview");
    if(preview) preview.innerHTML="📷";
    const small=card.querySelector("small");
    if(small) small.textContent="obrigatória";
  });
  document.getElementById("deliveryStatus").textContent="A OS precisa estar como Pronta e todas as peças devem estar resolvidas.";
  updateDeliveryProgress();
}

async function loadExistingDeliveryInspection(orderId){
  const {data,error}=await supabaseClient
    .from("inspection_photos")
    .select("slot")
    .eq("work_order_id",orderId)
    .eq("phase","exit")
    .eq("required",true);
  if(error) throw error;
  deliveryExistingSlots=new Set((data||[]).map(row=>row.slot).filter(slot=>deliveryRequiredSlots.includes(slot)));
  document.querySelectorAll(".delivery-photo-card").forEach(card=>{
    const slot=card.dataset.deliverySlot;
    if(!deliveryExistingSlots.has(slot)) return;
    card.classList.add("captured");
    const input=card.querySelector("input");
    if(input){input.disabled=true;input.required=false}
    const preview=card.querySelector(".delivery-photo-preview");
    if(preview) preview.innerHTML="✓";
    const small=card.querySelector("small");
    if(small) small.textContent="já registrada";
  });
  updateDeliveryProgress();
}

async function openDeliverySheet(id){
  const order=allOrders().find(o=>String(o.id)===String(id));
  if(!order) return toast("OS não encontrada.");
  if(!(order.server&&staffProfile?.active&&supabaseClient)) return toast("A entrega precisa ser registrada no servidor.");
  if(!hasPermission("work_orders.write_all")) return toast("Seu perfil não pode concluir a entrega.");
  if(String(order.raw?.status||"").toLowerCase()!=="ready") return toast("A OS precisa estar como Pronta antes da entrega.");

  deliverySelectedOrderId=order.id;
  resetDeliveryForm();
  document.getElementById("deliveryOrderRef").textContent=order.ref;
  document.getElementById("deliveryStatus").textContent="Carregando vistoria de saída…";
  openSheet(deliverySheet);
  try{
    await loadExistingDeliveryInspection(order.id);
    document.getElementById("deliveryStatus").textContent=deliveryExistingSlots.size
      ?"As fotos já registradas foram preservadas. Complete o que faltar e confirme a entrega."
      :"Faça as quatro fotos de saída para liberar a confirmação.";
  }catch(error){
    document.getElementById("deliveryStatus").textContent="Não foi possível verificar as fotos de saída.";
  }
}

document.querySelectorAll(".delivery-photo-card input").forEach(input=>input.addEventListener("change",()=>{
  const card=input.closest(".delivery-photo-card");
  const file=input.files?.[0];
  if(!card||!file) return;
  const slot=card.dataset.deliverySlot;
  deliverySelectedSlots.add(slot);
  card.classList.add("captured");
  const preview=card.querySelector(".delivery-photo-preview");
  if(preview){
    const old=preview.querySelector("img");
    if(old?.src?.startsWith("blob:")) URL.revokeObjectURL(old.src);
    preview.innerHTML='<img alt="'+slot+'">';
    preview.querySelector("img").src=URL.createObjectURL(file);
  }
  const small=card.querySelector("small");
  if(small) small.textContent="pronta para enviar";
  updateDeliveryProgress();
}));

async function uploadDeliveryPhotos(orderId){
  const rows=[];
  for(const card of document.querySelectorAll(".delivery-photo-card")){
    const slot=card.dataset.deliverySlot;
    if(deliveryExistingSlots.has(slot)) continue;
    const input=card.querySelector("input");
    const file=input?.files?.[0];
    if(!file) continue;
    const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
    const storagePath=orderId+"/exit/"+slot+"-"+crypto.randomUUID()+"."+ext;
    const {error:uploadError}=await supabaseClient.storage
      .from("oficina-evidence")
      .upload(storagePath,file,{contentType:file.type||"image/jpeg",upsert:false});
    if(uploadError) throw uploadError;
    rows.push({
      work_order_id:orderId,
      phase:"exit",
      slot,
      storage_path:storagePath,
      required:true
    });
  }
  if(rows.length){
    const {error}=await supabaseClient.from("inspection_photos").insert(rows);
    if(error) throw error;
    rows.forEach(row=>deliveryExistingSlots.add(row.slot));
  }
  updateDeliveryProgress();
}

document.getElementById("deliveryForm")?.addEventListener("submit",async event=>{
  event.preventDefault();
  const orderId=deliverySelectedOrderId;
  if(!orderId) return;
  const completed=new Set([...deliveryExistingSlots,...deliverySelectedSlots]);
  if(deliveryRequiredSlots.some(slot=>!completed.has(slot))) return toast("Faça as quatro fotos de saída.");

  const kmRaw=String(document.getElementById("deliveryFinalKm").value||"").replace(/\D/g,"");
  const finalKm=kmRaw?parseInt(kmRaw,10):null;
  const submit=document.getElementById("deliverySubmit");
  const status=document.getElementById("deliveryStatus");
  submit.disabled=true;
  status.textContent="Enviando vistoria de saída…";

  try{
    await uploadDeliveryPhotos(orderId);
    status.textContent="Conferindo peças e concluindo a entrega…";
    const {data,error}=await supabaseClient.rpc("complete_work_order_delivery",{
      p_work_order_id:orderId,
      p_final_km:Number.isFinite(finalKm)?finalKm:null
    });
    if(error) throw error;

    await syncServerData({quiet:true});
    closeSheets();
    renderDashboard();
    renderOrders();
    renderClients();
    if(document.body.classList.contains("desktop-drawer-open")) closeDesktopOsDrawer();
    if(currentView==="detail") openDetail(orderId,true);
    toast(data?.already_delivered?"Entrega já estava registrada.":"Veículo entregue e OS encerrada.");
  }catch(error){
    const message=String(error?.message||error||"");
    if(message.includes("unresolved_stock_reservations")){
      status.textContent="Ainda há peças pendentes. Na aba Peças, marque cada item como Instalar ou Liberar antes da entrega.";
    }else if(message.includes("exit_inspection_incomplete")){
      status.textContent="A vistoria de saída ainda está incompleta.";
    }else if(message.includes("work_order_not_ready")){
      status.textContent="A OS não está mais como Pronta. Atualize o andamento antes de entregar.";
    }else if(message.includes("not_allowed")){
      status.textContent="Seu perfil não possui permissão para concluir a entrega.";
    }else if(message.includes("invalid_final_km")){
      status.textContent="Confira a quilometragem informada.";
    }else{
      status.textContent="Não foi possível concluir a entrega. As fotos já enviadas serão preservadas para a próxima tentativa.";
    }
  }finally{
    updateDeliveryProgress();
  }
});

document.getElementById("quickActionBtn")?.addEventListener("click",()=>openSheet(quickActionSheet));
document.getElementById("moreNavBtn")?.addEventListener("click",()=>openSheet(moreSheet));
document.getElementById("authStatusBtn")?.addEventListener("click",()=>openSheet(staffAuthSheet));
document.getElementById("desktopAuthBtn")?.addEventListener("click",()=>openSheet(staffAuthSheet));
document.getElementById("internalAccessGateBtn")?.addEventListener("click",()=>openSheet(staffAuthSheet));
document.getElementById("staffAccessShortcut")?.addEventListener("click",()=>{closeSheets();openSheet(staffAuthSheet)});
document.getElementById("staffLoginBtn")?.addEventListener("click",staffLogin);
document.getElementById("staffSignupBtn")?.addEventListener("click",staffSignup);
document.getElementById("inviteStaffBtn")?.addEventListener("click",()=>{
  if(!hasPermission("team.manage")) return toast("Somente o proprietário pode convidar usuários.");
  document.getElementById("staffInviteForm")?.reset();
  openSheet(staffInviteSheet);
});
document.getElementById("staffInviteForm")?.addEventListener("submit",async event=>{
  event.preventDefault();
  if(!hasPermission("team.manage")) return;
  const form=event.currentTarget;
  const fd=new FormData(form);
  const submit=form.querySelector('button[type="submit"]');
  submit.disabled=true;
  try{
    const {error}=await supabaseClient.rpc("create_staff_invite",{
      p_email:String(fd.get("email")||"").trim(),
      p_full_name:String(fd.get("full_name")||"").trim(),
      p_role:String(fd.get("role")||"mechanic"),
      p_expires_days:30
    });
    if(error) throw error;
    closeSheets();
    await renderTeam();
    toast("Convite criado. A pessoa já pode criar a própria senha.");
  }catch{
    toast("Não foi possível criar o convite.");
  }finally{submit.disabled=false}
});
document.getElementById("staffMemberRole")?.addEventListener("change",event=>{
  const hint=document.getElementById("staffMemberHint");
  if(hint) hint.textContent=teamRoleDescription(event.target.value);
});
document.getElementById("staffMemberForm")?.addEventListener("submit",async event=>{
  event.preventDefault();
  if(!hasPermission("team.manage")) return;
  const userId=document.getElementById("staffMemberId").value;
  const role=document.getElementById("staffMemberRole").value;
  const active=document.getElementById("staffMemberActive").checked;
  const submit=document.getElementById("saveStaffMember");
  submit.disabled=true;
  try{
    const {error}=await supabaseClient.rpc("manage_staff_member",{p_user_id:userId,p_role:role,p_active:active});
    if(error){
      if(String(error.message||"").includes("last_owner_protected")) toast("Não é possível remover o último proprietário ativo.");
      else toast("Não foi possível salvar o acesso.");
      return;
    }
    closeSheets();
    await renderTeam();
    await loadAssignableStaff();
    toast("Acesso atualizado.");
  }finally{submit.disabled=false}
});
document.getElementById("staffLogoutBtn")?.addEventListener("click",async()=>{
  await supabaseClient?.auth.signOut();
  staffSession=null;staffProfile=null;staffPermissions=[];assignableStaff=[];
  applyPermissionUI();
  renderStaffAuthState("Sessão encerrada. Entre novamente para acessar a oficina.");
});
supabaseClient?.auth.onAuthStateChange(()=>setTimeout(()=>refreshStaffSession(),0));
document.getElementById("globalSearchBtn")?.addEventListener("click",()=>{
  openSheet(searchSheet);
  setTimeout(()=>document.getElementById("globalSearchInput")?.focus(),80);
});
document.querySelectorAll("[data-sheet-go]").forEach(btn=>btn.addEventListener("click",()=>{
  if(btn.dataset.sheetGo==="new-os") resetWizard();
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
renderFinance();

const desktopMedia=window.matchMedia("(min-width:1100px)");
desktopMedia.addEventListener?.("change",()=>{
  renderDashboard();
  renderOrders();
  renderClients();
});
updatePhotoProgress();
renderApprovalState();

if(isPublicApprovalRequest()){
  go("client-approval");
}else{
  syncInternalAccessGate();
}
refreshStaffSession();
