/* 운영진 화면 [명단 관리] → 「명단 자동 반영」. 운영진 로그인 필요.
 *   GET  ?date=YYYY-MM-DD   설정 + 그 기수 반영 기록 + 미리보기(쓰지 않음). date 없으면 다음 기수 시작일
 *   POST { action: 'settings', settings }   예외 참여자·결제자 이름·초대 문자 켜기/끄기 저장
 *   POST { action: 'run', date }            지금 반영(00:30 예약과 같은 일을 손으로) */
const { getDb } = require('./_lib/firebaseAdmin');
const { requireAdmin, json } = require('./_lib/adminAuth');
const RA = require('./_lib/rosterAuto');

exports.handler = async (event) => {
  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;
  const db = getDb();
  try {
    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {};
      const date = /^\d{4}-\d{2}-\d{2}$/.test(q.date || '') ? q.date : RA.nextCohortDate(Date.now());
      const settings = await RA.loadSettings(db);
      const season = date && RA.seasonStartingOn(date);
      const runSnap = season ? await db.collection('rosterAuto').doc(season.id).get() : null;
      let preview = null;
      if (season) {
        try { preview = await RA.syncRoster({ db, C: date, write: false }); }
        catch (e) { preview = { cohort: date, stopped: e.message }; }
      }
      return json(200, { date, settings, run: runSnap && runSnap.exists ? runSnap.data() : null, preview });
    }
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      if (body.action === 'settings') return json(200, { settings: await RA.saveSettings(db, body.settings, auth.email) });
      if (body.action === 'run') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) return json(400, { error: '날짜(YYYY-MM-DD)가 필요합니다.' });
        return json(200, await RA.syncRoster({ db, C: body.date, write: true }));
      }
      return json(400, { error: 'action은 settings 또는 run' });
    }
    return json(405, { error: 'Method Not Allowed' });
  } catch (err) {
    console.error('[roster-auto]', err);
    return json(500, { error: err.message });
  }
};
