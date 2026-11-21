// 🗓 명단 자동 반영(roster-import + rosterAuto): 결제자 이름·예외 참여자·시작 전 환불(아웃)·기록
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
const CS = global.CS;
const { sha } = require(path.join(lib, 'rosterImport.js'));
const RA = require(path.join(lib, 'rosterAuto.js'));
const handler = require('../netlify/functions/roster-import.js').handler;

const TOKEN = 'test-token';
CS.COMMON.rosterImportSha256 = CS.COMMON.rosterImportSha256.concat([sha(TOKEN)]);
const s4 = CS.configFor('s4');
let today = s4.startDate;
CS.seasonNowKST = () => `${today}T00:30:00`;
const post = async (body) => { const r = await handler({ httpMethod: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ season: 's4', ...body }) }); return { code: r.statusCode, body: JSON.parse(r.body) }; };
const P = () => store.col('s4_participants');
const find = (n) => [...P().values()].find((x) => x.nickname === n);

(async () => {
  // 이미 손으로 이름만 넣은 사람(이메일·전화 없음) → 새로 만들지 않고 채운다
  P().set('pre', { nickname: '박기존', email: '', phone: '', status: 'active' });
  await RA.saveSettings(db, { extras: [{ name: '쿠폰이' }, { name: '해외이', email: 'abroad@x.com' }, { name: '박결제' }], aliases: [{ payer: '김엄마', name: '김딸' }] }, 'a@b.c');

  // ── 모집 중(19일) 첫 결제들 ──
  today = '2026-11-19';
  let r = await post({ rows: [
    { name: '김엄마', email: 'mom@x.com', phone: '010-1111-0001', status: 'paid' },
    { name: '박기존', email: 'park@x.com', phone: '010-1111-0002', status: 'paid' },
    { name: '박결제', email: 'pay@x.com', phone: '010-1111-0003', status: 'paid' },
    { name: '환불이', email: 'refund@x.com', phone: '010-1111-0004', status: 'paid' }
  ] });
  assert.equal(r.code, 200);
  assert(find('김딸') && !find('김엄마'), '결제자 김엄마 → 김딸');
  assert.equal(find('김딸').email, 'mom@x.com');
  assert.deepEqual(r.body.renamed, [{ name: '김딸', payer: '김엄마' }]);
  assert.deepEqual(r.body.filled, ['박기존'], '이름만 있던 사람은 채움');
  assert.equal(P().get('pre').email, 'park@x.com');
  assert(find('쿠폰이') && find('쿠폰이').source === 'extra', '연락처 없는 예외 참여자는 이름만으로');
  assert(find('해외이') && find('해외이').email === 'abroad@x.com', '연락처 있는 예외 참여자');
  assert.equal([...P().values()].filter((x) => x.nickname === '박결제').length, 1, '예외에도 있고 결제도 한 사람은 한 번만');
  const n1 = P().size;

  // ── 같은 묶음을 다시 보내도 그대로 ──
  r = await post({ rows: [{ name: '김엄마', email: 'mom@x.com', phone: '01011110001', status: 'paid' }] });
  assert.equal(P().size, n1);

  // ── 시작 전 환불 → 아웃(래피드로 들어온 사람만) ──
  r = await post({ rows: [
    { name: '환불이', email: 'refund@x.com', phone: '010-1111-0004', status: 'out' },
    { name: '쿠폰이', email: '', phone: '', status: 'out' },          // 예외 참여자는 안 건드림
    { name: '김엄마', email: 'mom@x.com', phone: '010-1111-0001', status: 'out' },
    { name: '김엄마', email: 'mom@x.com', phone: '010-1111-0001', status: 'paid' }  // 같은 묶음에 결제가 있으면 유지
  ] });
  assert.deepEqual(r.body.outed, ['환불이']);
  assert.equal(find('환불이').status, 'out');
  assert.equal(find('쿠폰이').status, 'active');
  assert.equal(find('김딸').status, 'active');
  assert.equal(P().size, n1, '아웃은 지우지 않는다');

  // ── 아웃된 뒤 다시 결제하면 되살림 ──
  r = await post({ rows: [{ name: '환불이', email: 'refund@x.com', phone: '010-1111-0004', status: 'paid' }] });
  assert.equal(find('환불이').status, 'active', '다시 결제 → 되살림');
  assert.equal(find('환불이').outDate, null);
  // 운영진이 직접 아웃한 사람은 되살리지 않음
  const manual = [...P().entries()].find(([, v]) => v.nickname === '박결제');
  P().set(manual[0], { ...manual[1], status: 'out', note: '운영진 아웃' });
  await post({ rows: [{ name: '박결제', email: 'pay@x.com', phone: '010-1111-0003', status: 'paid' }] });
  assert.equal(find('박결제').status, 'out');

  // ── 21일 00:30 최종 · 기록 ──
  today = s4.startDate;
  r = await post({ final: true, rows: [{ name: '새사람', email: 'new@x.com', phone: '010-2222-0001', status: 'paid' }] });
  assert(find('새사람'));
  const log = store.col('rosterAuto').get('s4');
  assert(log.lastFinalAt && log.runs.length >= 3 && log.runs[0].final);
  assert.deepEqual(log.runs[0].added, ['새사람']);

  // ── 시즌이 시작된 뒤(22일)에는 아웃 처리하지 않음 ──
  today = '2026-11-22';
  r = await post({ rows: [{ name: '새사람', email: 'new@x.com', phone: '010-2222-0001', status: 'out' }] });
  assert.deepEqual(r.body.outed, []);
  assert.equal(find('새사람').status, 'active');

  // ── 결제 실패 확정(graceEnd): 시작 뒤(22일)에도, 운영진이 손으로 넣은 사람도 — 인증 기록 없으면 지움 ──
  P().set('manual', { nickname: '실패이', email: 'fail@x.com', phone: '01077770000', status: 'active' });
  store.col('s4_notifyEmails').set('nm', { name: '실패이', email: 'fail@x.com' });
  P().set('withsub', { nickname: '인증함', email: 'sub@x.com', phone: '01077770001', status: 'active' });
  store.col('s4_submissions').set('sx', { participantId: 'withsub', date: '2026-11-21' });
  r = await post({ graceEnd: true, rows: [
    { name: '실패이', email: 'fail@x.com', phone: '01077770000', status: 'out' },
    { name: '인증함', email: 'sub@x.com', phone: '01077770001', status: 'out' },
    { name: '쿠폰이', email: '', phone: '', status: 'out' }
  ] });
  assert.deepEqual(r.body.outed.sort(), ['실패이', '인증함'].sort(), '예외 참여자는 빼고');
  assert(!P().get('manual'), '인증 기록 없으면 명단에서 지움');
  assert(!store.col('s4_notifyEmails').get('nm'), '알림 메일 목록에서도');
  assert.equal(P().get('withsub').status, 'out', '인증 기록이 있으면 아웃으로 보존');
  assert.equal(find('쿠폰이').status, 'active');
  today = '2026-11-25';
  r = await post({ graceEnd: true, rows: [{ name: '새사람', email: 'new@x.com', phone: '010-2222-0001', status: 'out' }] });
  assert.deepEqual(r.body.outed, [], '시작일+3일이 지나면 안 함');

  // ── cohort를 주면 그날 시작하는 시즌만 — 없으면 409(지난 시즌에 넣지 않음) ──
  const before409 = P().size;
  let rr = await handler({ httpMethod: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ cohort: '2099-12-21', rows: [{ name: '미래', email: 'f@x.com', phone: '01099998888', status: 'paid' }] }) });
  assert.equal(rr.statusCode, 409);
  assert.equal(JSON.parse(rr.body).error, 'no-season');
  assert.equal(P().size, before409);
  rr = await handler({ httpMethod: 'GET', headers: { authorization: `Bearer ${TOKEN}` }, queryStringParameters: { list: '1', cohort: s4.startDate } });
  assert.equal(JSON.parse(rr.body).season, 's4');

  // ── 미리보기는 쓰지 않음 ──
  const before = P().size;
  r = await post({ dryRun: true, rows: [{ name: '미리', email: 'pre@x.com', phone: '010-3333-0001', status: 'paid' }] });
  assert.equal(P().size, before);
  assert.equal(r.body.added.length, 1);

  console.log('roster-auto(roster-import 확장): 모든 확인 통과');
})().catch((e) => { console.error(e); process.exit(1); });
