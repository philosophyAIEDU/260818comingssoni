/* 멤버 앱의 읽기 창구(Firebase 무료 한도 절약) — 명단과 그날 인증글 목록을 Firestore에서 문서마다 읽지 않고,
 * 서버가 모두에게 나눠 주는 스냅샷(/.netlify/functions/feed-read)으로 받는다. 서버 쪽 설명은 netlify/functions/_lib/feedSnapshot.js.
 *
 * - 멤버 화면(js/app.js·js/feed-all.js)만 켠다: CS.FEED_API = true. 운영진 화면은 늘 Firestore에서 바로 읽는다(방금 고친 걸 바로 봐야 해서).
 * - 목록을 못 받으면(네트워크·서버 오류) null/예외로 알려서 store-firebase.js가 예전처럼 Firestore에서 직접 읽게 한다.
 * - 내 글·내 추천은 서버 스냅샷이 아직 따라오기 전에도 화면에 바로 맞게, 최근에 내가 쓴 글을 목록에 덧씌운다.
 *   스냅샷이 내 쓰기보다 나중에 만들어졌으면(= 이미 들어 있으면) 덧씌움을 거둔다. */
window.CS = window.CS || {};

CS.FeedClient = (function () {
  const ENDPOINT = '/.netlify/functions/feed-read';
  const KEEP_MS = 24 * 3600 * 1000;
  const PARALLEL = 6;
  const SKEW_MS = 2 * 60 * 1000;
  const recentKey = () => `${CS.CONFIG.storagePrefix}.recentWrites.v1`;

  const enabled = () => CS.FEED_API === true && typeof fetch === 'function';

  /* ── 최근에 내가 쓴 글(덧씌움) ── */
  function loadRecent() {
    try {
      const all = JSON.parse(localStorage.getItem(recentKey()) || '{}');
      const out = {};
      for (const [id, v] of Object.entries(all && typeof all === 'object' ? all : {})) {
        if (v && v.sub && Date.now() - v.at < KEEP_MS) out[id] = v;
      }
      return out;
    } catch (e) { return {}; }
  }
  function saveRecent(map) {
    try { localStorage.setItem(recentKey(), JSON.stringify(map)); } catch (e) { /* 저장 불가 환경 */ }
  }
  /** 방금 내가 저장·추천한 글(전체 문서)을 기억해 둔다 */
  function remember(sub) {
    if (!sub || !sub.id) return;
    const map = loadRecent();
    map[sub.id] = { sub: JSON.parse(JSON.stringify(sub)), at: Date.now() };
    saveRecent(map);
  }
  /** 서버 목록(rows, 만든 시각 at)에 내 쓰기를 덧씌운다. match(sub): 이 목록에 들어갈 글인가 */
  function overlay(rows, match, at) {
    const recent = loadRecent();
    const ids = Object.keys(recent);
    if (!ids.length) return rows;
    const byId = new Map(rows.map((r) => [r.id, r]));
    let dirty = false;
    for (const id of ids) {
      const { sub, at: wroteAt } = recent[id];
      if (!match(sub)) continue;
      // 스냅샷이 내 쓰기보다 한참 뒤(2분 넘게, 기기·서버 시계 차이를 감안)에 만들어졌으면 이미 들어 있다 → 덧씌움을 거둔다
      if (at && at > wroteAt + SKEW_MS) { delete recent[id]; dirty = true; continue; }
      byId.set(id, Object.assign({}, sub));
    }
    if (dirty) saveRecent(recent);
    return [...byId.values()];
  }

  /* ── 서버에서 받기 ── */
  async function get(params) {
    const res = await fetch(`${ENDPOINT}?${new URLSearchParams(params)}`);
    if (!res.ok) throw new Error(`feed-read ${res.status}`);
    const body = await res.json();
    if (!body || !Array.isArray(body.rows)) throw new Error('feed-read: 형식이 다릅니다');
    return body;
  }
  const seasonId = () => CS.CONFIG.seasonId;

  async function roster() {
    const body = await get({ kind: 'roster', season: seasonId() });
    return body.rows.slice().sort((a, b) => String(a.nickname).localeCompare(String(b.nickname), 'ko'));
  }
  async function dayRows(date) {
    const body = await get({ kind: 'day', season: seasonId(), date });
    return overlay(body.rows, (s) => s.date === date, body.at);
  }

  /** 필터에 맞는 날짜 목록. 글이 있을 수 없는 날짜는 넣지 않는다(서버와 같은 범위: 시작일 ~ 종료·소급 마감 뒤 40일, 오늘까지). */
  function datesFor(filter) {
    const U = CS.U, cfg = CS.CONFIG;
    const lastPossible = U.addDays(cfg.retroUntil && cfg.retroUntil > cfg.endDate ? cfg.retroUntil : cfg.endDate, 40);
    const today = U.today();
    let from = filter.date || filter.from || cfg.startDate;
    let to = filter.date || filter.to || today;
    // 전체·구간 요청은 시즌 시작일부터. 날짜를 콕 집은 요청은 서버처럼 시작 7일 전까지 받는다(연습 기간 글).
    const floor = filter.date ? U.addDays(cfg.startDate, -7) : cfg.startDate;
    if (from < floor) from = floor;
    if (to > today) to = today;
    if (to > lastPossible) to = lastPossible;
    return from <= to ? U.dateRange(from, to) : [];
  }

  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
    }));
    return out;
  }

  /** Store.listSubmissions의 필터(date·from·to·participantId)를 서버 목록으로 채운다.
   *  참여자+날짜 조합은 저장 직전 "이미 낸 글이 있나" 확인(getSubmission)이라, 새 글이 중복으로 생기지 않게 늘 Firestore에서 바로 읽는다(null). */
  async function submissions(filter) {
    const f = filter || {};
    if (f.participantId && f.date) return null;
    const dates = datesFor(f);
    const days = await mapLimit(dates, PARALLEL, dayRows);
    let rows = days.flat();
    if (f.participantId) rows = rows.filter((r) => r.participantId === f.participantId);
    return rows.sort((a, b) => (a.date === b.date
      ? String(a.createdAt).localeCompare(String(b.createdAt))
      : a.date.localeCompare(b.date)));
  }

  return { enabled, roster, submissions, remember, overlay, datesFor, _loadRecent: loadRecent };
})();
