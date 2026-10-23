// track 함수: 참여자 ID가 그 시즌 명단에 있을 때만 인증 이름으로 멤버별 이용량에 더한다.
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
  const col = season.dataPrefix ? `${season.dataPrefix}_participants` : 'participants';
  const send = (body) => handler({ httpMethod: 'POST', body: JSON.stringify(body) });
  const D = 'b'.repeat(32);
  assert.equal((await handler({ httpMethod: 'GET' })).statusCode, 405);
  assert.equal((await send({ d: 'x', p: 'index', active: 5 })).statusCode, 204);
  assert.equal(writes.length, 0, '이상한 묶음은 저장하지 않음');
  await send({ d: D, p: 'index', active: 40, m: { p: 'p1', s: season.id } });
  assert.equal(writes.length, 1); assert.equal(writes[0].name, 'analyticsDaily'); assert.deepEqual(writes[0].opts, { merge: true });
  const key = `${season.id}_p1`;
  assert.equal(writes[0].data.members[key].name, '김현우', '명단의 인증 이름');
  assert.deepEqual(reads, [`${col}/p1`]);
  await send({ d: D, p: 'content', active: 20, m: { p: 'p1', s: season.id } });
  assert.equal(reads.length, 1, '확인한 이름은 잠시 기억');
  await send({ d: D, p: 'index', active: 10, m: { p: 'ghost', s: season.id } });
  assert.equal(writes[2].data.members, undefined, '명단에 없는 ID는 이름 없이');
  assert.deepEqual(writes[2].data.activeSec, { inc: 10 });
  await send({ d: D, p: 'index', active: 10, m: { p: 'p1', s: 'nope' } });
  assert.equal(writes[3].data.members, undefined, '없는 시즌');
  console.log('track: 명단에 있는 참여자만 인증 이름으로 연결·이름 확인 캐시·없는 ID/시즌은 이름 없이 통과');
})().catch((e) => { console.error(e); process.exit(1); });
