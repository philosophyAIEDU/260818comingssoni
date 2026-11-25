/* 🎁 대기 중 정리본 — 커밍쏜 맥의 정리본 자동 초안(~/contents scripts/reading-insights.mjs)이 노션 링크를 넘긴다.
 *
 *   POST /.netlify/functions/gift-pending
 *     Authorization: Bearer <토큰>   (맥에만 있음. 앱에는 SHA-256만 — CS.COMMON.giftPendingSha256)
 *     { "seasonId": "s3", "link": "https://www.notion.so/…", "title": "『…』 인사이트 정리본 — …" }
 *   GET  (같은 인증) ?season=s3 → 그 시즌 meta/app.giftPending
 *
 * 받은 링크는 그 시즌 meta/app.giftPending 에 '대기'로만 둔다 — 메일은 보내지 않는다.
 * 운영진 화면 [🎁 정리본 오픈]이 이 링크를 미리 채우고, 커밍쏜이 검수한 뒤 버튼을 눌러야 나간다.
 * 앱 공지·피드에는 아무것도 올리지 않는다(대상자만 받는 선물).
 * 이미 보낸 시즌(giftPending.status === 'sent')은 덮어쓰지 않는다. */
const { withSeason } = require('./_lib/appLogic');
const { metaDoc } = require('./_lib/giftMail');
const { tokenOk } = require('./_lib/rosterImport');

const json = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  const CS = global.CS;
  if (!tokenOk(event, CS.COMMON.giftPendingSha256)) return json(401, { error: 'unauthorized' });
  let body = {};
  if (event.httpMethod === 'POST') {
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'JSON 형식이 아닙니다.' }); }
  } else if (event.httpMethod !== 'GET') return json(405, { error: 'Method Not Allowed' });
  const seasonId = body.seasonId || (event.queryStringParameters || {}).season;
  const cfg = CS.configFor(seasonId);
  if (!cfg) return json(400, { error: '알 수 없는 시즌: ' + seasonId });
  if (!cfg.giftMissLimit) return json(400, { error: '이 시즌에는 정리본 선물이 없습니다.' });

  return withSeason(seasonId, async () => {
    const ref = metaDoc();
    const cur = ((await ref.get()).data() || {}).giftPending || null;
    if (event.httpMethod === 'GET') return json(200, { seasonId, giftPending: cur });
    const link = String(body.link || '').trim();
    if (!CS.GiftCheck.NOTION_URL.test(link)) return json(400, { error: '노션 주소(https://…notion.so/… 또는 …notion.site/…)가 아닙니다.' });
    if (cur && cur.status === 'sent') return json(409, { error: '이 시즌 정리본은 이미 보냈습니다.', giftPending: cur });
    const giftPending = {
      link, title: String(body.title || '').slice(0, 200), seasonId, status: 'pending',
      at: CS.U.nowStamp(), by: 'auto'
    };
    await ref.set({ giftPending }, { merge: true });
    return json(200, { ok: true, giftPending });
  });
};
