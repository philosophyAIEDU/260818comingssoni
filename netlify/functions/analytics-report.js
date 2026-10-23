/* 이용현황 보고서 — 운영진 화면 [이용현황] 탭이 부른다. 운영진 로그인 토큰이 있어야 한다.
 *   GET ?days=7|14|30|90 → _lib/analytics.js buildReport 결과
 * 한 번 열 때 읽는 양: 기간의 날짜 문서(최대 90) + 기록에 나온 멤버 명단 문서(멤버 수만큼) + 기간의 댓글. 5분 캐시. */
const admin = require('firebase-admin');
const { getDb } = require('./_lib/firebaseAdmin');
const { requireAdmin, json } = require('./_lib/adminAuth');
const { dateRange, buildReport, memberRefs } = require('./_lib/analytics');
require('./_lib/appLogic'); // global.CS(시즌 목록)

const reportCache = new Map(); // days → { at, report }
const reply = (report) => Object.assign(json(200, report), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method Not Allowed' });
  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;
  const days = [7, 14, 30, 90].includes(+(event.queryStringParameters || {}).days) ? +event.queryStringParameters.days : 14;
  // 같은 기간을 5분 안에 다시 열면 읽어 둔 보고서를 쓴다(Firebase 무료 요금제의 하루 읽기 한도 절약)
  const hit = reportCache.get(days);
  if (hit && Date.now() - hit.at < 5 * 60e3) return reply(hit.report);
  try {
    const db = getDb();
    const dates = dateRange(days);
    const [daily, comments] = await Promise.all([
      db.collection('analyticsDaily').where(admin.firestore.FieldPath.documentId(), '>=', dates[0]).where(admin.firestore.FieldPath.documentId(), '<=', dates[dates.length - 1]).get(),
      db.collection('contentComments').where('createdAt', '>=', new Date(Date.parse(dates[0] + 'T00:00:00+09:00')).toISOString()).get()
    ]);
    const docs = Object.fromEntries(daily.docs.map((d) => [d.id, d.data()]));
    // 멤버 이름: 기록에 나온 참여자만 명단에서 하나씩 찾는다(명단 전체를 읽지 않는다). 없는 ID는 보고서에서 빠진다.
    const names = {};
    const refs = memberRefs(docs).map((m) => {
      const season = global.CS.SEASONS.find((x) => x.id === m.season);
      return season ? { key: m.key, ref: db.collection(season.dataPrefix ? `${season.dataPrefix}_participants` : 'participants').doc(m.pid) } : null;
    }).filter(Boolean);
    if (refs.length) {
      const snaps = await db.getAll(...refs.map((r) => r.ref));
      snaps.forEach((snap, i) => { if (snap.exists && snap.data().nickname) names[refs[i].key] = snap.data().nickname; });
    }
    const report = buildReport(docs, dates, comments.docs.map((d) => ({ createdAt: d.data().createdAt })), names);
    reportCache.set(days, { at: Date.now(), report });
    return reply(report);
  } catch (err) {
    console.error('[analytics-report]', err);
    if (/RESOURCE_EXHAUSTED|Quota exceeded/i.test(String(err && err.message))) {
      return json(503, { error: 'Firebase 하루 무료 사용량을 다 써서 지금은 통계를 읽을 수 없어요. 사용량은 매일 한국 시간 오후 4시(11월 2일부터는 오후 5시)에 다시 채워집니다. 자주 이렇다면 Firebase 요금제를 Blaze(사용한 만큼 결제)로 바꿔 주세요.' });
    }
    return json(500, { error: '통계를 불러오지 못했습니다: ' + err.message });
  }
};
