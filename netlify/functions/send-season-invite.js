/* 💬 단톡방 초대 문자 예약 실행 — 10분마다(netlify.toml). 규칙은 _lib/seasonInvite.js.
 * 시즌 시작일 09:00~22:00(KST)에만 동작하고, 앱 명단에 있으면서 아직 초대 문자를 안 받은 사람에게 보낸다. */
const { getDb } = require('./_lib/firebaseAdmin');
require('./_lib/appLogic'); // global.CS 준비
const { sendSms } = require('./_lib/solapi');
const { runSeasonInvite } = require('./_lib/seasonInvite');

exports.handler = async () => {
  try {
    const r = await runSeasonInvite({ db: getDb(), CS: global.CS, sendSms });
    if (!r.skipped || r.skipped !== 'not-start-day') console.log('[send-season-invite]', JSON.stringify(r));
    return { statusCode: 200, body: JSON.stringify(r) };
  } catch (err) {
    console.error('[send-season-invite] 실패', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
