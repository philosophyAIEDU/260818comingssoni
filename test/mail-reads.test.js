// 예약 메일(21시 리마인드·00:10 경고)이 인증글 전체 대신 날짜별 스냅샷으로 읽어도 같은 사람에게 보내는지, 읽기는 얼마나 줄었는지.
process.env.CS_SEASON = 's1';
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('module'); const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'firebase-admin' ? 'firebase-admin-stub' : resolve.call(this, req, ...rest); };
require.cache['firebase-admin-stub'] = { id: 'firebase-admin-stub', loaded: true, exports: {} };
const { makeStore } = require('./helpers/fakeFirestore');
const lib = path.join(__dirname, '../netlify/functions/_lib');

const store = makeStore();
const stats = { reads: 0, writes: 0 };
let breakSnapshots = false;
const raw = store.admin(stats);
const db = Object.assign({}, raw, {
  collection: (name) => { if (breakSnapshots && name === 'feedSnapshots') throw new Error('스냅샷 장애'); return raw.collection(name); }
});
require.cache[require.resolve(path.join(lib, 'firebaseAdmin.js'))] = { exports: { getDb: () => db } };
const sent = [];
require.cache[require.resolve(path.join(lib, 'mailer.js'))] = { exports: { sendMail: async (m) => { sent.push(m.to); }, sleep: async () => {}, closePool: async () => {} } };
require.cache[require.resolve(path.join(lib, 'solapi.js'))] = { exports: { sendSms: async () => {}, normalizePhone: (x) => x } };
const { CONFIG, U } = require(path.join(lib, 'appLogic.js'));
const { runDailyReminder } = require(path.join(lib, 'dailyReminder.js'));
const { runMissed5Warning } = require(path.join(lib, 'missed5Warning.js'));
const snap = require(path.join(lib, 'feedSnapshot.js'));

// 오늘이 시즌 9일차(시작 8일 전)가 되도록 같은 설정 객체를 맞춘다
const today = U.today(); const shift = (n) => U.addDays(today, n);
CONFIG.startDate = shift(-8); CONFIG.endDate = shift(19);
Object.assign(global.CS.SEASONS.find((s) => s.id === 's1'), { startDate: CONFIG.startDate, endDate: CONFIG.endDate });
const prefix = CONFIG.dataPrefix ? CONFIG.dataPrefix + '_' : '';

const P = 150;
for (let i = 0; i < P; i++) store.col(prefix + 'participants').set('p' + i, { nickname: '멤버' + i, email: `m${i}@x.com`, status: 'active', joinDate: CONFIG.startDate, exemptDates: [], exemptLog: {} });
let n = 0;
const sub = (i, date) => store.col(prefix + 'submissions').set('s' + (n++), { participantId: 'p' + i, nickname: '멤버' + i, date, sentence: '문장', createdAt: `${date}T10:00:00`, updatedAt: `${date}T10:00:00` });
const days = U.dateRange(CONFIG.startDate, today);
// p0~p99: 매일(오늘 포함) 인증 / p100~p129: 어제까지는 인증, 오늘은 아직 / p130~p139: 4일만 인증(누락 5회) / p140~p149: 거의 안 냄
for (const d of days) {
  for (let i = 0; i < 100; i++) sub(i, d);
  if (d !== today) for (let i = 100; i < 130; i++) sub(i, d);
}
for (const d of days.slice(0, 3)) for (let i = 130; i < 140; i++) sub(i, d); // 어제까지 8일 중 3일만 → 누락 5회
const totalSubs = n;

(async () => {
  // ── 21시 리마인드: 오늘 아직 안 낸 사람에게만 ──
  const expected = new Set();
  for (let i = 100; i < 150; i++) expected.add(`m${i}@x.com`);
  const clearReminded = () => { for (const [, d] of store.col(prefix + 'participants')) delete d.remindedAt; };
  // 첫 실행은 스냅샷이 아직 없어 전부 읽는다(이후 멤버 화면·다른 예약 작업과 함께 쓴다)
  sent.length = 0;
  const first = await runDailyReminder();
  assert.deepEqual(new Set(sent), expected, '오늘 인증 안 한 50명'); assert.equal(first.candidates, 50);
  // 스냅샷이 있는 두 번째부터는 오늘·어제만 새로 읽는다
  clearReminded(); stats.reads = 0; sent.length = 0;
  const r1 = await runDailyReminder();
  const cheapReads = stats.reads;
  assert.deepEqual(new Set(sent), expected); assert.equal(r1.candidates, 50);
  assert(cheapReads < 650, `스냅샷으로 읽은 양: ${cheapReads} (인증글 ${totalSubs}건 + 명단 ${P}건을 직접 읽으면 ${totalSubs + P}건)`);

  // 같은 일을 전부 직접 읽는 방식(스냅샷 장애 시 대체 경로)이면 같은 사람이어야 하고 읽기는 더 많다
  clearReminded();
  breakSnapshots = true; stats.reads = 0; sent.length = 0;
  const r2 = await runDailyReminder();
  breakSnapshots = false;
  assert.deepEqual(new Set(sent), expected, '직접 읽어도 같은 사람');
  assert(stats.reads > cheapReads * 1.5, `직접 읽으면 더 많이 읽는다: ${stats.reads} vs ${cheapReads}`);
  assert.equal(r2.candidates, 50);

  // 방금 오늘 인증한 사람은 스냅샷이 옛것이어도 제외된다(오늘 목록은 늘 새로 읽는다)
  clearReminded();
  sub(100, today);
  sent.length = 0;
  await runDailyReminder();
  assert(!sent.includes('m100@x.com'), '방금 인증한 사람에게는 보내지 않는다');
  assert.equal(sent.length, 49);

  // ── 00:10 경고: 누락이 정확히 5회가 된 사람 ──
  sent.length = 0; stats.reads = 0;
  const wm = await runMissed5Warning();
  const warnReads = stats.reads;
  const warned = new Set(sent);
  const direct = new Set();
  // 같은 계산을 전부 직접 읽어서
  breakSnapshots = true;
  for (const [id, d] of store.col(prefix + 'participants')) delete d.warned5At;
  sent.length = 0; stats.reads = 0;
  await runMissed5Warning();
  breakSnapshots = false;
  sent.forEach((x) => direct.add(x));
  assert.deepEqual(warned, direct, '스냅샷으로 읽어도 경고 대상이 같다');
  assert(warned.size > 0 && [...warned].every((e) => /^m1[34]\d@x\.com$/.test(e)), '누락 5회인 p130~p139: ' + [...warned].slice(0, 3));
  assert(warnReads < 700, '경고 함수 읽기: ' + warnReads);
  console.log(`예약 메일 읽기: 인증글 ${totalSubs}건 대신 스냅샷으로 리마인드 ${cheapReads}건·경고 ${warnReads}건 읽음(직접 읽으면 ${stats.reads}건)·보내는 사람은 직접 읽을 때와 같음·방금 인증한 사람 제외·스냅샷 장애 시 직접 읽기 통과`);
})().catch((e) => { console.error(e); process.exit(1); });
