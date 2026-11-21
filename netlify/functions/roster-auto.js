/* 운영진 화면 [명단 관리] → 「명단 자동 반영」. 운영진 로그인 필요.
 *   GET                                      설정 + 시즌별 자동 반영 기록(rosterAuto/{시즌})
 *   POST { action: 'settings', settings }    예외 참여자·결제자 이름 저장
 * 실제 반영은 문자 서버(latpeed-notify)가 roster-import로 보낼 때 일어난다(_lib/rosterAuto.js). */
require('./_lib/appLogic');
const { getDb } = require('./_lib/firebaseAdmin');
const { requireAdmin, json } = require('./_lib/adminAuth');
const RA = require('./_lib/rosterAuto');

exports.handler = async (event) => {
  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;
  const db = getDb();
  const CS = global.CS;
  try {
    if (event.httpMethod === 'GET') {
      const settings = await RA.loadSettings(db);
      const today = CS.seasonNowKST().slice(0, 10);
      const ids = CS.SEASONS.filter((s) => s.startDate >= CS.SEASONS[Math.max(0, CS.SEASONS.length - 3)].startDate).map((s) => s.id);
      const logs = [];
      for (const id of ids) {
        const snap = await db.collection(RA.COL).doc(id).get();
        if (snap.exists) logs.push(snap.data());
      }
      return json(200, { today, settings, logs });
    }
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      if (body.action === 'settings') return json(200, { settings: await RA.saveSettings(db, body.settings, auth.email) });
      return json(400, { error: 'action은 settings' });
    }
    return json(405, { error: 'Method Not Allowed' });
  } catch (err) {
    console.error('[roster-auto]', err);
    return json(500, { error: err.message });
  }
};
