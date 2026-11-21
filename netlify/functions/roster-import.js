/* 🚪 이번 기수 명단 자동 입력 (래피드 결제 서버 → 앱). 규칙은 _lib/rosterImport.js.
 *
 *   POST /.netlify/functions/roster-import
 *     Authorization: Bearer <ROSTER_IMPORT_TOKEN>   (래피드 서버 Vercel 환경 변수. 앱에는 SHA-256만 — CS.COMMON.rosterImportSha256)
 *     { "season": "s4"(생략 가능), "rows": [{ "name", "email", "phone", "status": "paid"|"due"|"out" }], "dryRun": false, "final": false }
 *     out = 시작 전 결제 취소·종료(래피드로 들어온 사람만 아웃). graceEnd: true = 결제 실패 확정(시작일+3일까지, 인증 기록 없으면 명단에서 지움). 결제자 이름·예외 참여자는 _lib/rosterAuto.js
 *   GET  (같은 인증) → 지금 시즌 명단 인원·초대 문자 현황
 *   GET ?list=1 → 이번 시즌 명단 + 앞 시즌 명단 + 앞 시즌엔 있었는데 이번에 없는 사람(dropped) — 강퇴 대상 확인용
 */
const { getDb } = require('./_lib/firebaseAdmin');
require('./_lib/appLogic'); // global.CS 준비
const { importRoster, pickTargetSeason, tokenOk, rosterLists } = require('./_lib/rosterImport');
const RA = require('./_lib/rosterAuto');
const feedSnapshot = require('./_lib/feedSnapshot');

const json = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  const CS = global.CS;
  if (!tokenOk(event, CS.COMMON.rosterImportSha256)) return json(401, { error: 'unauthorized' });
  const today = CS.seasonNowKST().slice(0, 10);
  let body = {};
  if (event.httpMethod === 'POST') {
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'JSON 형식이 아닙니다.' }); }
  } else if (event.httpMethod !== 'GET') return json(405, { error: 'Method Not Allowed' });
  // cohort(기수 시작일)를 주면 그날 시작하는 시즌에만 넣는다 — 다음 달 시즌 설정이 아직 없을 때 지난 시즌에 잘못 들어가지 않게
  const cohort = body.cohort || (event.queryStringParameters || {}).cohort;
  let cfg;
  if (cohort) {
    const s = CS.SEASONS.find((x) => x.startDate === cohort);
    if (!s) return json(409, { error: 'no-season', message: `${cohort}에 시작하는 시즌이 앱(js/config.js)에 아직 없습니다` });
    cfg = CS.configFor(s.id);
  } else cfg = pickTargetSeason(CS, body.season || (event.queryStringParameters || {}).season, today);
  if (!cfg) return json(400, { error: '알 수 없는 시즌: ' + body.season });
  const db = getDb();
  try {
    if (event.httpMethod === 'GET') {
      const snap = await db.collection(cfg.dataPrefix ? `${cfg.dataPrefix}_participants` : 'participants').get();
      const ps = snap.docs.map((d) => d.data()).filter((p) => p.status !== 'out');
      if ((event.queryStringParameters || {}).list) return json(200, await rosterLists(db, CS, cfg, ps));
      return json(200, {
        season: cfg.seasonId, book: cfg.book && cfg.book.name, startDate: cfg.startDate,
        participants: ps.length, withPhone: ps.filter((p) => p.phone).length,
        invited: ps.filter((p) => p.invitedAt).length, inviteUrlSet: !!(cfg.kakaoInvite && cfg.kakaoInvite.url)
      });
    }
    // 결제자 → 참여자 이름 · 예외 참여자 · 시작 전 환불(아웃) — _lib/rosterAuto.js
    const now = new Date().toISOString();
    const dryRun = !!body.dryRun;
    const settings = await RA.loadSettings(db);
    const all = Array.isArray(body.rows) ? body.rows : [];
    const inRows = RA.applyAliases(all.filter((x) => x && x.status !== 'out'), settings);
    const outRows = all.filter((x) => x && x.status === 'out');
    const have = new Set(inRows.map((x) => String(x.name || '').replace(/\s+/g, '')));
    const extras = settings.extras.filter((x) => !have.has(x.name.replace(/\s+/g, '')));
    const r = await importRoster(db, CS, cfg, inRows.concat(extras.filter((x) => x.email || x.phone).map((x) => ({ ...x, status: 'paid' }))), { dryRun, now });
    r.extrasAdded = await RA.addNameOnly(db, cfg, extras.filter((x) => !x.email && !x.phone), { dryRun, now });
    r.outed = await RA.markOut(db, cfg, outRows, inRows, { dryRun, today, now, graceEnd: !!body.graceEnd });
    r.renamed = inRows.filter((x) => x.payer).map((x) => ({ name: x.name, payer: x.payer }));
    if (!dryRun && (r.outed.length || r.extrasAdded.length)) await feedSnapshot.invalidate(db, { id: cfg.seasonId }, { roster: true });
    r.total += r.extrasAdded.length;
    if (!dryRun) await RA.logRun(db, cfg, r, { final: !!body.final, now });
    console.log(`[roster-import] ${r.season} 받음 ${r.received} · 추가 ${r.added.length + r.extrasAdded.length} · 보완 ${r.filled.length} · 아웃 ${r.outed.length} · 건너뜀 ${r.skipped.length}${dryRun ? ' (미리보기)' : ''}`);
    return json(200, r);
  } catch (err) {
    console.error('[roster-import] 실패', err);
    return json(500, { error: err.message });
  }
};
