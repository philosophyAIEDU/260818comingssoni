// js/feed-client.js: 날짜 범위·덧씌움(내 글/추천)·정렬·실패 시 예외를 가짜 fetch/localStorage로 확인한다.
const assert = require('node:assert/strict');
const path = require('node:path');
global.window = global;
const mem = {};
global.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
require('../js/config.js'); require('../js/utils.js'); require('../js/feed-client.js');
const CS = global.CS, U = CS.U, FC = CS.FeedClient;
const today = U.today();
// 오늘이 시즌 9일차가 되도록 맞춘다
CS.CONFIG = Object.assign({}, CS.CONFIG, { seasonId: 'sT', startDate: U.addDays(today, -8), endDate: U.addDays(today, 19), retroUntil: undefined, storagePrefix: 'test.s' });
const fetched = []; let server = {}; let fail = null;
global.fetch = async (url) => {
  const u = new URL(url, 'http://x'); const q = Object.fromEntries(u.searchParams);
  fetched.push(q);
  if (fail) return { ok: false, status: fail };
  if (q.kind === 'roster') return { ok: true, json: async () => ({ at: 1, rows: server.roster || [] }) };
  return { ok: true, json: async () => ({ at: server.at || 1, rows: (server.days && server.days[q.date]) || [] }) };
};

(async () => {
  assert.equal(FC.enabled(), false, '멤버 화면이 켜기 전엔 꺼져 있다'); CS.FEED_API = true; assert.equal(FC.enabled(), true);
  server.roster = [{ id: 'b', nickname: '하나' }, { id: 'a', nickname: '가나' }];
  assert.deepEqual((await FC.roster()).map((r) => r.id), ['a', 'b'], '가나다 순');
  assert.deepEqual(fetched[0], { kind: 'roster', season: 'sT' });

  // 날짜 범위: 없음=시즌 시작~오늘, 날짜 하나, from/to, 시작 전·오늘 이후는 잘림
  assert.equal(FC.datesFor({}).length, 9);
  assert.deepEqual(FC.datesFor({ date: today }), [today]);
  assert.deepEqual(FC.datesFor({ from: U.addDays(today, -1) }), [U.addDays(today, -1), today]);
  assert.equal(FC.datesFor({ from: U.addDays(today, -30), to: U.addDays(today, 5) }).length, 9);
  assert.deepEqual(FC.datesFor({ date: U.addDays(today, -20) }), [], '시즌 시작 7일보다 앞 날짜는 요청하지 않는다');
  assert.deepEqual(FC.datesFor({ date: U.addDays(today, -10) }), [U.addDays(today, -10)], '시작 직전(연습) 날짜는 콕 집으면 받는다');

  // 목록 합치기·정렬(날짜 → 작성 시각), 필터
  const d1 = U.addDays(today, -1);
  server.days = { [today]: [{ id: 't2', date: today, createdAt: '2', participantId: 'p2' }, { id: 't1', date: today, createdAt: '1', participantId: 'p1' }], [d1]: [{ id: 'y1', date: d1, createdAt: '9', participantId: 'p1' }] };
  fetched.length = 0;
  assert.deepEqual((await FC.submissions({ from: d1 })).map((r) => r.id), ['y1', 't1', 't2']);
  assert.equal(fetched.length, 2, '날짜마다 1번 요청');
  assert.deepEqual((await FC.submissions({ date: today })).map((r) => r.id), ['t1', 't2']);
  fetched.length = 0;
  assert.deepEqual((await FC.submissions({ participantId: 'p1' })).map((r) => r.id), ['y1', 't1'], '내 글만(전체 기간에서)');
  assert.equal(await FC.submissions({ participantId: 'p1', date: today }), null, '저장 직전 확인은 Firestore에서 바로(null)');

  // 덧씌움: 내가 방금 쓴 글은 서버 목록이 옛것이어도 보인다
  FC.remember({ id: 'mine', date: today, participantId: 'p9', createdAt: '5', sentence: '내 글' });
  let rows = await FC.submissions({ date: today });
  assert.deepEqual(rows.map((r) => r.id).sort(), ['mine', 't1', 't2']);
  // 내 글을 고치면(같은 id) 고친 내용으로
  FC.remember({ id: 'mine', date: today, participantId: 'p9', createdAt: '5', sentence: '고친 글' });
  assert.equal((await FC.submissions({ date: today })).find((r) => r.id === 'mine').sentence, '고친 글');
  // 내 추천: 서버가 옛 추천 수를 줘도 내 화면은 그대로
  server.days[today][0] = { id: 't2', date: today, createdAt: '2', participantId: 'p2', upvotes: 0, upvotedBy: [] };
  FC.remember({ id: 't2', date: today, createdAt: '2', participantId: 'p2', upvotes: 1, upvotedBy: ['cli_me'] });
  const voted = (await FC.submissions({ date: today })).find((r) => r.id === 't2');
  assert.deepEqual([voted.upvotes, voted.upvotedBy], [1, ['cli_me']]);
  // 다른 날짜 목록에는 섞이지 않는다
  assert(!(await FC.submissions({ date: d1 })).some((r) => r.id === 'mine' || r.id === 't2'));
  // 서버 스냅샷이 내 쓰기보다 한참 뒤에 만들어졌으면(이미 들어 있다) 덧씌움을 거둔다 — 다른 사람의 새 추천이 보이게
  server.at = Date.now() + 10 * 60e3;
  server.days[today][0] = { id: 't2', date: today, createdAt: '2', participantId: 'p2', upvotes: 5, upvotedBy: ['cli_me', 'x', 'y'] };
  assert.equal((await FC.submissions({ date: today })).find((r) => r.id === 't2').upvotes, 5);
  assert.equal(Object.keys(FC._loadRecent()).length, 0, '거둔 덧씌움은 기억에서도 지운다');
  // 하루가 지난 기록은 버린다
  mem['test.s.recentWrites.v1'] = JSON.stringify({ old: { sub: { id: 'old', date: today }, at: Date.now() - 25 * 3600e3 } });
  assert.deepEqual(FC._loadRecent(), {});
  mem['test.s.recentWrites.v1'] = '깨진 JSON';
  assert.deepEqual(FC._loadRecent(), {}, '저장값이 깨져도 동작');

  // 서버가 실패하면 예외 → store-firebase.js가 Firestore에서 직접 읽는다
  fail = 503;
  await assert.rejects(FC.roster(), /feed-read 503/);
  await assert.rejects(FC.submissions({ date: today }), /feed-read 503/);
  fail = null;
  console.log('feed-client: 날짜 범위·정렬·내 글/수정/추천 덧씌움(스냅샷이 따라오면 거둠)·참여자+날짜는 직접 읽기·깨진 저장값·서버 실패 시 예외 통과');
})().catch((e) => { console.error(e); process.exit(1); });
