// 영상 댓글 함수: 멤버 확인·글 정리·도배 제한·본인/운영진 삭제를 메모리 속 가짜 Firestore로 검증한다.
const assert = require('node:assert/strict');
const path = require('node:path');

function fakeDb() {
  const data = {}; let n = 0;
  const coll = (name) => (data[name] = data[name] || new Map());
  const snapOf = (id, v) => ({ id, exists: v !== undefined, data: () => (v === undefined ? undefined : JSON.parse(JSON.stringify(v))) });
  const query = (name, filters) => ({
    where: (f, op, v) => query(name, filters.concat([[f, v]])),
    get: async () => ({ docs: [...coll(name)].filter(([, d]) => filters.every(([f, v]) => d[f] === v)).map(([id, d]) => snapOf(id, d)) })
  });
  return {
    data, coll,
    collection: (name) => Object.assign(query(name, []), {
      add: async (doc) => { const id = 'c' + (++n); coll(name).set(id, doc); return { id }; },
      doc: (id) => ({ get: async () => snapOf(id, coll(name).get(id)), delete: async () => { coll(name).delete(id); } })
    })
  };
}

const db = fakeDb();
const lib = path.join(__dirname, '../netlify/functions/_lib');
require.cache[require.resolve(path.join(lib, 'firebaseAdmin.js'))] = { exports: { getDb: () => db } };
let adminOk = true;
require.cache[require.resolve(path.join(lib, 'adminAuth.js'))] = { exports: {
  json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  requireAdmin: async () => (adminOk ? { email: 'admin@example.com' } : { error: { statusCode: 403, body: '{"error":"운영진만"}' } })
} };
const { cleanText } = require(path.join(lib, 'contentComments.js'));
const { handler } = require('../netlify/functions/content-comments.js');

(async () => {
  // 활성 시즌 명단에 멤버를 둔다
  const prefix = global.CS.pickSeason(global.CS.seasonNowKST()).dataPrefix;
  const participants = db.coll(prefix ? `${prefix}_participants` : 'participants');
  participants.set('p1', { nickname: '김현우', status: 'active' });
  participants.set('p2', { nickname: '아웃된멤버', status: 'out' });
  participants.set('p3', { nickname: '이유진', status: 'active' });
  participants.set('p4', { nickname: '이유진', status: 'active' });
  participants.set('p5', { nickname: '박지민', status: 'active' });
  const call = async (httpMethod, opts = {}) => {
    const res = await handler({ httpMethod, headers: opts.headers || {}, queryStringParameters: opts.query || {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  const VIDEO = 'xmd2_HKMgCU';

  assert.equal(cleanText('  첫 줄\r\n\n\n\n둘째\u0000 줄‮  '), '첫 줄\n\n둘째 줄');
  assert.equal((await call('GET', { query: { video: '../etc' } })).status, 400);
  let r = await call('GET', { query: { video: VIDEO } });
  assert.equal(r.status, 200); assert.deepEqual(r.body.comments, []); assert.equal(typeof r.body.book, 'string'); assert(r.body.book.length > 0);

  r = await call('POST', { body: { videoId: VIDEO, nickname: '  김현우 ', text: '책의 ‘작은 실행’과 영상 이야기가 겹쳤어요.\n저도 오늘부터 기록합니다.' } });
  assert.equal(r.status, 201); assert.equal(r.body.comment.nickname, '김현우'); assert(r.body.token.length >= 20);
  assert.equal(r.body.comment.book, r.body.comment.book.trim()); assert(!('tokenHash' in r.body.comment) && !('participantId' in r.body.comment));
  const first = r.body;
  const stored = db.coll('contentComments').get(first.comment.id);
  assert.equal(stored.participantId, 'p1'); assert.notEqual(stored.tokenHash, first.token); assert.equal(stored.videoId, VIDEO);

  assert.equal((await call('POST', { body: { videoId: VIDEO, nickname: '김현우', text: '연달아 두 번째' } })).status, 429, '15초 안 연속 작성 제한');
  assert.equal((await call('POST', { body: { videoId: VIDEO, nickname: '모르는사람', text: '멤버가 아니에요' } })).status, 403);
  assert.equal((await call('POST', { body: { videoId: VIDEO, nickname: '아웃된멤버', text: '아웃된 멤버' } })).status, 403);
  assert.equal((await call('POST', { body: { videoId: VIDEO, nickname: '이유진', text: '동명이인' } })).status, 409);
  assert.equal((await call('POST', { body: { videoId: VIDEO, nickname: '박지민', text: '가'.repeat(501) } })).status, 400);
  assert.equal((await call('POST', { body: { videoId: VIDEO, nickname: '박지민', text: ' ' } })).status, 400);
  assert.equal((await call('POST', { body: { videoId: 'bad', nickname: '박지민', text: '영상 정보 오류' } })).status, 400);
  assert.equal((await call('PUT', {})).status, 405);
  r = await call('POST', { body: { videoId: VIDEO, nickname: '박지민', text: '<script>alert(1)</script> 그대로 글자로 저장' } });
  assert.equal(r.status, 201);
  const second = r.body;

  r = await call('GET', { query: { video: VIDEO } });
  assert.deepEqual(r.body.comments.map((c) => c.nickname), ['김현우', '박지민']);
  assert.equal(r.body.comments[1].text, '<script>alert(1)</script> 그대로 글자로 저장');
  assert.deepEqual((await call('GET', { query: { video: 'gQZ6zI3epVo' } })).body.comments, []);

  // 삭제: 토큰이 틀리면 거절, 맞으면 삭제, 운영진은 토큰 없이
  assert.equal((await call('DELETE', { body: { id: first.comment.id, token: second.token } })).status, 403);
  assert.equal((await call('DELETE', { body: { id: first.comment.id } })).status, 403);
  assert.equal((await call('DELETE', { body: { id: first.comment.id, token: first.token } })).status, 200);
  adminOk = false;
  assert.equal((await call('DELETE', { headers: { authorization: 'Bearer x' }, body: { id: second.comment.id } })).status, 403);
  adminOk = true;
  assert.equal((await call('DELETE', { headers: { authorization: 'Bearer x' }, body: { id: second.comment.id } })).status, 200);
  assert.deepEqual((await call('GET', { query: { video: VIDEO } })).body.comments, []);
  console.log('영상 댓글: 멤버 이름 확인(아웃·동명이인·비멤버 거절)·글 정리·길이·연속 작성 제한·본인/운영진 삭제 통과');
})().catch((e) => { console.error(e); process.exit(1); });
