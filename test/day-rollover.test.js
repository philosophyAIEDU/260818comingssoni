// 앱을 켜 둔 채 자정을 넘기면(홈 화면 앱을 닫지 않고 다음 날 다시 연 경우 포함) 인증 날짜가 오늘로 바뀌는지.
// 예전엔 날짜 칸이 앱을 연 날에 멈춰 있어, 다음 날 인증하면 전날 글을 덮어쓰고 그날은 미인증이 됐다.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const D1 = '2026-11-03', D2 = '2026-11-04';
const START = '2026-10-26', END = '2026-11-22';

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function open() {
    const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await ctx.route('**/js/config.js', async (r) => {
      const res = await r.fetch();
      const body = (await res.text()).replace('CS.pickSeason(CS.seasonNowKST(), CS.seasonOverride)', "CS.pickSeason(CS.seasonNowKST(), 's1')")
        .replace(/startDate: '[^']+'/, `startDate: '${START}'`).replace(/endDate: '[^']+'/, `endDate: '${END}'`)
        .replace(/lockAt: '[^']*'/g, 'lockAt: null').replace(/backend: '[^']+'/, "backend: 'local'")
        + "\ntry { localStorage.setItem(CS.CONFIG.storagePrefix + '.awardSeen', '9999-12-31'); } catch (e) {}\n";
      r.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'application/javascript' } });
    });
    await ctx.route((u) => u.pathname.startsWith('/.netlify/functions/'), (r) => r.fulfill({ status: 204 }));
    // 멤버 한 명(앞선 날짜는 모두 인증해 둠 — 집계가 멈추지 않게)
    await ctx.addInitScript(([start, d1]) => {
      const pre = 'comingsoon.reading.v1';
      if (localStorage.getItem(pre + '.participants')) return;
      localStorage.setItem(pre + '.participants', JSON.stringify([{ id: 'p1', nickname: '이혜림', status: 'active', joinDate: start, outDate: null, exemptDates: [], createdAt: start + 'T00:00:00' }]));
      const subs = []; let d = new Date(start + 'T00:00:00Z');
      while (d.toISOString().slice(0, 10) <= d1) { const iso = d.toISOString().slice(0, 10); subs.push({ id: 's' + iso, participantId: 'p1', nickname: '이혜림', date: iso, sentence: iso + ' 문장', reflection: '느낌', upvotes: 0, upvotedBy: [], createdAt: iso + 'T12:00:00', updatedAt: iso + 'T12:00:00' }); d = new Date(d.getTime() + 864e5); }
      localStorage.setItem(pre + '.submissions', JSON.stringify(subs));
      localStorage.setItem(pre + '.meta', '{}');
    }, [START, D1]);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.clock.install({ time: new Date(`${D1}T23:59:40+09:00`) });
    await page.goto(BASE + '/index.html');
    await page.waitForFunction(() => document.querySelectorAll('#participant option').length >= 2);
    await page.selectOption('#participant', { label: '이혜림' });
    await page.waitForFunction(() => !document.querySelector('#myCard').hidden);
    return { ctx, page };
  }
  const subs = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('comingsoon.reading.v1.submissions') || '[]'));

  // 1) 쓰던 글이 없으면: 자정이 지나면 날짜 칸이 오늘로 바뀌고, 다음 날 인증은 그날 글로 저장된다
  let { ctx, page } = await open();
  assert.equal(await page.locator('#certifyDate').inputValue(), D1);
  await page.clock.runFor(30000);
  await page.waitForFunction((d2) => document.querySelector('#certifyDate').value === d2, D2);
  assert.match(await page.locator(`#certifyDate option[value="${D2}"]`).textContent(), /오늘/);
  assert(!/오늘/.test(await page.locator(`#certifyDate option[value="${D1}"]`).textContent()), '어제 날짜에서 "오늘" 표시가 빠진다');
  assert(await page.locator('#certifyDateWarn').isHidden());
  await page.fill('#sentence', '다음 날 쓴 문장'); await page.fill('#reflection', '다음 날 느낌');
  await page.click('#submitBtn');
  await page.waitForFunction(() => /인증이 저장되었습니다/.test(document.querySelector('#formMsg').textContent));
  let all = await subs(page);
  assert.equal(all.find((s) => s.date === D2).sentence, '다음 날 쓴 문장', '그날(다음 날) 글로 저장');
  assert.equal(all.find((s) => s.date === D1).sentence, `${D1} 문장`, '전날 글은 그대로(덮어쓰지 않음)');
  await ctx.close();

  // 2) 자정 직전부터 쓰던 글이 있으면: 그 글의 날짜는 그대로 두고 안내만 띄운다(그날 글이었으니 지각으로 남는다)
  ({ ctx, page } = await open());
  await page.fill('#sentence', '자정 직전에 고치던 문장');
  await page.clock.runFor(30000);
  await page.waitForFunction(() => /자정이 지나 날짜가 바뀌었어요/.test(document.querySelector('#formMsg').textContent));
  assert.equal(await page.locator('#certifyDate').inputValue(), D1, '쓰던 글의 날짜는 그대로');
  assert.equal(await page.locator('#sentence').inputValue(), '자정 직전에 고치던 문장', '쓰던 글은 지워지지 않는다');
  assert(await page.locator('#certifyDateWarn').isVisible(), '마감이 지났다는 안내');
  assert(await page.locator(`#certifyDate option[value="${D2}"]`).count() === 1, '오늘 날짜도 고를 수 있다');
  await ctx.close();

  assert.deepEqual(errors, []);
  console.log('자정 넘김: 쓰던 글이 없으면 날짜 칸이 오늘로 바뀌고 다음 날 인증이 그날 글로 저장(전날 글 보존)·쓰던 글이 있으면 날짜 유지+안내·오늘 날짜 선택 가능 통과');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
