/* 이용 통계 받기 — js/analytics.js가 30~60초마다, 그리고 화면을 떠날 때 그동안 쌓인 이용 시간을 보낸다.
 * 익명 기기 단위로 그날 문서(analyticsDaily/{KST 날짜})에 숫자만 더한다. 규칙·저장 형식은 _lib/analytics.js. */
const admin = require('firebase-admin');
const { getDb } = require('./_lib/firebaseAdmin');
const { sanitizeBeacon, toUpdate } = require('./_lib/analytics');

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
    const { date, data } = toUpdate(beacon, (v) => admin.firestore.FieldValue.increment(v));
    await getDb().collection('analyticsDaily').doc(date).set(data, { merge: true });
    return { statusCode: 204, body: '' };
  } catch (err) {
    console.error('[track]', err);
    return { statusCode: 500, body: '' };
  }
};
