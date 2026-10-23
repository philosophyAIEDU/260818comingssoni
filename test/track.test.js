// track 함수: Firebase 무료 요금제 한도를 아끼도록 묶음마다 쓰기 1번·읽기 0번. 이름은 보고서에서 명단으로 찾는다.
const assert = require('node:assert/strict');
const path = require('node:path');
const lib = path.join(__dirname, '../netlify/functions/_lib');
// firebase-admin은 설치 없이도 돌도록 증가값만 흉내 낸다
const Module = require('module'); const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'firebase-admin' ? 'firebase-admin-stub' : resolve.call(this, req, ...rest); };
require.cache['firebase-admin-stub'] = { id: 'firebase-admin-stub', loaded: true, exports: { firestore: { FieldValue: { increment: (v) => ({ inc: v }) } } } };
const writes = [], reads = [];
const roster = { 'p1': { nickname: '김현우', status: 'active' } };
const db = {
  collection: (name) => ({
    doc: (id) => ({
      get: async () => { reads.push(`${name}/${id}`); const v = name.endsWith('participants') ? roster[id] : undefined; return { exists: !!v, data: () => v }; },
      set: async (data, opts) => { writes.push({ name, id, data, opts }); }
    })
  })
};
require.cache[require.resolve(path.join(lib, 'firebaseAdmin.js'))] = { exports: { getDb: () => db } };
const { handler } = require('../netlify/functions/track.js');
(async () => {
  const season = global.CS.pickSeason(global.CS.seasonNowKST());
  const send = (body) => handler({ httpMethod: 'POST', body: JSON.stringify(body) });
  const D = 'b'.repeat(32);
  assert.equal((await handler({ httpMethod: 'GET' })).statusCode, 405);
  assert.equal((await send({ d: 'x', p: 'index', active: 5 })).statusCode, 204);
  assert.equal(writes.length, 0, '이상한 묶음은 저장하지 않음');
  await send({ d: D, p: 'index', active: 40, m: { p: 'p1', s: season.id } });
  assert.equal(writes.length, 1); assert.equal(writes[0].name, 'analyticsDaily'); assert.deepEqual(writes[0].opts, { merge: true });
  assert.deepEqual(writes[0].data.members[`${season.id}_p1`], { season: season.id, pid: 'p1', active: { inc: 40 }, play: { inc: 0 }, read: { inc: 0 } });
  assert.deepEqual(reads, [], '받을 때는 명단을 읽지 않음(읽기 0번)');
  await send({ d: D, p: 'index', active: 10, m: { p: 'p1', s: 'nope' } });
  assert.equal(writes[1].data.members, undefined, '없는 시즌은 멤버로 더하지 않음');
  assert.deepEqual(writes[1].data.activeSec, { inc: 10 });
  console.log('track: 묶음당 쓰기 1번·읽기 0번·참여자 ID와 시즌만 저장(이름은 보고서에서)·없는 시즌은 버림 통과');
})().catch((e) => { console.error(e); process.exit(1); });
