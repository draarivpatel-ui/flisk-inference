import { PICKER_LOGOS } from "./picker-logos";
// The model picker. `/picker` is a small page any *.flisk.si site can put in an iframe, and `/picker.js` is the script that does it:
//   <div id="m"></div><script src="https://inference.flisk.si/picker.js"></script>
//   <script>FliskPicker.mount("#m", { onChange: (c) => console.log(c) })</script>   // c = { provider, model } or null for the free Flisk model
// The person signs in once on inference.flisk.si (the cookie is the same-site one); the key is typed into this page only, goes to
// /api/provider and is never shown again, so the site that frames it cannot read it.

export function PICKER_JS(base: string): string {
  return `(function(){
var BASE=${JSON.stringify(base)};
window.FliskPicker={mount:function(target,opts){
  opts=opts||{};
  var el=typeof target==="string"?document.querySelector(target):target;
  if(!el)throw new Error("FliskPicker: no element for "+target);
  var f=document.createElement("iframe");
  f.src=BASE+"/picker";f.title="Choose your model";f.style.cssText="width:100%;height:"+(opts.height||560)+"px;border:0;color-scheme:normal";
  f.setAttribute("allow","");
  el.appendChild(f);
  function onMsg(e){
    if(e.origin!==BASE||e.source!==f.contentWindow||!e.data||e.data.type!=="flisk-picker")return;
    if(typeof opts.onChange==="function")opts.onChange(e.data.current||null);
  }
  window.addEventListener("message",onMsg);
  return{destroy:function(){window.removeEventListener("message",onMsg);f.remove()}};
}};
})();`;
}

// The page in the iframe. It looks like the model picker in chat (chat.flisk.si): search, a rail of providers, a list of models
// with price and a one-line description, and under it the key box for a model that runs on the person's own account.
// The list is /v1/catalog; saving goes to /api/provider. The key is typed here only and is never shown again.
const FLISK_LOGO = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJGbGlzayBJbmZlcmVuY2UiPjx0aXRsZT5GbGlzayBJbmZlcmVuY2U8L3RpdGxlPjxyZWN0IHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgcng9IjE0IiBmaWxsPSIjMGYxNDI2Ii8+PHJlY3QgeD0iMjAiIHk9IjIwIiB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHJ4PSI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmYmZhZjciIHN0cm9rZS13aWR0aD0iNCIvPjxyZWN0IHg9IjI4IiB5PSIyOCIgd2lkdGg9IjgiIGhlaWdodD0iOCIgcng9IjEuNSIgZmlsbD0iIzZmZjBhZSIvPjxwYXRoIGQ9Ik0yOCAxMXY5TTM2IDExdjlNMjggNDR2OU0zNiA0NHY5TTExIDI4aDlNMTEgMzZoOU00NCAyOGg5TTQ0IDM2aDkiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2ZiZmFmNyIgc3Ryb2tlLXdpZHRoPSIzLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvc3ZnPgo=";
export function pickerHtml(): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Choose your model</title>
<style>:root{color-scheme:light dark;--bg:#F7F6F2;--panel:#fff;--line:#E3E0D6;--line2:#D3D0C5;--ink:#1B1B18;--dim:#6B6960;--soft:#9A988E;--green:#2F7D4A;--tint:#EAF3DE;--red:#B42318;--r:6px;--mono:ui-monospace,Menlo,monospace}
@media(prefers-color-scheme:dark){:root{--bg:#161614;--panel:#1F1F1C;--line:#2E2D28;--line2:#3D3C35;--ink:#F1EFE8;--dim:#A8A598;--soft:#7C7A70;--green:#3E9A5E;--tint:#1F3326;--red:#F2746B}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,sans-serif}body{padding:10px}
.pop{background:var(--panel);border:1px solid var(--line2);border-radius:var(--r);overflow:hidden}
.ps{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line);color:var(--soft)}
.ps input{flex:1;border:0;outline:0;font:14px system-ui,sans-serif;background:transparent;color:var(--ink);min-width:0}
.pgrid{display:grid;grid-template-columns:78px minmax(0,1fr);height:300px}
.rail{border-right:1px solid var(--line);display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 0;overflow:auto}
.rail button{width:68px;border-radius:var(--r);border:1px solid transparent;background:none;display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;padding:6px 2px;font:11px/1.2 system-ui,sans-serif;color:var(--dim)}
.rail button>span:last-child{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rail button:hover{background:var(--bg)}.rail button[aria-pressed=true]{background:var(--tint);color:var(--ink)}
.lg{width:28px;height:28px;border-radius:var(--r);background:#fff;border:1px solid var(--line);display:inline-grid;place-items:center;flex:none;overflow:hidden}.lg img{width:70%;height:70%;object-fit:contain}
.lt{width:28px;height:28px;border-radius:var(--r);display:grid;place-items:center;font:600 12px/1 var(--mono);background:var(--bg);color:var(--ink);border:1px solid var(--line)}
.mlist{overflow:auto;padding:6px}
.mi{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:10px;align-items:start;width:100%;text-align:left;border:0;background:none;border-radius:var(--r);padding:9px 10px;cursor:pointer;color:inherit;font:inherit}
.mi:hover,.mi.on{background:var(--bg)}
.mi .n{font-weight:500;font-size:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mi .d{display:block;font-size:13px;color:var(--dim)}
.price{font:500 11px var(--mono);color:var(--soft)}.price.free{color:var(--green);background:var(--tint);border-radius:var(--r);padding:1px 7px}
.new{font:600 10px var(--mono);text-transform:uppercase;color:var(--green)}
.mi .ck{width:16px;height:16px;margin-top:3px;opacity:0}.mi.on .ck{opacity:1}
.mgroup{font-size:12px;color:var(--soft);padding:8px 10px 2px}
#own{border-top:1px solid var(--line);padding:10px 14px 12px;display:flex;flex-direction:column;gap:8px;background:var(--bg)}#own[hidden]{display:none}
#own label{font:600 11px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}
#own input{width:100%;padding:9px 11px;border:1px solid var(--line2);background:var(--panel);color:inherit;font:14px system-ui,sans-serif;border-radius:var(--r)}
.row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
button.go{background:var(--green);color:#fff;border:0;border-radius:var(--r);font:600 12px var(--mono);letter-spacing:.06em;text-transform:uppercase;padding:10px 18px;cursor:pointer}
button.g{background:transparent;color:inherit;border:1px solid var(--line2);border-radius:var(--r);font:600 12px var(--mono);letter-spacing:.06em;text-transform:uppercase;padding:9px 14px;cursor:pointer}
.note{font-size:12px;color:var(--dim);margin:0}#msg{min-height:1.4em;font-size:13px;margin:0}.err{color:var(--red)}.ok{color:var(--green)}[hidden]{display:none}
a.b{display:inline-block;background:var(--green);color:#fff;font:600 12px var(--mono);text-transform:uppercase;letter-spacing:.06em;padding:11px 18px;border-radius:var(--r);text-decoration:none}</style>
<main id="app"><p class="note">Loading…</p></main>
<script>
var LOGOS=` + JSON.stringify({ ...PICKER_LOGOS, flisk: FLISK_LOGO }) + `;
var app=document.getElementById("app"),cfg=null,models=[],sel=null,rail="",q="";
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e}
function post(cur){try{var o=(location.ancestorOrigins&&location.ancestorOrigins[0])||"*";parent.postMessage({type:"flisk-picker",current:cur},o)}catch(e){}}
async function api(m,b){var r=await fetch("/api/provider",{method:m,headers:{"content-type":"application/json"},body:b?JSON.stringify(b):undefined});return{status:r.status,body:await r.json().catch(function(){return{}})}}
function tile(m,size){
  var src=LOGOS[m.provider];
  if(!src){var t=el("span","lt",String(m.providerName||m.provider).slice(0,2));t.style.width=t.style.height=size+"px";return t}
  var s=el("span","lg");s.style.width=s.style.height=size+"px";var i=document.createElement("img");i.alt="";i.src=src;s.appendChild(i);return s}
async function load(){
  var r=await api("GET");
  if(r.status===401){
    app.textContent="";app.appendChild(el("p","note","Sign in once to choose which model answers your calls."));
    var a=el("a","b","Sign in with GitHub");a.href="/auth/github";a.target="_blank";a.rel="noopener";app.appendChild(a);app.appendChild(el("p","note","Then come back to this page."));
    window.addEventListener("focus",function f(){window.removeEventListener("focus",f);load()});return;
  }
  cfg=r.body;
  try{var c=await (await fetch("/v1/catalog")).json();models=(c.data||[]).filter(function(m){return m.free||(cfg.providers&&cfg.providers[m.key])})}catch(e){models=[]}
  var cur=cfg.current;
  sel=cur?(models.find(function(m){return m.key===cur.provider&&m.model===cur.model})||models.find(function(m){return m.key===cur.provider&&!m.model})||models.find(function(m){return m.key===cur.provider})):models.find(function(m){return m.free});
  draw();post(cur?{provider:cur.provider,model:cur.model}:null);
}
function draw(){
  app.textContent="";
  var pop=el("div","pop"),ps=el("div","ps"),inp=document.createElement("input");inp.placeholder="Search models";inp.value=q;inp.setAttribute("aria-label","Search models");inp.autocomplete="off";
  ps.appendChild(inp);pop.appendChild(ps);
  var grid=el("div","pgrid"),rl=el("div","rail"),list=el("div","mlist");grid.appendChild(rl);grid.appendChild(list);pop.appendChild(grid);
  var provs=[];models.forEach(function(m){if(!provs.some(function(p){return p.provider===m.provider}))provs.push(m)});
  function rb(label,mm,key){var b=el("button");b.type="button";b.setAttribute("aria-pressed",String(rail===key));b.title=label;
    b.appendChild(mm?tile(mm,28):el("span","lt","All"));b.appendChild(el("span","",label));b.onclick=function(){rail=key;drawRail();drawList()};return b}
  function drawRail(){rl.textContent="";rl.appendChild(rb("All",null,""));provs.forEach(function(p){rl.appendChild(rb(p.providerName,p,p.provider))})}
  function drawList(){
    list.textContent="";var last="",n=0,w=q.trim().toLowerCase();
    models.filter(function(m){return(!rail||m.provider===rail)&&(!w||(m.name+" "+m.providerName+" "+m.description).toLowerCase().indexOf(w)>=0)}).forEach(function(m){
      n++;var g=m.providerName+(m.free?"":" · your key");if(g!==last){last=g;list.appendChild(el("div","mgroup",g))}
      var b=el("button","mi"+(sel&&sel.id===m.id?" on":""));b.type="button";b.setAttribute("role","option");b.setAttribute("aria-selected",String(!!sel&&sel.id===m.id));
      b.appendChild(tile(m,28));var t=el("span"),nm=el("span","n",m.name);nm.appendChild(el("span","price"+(m.free?" free":""),m.free?"free":m.price));if(m.new)nm.appendChild(el("span","new","new"));
      t.appendChild(nm);t.appendChild(el("span","d",m.description));b.appendChild(t);
      b.insertAdjacentHTML("beforeend",'<svg class="ck" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>');
      b.onclick=function(){sel=m;drawList();drawOwn(true)};list.appendChild(b)});
    if(!n)list.appendChild(el("div","mgroup","No model matches."))}
  inp.oninput=function(){q=inp.value;drawList()};
  drawRail();drawList();app.appendChild(pop);
  var own=el("div");own.id="own";own.hidden=true;pop.appendChild(own);
  function drawOwn(focus){
    var cur=cfg.current;own.textContent="";
    if(!sel){own.hidden=true;return}
    if(sel.free){
      if(!cur){own.hidden=true;return}
      own.hidden=false;own.appendChild(el("p","note","Calls made with your Flisk API key run on the free Flisk Wolf model again."));
      var u=el("button","go","Use Flisk Wolf");u.type="button";u.onclick=async function(){var r=await api("PUT",{provider:"wolf"});if(r.status===200){cfg.current=null;post(null);drawOwn()}else msg(r.body.error||"Could not save.",1)};own.appendChild(u);own.appendChild(el("p","")).id="msg";return}
    own.hidden=false;var d=cfg.providers[sel.key],same=cur&&cur.provider===sel.key;
    var mIn=null;
    if(!sel.model){own.appendChild(el("label","","Model"));mIn=document.createElement("input");mIn.autocomplete="off";mIn.spellcheck=false;mIn.value=same?cur.model:d.defaultModel;own.appendChild(mIn)}
    own.appendChild(el("label","","Your "+d.label+" API key"));var k=document.createElement("input");k.type="password";k.autocomplete="off";k.spellcheck=false;
    k.placeholder=same?"saved, ending "+cur.last4+" (leave empty to keep)":d.keyHint;own.appendChild(k);
    own.appendChild(el("p","note","Your key is stored encrypted and never shown again. Calls made with your Flisk API key run on this account and are billed by "+d.label+", not counted in the free limit."));
    var row=el("div","row"),sv=el("button","go","Save");sv.type="button";row.appendChild(sv);
    if(same){var rm=el("button","g","Remove saved key");rm.type="button";rm.onclick=async function(){await api("DELETE");cfg.current=null;post(null);sel=models.find(function(m){return m.free});msg("Removed. Calls use the free Flisk Wolf again.");drawList();drawOwn()};row.appendChild(rm)}
    own.appendChild(row);var mg=el("p");mg.id="msg";mg.setAttribute("role","status");own.appendChild(mg);
    sv.onclick=async function(){msg("Saving…");var r=await api("PUT",{provider:sel.key,model:mIn?mIn.value:sel.model,key:k.value});
      if(r.status===200){cfg.current=r.body.current||null;k.value="";post(cfg.current?{provider:cfg.current.provider,model:cfg.current.model}:null);drawOwn();msg("Saved.")}else msg(r.body.error||"Could not save.",1)};
    if(focus)(mIn&&!same?mIn:k).focus()}
  function msg(t,bad){var m=document.getElementById("msg");if(m){m.className=bad?"err":"ok";m.textContent=t}}
  drawOwn(false);
}
load();
</script></html>`;
}
