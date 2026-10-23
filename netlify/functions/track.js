/* 이용 통계 받기 — js/analytics.js가 45초마다, 그리고 화면을 떠날 때 그동안 쌓인 이용 시간을 보낸다.
 * 그날 문서(analyticsDaily/{KST 날짜})에 숫자만 더한다. 규칙·저장 형식은 _lib/analytics.js.
 *
 * 묶음에 참여자 ID·시즌(m)이 있으면 그 시즌 명단에서 실제로 있는지 확인하고, 있으면 명단의 인증 이름으로
 * 멤버별 이용량에도 더한다. 없는 ID면 이름 없이(기기 단위로만) 더한다. 확인한 이름은 잠시 기억해 읽기를 줄인다. */
const admin = require('firebase-admin');
const { getDb } = require('./_lib/firebaseAdmin');
const { sanitizeBeacon, toUpdate } = require('./_lib/analytics');
require('./_lib/appLogic'); // global.CS(시즌 목록)

const memberCache = new Map(); // `${season}/${pid}` → { at, member }
async function resolveMember(db, m) {
  if (!m) return null;
  const season = global.CS.SEASONS.find((s) => s.id === m.season);
  if (!season) return null;
  const key = `${m.season}/${m.pid}`;
  const hit = memberCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60e3) return hit.member;
  const col = season.dataPrefix ? `${season.dataPrefix}_participants` : 'participants';
  const snap = await db.collection(col).doc(m.pid).get();
  const member = snap.exists && snap.data().nickname ? { pid: m.pid, season: m.season, name: snap.data().nickname } : null;
  memberCache.set(key, { at: Date.now(), member });
  return member;
}

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
    const db = getDb();
    const member = await resolveMember(db, beacon.member).catch(() => null);
    const { date, data } = toUpdate(beacon, (v) => admin.firestore.FieldValue.increment(v), new Date(), member);
    await db.collection('analyticsDaily').doc(date).set(data, { merge: true });
    return { statusCode: 204, body: '' };
  } catch (err) {
    console.error('[track]', err);
    return { statusCode: 500, body: '' };
  }
};
