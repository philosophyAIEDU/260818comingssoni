/* 쏜님의 영상·칼럼 댓글 — content.html의 영상 보기·칼럼 읽기 창 아래에서 부른다.
 *
 *   GET    ?video={id} | ?column={/p/50/}   → { comments: [{ id, nickname, text, book, createdAt }], book }
 *   POST   { videoId | columnId, nickname, text } → { comment, token }   (token: 이 기기에서 지울 때 쓰는 값)
 *   DELETE { id, token }                    → { ok }               (운영진은 Authorization 헤더로 token 없이)
 *
 * 멤버 확인·저장 규칙은 _lib/contentComments.js. 이름은 활성 시즌 명단에서 먼저, 없으면 바로 앞 시즌에서 찾는다
 * (시즌이 바뀐 직후에도 지난 책 멤버가 이어서 쓸 수 있게). */
const { getDb } = require('./_lib/firebaseAdmin');
const { requireAdmin, json } = require('./_lib/adminAuth');
const comments = require('./_lib/contentComments');
require('./_lib/appLogic'); // global.CS(시즌 설정) 준비

function memberSeasons() {
  const CS = global.CS;
  const active = CS.pickSeason(CS.seasonNowKST());
  const i = CS.SEASONS.indexOf(active);
  return [active, CS.SEASONS[i - 1]].filter(Boolean).map((s) => ({
    id: s.id,
    book: (CS.configFor(s.id).book || {}).name || '',
    collection: s.dataPrefix ? `${s.dataPrefix}_participants` : 'participants'
  }));
}

const reply = (result, okStatus = 200, headers) => (result.error
  ? json(result.error[0], { error: result.error[1] })
  : Object.assign(json(okStatus, result), { headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers) }));

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const result = await comments.listComments(getDb(), event.queryStringParameters || {});
      if (!result.error) result.book = memberSeasons()[0].book; // 입력 칸 안내에 쓰는 지금 읽는 책
      return reply(result, 200, { 'Cache-Control': 'no-store' });
    }
    if (event.httpMethod !== 'POST' && event.httpMethod !== 'DELETE') return Object.assign(json(405, { error: 'Method Not Allowed' }), { headers: { Allow: 'GET, POST, DELETE' } });
    if ((event.body || '').length > 8000) return json(413, { error: '내용이 너무 깁니다.' });
    let payload;
    try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: '요청 형식이 올바르지 않습니다.' }); }
    if (event.httpMethod === 'POST') return reply(await comments.addComment(getDb(), payload, memberSeasons()), 201);
    let isAdmin = false;
    if (event.headers.authorization || event.headers.Authorization) {
      const auth = await requireAdmin(event);
      if (auth.error) return auth.error;
      isAdmin = true;
    }
    return reply(await comments.removeComment(getDb(), payload.id, payload.token, isAdmin));
  } catch (err) {
    console.error('[content-comments]', err);
    return json(500, { error: '댓글 서버에 잠시 문제가 있어요. 잠시 뒤 다시 시도해 주세요.' });
  }
};
