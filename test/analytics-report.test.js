// analytics-report: 운영진만·기록에 나온 멤버만 명단 확인·무료 한도 초과 안내, 그리고 읽기 줄이기
// (지난 날 기록은 기억해 두어 두 번째부터는 오늘·어제만 읽는다).
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('module'); const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'firebase-admin' ? 'firebase-admin-stub' : resolve.call(this, req, ...rest); };
require.cache['firebase-admin-stub'] = { id: 'firebase-admin-stub', loaded: true, exports: { firestore: { FieldPath: { documentId: () => '__id__' } } } };
const { makeStore } = require('./helpers/fakeFirestore');
const lib = path.join(__dirname, '../netlify/functions/_lib');
const store = makeStore(); const stats = { reads: 0, writes: 0 };
let admin = true, fail = null;
const raw = store.admin(stats);
const db = Object.assign({}, raw, { collection: (n) => { if (fail) throw fail; return raw.collection(n); }, getAll: (...a) => { if (fail) throw fail; return raw.getAll(...a); } });
require.cache[require.resolve(path.join(lib, 'firebaseAdmin.js'))] = { exports: { getDb: () => db } };
require.cache[require.resolve(path.join(lib, 'adminAuth.js'))] = { exports: {
  json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  requireAdmin: async () => (admin ? { email: 'a@b.c' } : { error: { statusCode: 403, body: '{"error":"운영진만"}' } })
} };
const { dateRange } = require(path.join(lib, 'analytics.js'));
const usage = require(path.join(lib, 'usageData.js'));
const { handler } = require('../netlify/functions/analytics-report.js');
const prefix = global.CS.pickSeason(global.CS.seasonNowKST()).dataPrefix;
const seasonId = global.CS.pickSeason(global.CS.seasonNowKST()).id;
const partCol = prefix ? `${prefix}_participants` : 'participants';

const all90 = dateRange(90);
// 최근 60일은 기록이 있고(멤버 3명), 앞 30일은 비어 있다
all90.slice(30).forEach((d, i) => store.col('analyticsDaily').set(d, { activeSec: 1000 + i, visits: 2, devices: { d1: 1000 }, members: { [`${seasonId}_p1`]: { season: seasonId, pid: 'p1', active: 600 }, [`${seasonId}_p2`]: { season: seasonId, pid: 'p2', active: 300 }, [`${seasonId}_gone`]: { season: seasonId, pid: 'gone', active: 100 } } }));
store.col(partCol).set('p1', { nickname: '김현우' }); store.col(partCol).set('p2', { nickname: '박지민' });
for (let i = 0; i < 12; i++) store.col('contentComments').set('c' + i, { createdAt: new Date(Date.now() - i * 5 * 864e5).toISOString() });

(async () => {
  const call = (days) => handler({ httpMethod: 'GET', headers: { authorization: 'Bearer x' }, queryStringParameters: { days: String(days) } });
  admin = false; assert.equal((await call(7)).statusCode, 403, '운영진만'); admin = true;

  // 90일을 처음 여는 한 번만 많이 읽는다(기록이 있는 60일 + 멤버 이름 3 + 댓글 12)
  usage._reset(); stats.reads = 0;
  let r = await call(90); assert.equal(r.statusCode, 200);
  const body = JSON.parse(r.body);
  assert.deepEqual(body.members.map((m) => m.name), ['김현우', '박지민'], '명단에 없는 ID는 뺌');
  assert.equal(body.days.length, 90);
  const first = stats.reads;
  assert(first >= 60 && first <= 90, '처음 90일: ' + first);

  // 다른 기간을 열면(보고서 캐시는 기간별) 지난 날 기록·멤버 이름·댓글은 기억해 둔 걸 쓴다 → 오늘 몇 건뿐
  for (const d of [7, 14, 30]) {
    stats.reads = 0;
    r = await call(d); assert.equal(r.statusCode, 200);
    assert(stats.reads <= 3, `${d}일 보고서가 새로 읽은 양: ${stats.reads}`);
    assert.equal(JSON.parse(r.body).days.length, d);
  }
  // 5분 안에 같은 기간을 또 열면 읽지 않는다
  stats.reads = 0; await call(7); assert.equal(stats.reads, 0);
  assert.deepEqual(JSON.parse((await call(30)).body).members.map((m) => m.name), ['김현우', '박지민']);
  assert.equal(JSON.parse((await call(7)).body).totals.comments, 2, '댓글은 기간 안(7일 안 2개)만 센다 — 90일치를 기억해 두고 걸러 씀');

  // [새로고침](fresh=1): 방금 쌓인 오늘 기록이 보이게 오늘·어제만 새로 읽는다
  const todayKey = dateRange(1)[0];
  store.col('analyticsDaily').set(todayKey, Object.assign({}, store.col('analyticsDaily').get(todayKey), { activeSec: 99999 }));
  stats.reads = 0;
  r = await handler({ httpMethod: 'GET', headers: { authorization: 'Bearer x' }, queryStringParameters: { days: '7', fresh: '1' } });
  assert(stats.reads >= 1 && stats.reads <= 4, '새로고침은 오늘·어제만 읽는다: ' + stats.reads);
  assert.equal(JSON.parse(r.body).days.at(-1).activeSec, 99999, '방금 쌓인 오늘 기록이 보인다');

  // 한도 초과는 안내 문구로
  usage._reset(); require('../netlify/functions/analytics-report.js')._reportCache.clear(); fail = Object.assign(new Error('8 RESOURCE_EXHAUSTED: Quota exceeded.'), {});
  r = await call(14); fail = null;
  assert.equal(r.statusCode, 503); assert.match(JSON.parse(r.body).error, /하루 무료 사용량.*오후 4시/);
  console.log(`analytics-report: 운영진만·명단에 없는 ID 제외·처음 90일 ${first}건 읽고 이후 기간별 보고서는 3건 이하·5분 캐시·한도 초과 안내 통과`);
})().catch((e) => { console.error(e); process.exit(1); });
