/* 🚪 이번 기수 명단 자동 입력 (래피드 결제 서버 → 앱). 규칙은 _lib/rosterImport.js.
 *
 *   POST /.netlify/functions/roster-import
 *     Authorization: Bearer <ROSTER_IMPORT_TOKEN>   (래피드 서버 Vercel 환경 변수. 앱에는 SHA-256만 — CS.COMMON.rosterImportSha256)
 *     { "season": "s4"(생략 가능), "rows": [{ "name", "email", "phone", "status": "paid"|"due" }], "dryRun": false }
 *   GET  (같은 인증) → 지금 시즌 명단 인원·초대 문자 현황
 */
const { getDb } = require('./_lib/firebaseAdmin');
require('./_lib/appLogic'); // global.CS 준비
const { importRoster, pickTargetSeason, tokenOk } = require('./_lib/rosterImport');

const json = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  const CS = global.CS;
  if (!tokenOk(event, CS.COMMON.rosterImportSha256)) return json(401, { error: 'unauthorized' });
  const today = CS.seasonNowKST().slice(0, 10);
  let body = {};
  if (event.httpMethod === 'POST') {
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'JSON 형식이 아닙니다.' }); }
  } else if (event.httpMethod !== 'GET') return json(405, { error: 'Method Not Allowed' });
  const cfg = pickTargetSeason(CS, body.season || (event.queryStringParameters || {}).season, today);
  if (!cfg) return json(400, { error: '알 수 없는 시즌: ' + body.season });
  const db = getDb();
  try {
    if (event.httpMethod === 'GET') {
      const snap = await db.collection(cfg.dataPrefix ? `${cfg.dataPrefix}_participants` : 'participants').get();
      const ps = snap.docs.map((d) => d.data()).filter((p) => p.status !== 'out');
      return json(200, {
        season: cfg.seasonId, book: cfg.book && cfg.book.name, startDate: cfg.startDate,
        participants: ps.length, withPhone: ps.filter((p) => p.phone).length,
        invited: ps.filter((p) => p.invitedAt).length, inviteUrlSet: !!(cfg.kakaoInvite && cfg.kakaoInvite.url)
      });
    }
    const r = await importRoster(db, CS, cfg, body.rows, { dryRun: !!body.dryRun });
    console.log(`[roster-import] ${r.season} 받음 ${r.received} · 추가 ${r.added.length} · 보완 ${r.filled.length} · 건너뜀 ${r.skipped.length}${r.dryRun ? ' (미리보기)' : ''}`);
    return json(200, r);
  } catch (err) {
    console.error('[roster-import] 실패', err);
    return json(500, { error: err.message });
  }
};
