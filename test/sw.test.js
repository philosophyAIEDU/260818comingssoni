// sw.js: 설치 때 안내 페이지만 저장, 화면 이동만 맡아 늘 서버에서 받고, 끊기면 안내 페이지. 그 밖의 요청은 건드리지 않는다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const listeners = {};
const cache = new Map();
let online = true;
const sandbox = {
  self: { addEventListener: (t, f) => { listeners[t] = f; }, skipWaiting: () => Promise.resolve(), clients: { claim: () => Promise.resolve() } },
  caches: {
    open: async () => ({ add: async (req) => { cache.set(req.url, 'OFFLINE PAGE'); } }),
    keys: async () => ['pm-offline-v1', 'old-cache'],
    delete: async (k) => { sandbox.deleted.push(k); return true; },
    match: async (url) => cache.get(url)
  },
  Request: class { constructor(url, opts) { this.url = url; this.opts = opts; } },
  fetch: async (req) => { if (!online) throw new TypeError('Failed to fetch'); return 'FRESH ' + req.url; },
  deleted: []
};
vm.runInNewContext(fs.readFileSync(require.resolve('../sw.js'), 'utf8'), sandbox);
(async () => {
  let waited;
  listeners.install({ waitUntil: (p) => { waited = p; } }); await waited;
  assert.deepEqual([...cache.keys()], ['/offline.html'], '설치 때 안내 페이지만');
  listeners.activate({ waitUntil: (p) => { waited = p; } }); await waited;
  assert.deepEqual(sandbox.deleted, ['old-cache'], '예전 저장본 정리');
  const nav = (url) => { let res = null; listeners.fetch({ request: { mode: 'navigate', url }, respondWith: (p) => { res = p; } }); return res; };
  assert.equal(await nav('/index.html'), 'FRESH /index.html', '온라인이면 늘 새로');
  online = false;
  assert.equal(await nav('/index.html'), 'OFFLINE PAGE', '끊기면 안내 페이지');
  let touched = false;
  listeners.fetch({ request: { mode: 'cors', url: '/.netlify/functions/track' }, respondWith: () => { touched = true; } });
  listeners.fetch({ request: { mode: 'no-cors', url: '/css/app.css' }, respondWith: () => { touched = true; } });
  assert.equal(touched, false, '화면 이동 말고는 건드리지 않음');
  console.log('sw.js: 안내 페이지만 저장·늘 새로 받기·끊기면 안내·다른 요청은 그대로 통과');
})().catch((e) => { console.error(e); process.exit(1); });
