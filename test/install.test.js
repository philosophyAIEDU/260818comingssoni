// [웹앱 설치] 버튼: 크롬 설치 창, 카톡(안드로이드→크롬 / 아이폰→사파리) 넘기기, 아이폰 안내, 넘어온 뒤 이어서, 서비스 워커·오프라인.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const UA = {
  chrome: 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  kakaoAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36 KAKAOTALK/10.9.5',
  kakaoIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.9.5',
  safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
};
const FAKE_PROMPT = () => {
  const e = new Event('beforeinstallprompt', { cancelable: true });
  e.prompt = () => { window.__prompted = (window.__prompted || 0) + 1; return Promise.resolve(); };
  e.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(e);
};
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function open(ua, url = '/index.html') {
    const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 1100, height: 900 }, locale: 'ko-KR', serviceWorkers: 'allow' });
    await ctx.route('**/js/config.js', async (r) => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()).replace(/backend: '[^']+'/, "backend: 'local'"), headers: { ...res.headers(), 'content-type': 'application/javascript' } }); });
    await ctx.route((u) => u.pathname.startsWith('/.netlify/functions/'), (r) => r.fulfill({ status: 204 }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + url);
    await page.waitForSelector('#installApp');
    return { ctx, page };
  }

  // 1) 크롬: 버튼 한 번에 설치 창, 설치하면 카드가 사라진다. 서비스 워커가 등록되고 인터넷이 끊기면 안내 페이지
  let { ctx, page } = await open(UA.chrome);
  assert(await page.locator('#installCard').isVisible());
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  assert.equal(scope, BASE + '/');
  await page.evaluate(FAKE_PROMPT);
  await page.locator('#installApp').click();
  await page.waitForFunction(() => window.__prompted === 1);
  await page.waitForFunction(() => document.getElementById('installCard').hidden);
  await ctx.close();
  {
    // 서비스 워커가 페이지를 맡는지(오프라인 안내 자체는 test/sw.test.js가 본다 — 브라우저 테스트의 오프라인 전환은 서비스 워커 요청에 안 먹는다)
    const off = await browser.newContext({ serviceWorkers: 'allow' });
    const p = await off.newPage();
    await p.goto(BASE + '/index.html');
    await p.evaluate(async () => { await navigator.serviceWorker.ready; });
    await p.reload(); await p.waitForFunction(() => !!navigator.serviceWorker.controller);
    await p.goto(BASE + '/content.html');
    assert(await p.evaluate(() => !!navigator.serviceWorker.controller), '다른 화면도 같은 서비스 워커가 맡음');
    assert.match(await p.locator('h1').textContent(), /커밍쏜의 추천 콘텐츠/, '온라인이면 늘 서버의 최신 화면');
    await off.close();
  }

  // 2) 크롬인데 설치 창이 조금 늦게 준비되면 잠깐 기다렸다가 띄운다
  ({ ctx, page } = await open(UA.chrome));
  await page.locator('#installApp').click();
  await page.waitForTimeout(400); await page.evaluate(FAKE_PROMPT);
  await page.waitForFunction(() => window.__prompted === 1);
  assert.equal(await page.locator('#installSheet').count(), 0, '안내 없이 바로 설치 창');
  await ctx.close();

  // 3) 설치 창이 끝내 없으면(다른 브라우저 등) 메뉴 안내
  ({ ctx, page } = await open(UA.chrome));
  await page.locator('#installApp').click();
  await page.waitForSelector('#installSheet[open]', { timeout: 5000 });
  assert.equal(await page.locator('#installSheet').getAttribute('data-kind'), 'android');
  assert.match(await page.locator('#installSheet').textContent(), /앱 설치.*홈 화면에 추가/);
  await page.locator('.install-sheet-close').click(); assert(!(await page.locator('#installSheet').evaluate((d) => d.open)));
  await ctx.close();

  // 4) 안드로이드 카톡: 크롬으로 바로 넘긴다(?install=1을 달고)
  ({ ctx, page } = await open(UA.kakaoAndroid));
  await page.evaluate(() => { window.__go = null; });
  await page.locator('#installApp').click();
  await page.waitForFunction(() => !!document.documentElement.dataset.installRedirect);
  const intent = await page.evaluate(() => document.documentElement.dataset.installRedirect);
  assert.match(intent, /^intent:\/\/127\.0\.0\.1:8765\/index\.html\?install=1#Intent;scheme=https;package=com\.android\.chrome;S\.browser_fallback_url=/);
  await ctx.close();

  // 5) 아이폰 카톡: 사파리로 바로 넘긴다
  ({ ctx, page } = await open(UA.kakaoIOS));
  await page.locator('#installApp').click();
  await page.waitForFunction(() => !!document.documentElement.dataset.installRedirect);
  const jump = await page.evaluate(() => document.documentElement.dataset.installRedirect);
  assert(jump.startsWith('kakaotalk://web/openExternal?url='));
  assert.equal(new URL(decodeURIComponent(jump.split('url=')[1])).searchParams.get('install'), '1');
  await ctx.close();

  // 6) 아이폰 사파리: 그림 안내(공유 → 홈 화면에 추가 → 추가)
  ({ ctx, page } = await open(UA.safari));
  await page.locator('#installApp').click();
  await page.waitForSelector('#installSheet[open]');
  assert.equal(await page.locator('#installSheet').getAttribute('data-kind'), 'ios');
  assert.equal(await page.locator('.install-steps li').count(), 3);
  assert.match(await page.locator('.install-steps').textContent(), /공유 버튼.*홈 화면에 추가.*추가/);
  if (process.env.SHOT_DIR) { await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: process.env.SHOT_DIR + '/install-ios.png' }); }
  await ctx.close();

  // 7) 카톡에서 사파리로 넘어온 뒤: 안내가 바로 뜨고 주소의 ?install=1은 지운다
  ({ ctx, page } = await open(UA.safari, '/index.html?install=1'));
  await page.waitForSelector('#installSheet[open]');
  assert.equal(new URL(page.url()).search, '');
  await ctx.close();

  // 8) 카톡에서 크롬으로 넘어온 뒤: 설치 창이 준비되면 "지금 설치하기" 한 번으로
  ({ ctx, page } = await open(UA.chrome, '/index.html?install=1'));
  await page.evaluate(FAKE_PROMPT);
  await page.waitForSelector('#installSheet[open]');
  assert.equal(await page.locator('#installSheet').getAttribute('data-kind'), 'ready');
  await page.locator('.install-sheet-go').click();
  await page.waitForFunction(() => window.__prompted === 1);
  await ctx.close();

  assert.deepEqual(errors, []);
  console.log('웹앱 설치: 크롬 한 번에 설치 창(늦게 준비돼도 기다림)·없으면 메뉴 안내·카톡 안드로이드→크롬/아이폰→사파리로 넘기기·아이폰 그림 안내·넘어온 뒤 이어서·서비스 워커 통과');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
