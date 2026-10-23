// 운영진 [이용 통계] 탭: 보고서 함수는 고정 응답으로 대신하고 그림·툴팁·표·기간 바꾸기·빈 상태·폭/다크 모드를 본다.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { buildReport, dateRange } = require('../netlify/functions/_lib/analytics');
const BASE = process.env.BASE || 'http://127.0.0.1:8765';

const NAMES = ['김현우', '박지민', '이유진(1362)', '최서연', '정다은', '한지수', '오세훈', '윤아름', '강현숙', '조민재', '서하늘', '임도윤', '배수아', '신예린', '문태호', '홍가람', '유채원', '남궁민', '장서진', '권나래', '송하은', '전우진', '황보람', '안소희', '류지안', '김정은'];
function sample(days) {
  const dates = dateRange(days);
  const docs = {};
  dates.forEach((date, i) => {
    const wave = 1 + Math.sin(i / 2) * 0.4, n = Math.round(18 * wave);
    const devices = Object.fromEntries(Array.from({ length: n }, (_, k) => [`d${k}`, [40, 200, 420, 700, 1300, 2400][k % 6]]));
    const active = Object.values(devices).reduce((a, b) => a + b, 0);
    docs[date] = {
      visits: n + 4, activeSec: active, devices,
      hours: { 7: active * 0.18, 8: active * 0.1, 12: active * 0.12, 21: active * 0.3, 22: active * 0.22, 23: active * 0.08 },
      pages: { index: active * 0.55, content: active * 0.4, feed: active * 0.05 },
      video: { playSec: active * 0.22, openSec: active * 0.27, opens: 6 }, column: { readSec: active * 0.12, opens: 4, completes: 2 },
      items: { v_xmd2_HKMgCU: { kind: 'video', title: '성과가 더딜 때, 꾸준히 쌓아가는 법', n: 3, play: active * 0.15, open: active * 0.17 },
        v_gQZ6zI3epVo: { kind: 'video', title: '나의 경험을 브랜드와 수익으로 연결하기', n: 2, play: active * 0.07, open: active * 0.1 },
        c_p_50: { kind: 'column', title: '1인 브랜드가 지치지 않는 법', n: 3, read: active * 0.09, done: 2 }, c_p_49: { kind: 'column', title: '퍼스널메이커스 10월 둘째 주', n: 1, read: active * 0.03 } },
      members: Object.fromEntries(NAMES.map((name, k) => [k, name]).filter(([k]) => (k + i) % 3 !== 0).map(([k, name]) => [`s3_p${k}`, { name, season: 's3', active: 120 + ((k * 137 + i * 53) % 1500), play: (k * 41) % 400, read: (k * 29 + i * 7) % 300 }]))
    };
  });
  return buildReport(docs, dates, [{ createdAt: new Date().toISOString() }]);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 1280, height: 900 } });
  await ctx.route('**/js/config.js', async (r) => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()).replace(/backend: '[^']+'/, "backend: 'local'"), headers: { ...res.headers(), 'content-type': 'application/javascript' } }); });
  const asked = []; let mode = 'data';
  await ctx.route((u) => u.pathname === '/.netlify/functions/analytics-report', (r) => {
    const d = +new URL(r.request().url()).searchParams.get('days'); asked.push(d);
    if (mode === 'error') return r.fulfill({ status: 401, json: { error: '로그인 정보가 없습니다. 운영진 화면에서 다시 로그인해 주세요.' } });
    return r.fulfill({ json: mode === 'empty' ? buildReport({}, dateRange(d)) : sample(d) });
  });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/admin.html');
  assert.equal(asked.length, 0, '탭을 열기 전엔 부르지 않음');
  // 운영진 로그인 전(대시보드가 닫혀 있으면) 탭이 열려도 부르지 않는다
  await page.evaluate(() => { document.getElementById('adminDashboard').style.display = 'none'; document.querySelector('[data-panel="usage"]').hidden = false; });
  await page.waitForTimeout(200);
  assert.equal(asked.length, 0, '로그인 전엔 통계를 부르지 않음');
  await page.evaluate(() => { document.querySelector('[data-panel="usage"]').hidden = true; document.getElementById('adminDashboard').style.display = 'block'; });
  await page.locator('[data-tab="usage"]').click();
  await page.waitForSelector('#usageDaily svg');
  assert.equal(await page.locator('[data-tab="usage"]').textContent(), '이용현황');
  assert.deepEqual(asked, [14]);
  assert.match(await page.locator('.usage-hero-value').textContent(), /시간|분/);
  assert.equal(await page.locator('.usage-tile').count(), 6);
  assert.match(await page.locator('.usage-tile').nth(0).textContent(), /이용한 멤버26명/);
  assert.match(await page.locator('.usage-tile').nth(5).textContent(), /인사이트 댓글1개/);
  // 멤버별 이용 시간: 이름·쌓은 막대·추이, 20명까지 보이고 더 보기, 이름 찾기·정렬, 툴팁, 표
  assert.equal(await page.locator('#usageMembers .member-row').count(), 20);
  assert.equal(await page.locator('#usageMembers .member-more').textContent(), '6명 더 보기');
  const totals = await page.locator('#usageMembers .member-row').evaluateAll((rows) => rows.map((r) => r.querySelector('.member-total').textContent));
  assert(totals.length === 20 && totals[0] !== '0초');
  await page.locator('#usageMembers .member-more').click();
  assert.equal(await page.locator('#usageMembers .member-row').count(), 26);
  assert.doesNotMatch(await page.locator('#usageMembers .member-list').textContent(), /접속|마지막|방문|\d+\/\d+/, '멤버별로는 합계 시간만(날짜·방문 없음)');
  await page.fill('#memberSearch', '김');
  assert.deepEqual((await page.locator('#usageMembers .member-name strong').allTextContents()).sort(), ['김정은', '김현우']);
  await page.fill('#memberSearch', '없는이름'); assert.match(await page.locator('#usageMembers .usage-empty').textContent(), /없는이름/);
  await page.fill('#memberSearch', '');
  await page.selectOption('#memberSort', 'name');
  const byName = await page.locator('#usageMembers .member-name strong').allTextContents();
  assert.deepEqual(byName, [...byName].sort((a, b) => a.localeCompare(b, 'ko')), '이름 순');
  await page.locator('#usageMembers .member-row').first().hover();
  assert.deepEqual(await page.locator('.usage-tip-row span:not(.usage-tip-key)').allTextContents(), ['영상 시청', '뉴스레터 읽기', '그 밖의 이용', '합계']);
  await page.locator('#usageMembers summary').click();
  assert.equal(await page.locator('#usageMembers tbody tr').count(), 26);
  assert.deepEqual(await page.locator('#usageMembers thead th').allTextContents(), ['멤버', '총 이용', '영상 시청', '뉴스레터 읽기', '그 밖의 이용']);
  await page.locator('#usageMembers summary').click();
  await page.selectOption('#memberSort', 'active');
  assert.deepEqual(await page.locator('#usageDaily .usage-legend-item').allTextContents(), ['영상 시청', '뉴스레터 읽기', '그 밖의 이용']);
  assert.equal(await page.locator('#usageVisitors .usage-legend').count(), 0, '한 계열엔 범례 없음');
  assert.equal(await page.locator('#usageDaily .usage-hit').count(), 14);
  assert.equal(await page.locator('#usageHours .usage-hit').count(), 24);
  // 막대 두께 24px 이하
  const widths = await page.locator('#usageDaily path.usage-mark').evaluateAll((ps) => ps.map((p) => p.getBBox().width));
  assert(widths.length >= 14 && Math.max(...widths) <= 24.01, '막대 폭 ' + Math.max(...widths));
  // 툴팁: 마우스·키보드
  await page.locator('#usageDaily .usage-hit').nth(13).hover();
  assert(await page.locator('.usage-tip').isVisible());
  assert.deepEqual(await page.locator('.usage-tip-row span:not(.usage-tip-key)').allTextContents(), ['영상 시청', '뉴스레터 읽기', '그 밖의 이용', '합계']);
  await page.mouse.move(0, 0); await page.locator('#usageVisitors .usage-hit').focus(); await page.keyboard.press('ArrowLeft');
  assert.match(await page.locator('.usage-tip-title').textContent(), /\d+\/\d+\(.\)/);
  assert.equal(await page.locator('#usageVisitors .usage-cross').evaluate((l) => l.style.display), '', '십자선 표시');
  // 표로 보기
  await page.locator('#usageDaily summary').click();
  assert.equal(await page.locator('#usageDaily tbody tr').count(), 14);
  assert.deepEqual(await page.locator('#usageTopVideos .usage-bar-name').evaluateAll((a) => a.map((x) => x.firstChild.textContent)), ['성과가 더딜 때, 꾸준히 쌓아가는 법', '나의 경험을 브랜드와 수익으로 연결하기']);
  assert.match(await page.locator('#usageTopColumns').textContent(), /끝까지 \d+회/);
  assert.deepEqual(await page.locator('#usagePages .usage-bar-name').allTextContents(), ['인증 앱', '추천 콘텐츠', '전체 피드']);
  if (process.env.SHOT_DIR) { await page.locator('#usageDaily summary').click(); await page.mouse.move(0, 0); await page.locator('[data-panel="usage"]').screenshot({ path: process.env.SHOT_DIR + '/usage-desktop.png' }); }
  // 기간 바꾸기 → 모든 차트가 같은 기간으로
  await page.locator('[data-days="30"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#usageDaily .usage-hit').length === 30);
  assert.deepEqual(asked, [14, 30]); assert.equal(await page.locator('[data-days="30"]').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('.usage-hero-label').textContent(), /최근 30일/);
  // 좁은 화면·다크 모드
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '가로 넘침 없음');
  assert(await page.locator('#usageDaily svg').evaluate((s) => s.getBoundingClientRect().right <= innerWidth));
  await page.emulateMedia({ colorScheme: 'dark' });
  const fill = await page.locator('#usageDaily path.usage-mark').first().evaluate((p) => getComputedStyle(p).fill);
  assert.equal(fill, 'rgb(57, 135, 229)', '다크 모드 계열 색');
  if (process.env.SHOT_DIR) await page.locator('[data-panel="usage"]').screenshot({ path: process.env.SHOT_DIR + '/usage-mobile-dark.png' });
  await page.emulateMedia({ colorScheme: 'light' });
  // 빈 기간·오류
  mode = 'empty'; await page.locator('[data-days="7"]').click(); await page.waitForSelector('.usage-empty');
  assert.equal(await page.locator('#usageDaily').count(), 0);
  mode = 'error'; await page.locator('#usageRefresh').click(); await page.waitForFunction(() => /로그인/.test(document.querySelector('#usageMsg').textContent));
  assert.equal(await page.locator('.usage-tile').count(), 6, '오류여도 앞의 그림은 남김');
  // 로그아웃하면(대시보드가 닫히면) 보던 통계를 지운다
  await page.evaluate(() => { document.getElementById('adminDashboard').style.display = 'none'; });
  await page.waitForFunction(() => !document.querySelector('#usageBody').children.length);
  assert.deepEqual(errors, []);
  console.log('이용 통계 탭: 운영진 로그인 전엔 안 부르고 로그아웃하면 지움·멤버별 이용 시간(기간 합계만·20명+더 보기·이름 찾기·정렬·툴팁·표)·열 때만 불러오기·대표 숫자/지표·쌓은 막대(범례·폭 24px 이하)·선(십자선·키보드)·툴팁·표로 보기·많이 본 콘텐츠·기간 바꾸기·빈/오류 상태·390px·다크 모드 통과');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
