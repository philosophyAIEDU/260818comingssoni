// 🗓 매달 21일 명단 자동 반영(rosterAuto): 가짜 Firestore + 가짜 문자 서버 응답으로 확인한다.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('module'); const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'firebase-admin' ? 'firebase-admin-stub' : resolve.call(this, req, ...rest); };
require.cache['firebase-admin-stub'] = { id: 'firebase-admin-stub', loaded: true, exports: {} };
const { makeStore } = require('./helpers/fakeFirestore');
const lib = path.join(__dirname, '../netlify/functions/_lib');
const store = makeStore(); const db = store.admin({ reads: 0, writes: 0 });
require.cache[require.resolve(path.join(lib, 'firebaseAdmin.js'))] = { exports: { getDb: () => db } };
require.cache[require.resolve(path.join(lib, 'feedSnapshot.js'))] = { exports: { invalidate: async () => {} } };
require(path.join(lib, 'appLogic.js'));
const RA = require(path.join(lib, 'rosterAuto.js'));
const CS = global.CS;
const s4 = CS.configFor('s4');
const C = s4.startDate;
const env = { LATPEED_NOTIFY_SECRET: 'sek' };
const clone = (v) => JSON.parse(JSON.stringify(v));

const p = (name, n, email) => ({ name, phone: '010-0000-' + String(n).padStart(4, '0'), email: email === undefined ? `u${n}@x.com` : email, why: '구독 중' });
const keep = Array.from({ length: 12 }, (_, i) => p('기존' + i, i));
const invite = [p('새사람', 100), p('김엄마', 101, 'mom@x.com'), p('동명', 102), p('동명', 103), p('기존0 ', 0)];
const api = { cohort: C, keep, invite, invited: [], missing: [], remove: [{ name: '떠난이', phone: '01000000200', why: '구독 종료' }], wait: [{ name: '실패이', phone: '01000000201', why: '결제 실패 유예 중(한도 초과)' }], check: [] };
const calls = [];
const fetchImpl = async (url, opt) => { calls.push({ url, auth: opt.headers.authorization }); return { ok: true, status: 200, json: async () => clone(api) }; };

(async () => {
  // 지난 시즌(s3): 기존0~11 + 떠난이 + 실패이 + 쿠폰이(연락처 없음)
  keep.forEach((m, i) => store.col('s3_participants').set('q' + i, { nickname: m.name, email: m.email, phone: m.phone.replace(/\D/g, ''), status: 'active' }));
  store.col('s3_participants').set('qa', { nickname: '떠난이', email: 'gone@x.com', phone: '01000000200', status: 'active' });
  store.col('s3_participants').set('qb', { nickname: '실패이', email: 'fail@x.com', phone: '01000000201', status: 'active' });
  store.col('s3_participants').set('qc', { nickname: '쿠폰이', email: '', phone: '', status: 'active' });
  // 이번 시즌에 운영진이 이름만 넣어 둔 사람(이메일·전화 없음) → 새로 만들지 않고 채운다
  store.col('s4_participants').set('pre', { nickname: '기존1', email: '', phone: '', status: 'active' });

  await RA.saveSettings(db, { extras: [{ name: '쿠폰이' }, { name: '기존2' }, { name: '해외이', email: 'abroad@x.com' }], aliases: [{ payer: '김엄마', name: '김딸' }] }, 'a@b.c');

  // ── 미리보기: 쓰지 않음 ──
  let r = await RA.syncRoster({ db, C, write: false, env, fetchImpl });
  assert.equal(calls[0].url, `${CS.COMMON.latpeedNotifyUrl}/api/chat?date=${C}`);
  assert.equal(calls[0].auth, 'Bearer sek');
  assert(!r.stopped, r.stopped);
  assert.equal(r.counts.payers, 16, '전화번호 기준 중복(기존0 공백) 제거 → 래피드 16명');
  assert.equal(r.counts.extras, 2, '예외 중 이미 결제자인 기존2는 빼고 쿠폰이·해외이');
  assert.deepEqual(r.filled, ['기존1'], '이름만 있던 기존1은 채움');
  assert.equal(store.col('s4_participants').size, 1, '미리보기는 쓰지 않는다');
  const names = r.added.map((x) => x.name);
  assert(names.includes('김딸') && !names.includes('김엄마'), '결제자 김엄마 → 김딸');
  assert(names.includes('동명(0102)') && names.includes('동명(0103)'), '동명이인은 뒷4자리');
  assert(names.includes('쿠폰이') && names.includes('해외이'));
  assert.deepEqual(r.dropped.map((x) => [x.name, x.why]), [['떠난이', '구독 종료'], ['실패이', '결제 실패 유예 중(한도 초과)']], '빠진 분 + 사유(예외 쿠폰이는 아님)');

  // ── 실제 반영 ──
  r = await RA.syncRoster({ db, C, write: true, env, fetchImpl });
  const P = store.col('s4_participants');
  assert.equal(P.size, 1 + 15 + 2, '기존1(채움) + 새 래피드 15 + 예외 2');
  assert.equal(P.get('pre').email, 'u1@x.com', '이름만 있던 사람에게 이메일 채움');
  const ddal = [...P.values()].find((x) => x.nickname === '김딸');
  assert.equal(ddal.email, 'mom@x.com');
  const coupon = [...P.values()].find((x) => x.nickname === '쿠폰이');
  assert.equal(coupon.status, 'active');
  assert.equal(coupon.joinDate, s4.startDate);
  assert([...P.values()].find((x) => x.nickname === '기존3').seasonStreak >= 2, '지난 시즌에 있던 분은 연속 참여');
  assert(store.col('s4_notifyEmails').size >= 16, '이메일은 알림 메일 목록에도');
  assert.equal(r.dropped.length, 2);
  assert.match(RA.reportText(r), /단톡방에서 내보낼 분.*2명[\s\S]*떠난이.*구독 종료/);
  assert(store.col('rosterAuto').get('s4').write, '반영 기록 남김');

  // 두 번 돌려도 그대로
  r = await RA.syncRoster({ db, C, write: true, env, fetchImpl });
  assert.equal(r.counts.added, 0);
  assert.equal(P.size, 18);

  // ── 안전장치 ──
  const few = { ...api, keep: keep.slice(0, 3), invite: [] };
  const r2 = await RA.syncRoster({ db, C, write: true, env, fetchImpl: async () => ({ ok: true, json: async () => clone(few) }) });
  assert.match(r2.stopped, /멈췄습니다/);
  assert.match(RA.reportText(r2), /멈췄습니다/);
  await assert.rejects(RA.syncRoster({ db, C, write: true, env, fetchImpl: async () => ({ ok: true, json: async () => ({ ...api, cohort: '2000-01-01' }) }) }), /다른 기수/);
  await assert.rejects(RA.syncRoster({ db, C, write: false, env: {}, fetchImpl }), /LATPEED_NOTIFY_SECRET/);
  assert.match((await RA.syncRoster({ db, C: '2000-01-01', write: true, env, fetchImpl })).stopped, /시즌이/);

  console.log('roster-auto: 모든 확인 통과');
})().catch((e) => { console.error(e); process.exit(1); });
