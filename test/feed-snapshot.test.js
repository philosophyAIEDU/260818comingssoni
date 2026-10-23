// 읽기 줄이기(feedSnapshot·feed-read): 가짜 Firestore로 "문서를 몇 번 읽었나"를 세며 확인한다.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('module'); const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'firebase-admin' ? 'firebase-admin-stub' : resolve.call(this, req, ...rest); };
require.cache['firebase-admin-stub'] = { id: 'firebase-admin-stub', loaded: true, exports: {} };
const lib = path.join(__dirname, '../netlify/functions/_lib');

/* ── 가짜 Firestore: 컬렉션별 문서, 읽은 문서 수(reads) 계산 ── */
const store = {}; const stats = { reads: 0, writes: 0 };
const col = (n) => (store[n] = store[n] || new Map());
const dsnap = (id, v) => ({ id, exists: v !== undefined, data: () => (v === undefined ? undefined : JSON.parse(JSON.stringify(v))) });
const db = {
  collection: (name) => ({
    doc: (id) => ({ _n: name, _id: id,
      get: async () => { stats.reads++; return dsnap(id, col(name).get(id)); },
      set: async (v, o) => { stats.writes++; col(name).set(id, o && o.merge ? Object.assign({}, col(name).get(id), v) : v); } }),
    where: (f, op, v) => ({ get: async () => { const docs = [...col(name)].filter(([, d]) => d[f] === v); stats.reads += docs.length; return { docs: docs.map(([id, d]) => dsnap(id, d)) }; } }),
    get: async () => { const docs = [...col(name)]; stats.reads += docs.length; return { docs: docs.map(([id, d]) => dsnap(id, d)) }; }
  }),
  runTransaction: async (fn) => fn({ get: async (ref) => { stats.reads++; return dsnap(ref._id, col(ref._n).get(ref._id)); }, set: (ref, v, o) => { stats.writes++; col(ref._n).set(ref._id, o && o.merge ? Object.assign({}, col(ref._n).get(ref._id), v) : v); } })
};
let admin = true;
require.cache[require.resolve(path.join(lib, 'firebaseAdmin.js'))] = { exports: { getDb: () => db } };
require.cache[require.resolve(path.join(lib, 'adminAuth.js'))] = { exports: {
  json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  requireAdmin: async () => (admin ? { email: 'a@b.c' } : { error: { statusCode: 403, body: '{"error":"운영진만"}' } }) } };
const snap = require(path.join(lib, 'feedSnapshot.js'));
const { handler } = require('../netlify/functions/feed-read.js');
const U = global.CS.U;
const season = global.CS.pickSeason(global.CS.seasonNowKST());
const prefix = season.dataPrefix ? season.dataPrefix + '_' : '';
const today = U.today(), yesterday = U.addDays(today, -1), old = U.addDays(today, -5);

(async () => {
  for (let i = 0; i < 150; i++) col(prefix + 'participants').set('p' + i, { nickname: '멤버' + String(i).padStart(3, '0'), status: 'active', joinDate: season.startDate, exemptDates: [], email: `m${i}@x.com`, phone: '010-0000-' + i, note: '개인 메모', kakaoJoined: 'O', giftSentAt: 'x', seasonStreak: 2 });
  for (let i = 0; i < 120; i++) col(prefix + 'submissions').set('s' + i, { participantId: 'p' + i, nickname: '멤버', date: today, sentence: '문장 ' + i, reflection: '느낀 점 '.repeat(40), upvotes: 3, upvotedBy: ['cli_a', 'cli_b'], createdAt: `2026-10-23T0${i % 10}:00:00` });
  col(prefix + 'submissions').set('y1', { participantId: 'p1', date: yesterday, sentence: '어제', createdAt: 'x' });
  col(prefix + 'submissions').set('o1', { participantId: 'p1', date: old, sentence: '예전', createdAt: 'x' });
  const get = (q) => handler({ httpMethod: 'GET', queryStringParameters: q });
  const parse = (r) => JSON.parse(r.body);

  // 명단: 멤버 앱에 필요한 필드만(이메일·전화번호·메모·카톡 여부는 내려가지 않는다)
  let r = await get({ kind: 'roster', season: season.id });
  assert.equal(r.statusCode, 200);
  let body = parse(r);
  assert.equal(body.rows.length, 150);
  assert.deepEqual(Object.keys(body.rows[0]).sort(), ['exemptDates', 'id', 'joinDate', 'nickname', 'seasonStreak', 'status']);
  assert(!r.body.includes('@x.com') && !r.body.includes('010-') && !r.body.includes('개인 메모'), '개인정보 없음');
  assert.match(r.headers['Cache-Control'], /s-maxage=120/);
  const firstReads = stats.reads;
  assert(firstReads >= 150 && firstReads < 160, '처음 한 번만 명단을 읽는다: ' + firstReads);

  // 같은 요청이 아무리 많아도 다시 읽지 않는다(서버 메모리 → 스냅샷 문서)
  stats.reads = 0;
  for (let i = 0; i < 300; i++) await get({ kind: 'roster', season: season.id });
  assert.equal(stats.reads, 0, '300번 요청해도 읽기 0건');
  snap._memory.clear(); stats.reads = 0;
  for (let i = 0; i < 5; i++) { snap._memory.clear(); await get({ kind: 'roster', season: season.id }); }
  assert.equal(stats.reads, 5, '다른 서버 인스턴스가 받아도 스냅샷 문서 1건씩');

  // 오늘 글: 120건을 한 번만 읽고, 이후는 스냅샷 1건
  stats.reads = 0; snap._memory.clear();
  body = parse(await get({ kind: 'day', season: season.id, date: today }));
  assert.equal(body.rows.length, 120);
  assert(stats.reads >= 120 && stats.reads < 125, '오늘 글 첫 읽기: ' + stats.reads);
  stats.reads = 0;
  for (let i = 0; i < 200; i++) await get({ kind: 'day', season: season.id, date: today });
  assert.equal(stats.reads, 0);
  assert.match((await get({ kind: 'day', season: season.id, date: today })).headers['Cache-Control'], /max-age=30,/);
  assert.match((await get({ kind: 'day', season: season.id, date: yesterday })).headers['Cache-Control'], /max-age=300,/);
  assert.match((await get({ kind: 'day', season: season.id, date: old })).headers['Cache-Control'], /max-age=3600,/);

  // 시간이 지나면(TTL) 다시 읽는다 — 가짜 시계: 오늘 글 10분, 지난 글 24시간
  const clock = { t: Date.now() };
  const now = () => clock.t;
  snap._memory.clear();
  const sn = season;
  const reads = async (date) => { stats.reads = 0; await snap.getDay(db, sn, date, today, U.addDays, now); return stats.reads; };
  assert(await reads(today) <= 2, '스냅샷이 이미 있다');
  clock.t += 9 * 60e3; assert(await reads(today) <= 2, '9분: 그대로');
  snap._memory.clear(); clock.t += 2 * 60e3; assert(await reads(today) >= 120, '11분: 다시 읽는다');
  snap._memory.clear(); clock.t += 60 * 60e3; assert(await reads(old) >= 1 && (await reads(old)) <= 2, '지난 글은 1시간 뒤에도 그대로');
  snap._memory.clear(); clock.t += 10 * 3600e3; assert(await reads(old) <= 2, '12시간 안엔 2~6일 전 글도 그대로');
  snap._memory.clear(); clock.t += 2 * 3600e3; assert(await reads(old) >= 1, '13시간 뒤 2~6일 전 글은 다시 읽는다(12시간)');
  const longAgo = U.addDays(today, -12);
  col(prefix + 'submissions').set('l1', { participantId: 'p1', date: longAgo, sentence: '오래전', createdAt: 'x' });
  snap._memory.clear(); await reads(longAgo); snap._memory.clear(); clock.t += 60 * 3600e3; assert(await reads(longAgo) <= 2, '일주일 넘은 글은 3일 안엔 그대로');
  snap._memory.clear(); clock.t += 13 * 3600e3; assert(await reads(longAgo) >= 1, '3일(72시간) 뒤엔 다시 읽는다');

  // 동시에 오래된 스냅샷을 받으면 다시 읽는 건 한 명(리스) — 나머지는 직전 스냅샷
  snap._memory.clear(); clock.t += 11 * 60e3; stats.reads = 0;
  const results = await Promise.all(Array.from({ length: 20 }, () => snap.getDay(db, sn, today, today, U.addDays, now)));
  assert(results.every((x) => x.rows.length === 120), '모두 목록을 받았다');
  // (가짜 DB는 트랜잭션을 직렬화하지 않으므로, 여기서는 "오류 없이 모두 받는다"까지만 본다. 실제 리스는 아래 단독 시험)
  stats.reads = 0; snap._memory.clear();
  const key = snap.dayKey(season.id, today);
  const cur = col('feedSnapshots').get(key);
  col('feedSnapshots').set(key, Object.assign({}, cur, { at: 0, leaseUntil: clock.t + 20000 })); // 누가 다시 읽는 중
  const during = await snap.readThrough(db, key, snap.TTL.today, async () => { throw new Error('다시 읽지 않아야 함'); }, now);
  assert.equal(during.rows.length, 120, '리스가 잡혀 있으면 직전 스냅샷을 그대로 준다');

  // 다시 읽다가 실패(한도 초과 등)해도 직전 스냅샷으로 버틴다
  col('feedSnapshots').set(key, Object.assign({}, col('feedSnapshots').get(key), { at: 0, leaseUntil: 0 }));
  snap._memory.clear();
  const fallback = await snap.readThrough(db, key, snap.TTL.today, async () => { throw new Error('8 RESOURCE_EXHAUSTED'); }, now);
  assert.equal(fallback.rows.length, 120, '읽기 실패 → 직전 스냅샷');
  assert.equal(col('feedSnapshots').get(key).leaseUntil, 0, '실패하면 리스를 푼다');
  await assert.rejects(snap.readThrough(db, 'nothing', 1000, async () => { throw new Error('boom'); }, now), /boom/, '직전 스냅샷도 없으면 오류');

  // 글이 있을 수 없는 날짜·모르는 시즌은 읽지 않는다
  stats.reads = 0;
  assert.equal((await get({ kind: 'day', season: season.id, date: '1999-01-01' })).statusCode, 200);
  assert.deepEqual(parse(await get({ kind: 'day', season: season.id, date: '2099-01-01' })).rows, []);
  assert.equal((await get({ kind: 'day', season: season.id, date: "2026-10-23'; drop" })).statusCode, 200);
  assert.equal(stats.reads, 0, '범위 밖 날짜는 Firestore를 읽지 않음');
  assert.equal((await get({ kind: 'roster', season: 'sX' })).statusCode, 400);
  assert.equal((await get({ kind: 'nope', season: season.id })).statusCode, 400);

  // 운영진이 명단을 고치면 다음 요청이 바로 다시 읽는다. 운영진이 아니면 거절
  admin = false;
  assert.equal((await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ season: season.id, roster: true }) })).statusCode, 403);
  admin = true;
  col(prefix + 'participants').set('pNew', { nickname: '새멤버', status: 'active', joinDate: today, exemptDates: [] });
  r = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer x' }, body: JSON.stringify({ season: season.id, roster: true, dates: [today, '1999-01-01'] }) });
  assert.deepEqual(parse(r), { invalidated: 2 }, '범위 밖 날짜는 무시');
  assert.equal(parse(await get({ kind: 'roster', season: season.id })).rows.length, 151, '명단 변경이 바로 보임');

  // 너무 큰 스냅샷은 저장하지 않고 그대로 준다(서버 메모리 45초만)
  stats.reads = 0; snap._memory.clear();
  const big = await snap.readThrough(db, 'big', 1000, async () => Array.from({ length: 4000 }, (_, i) => ({ id: i, t: require('crypto').randomBytes(300).toString('hex') })), now);
  assert.equal(big.rows.length, 4000); assert.equal(col('feedSnapshots').get('big').z, undefined, '너무 커서 저장하지 않음');
  console.log('읽기 줄이기: 명단 개인정보 제외·목록은 한 번만 읽고 300번 요청해도 읽기 0건·TTL(명단 30분/오늘 10분/어제 45분/2~6일 전 12시간/그 이전 3일)·리스·읽기 실패 시 직전 스냅샷·범위 밖 날짜 무시·운영진 갱신·큰 스냅샷 통과');
})().catch((e) => { console.error(e); process.exit(1); });
