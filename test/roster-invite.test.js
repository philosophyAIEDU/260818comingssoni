// 시작일 자동 명단 입력(roster-import) + 단톡방 초대 문자(send-season-invite)
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('module'); const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'firebase-admin' ? 'firebase-admin-stub' : resolve.call(this, req, ...rest); };
require.cache['firebase-admin-stub'] = { id: 'firebase-admin-stub', loaded: true, exports: {} };
const { makeStore } = require('./helpers/fakeFirestore');
const lib = path.join(__dirname, '../netlify/functions/_lib');
const store = makeStore(); const stats = { reads: 0, writes: 0 };
const db = store.admin(stats);
require.cache[require.resolve(path.join(lib, 'firebaseAdmin.js'))] = { exports: { getDb: () => db } };
const smsSent = [];
require.cache[require.resolve(path.join(lib, 'solapi.js'))] = { exports: { sendSms: async (m) => { if (m.to === '01000000000') throw new Error('수신 거부'); smsSent.push(m); }, normalizePhone: (x) => String(x).replace(/\D/g, '') } };
require(path.join(lib, 'appLogic.js'));
const CS = global.CS;
const { importRoster, pickTargetSeason, tokenOk, sha } = require(path.join(lib, 'rosterImport.js'));
const { runSeasonInvite, inWindow } = require(path.join(lib, 'seasonInvite.js'));
const handler = require('../netlify/functions/roster-import.js').handler;

(async () => {
  const cfg = CS.configFor('s4');
  const P = 's4_participants';
  // 앞 시즌(s3)에 있던 사람 → 🔥2
  store.col('s3_participants').set('x1', { nickname: '김연속', email: 'yeon@x.com', status: 'active' });
  // 이미 손으로 넣은 사람(전화번호 없음)
  store.col(P).set('m1', { nickname: '박기존', email: 'park@x.com', phone: '', status: 'active' });
  store.col(P).set('m2', { nickname: '이동명', email: 'lee1@x.com', phone: '01011112222', status: 'active' });

  const rows = [
    { name: '김연속', email: 'YEON@x.com ', phone: '010-1234-5678', status: 'paid' },
    { name: '박기존', email: 'park@x.com', phone: '+82 10-9999-8888', status: 'paid' },
    { name: '이동명', email: 'lee2@x.com', phone: '01033334444', status: 'due' },
    { name: '최신규', email: '', phone: '01055556666' },
    { name: '최신규', email: '', phone: '01055556666' },          // 같은 행 두 번
    { name: '', email: 'noname@x.com', phone: '' },               // 이름 없음 → 버림
    { name: '거부', email: 'no@x.com', phone: '01000000000' }
  ];
  const dry = await importRoster(db, CS, cfg, rows, { dryRun: true });
  assert.equal(store.col(P).size, 2, '미리보기는 쓰지 않는다');
  assert.equal(dry.added.length, 4);

  const r = await importRoster(db, CS, cfg, rows);
  assert.deepEqual(r.added.map((a) => a.nickname).sort(), ['거부', '김연속', '이동명(4444)', '최신규'].sort());
  assert.deepEqual(r.filled, ['박기존'], '빈 전화번호만 채운다');
  assert.equal(store.col(P).get('m1').phone, '01099998888', '+82 → 0');
  const kim = [...store.col(P).values()].find((p) => p.nickname === '김연속');
  assert.equal(kim.seasonStreak, 2); assert.equal(kim.email, 'yeon@x.com'); assert.equal(kim.joinDate, cfg.startDate);
  const due = [...store.col(P).values()].find((p) => p.nickname === '이동명(4444)');
  assert.equal(due.payment, 'due'); assert.match(due.note, /결제 예정/);
  assert(store.col('s4_notifyEmails').size === 3, '이메일 있는 새 사람만 알림 메일에');
  // 다시 보내도 늘지 않는다
  const again = await importRoster(db, CS, cfg, rows);
  assert.equal(again.added.length, 0); assert.equal(store.col(P).size, 6);

  // 시즌 고르기: 시작 3일 전 이내면 다음 시즌
  assert.equal(pickTargetSeason(CS, '', '2026-11-19').seasonId, 's4');
  assert.equal(pickTargetSeason(CS, 's3', '2026-11-19').seasonId, 's3');

  // 토큰: 해시 일치할 때만
  assert.equal(tokenOk({ headers: { authorization: 'Bearer abc' } }, [sha('abc')]), true);
  assert.equal(tokenOk({ headers: { authorization: 'Bearer abd' } }, [sha('abc')]), false);
  assert.equal(tokenOk({ headers: {} }, [sha('')]), false);
  assert.equal((await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer nope' }, body: '{}' })).statusCode, 401);

  // ── 초대 문자 ──
  const start = cfg.startDate;
  const s4 = CS.SEASONS.find((s) => s.id === 's4');
  assert.equal((await runSeasonInvite({ db, CS, sendSms: async () => {}, nowKST: `${start}T10:00` })).skipped, 'no-url', '링크 없으면 안 보냄');
  s4.kakaoInvite = { url: 'https://open.kakao.com/o/test', code: '1121', at: '09:00' };
  assert.equal(inWindow(CS.configFor('s4'), `${start}T08:59`), 'too-early');
  assert.equal(inWindow(CS.configFor('s4'), `${start}T22:00`), 'too-late');
  assert.equal(inWindow(CS.configFor('s4'), '2026-11-22T10:00'), 'not-start-day');
  const sendSms = require(path.join(lib, 'solapi.js')).sendSms;
  const preview = await runSeasonInvite({ db, CS, sendSms, nowKST: `${start}T09:10`, dryRun: true });
  assert.equal(preview.pending, 6, '전화번호 있는 6명(기존 2명 포함)');
  assert.match(preview.sample.text, /open\.kakao\.com\/o\/test\n\(입장 코드: 1121\)/);
  assert.match(preview.sample.text, /『지적자본론』/);
  const inv = await runSeasonInvite({ db, CS, sendSms, nowKST: `${start}T09:10` });
  assert.equal(inv.sent, 5); assert.deepEqual(inv.failed, ['거부']);
  assert(smsSent.some((m) => m.text.startsWith('이동명님,')), '꼬리표(뒷4자리)는 문자에서 뺀다');
  assert.equal(new Set(smsSent.map((m) => m.to)).size, 5);
  // 두 번째 실행: 받은 사람은 다시 안 받는다(실패한 사람만 재시도)
  smsSent.length = 0;
  const inv2 = await runSeasonInvite({ db, CS, sendSms, nowKST: `${start}T09:20` });
  assert.equal(inv2.sent, 0); assert.deepEqual(inv2.failed, ['거부']);
  // 늦게 들어온 사람도 같은 날 다음 실행에 받는다
  await importRoster(db, CS, cfg, [{ name: '늦은분', email: 'late@x.com', phone: '01077778888' }]);
  const inv3 = await runSeasonInvite({ db, CS, sendSms, nowKST: `${start}T11:00` });
  assert.equal(inv3.sent, 1); assert.equal(smsSent[0].to, '01077778888');
  console.log('✓ roster-import · season-invite 통과');
})().catch((e) => { console.error(e); process.exit(1); });
