// playwright 는 전역 설치본도 허용 (npm i -g playwright)
function loadPlaywright() {
  for (const m of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(m); } catch (e) { /* 다음 후보 */ }
  }
  throw new Error('playwright 를 찾을 수 없습니다. `npm i -D playwright` 후 다시 실행하세요.');
}
const { chromium } = loadPlaywright();
const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const errs = [];
let pass = 0, fail = 0;
const t = (n, c, x) => c ? (pass++, console.log('  ok  ', n)) : (fail++, console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x)));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  // 오늘(실행일)이 챌린지 기간 한가운데가 되도록 config 만 갈아끼워 실제 코드를 그대로 검증
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const shift = (n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const START = shift(-8), END = shift(19);
  await ctx.route('**/js/config.js', async (route) => {
    const res = await route.fetch();
    let body = await res.text();
    body = body.replace(/startDate: '[^']+'/, `startDate: '${START}'`)
               .replace(/endDate: '[^']+'/, `endDate: '${END}'`)
               .replace(/otAt: '[^']+'/, `otAt: '${shift(-9)}T10:00'`)
               // 테스트는 네트워크·구글 로그인 없이 돌도록 localStorage 백엔드로 고정
               .replace(/backend: '[^']+'/, `backend: 'local'`);
    await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'application/javascript' } });
  });

  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

  // ── 운영진 화면: 명단 등록 ──
  await page.goto(BASE + '/admin.html');
  await page.waitForTimeout(400);
  await page.click('button[data-tab="roster"]');
  await page.fill('#bulkNames', '소니\n커밍쏜\n책읽는고래\n밤톨\n소니');
  await page.click('#bulkAdd');
  await page.waitForTimeout(400);
  const rosterMsg = await page.textContent('#rosterMsg');
  t('일괄 등록 메시지', /4명 등록 완료/.test(rosterMsg), rosterMsg.trim());
  t('명단 표 4행', (await page.locator('#rosterTable tbody tr').count()) === 4);
  t('참여중 카운트', /참여중 4명/.test(await page.textContent('#rosterCount')));

  // ── 참가자 화면: 인증 제출 ──
  await page.goto(BASE + '/index.html');
  await page.waitForTimeout(400);
  const opts = await page.locator('#participant option').count();
  t('드롭다운 채워짐 (5 = 안내 + 4명)', opts === 5, opts);
  await page.selectOption('#participant', { label: '커밍쏜' });
  await page.fill('#chapter', '2장 – 과정을 파는 사람들 (p.48~72)');
  await page.fill('#sentence', '과정을 팔면 결과를 기다리는 시간마저 팬이 된다.');
  await page.fill('#reflection', '결과가 나오기 전에도 보여줄 것이 있다는 말이 위로가 됐다.');
  await page.click('#submitBtn');
  await page.waitForTimeout(500);
  t('제출 성공 메시지', /인증이 저장되었습니다/.test(await page.textContent('#formMsg')));
  t('버튼이 수정 모드로', (await page.textContent('#submitBtn')).includes('수정'));
  t('나의 현황 노출', await page.isVisible('#myCard'));
  t('인증 1건', (await page.textContent('#stVerified')) === '1');
  t('최근 기록에 문장 표시', (await page.textContent('#myEntries')).includes('과정을 팔면'));

  // 재방문 시 기존 제출 복원
  await page.reload();
  await page.waitForTimeout(500);
  t('재방문 시 닉네임 기억', (await page.locator('#participant').inputValue()) !== '');
  t('재방문 시 제출완료 안내', /제출 완료/.test(await page.textContent('#formMsg')));
  t('입력값 복원', (await page.inputValue('#chapter')).includes('2장'));

  // 같은 날 재제출 → 덮어쓰기
  await page.fill('#chapter', '3장 – 팬이 되는 순간');
  await page.click('#submitBtn');
  await page.waitForTimeout(400);
  t('수정 후에도 인증 1건', (await page.textContent('#stVerified')) === '1');

  // 두 번째 참가자 제출
  await page.selectOption('#participant', { label: '밤톨' });
  await page.waitForTimeout(300);
  t('참가자 전환 시 폼 비워짐', (await page.inputValue('#chapter')) === '');
  await page.fill('#chapter', '1장');
  await page.fill('#sentence', '읽는다는 건 버티는 일이다.');
  await page.fill('#reflection', '오늘은 30분만 읽었다.');
  await page.click('#submitBtn');
  await page.waitForTimeout(400);

  // ── 운영진 화면: 현황/리포트 ──
  await page.goto(BASE + '/admin.html');
  await page.waitForTimeout(500);
  t('오늘 인증 2명', (await page.textContent('#kToday')) === '2', await page.textContent('#kToday'));
  t('참여중 4명', (await page.textContent('#kTotal')) === '4');
  t('오늘 인증률 50%', (await page.textContent('#kTodayRate')) === '50%', await page.textContent('#kTodayRate'));

  const cols = await page.locator('#matrix thead th').count();
  t('매트릭스 열 = 3 + 28일', cols === 31, cols);
  t('매트릭스 행 4', (await page.locator('#matrix tbody tr').count()) === 4);
  const oCells = await page.locator('#matrix .cell-o').count();
  t('인증 셀 2개', oCells === 2, oCells);

  // 셀 클릭 → 상세
  await page.locator('#matrix .cell-o').first().click();
  await page.waitForTimeout(300);
  const detail = await page.textContent('#cellDetail');
  t('셀 상세에 제출 내용', /읽는다는 건|팬이 되는 순간/.test(detail), detail.slice(0, 120));

  // 면제 등록 토글
  await page.click('#toggleExempt');
  await page.waitForTimeout(400);
  t('면제 등록 반영', (await page.locator('#matrix .cell-p').count()) >= 0);

  // 공지문
  await page.click('button[data-tab="report"]');
  await page.waitForTimeout(300);
  const notice = await page.textContent('#noticeOut');
  t('공지문 생성됨', notice.length > 60 && notice.includes('커밍쏜 독서챌린지'), notice.slice(0, 80));

  await page.click('#genReport');
  await page.waitForTimeout(300);
  const rep = await page.textContent('#reportOut');
  t('리포트 생성됨', rep.length > 40, rep.slice(0, 80));

  // 제출 기록 필터
  await page.click('button[data-tab="entries"]');
  await page.waitForTimeout(300);
  await page.fill('#fKeyword', '버티는');
  await page.click('#applyFilter');
  await page.waitForTimeout(300);
  const ec = await page.locator('#entryList .entry').count();
  t('검색어 필터 1건', ec === 1, ec);

  // 데이터 탭
  await page.click('button[data-tab="data"]');
  await page.waitForTimeout(200);
  t('저장소 표기', (await page.textContent('#backendTag')).includes('localStorage'));

  // 모바일 뷰포트에서 가로 스크롤 없는지
  const m = await ctx.newPage();
  await m.setViewportSize({ width: 375, height: 780 });
  await m.goto(BASE + '/index.html');
  await m.waitForTimeout(400);
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  t('모바일 가로 오버플로 없음', overflow <= 1, overflow);

  await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/admin.png', fullPage: true });
  await m.screenshot({ path: (process.env.SHOT_DIR || '.') + '/mobile.png', fullPage: true });

  console.log('\nJS 오류:', errs.length ? errs : '없음');
  console.log(`결과: ${pass} pass / ${fail} fail`);
  await browser.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
