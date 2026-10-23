/* 이용현황 보고서 — 운영진 화면 [이용현황] 탭이 부른다. 운영진 로그인 토큰이 있어야 한다.
 *   GET ?days=7|14|30|90 → _lib/analytics.js buildReport 결과
 * 읽는 양(Firebase 무료 한도): 처음 90일을 열 때만 날짜 문서 최대 90 + 멤버 이름 + 댓글을 읽고, 그 뒤로는 서버가 기억해 두어
 * 오늘·어제 몇 건만 새로 읽는다(_lib/usageData.js). 같은 기간 보고서는 5분 캐시. */
const { getDb } = require('./_lib/firebaseAdmin');
const { requireAdmin, json } = require('./_lib/adminAuth');
const { dateRange, buildReport, memberRefs } = require('./_lib/analytics');
const { loadDays, loadNames, loadComments } = require('./_lib/usageData');
const { U } = require('./_lib/appLogic'); // global.CS(시즌 목록)도 여기서 준비된다

const reportCache = new Map(); // days → { at, report }
const reply = (report) => Object.assign(json(200, report), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method Not Allowed' });
  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;
  const days = [7, 14, 30, 90].includes(+(event.queryStringParameters || {}).days) ? +event.queryStringParameters.days : 14;
  // 같은 기간을 5분 안에 다시 열면 읽어 둔 보고서를 쓴다(Firebase 무료 요금제의 하루 읽기 한도 절약). fresh=1([새로고침])만 오늘·어제를 새로 읽는다.
  const fresh = (event.queryStringParameters || {}).fresh === '1';
  const hit = reportCache.get(days);
  if (!fresh && hit && Date.now() - hit.at < 5 * 60e3) return reply(hit.report);
  try {
    const db = getDb();
    const dates = dateRange(days);
    const today = dates[dates.length - 1];
    const startISO = (n) => new Date(Date.parse(dateRange(n)[0] + 'T00:00:00+09:00')).toISOString();
    const docs = await loadDays(db, dates, today, U.addDays, Date.now(), fresh ? [today, U.addDays(today, -1)] : []);
    // 멤버 이름: 기록에 나온 참여자만 명단에서 하나씩 찾는다(명단 전체를 읽지 않는다). 없는 ID는 보고서에서 빠진다.
    const names = await loadNames(db, memberRefs(docs));
    const comments = await loadComments(db, startISO(days), startISO(90));
    const report = buildReport(docs, dates, comments, names);
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
exports._reportCache = reportCache; // 테스트용
