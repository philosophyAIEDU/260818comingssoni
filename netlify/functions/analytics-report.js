/* 이용 통계 보고서 — 운영진 화면 [이용 통계] 탭이 부른다. 운영진 로그인 토큰이 있어야 한다.
 *   GET ?days=7|14|30|90 → _lib/analytics.js buildReport 결과 */
const admin = require('firebase-admin');
const { getDb } = require('./_lib/firebaseAdmin');
const { requireAdmin, json } = require('./_lib/adminAuth');
const { dateRange, buildReport } = require('./_lib/analytics');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method Not Allowed' });
  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;
  const days = [7, 14, 30, 90].includes(+(event.queryStringParameters || {}).days) ? +event.queryStringParameters.days : 14;
  try {
    const db = getDb();
    const dates = dateRange(days);
    const [daily, comments] = await Promise.all([
      db.collection('analyticsDaily').where(admin.firestore.FieldPath.documentId(), '>=', dates[0]).where(admin.firestore.FieldPath.documentId(), '<=', dates[dates.length - 1]).get(),
      db.collection('contentComments').where('createdAt', '>=', new Date(Date.parse(dates[0] + 'T00:00:00+09:00')).toISOString()).get()
    ]);
    const docs = Object.fromEntries(daily.docs.map((d) => [d.id, d.data()]));
    const report = buildReport(docs, dates, comments.docs.map((d) => ({ createdAt: d.data().createdAt })));
    return Object.assign(json(200, report), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[analytics-report]', err);
    return json(500, { error: '통계를 불러오지 못했습니다: ' + err.message });
  }
};
