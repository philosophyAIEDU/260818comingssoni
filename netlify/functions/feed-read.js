/* 멤버 앱의 읽기 창구 — 명단과 그날 인증글 목록을 서버 스냅샷으로 나눠 준다(Firebase 무료 한도 절약).
 * 규칙·저장 형식은 _lib/feedSnapshot.js.
 *
 *   GET  ?kind=roster&season=s3                 → { at, rows: [명단(멤버 앱에 필요한 필드만)] }
 *   GET  ?kind=day&season=s3&date=2026-10-23    → { at, rows: [그날 인증글] }
 *   POST { season, roster?: true, dates?: [..] } → 운영진 로그인 토큰이 있을 때만: 그 스냅샷을 오래된 것으로 표시
 *
 * 응답은 CDN·브라우저가 잠깐 들고 있어도 되게 Cache-Control을 붙인다(오늘 글은 짧게, 지난 글은 길게). */
const { getDb } = require('./_lib/firebaseAdmin');
const { requireAdmin, json } = require('./_lib/adminAuth');
const { getRoster, getDay, invalidate } = require('./_lib/feedSnapshot');
const { U } = require('./_lib/appLogic');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const seasonOf = (id) => global.CS.SEASONS.find((s) => s.id === id) || null;

/** 시즌에 인증글이 있을 수 있는 날짜 범위: 시작일 ~ 종료(또는 소급 마감) 뒤 40일 */
function dateAllowed(season, date) {
  const cfg = global.CS.configFor(season.id);
  const last = U.addDays(cfg.retroUntil && cfg.retroUntil > cfg.endDate ? cfg.retroUntil : cfg.endDate, 40);
  return DATE.test(date) && date >= U.addDays(cfg.startDate, -7) && date <= last;
}

function cacheFor(kind, date, today) {
  if (kind === 'roster') return 'public, max-age=60, s-maxage=120, stale-while-revalidate=300';
  if (date >= today) return 'public, max-age=30, s-maxage=60, stale-while-revalidate=120';
  if (date === U.addDays(today, -1)) return 'public, max-age=300, s-maxage=600, stale-while-revalidate=900';
  return 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=43200';
}

exports.handler = async (event) => {
  const send = (statusCode, body, cache) => Object.assign(json(statusCode, body), {
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cache ? { 'Cache-Control': cache } : { 'Cache-Control': 'no-store' })
  });
  try {
    if (event.httpMethod === 'POST') {
      const auth = await requireAdmin(event);
      if (auth.error) return auth.error;
      let body; try { body = JSON.parse(event.body || '{}'); } catch { return send(400, { error: '요청 형식이 올바르지 않습니다.' }); }
      const season = seasonOf(body.season);
      if (!season) return send(400, { error: '알 수 없는 시즌입니다.' });
      const dates = (Array.isArray(body.dates) ? body.dates : []).filter((d) => dateAllowed(season, d)).slice(0, 40);
      return send(200, { invalidated: await invalidate(getDb(), season, { roster: !!body.roster, dates }) });
    }
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers: { Allow: 'GET, POST' }, body: '' };
    const q = event.queryStringParameters || {};
    const season = seasonOf(q.season);
    if (!season) return send(400, { error: '알 수 없는 시즌입니다.' });
    const db = getDb();
    if (q.kind === 'roster') {
      const r = await getRoster(db, season);
      return send(200, { at: r.at, rows: r.rows }, cacheFor('roster'));
    }
    if (q.kind === 'day') {
      if (!dateAllowed(season, q.date || '')) return send(200, { at: 0, rows: [] }, 'public, max-age=3600'); // 글이 있을 수 없는 날짜는 읽지 않는다
      const today = U.today();
      const r = await getDay(db, season, q.date, today, U.addDays);
      return send(200, { at: r.at, rows: r.rows }, cacheFor('day', q.date, today));
    }
    return send(400, { error: 'kind는 roster 또는 day입니다.' });
  } catch (err) {
    console.error('[feed-read]', err);
    return send(/RESOURCE_EXHAUSTED|Quota exceeded/i.test(String(err && err.message)) ? 503 : 500, { error: '목록을 불러오지 못했습니다.' });
  }
};
