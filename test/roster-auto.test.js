// 명단 자동 반영(rosterAuto): 가짜 Firestore + 가짜 문자 서버 응답으로 확인한다.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('module'); const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'firebase-admin' ? 'firebase-admin-stub' : resolve.call(this, req, ...rest); };
require.cache['firebase-admin-stub'] = { id: 'firebase-admin-stub', loaded: true, exports: {} };
const lib = path.join(__dirname, '../netlify/functions/_lib');

/* ── 가짜 Firestore ── */
const store = {};
let autoId = 0;
const col = (n) => (store[n] = store[n] || new Map());
const clone = (v) => JSON.parse(JSON.stringify(v));
const merge = (a, b) => Object.assign({}, a || {}, b);
const dsnap = (id, v) => ({ id, exists: v !== undefined, data: () => (v === undefined ? undefined : clone(v)) });
const docRef = (name, id) => ({ _n: name, _id: id,
  get: async () => dsnap(id, col(name).get(id)),
  set: async (v, o) => { col(name).set(id, o && o.merge ? merge(col(name).get(id), clone(v)) : clone(v)); } });
const db = {
  collection: (name) => ({
    doc: (id) => docRef(name, id || 'auto' + (++autoId)),
    get: async () => ({ docs: [...col(name)].map(([id, d]) => dsnap(id, d)) })
  }),
  batch: () => { const ops = []; return { set: (ref, v) => ops.push([ref, v]), commit: async () => { for (const [r, v] of ops) await r.set(v); } }; },
  runTransaction: async (fn) => fn({ get: (ref) => ref.get(), set: (ref, v, o) => { col(ref._n).set(ref._id, o && o.merge ? merge(col(ref._n).get(ref._id), clone(v)) : clone(v)); } })
};

const RA = require(path.join(lib, 'rosterAuto.js'));
const CS = global.CS;
const s4 = CS.SEASONS.find((s) => s.id === 's4');
const s3 = CS.SEASONS.find((s) => s.id === 's3');
const C = s4.startDate;
const env = { LATPEED_NOTIFY_URL: 'https://notify.example/', LATPEED_NOTIFY_SECRET: 'sek', CHAT_INVITE_URL: 'https://open.kakao.com/o/test', CHAT_INVITE_CODE: '1234' };

const p = (name, n, email) => ({ name, phone: '010-0000-' + String(n).padStart(4, '0'), email: email || `u${n}@x.com`, why: '구독 중' });
// 문자 서버 응답(/api/chat): keep(단톡방 명단에 있는 구독자) + invite(명단에 없는 구독자) = 멤버. remove/wait = 아님
const keep = Array.from({ length: 12 }, (_, i) => p('기존' + i, i));
const invite = [p('새사람', 100), p('김순자', 101, 'mom@x.com'), p('동명', 102), p('동명', 103), p('기존0 ', 0)];
const apiBody = { cohort: C, keep, invite, invited: [], missing: [], remove: [{ name: '떠난이', phone: '01000000200', why: '구독 종료' }], wait: [{ name: '실패이', phone: '01000000201', why: '결제 실패 유예 중(한도 초과)' }], check: [] };
let calls = [];
const fetchImpl = async (url, opt) => { calls.push({ url, auth: opt.headers.authorization }); return { ok: true, status: 200, json: async () => clone(apiBody) }; };

(async () => {
  // 지난 시즌(s3) 명단: 기존0~11 + 떠난이 + 실패이 + 예외(쿠폰)
  const prevCol = col('s3_participants');
  keep.forEach((m, i) => prevCol.set('q' + i, { nickname: m.name, email: m.email, phone: m.phone, status: 'active' }));
  prevCol.set('qa', { nickname: '떠난이', email: 'gone@x.com', phone: '010-0000-0200', status: 'active' });
  prevCol.set('qb', { nickname: '실패이', email: 'fail@x.com', phone: '010-0000-0201', status: 'active' });
  prevCol.set('qc', { nickname: '쿠폰이', email: '', phone: '', status: 'active' });
  // 이번 시즌에 운영진이 이미 한 명 넣어 둠(엑셀) — 다시 넣지 않아야 함
  col('s4_participants').set('pre', { nickname: '기존1', email: 'u1@x.com', phone: '01000000001', status: 'active' });

  await RA.saveSettings(db, { extras: [{ name: '쿠폰이' }, { name: '기존2' }], aliases: [{ payer: '김순자', name: '하진영' }], invite: true }, 'a@b.c');

  // ── 미리보기: 쓰지 않음 ──
  let r = await RA.syncRoster({ db, C, write: false, env, fetchImpl });
  assert.equal(calls[0].url, `https://notify.example/api/chat?date=${C}`);
  assert.equal(calls[0].auth, 'Bearer sek');
  assert(!r.stopped, r.stopped);
  assert.equal(r.counts.payers, 16, '전화번호 기준 중복(기존0 공백) 제거 → 래피드 16명');
  assert.equal(r.counts.extras, 1, '예외 중 이미 결제자인 기존2는 한 번만');
  assert.equal(r.counts.total, 17);
  assert.equal(r.counts.skipped, 1, '이미 있던 기존1은 건너뜀');
  const names = r.added.map((x) => x.name);
  assert(names.includes('하진영') && !names.includes('김순자'), '결제자 김순자 → 하진영');
  assert(names.includes('동명(0102)') && names.includes('동명(0103)'), '동명이인은 뒷4자리');
  assert(names.includes('쿠폰이'));
  assert.equal(r.added.find((x) => x.name === '하진영').payer, '김순자');
  assert.deepEqual(r.invite.map((x) => x.name).sort(), ['동명(0102)', '동명(0103)', '새사람', '하진영'].sort(), '앞 시즌에 없던 래피드 결제자만 초대');
  assert.deepEqual(r.dropped, [{ name: '떠난이', why: '구독 종료' }, { name: '실패이', why: '결제 실패 유예 중(한도 초과)' }], '지난 기수에서 빠진 분 + 사유(예외 쿠폰이는 아님)');
  assert.equal(col('s4_participants').size, 1, '미리보기는 쓰지 않는다');
  assert(r.added.find((x) => x.name === '기존3').streak >= 2, '지난 시즌에 있던 분은 연속 참여');

  // ── 실제 반영 ──
  r = await RA.syncRoster({ db, C, write: true, env, fetchImpl });
  assert.equal(col('s4_participants').size, 17);
  const jin = [...col('s4_participants').values()].find((x) => x.nickname === '하진영');
  assert.equal(jin.note, '자동 반영 · 결제자 김순자');
  assert.equal(jin.joinDate, s4.startDate);
  assert.equal(jin.status, 'active');
  assert(col('s4_notifyEmails').size >= 15);
  // 두 번 돌려도 그대로
  r = await RA.syncRoster({ db, C, write: true, env, fetchImpl });
  assert.equal(r.counts.added, 0);
  assert.equal(col('s4_participants').size, 17);
  assert.match(RA.reportText(r), /단톡방에서 내보낼 분.*2명/);

  // ── 안전장치: 멤버가 너무 적으면 멈춤 ──
  const few = { ...apiBody, keep: keep.slice(0, 3), invite: [] };
  const r2 = await RA.syncRoster({ db, C, write: true, env, fetchImpl: async () => ({ ok: true, json: async () => clone(few) }) });
  assert.match(r2.stopped, /멈췄습니다/);
  // 다른 기수를 돌려주면 오류
  await assert.rejects(RA.syncRoster({ db, C, write: true, env, fetchImpl: async () => ({ ok: true, json: async () => ({ ...apiBody, cohort: '2000-01-01' }) }) }), /다른 기수/);
  // 연결 정보가 없으면 오류
  await assert.rejects(RA.syncRoster({ db, C, write: false, env: {}, fetchImpl }), /LATPEED_NOTIFY_URL/);

  // ── 09시 초대 문자: 초대 대상에게만, 한 번만 ──
  const sent = [];
  const sendSms = async (m) => { sent.push(m); if (m.to.endsWith('0103')) throw new Error('수신 거부'); };
  const at9 = Date.parse(`${C}T09:00:00+09:00`);
  let iv = await RA.sendInvites({ db, nowMs: at9, env, sendSms });
  assert.equal(iv.total, 4);
  assert.equal(iv.sent, 3);
  assert.equal(iv.failed, 1);
  const msg = sent.find((m) => m.text.includes('새사람님'));
  assert(msg.text.includes(`[${s4.book.name}]`) && msg.text.includes('https://open.kakao.com/o/test') && msg.text.includes('코드 : 1234'));
  assert(msg.text.includes(CS.U.shortLabel(s4.startDate)));
  // 09:30 다시: 보낸 분은 건너뛰고 실패한 분만 다시
  sent.length = 0;
  iv = await RA.sendInvites({ db, nowMs: at9 + 30 * 60000, env, sendSms: async (m) => { sent.push(m); } });
  assert.equal(sent.length, 1);
  assert(sent[0].to.endsWith('0103'));
  // 기수 시작일이 아니면 안 보냄, 링크가 없으면 안 보냄, 꺼 두면 안 보냄
  assert.match((await RA.sendInvites({ db, nowMs: at9 + 86400000, env, sendSms })).skipped, /시작하는 시즌 없음/);
  assert.match((await RA.sendInvites({ db, nowMs: at9, env: {}, sendSms })).skipped, /CHAT_INVITE_URL/);
  await RA.saveSettings(db, { extras: [], aliases: [], invite: false });
  assert.match((await RA.sendInvites({ db, nowMs: at9, env, sendSms })).skipped, /꺼 둠/);
  // 다음 시즌 시작일(반영 기록 없음)이면 보내지 않음
  if (s3) assert.match((await RA.sendInvites({ db, nowMs: Date.parse(`${s3.startDate}T09:00:00+09:00`), env, sendSms })).skipped, /꺼 둠|반영 기록/);

  // ── 연속 참여 규칙: tools/lib/streak.mjs 와 같은 답 ──
  const mjs = await import(path.join(__dirname, '../tools/lib/streak.mjs'));
  const cjs = require(path.join(lib, 'streak.js'));
  const rowsA = [{ nickname: '이유진(1362)', email: 'a@x.com' }, { nickname: '홍길동', email: '' }, { nickname: '홍길동', email: 'h2@x.com' }, { nickname: '아웃', status: 'out' }];
  for (const person of [{ name: '이유진1362' }, { name: '홍길동' }, { name: 'x', email: 'A@x.com' }, { name: '아웃' }]) {
    assert.deepEqual(!!cjs.findInRoster(person, cjs.indexRoster(rowsA)), !!mjs.findInRoster(person, mjs.indexRoster(rowsA)));
    assert.equal(cjs.seasonStreakFor(person, [cjs.indexRoster(rowsA)]), mjs.seasonStreakFor(person, [mjs.indexRoster(rowsA)]));
  }

  console.log('roster-auto: 모든 확인 통과');
})().catch((e) => { console.error(e); process.exit(1); });
