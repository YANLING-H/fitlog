import { store, persist } from "./db.js";
import { estimateMeal, fixMeal, coachReview, describeError, getKey, setKey, getModel, setModel, testKey } from "./ai.js";
import { lookupFood } from "./foods.js";

const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad=n=>String(n).padStart(2,"0");
const ymd=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const parseYmd=s=>{const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)};
const addDays=(s,n)=>{const d=parseYmd(s);d.setDate(d.getDate()+n);return ymd(d)};
const WD="日一二三四五六";
const fmtDate=s=>{const d=parseYmd(s);return (d.getMonth()+1)+"/"+d.getDate()+" 周"+WD[d.getDay()]};
const r0=n=>Math.round(+n||0);
const uid=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove("show"),2200)}

/* ---------- state ---------- */
const S={date:ymd(new Date()),tab:"today",settings:null,plan:null,days:{},favs:[],coach:null,
  wDraft:null,quick:"recent"};
const dayDoc=d=>S.days[d]||(S.days[d]={kind:"day",date:d,meals:[],workout:null});
async function saveDay(d){
  const doc=dayDoc(d);
  const empty=!doc.meals.length&&!doc.workout&&doc.weight==null&&!(doc.photos&&doc.photos.length);
  try{ if(empty) await store.del("d-"+d); else await store.set("d-"+d,doc); }
  catch(e){console.error(e);toast(e&&e.name==="QuotaExceededError"?"手机存储空间不足，请先导出备份并清理":"保存失败，请再试一次");throw e}
}
const targets=()=>S.settings&&S.settings.targets&&S.settings.targets.kcal?S.settings.targets:null;
const sumMeals=meals=>meals.reduce((a,m)=>({kcal:a.kcal+(+m.kcal||0),p:a.p+(+m.p||0),c:a.c+(+m.c||0),f:a.f+(+m.f||0)}),{kcal:0,p:0,c:0,f:0});
const sumItems=items=>items.reduce((a,i)=>({kcal:a.kcal+(+i.kcal||0),p:a.p+(+i.p||0),c:a.c+(+i.c||0),f:a.f+(+i.f||0)}),{kcal:0,p:0,c:0,f:0});
const gym=()=>{const s=S.settings||{};return {bar:+s.bar||45,incr:+s.incr||5,rest:+s.rest||120,plates:String(s.plates||"45,35,25,10,5,2.5").split(/[,，\s]+/).map(Number).filter(x=>x>0).sort((a,b)=>b-a)}};
const working=e=>e.sets.filter(x=>!x.warm&&x.r!==""&&x.r!=null);
const e1rm=(w,r)=>(+w>0&&+r>0)?(+w)*(1+(+r)/30):0;

/* ---------- nav ---------- */
function setTab(t){
  S.tab=t;
  document.querySelectorAll("nav.tabs button").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab===t?"true":"false"));
  ["today","food","train","plan","prog","me"].forEach(k=>{$("#v-"+k).hidden=k!==t});
  wakeLock();
  try{localStorage.setItem("fitlog:tab",t)}catch(e){}
  render();window.scrollTo(0,0);
}
document.querySelectorAll("nav.tabs button").forEach(b=>b.addEventListener("click",()=>setTab(b.dataset.tab)));
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>setTab(b.dataset.go)));
$("#dateInput").addEventListener("change",e=>{if(e.target.value){S.date=e.target.value;S.wDraft=null;render()}});
$("#prevDay").addEventListener("click",()=>{S.date=addDays(S.date,-1);S.wDraft=null;render()});
$("#nextDay").addEventListener("click",()=>{S.date=addDays(S.date,1);S.wDraft=null;render()});

function render(){
  $("#dateInput").value=S.date;
  const isToday=S.date===ymd(new Date());
  $("#todayTitle").textContent=isToday?"今天吃够了吗":fmtDate(S.date)+" 吃够了吗";
  $("#foodDayTitle").textContent=(isToday?"今天":fmtDate(S.date))+"的饮食";
  $("#trainTitle").textContent=(isToday?"今天":fmtDate(S.date))+"的训练";
  if(S.tab==="today")renderToday();
  if(S.tab==="food")renderFood();
  if(S.tab==="train")renderTrain();
  if(S.tab==="plan")renderPlan();
  if(S.tab==="prog")renderProg();
  if(S.tab==="me")renderSettings();
}

/* ---------- today ---------- */
function status(v,t,kind){
  if(!t)return "none";
  const r=v/t;
  if(kind==="p") return r>=0.9?"ok":r>=0.7?"warn":"bad";
  if(kind==="kcal") return r<0.75?"bad":r<0.9?"warn":r<=1.1?"ok":r<=1.2?"warn":"bad";
  return r<0.7?"warn":r<=1.2?"ok":"warn";
}
function renderToday(){
  const doc=dayDoc(S.date),tot=sumMeals(doc.meals),T=targets();
  const arc=$("#ringArc"),C=2*Math.PI*52;
  const kr=T?Math.min(tot.kcal/T.kcal,1):0;
  arc.setAttribute("stroke-dasharray",(kr*C)+" "+C);
  const ks=status(tot.kcal,T&&T.kcal,"kcal");
  arc.setAttribute("stroke",ks==="bad"&&tot.kcal>(T?T.kcal:0)?"var(--bad)":"var(--kcal)");
  $("#kcalBig").textContent=r0(tot.kcal);
  $("#kcalSub").textContent=T?"/ "+r0(T.kcal)+" 千卡":"千卡";
  const M=[["p","蛋白质","--pro"],["c","碳水","--carb"],["f","脂肪","--fat"]];
  $("#macroBars").innerHTML=M.map(([k,n,c])=>{
    const v=tot[k],t=T?T[k]:0,w=t?Math.min(v/t,1.3)/1.3*100:0,tick=100/1.3;
    return `<div><div class="bar-h"><span class="lbl">${n}</span><span class="val">${r0(v)}<small> / ${t?r0(t)+" g":"—"}</small></span></div>
      <div class="track"><i style="width:${w}%;background:var(${c})"></i>${t?`<span class="tick" style="left:${tick}%"></span>`:""}</div></div>`}).join("");
  const v=$("#verdict"),pill=$("#todayPill");
  if(!T){v.className="verdict none";v.textContent="先到「设置」填身高、体重和目标，我会算出每天该吃多少。";pill.innerHTML="";}
  else if(!doc.meals.length){v.className="verdict none";v.textContent="这天还没有记录饮食。到「饮食」拍一张照片开始。";pill.innerHTML=`<span class="pill none">未记录</span>`;}
  else{
    const ps=status(tot.p,T.p,"p");
    const lines=[];
    const dk=T.kcal-tot.kcal,dp=T.p-tot.p;
    if(ps!=="ok") lines.push(`蛋白质还差 <b>${r0(dp)} g</b>（约 ${Math.max(1,Math.round(dp/25))} 份手掌大小的肉、鱼、蛋或一杯蛋白粉）。`);
    else lines.push(`蛋白质达标（${r0(tot.p/T.p*100)}%）。`);
    if(ks==="ok") lines.push(`热量在目标范围内（${r0(tot.kcal/T.kcal*100)}%）。`);
    else if(dk>0) lines.push(`热量还有 <b>${r0(dk)} 千卡</b>空间。`);
    else lines.push(`热量超出目标 <b>${r0(-dk)} 千卡</b>。`);
    if(tot.c<T.c*0.6&&dk>150) lines.push("碳水偏少，训练日可以加一份米饭、燕麦或水果。");
    if(tot.f>T.f*1.25) lines.push("脂肪偏高，留意烹调油和坚果。");
    const worst=[ps,ks].includes("bad")?"bad":[ps,ks].includes("warn")?"warn":"ok";
    v.className="verdict "+worst;v.innerHTML=lines.join(" ");
    pill.innerHTML=worst==="ok"?`<span class="pill ok">吃够了</span>`:dk>0||ps!=="ok"?`<span class="pill ${worst}">还没吃够</span>`:`<span class="pill ${worst}">吃多了</span>`;
  }
  // workout summary
  const w=doc.workout;
  $("#todayWorkout").innerHTML=w?`<div class="row between"><b>${esc(w.dayName||"训练")}</b><span class="small muted">${w.week?"第 "+w.week+" 周 · ":""}${w.exercises.length} 个动作 · ${w.exercises.reduce((a,e)=>a+working(e).length,0)} 组</span></div>
    <div class="small muted">${w.exercises.slice(0,4).map(e=>esc(e.name)+" "+bestSet(e)).join(" · ")}${w.exercises.length>4?" …":""}</div>`
    :`<div class="empty">这天还没有训练记录。${S.plan?"到「训练」选今天练哪一天，计划会自动预填。":""}</div>`;
  renderWeek();
}
function bestSet(e){const s=working(e);if(!s.length)return "";const top=s.reduce((a,b)=>(+b.w||0)>(+a.w||0)?b:a);return (top.w?top.w+"×":"")+top.r}
function renderWeek(){
  const T=targets(),end=S.date,cols=[];
  let maxK=T?T.kcal*1.3:0,maxP=T?T.p*1.3:0;
  const data=[];for(let i=6;i>=0;i--){const d=addDays(end,-i),doc=S.days[d],t=doc?sumMeals(doc.meals):{kcal:0,p:0};data.push({d,t,w:!!(doc&&doc.workout),has:!!(doc&&doc.meals.length)});maxK=Math.max(maxK,t.kcal);maxP=Math.max(maxP,t.p)}
  maxK=maxK||1;maxP=maxP||1;
  $("#weekChart").innerHTML=data.map(x=>`<div class="col" title="${x.d}：${r0(x.t.kcal)} 千卡，蛋白质 ${r0(x.t.p)} g">
    <div class="dumb">${x.w?"练":""}</div>
    <div class="stack">${T?`<span class="tl" style="bottom:${T.kcal/maxK*90}px"></span>`:""}
      <i style="height:${x.t.kcal/maxK*90}px;background:var(--kcal)"></i><i style="height:${x.t.p/maxP*90}px;background:var(--pro)"></i></div>
    <div class="d ${x.d===S.date?"today":""}">${parseYmd(x.d).getMonth()+1}/${parseYmd(x.d).getDate()}</div></div>`).join("");
  const logged=data.filter(x=>x.has),n=logged.length,wk=data.filter(x=>x.w).length;
  if(!n){$("#weekSummary").textContent=`这 7 天练了 ${wk} 次，还没有饮食记录。`;return}
  const avgK=logged.reduce((a,x)=>a+x.t.kcal,0)/n,avgP=logged.reduce((a,x)=>a+x.t.p,0)/n;
  const hitP=T?logged.filter(x=>x.t.p>=T.p*0.9).length:0;
  $("#weekSummary").textContent=`这 7 天练了 ${wk} 次；记录了 ${n} 天饮食，平均 ${r0(avgK)} 千卡、蛋白质 ${r0(avgP)} g`+(T?`，蛋白质达标 ${hitP}/${n} 天。`:"。")+(T?" 虚线是热量目标；蛋白质柱以同样比例画，柱顶到虚线即达标。":"");
}

/* ---------- food ---------- */
const MEALTYPES=["早餐","午餐","晚餐","加餐"];
function guessMealType(){const h=new Date().getHours();return h<10?"早餐":h<15?"午餐":h<20?"晚餐":"加餐"}
const nowHM=()=>new Date().toTimeString().slice(0,5);
const mealSig=m=>m.items.map(i=>i.name).filter(Boolean).sort().join("、");
// Unique meals by their foods, newest first, with how often each was eaten.
function quickLists(){
  const seen=new Map();
  for(const d of Object.keys(S.days).sort().reverse())for(const m of [...S.days[d].meals].reverse()){
    const k=mealSig(m);if(!k)continue;const e=seen.get(k);if(e)e.n++;else seen.set(k,{m,n:1});
  }
  const all=[...seen.values()];
  return {recent:all.slice(0,8),frequent:all.filter(x=>x.n>=2).sort((a,b)=>b.n-a.n).slice(0,8),favs:S.favs.map(m=>({m,n:0}))};
}
const isFav=m=>S.favs.some(f=>mealSig(f)===mealSig(m));
async function toggleFav(m){
  const k=mealSig(m);
  if(S.favs.some(f=>mealSig(f)===k)){S.favs=S.favs.filter(f=>mealSig(f)!==k);toast("已取消收藏")}
  else{S.favs.unshift({id:uid(),type:m.type,items:JSON.parse(JSON.stringify(m.items)),kcal:m.kcal,p:m.p,c:m.c,f:m.f,thumb:m.thumb||""});toast("已收藏")}
  render();
  try{await store.set("favs",S.favs)}catch(e){toast("保存失败，请再试一次")}
}
async function relog(m){
  const rec={...JSON.parse(JSON.stringify(m)),id:uid(),type:guessMealType(),time:nowHM(),note:""};
  delete rec.aiNote;delete rec.confidence;
  dayDoc(S.date).meals.push(rec);render();
  try{await saveDay(S.date);toast(`已记到${rec.type}，在下面可以改`)}catch(e){}
}
function renderQuick(){
  const L=quickLists();
  $("#quickTabs").innerHTML=[["recent","最近"],["frequent","常吃"],["favs","收藏"]].map(([k,n])=>`<button class="chip" data-q="${k}" aria-pressed="${S.quick===k}">${n}</button>`).join("");
  $("#quickTabs").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{S.quick=b.dataset.q;renderQuick()}));
  const list=L[S.quick];
  $("#quickList").innerHTML=list.length?list.map((x,i)=>`<div class="qrow">
    ${x.m.thumb?`<img class="thumb" src="${esc(x.m.thumb)}" alt="">`:`<div class="thumb">${esc(x.m.type||"")}</div>`}
    <div style="min-width:0"><div class="small"><b>${esc(mealSig(x.m))}</b></div><div class="small muted mono">${r0(x.m.kcal)} 千卡 · P${r0(x.m.p)} C${r0(x.m.c)} F${r0(x.m.f)}${x.n>1?` · 吃过 ${x.n} 次`:""}</div></div>
    <div class="acts"><button class="star" data-fav="${i}" aria-pressed="${isFav(x.m)}" aria-label="收藏">★</button><button class="btn small" data-relog="${i}">记一份</button></div></div>`).join("")
    :`<div class="empty">${S.quick==="favs"?"在饮食记录或这里点 ★，常吃的一餐就会出现在收藏里。":S.quick==="frequent"?"同一组食物记过两次以上，就会出现在这里。":"记过的餐会出现在这里，点「记一份」就能再记一次。"}</div>`;
  $("#quickList").querySelectorAll("[data-relog]").forEach(b=>b.addEventListener("click",()=>relog(list[+b.dataset.relog].m)));
  $("#quickList").querySelectorAll("[data-fav]").forEach(b=>b.addEventListener("click",()=>toggleFav(list[+b.dataset.fav].m)));
}
function renderFood(){
  const doc=dayDoc(S.date),tot=sumMeals(doc.meals),T=targets();
  $("#foodDayTotal").textContent=`${r0(tot.kcal)}${T?" / "+r0(T.kcal):""} 千卡 · P${r0(tot.p)} C${r0(tot.c)} F${r0(tot.f)}`;
  const order=m=>MEALTYPES.indexOf(m.type);
  const meals=[...doc.meals].sort((a,b)=>order(a)-order(b)||(a.time||"").localeCompare(b.time||""));
  $("#mealList").innerHTML=meals.length?meals.map(m=>`<div class="meal">
    ${m.thumb?`<img class="thumb" src="${esc(m.thumb)}" alt="">`:`<div class="thumb">${esc(m.type)}</div>`}
    <div style="min-width:0"><div class="t">${esc(m.type)} · ${esc(m.items.map(i=>i.name).join("、")||"未命名")}</div>
      <div class="m">P ${r0(m.p)}g · C ${r0(m.c)}g · F ${r0(m.f)}g</div>
      ${m.note?`<div class="small muted">${esc(m.note)}</div>`:""}</div>
    <div><div class="k">${r0(m.kcal)}<span class="small muted"> 千卡</span></div>
      <div class="acts"><button class="star" data-fav="${m.id}" aria-pressed="${isFav(m)}" aria-label="收藏">★</button><button class="btn" data-edit="${m.id}">改</button><button class="btn" data-del="${m.id}">删</button></div></div></div>`).join("")
    :`<div class="empty">这天还没有饮食记录。上传照片，Claude 会列出每样食物的克数和营养，你确认后保存；常吃的可以在上面「快速再记」一键记录。</div>`;
  $("#mealList").querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>{const m=doc.meals.find(x=>x.id===b.dataset.edit);if(m)openMealEditor(JSON.parse(JSON.stringify(m)),false)}));
  $("#mealList").querySelectorAll("[data-fav]").forEach(b=>b.addEventListener("click",()=>{const m=doc.meals.find(x=>x.id===b.dataset.fav);if(m)toggleFav(m)}));
  $("#mealList").querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>confirmInline(b,"确认删除",async()=>{doc.meals=doc.meals.filter(x=>x.id!==b.dataset.del);render();await saveDay(S.date);toast("已删除")})));
  const ai=$("#aiState");
  ai.innerHTML=getKey()?"":`照片识别要先到「设置」填 Anthropic API key；没有 key 也可以手动填写。`;
  renderQuick();
}
function confirmInline(btn,label,fn){
  if(btn.dataset.armed){fn();return}
  const old=btn.textContent;btn.dataset.armed="1";btn.textContent=label;btn.classList.add("danger");
  setTimeout(()=>{if(btn.isConnected){delete btn.dataset.armed;btn.textContent=old;btn.classList.remove("danger")}},3000);
}
function loadImage(file){return new Promise((res,rej)=>{const url=URL.createObjectURL(file),img=new Image();img.onload=()=>{res(img);};img.onerror=()=>{URL.revokeObjectURL(url);rej(new Error("图片无法读取"))};img.src=url})}
function shrink(img,max,q,asBlob){
  const s=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
  const c=document.createElement("canvas");c.width=Math.round(img.naturalWidth*s);c.height=Math.round(img.naturalHeight*s);
  c.getContext("2d").drawImage(img,0,0,c.width,c.height);
  if(!asBlob) return c.toDataURL("image/jpeg",q);
  return new Promise(r=>c.toBlob(r,"image/jpeg",q));
}
function thumbSquare(img){
  const n=160,c=document.createElement("canvas");c.width=c.height=n;
  const w=img.naturalWidth,h=img.naturalHeight,m=Math.min(w,h);
  c.getContext("2d").drawImage(img,(w-m)/2,(h-m)/2,m,m,0,0,n,n);
  return c.toDataURL("image/jpeg",0.6);
}
const MAX_PHOTOS=5;
async function addPhotos(meal,files){
  for(const f of [...files].slice(0,MAX_PHOTOS-meal.blobs.length)){
    const img=await loadImage(f);
    meal.blobs.push(await shrink(img,1280,0.82,true));meal.previews.push(shrink(img,600,0.75,false));
    if(!meal.thumb)meal.thumb=thumbSquare(img);
  }
}
$("#photoInput").addEventListener("change",async e=>{
  const files=[...(e.target.files||[])];e.target.value="";if(!files.length)return;
  try{
    const meal={id:uid(),type:guessMealType(),time:nowHM(),items:[],thumb:"",note:"",blobs:[],previews:[]};
    await addPhotos(meal,files);
    openMealEditor(meal,true,"photo");
  }catch(err){toast(err.message||"图片无法读取")}
});
$("#textMealBtn").addEventListener("click",()=>openMealEditor({id:uid(),type:guessMealType(),time:nowHM(),items:[],thumb:"",note:""},true,"text"));
$("#manualMealBtn").addEventListener("click",()=>openMealEditor({id:uid(),type:guessMealType(),time:nowHM(),items:[{name:"",amount:"",g:"",kcal:"",p:"",c:"",f:""}],thumb:"",note:""},true,"manual"));

// Items that carry grams and per-100 g values are recomputed here; items without them are plain numbers.
const MK=["kcal","p","c","f"];
function calcItem(it){if(it.per&&it.g!==""&&it.g!=null){const g=+it.g||0;MK.forEach(k=>it[k]=Math.round(it.per[k]*g/10)/10)}return it}
function fromAi(x){
  const tbl=lookupFood(x.name);
  const per=tbl||{kcal:+x.kcal_100g||0,p:+x.protein_100g||0,c:+x.carbs_100g||0,f:+x.fat_100g||0};
  const g=r0(x.grams);
  return calcItem({name:String(x.name||""),amount:String(x.amount||""),g,lo:r0(x.grams_low)||g,hi:r0(x.grams_high)||g,per,src:tbl?"成分表":"Claude",asm:Array.isArray(x.assumptions)?x.assumptions.map(String).filter(Boolean).slice(0,4):[]});
}
function toAi(it){
  const g=+it.g||0,per=it.per||(g?Object.fromEntries(MK.map(k=>[k,(+it[k]||0)/g*100])):null);
  return {name:it.name,amount:it.amount||"",grams:g||100,grams_low:+it.lo||g||100,grams_high:+it.hi||g||100,
    kcal_100g:r0(per?per.kcal:+it.kcal),protein_100g:r0(per?per.p:+it.p),carbs_100g:r0(per?per.c:+it.c),fat_100g:r0(per?per.f:+it.f),assumptions:it.asm||[]};
}
// kcal range from the gram range; items without one count as exact.
const kcalRange=items=>items.reduce((a,it)=>{const k=+it.kcal||0;if(it.per&&+it.lo&&+it.hi){a[0]+=it.per.kcal*it.lo/100;a[1]+=it.per.kcal*it.hi/100}else{a[0]+=k;a[1]+=k}return a},[0,0]);

function closeSheet(){$("#sheetRoot").innerHTML="";document.body.style.overflow=""}
function openMealEditor(meal,isNew,mode){
  const root=$("#sheetRoot");document.body.style.overflow="hidden";
  let ctrl=null;
  meal.blobs=meal.blobs||[];meal.previews=meal.previews||[];
  const ai=mode==="photo"||mode==="text";
  root.innerHTML=`<div class="sheet-bg" id="sheetBg"><div class="sheet" role="dialog" aria-modal="true" aria-label="记录一餐">
    <div class="row between"><h2>${isNew?"记录一餐":"修改这一餐"}</h2><button class="icon-btn" id="mClose" aria-label="关闭">×</button></div>
    ${mode==="photo"?`<div class="thumbs" id="mThumbs"></div>`:""}
    <div class="row">
      <div class="chips" id="mType">${MEALTYPES.map(t=>`<button class="chip" data-t="${t}" aria-pressed="${t===meal.type}">${t}</button>`).join("")}</div>
    </div>
    ${ai?`<label class="f">${mode==="photo"?"补充说明（可选，写了更准）":"吃了什么"}<textarea id="mHint" rows="2" placeholder="${mode==="photo"?"例如：外卖，米饭吃了半碗，鸡胸约 150 g，少油":"例如：一碗牛肉面，加一个卤蛋，一杯无糖豆浆"}"></textarea></label>
      <div class="row"><button class="btn primary" id="mAsk">${mode==="photo"?"估算这餐":"估算营养"}</button><span class="small muted" id="mAskState"></span></div>`:""}
    <div id="mResult"></div>
    <div id="mFixBox" hidden><label class="f">哪里不对？用一句话说，只改你提到的<input id="mFix" placeholder="例如：鸡胸其实是 150 g，没有放酱"></label>
      <div class="row"><button class="btn" id="mFixBtn">按这句话修正</button><span class="small muted" id="mFixState"></span></div></div>
    <div class="whatif" id="mWhatIf"></div>
    <label class="f">备注<input id="mNote" value="${esc(meal.note)}" placeholder="可选"></label>
    <div class="row"><button class="btn primary" id="mSave">保存</button><button class="btn ghost" id="mCancel">取消</button></div>
  </div></div>`;
  const drawThumbs=()=>{const el=$("#mThumbs");if(!el)return;
    el.innerHTML=meal.previews.map(p=>`<img src="${p}" alt="食物照片">`).join("")+(meal.blobs.length<MAX_PHOTOS?`<label class="thumb" style="width:84px;height:84px;flex:none;cursor:pointer;border:1.5px dashed var(--line)">＋ 再加一张<input type="file" accept="image/*" multiple hidden id="mMore"></label>`:"");
    const more=$("#mMore");if(more)more.addEventListener("change",async e=>{const fs=[...(e.target.files||[])];e.target.value="";try{await addPhotos(meal,fs);drawThumbs()}catch(err){toast(err.message)}});
  };
  drawThumbs();
  const whatIf=()=>{
    const T=targets(),other=sumMeals(dayDoc(S.date).meals.filter(x=>x.id!==meal.id)),t=sumItems(meal.items),k=other.kcal+t.kcal,p=other.p+t.p;
    $("#mWhatIf").hidden=!meal.items.length;
    $("#mWhatIf").innerHTML=!meal.items.length?"":!T?`加上这餐，这天共 <b>${r0(k)}</b> 千卡、蛋白质 <b>${r0(p)}</b> g。`
      :`加上这餐，这天共 <b>${r0(k)}</b> / ${r0(T.kcal)} 千卡（${k<=T.kcal?"还剩 "+r0(T.kcal-k):"超出 "+r0(k-T.kcal)}），蛋白质 <b>${r0(p)}</b> / ${r0(T.p)} g（${p<T.p?"还差 "+r0(T.p-p)+" g":"达标"}）。`;
  };
  const totals=()=>{
    const t=sumItems(meal.items),[lo,hi]=kcalRange(meal.items);
    $("#sumK").textContent=r0(t.kcal);$("#sumP").textContent=r0(t.p);$("#sumC").textContent=r0(t.c);$("#sumF").textContent=r0(t.f);
    $("#sumRange").textContent=r0(hi)-r0(lo)>=10?`按份量范围，热量大约在 ${r0(lo)}–${r0(hi)} 千卡之间。`:"";
    whatIf();
  };
  const drawItems=()=>{
    $("#mResult").innerHTML=(meal.items.length?`<div class="tbl-wrap"><table>
      <thead><tr><th>食物</th><th>克</th><th>千卡</th><th>蛋白</th><th>碳水</th><th>脂肪</th><th></th></tr></thead>
      <tbody>${meal.items.map((it,i)=>`<tr data-i="${i}">
        <td style="min-width:130px"><input data-k="name" value="${esc(it.name)}" aria-label="食物">
          <div class="range">${[it.amount,+it.lo&&+it.hi&&it.lo!==it.hi?it.lo+"–"+it.hi+" g":"",it.src].filter(Boolean).map(esc).join(" · ")}</div>
          ${it.asm&&it.asm.length?`<div class="asm">${it.asm.map(a=>`<button data-asm="${esc(a)}" title="点一下，在下面用一句话改">${esc(a)}</button>`).join("")}</div>`:""}</td>
        <td class="n"><input data-k="g" type="number" inputmode="decimal" value="${esc(it.g??"")}" aria-label="克数" placeholder="-"></td>
        ${MK.map(k=>`<td class="n"><input data-k="${k}" type="number" inputmode="decimal" value="${esc(it[k]===""?"":r0(it[k]))}" aria-label="${k}"></td>`).join("")}
        <td><button class="x" data-rm="${i}" aria-label="删除这一行">×</button></td></tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="2">合计</td><td class="mono" id="sumK"></td><td class="mono" id="sumP"></td><td class="mono" id="sumC"></td><td class="mono" id="sumF"></td><td></td></tr></tfoot>
    </table></div><div class="small muted" id="sumRange"></div>
    <div class="small muted">改克数会按每 100 克的营养自动重算，不用再问 Claude。直接改热量或营养素，这一项就按你填的数字算。</div>`:"")
    +(meal.aiNote?`<div class="small muted">${meal.confidence?`<span class="pill ${meal.confidence==="高"?"ok":meal.confidence==="中"?"warn":"bad"}">把握：${esc(meal.confidence)}</span> `:""}${esc(meal.aiNote)}</div>`:"")
    +`<div class="row"><button class="btn ghost" id="mAddRow">＋ 加一样食物</button></div>`;
    $("#mResult").querySelectorAll("tbody input").forEach(inp=>inp.addEventListener("input",()=>{
      const tr=inp.closest("tr"),it=meal.items[+tr.dataset.i],k=inp.dataset.k;it[k]=inp.value;
      if(k==="g"&&it.per){calcItem(it);MK.forEach(m=>{tr.querySelector(`[data-k="${m}"]`).value=r0(it[m])})}
      else if(MK.includes(k)&&it.per){it.per=null;it.src="手动";it.lo=it.hi=""}
      if(k==="name"){const tbl=lookupFood(it.name);if(tbl&&it.src!=="手动"&&+it.g){it.per=tbl;it.src="成分表";calcItem(it);MK.forEach(m=>{tr.querySelector(`[data-k="${m}"]`).value=r0(it[m])})}}
      if(k!=="name")totals();
    }));
    $("#mResult").querySelectorAll("[data-rm]").forEach(b=>b.addEventListener("click",()=>{meal.items.splice(+b.dataset.rm,1);drawItems()}));
    $("#mResult").querySelectorAll("[data-asm]").forEach(b=>b.addEventListener("click",()=>{const f=$("#mFix");f.value=`「${b.dataset.asm}」不对，`;f.focus()}));
    $("#mAddRow").addEventListener("click",()=>{meal.items.push({name:"",amount:"",g:"",kcal:"",p:"",c:"",f:""});drawItems()});
    $("#mFixBox").hidden=!(meal.items.length&&getKey());
    if(meal.items.length)totals();else whatIf();
  };
  drawItems();
  $("#mType").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{meal.type=b.dataset.t;$("#mType").querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x===b?"true":"false"))}));
  const close=()=>{if(ctrl)ctrl.abort();closeSheet()};
  $("#mClose").addEventListener("click",close);$("#mCancel").addEventListener("click",close);
  $("#sheetBg").addEventListener("click",e=>{if(e.target.id==="sheetBg")close()});
  const applyAi=res=>{
    const items=Array.isArray(res&&res.items)?res.items:[];
    meal.items=items.map(fromAi);
    meal.aiNote=String(res&&res.note||"");meal.confidence=["高","中","低"].includes(res&&res.confidence)?res.confidence:"";
    drawItems();return items.length;
  };
  // Runs one Claude call with a spinner; keeps the photos and the button so a failure can simply be retried.
  const run=async(btn,state,fn,okText,retryText)=>{
    btn.disabled=true;state.innerHTML=`<span class="spin"></span> 正在估算…`;
    ctrl=new AbortController();
    try{const n=applyAi(await fn(ctrl.signal,i=>{state.innerHTML=`<span class="spin"></span> Claude 繁忙，第 ${i} 次重试…`}));state.textContent=n?okText:"没有识别出食物。"}
    catch(e){if(ctrl.signal.aborted)return;console.error(e);state.textContent=describeError(e);btn.textContent=retryText}
    finally{btn.disabled=false}
  };
  if($("#mAsk")) $("#mAsk").addEventListener("click",async()=>{
    const hint=$("#mHint").value.trim();
    if(mode==="text"&&!hint){$("#mAskState").textContent="先写下吃了什么。";return}
    if(!getKey()){$("#mAskState").textContent=describeError({code:"no_key"});return}
    const btn=$("#mAsk");
    await run(btn,$("#mAskState"),(signal,onRetry)=>estimateMeal({mode,hint,images:meal.blobs,signal,onRetry}),"估算完成。点灰色的假设可以纠正，克数和数字都能直接改。","重试");
    if(meal.items.length)btn.textContent="重新估算";
  });
  $("#mFixBtn").addEventListener("click",async()=>{
    const instruction=$("#mFix").value.trim();if(!instruction){$("#mFixState").textContent="先写哪里不对。";return}
    const prev=JSON.parse(JSON.stringify(meal.items));
    await run($("#mFixBtn"),$("#mFixState"),(signal,onRetry)=>fixMeal({items:meal.items.filter(i=>i.name).map(toAi),instruction,signal,onRetry}),"已按你说的修正。","重试");
    if(!meal.items.length){meal.items=prev;drawItems()}
    else $("#mFix").value="";
  });
  $("#mSave").addEventListener("click",async()=>{
    meal.items=meal.items.filter(i=>i.name||+i.kcal);
    if(!meal.items.length){toast("至少填一样食物");return}
    const items=meal.items.map(i=>{const o={name:i.name,amount:i.amount||"",kcal:r0(i.kcal),p:r0(i.p),c:r0(i.c),f:r0(i.f)};
      if(i.g!==""&&i.g!=null)o.g=+i.g||0;if(i.per){o.per=i.per;o.lo=+i.lo||o.g;o.hi=+i.hi||o.g}if(i.src)o.src=i.src;if(i.asm&&i.asm.length)o.asm=i.asm;return o});
    const t=sumItems(items);
    const rec={id:meal.id,type:meal.type,time:meal.time,items,kcal:r0(t.kcal),p:r0(t.p),c:r0(t.c),f:r0(t.f),thumb:meal.thumb||"",note:$("#mNote").value.trim()};
    if(meal.aiNote)rec.aiNote=meal.aiNote;
    if(meal.confidence)rec.confidence=meal.confidence;
    const doc=dayDoc(S.date),i=doc.meals.findIndex(x=>x.id===rec.id);
    if(i>=0)doc.meals[i]=rec;else doc.meals.push(rec);
    closeSheet();render();
    try{await saveDay(S.date);toast("已保存")}catch(e){}
  });
}

/* ---------- training ---------- */
function parseTarget(t){
  t=String(t||"").trim();
  if(!t||/不做|跳过/.test(t))return {sets:0,reps:"",lo:0,hi:0,ws:[]};
  const m=t.match(/(\d+)\s*[×xX*]\s*(\d+)(?:\s*[-–~]\s*(\d+))?/);
  const sets=m?+m[1]:1,lo=m?+m[2]:0,hi=m&&m[3]?+m[3]:lo,reps=m?(m[3]?m[2]+"–"+m[3]:m[2]):"";
  let ws=[];const at=t.split("@")[1];
  if(at){const nums=at.match(/\d+(\.\d+)?/g)||[];ws=at.includes(",")&&nums.length>=sets?nums.slice(0,sets):nums.length?[nums[0]]:[]}
  return {sets,reps,lo,hi,ws};
}
function fromPlan(dayIdx,week){
  const day=S.plan.days[dayIdx];
  return {dayKey:day.id||String(dayIdx),dayName:day.name,week,sleep:null,fatigue:null,note:"",
    exercises:day.exercises.map(ex=>{const target=(ex.w||[])[week-1]||"",p=parseTarget(target);
      const n=Math.max(p.sets,0);
      return {slot:ex.slot||"",name:ex.name,target,sets:Array.from({length:n},(_,i)=>({w:p.ws.length?(p.ws[i]??p.ws[0]):"",r:"",rir:"",pr:p.reps}))}})};
}
// Earlier sessions of one exercise, newest first, working sets only.
function sessions(name,before){
  const out=[];
  for(const d of Object.keys(S.days).filter(d=>d<before).sort().reverse()){const w=S.days[d].workout;if(!w)continue;
    const e=w.exercises.find(x=>x.name===name);if(e){const s=working(e);if(s.length)out.push({d,s,target:e.target||""})}}
  return out;
}
function lastPerf(name,before){return sessions(name,before)[0]||null}
const bestE1rm=(name,before)=>sessions(name,before).reduce((a,x)=>Math.max(a,...x.s.map(s=>e1rm(s.w,s.r))),0);
const BARBELL=/杠铃|barbell|深蹲|卧推|硬拉|推举|squat|bench|deadlift|rdl|ohp/i;
const roundW=(w,bar)=>{const g=gym(),step=bar&&g.plates.length?g.plates[g.plates.length-1]*2:2.5;return Math.round(w/step)*step};
function plateText(total){
  const g=gym();total=+total;if(!(total>0))return "";
  if(total<=g.bar)return total===g.bar?"空杆":"";
  let side=(total-g.bar)/2;const out=[];
  for(const p of g.plates)while(side>=p-1e-9){out.push(p);side-=p}
  return `${total} lb = 杆 ${g.bar} + 每边 ${out.join(" + ")||"—"}`+(side>0.01?`（还差 ${Math.round(side*20)/10} lb 配不出）`:"");
}
// Double progression: fill the rep range at a weight, then add load; two misses in a row take 10% off.
function suggest(e,before){
  const H=sessions(e.name,before).filter(x=>x.s.some(s=>+s.w>0));
  if(!H.length)return null;
  const last=H[0],lt=parseTarget(last.target||e.target);if(!lt.lo)return null;
  const top=Math.max(...last.s.map(s=>+s.w||0)),tops=last.s.filter(s=>(+s.w||0)===top);
  const bar=BARBELL.test(e.name),g=gym(),rir=tops[tops.length-1].rir;
  const missed=x=>{const t=Math.max(...x.s.map(s=>+s.w||0)),lo=parseTarget(x.target||e.target).lo;return t===top&&x.s.some(s=>(+s.w||0)===t&&+s.r<lo)};
  const range=lt.hi>lt.lo?`${lt.lo}–${lt.hi}`:`${lt.hi}`;
  if(tops.length>=Math.min(lt.sets,last.s.length)&&tops.every(s=>+s.r>=lt.hi)){
    if(rir!==""&&rir!=null&&+rir<=0)return {w:top,why:`上次 ${top} lb 都做满了 ${lt.hi} 次，但末组已经力竭（RIR 0），先保持`};
    return {w:roundW(top+g.incr,bar),why:`上次 ${tops.length} 组 ${top} lb 都做满 ${lt.hi} 次${rir!==""&&rir!=null?`，末组还剩 ${rir} 次`:""}，加 ${g.incr} lb`};
  }
  if(missed(last)&&H[1]&&missed(H[1]))return {w:roundW(top*0.9,bar),why:`连续两次在 ${top} lb 没做到 ${lt.lo} 次，减 10% 重新往上加`};
  if(missed(last))return {w:top,why:`上次有组没做到 ${lt.lo} 次，保持 ${top} lb 再试一次`};
  return {w:top,why:`还没有每组都做满 ${range} 次的上限，保持 ${top} lb，争取每组多做 1 次`};
}
function inferWeek(){
  // continue the week of the most recent logged session, advancing once every plan day was done
  const ds=Object.keys(S.days).filter(d=>d<S.date&&S.days[d].workout).sort().reverse();
  if(!ds.length||!S.plan)return 1;
  const w=S.days[ds[0]].workout,wk=w.week||1;
  const doneThisWeek=new Set(ds.map(d=>S.days[d].workout).filter(x=>x.week===wk).map(x=>x.dayKey));
  return doneThisWeek.size>=S.plan.days.length?Math.min(wk+1,S.plan.weeks||4):wk;
}

/* rest timer + keep the screen on while logging */
const restMap=()=>{try{return JSON.parse(localStorage.getItem("fitlog:rest")||"{}")}catch(e){return {}}};
const restFor=n=>+restMap()[n]||gym().rest;
function setRestFor(n,sec){const m=restMap();m[n]=sec;try{localStorage.setItem("fitlog:rest",JSON.stringify(m))}catch(e){}}
const R={end:0,name:"",t:null,done:false};
let audio=null;
function beep(){
  try{audio=audio||new (window.AudioContext||window.webkitAudioContext)();
    [0,0.35].forEach(at=>{const o=audio.createOscillator(),g=audio.createGain();o.frequency.value=880;o.connect(g);g.connect(audio.destination);
      g.gain.setValueAtTime(0.25,audio.currentTime+at);g.gain.exponentialRampToValueAtTime(0.001,audio.currentTime+at+0.25);o.start(audio.currentTime+at);o.stop(audio.currentTime+at+0.26)})}catch(e){}
}
function tick(){
  const left=Math.max(0,Math.round((R.end-Date.now())/1000));
  $("#restLeft").textContent=Math.floor(left/60)+":"+pad(left%60);
  $("#restName").textContent=left?"休息 · "+R.name:"该做下一组了";
  if(!left&&!R.done){R.done=true;$("#restBar").classList.add("done");beep();try{navigator.vibrate&&navigator.vibrate([300,120,300])}catch(e){}setTimeout(()=>{if(R.done)stopRest()},10000)}
}
function startRest(name){
  try{audio=audio||new (window.AudioContext||window.webkitAudioContext)();audio.resume()}catch(e){}
  R.end=Date.now()+restFor(name)*1000;R.name=name;R.done=false;
  $("#restBar").hidden=false;$("#restBar").classList.remove("done");clearInterval(R.t);R.t=setInterval(tick,250);tick();
}
function stopRest(){clearInterval(R.t);R.done=false;$("#restBar").hidden=true}
$("#restMinus").addEventListener("click",()=>{R.end=Math.max(Date.now(),R.end-15000);tick()});
$("#restPlus").addEventListener("click",()=>{if(R.done){R.done=false;$("#restBar").classList.remove("done");R.end=Date.now()}R.end+=15000;tick()});
$("#restSkip").addEventListener("click",stopRest);
let lock=null;
async function wakeLock(){
  const want=S.tab==="train"&&!!S.wDraft&&document.visibilityState==="visible";
  try{
    if(want&&!lock&&navigator.wakeLock){lock=await navigator.wakeLock.request("screen");lock.addEventListener("release",()=>{lock=null})}
    else if(!want&&lock){const l=lock;lock=null;await l.release()}
  }catch(e){}
}
document.addEventListener("visibilitychange",wakeLock);

const prToasted=new Set();
function renderTrain(){
  const doc=dayDoc(S.date);
  if(!S.wDraft) S.wDraft=doc.workout?JSON.parse(JSON.stringify(doc.workout)):null;
  const W=S.wDraft;
  $("#planName").textContent=S.plan?"计划："+(S.plan.title||"未命名"):"还没有训练计划。可以直接加动作记录，或到「计划」先写好 block。";
  const chips=$("#dayChips");
  chips.innerHTML=(S.plan?S.plan.days.map((d,i)=>`<button class="chip" data-d="${i}" aria-pressed="${W&&W.dayKey===(d.id||String(i))}">${esc(d.name)}</button>`).join(""):"")
    +`<button class="chip" data-d="free" aria-pressed="${W&&W.dayKey==="free"}">自由训练</button>`;
  const week=W&&W.week?W.week:inferWeek();
  const nW=S.plan?S.plan.weeks||4:0;
  $("#weekChips").innerHTML=Array.from({length:nW},(_,i)=>`<button class="chip" data-w="${i+1}" aria-pressed="${week===i+1}">${i+1}</button>`).join("")||`<span class="muted">—</span>`;
  chips.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{
    const hasData=W&&W.exercises.some(e=>e.sets.some(s=>s.r!==""));
    const go=()=>{S.wDraft=b.dataset.d==="free"?{dayKey:"free",dayName:"自由训练",week:null,sleep:W&&W.sleep||null,fatigue:W&&W.fatigue||null,note:W&&W.note||"",exercises:[]}:fromPlan(+b.dataset.d,week);renderTrain()};
    if(hasData&&!b.dataset.armed){b.dataset.armed="1";toast("已填的组会被替换，再点一次确认");setTimeout(()=>delete b.dataset.armed,3000);return}
    go();
  }));
  $("#weekChips").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{
    const wk=+b.dataset.w;
    if(W&&W.dayKey!=="free"&&S.plan){const di=S.plan.days.findIndex((d,i)=>(d.id||String(i))===W.dayKey);
      if(di>=0&&!W.exercises.some(e=>e.sets.some(s=>s.r!==""))){S.wDraft=fromPlan(di,wk)}else{W.week=wk;W.exercises.forEach(e=>{const pe=S.plan.days[di]&&S.plan.days[di].exercises.find(x=>x.name===e.name);if(pe)e.target=(pe.w||[])[wk-1]||e.target})}}
    else if(W)W.week=wk;
    if(!W){S.wDraft={dayKey:"free",dayName:"自由训练",week:wk,exercises:[],note:""}}
    renderTrain();
  }));
  const list=$("#exList");
  if(!W){list.innerHTML=`<div class="empty">选上面一个训练日，按计划预填今天的动作、组数和目标重量；做完每组填实际重量、次数和 RIR（还能再做几次），休息计时会自动开始。</div>`;$("#addEx").hidden=true}
  else{
    $("#addEx").hidden=false;
    const topW=e=>Math.max(0,...e.sets.filter(s=>!s.warm).map(s=>+s.w||0));
    list.innerHTML=W.exercises.length?W.exercises.map((e,ei)=>{
      const lp=lastPerf(e.name,S.date),sg=e.name?suggest(e,S.date):null,best=bestE1rm(e.name,S.date),bar=BARBELL.test(e.name);
      const planW=parseTarget(e.target).ws[0];
      let n=0;
      return `<div class="ex" data-ei="${ei}">
        <div class="ex-h"><span class="slot">${esc(e.slot)}</span><span class="ex-name"><input data-f="name" value="${esc(e.name)}" aria-label="动作名称"></span><button class="x" data-rmex="${ei}" aria-label="删除这个动作">×</button></div>
        ${e.target?`<div class="target">计划：${esc(e.target)}</div>`:""}
        ${lp?`<div class="last">上次 ${fmtDate(lp.d)}：<b class="mono">${lp.s.map(s=>(s.w?s.w+"×":"")+s.r).join(" · ")}</b>${lp.s.some(s=>s.rir!==""&&s.rir!=null)?" · 末组 RIR "+esc(lp.s.filter(s=>s.rir!==""&&s.rir!=null).slice(-1)[0].rir):""}${best?` · 估算 1RM ${r0(best)}`:""}</div>`:""}
        ${sg?`<div class="sugg"><span>建议 <b>${sg.w} lb</b>：${esc(sg.why)}${planW&&+planW!==sg.w?`（计划写的是 ${esc(planW)}）`:""}</span>${e.sets.some(s=>!s.warm&&+s.w!==sg.w&&s.r==="")?`<button class="btn small" data-use="${ei}">用这个重量</button>`:""}</div>`:""}
        ${bar&&topW(e)?`<div class="plates" data-plates>${esc(plateText(topW(e)))}</div>`:""}
        <div class="sets"><span class="hd"></span><span class="hd">重量 lb</span><span class="hd">次数</span><span class="hd">RIR</span><span></span>
        ${e.sets.map((s,si)=>{const isPr=!s.warm&&best>0&&e1rm(s.w,s.r)>best+0.01;if(!s.warm)n++;
          return `<span class="i${s.warm?" warm":isPr?" pr":""}" data-idx="${si}" data-n="${s.warm?"热":n}">${s.warm?"热":isPr?"PR":n}</span>
          <input data-s="${si}" data-k="w" inputmode="decimal" value="${esc(s.w)}" aria-label="第${si+1}组重量" placeholder="自重">
          <input data-s="${si}" data-k="r" inputmode="numeric" value="${esc(s.r)}" aria-label="第${si+1}组次数" placeholder="${esc(s.pr||"")}">
          <input data-s="${si}" data-k="rir" inputmode="numeric" value="${esc(s.rir)}" aria-label="第${si+1}组RIR" placeholder="-">
          <button class="x" data-rms="${si}" aria-label="删除这一组">×</button>`}).join("")}
        </div>
        <div class="ex-tools"><button class="btn ghost small" data-adds="${ei}">＋ 一组</button>
          ${!e.sets.some(s=>s.warm)&&topW(e)>=40?`<button class="btn ghost small" data-warm="${ei}">＋ 热身组</button>`:""}
          <span>休息 <input data-rest type="number" inputmode="numeric" value="${restFor(e.name)}" aria-label="组间休息秒数"> 秒</span></div>
      </div>`}).join(""):`<div class="empty">还没有动作，点下面加一个。</div>`;
    list.querySelectorAll(".ex").forEach(box=>{
      const ei=+box.dataset.ei,e=W.exercises[ei];
      box.querySelector('[data-f="name"]').addEventListener("input",ev=>{e.name=ev.target.value});
      box.querySelector('[data-f="name"]').addEventListener("change",()=>renderTrain());
      box.querySelectorAll("[data-s]").forEach(inp=>{
        inp.addEventListener("input",()=>{
          const si=+inp.dataset.s,s=e.sets[si];s[inp.dataset.k]=inp.value.trim();
          // live PR mark and plate math while typing
          const best=bestE1rm(e.name,S.date),idx=box.querySelector(`[data-idx="${si}"]`),isPr=!s.warm&&best>0&&e1rm(s.w,s.r)>best+0.01;
          idx.textContent=isPr?"PR":idx.dataset.n;idx.classList.toggle("pr",isPr);
          if(isPr&&!prToasted.has(e.name+si)){prToasted.add(e.name+si);toast(`新纪录！${e.name} 估算 1RM ${r0(e1rm(s.w,s.r))} lb（之前 ${r0(best)}）`)}
          const pl=box.querySelector("[data-plates]");if(pl&&inp.dataset.k==="w")pl.textContent=plateText(topW(e));
        });
        if(inp.dataset.k==="r")inp.addEventListener("change",()=>{const s=e.sets[+inp.dataset.s];if(s.r!==""&&!s.warm)startRest(e.name||"这一组")});
      });
      box.querySelectorAll("[data-rms]").forEach(b=>b.addEventListener("click",()=>{e.sets.splice(+b.dataset.rms,1);renderTrain()}));
      box.querySelector("[data-adds]").addEventListener("click",()=>{const l=e.sets.filter(s=>!s.warm).slice(-1)[0];e.sets.push({w:l?l.w:"",r:"",rir:"",pr:l?l.pr:""});renderTrain()});
      const use=box.querySelector("[data-use]");if(use)use.addEventListener("click",()=>{const sg=suggest(e,S.date);if(sg)e.sets.forEach(s=>{if(!s.warm&&s.r==="")s.w=String(sg.w)});renderTrain()});
      const wu=box.querySelector("[data-warm]");if(wu)wu.addEventListener("click",()=>{
        const top=topW(e),bar=BARBELL.test(e.name),g=gym();
        const ws=[[0.5,8],[0.7,5],[0.85,2]].map(([k,r])=>({w:String(Math.max(bar?g.bar:0,roundW(top*k,bar))),r:"",rir:"",pr:String(r),warm:true}))
          .filter((s,i,a)=>+s.w<top&&(i===0||s.w!==a[i-1].w));
        if(!ws.length){toast("重量太轻，不需要热身组");return}
        e.sets.unshift(...ws);renderTrain();
      });
      box.querySelector("[data-rest]").addEventListener("change",ev=>{const v=Math.max(10,Math.min(900,+ev.target.value||0));setRestFor(e.name,v);ev.target.value=v;toast(`${e.name||"这个动作"}的休息改成 ${v} 秒`)});
      box.querySelector("[data-rmex]").addEventListener("click",ev=>confirmInline(ev.currentTarget,"删?",()=>{W.exercises.splice(ei,1);renderTrain()}));
    });
  }
  const scale=(el,key)=>{el.innerHTML=[1,2,3,4,5].map(n=>`<button data-n="${n}" aria-pressed="${W&&W[key]===n}">${n}</button>`).join("");
    el.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{if(!S.wDraft)S.wDraft={dayKey:"free",dayName:"自由训练",week:null,exercises:[],note:""};S.wDraft[key]=+b.dataset.n;renderTrain()}))};
  scale($("#sleepScale"),"sleep");scale($("#fatigueScale"),"fatigue");
  $("#wNote").value=W?W.note||"":"";
  $("#trainSaved").textContent=doc.workout?"已保存":"";
  $("#clearWorkout").hidden=!doc.workout;
  renderHistory();
  wakeLock();
}
$("#wNote").addEventListener("input",e=>{if(!S.wDraft)S.wDraft={dayKey:"free",dayName:"自由训练",week:null,exercises:[],note:""};S.wDraft.note=e.target.value});
$("#addEx").addEventListener("click",()=>{if(!S.wDraft)return;S.wDraft.exercises.push({slot:"",name:"",target:"",sets:[{w:"",r:"",rir:"",pr:""}]});renderTrain();const ins=$("#exList").querySelectorAll('[data-f="name"]');if(ins.length)ins[ins.length-1].focus()});
$("#saveWorkout").addEventListener("click",async()=>{
  const W=S.wDraft;if(!W){toast("先选一个训练日");return}
  W.exercises=W.exercises.filter(e=>e.name.trim());
  const doc=dayDoc(S.date);doc.workout=JSON.parse(JSON.stringify(W));
  renderTrain();
  try{await saveDay(S.date);toast("训练已保存")}catch(e){}
});
$("#clearWorkout").addEventListener("click",e=>confirmInline(e.currentTarget,"确认删除",async()=>{const doc=dayDoc(S.date);doc.workout=null;S.wDraft=null;renderTrain();await saveDay(S.date);toast("已删除")}));
$("#moveWorkout").addEventListener("click",async()=>{
  const to=$("#moveDate").value,from=S.date,W=S.wDraft||dayDoc(from).workout;
  if(!to||to===from){toast("先选要移到哪一天");return}
  if(!W||!W.exercises.length){toast("这天没有训练可以移");return}
  if(dayDoc(to).workout){toast(`${fmtDate(to)} 已经有训练了，先删掉那天的再移`);return}
  dayDoc(to).workout=JSON.parse(JSON.stringify(W));dayDoc(from).workout=null;S.wDraft=null;
  try{await saveDay(to);await saveDay(from)}catch(e){return}
  S.date=to;render();toast(`已移到 ${fmtDate(to)}`);
});
function renderHistory(){
  const ds=Object.keys(S.days).filter(d=>S.days[d].workout).sort().reverse().slice(0,10);
  $("#trainHistory").innerHTML=ds.length?ds.map(d=>{const w=S.days[d].workout;return `<div class="hist-item"><span><b>${fmtDate(d)}</b> ${esc(w.dayName||"")}${w.week?` <span class="muted">· 第 ${w.week} 周</span>`:""}</span><button class="btn ghost small" data-day="${d}">查看</button></div>`}).join("")
    :`<div class="empty">保存第一次训练后，这里会列出最近的记录；同一个动作下次会显示「上次」的重量和次数，并按上次表现建议这次的重量。</div>`;
  $("#trainHistory").querySelectorAll("[data-day]").forEach(b=>b.addEventListener("click",()=>{S.date=b.dataset.day;S.wDraft=null;render();window.scrollTo(0,0)}));
}

/* ---------- plan editor ---------- */
let planDraft=null;
function renderPlan(){
  if(!planDraft) planDraft=S.plan?JSON.parse(JSON.stringify(S.plan)):{title:"",weeks:4,days:[]};
  const P=planDraft,nW=P.weeks||4;
  $("#planTitle").value=P.title||"";
  const box=$("#planDays");
  box.innerHTML=P.days.length?P.days.map((d,di)=>`<div class="card plan-day" data-di="${di}">
    <div class="row between"><input data-dn value="${esc(d.name)}" aria-label="训练日名称" style="font-weight:700;flex:1"><button class="btn ghost small" data-rmday>删除这天</button></div>
    ${d.warmup!==undefined?`<label class="f">热身<textarea data-wu rows="2">${esc(d.warmup)}</textarea></label>`:""}
    <div class="tbl-wrap"><table class="plan-tbl"><thead><tr><th>槽位</th><th>动作</th>${Array.from({length:nW},(_,i)=>`<th>第 ${i+1} 周</th>`).join("")}<th></th></tr></thead>
    <tbody>${d.exercises.map((e,ei)=>`<tr data-ei="${ei}"><td class="slotc"><input data-k="slot" value="${esc(e.slot)}" aria-label="槽位"></td><td class="namec"><input data-k="name" value="${esc(e.name)}" aria-label="动作"></td>
      ${Array.from({length:nW},(_,wi)=>`<td><input data-wk="${wi}" value="${esc((e.w||[])[wi]||"")}" aria-label="第${wi+1}周"></td>`).join("")}
      <td><button class="x" data-rmrow aria-label="删除">×</button></td></tr>`).join("")}</tbody></table></div>
    <div><button class="btn ghost small" data-addrow>＋ 加一行</button></div></div>`).join("")
    :`<div class="empty">还没有计划。点「加一个训练日」开始写，或者让 Claude 在对话里帮你把下个 block 填进来。</div>`;
  box.querySelectorAll(".plan-day").forEach(card=>{
    const d=P.days[+card.dataset.di];
    card.querySelector("[data-dn]").addEventListener("input",e=>{d.name=e.target.value});
    const wu=card.querySelector("[data-wu]");if(wu)wu.addEventListener("input",e=>{d.warmup=e.target.value});
    card.querySelectorAll("tbody tr").forEach(tr=>{const e=d.exercises[+tr.dataset.ei];
      tr.querySelectorAll("[data-k]").forEach(i=>i.addEventListener("input",()=>{e[i.dataset.k]=i.value}));
      tr.querySelectorAll("[data-wk]").forEach(i=>i.addEventListener("input",()=>{e.w=e.w||[];e.w[+i.dataset.wk]=i.value}));
      tr.querySelector("[data-rmrow]").addEventListener("click",()=>{d.exercises.splice(+tr.dataset.ei,1);renderPlan()});
    });
    card.querySelector("[data-addrow]").addEventListener("click",()=>{d.exercises.push({slot:"",name:"",w:[]});renderPlan()});
    card.querySelector("[data-rmday]").addEventListener("click",ev=>confirmInline(ev.currentTarget,"确认删除",()=>{P.days.splice(+card.dataset.di,1);renderPlan()}));
  });
}
$("#planTitle").addEventListener("input",e=>{if(planDraft)planDraft.title=e.target.value});
$("#addPlanDay").addEventListener("click",()=>{planDraft.days.push({id:uid(),name:"Day "+(planDraft.days.length+1),warmup:"",exercises:[{slot:"A1",name:"",w:[]}]});renderPlan()});
$("#savePlan").addEventListener("click",async()=>{
  const P=planDraft;P.days.forEach(d=>{if(!d.id)d.id=uid();d.exercises=d.exercises.filter(e=>e.name.trim())});
  S.plan=JSON.parse(JSON.stringify(P));renderPlan();
  try{await store.set("plan",S.plan);toast("计划已保存")}catch(e){toast("保存失败，请稍后再试")}
});

/* ---------- progress: weight, adaptive target, photos, strength, coach ---------- */
const DAY=864e5;
const weights=()=>Object.keys(S.days).filter(d=>S.days[d].weight!=null).sort().map(d=>({d,w:+S.days[d].weight}));
const md=s=>{const d=parseYmd(s);return (d.getMonth()+1)+"/"+d.getDate()};
// Small SVG line chart. series: [{pts:[{x:"YYYY-MM-DD",y,label}],color,line,dots}]
function chart(series,goal,fmt){
  const all=series.flatMap(s=>s.pts);if(!all.length)return "";
  const xs=all.map(p=>parseYmd(p.x).getTime()),ys=all.map(p=>p.y).concat(goal!=null?[goal]:[]);
  let x0=Math.min(...xs),x1=Math.max(...xs);if(x1===x0){x0-=DAY;x1+=DAY}
  const lo=Math.min(...ys),hi=Math.max(...ys),py=(hi-lo)*0.12||1,y0=lo-py,y1=hi+py;
  const W=360,H=170,L=38,B=18,T=14,Rt=6;
  const X=s=>L+(parseYmd(s).getTime()-x0)/(x1-x0)*(W-L-Rt),Y=y=>T+(1-(y-y0)/(y1-y0))*(H-T-B);
  let g=[lo,hi].map(v=>`<line x1="${L}" x2="${W-Rt}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${L-5}" y="${Y(v)+3}" text-anchor="end">${fmt(v)}</text>`).join("");
  if(goal!=null)g+=`<line x1="${L}" x2="${W-Rt}" y1="${Y(goal)}" y2="${Y(goal)}" stroke="var(--ink)" stroke-opacity=".5" stroke-dasharray="6 5"/><text x="${W-Rt}" y="${Y(goal)-4}" text-anchor="end">目标 ${fmt(goal)}</text>`;
  const first=all.reduce((a,p)=>p.x<a?p.x:a,all[0].x),last=all.reduce((a,p)=>p.x>a?p.x:a,all[0].x);
  g+=`<text x="${L}" y="${H-4}">${md(first)}</text><text x="${W-Rt}" y="${H-4}" text-anchor="end">${md(last)}</text>`;
  series.forEach(s=>{
    if(s.line&&s.pts.length>1)g+=`<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" points="${s.pts.map(p=>X(p.x).toFixed(1)+","+Y(p.y).toFixed(1)).join(" ")}"/>`;
    if(s.dots)g+=s.pts.map(p=>`<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${s.r||3}" fill="${s.color}"><title>${esc(p.label||"")}</title></circle>`).join("");
  });
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="趋势图">${g}</svg></div>`;
}
const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
function renderProg(){
  const doc=dayDoc(S.date),s=S.settings||{};
  $("#wtDateLbl").textContent=S.date===ymd(new Date())?"今天":fmtDate(S.date);
  $("#wtInput").value=doc.weight??"";$("#goalWtInput").value=s.goalWeight??"";
  const ws=weights().filter(x=>x.d>=addDays(ymd(new Date()),-120));
  const ma=ws.map(x=>({x:x.d,y:avg(ws.filter(o=>o.d>addDays(x.d,-7)&&o.d<=x.d).map(o=>o.w))}));
  $("#wtChart").innerHTML=ws.length?chart([{pts:ws.map(x=>({x:x.d,y:x.w,label:`${x.d}：${x.w} kg`})),color:"var(--muted)",dots:true},{pts:ma,color:"var(--kcal)",line:true}],s.goalWeight?+s.goalWeight:null,v=>v.toFixed(1))
    :`<div class="empty">记下第一次体重后，这里会画出每天的体重和 7 天平均线。</div>`;
  const today=ymd(new Date()),a7=ws.filter(x=>x.d>addDays(today,-7)).map(x=>x.w),b7=ws.filter(x=>x.d>addDays(today,-14)&&x.d<=addDays(today,-7)).map(x=>x.w);
  let sum="";
  if(a7.length){sum=`最近 7 天平均 ${avg(a7).toFixed(1)} kg`;if(b7.length){const dd=avg(a7)-avg(b7);sum+=`，比前 7 天${dd>=0?"多":"少"} ${Math.abs(dd).toFixed(1)} kg`}
    if(s.goalWeight)sum+=`，离目标还差 ${Math.abs(avg(a7)-s.goalWeight).toFixed(1)} kg`;sum+="。每天的数字会因为水分和饮食上下波动，看平均线就好。"}
  $("#wtSummary").textContent=sum;
  renderAdapt();renderPhotos();renderE1rm();renderCoach();
}
$("#saveWt").addEventListener("click",async()=>{
  const v=$("#wtInput").value.trim(),g=$("#goalWtInput").value.trim(),doc=dayDoc(S.date);
  if(v&&!(+v>20&&+v<400)){toast("体重看起来不对，单位是 kg");return}
  doc.weight=v?Math.round(+v*10)/10:null;
  const gw=g?Math.round(+g*10)/10:null;
  try{
    await saveDay(S.date);
    if((S.settings||{}).goalWeight!==gw){S.settings={...(S.settings||{}),goalWeight:gw};await store.set("settings",S.settings)}
    toast("已保存");renderProg();
  }catch(e){}
});

// Adaptive target: average intake minus the energy in the weight trend (7700 kcal per kg) estimates real expenditure.
function adaptive(){
  const end=ymd(new Date()),start=addDays(end,-27),s=S.settings||{};
  const ws=weights().filter(x=>x.d>=start&&x.d<=end);
  const ds=Object.keys(S.days).filter(d=>d>=start&&d<=end&&S.days[d].meals.length);
  const span=ws.length?(parseYmd(ws[ws.length-1].d)-parseYmd(ws[0].d))/DAY:0;
  if(ws.length<8||ds.length<10||span<14)return {need:`需要最近 4 周里至少 8 次体重（前后跨 2 周以上）和 10 天完整的饮食记录。现在有 ${ws.length} 次体重、${ds.length} 天饮食。`};
  const xs=ws.map(x=>(parseYmd(x.d)-parseYmd(start))/DAY),mx=avg(xs),my=avg(ws.map(x=>x.w));
  const slope=xs.reduce((a,x,i)=>a+(x-mx)*(ws[i].w-my),0)/xs.reduce((a,x)=>a+(x-mx)**2,0);
  const avgK=avg(ds.map(d=>sumMeals(S.days[d].meals).kcal));
  const tdee=avgK-slope*7700;
  const goal=s.goal||"recomp",want=Math.round(tdee*{cut:0.82,recomp:1,gain:1.1}[goal]/10)*10;
  return {avgK,wk:slope*7,tdee,want,nd:ds.length,nw:ws.length,goal};
}
function renderAdapt(){
  const a=adaptive(),T=targets(),box=$("#adaptBox");
  if(a.need){box.innerHTML=`<div class="muted">${esc(a.need)} 有了这些数据，我会用你实际吃的和体重变化，推算出真实的每日消耗，再建议热量目标。</div>`;return}
  const goalName={cut:"减脂",recomp:"维持体重",gain:"增肌"}[a.goal];
  // move at most 250 kcal per adjustment so one noisy month can't swing the target
  const next=T?Math.round(Math.max(T.kcal-250,Math.min(T.kcal+250,a.want))/10)*10:a.want;
  box.innerHTML=`<div>最近 4 周你记录了 ${a.nd} 天饮食，平均每天 <b>${r0(a.avgK)}</b> 千卡；体重趋势每周 <b>${a.wk>=0?"+":""}${a.wk.toFixed(2)} kg</b>。推算你实际每天消耗约 <b>${r0(a.tdee)}</b> 千卡。</div>
    <div>按「${goalName}」，建议每日热量 <b>${next}</b> 千卡${T?`（现在 ${r0(T.kcal)}）`:""}${next!==a.want?`。完全按推算是 ${a.want}，一次最多调 250 千卡`:""}。前提是吃的都记了，漏记会让推算偏低。</div>
    ${T&&Math.abs(next-T.kcal)>=50?`<div class="row"><button class="btn primary small" id="applyAdapt">改成 ${next} 千卡</button><span class="muted">蛋白质和脂肪不变，碳水跟着调整。</span></div>`:T?`<div class="muted">和现在的目标差不多，不用改。</div>`:`<div class="muted">先在「设置」保存一次每日目标，才能一键调整。</div>`}`;
  const b=$("#applyAdapt");if(b)b.addEventListener("click",async()=>{
    const nt={...T,kcal:next,c:Math.max(0,Math.round((next-T.p*4-T.f*9)/4))};
    S.settings={...S.settings,targets:nt};
    try{await store.set("settings",S.settings);toast(`热量目标改成 ${next} 千卡`);renderAdapt()}catch(e){toast("保存失败，请再试一次")}
  });
}

// Progress photos live in the day doc; they never leave the device.
function allPhotos(){return Object.keys(S.days).sort().flatMap(d=>(S.days[d].photos||[]).map(p=>({...p,d})))}
let cmp={a:null,b:null};
function renderPhotos(){
  const ps=allPhotos();
  $("#progPhotos").innerHTML=ps.length?`<div class="pgrid">${[...ps].reverse().map(p=>`<figure><img src="${p.img}" alt="${p.d} 的进度照片" data-pick="${p.id}"><figcaption class="row between"><span>${md(p.d)}</span><button class="x" data-rmp="${p.id}" data-d="${p.d}" aria-label="删除这张照片">×</button></figcaption></figure>`).join("")}</div>`
    :`<div class="empty">用同样的光线、角度和姿势定期拍一张，体重变化不明显时，照片最能看出变化。照片只存在这台设备上，不会发给 Claude。</div>`;
  bindPhotoDelete();
  if(ps.length<2){$("#compareBox").innerHTML="";return}
  if(!ps.some(p=>p.id===cmp.a))cmp.a=ps[0].id;
  if(!ps.some(p=>p.id===cmp.b)||cmp.b===cmp.a)cmp.b=ps[ps.length-1].id===cmp.a?ps[0].id:ps[ps.length-1].id;
  const A=ps.find(p=>p.id===cmp.a),B=ps.find(p=>p.id===cmp.b);
  $("#compareBox").innerHTML=`<div class="small muted">前后对比：拖动滑块。点上面的照片可以换成「之后」那张。</div>
    <div class="cmp"><img src="${A.img}" alt="之前"><img src="${B.img}" alt="之后" id="cmpTop" style="clip-path:inset(0 0 0 50%)">
      <span class="lbl" style="left:6px">${md(A.d)}</span><span class="lbl" style="right:6px">${md(B.d)}</span>
      <input type="range" min="0" max="100" value="50" id="cmpRange" aria-label="对比滑块"></div>`;
  $("#cmpRange").addEventListener("input",e=>{$("#cmpTop").style.clipPath=`inset(0 0 0 ${e.target.value}%)`});
  $("#progPhotos").querySelectorAll("[data-pick]").forEach(i=>i.addEventListener("click",()=>{if(i.dataset.pick===cmp.a){cmp.a=cmp.b}cmp.b=i.dataset.pick;renderPhotos()}));
}
function bindPhotoDelete(){
  $("#progPhotos").querySelectorAll("[data-rmp]").forEach(b=>b.addEventListener("click",()=>confirmInline(b,"删",async()=>{
    const doc=dayDoc(b.dataset.d);doc.photos=(doc.photos||[]).filter(p=>p.id!==b.dataset.rmp);
    try{await saveDay(b.dataset.d);toast("已删除")}catch(e){}renderPhotos();
  })));
}
$("#photoProg").addEventListener("change",async e=>{
  const files=[...(e.target.files||[])];e.target.value="";if(!files.length)return;
  const doc=dayDoc(S.date);doc.photos=doc.photos||[];
  try{for(const f of files){const img=await loadImage(f);doc.photos.push({id:uid(),img:shrink(img,900,0.75,false)})}
    await saveDay(S.date);toast(`已加到 ${fmtDate(S.date)}`);renderPhotos()}
  catch(err){toast(err.message||"照片保存失败")}
});

// Strength: best estimated 1RM per session (Epley), working sets only.
function exerciseNames(){
  const n=new Map();
  Object.values(S.days).forEach(d=>d.workout&&d.workout.exercises.forEach(e=>{if(working(e).some(s=>+s.w>0))n.set(e.name,(n.get(e.name)||0)+1)}));
  return [...n.entries()].sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
}
let e1Ex="";
function renderE1rm(){
  const names=exerciseNames(),sel=$("#e1rmEx");
  if(!names.includes(e1Ex))e1Ex=names[0]||"";
  sel.innerHTML=names.map(n=>`<option ${n===e1Ex?"selected":""}>${esc(n)}</option>`).join("");sel.hidden=!names.length;
  if(!e1Ex){$("#e1rmChart").innerHTML=`<div class="empty">记录过带重量的动作后，这里会画出每个动作的估算 1RM（按重量和次数推算的最大重量），看力量有没有在涨。</div>`;$("#e1rmSummary").textContent="";return}
  const pts=Object.keys(S.days).sort().flatMap(d=>{const w=S.days[d].workout,e=w&&w.exercises.find(x=>x.name===e1Ex);if(!e)return [];
    const best=working(e).reduce((a,s)=>{const v=e1rm(s.w,s.r);return v>a.v?{v,s}:a},{v:0});return best.v?[{x:d,y:best.v,label:`${d}：${best.s.w}×${best.s.r} ≈ ${r0(best.v)} lb`,s:best.s}]:[]});
  $("#e1rmChart").innerHTML=chart([{pts,color:"var(--pro)",line:true,dots:true}],null,v=>r0(v));
  const top=pts.reduce((a,p)=>p.y>a.y?p:a,pts[0]);
  $("#e1rmSummary").textContent=`最好的一组：${fmtDate(top.x)} ${top.s.w} lb × ${top.s.r}，估算 1RM ${r0(top.y)} lb。`+(pts.length>1?` 从第一次到最近一次${pts[pts.length-1].y>=pts[0].y?"涨了":"降了"} ${r0(Math.abs(pts[pts.length-1].y-pts[0].y))} lb。`:"");
}
$("#e1rmEx").addEventListener("change",e=>{e1Ex=e.target.value;renderE1rm()});

/* AI coach: suggestions only change targets or the plan after the user taps 采纳 */
let coachWeeks=4,coachCtrl=null;
function digest(weeks){
  const end=ymd(new Date()),start=addDays(end,-7*weeks+1),s=S.settings||{},T=targets();
  const L=[`今天是 ${end}。`,
    `学员：${s.sex==="m"?"男":"女"}，${s.age||"?"} 岁，身高 ${s.height||"?"} cm，目标：${{cut:"减脂",recomp:"维持体重、增力量",gain:"增肌"}[s.goal||"recomp"]}${s.goalWeight?`，目标体重 ${s.goalWeight} kg`:""}。`,
    `每日目标：${T?`${T.kcal} 千卡，蛋白质 ${T.p} g，碳水 ${T.c} g，脂肪 ${T.f} g`:"还没设置"}。`];
  if(S.plan){L.push(`当前训练计划「${S.plan.title||"未命名"}」，共 ${S.plan.weeks||4} 周，每格是「组×次 @重量」，按第 1 周到第 ${S.plan.weeks||4} 周排列：`);
    S.plan.days.forEach(d=>{L.push(`- 训练日「${d.name}」`);d.exercises.forEach(e=>L.push(`  - 「${e.name}」：${(e.w||[]).map(x=>x||"—").join(" | ")}`))})}
  L.push(`\n最近 ${weeks} 周的每日记录（饮食是 千卡/蛋白质/碳水/脂肪；训练每组是 重量×次数，括号里是 RIR；没有记录的天不列出）：`);
  for(let d=start;d<=end;d=addDays(d,1)){const doc=S.days[d];if(!doc)continue;const parts=[];
    if(doc.meals.length){const t=sumMeals(doc.meals);parts.push(`饮食 ${r0(t.kcal)}/${r0(t.p)}/${r0(t.c)}/${r0(t.f)}（${doc.meals.length} 餐）`)}
    if(doc.weight!=null)parts.push(`体重 ${doc.weight} kg`);
    const w=doc.workout;
    if(w)parts.push(`训练「${w.dayName||"自由训练"}」${w.week?`第 ${w.week} 周`:""}：`+w.exercises.map(e=>`${e.name} ${working(e).map(s=>(s.w?s.w+"×":"")+s.r+(s.rir!==""&&s.rir!=null?`(${s.rir})`:"")).join(", ")||"没做"}`).join("；")
      +(w.sleep?`；睡眠 ${w.sleep}/5`:"")+(w.fatigue?`；疲劳 ${w.fatigue}/5`:"")+(w.note?`；备注：${w.note}`:""));
    if(parts.length)L.push(`${d} 周${WD[parseYmd(d).getDay()]} | `+parts.join(" | "));
  }
  return L.join("\n");
}
function findPlanCell(sg){
  if(!S.plan||!sg.day||!sg.exercise||!sg.week)return null;
  const norm=x=>String(x||"").replace(/\s/g,"");
  const day=S.plan.days.find(d=>norm(d.name)===norm(sg.day))||S.plan.days.find(d=>norm(d.name).includes(norm(sg.day))||norm(sg.day).includes(norm(d.name)));
  const ex=day&&day.exercises.find(e=>norm(e.name)===norm(sg.exercise));
  if(!ex||sg.week<1||sg.week>(S.plan.weeks||4))return null;
  return {day,ex,old:(ex.w||[])[sg.week-1]||""};
}
function sgDetail(sg){
  const T=targets()||{};
  if(sg.type==="targets")return [["kcal","热量","千卡"],["protein","蛋白质","g"],["carbs","碳水","g"],["fat","脂肪","g"]].filter(([k])=>sg[k]!=null)
    .map(([k,n,u])=>{const o=T[{kcal:"kcal",protein:"p",carbs:"c",fat:"f"}[k]];return `${n} ${o!=null?r0(o)+" → ":""}<b>${sg[k]}</b> ${u}`}).join("，");
  if(sg.type==="plan_cell"){const c=findPlanCell(sg);return c?`${esc(c.day.name)} · ${esc(c.ex.name)} · 第 ${sg.week} 周：${esc(c.old||"空")} → <b>${esc(sg.value)}</b>`:`计划里找不到「${esc(sg.day)} · ${esc(sg.exercise)}」，这条只能手动改。`}
  return "";
}
async function applySg(sg){
  if(sg.type==="targets"){
    const T=targets()||{},nt={kcal:sg.kcal??T.kcal,p:sg.protein??T.p,c:sg.carbs??T.c,f:sg.fat??T.f};
    if(!nt.kcal){toast("缺少热量目标，没有改");return false}
    S.settings={...(S.settings||{}),targets:nt};await store.set("settings",S.settings);toast("每日目标已更新");return true;
  }
  if(sg.type==="plan_cell"){
    const c=findPlanCell(sg);if(!c){toast("计划里找不到这一格，没有改");return false}
    c.ex.w=c.ex.w||[];c.ex.w[sg.week-1]=sg.value;planDraft=null;await store.set("plan",S.plan);toast("计划已更新");return true;
  }
  return true;
}
function renderCoach(){
  $("#coachRange").innerHTML=[2,4,8].map(n=>`<button class="chip" data-cw="${n}" aria-pressed="${coachWeeks===n}">${n} 周</button>`).join("");
  $("#coachRange").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{coachWeeks=+b.dataset.cw;renderCoach()}));
  const C=S.coach,out=$("#coachOut");
  if(!C){out.innerHTML="";return}
  out.innerHTML=`<div class="small muted">${esc(C.at.slice(0,10))} · 最近 ${C.weeks} 周 · 问：${esc(C.question)}</div>
    <div>${esc(C.res.summary).replace(/\n/g,"<br>")}</div>
    ${(C.res.suggestions||[]).map((sg,i)=>{const st=C.status[i],d=sgDetail(sg);return `<div class="sugcard ${st?"done":""}">
      <b>${esc(sg.title)}</b><div class="small muted">${esc(sg.reason)}</div>${d?`<div class="small">${d}</div>`:""}
      <div class="row">${st?`<span class="pill ${st==="applied"?"ok":"none"}">${st==="applied"?(sg.type==="advice"?"知道了":"已采纳"):"没采纳"}</span>`
        :`${sg.type==="plan_cell"&&!findPlanCell(sg)?"":`<button class="btn primary small" data-ok="${i}">${sg.type==="advice"?"知道了":"采纳"}</button>`}<button class="btn ghost small" data-no="${i}">${sg.type==="plan_cell"&&!findPlanCell(sg)?"知道了":"不用"}</button>`}</div></div>`}).join("")}`;
  const mark=async(i,st)=>{C.status[i]=st;try{await store.set("coach",C)}catch(e){}renderCoach()};
  out.querySelectorAll("[data-ok]").forEach(b=>b.addEventListener("click",async()=>{try{if(await applySg(C.res.suggestions[+b.dataset.ok]))mark(+b.dataset.ok,"applied")}catch(e){toast("保存失败，请再试一次")}}));
  out.querySelectorAll("[data-no]").forEach(b=>b.addEventListener("click",()=>mark(+b.dataset.no,"dismissed")));
}
$("#coachAsk").addEventListener("click",async()=>{
  const st=$("#coachState"),btn=$("#coachAsk");
  if(!getKey()){st.textContent=describeError({code:"no_key"});return}
  const question=$("#coachQ").value.trim()||"这周哪里该调整？";
  btn.disabled=true;st.innerHTML=`<span class="spin"></span> Claude 正在看你的记录，大约要半分钟…`;
  coachCtrl=new AbortController();
  try{
    const res=await coachReview({context:digest(coachWeeks),question,signal:coachCtrl.signal,onRetry:i=>{st.innerHTML=`<span class="spin"></span> Claude 繁忙，第 ${i} 次重试…`}});
    res.suggestions=(res.suggestions||[]).slice(0,5);
    S.coach={at:new Date().toISOString(),weeks:coachWeeks,question,res,status:{}};
    try{await store.set("coach",S.coach)}catch(e){}
    st.textContent="";renderCoach();
  }catch(e){console.error(e);st.textContent=describeError(e)}
  finally{btn.disabled=false}
});

/* ---------- settings ---------- */
function renderSettings(){
  const s=S.settings||{};
  $("#sSex").value=s.sex||"f";$("#sAge").value=s.age||"";$("#sHeight").value=s.height||"";$("#sWeight").value=s.weight||"";
  $("#sAct").value=s.activity||"1.45";$("#sGoal").value=s.goal||"recomp";
  const t=s.targets||{};$("#tK").value=t.kcal||"";$("#tP").value=t.p||"";$("#tC").value=t.c||"";$("#tF").value=t.f||"";
  $("#sKey").value=getKey();$("#sModel").value=getModel();
  $("#keyState").textContent=getKey()?"已保存 key。":"还没有填 key。";
  const g=gym();$("#sBar").value=g.bar;$("#sIncr").value=g.incr;$("#sPlates").value=g.plates.join(",");$("#sRest").value=g.rest;
}
$("#calcBtn").addEventListener("click",()=>{
  const sex=$("#sSex").value,age=+$("#sAge").value,h=+$("#sHeight").value,w=+$("#sWeight").value,act=+$("#sAct").value,goal=$("#sGoal").value;
  if(!age||!h||!w){$("#calcExplain").textContent="请先填年龄、身高和体重。";return}
  const bmr=10*w+6.25*h-5*age+(sex==="m"?5:-161);
  const tdee=bmr*act;
  const adj={cut:0.82,recomp:1,gain:1.1}[goal];
  const kcal=Math.round(tdee*adj/10)*10;
  const p=Math.round(w*(goal==="cut"?2.0:1.8));
  const f=Math.round(Math.max(w*0.8,kcal*0.25/9));
  const c=Math.max(0,Math.round((kcal-p*4-f*9)/4));
  $("#tK").value=kcal;$("#tP").value=p;$("#tC").value=c;$("#tF").value=f;
  $("#calcExplain").textContent=`基础代谢约 ${r0(bmr)} 千卡，乘活动系数后日消耗约 ${r0(tdee)} 千卡；${goal==="cut"?"减脂按 -18% 设热量":goal==="gain"?"增肌按 +10% 设热量":"维持体重"}。蛋白质按 ${goal==="cut"?"2.0":"1.8"} g/kg，脂肪不少于 0.8 g/kg，其余给碳水。点「保存」生效。`;
});
$("#saveSettings").addEventListener("click",async()=>{
  const s={...(S.settings||{}),sex:$("#sSex").value,age:+$("#sAge").value||null,height:+$("#sHeight").value||null,weight:+$("#sWeight").value||null,activity:$("#sAct").value,goal:$("#sGoal").value,
    targets:{kcal:+$("#tK").value||0,p:+$("#tP").value||0,c:+$("#tC").value||0,f:+$("#tF").value||0}};
  if(!s.targets.kcal){toast("先填每日热量目标，或点「按数据计算目标」");return}
  S.settings=s;
  try{await store.set("settings",s);toast("目标已保存")}catch(e){toast("保存失败，请稍后再试")}
});

$("#saveGym").addEventListener("click",async()=>{
  const plates=$("#sPlates").value.split(/[,，\s]+/).map(Number).filter(x=>x>0);
  const s={...(S.settings||{}),bar:+$("#sBar").value||45,incr:+$("#sIncr").value||5,plates:plates.join(","),rest:Math.max(10,+$("#sRest").value||120)};
  if(!plates.length){toast("至少填一种杠铃片");return}
  S.settings=s;
  try{await store.set("settings",s);toast("已保存");renderSettings()}catch(e){toast("保存失败，请稍后再试")}
});

/* ---------- API key ---------- */
$("#saveKey").addEventListener("click",()=>{setKey($("#sKey").value.trim());setModel($("#sModel").value);$("#keyState").textContent=getKey()?"已保存 key。":"还没有填 key。";toast("已保存")});
$("#clearKey").addEventListener("click",e=>confirmInline(e.currentTarget,"确认删除",()=>{setKey("");$("#sKey").value="";$("#keyState").textContent="key 已删除。";toast("已删除")}));
$("#testKey").addEventListener("click",async e=>{
  const btn=e.currentTarget;setKey($("#sKey").value.trim());setModel($("#sModel").value);
  btn.disabled=true;$("#keyState").innerHTML=`<span class="spin"></span> 正在测试…`;
  try{await testKey();$("#keyState").textContent="连接成功，可以识别照片了。"}
  catch(err){console.error(err);$("#keyState").textContent=describeError(err)}
  finally{btn.disabled=false}
});

/* ---------- backup ---------- */
function download(name,text,type){
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
}
$("#exportBtn").addEventListener("click",async()=>{
  try{
    const data=await store.all();
    download(`fitlog-backup-${ymd(new Date())}.json`,JSON.stringify({app:"fitlog",version:1,exportedAt:new Date().toISOString(),data},null,1),"application/json");
    const n=Object.keys(data).filter(k=>k.startsWith("d-")).length;
    $("#backupState").textContent=`已导出 ${n} 天的记录。`;
  }catch(e){console.error(e);$("#backupState").textContent="导出失败："+e.message}
});
// CSV with a BOM so Excel opens the Chinese text correctly.
const csvCell=v=>{v=String(v??"");return /[",\r\n]/.test(v)?`"${v.replace(/"/g,'""')}"`:v};
function toCsv(kind){
  const ds=Object.keys(S.days).sort(),rows=[];
  if(kind==="meals"){rows.push(["日期","餐次","时间","食物","份量","克","千卡","蛋白质(g)","碳水(g)","脂肪(g)","备注"]);
    ds.forEach(d=>S.days[d].meals.forEach(m=>m.items.forEach(i=>rows.push([d,m.type,m.time||"",i.name,i.amount||"",i.g??"",r0(i.kcal),r0(i.p),r0(i.c),r0(i.f),m.note||""]))))}
  if(kind==="workouts"){rows.push(["日期","训练日","第几周","槽位","动作","计划","组","类型","重量(lb)","次数","RIR","估算1RM(lb)","睡眠","疲劳","备注"]);
    ds.forEach(d=>{const w=S.days[d].workout;if(!w)return;w.exercises.forEach(e=>{let n=0;e.sets.forEach(s=>{if(s.r===""||s.r==null)return;if(!s.warm)n++;
      rows.push([d,w.dayName||"",w.week||"",e.slot||"",e.name,e.target||"",s.warm?"":n,s.warm?"热身":"正式",s.w,s.r,s.rir,s.warm?"":(e1rm(s.w,s.r)?r0(e1rm(s.w,s.r)):""),w.sleep||"",w.fatigue||"",w.note||""])})})})}
  if(kind==="weights"){rows.push(["日期","体重(kg)"]);weights().forEach(x=>rows.push([x.d,x.w]))}
  return {text:"\ufeff"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n"),n:rows.length-1};
}
document.querySelectorAll("[data-csv]").forEach(b=>b.addEventListener("click",()=>{
  const k=b.dataset.csv,{text,n}=toCsv(k);
  if(!n){$("#backupState").textContent="还没有可以导出的记录。";return}
  download(`fitlog-${{meals:"饮食",workouts:"训练",weights:"体重"}[k]}-${ymd(new Date())}.csv`,text,"text/csv;charset=utf-8");
  $("#backupState").textContent=`已导出 ${n} 行。`;
}));
let pendingImport=null;
$("#importInput").addEventListener("change",async e=>{
  const f=e.target.files&&e.target.files[0];e.target.value="";if(!f)return;
  try{
    const j=JSON.parse(await f.text());
    if(!j||j.app!=="fitlog"||typeof j.data!=="object")throw new Error("这不是训练饮食本的备份文件");
    pendingImport=j.data;
    const n=Object.keys(j.data).filter(k=>k.startsWith("d-")).length;
    $("#backupState").innerHTML=`备份里有 ${n} 天的记录（${esc((j.exportedAt||"").slice(0,10))}）。导入会<b>替换</b>这台设备上现有的全部记录。 <button class="btn danger" id="confirmImport">确认导入</button> <button class="btn ghost" id="cancelImport">取消</button>`;
    $("#confirmImport").addEventListener("click",async()=>{
      try{await store.replaceAll(pendingImport);pendingImport=null;await loadAll();render();$("#backupState").textContent="导入完成。";toast("已导入")}
      catch(err){$("#backupState").textContent="导入失败："+err.message}
    });
    $("#cancelImport").addEventListener("click",()=>{pendingImport=null;$("#backupState").textContent=""});
  }catch(err){$("#backupState").textContent="无法读取："+err.message}
});

/* ---------- example plan ---------- */
$("#loadExample").addEventListener("click",e=>{
  const go=async()=>{
    try{const r=await fetch("examples/nov-2026-block.json");planDraft=await r.json();renderPlan();toast("已载入，点「保存计划」生效")}
    catch(err){toast("载入失败，请检查网络")}
  };
  if(planDraft&&planDraft.days.length)confirmInline(e.currentTarget,"会替换当前表格，再点一次",go);else go();
});

/* ---------- boot ---------- */
async function loadAll(){
  const [settings,plan,days,favs,coach]=await Promise.all([store.get("settings"),store.get("plan"),store.days(),store.get("favs"),store.get("coach")]);
  S.settings=settings;S.plan=plan;planDraft=null;S.days={};S.favs=favs||[];S.coach=coach;
  days.forEach(d=>{if(d&&d.date){d.meals=d.meals||[];S.days[d.date]=d}});
  S.wDraft=null;
}
try{const t=localStorage.getItem("fitlog:tab");if(t&&$("#v-"+t))S.tab=t}catch(e){}
setTab(S.tab);
(async()=>{
  try{
    await loadAll();
    const n=Object.keys(S.days).length;
    $("#syncDot").classList.add("on");
    $("#syncText").textContent=`记录保存在这台设备上（${n} 天）。记得定期在「设置」导出备份。`;
  }catch(e){console.error(e);$("#syncText").textContent="读取记录失败："+(e&&e.message||"请刷新页面重试")}
  render();
  persist();
})();

if("serviceWorker" in navigator&&location.protocol==="https:"){
  navigator.serviceWorker.register("sw.js").catch(e=>console.warn("service worker",e));
}
