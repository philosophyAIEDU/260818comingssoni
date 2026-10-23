// analytics-report 함수: 운영진만, 기록에 나온 멤버만 명단에서 이름을 찾고(없는 ID는 뺌), 5분 캐시, 한도 초과는 안내 문구로.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('module'); const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'firebase-admin' ? 'firebase-admin-stub' : resolve.call(this, req, ...rest); };
require.cache['firebase-admin-stub'] = { id: 'firebase-admin-stub', loaded: true, exports: { firestore: { FieldPath: { documentId: () => '__id__' } } } };
const lib = path.join(__dirname, '../netlify/functions/_lib');
let admin = true, fail = null;
const reads = { daily: 0, getAll: 0, comments: 0 };
require.cache[require.resolve(path.join(lib, 'adminAuth.js'))] = { exports: {
  json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  requireAdmin: async () => (admin ? { email: 'a@b.c' } : { error: { statusCode: 403, body: '{"error":"운영진만"}' } })
} };
const { dateRange } = require(path.join(lib, 'analytics.js'));
const today = dateRange(1)[0];
const docs = { [today]: { activeSec: 600, members: { s3_p1: { season: 's3', pid: 'p1', active: 400 }, s3_gone: { season: 's3', pid: 'gone', active: 200 } } } };
const roster = { p1: { nickname: '김현우' } };
const query = (name) => {
  const q = { where: () => q, get: async () => {
    if (fail) throw fail;
    if (name === 'analyticsDaily') { reads.daily++; return { docs: Object.entries(docs).map(([id, v]) => ({ id, data: () => v })) }; }
    reads.comments++; return { docs: [] };
  } };
  return q;
};
const db = {
  collection: (name) => Object.assign(query(name), { doc: (id) => ({ name, id }) }),
  getAll: async (...refs) => { reads.getAll += refs.length; return refs.map((r) => ({ exists: !!roster[r.id], data: () => roster[r.id] })); }
};
require.cache[require.resolve(path.join(lib, 'firebaseAdmin.js'))] = { exports: { getDb: () => db } };
const { handler } = require('../netlify/functions/analytics-report.js');
(async () => {
  const call = (days) => handler({ httpMethod: 'GET', headers: { authorization: 'Bearer x' }, queryStringParameters: { days: String(days) } });
  admin = false;
  assert.equal((await call(7)).statusCode, 403, '운영진만');
  admin = true;
  let r = await call(7);
  assert.equal(r.statusCode, 200);
  const body = JSON.parse(r.body);
  assert.deepEqual(body.members.map((m) => [m.name, m.activeSec]), [['김현우', 400]], '명단에 없는 ID는 뺌');
  assert.deepEqual(reads, { daily: 1, getAll: 2, comments: 1 }, '기록에 나온 멤버만 하나씩 읽음');
  await call(7);
  assert.deepEqual(reads, { daily: 1, getAll: 2, comments: 1 }, '5분 안 같은 기간은 다시 읽지 않음');
  fail = Object.assign(new Error('8 RESOURCE_EXHAUSTED: Quota exceeded.'), {});
  r = await call(30);
  assert.equal(r.statusCode, 503); assert.match(JSON.parse(r.body).error, /하루 무료 사용량.*오후 4시/);
  console.log('analytics-report: 운영진만·기록에 나온 멤버만 명단 확인·5분 캐시·무료 한도 초과 안내 통과');
})().catch((e) => { console.error(e); process.exit(1); });
