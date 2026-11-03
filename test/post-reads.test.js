// 인증글 읽기 기록: 피드에서 글이 3초 넘게 보이면 글쓴이별로 "읽음"을 센다(본인 글 제외, 같은 글은 한 번).
// 보내는 묶음에는 글쓴이(시즌·참여자 ID)와 횟수·시간만 담긴다.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const START = '2026-10-26', END = '2026-11-22';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 390, height: 640 } });
  await ctx.route('**/js/config.js', async (r) => {
    const res = await r.fetch();
    const body = (await res.text()).replace('CS.pickSeason(CS.seasonNowKST(), CS.seasonOverride)', "CS.pickSeason(CS.seasonNowKST(), 's1')")
      .replace(/startDate: '[^']+'/, `startDate: '${START}'`).replace(/endDate: '[^']+'/, `endDate: '${END}'`)
      .replace(/lockAt: '[^']*'/g, 'lockAt: null').replace(/backend: '[^']+'/, "backend: 'local'");
    r.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'application/javascript' } });
  });
  const beacons = [];
  await ctx.route((u) => u.pathname === '/.netlify/functions/track', (r) => { try { beacons.push(JSON.parse(r.request().postData())); } catch (e) {} r.fulfill({ status: 204 }); });
  await ctx.route((u) => u.pathname.startsWith('/.netlify/functions/') && u.pathname !== '/.netlify/functions/track', (r) => r.fulfill({ status: 204 }));
  await ctx.addInitScript(([start]) => {
    const pre = 'comingsoon.reading.v1';
    if (localStorage.getItem(pre + '.participants')) return;
    const people = [['p1', '이혜림'], ['p2', '김현우'], ['p3', '박지민']];
    localStorage.setItem(pre + '.participants', JSON.stringify(people.map(([id, nickname]) => ({ id, nickname, status: 'active', joinDate: start, outDate: null, exemptDates: [], createdAt: start + 'T00:00:00' }))));
    const subs = [];
    for (let i = 0; i < 3; i++) {
      const iso = new Date(Date.parse(start + 'T00:00:00Z') + i * 864e5).toISOString().slice(0, 10);
      people.forEach(([pid, nickname], k) => subs.push({ id: `s${i}${pid}`, participantId: pid, nickname, date: iso, sentence: `${nickname}의 ${iso} 문장`, reflection: '느낀 점 '.repeat(20), upvotes: 0, upvotedBy: [], createdAt: `${iso}T1${k}:00:00`, updatedAt: `${iso}T1${k}:00:00` }));
    }
    localStorage.setItem(pre + '.submissions', JSON.stringify(subs));
    localStorage.setItem(pre + '.meta', '{}');
    localStorage.setItem('personalmakers.analytics.member', JSON.stringify({ p: 'p3', s: 's1' })); // 이 기기는 박지민
  }, [START]);
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-10-28T21:00:00+09:00') });
  await page.goto(BASE + '/feed-all.html');
  await page.waitForSelector('article.feed-item[data-author]');
  assert.equal(await page.locator('article.feed-item[data-author="p1"]').first().getAttribute('data-season'), 's1');

  const sums = () => { const out = {}; for (const b of beacons) for (const [k, v] of Object.entries(b.items || {})) if (k.startsWith('p:')) { out[k] = out[k] || { n: 0, read: 0 }; out[k].n += v.n || 0; out[k].read += v.read || 0; } return out; };
  const flush = async () => { await page.evaluate(() => PMTrack._flush(false)); await page.waitForTimeout(50); };

  // 피드 맨 위가 거의 안 보이는 처음 화면에선 아무 글도 세지 않는다
  await page.clock.runFor(5000); await flush();
  assert.deepEqual(sums(), {}, '화면에 조금만 걸친 글은 세지 않음');
  await page.evaluate(() => document.querySelector('article.feed-item').scrollIntoView({ block: 'start' }));
  // 2초만 보면 아직 "읽음"이 아니다(시간만 쌓인다)
  await page.clock.runFor(2000); await flush();
  assert(Object.values(sums()).every((v) => v.n === 0), '3초 전엔 읽음으로 세지 않음');
  // 4초 넘게 보면 화면에 보이는 글을 읽음으로 센다
  await page.clock.runFor(3000); await flush();
  let s = sums();
  const firstReads = Object.values(s).reduce((a, v) => a + v.n, 0);
  assert(firstReads >= 1, '화면의 글을 읽음으로 셈 ' + JSON.stringify(s));
  assert(!s['p:s1:p3'], '내 글(박지민)은 세지 않음');
  // 그대로 더 봐도 같은 글은 다시 세지 않는다
  await page.clock.runFor(10000); await flush();
  assert.equal(Object.values(sums()).reduce((a, v) => a + v.n, 0), firstReads, '같은 글은 한 번만');
  // 내려가며 읽으면 새 글이 늘어난다
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 380); await page.waitForTimeout(80); await page.clock.runFor(4000); }
  await flush();
  s = sums();
  const total = Object.values(s).reduce((a, v) => a + v.n, 0);
  assert(total > firstReads && total <= 6, `내려가며 새 글을 셈(이혜림·김현우 글은 6개) ${JSON.stringify(s)}`);
  assert(s['p:s1:p1'].n >= 1 && s['p:s1:p2'].n >= 1 && !s['p:s1:p3']);
  assert(Object.values(s).every((v) => v.read > 0), '읽은 시간도 함께');
  // 보내는 묶음에 글 내용·글 ID·이름은 없다
  const text = JSON.stringify(beacons);
  assert(!/이혜림|김현우|문장|s0p1/.test(text), '글쓴이 ID·횟수·시간만 보낸다');
  assert.deepEqual(errors, []);
  console.log('인증글 읽기 기록: 3초 넘게 보인 글만·같은 글은 한 번·내 글 제외·내려가며 새 글·시간 함께·이름/내용은 보내지 않음 통과');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
