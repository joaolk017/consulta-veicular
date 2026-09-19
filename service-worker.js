const CACHE='cv360-shell-v2';
const SHELL=['/','/manifest.webmanifest','/pwa-icon.svg','/file_000000009280820e99defdb780777d3a.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(u.origin!==location.origin||u.pathname.startsWith('/api/'))return;if(r.mode==='navigate'){e.respondWith(fetch(r).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put('/',copy));return res}).catch(()=>caches.match('/')));return}e.respondWith(caches.match(r).then(hit=>hit||fetch(r).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(r,copy))}return res})))})};
