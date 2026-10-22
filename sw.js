// 앱 파일을 저장해 두고, 온라인이면 항상 새 버전을 먼저 가져옵니다.
const V='daeum-v31';
const CORE=['./','index.html','v4.css','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','fonts/Galmuri11.woff2','fonts/Galmuri11-Bold.woff2','fonts/GalmuriMono11.woff2'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET')return;
  const u=new URL(r.url);
  if(u.origin!==location.origin)return; // 폰트·OCR·AI 서버는 그대로 네트워크로
  e.respondWith(fetch(r.mode==='navigate'?r.url:r,{cache:'no-cache'}).then(res=>{const cp=res.clone();caches.open(V).then(c=>c.put(r,cp));return res}).catch(()=>caches.match(r).then(m=>m||caches.match('index.html'))));
});
