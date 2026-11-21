// 휴대폰 크롬에서 피드 글 위를 손가락으로 쓸어 올리면 페이지가 내려가는지(다른 분들의 인증글을 끝까지 읽을 수 있는지).
// 예전엔 피드 상자가 휴대폰에서 펼쳐져(안쪽 스크롤 없음) 있으면서도 overflow:auto + overscroll-behavior:contain이 남아,
// 최신 크롬이 그 상자에서 시작한 스크롤을 페이지로 넘기지 않아 페이지가 안 내려갔다.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const START = '2026-10-26', END = '2026-11-22';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
  });
  await ctx.route('**/js/config.js', async (r) => {
    const res = await r.fetch();
    const body = (await res.text()).replace('CS.pickSeason(CS.seasonNowKST(), CS.seasonOverride)', "CS.pickSeason(CS.seasonNowKST(), 's1')")
      .replace(/startDate: '[^']+'/, `startDate: '${START}'`).replace(/endDate: '[^']+'/, `endDate: '${END}'`)
      .replace(/lockAt: '[^']*'/g, 'lockAt: null').replace(/backend: '[^']+'/, "backend: 'local'")
      + "\ntry { localStorage.setItem(CS.CONFIG.storagePrefix + '.awardSeen', '9999-12-31'); } catch (e) {}\n";
    r.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'application/javascript' } });
  });
  await ctx.route((u) => u.pathname.startsWith('/.netlify/functions/'), (r) => r.fulfill({ status: 204 }));
  await ctx.addInitScript(([start]) => {
    const pre = 'comingsoon.reading.v1';
    if (localStorage.getItem(pre + '.participants')) return;
    const people = Array.from({ length: 12 }, (_, i) => ['p' + i, '멤버' + (i + 1)]);
    localStorage.setItem(pre + '.participants', JSON.stringify(people.map(([id, nickname]) => ({ id, nickname, status: 'active', joinDate: start, outDate: null, exemptDates: [], createdAt: start + 'T00:00:00' }))));
    const subs = [];
    for (let d = 0; d < 3; d++) {
      const iso = new Date(Date.parse(start + 'T00:00:00Z') + d * 864e5).toISOString().slice(0, 10);
      people.forEach(([pid, nickname], k) => subs.push({ id: `s${d}${pid}`, participantId: pid, nickname, date: iso, sentence: `${nickname}의 ${iso} 인상 깊은 문장`, reflection: '느낀 점 '.repeat(30), upvotes: k % 3, upvotedBy: [], createdAt: `${iso}T1${k % 10}:00:00`, updatedAt: `${iso}T1${k % 10}:00:00` }));
    }
    localStorage.setItem(pre + '.submissions', JSON.stringify(subs));
    localStorage.setItem(pre + '.meta', '{}');
  }, [START]);
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/index.html');
  await page.locator('#tabbar [data-go="feed"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#socialFeedList .feed-item').length >= 10);
  const cdp = await ctx.newCDPSession(page);
  // 손가락으로 쓸어 올리기(실제 터치 이벤트 — 합성 스크롤 제스처는 headless에서 페이지를 움직이지 않는다)
  async function swipeUp(x, y, dist) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - (dist * i) / 10 }] }); await page.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  // 피드 글 한가운데를 손가락으로 쓸어 올린다
  await page.evaluate(() => scrollTo(0, 0));
  const post = await page.locator('#socialFeedList .feed-item').nth(1).boundingBox();
  const y0 = await page.evaluate(() => scrollY);
  await swipeUp(195, Math.min(700, Math.max(200, post.y + 40)), 600);
  await page.waitForTimeout(400);
  const y1 = await page.evaluate(() => scrollY);
  assert(y1 - y0 > 250, `피드 글 위에서 쓸어 올리면 페이지가 내려간다: ${y0} → ${y1}`);
  // 끝까지 내려 마지막 글까지 읽을 수 있다
  for (let i = 0; i < 25; i++) { await swipeUp(195, 650, 500); await page.waitForTimeout(150); }
  const end = await page.evaluate(() => ({ y: scrollY + innerHeight, h: document.documentElement.scrollHeight, lastBottom: document.querySelector('#socialFeedList .feed-item:last-child').getBoundingClientRect().bottom }));
  assert(end.h - end.y < 120 && end.lastBottom <= 780, '페이지 끝까지 내려가 마지막 글이 보인다 ' + JSON.stringify(end));
  // 피드 상자는 휴대폰에서 안쪽 스크롤 상자가 아니다(스크롤을 붙잡지 않는다)
  const css = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.feed-scroll')); return [s.overflowY, s.overscrollBehaviorY]; });
  assert.deepEqual(css, ['visible', 'auto']);
  assert.deepEqual(errors, []);
  console.log('휴대폰 크롬 피드 스크롤: 글 위에서 쓸어 올리면 페이지가 내려가고 마지막 글까지 읽힘 통과');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
