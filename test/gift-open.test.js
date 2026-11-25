// 🎁 정리본 오픈 — gift-pending(맥이 노션 링크를 넘김)과 send-gift-mail strict(검사 → 대상자에게만 → giftPending '보냄')
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('module'); const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'firebase-admin' ? 'firebase-admin-stub' : resolve.call(this, req, ...rest); };
require.cache['firebase-admin-stub'] = { id: 'firebase-admin-stub', loaded: true, exports: { auth: () => ({ verifyIdToken: async (t) => ({ email: t }) }) } };
const { makeStore } = require('./helpers/fakeFirestore');
const lib = path.join(__dirname, '../netlify/functions/_lib');
const fn = path.join(__dirname, '../netlify/functions');
const store = makeStore(); const db = store.admin({ reads: 0, writes: 0 });
require.cache[require.resolve(path.join(lib, 'firebaseAdmin.js'))] = { exports: { getDb: () => db } };
const mails = [];
require.cache[require.resolve(path.join(lib, 'mailer.js'))] = { exports: { sendMail: async (m) => { mails.push(m); }, sleep: async () => {}, closePool: () => {} } };
require(path.join(lib, 'appLogic.js'));
const CS = global.CS;
const pending = require(path.join(fn, 'gift-pending.js'));
const send = require(path.join(fn, 'send-gift-mail.js'));

const TOKEN = 'test-token-xyz';
CS.COMMON.giftPendingSha256 = [crypto.createHash('sha256').update(TOKEN).digest('hex')];
const LINK = 'https://www.notion.so/s3-gift-3c2f15a6c51c80108cb1c88b5212be7d';
const call = (h, method, body, auth, qs) => h.handler({ httpMethod: method, headers: { authorization: 'Bearer ' + auth }, body: JSON.stringify(body || {}), queryStringParameters: qs || {} })
  .then((r) => ({ status: r.statusCode, data: JSON.parse(r.body) }));

(async () => {
  const s3 = CS.configFor('s3');
  // 참여자: 다 인증한 A, 이메일 없는 B, 많이 놓친 C(대상 아님)
  const dates = (() => { const out = []; let d = s3.startDate; while (d <= s3.endDate) { out.push(d); d = CS.U.addDays(d, 1); } return out; })();
  store.col('s3_participants').set('a', { nickname: '가가', email: 'a@x.com', status: 'active' });
  store.col('s3_participants').set('b', { nickname: '나나', email: '', status: 'active' });
  store.col('s3_participants').set('c', { nickname: '다다', email: 'c@x.com', status: 'active' });
  dates.forEach((d, i) => { ['a', 'b'].forEach((p) => store.col('s3_submissions').set(p + i, { participantId: p, date: d, sentence: 'x', reflection: 'y' })); });

  // 1) gift-pending: 토큰 없으면 거절, 노션이 아니면 거절, 맞으면 대기로 저장 — 메일은 안 나간다
  assert.equal((await call(pending, 'POST', { seasonId: 's3', link: LINK }, 'wrong')).status, 401);
  assert.equal((await call(pending, 'POST', { seasonId: 's3', link: 'https://bit.ly/x' }, TOKEN)).status, 400);
  let r = await call(pending, 'POST', { seasonId: 's3', link: LINK, title: '『혁명의 팡파르』 인사이트 정리본' }, TOKEN);
  assert.equal(r.status, 200); assert.equal(store.col('s3_meta').get('app').giftPending.status, 'pending');
  assert.equal(mails.length, 0, '대기 링크만으로는 메일이 나가지 않는다');
  r = await call(pending, 'GET', null, TOKEN, { season: 's3' });
  assert.equal(r.data.giftPending.link, LINK);
  console.log('gift-pending: 토큰·노션 검사, 대기 저장, 메일 없음 — 통과');

  // 2) strict 발송: 검사에 걸리면 400(메일 0통)
  const g = s3.giftMail;
  const admin = 'comingssoni@gmail.com';
  r = await call(send, 'POST', { seasonId: 's3', strict: true, link: LINK, subject: g.subject, body: g.body.replace('11월 새롭게', '12월 새롭게') }, admin);
  assert.equal(r.status, 400); assert.match(r.data.error, /다음 달/); assert.equal(mails.length, 0);
  r = await call(send, 'POST', { seasonId: 's3', strict: true, link: 'https://bit.ly/x', subject: g.subject, body: g.body }, admin);
  assert.equal(r.status, 400); assert.equal(mails.length, 0);
  r = await call(send, 'POST', { seasonId: 's3', strict: true, resend: true, link: LINK, subject: g.subject, body: g.body }, admin);
  assert.equal(r.status, 400, 'strict 에서 다시 보내기는 막는다');
  // 운영진이 아니면 403
  assert.equal((await call(send, 'POST', { seasonId: 's3', strict: true, link: LINK, subject: g.subject, body: g.body }, 'x@y.com')).status, 403);

  // 3) 통과하면 대상자(A)에게만 1통, 이메일 없는 B·대상 아닌 C는 안 감, giftPending 'sent'
  r = await call(send, 'POST', { seasonId: 's3', strict: true, link: LINK, subject: g.subject, body: g.body }, admin);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(mails.map((m) => m.to), ['a@x.com']);
  assert.ok(mails[0].text.includes('가가님') && mails[0].text.includes(LINK) && !/\{\{/.test(mails[0].text + mails[0].subject));
  assert.equal(store.col('s3_participants').get('a').giftSentAt.length, 10);
  assert.equal(store.col('s3_meta').get('app').giftPending.status, 'sent');
  // 4) 두 번 눌러도 다시 안 감
  r = await call(send, 'POST', { seasonId: 's3', strict: true, link: LINK, subject: g.subject, body: g.body }, admin);
  assert.equal(mails.length, 1, '중복 발송 없음'); assert.equal(r.data.skippedAlready, 1);
  // 5) 보낸 시즌은 맥이 링크를 다시 넘겨도 덮지 않는다
  assert.equal((await call(pending, 'POST', { seasonId: 's3', link: LINK + '2' }, TOKEN)).status, 409);
  console.log('정리본 오픈(strict): 검사 실패 시 0통 · 대상자에게만 · 중복 없음 · 보냄 표시 — 통과');
})().catch((e) => { console.error(e); process.exit(1); });
