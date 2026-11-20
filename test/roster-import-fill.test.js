// 이름만 넣어 둔 참여자(이메일·전화 없음)에게 roster-import가 이메일·전화를 채운다(새로 만들지 않는다)
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('module'); const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'firebase-admin' ? 'firebase-admin-stub' : resolve.call(this, req, ...rest); };
require.cache['firebase-admin-stub'] = { id: 'firebase-admin-stub', loaded: true, exports: {} };
const { makeStore } = require('./helpers/fakeFirestore');
const lib = path.join(__dirname, '../netlify/functions/_lib');
const store = makeStore(); const db = store.admin({ reads: 0, writes: 0 });
require.cache[require.resolve(path.join(lib, 'firebaseAdmin.js'))] = { exports: { getDb: () => db } };
require(path.join(lib, 'appLogic.js'));
const CS = global.CS;
const { importRoster } = require(path.join(lib, 'rosterImport.js'));
(async () => {
  const cfg = CS.configFor('s4');
  const P = 's4_participants';
  store.col(P).set('a', { nickname: '홍길동', email: '', phone: '', status: 'active' });
  store.col(P).set('b', { nickname: '김있음', email: 'kim@x.com', phone: '', status: 'active' });
  const r = await importRoster(db, CS, cfg, [
    { name: '홍길동', email: 'hong@x.com', phone: '010-1111-2222' },
    { name: '김있음', email: 'other@x.com', phone: '01033334444' }
  ]);
  assert.deepEqual(r.filled, ['홍길동']);
  assert.equal(store.col(P).get('a').email, 'hong@x.com');
  assert.equal(store.col(P).get('a').phone, '01011112222');
  assert.deepEqual(r.added.map((x) => x.nickname), ['김있음(4444)'], '이메일이 다른 동명이인은 다른 사람');
  console.log('roster-import 이름만 있는 참여자 채우기: 통과');
})().catch((e) => { console.error(e); process.exit(1); });
