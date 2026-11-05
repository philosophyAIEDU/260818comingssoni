// 이용 통계: 받은 묶음 검사·하루 문서에 더할 값·보고서 집계를 검증한다.
const assert = require('node:assert/strict');
const { sanitizeBeacon, toUpdate, buildReport, dateRange, itemKey, kstParts, memberRefs, popularity } = require('../netlify/functions/_lib/analytics');
const DEV = 'a'.repeat(32);

assert.equal(sanitizeBeacon(null), null);
assert.equal(sanitizeBeacon({ d: 'not-hex', p: 'index', active: 10 }), null, '기기 ID 형식');
assert.equal(sanitizeBeacon({ d: DEV, p: 'admin', active: 10 }), null, '운영진 화면 등 정해진 화면만');
assert.equal(sanitizeBeacon({ d: DEV, p: 'index', active: 0 }), null, '빈 묶음');
const b = sanitizeBeacon({ d: DEV, p: 'content', visit: 1, active: 99999, nickname: '김현우', items: {
  'v:xmd2_HKMgCU': { t: '  영상\n제목 ', n: 1, open: 40, play: 35 },
  'c:/p/50/': { t: '칼럼', n: 1, read: 120, done: 1 },
  'v:../../etc': { n: 1 }, 'x:1': { n: 1 }, 'c:/p/51/': { t: '빈 항목' }
} });
assert.equal(b.active, 900, '한 번에 최대 15분');
assert.equal(b.visit, 1);
assert.match(b.device, /^[a-f0-9]{16}$/); assert.notEqual(b.device, DEV.slice(0, 16), '기기 ID는 해시로');
assert(!JSON.stringify(b).includes('김현우'), '이름 같은 다른 값은 버린다');
assert.deepEqual(b.items.map((i) => i.key), ['v_xmd2_HKMgCU', 'c_p_50']);
assert.equal(b.items[0].title, '영상 제목');
assert.deepEqual(itemKey('c:/api/v1.0/emails/share/abc'), { key: 'c_api_v1_0_emails_share_abc', kind: 'column' });

const inc = (v) => ({ inc: v });
const { date, data } = toUpdate(b, inc, new Date('2026-10-22T15:30:00Z')); // KST 10/23 00:30
assert.equal(date, '2026-10-23');
assert.deepEqual(data.hours, { 0: inc(900) });
assert.deepEqual(data.pages, { content: inc(900) });
assert.deepEqual(data.video, { openSec: inc(40), playSec: inc(35), opens: inc(1) });
assert.deepEqual(data.column, { readSec: inc(120), opens: inc(1), completes: inc(1) });
assert.deepEqual(data.items.c_p_50, { kind: 'column', n: inc(1), title: '칼럼', read: inc(120), done: inc(1) });
assert.deepEqual(kstParts(new Date('2026-10-22T14:59:59Z')), { date: '2026-10-22', hour: 23 });

assert.deepEqual(dateRange(3, new Date('2026-10-23T01:00:00Z')), ['2026-10-21', '2026-10-22', '2026-10-23']);
const report = buildReport({
  '2026-10-21': { visits: 3, activeSec: 1000, devices: { d1: 30, d2: 970 }, hours: { 21: 1000 }, pages: { index: 700, content: 300 },
    video: { playSec: 200, openSec: 250, opens: 2 }, column: { readSec: 100, opens: 1, completes: 0 },
    items: { v_A: { kind: 'video', title: '영상 A', n: 2, play: 200, open: 250 }, c_p_50: { kind: 'column', title: '칼럼 50', n: 1, read: 100 } } },
  '2026-10-23': { visits: 1, activeSec: 2000, devices: { d1: 2000 }, hours: { 7: 2000 }, pages: { content: 2000 },
    video: { playSec: 1500 }, column: { readSec: 300, opens: 2, completes: 1 },
    items: { v_B: { kind: 'video', title: '영상 B', n: 1, play: 1500 }, c_p_50: { kind: 'column', n: 2, read: 300, done: 1 } } }
}, ['2026-10-21', '2026-10-22', '2026-10-23'], [{ createdAt: '2026-10-22T16:00:00Z' }, { createdAt: '2026-10-21T03:00:00Z' }]);
assert.deepEqual(report.days.map((d) => [d.date, d.devices, d.activeSec, d.comments]), [['2026-10-21', 2, 1000, 1], ['2026-10-22', 0, 0, 0], ['2026-10-23', 1, 2000, 1]]);
assert.equal(report.totals.uniqueDevices, 2); assert.equal(report.totals.visits, 4); assert.equal(report.totals.perDeviceDaySec, 1000);
assert.equal(report.totals.videoPlaySec, 1700); assert.equal(report.totals.columnReadSec, 400); assert.equal(report.totals.comments, 2);
assert.equal(report.hours[21], 1000); assert.equal(report.hours[7], 2000);
assert.deepEqual(report.pages, { index: 700, content: 2300, feed: 0 });
assert.deepEqual(report.distribution.map((x) => x.count), [1, 0, 0, 1, 1], '30초·16분10초·33분20초');
assert.deepEqual(report.topVideos.map((v) => [v.title, v.sec, v.opens]), [['영상 B', 1500, 1], ['영상 A', 200, 2]]);
assert.deepEqual(report.topColumns.map((c) => [c.title, c.sec, c.opens, c.completes]), [['칼럼 50', 400, 3, 1]]);
// 멤버 연결: 브라우저는 참여자 ID·시즌만 보내고, 이름은 서버가 명단에서 확인한 값만 쓴다
const bm = sanitizeBeacon({ d: DEV, p: 'index', active: 30, m: { p: 'abc123', s: 's3' } });
assert.deepEqual(bm.member, { pid: 'abc123', season: 's3' });
assert.equal(sanitizeBeacon({ d: DEV, p: 'index', active: 30, m: { p: '../x', s: 's3' } }).member, null);
const withMember = toUpdate(bm, inc, new Date(), ['s2', 's3']).data.members;
assert.deepEqual(withMember, { s3_abc123: { season: 's3', pid: 'abc123', active: inc(30), play: inc(0), read: inc(0) } }, '멤버별로는 시간 합계만(이름은 보고서에서)');
assert.equal(toUpdate(bm, inc, new Date(), ['s1']).data.members, undefined, '모르는 시즌은 버림');
const mdocs = {
  '2026-10-21': { activeSec: 900, members: { s3_a: { season: 's3', pid: 'a', active: 600, play: 300, read: 60 }, s3_b: { season: 's3', pid: 'b', active: 100 }, s3_ghost: { season: 's3', pid: 'ghost', active: 500 } } },
  '2026-10-23': { activeSec: 2000, members: { s3_a: { season: 's3', pid: 'a', active: 400, play: 100, read: 200 }, s3_c: { season: 's3', pid: 'c', active: 0 } } }
};
assert.deepEqual(memberRefs(mdocs).map((m) => m.key), ['s3_a', 's3_b', 's3_ghost', 's3_c']);
const mr = buildReport(mdocs, ['2026-10-21', '2026-10-22', '2026-10-23'], [], { s3_a: '김현우', s3_b: '박지민', s3_c: '없는시간' });
assert.deepEqual(mr.members, [
  { key: 's3_a', name: '김현우', season: 's3', activeSec: 1000, videoPlaySec: 400, columnReadSec: 260 },
  { key: 's3_b', name: '박지민', season: 's3', activeSec: 100, videoPlaySec: 0, columnReadSec: 0 }], '기간 합계만(날짜별·방문 기록 없음), 명단에 없는 ID는 뺌');
assert.equal(mr.totals.members, 2); assert.equal(mr.totals.memberSec, 1100);
// 인증글 읽기: 글쓴이(시즌·참여자 ID)별 읽힌 횟수·시간만. 읽은 사람과 잇지 않는다.
const items = { 'p:s2:alice': { n: 2, read: 40 }, 'p:s2:bob': { n: 99, read: 5 }, 'p:../x:y': { n: 1 }, 'p:s2:zero': { n: 0, read: 0 }, 'v:xmd2_HKMgCU': { n: 1, play: 3 } };
for (let k = 0; k < 120; k++) items[`p:s2:m${k}`] = { n: 1, read: 3 };
const bp = sanitizeBeacon({ d: DEV, p: 'feed', active: 60, items, m: { p: 'reader', s: 's2' } });
assert(bp.authors.length <= 80 && bp.authors.length > 70, '글쓴이는 한 번에 80명까지');
assert.deepEqual(bp.authors.slice(0, 2), [{ season: 's2', pid: 'alice', n: 2, read: 40 }, { season: 's2', pid: 'bob', n: 20, read: 5 }], '횟수 상한·이상한 키 버림');
assert.deepEqual(bp.items.map((i) => i.key), ['v_xmd2_HKMgCU'], '영상·칼럼과 따로 센다');
const up = toUpdate(bp, inc, new Date(), ['s2']).data;
assert.deepEqual(up.authors.s2_alice, { season: 's2', pid: 'alice', n: inc(2), read: inc(40) });
assert(!JSON.stringify(up.authors).includes('reader'), '읽은 사람은 글쓴이 기록에 남기지 않는다');
assert.equal(toUpdate(bp, inc, new Date(), ['s1']).data.authors, undefined, '모르는 시즌 글쓴이는 버림');
assert(sanitizeBeacon({ d: DEV, p: 'feed', items: { 'p:s2:alice': { n: 1, read: 3 } } }), '글 읽기만 있어도 보낸다');
const adocs = {
  '2026-10-21': { authors: { s2_alice: { season: 's2', pid: 'alice', n: 3, read: 50 }, s2_bob: { season: 's2', pid: 'bob', n: 5, read: 20 }, s2_ghost: { season: 's2', pid: 'ghost', n: 9 } } },
  '2026-10-22': { authors: { s2_alice: { season: 's2', pid: 'alice', n: 4, read: 30 } }, members: { s2_carol: { season: 's2', pid: 'carol', active: 10 } } }
};
assert.deepEqual(memberRefs(adocs).map((m) => m.key).sort(), ['s2_alice', 's2_bob', 's2_carol', 's2_ghost'], '글쓴이 이름도 명단에서 찾는다');
const ar = buildReport(adocs, ['2026-10-21', '2026-10-22'], [], { s2_alice: '이혜림', s2_bob: '김현우', s2_carol: '박지민' });
assert.deepEqual(ar.topAuthors, [
  { key: 's2_alice', name: '이혜림', season: 's2', reads: 7, readSec: 80 },
  { key: 's2_bob', name: '김현우', season: 's2', reads: 5, readSec: 20 }], '읽힌 횟수 순, 명단에 없는 ID는 뺌');
assert.equal(ar.totals.postReads, 12); assert.equal(ar.totals.postReadSec, 100);
// 글마다(p:시즌:글쓴이:글ID): 글쓴이 합계와 글별 횟수를 함께. 같은 글쓴이 글 여럿은 먼저 합친다
const bq = sanitizeBeacon({ d: DEV, p: 'index', items: { 'p:s2:alice:postA': { n: 1, read: 10 }, 'p:s2:alice:postB': { n: 1, read: 5 }, 'p:s2:bob:postC': { n: 1, read: 4 }, 'p:s2:bob:bad id': { n: 1 } } });
const uq = toUpdate(bq, inc, new Date(), ['s2']).data;
assert.deepEqual(uq.authors, { s2_alice: { season: 's2', pid: 'alice', n: inc(2), read: inc(15) }, s2_bob: { season: 's2', pid: 'bob', n: inc(1), read: inc(4) } });
assert.deepEqual(uq.posts, { s2_postA: { n: inc(1), read: inc(10) }, s2_postB: { n: inc(1), read: inc(5) }, s2_postC: { n: inc(1), read: inc(4) } });
// 멤버 피드 "많이 읽은 순" 요약: 그 시즌 글별 횟수·글쓴이별 시간만(기기·멤버 정보 없음)
const pop = popularity({
  d1: { devices: { x: 1 }, members: { s2_r: { season: 's2', pid: 'r', active: 5 } }, posts: { s2_postA: { n: 3 }, s1_postA: { n: 9 }, s2_postZ: { n: 0 } }, authors: { s2_alice: { season: 's2', pid: 'alice', read: 30.4 }, s1_bob: { season: 's1', pid: 'bob', read: 99 } } },
  d2: { posts: { s2_postA: { n: 2 }, s2_postC: { n: 1 } }, authors: { s2_alice: { season: 's2', pid: 'alice', read: 10 } } }
}, 's2');
assert.deepEqual(pop, { posts: { postA: 5, postC: 1 }, authors: { alice: 40 } });
console.log('인증글 읽기: 글쓴이별 횟수·시간만(읽은 사람과 잇지 않음)·상한·이상한 키/모르는 시즌 버림·많이 읽힌 순 통과');
console.log('이용 통계: 묶음 검사(익명·상한·허용 화면)·KST 날짜/시각·하루 문서 증가값·기간 보고서 집계 통과');
