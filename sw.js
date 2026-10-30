const V='keytar-live-v1';
const FILES=['./','./index.html','./app.js','./style.css','./manifest.json','./icons/icon-192.png','./icons/icon-512.png','./icons/icon-maskable-512.png','./vendor/react.production.min.js','./vendor/react-dom.production.min.js','./vendor/htm.umd.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==location.origin)return;
  e.respondWith(caches.match(r,{ignoreSearch:true}).then(hit=>hit||fetch(r).then(res=>{const c=res.clone();caches.open(V).then(k=>k.put(r,c));return res}).catch(()=>r.mode==='navigate'?caches.match('./index.html'):Response.error())));
});
