/* 홈 화면 설치용 서비스 워커.
 * 크롬·삼성 인터넷·엣지는 서비스 워커가 있는 사이트에서만 [웹앱 설치] 한 번에 설치 창을 띄워 준다(js/install.js).
 * 화면·데이터는 저장해 두지 않는다 — 늘 서버에서 새로 받아 배포 직후에도 옛 화면이 남지 않는다.
 * 인터넷이 끊겼을 때만 미리 받아 둔 안내 페이지(offline.html)를 보여 준다. */
const OFFLINE = '/offline.html';
const CACHE = 'pm-offline-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(new Request(OFFLINE, { cache: 'reload' }))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return; // 그림·스크립트·함수 요청은 브라우저가 평소대로
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
