import { store, persist } from "./db.js";
import { estimateMeal, describeError, getKey, setKey, getModel, setModel, testKey } from "./ai.js";

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
const S={date:ymd(new Date()),tab:"today",settings:null,plan:null,days:{},
  wDraft:null};
const dayDoc=d=>S.days[d]||(S.days[d]={kind:"day",date:d,meals:[],workout:null});
async function saveDay(d){
  const doc=dayDoc(d);
  const empty=!doc.meals.length&&!doc.workout;
  try{ if(empty) await store.del("d-"+d); else await store.set("d-"+d,doc); }
  catch(e){console.error(e);toast(e&&e.name==="QuotaExceededError"?"手机存储空间不足，请先导出备份并清理":"保存失败，请再试一次");throw e}
}
const targets=()=>S.settings&&S.settings.targets&&S.settings.targets.kcal?S.settings.targets:null;
const sumMeals=meals=>meals.reduce((a,m)=>({kcal:a.kcal+(+m.kcal||0),p:a.p+(+m.p||0),c:a.c+(+m.c||0),f:a.f+(+m.f||0)}),{kcal:0,p:0,c:0,f:0});
const sumItems=items=>items.reduce((a,i)=>({kcal:a.kcal+(+i.kcal||0),p:a.p+(+i.p||0),c:a.c+(+i.c||0),f:a.f+(+i.f||0)}),{kcal:0,p:0,c:0,f:0});

/* ---------- nav ---------- */
function setTab(t){
  S.tab=t;
  document.querySelectorAll("nav.tabs button").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab===t?"true":"false"));
  ["today","food","train","plan","me"].forEach(k=>{$("#v-"+k).hidden=k!==t});
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
  $("#todayWorkout").innerHTML=w?`<div class="row between"><b>${esc(w.dayName||"训练")}</b><span class="small muted">${w.week?"第 "+w.week+" 周 · ":""}${w.exercises.length} 个动作 · ${w.exercises.reduce((a,e)=>a+e.sets.filter(s=>s.r!==""&&s.r!=null).length,0)} 组</span></div>
    <div class="small muted">${w.exercises.slice(0,4).map(e=>esc(e.name)+" "+bestSet(e)).join(" · ")}${w.exercises.length>4?" …":""}</div>`
    :`<div class="empty">这天还没有训练记录。${S.plan?"到「训练」选今天练哪一天，计划会自动预填。":""}</div>`;
  renderWeek();
}
function bestSet(e){const s=e.sets.filter(x=>x.r!==""&&x.r!=null);if(!s.length)return "";const top=s.reduce((a,b)=>(+b.w||0)>(+a.w||0)?b:a);return (top.w?top.w+"×":"")+top.r}
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
      <div class="acts"><button class="btn" data-edit="${m.id}">改</button><button class="btn" data-del="${m.id}">删</button></div></div></div>`).join("")
    :`<div class="empty">这天还没有饮食记录。上传一张照片，Claude 会列出每样食物的份量、热量、蛋白质、碳水和脂肪，你确认后保存。</div>`;
  $("#mealList").querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>{const m=doc.meals.find(x=>x.id===b.dataset.edit);if(m)openMealEditor(JSON.parse(JSON.stringify(m)),false)}));
  $("#mealList").querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>confirmInline(b,"确认删除",async()=>{doc.meals=doc.meals.filter(x=>x.id!==b.dataset.del);render();await saveDay(S.date);toast("已删除")})));
  const ai=$("#aiState");
  ai.innerHTML=getKey()?"":`照片识别要先到「设置」填 Anthropic API key；没有 key 也可以手动填写。`;
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
$("#photoInput").addEventListener("change",async e=>{
  const f=e.target.files&&e.target.files[0];e.target.value="";if(!f)return;
  try{
    const img=await loadImage(f);
    const blob=await shrink(img,1280,0.82,true);
    const meal={id:uid(),type:guessMealType(),time:new Date().toTimeString().slice(0,5),items:[],thumb:thumbSquare(img),note:"",preview:shrink(img,900,0.8,false),blob};
    openMealEditor(meal,true,"photo");
  }catch(err){toast(err.message||"图片无法读取")}
});
$("#textMealBtn").addEventListener("click",()=>openMealEditor({id:uid(),type:guessMealType(),time:new Date().toTimeString().slice(0,5),items:[],thumb:"",note:""},true,"text"));
$("#manualMealBtn").addEventListener("click",()=>openMealEditor({id:uid(),type:guessMealType(),time:new Date().toTimeString().slice(0,5),items:[{name:"",amount:"",kcal:"",p:"",c:"",f:""}],thumb:"",note:""},true,"manual"));

function closeSheet(){$("#sheetRoot").innerHTML="";document.body.style.overflow=""}
function openMealEditor(meal,isNew,mode){
  const root=$("#sheetRoot");document.body.style.overflow="hidden";
  let ctrl=null;
  root.innerHTML=`<div class="sheet-bg" id="sheetBg"><div class="sheet" role="dialog" aria-modal="true" aria-label="记录一餐">
    <div class="row between"><h2>${isNew?"记录一餐":"修改这一餐"}</h2><button class="icon-btn" id="mClose" aria-label="关闭">×</button></div>
    ${meal.preview?`<img class="preview" src="${meal.preview}" alt="食物照片">`:""}
    <div class="row">
      <div class="chips" id="mType">${MEALTYPES.map(t=>`<button class="chip" data-t="${t}" aria-pressed="${t===meal.type}">${t}</button>`).join("")}</div>
    </div>
    ${mode==="photo"||mode==="text"?`<label class="f">${mode==="photo"?"补充说明（可选，写了更准）":"吃了什么"}<textarea id="mHint" rows="2" placeholder="${mode==="photo"?"例如：米饭吃了半碗，鸡胸约 150 g，少油":"例如：一碗牛肉面，加一个卤蛋，一杯无糖豆浆"}"></textarea></label>
      <div class="row"><button class="btn primary" id="mAsk">${mode==="photo"?"估算这张照片":"估算营养"}</button><span class="small muted" id="mAskState"></span></div>`:""}
    <div id="mResult"></div>
    <label class="f">备注<input id="mNote" value="${esc(meal.note)}" placeholder="可选"></label>
    <div class="row"><button class="btn primary" id="mSave">保存</button><button class="btn ghost" id="mCancel">取消</button></div>
  </div></div>`;
  const drawItems=()=>{
    const tot=sumItems(meal.items);
    $("#mResult").innerHTML=(meal.items.length?`<div class="tbl-wrap"><table>
      <thead><tr><th>食物</th><th>份量</th><th>千卡</th><th>蛋白</th><th>碳水</th><th>脂肪</th><th></th></tr></thead>
      <tbody>${meal.items.map((it,i)=>`<tr data-i="${i}">
        <td><input data-k="name" value="${esc(it.name)}" aria-label="食物"></td>
        <td><input data-k="amount" value="${esc(it.amount)}" aria-label="份量" style="min-width:70px"></td>
        ${["kcal","p","c","f"].map(k=>`<td class="n"><input data-k="${k}" type="number" inputmode="decimal" value="${esc(it[k])}" aria-label="${k}"></td>`).join("")}
        <td><button class="x" data-rm="${i}" aria-label="删除这一行">×</button></td></tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="2">合计</td><td class="mono" id="sumK">${r0(tot.kcal)}</td><td class="mono" id="sumP">${r0(tot.p)}</td><td class="mono" id="sumC">${r0(tot.c)}</td><td class="mono" id="sumF">${r0(tot.f)}</td><td></td></tr></tfoot>
    </table></div>`:"")
    +(meal.aiNote?`<div class="small muted">${meal.confidence?`<span class="pill ${meal.confidence==="高"?"ok":meal.confidence==="中"?"warn":"bad"}">把握：${esc(meal.confidence)}</span> `:""}${esc(meal.aiNote)}</div>`:"")
    +`<div class="row"><button class="btn ghost" id="mAddRow">＋ 加一样食物</button></div>`;
    $("#mResult").querySelectorAll("input").forEach(inp=>inp.addEventListener("input",()=>{
      const i=+inp.closest("tr").dataset.i,k=inp.dataset.k;meal.items[i][k]=inp.value;
      const t=sumItems(meal.items);$("#sumK").textContent=r0(t.kcal);$("#sumP").textContent=r0(t.p);$("#sumC").textContent=r0(t.c);$("#sumF").textContent=r0(t.f);
    }));
    $("#mResult").querySelectorAll("[data-rm]").forEach(b=>b.addEventListener("click",()=>{meal.items.splice(+b.dataset.rm,1);drawItems()}));
    $("#mAddRow").addEventListener("click",()=>{meal.items.push({name:"",amount:"",kcal:"",p:"",c:"",f:""});drawItems()});
  };
  drawItems();
  $("#mType").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{meal.type=b.dataset.t;$("#mType").querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x===b?"true":"false"))}));
  const close=()=>{if(ctrl)ctrl.abort();closeSheet()};
  $("#mClose").addEventListener("click",close);$("#mCancel").addEventListener("click",close);
  $("#sheetBg").addEventListener("click",e=>{if(e.target.id==="sheetBg")close()});
  if($("#mAsk")) $("#mAsk").addEventListener("click",async()=>{
    const hint=$("#mHint").value.trim();
    if(mode==="text"&&!hint){$("#mAskState").textContent="先写下吃了什么。";return}
    if(!getKey()){$("#mAskState").textContent=describeError({code:"no_key"});return}
    const btn=$("#mAsk");btn.disabled=true;$("#mAskState").innerHTML=`<span class="spin"></span> 正在估算…`;
    ctrl=new AbortController();
    try{
      const res=await estimateMeal({mode,hint,image:meal.blob,signal:ctrl.signal});
      const items=Array.isArray(res&&res.items)?res.items:[];
      meal.items=items.map(x=>({name:String(x.name||""),amount:String(x.amount||""),kcal:r0(x.kcal),p:r0(x.protein),c:r0(x.carbs),f:r0(x.fat)}));
      meal.aiNote=String(res&&res.note||"");meal.confidence=["高","中","低"].includes(res&&res.confidence)?res.confidence:"";
      $("#mAskState").textContent=items.length?"估算完成，数字都可以直接改。":"没有识别出食物。";
      btn.textContent="重新估算";drawItems();
    }catch(e){
      if(ctrl.signal.aborted)return;
      console.error(e);
      $("#mAskState").textContent=describeError(e);
    }finally{btn.disabled=false}
  });
  $("#mSave").addEventListener("click",async()=>{
    meal.items=meal.items.filter(i=>i.name||+i.kcal);
    if(!meal.items.length){toast("至少填一样食物");return}
    const t=sumItems(meal.items);
    const rec={id:meal.id,type:meal.type,time:meal.time,items:meal.items.map(i=>({name:i.name,amount:i.amount,kcal:r0(i.kcal),p:r0(i.p),c:r0(i.c),f:r0(i.f)})),kcal:r0(t.kcal),p:r0(t.p),c:r0(t.c),f:r0(t.f),thumb:meal.thumb||"",note:$("#mNote").value.trim()};
    if(meal.aiNote)rec.aiNote=meal.aiNote;
    const doc=dayDoc(S.date),i=doc.meals.findIndex(x=>x.id===rec.id);
    if(i>=0)doc.meals[i]=rec;else doc.meals.push(rec);
    closeSheet();render();
    try{await saveDay(S.date);toast("已保存")}catch(e){}
  });
}

/* ---------- training ---------- */
function parseTarget(t){
  t=String(t||"").trim();
  if(!t||/不做|跳过/.test(t))return {sets:0,reps:"",ws:[]};
  const m=t.match(/(\d+)\s*[×xX*]\s*(\d+)/);
  const sets=m?+m[1]:1,reps=m?m[2]:"";
  let ws=[];const at=t.split("@")[1];
  if(at){const nums=at.match(/\d+(\.\d+)?/g)||[];ws=at.includes(",")&&nums.length>=sets?nums.slice(0,sets):nums.length?[nums[0]]:[]}
  return {sets,reps,ws};
}
function fromPlan(dayIdx,week){
  const day=S.plan.days[dayIdx];
  return {dayKey:day.id||String(dayIdx),dayName:day.name,week,sleep:null,fatigue:null,note:"",
    exercises:day.exercises.map(ex=>{const target=(ex.w||[])[week-1]||"",p=parseTarget(target);
      const n=Math.max(p.sets,0);
      return {slot:ex.slot||"",name:ex.name,target,sets:Array.from({length:n},(_,i)=>({w:p.ws.length?(p.ws[i]??p.ws[0]):"",r:"",rir:"",pr:p.reps}))}})};
}
function lastPerf(name,before){
  const ds=Object.keys(S.days).filter(d=>d<before).sort().reverse();
  for(const d of ds){const w=S.days[d].workout;if(!w)continue;const e=w.exercises.find(x=>x.name===name);if(e){const s=e.sets.filter(x=>x.r!==""&&x.r!=null);if(s.length)return {d,s}}}
  return null;
}
function inferWeek(){
  // continue the week of the most recent logged session, advancing once every plan day was done
  const ds=Object.keys(S.days).filter(d=>d<S.date&&S.days[d].workout).sort().reverse();
  if(!ds.length||!S.plan)return 1;
  const w=S.days[ds[0]].workout,wk=w.week||1;
  const doneThisWeek=new Set(ds.map(d=>S.days[d].workout).filter(x=>x.week===wk).map(x=>x.dayKey));
  return doneThisWeek.size>=S.plan.days.length?Math.min(wk+1,S.plan.weeks||4):wk;
}
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
  if(!W){list.innerHTML=`<div class="empty">选上面一个训练日，按计划预填今天的动作、组数和目标重量；做完每组填实际重量、次数和 RIR（还能再做几次）。</div>`;$("#addEx").hidden=true}
  else{
    $("#addEx").hidden=false;
    list.innerHTML=W.exercises.length?W.exercises.map((e,ei)=>{
      const lp=lastPerf(e.name,S.date);
      return `<div class="ex" data-ei="${ei}">
        <div class="ex-h"><span class="slot">${esc(e.slot)}</span><span class="ex-name"><input data-f="name" value="${esc(e.name)}" aria-label="动作名称"></span><button class="x" data-rmex="${ei}" aria-label="删除这个动作">×</button></div>
        ${e.target?`<div class="target">计划：${esc(e.target)}</div>`:""}
        ${lp?`<div class="last">上次 ${fmtDate(lp.d)}：<b class="mono">${lp.s.map(s=>(s.w?s.w+"×":"")+s.r).join(" · ")}</b>${lp.s.some(s=>s.rir!==""&&s.rir!=null)?" · 末组 RIR "+esc(lp.s.filter(s=>s.rir!==""&&s.rir!=null).slice(-1)[0].rir):""}</div>`:""}
        <div class="sets"><span class="hd"></span><span class="hd">重量 lb</span><span class="hd">次数</span><span class="hd">RIR</span><span></span>
        ${e.sets.map((s,si)=>`<span class="i">${si+1}</span>
          <input data-s="${si}" data-k="w" inputmode="decimal" value="${esc(s.w)}" aria-label="第${si+1}组重量" placeholder="自重">
          <input data-s="${si}" data-k="r" inputmode="numeric" value="${esc(s.r)}" aria-label="第${si+1}组次数" placeholder="${esc(s.pr||"")}">
          <input data-s="${si}" data-k="rir" inputmode="numeric" value="${esc(s.rir)}" aria-label="第${si+1}组RIR" placeholder="-">
          <button class="x" data-rms="${si}" aria-label="删除这一组">×</button>`).join("")}
        </div>
        <div><button class="btn ghost small" data-adds="${ei}">＋ 一组</button></div>
      </div>`}).join(""):`<div class="empty">还没有动作，点下面加一个。</div>`;
    list.querySelectorAll(".ex").forEach(box=>{
      const e=W.exercises[+box.dataset.ei];
      box.querySelector('[data-f="name"]').addEventListener("input",ev=>{e.name=ev.target.value});
      box.querySelectorAll("[data-s]").forEach(inp=>inp.addEventListener("input",()=>{e.sets[+inp.dataset.s][inp.dataset.k]=inp.value.trim()}));
      box.querySelectorAll("[data-rms]").forEach(b=>b.addEventListener("click",()=>{e.sets.splice(+b.dataset.rms,1);renderTrain()}));
      box.querySelector("[data-adds]").addEventListener("click",()=>{const l=e.sets[e.sets.length-1];e.sets.push({w:l?l.w:"",r:"",rir:"",pr:l?l.pr:""});renderTrain()});
      box.querySelector("[data-rmex]").addEventListener("click",ev=>confirmInline(ev.currentTarget,"删?",()=>{W.exercises.splice(+box.dataset.ei,1);renderTrain()}));
    });
  }
  const scale=(el,key)=>{el.innerHTML=[1,2,3,4,5].map(n=>`<button data-n="${n}" aria-pressed="${W&&W[key]===n}">${n}</button>`).join("");
    el.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{if(!S.wDraft)S.wDraft={dayKey:"free",dayName:"自由训练",week:null,exercises:[],note:""};S.wDraft[key]=+b.dataset.n;renderTrain()}))};
  scale($("#sleepScale"),"sleep");scale($("#fatigueScale"),"fatigue");
  $("#wNote").value=W?W.note||"":"";
  $("#trainSaved").textContent=doc.workout?"已保存":"";
  $("#clearWorkout").hidden=!doc.workout;
  renderHistory();
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
function renderHistory(){
  const ds=Object.keys(S.days).filter(d=>S.days[d].workout).sort().reverse().slice(0,10);
  $("#trainHistory").innerHTML=ds.length?ds.map(d=>{const w=S.days[d].workout;return `<div class="hist-item"><span><b>${fmtDate(d)}</b> ${esc(w.dayName||"")}${w.week?` <span class="muted">· 第 ${w.week} 周</span>`:""}</span><button class="btn ghost small" data-day="${d}">查看</button></div>`}).join("")
    :`<div class="empty">保存第一次训练后，这里会列出最近的记录；同一个动作下次会显示「上次」的重量和次数。</div>`;
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

/* ---------- settings ---------- */
function renderSettings(){
  const s=S.settings||{};
  $("#sSex").value=s.sex||"f";$("#sAge").value=s.age||"";$("#sHeight").value=s.height||"";$("#sWeight").value=s.weight||"";
  $("#sAct").value=s.activity||"1.45";$("#sGoal").value=s.goal||"recomp";
  const t=s.targets||{};$("#tK").value=t.kcal||"";$("#tP").value=t.p||"";$("#tC").value=t.c||"";$("#tF").value=t.f||"";
  $("#sKey").value=getKey();$("#sModel").value=getModel();
  $("#keyState").textContent=getKey()?"已保存 key。":"还没有填 key。";
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
  const s={sex:$("#sSex").value,age:+$("#sAge").value||null,height:+$("#sHeight").value||null,weight:+$("#sWeight").value||null,activity:$("#sAct").value,goal:$("#sGoal").value,
    targets:{kcal:+$("#tK").value||0,p:+$("#tP").value||0,c:+$("#tC").value||0,f:+$("#tF").value||0}};
  if(!s.targets.kcal){toast("先填每日热量目标，或点「按数据计算目标」");return}
  S.settings=s;
  try{await store.set("settings",s);toast("目标已保存")}catch(e){toast("保存失败，请稍后再试")}
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
$("#exportBtn").addEventListener("click",async()=>{
  try{
    const data=await store.all();
    const blob=new Blob([JSON.stringify({app:"fitlog",version:1,exportedAt:new Date().toISOString(),data},null,1)],{type:"application/json"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`fitlog-backup-${ymd(new Date())}.json`;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
    const n=Object.keys(data).filter(k=>k.startsWith("d-")).length;
    $("#backupState").textContent=`已导出 ${n} 天的记录。`;
  }catch(e){console.error(e);$("#backupState").textContent="导出失败："+e.message}
});
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
  const [settings,plan,days]=await Promise.all([store.get("settings"),store.get("plan"),store.days()]);
  S.settings=settings;S.plan=plan;planDraft=null;S.days={};
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
