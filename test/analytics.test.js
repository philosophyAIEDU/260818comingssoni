// 이용 통계: 받은 묶음 검사·하루 문서에 더할 값·보고서 집계를 검증한다.
const assert = require('node:assert/strict');
const { sanitizeBeacon, toUpdate, buildReport, dateRange, itemKey, kstParts, memberRefs } = require('../netlify/functions/_lib/analytics');
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
console.log('이용 통계: 묶음 검사(익명·상한·허용 화면)·KST 날짜/시각·하루 문서 증가값·기간 보고서 집계 통과');
