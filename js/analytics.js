/* 이용 통계 — 화면을 실제로 보고 있는 시간, 영상이 재생된 시간, 칼럼을 읽은 시간을 모아
 * 45초마다 서버(/.netlify/functions/track)에 보낸다. 운영진 화면 [이용 통계]에서만 본다.
 *
 * - 기기마다 무작위 ID 하나(이 브라우저에 저장)로 방문 기기 수를 센다.
 * - 이 기기에서 인증한(또는 댓글을 남긴) 멤버를 기억해 참여자 ID·시즌을 함께 보낸다 → 서버가 명단에서 확인해
 *   인증 이름으로 멤버별 이용량을 쌓는다. 한 기기를 여럿이 쓰면 마지막으로 인증한 사람으로 센다.
 *   이전에 인증 화면에서 이름을 골라 둔 기기(시즌별 .me)는 그 사람으로 바로 잇는다.
 * - "보고 있는 시간": 창이 보이고, 최근 1분 안에 누르거나·스크롤하거나·타이핑했거나, 영상이 재생 중인 동안.
 * - 칼럼은 읽기 창이 열려 있는 동안의 "보고 있는 시간", 끝까지(90%) 내려 읽었는지.
 * - 영상은 창이 열려 있던 시간과 실제 재생 시간(유튜브 플레이어가 알려 주는 재생 상태)을 따로 센다.
 * 사용: <script src="js/analytics.js" data-page="index|content|feed">. content.js가 PMTrack.videoOpen·columnOpen 등을 부른다. */
(() => {
  const ENDPOINT = '/.netlify/functions/track';
  const DEVICE_KEY = 'personalmakers.analytics.device';
  const VISIT_KEY = 'personalmakers.analytics.lastSeen';
  const MEMBER_KEY = 'personalmakers.analytics.member';
  const IDLE_MS = 60 * 1000, VISIT_GAP_MS = 30 * 60 * 1000, FLUSH_MS = 45 * 1000;
  const page = (document.currentScript && document.currentScript.dataset.page) || 'index';
  const noop = { videoOpen() {}, videoClose() {}, videoPlaying() {}, columnOpen() {}, columnClose() {}, columnDepth() {}, setMember() {} };
  if (!window.fetch || /[?&]notrack\b/.test(location.search)) { window.PMTrack = noop; return; }

  const store = {
    get(k, s) { try { return (s ? sessionStorage : localStorage).getItem(k); } catch { return null; } },
    set(k, v, s) { try { (s ? sessionStorage : localStorage).setItem(k, v); } catch { /* 저장 불가 환경 */ } }
  };
  let device = store.get(DEVICE_KEY);
  if (!/^[a-f0-9]{32}$/.test(device || '')) {
    const bytes = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(bytes) : bytes.forEach((_, i) => { bytes[i] = Math.random() * 256; });
    device = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    store.set(DEVICE_KEY, device);
  }

  // 이 기기의 멤버 { p: 참여자 ID, s: 시즌 ID }
  const validMember = (m) => m && /^[\w-]{1,40}$/.test(String(m.p || '')) && /^[\w-]{1,10}$/.test(String(m.s || ''));
  let member = null;
  try { member = JSON.parse(store.get(MEMBER_KEY) || 'null'); } catch { member = null; }
  if (!validMember(member)) {
    member = null;
    const cfg = window.CS && window.CS.CONFIG;
    const me = cfg && store.get(`${cfg.storagePrefix}.me`);
    if (me && validMember({ p: me, s: cfg.seasonId })) { member = { p: me, s: cfg.seasonId }; store.set(MEMBER_KEY, JSON.stringify(member)); }
  }

  // 30분 넘게 쉬었다 오면 새 방문
  let visit = 0;
  const lastSeen = +store.get(VISIT_KEY) || 0;
  if (Date.now() - lastSeen > VISIT_GAP_MS) visit = 1;

  let pending = { active: 0, items: {} };
  let lastInput = Date.now(), lastTick = Date.now();
  let video = null;   // { key, playing }
  let column = null;  // { key, done }
  const item = (key, title) => {
    const it = pending.items[key] || (pending.items[key] = {});
    if (title) it.t = String(title).slice(0, 120);
    return it;
  };
  const add = (it, field, v) => { it[field] = (it[field] || 0) + v; };

  ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'].forEach((t) => addEventListener(t, () => { lastInput = Date.now(); }, { capture: true, passive: true }));
  let lastMove = 0;
  addEventListener('mousemove', () => { const now = Date.now(); if (now - lastMove > 5000) { lastMove = now; lastInput = now; } }, { passive: true });

  function tick() {
    const now = Date.now();
    const sec = Math.min(5, (now - lastTick) / 1000); // 잠들었다 깬 기기가 몇 시간을 한꺼번에 더하지 않게
    lastTick = now;
    const visible = document.visibilityState === 'visible';
    const playing = !!(video && video.playing);
    const attentive = visible && (now - lastInput < IDLE_MS || playing);
    if (attentive) {
      pending.active += sec;
      store.set(VISIT_KEY, String(now));
      if (column) add(item(column.key), 'read', sec);
      if (video) add(item(video.key), 'open', sec);
    }
    if (playing) add(item(video.key), 'play', sec);
  }

  function payload() {
    const items = {};
    for (const [k, v] of Object.entries(pending.items)) {
      const it = {};
      for (const [f, x] of Object.entries(v)) it[f] = f === 't' ? x : Math.round(x);
      if (it.n || it.open || it.play || it.read || it.done) items[k] = it;
    }
    const active = Math.round(pending.active);
    if (!visit && !active && !Object.keys(items).length) return null;
    return Object.assign({ d: device, p: page, visit, active, items }, member ? { m: { p: member.p, s: member.s } } : {});
  }
  function reset(sent) {
    visit = 0;
    pending.active -= sent.active;
    for (const [k, v] of Object.entries(sent.items)) {
      const it = pending.items[k];
      if (!it) continue;
      for (const f of ['n', 'open', 'play', 'read', 'done']) if (v[f]) it[f] = (it[f] || 0) - v[f];
    }
    // 다 보낸 항목은 지운다(제목만 남은 빈 항목이 쌓이지 않게)
    for (const [k, it] of Object.entries(pending.items)) if (!['n', 'open', 'play', 'read', 'done'].some((f) => (it[f] || 0) >= 1)) delete pending.items[k];
  }
  let sending = false;
  async function flush(leaving) {
    tick();
    const body = payload();
    if (!body || sending) return;
    const text = JSON.stringify(body);
    if (leaving && navigator.sendBeacon) {
      if (navigator.sendBeacon(ENDPOINT, new Blob([text], { type: 'application/json' }))) reset(body);
      return;
    }
    sending = true;
    try {
      const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text, keepalive: true });
      if (r.ok || r.status === 204) reset(body); // 실패하면 다음에 함께 보낸다
    } catch { /* 오프라인: 다음 기회에 */ } finally { sending = false; }
  }

  setInterval(tick, 1000);
  setInterval(() => flush(false), FLUSH_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); else { lastInput = Date.now(); lastTick = Date.now(); } });
  addEventListener('pagehide', () => flush(true));

  window.PMTrack = {
    videoOpen(id, title) { tick(); video = { key: 'v:' + id, playing: false }; add(item(video.key, title), 'n', 1); },
    videoPlaying(on) { tick(); if (video) video.playing = !!on; },
    videoClose() { tick(); video = null; },
    columnOpen(id, title) { tick(); column = { key: 'c:' + id, done: false }; add(item(column.key, title), 'n', 1); },
    columnDepth(ratio) { if (column && !column.done && ratio >= 0.9) { column.done = true; add(item(column.key), 'done', 1); } },
    columnClose() { tick(); column = null; },
    /** 인증·댓글로 누구인지 확인됐을 때. 그 전까지 쌓인 시간은 이전 사람(또는 익명)으로 먼저 보낸다. */
    setMember(pid, season) {
      const next = { p: String(pid || ''), s: String(season || '') };
      if (!validMember(next) || (member && member.p === next.p && member.s === next.s)) return;
      flush(false).finally(() => { member = next; store.set(MEMBER_KEY, JSON.stringify(member)); });
    },
    _flush: flush // 테스트용
  };
})();
