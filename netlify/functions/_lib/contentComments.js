/* 쏜님의 영상 아래 멤버 댓글 — 읽고 있는 책과 영상을 이어 본 인사이트를 나눈다.
 *
 * 저장: contentComments/{id} { videoId, participantId, nickname, seasonId, book, text, createdAt, tokenHash }
 *   영상은 시즌이 바뀌어도 그대로라 시즌 접두사를 붙이지 않는다. 대신 쓸 때의 시즌·책을 함께 남겨
 *   "『혁명의 팡파르』 읽는 중"처럼 보여 준다.
 *
 * 쓰기는 Admin SDK로만 한다(브라우저가 Firestore에 직접 쓰지 않는다). 그래서 보안 규칙을 고치지 않아도 되고,
 * "멤버만 쓴다"를 서버가 직접 확인한다 — 활성 시즌(또는 바로 앞 시즌) 명단에 있고 아웃이 아닌 이름이어야 한다.
 * 인증 화면과 같은 이름 기반 확인이라 로그인은 없다.
 *
 * 지우기: 쓸 때 받은 삭제 토큰(그 기기에만 저장)으로 본인이, 또는 운영진 로그인 토큰으로 운영진이.
 * 토큰은 해시만 저장한다. */
const crypto = require('crypto');

const COLLECTION = 'contentComments';
const MAX_TEXT = 500;
const MAX_LIST = 200;
const MIN_INTERVAL_MS = 15 * 1000;
const DAILY_LIMIT = 30;
const VIDEO_ID = /^[\w-]{11}$/;

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const normalizeNick = (s) => String(s || '').trim().replace(/\s+/g, ' ');

/** 줄바꿈은 살리고 제어 문자는 지운다. 빈 줄은 최대 하나까지. */
function cleanText(s) {
  return String(s || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function publicComment(id, d) {
  return { id, nickname: d.nickname, text: d.text, book: d.book || '', createdAt: d.createdAt };
}

async function listComments(db, videoId) {
  if (!VIDEO_ID.test(String(videoId || ''))) return { error: [400, '영상 정보가 올바르지 않습니다.'] };
  const snap = await db.collection(COLLECTION).where('videoId', '==', videoId).get();
  const comments = snap.docs.map((d) => publicComment(d.id, d.data()))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(-MAX_LIST);
  return { comments };
}

/** seasons: 이름을 찾아볼 시즌 목록(앞이 우선) [{ id, book, collection }] */
async function findMember(db, nickname, seasons) {
  for (const s of seasons) {
    const snap = await db.collection(s.collection).where('nickname', '==', nickname).get();
    const active = snap.docs.map((d) => Object.assign({ id: d.id }, d.data())).filter((p) => p.status !== 'out');
    if (active.length === 1) return { participant: active[0], season: s };
    if (active.length > 1) return { ambiguous: true };
  }
  return null;
}

async function addComment(db, payload, seasons, now = new Date()) {
  const videoId = String(payload.videoId || '');
  const nickname = normalizeNick(payload.nickname);
  const text = cleanText(payload.text);
  if (!VIDEO_ID.test(videoId)) return { error: [400, '영상 정보가 올바르지 않습니다.'] };
  if (!nickname) return { error: [400, '멤버 이름을 입력해 주세요.'] };
  if (text.length < 2) return { error: [400, '나누고 싶은 생각을 두 글자 이상 적어 주세요.'] };
  if (text.length > MAX_TEXT) return { error: [400, `댓글은 ${MAX_TEXT}자까지 쓸 수 있어요.`] };

  const found = await findMember(db, nickname, seasons);
  if (!found) return { error: [403, `'${nickname}' 이름이 이번 독서 멤버십 명단에 없어요. 인증할 때 쓰는 이름 그대로 적어 주세요.`] };
  if (found.ambiguous) return { error: [409, '같은 이름이 둘 이상이에요. 인증 화면의 이름(꼬리표 포함) 그대로 적어 주세요.'] };

  const mine = await db.collection(COLLECTION).where('participantId', '==', found.participant.id).get();
  const times = mine.docs.map((d) => Date.parse(d.data().createdAt)).filter((t) => !isNaN(t));
  if (times.some((t) => now - t < MIN_INTERVAL_MS)) return { error: [429, '조금 전에 댓글을 남기셨어요. 잠시 뒤에 다시 남겨 주세요.'] };
  if (times.filter((t) => now - t < 24 * 3600e3).length >= DAILY_LIMIT) return { error: [429, '오늘은 댓글을 충분히 남기셨어요. 내일 또 나눠 주세요.'] };

  const token = crypto.randomBytes(18).toString('base64url');
  const doc = {
    videoId,
    participantId: found.participant.id,
    nickname: found.participant.nickname,
    seasonId: found.season.id,
    book: found.season.book || '',
    text,
    createdAt: now.toISOString(),
    tokenHash: sha256(token)
  };
  const ref = await db.collection(COLLECTION).add(doc);
  return { comment: publicComment(ref.id, doc), token };
}

/** isAdmin이면 토큰 없이 지운다. 아니면 쓸 때 받은 토큰이 맞아야 한다. */
async function removeComment(db, id, token, isAdmin) {
  if (!/^[\w-]{1,64}$/.test(String(id || ''))) return { error: [400, '댓글 정보가 올바르지 않습니다.'] };
  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true };
  if (!isAdmin && (!token || sha256(token) !== snap.data().tokenHash)) return { error: [403, '이 기기에서 쓴 댓글만 지울 수 있어요.'] };
  await ref.delete();
  return { ok: true };
}

module.exports = { COLLECTION, MAX_TEXT, cleanText, listComments, addComment, removeComment, findMember };
