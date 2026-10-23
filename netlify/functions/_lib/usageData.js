/* 이용현황 보고서에 쓸 자료를 Firestore에서 가져온다 — 읽기를 아끼려고 서버 인스턴스에 기억해 둔다(Firebase 무료 한도).
 *  - 하루 이용 기록(analyticsDaily/{날짜}): 이미 지난 날은 더 안 바뀌어서 오래 기억한다(어제는 늦게 도착한 기록이 있을 수 있어 30분, 오늘은 5분).
 *    그래서 90일 보고서를 처음 열 때만 90건을 읽고, 그 뒤로는 오늘·어제 몇 건만 새로 읽는다.
 *  - 멤버 이름: 한 번 찾은 이름은 6시간(못 찾은 건 30분) 기억한다.
 *  - 댓글: 최근 90일치를 한 번 읽어 10분 기억하고, 기간별로는 거기서 걸러 쓴다. */
const admin = require('firebase-admin');

const MIN = 60 * 1000;
const DAY_TTL = { today: 5 * MIN, yesterday: 30 * MIN, older: 24 * 60 * MIN };
const NAME_TTL = 6 * 60 * MIN, MISSING_NAME_TTL = 30 * MIN, COMMENT_TTL = 10 * MIN;
const dayCache = new Map();   // 날짜 → { at, data|null }
const nameCache = new Map();  // 멤버키 → { at, name|null }
let commentCache = null;      // { at, since, rows: [{ createdAt }] }

const dayTtl = (date, today, addDays) => (date >= today ? DAY_TTL.today : date === addDays(today, -1) ? DAY_TTL.yesterday : DAY_TTL.older);

/** dates 안에서 기억해 둔 게 없거나 오래된 날짜만 읽는다. 많으면 범위 질의 한 번, 적으면 문서를 콕 집어서. */
async function loadDays(db, dates, today, addDays, now = Date.now(), force = []) {
  const need = dates.filter((d) => { const c = dayCache.get(d); return force.includes(d) || !c || now - c.at >= dayTtl(d, today, addDays); });
  if (need.length) {
    const col = db.collection('analyticsDaily');
    let found = new Map();
    if (need.length <= 8) {
      const snaps = await db.getAll(...need.map((d) => col.doc(d)));
      snaps.forEach((s, i) => { if (s.exists) found.set(need[i], s.data()); });
    } else {
      const snap = await col.where(admin.firestore.FieldPath.documentId(), '>=', need[0]).where(admin.firestore.FieldPath.documentId(), '<=', need[need.length - 1]).get();
      snap.docs.forEach((d) => found.set(d.id, d.data()));
    }
    for (const d of need) dayCache.set(d, { at: now, data: found.get(d) || null });
  }
  return Object.fromEntries(dates.filter((d) => dayCache.get(d).data).map((d) => [d, dayCache.get(d).data]));
}

/** refs: [{ key, season, pid }] → { 멤버키: 이름 }. 명단에 없는 ID는 빠진다. */
async function loadNames(db, refs, now = Date.now()) {
  const seasonOf = (id) => global.CS.SEASONS.find((x) => x.id === id);
  const need = refs.filter((m) => { const c = nameCache.get(m.key); return seasonOf(m.season) && (!c || now - c.at >= (c.name ? NAME_TTL : MISSING_NAME_TTL)); });
  if (need.length) {
    const docRefs = need.map((m) => { const s = seasonOf(m.season); return db.collection(s.dataPrefix ? `${s.dataPrefix}_participants` : 'participants').doc(m.pid); });
    const snaps = await db.getAll(...docRefs);
    snaps.forEach((snap, i) => nameCache.set(need[i].key, { at: now, name: snap.exists && snap.data().nickname ? snap.data().nickname : null }));
  }
  const names = {};
  for (const m of refs) { const c = nameCache.get(m.key); if (c && c.name) names[m.key] = c.name; }
  return names;
}

/** 최근 90일치 댓글(시각만)을 읽어 두고 sinceISO 이후만 돌려준다 */
async function loadComments(db, sinceISO, wideSinceISO, now = Date.now()) {
  if (!commentCache || now - commentCache.at >= COMMENT_TTL || commentCache.since > sinceISO) {
    const snap = await db.collection('contentComments').where('createdAt', '>=', wideSinceISO).get();
    commentCache = { at: now, since: wideSinceISO, rows: snap.docs.map((d) => ({ createdAt: d.data().createdAt })) };
  }
  return commentCache.rows.filter((c) => c.createdAt >= sinceISO);
}

const _reset = () => { dayCache.clear(); nameCache.clear(); commentCache = null; };
module.exports = { loadDays, loadNames, loadComments, _reset };
