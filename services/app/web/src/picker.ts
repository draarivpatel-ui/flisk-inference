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
  f.src=BASE+"/picker";f.title="Choose your model";f.style.cssText="width:100%;height:"+(opts.height||330)+"px;border:0;color-scheme:normal";
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

export function pickerHtml(): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Choose your model</title>
<style>:root{color-scheme:light dark;--bg:#f6f4ee;--fg:#121212;--mut:#6a6a70;--line:rgba(18,18,18,.82);--ok:#22c55e}
@media(prefers-color-scheme:dark){:root{--bg:#111114;--fg:#ececf1;--mut:rgba(236,236,241,.62);--line:rgba(255,255,255,.5)}}
*{box-sizing:border-box}body{margin:0;padding:16px;font:14px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
label{display:block;font:600 11px ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);margin:14px 0 6px}label:first-child{margin-top:0}
select,input{width:100%;padding:10px 12px;border:1px solid var(--line);background:transparent;color:inherit;font:inherit;border-radius:0}
button,a.b{display:inline-block;margin-top:16px;background:var(--ok);color:#04120a;border:0;font:600 12px ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;padding:12px 20px;cursor:pointer;text-decoration:none}
button.g{background:transparent;color:inherit;border:1px solid var(--line);margin-left:8px}p{color:var(--mut);margin:10px 0 0}#msg{min-height:1.5em}.err{color:#d13a3a}.ok{color:var(--ok)}[hidden]{display:none}</style>
<main id="app"><p>Loading…</p></main>
<script>
var app=document.getElementById("app"),cfg=null;
function post(cur){try{var o=(location.ancestorOrigins&&location.ancestorOrigins[0])||"*";parent.postMessage({type:"flisk-picker",current:cur},o)}catch(e){}}
async function api(m,b){var r=await fetch("/api/provider",{method:m,headers:{"content-type":"application/json"},body:b?JSON.stringify(b):undefined});return{status:r.status,body:await r.json().catch(function(){return{}})}}
async function load(){
  var r=await api("GET");
  if(r.status===401){
    app.innerHTML='<p>Sign in once to choose which model answers your calls.</p><a class="b" href="/auth/github" target="_blank" rel="noopener">Sign in with GitHub</a><p>Then come back to this page.</p>';
    window.addEventListener("focus",function f(){window.removeEventListener("focus",f);load()});return;
  }
  cfg=r.body;render();post(cfg.current?{provider:cfg.current.provider,model:cfg.current.model}:null);
}
function render(){
  var cur=cfg.current,opts='<option value="wolf">Flisk Wolf (free, shared daily limit)</option>';
  for(var id in cfg.providers)opts+='<option value="'+id+'">'+cfg.providers[id].label+' (your own key)</option>';
  app.innerHTML='<label for="p">Model provider</label><select id="p">'+opts+'</select>'+
   '<div id="own" hidden><label for="m">Model</label><input id="m" autocomplete="off" spellcheck="false">'+
   '<label for="k">API key</label><input id="k" type="password" autocomplete="off" spellcheck="false"><p id="note"></p></div>'+
   '<div><button id="save">Save</button><button class="g" id="rm" hidden>Remove saved key</button></div><p id="msg" role="status"></p>';
  var p=document.getElementById("p"),m=document.getElementById("m"),k=document.getElementById("k");
  p.value=cur?cur.provider:"wolf";
  function sync(){
    var own=p.value!=="wolf";document.getElementById("own").hidden=!own;
    if(own){var d=cfg.providers[p.value];m.value=cur&&cur.provider===p.value?cur.model:d.defaultModel;k.placeholder=cur&&cur.provider===p.value?"saved, ending "+cur.last4+" (leave empty to keep)":d.keyHint;
      document.getElementById("note").textContent="Your key is stored encrypted and never shown again. Calls made with your Flisk API key run on this account and are billed by "+d.label+", not counted in the free limit."}
    document.getElementById("rm").hidden=!cur;
  }
  p.onchange=sync;sync();
  document.getElementById("save").onclick=async function(){
    var msg=document.getElementById("msg");msg.className="";msg.textContent="Saving…";
    var r=await api("PUT",{provider:p.value,model:m.value,key:k.value});
    if(r.status===200){cfg.current=r.body.current||null;cur=cfg.current;k.value="";msg.className="ok";msg.textContent="Saved.";sync();post(cur?{provider:cur.provider,model:cur.model}:null)}
    else{msg.className="err";msg.textContent=r.body.error||"Could not save."}
  };
  document.getElementById("rm").onclick=async function(){
    await api("DELETE");cfg.current=null;cur=null;p.value="wolf";sync();var msg=document.getElementById("msg");msg.className="ok";msg.textContent="Removed. Calls use the free Flisk Wolf again.";post(null)
  };
}
load();
</script></html>`;
}
