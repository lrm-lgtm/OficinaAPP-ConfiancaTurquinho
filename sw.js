const CACHE="oficina-v12-6";
const STATIC_ASSETS=[
  "./styles.css?v=12.6",
  "./app.js?v=12.6",
  "./manifest.webmanifest",
  "./icon.svg"
];

self.addEventListener("install",event=>{
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache=>cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET") return;

  const url=new URL(event.request.url);
  const isNavigation=event.request.mode==="navigate" || event.request.destination==="document";

  if(isNavigation){
    event.respondWith(
      fetch(event.request,{cache:"no-store"})
        .then(response=>{
          const copy=response.clone();
          caches.open(CACHE).then(cache=>cache.put("./index.html",copy));
          return response;
        })
        .catch(()=>caches.match("./index.html"))
    );
    return;
  }

  if(url.origin===self.location.origin){
    event.respondWith(
      fetch(event.request)
        .then(response=>{
          const copy=response.clone();
          caches.open(CACHE).then(cache=>cache.put(event.request,copy));
          return response;
        })
        .catch(()=>caches.match(event.request))
    );
  }
});