/* 이용 통계 받기 — js/analytics.js가 5분마다, 그리고 화면을 떠날 때 그동안 쌓인 이용 시간을 보낸다.
 * 그날 문서(analyticsDaily/{KST 날짜}) 하나에 숫자만 더한다(쓰기 1번, 읽기 0번). 규칙·저장 형식은 _lib/analytics.js.
 * 참여자 ID가 오면 멤버별 시간에도 더하고, 이름은 운영진이 보고서를 열 때 명단에서 찾는다. */
const admin = require('firebase-admin');
const { getDb } = require('./_lib/firebaseAdmin');
const { sanitizeBeacon, toUpdate } = require('./_lib/analytics');
require('./_lib/appLogic'); // global.CS(시즌 목록)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: { Allow: 'POST' }, body: '' };
  if ((event.body || '').length > 8000) return { statusCode: 413, body: '' };
  let beacon;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body;
    beacon = sanitizeBeacon(JSON.parse(raw || '{}'));
  } catch { beacon = null; }
  if (!beacon) return { statusCode: 204, body: '' }; // 이상한 묶음은 조용히 버린다
  try {
    const seasons = global.CS.SEASONS.map((s) => s.id);
    const { date, data } = toUpdate(beacon, (v) => admin.firestore.FieldValue.increment(v), new Date(), seasons);
    await getDb().collection('analyticsDaily').doc(date).set(data, { merge: true });
    return { statusCode: 204, body: '' };
  } catch (err) {
    console.error('[track]', err);
    return { statusCode: 500, body: '' };
  }
};
