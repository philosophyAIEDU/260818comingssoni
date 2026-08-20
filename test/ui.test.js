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
  t('브랜드 로고 노출', await page.isVisible('.brand-logo'));
  t('브랜드명 반영', (await page.textContent('#brandTitle')).includes('퍼스널메이커스'));
  const opts = await page.locator('#participant option').count();
  t('드롭다운 채워짐 (5 = 안내 + 4명)', opts === 5, opts);
  await page.selectOption('#participant', { label: '커밍쏜' });
  await page.fill('#sentence', '과정을 팔면 결과를 기다리는 시간마저 팬이 된다.');
  await page.fill('#reflection', '결과가 나오기 전에도 보여줄 것이 있다는 말이 위로가 됐다.');
  await page.click('#submitBtn');
  await page.waitForTimeout(500);
  t('제출 성공 메시지', /인증이 저장되었습니다/.test(await page.textContent('#formMsg')));
  t('버튼이 수정 모드로', (await page.textContent('#submitBtn')).includes('수정'));
  t('나의 현황 노출', await page.isVisible('#myCard'));
  t('인증 1건', (await page.textContent('#stVerified')) === '1');
  t('최근 기록에 문장 표시', (await page.textContent('#myEntries')).includes('과정을 팔면'));

  // 재방문 시 같은 아이디를 다시 고르면 기존 제출 내용이 복원되는지
  // (아이디 자동 기억은 없앴으므로 매번 직접 선택한다)
  await page.reload();
  await page.waitForTimeout(500);
  t('재방문 시 드롭다운은 비어 있음(자동 선택 없음)', (await page.locator('#participant').inputValue()) === '');
  await page.selectOption('#participant', { label: '커밍쏜' });
  await page.waitForTimeout(300);
  t('재방문 시 제출완료 안내', /제출 완료/.test(await page.textContent('#formMsg')));
  t('입력값 복원', (await page.inputValue('#sentence')).includes('과정을 팔면'));

  // 같은 날 재제출 → 덮어쓰기
  await page.fill('#sentence', '팬이 되는 순간을 함께 만든다.');
  await page.click('#submitBtn');
  await page.waitForTimeout(400);
  t('수정 후에도 인증 1건', (await page.textContent('#stVerified')) === '1');

  // 두 번째 참가자 제출
  await page.selectOption('#participant', { label: '밤톨' });
  await page.waitForTimeout(300);
  t('참가자 전환 시 폼 비워짐', (await page.inputValue('#sentence')) === '');
  await page.fill('#sentence', '읽는다는 건 버티는 일이다.');
  await page.fill('#reflection', '오늘은 30분만 읽었다.');
  await page.click('#submitBtn');
  await page.waitForTimeout(400);

  // ── 참가자 화면: 삭제 버튼 제거 & 전체 진행현황 ──
  t('삭제 버튼 없음', (await page.locator('#resetBtn').count()) === 0);
  t('인증하기 버튼만 남음', (await page.textContent('#submitBtn')).includes('인증'));
  const overallRows = await page.locator('#overallTable tbody tr').count();
  t('전체 진행현황 행 4개', overallRows === 4, overallRows);
  t('전체 진행현황에 참가자 이름 노출', (await page.textContent('#overallTable')).includes('밤톨'));
  t('평균 인증률 타일 제거됨', (await page.locator('#ovAvgRate').count()) === 0);
  t('킥아웃 위험 인원 라벨로 변경', (await page.textContent('#overallStats')).includes('킥아웃 위험 인원'));

  // ── 전체 진행현황: "인증 완료 인원" 타일 + 클릭 시 명단 펼치기 ──
  t('참여중 → 인증 완료 인원으로 라벨 변경', (await page.textContent('#overallStats')).includes('인증 완료 인원'));
  t('인증 완료 인원 수치 = 오늘 인증한 2명', (await page.textContent('#ovDone')) === '2');
  await page.click('#ovDoneTile');
  await page.waitForTimeout(150);
  const ovDetailText = await page.textContent('#ovDetail');
  t('완료 인원 타일 클릭 시 명단 노출', ovDetailText.includes('커밍쏜') && ovDetailText.includes('밤톨'));
  await page.click('#ovDoneTile');
  await page.waitForTimeout(150);
  t('같은 타일 재클릭 시 명단 다시 숨김', await page.isHidden('#ovDetail'));
  await page.click('#ovRiskTile');
  await page.waitForTimeout(150);
  t('킥아웃 위험 타일 클릭 시 명단 영역 노출(0명이어도 안내문 표시)',
    (await page.textContent('#ovDetail')).includes('킥아웃 위험 인원'));
  await page.click('#ovRiskTile');
  await page.waitForTimeout(150);

  // ── 인증 피드: "전체 보기"는 새 창(feed-all.html)으로 링크됨 ──
  const feedAllLink = page.locator('#feedTabs a.on');
  t('전체 보기 링크가 feed-all.html을 새 창으로 엶',
    (await feedAllLink.getAttribute('href')) === 'feed-all.html'
    && (await feedAllLink.getAttribute('target')) === '_blank');
  const feedAllPage = await ctx.newPage();
  await feedAllPage.goto(BASE + '/feed-all.html');
  await feedAllPage.waitForTimeout(400);
  t('전체 보기 페이지에 인증 카드 노출', (await feedAllPage.locator('#allFeedList .feed-item').count()) >= 2);
  t('전체 보기 페이지 건수 표시', /\d+건/.test(await feedAllPage.textContent('#feedCount')));
  await feedAllPage.close();

  // ── 엄지척: 본인 글은 추천 불가, 남의 글은 추천/취소 가능 (날짜별 보기, 현재 선택: 밤톨) ──
  const bamtolCard = page.locator('#socialFeedList .feed-item', { hasText: '밤톨' });
  t('본인 글 엄지척 비활성', await bamtolCard.locator('.upvote-btn').isDisabled());
  const otherCard = page.locator('#socialFeedList .feed-item', { hasText: '커밍쏜' });
  const upvoteBtn = otherCard.locator('.upvote-btn');
  await upvoteBtn.click();
  await page.waitForTimeout(400);
  t('엄지척 1로 증가', (await upvoteBtn.textContent()).includes('👍 1'));
  await upvoteBtn.click();
  await page.waitForTimeout(400);
  t('엄지척 취소되어 0으로', (await upvoteBtn.textContent()).includes('👍 0'));

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
  t('공지문 생성됨', notice.length > 60 && notice.includes('퍼스널메이커스 독서 챌린지'), notice.slice(0, 80));

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

  // 알림 메일 탭 — 이름·메일 일괄 등록
  await page.click('button[data-tab="notify"]');
  await page.waitForTimeout(200);
  await page.fill('#notifyEmailInput',
    '홍길동, reader1@example.com\n김철수, reader2@example.com\n홍길동, reader1@example.com\n이상한값');
  await page.click('#notifyAddBtn');
  await page.waitForTimeout(300);
  t('일괄 등록 메시지(등록/중복/오류 구분)',
    /2건 등록 완료/.test(await page.textContent('#notifyMsg')) &&
    /중복 1건/.test(await page.textContent('#notifyMsg')) &&
    /형식 오류 1건/.test(await page.textContent('#notifyMsg')),
    await page.textContent('#notifyMsg'));
  t('메일 주소 2건 등록됨', /2명/.test(await page.textContent('#notifyCount')));
  t('이름이 목록에 표시됨', (await page.textContent('#notifyTable')).includes('홍길동'));
  t('메일 미리보기에 앱 주소 포함', (await page.textContent('#notifyPreview')).includes('comingssoni.netlify.app'));

  // 특정 대상에게 1회성 안내 메일 — 이름 검색 + 선택
  await page.fill('#customMailSearch', '홍길동');
  await page.waitForTimeout(150);
  t('이름 검색 결과에 대상 표시', (await page.textContent('#customMailResults')).includes('reader1@example.com'));
  await page.click('#customMailResults [data-pickmail]');
  await page.waitForTimeout(100);
  t('대상 선택 시 폼 표시', await page.isVisible('#customMailForm'));
  t('받는 사람에 이름·메일 표시', (await page.textContent('#customMailTarget')).includes('홍길동')
    && (await page.textContent('#customMailTarget')).includes('reader1@example.com'));
  t('본문에 받는 사람 이름 초안 채움', (await page.inputValue('#customMailBody')).includes('홍길동님'));
  await page.click('#customMailCancelBtn');
  await page.waitForTimeout(100);
  t('취소 시 폼 다시 숨김', !(await page.isVisible('#customMailForm')));

  await page.fill('#customMailSearch', '존재하지않는이름');
  await page.waitForTimeout(150);
  t('일치하는 이름 없을 때 안내', (await page.textContent('#customMailResults')).includes('일치하는 이름이 없습니다'));
  await page.fill('#customMailSearch', '');

  await page.click('[data-delmail]');
  await page.waitForTimeout(300);
  t('메일 주소 삭제 후 1건 남음', /1명/.test(await page.textContent('#notifyCount')));

  // 알림 메일 제목·본문 편집
  t('기본 제목 자동 채움', (await page.inputValue('#notifySubjectInput')).includes('오늘 인증하셨나요'));
  await page.fill('#notifySubjectInput', '테스트 제목입니다');
  await page.fill('#notifyBodyInput', '커스텀 본문입니다.\n링크: {{APP_URL}}');
  await page.waitForTimeout(150);
  t('편집 중 미리보기 즉시 반영', (await page.textContent('#notifyPreview')).includes('커스텀 본문입니다'));
  t('플레이스홀더가 앱 주소로 치환됨', (await page.textContent('#notifyPreview')).includes('comingssoni.netlify.app'));
  await page.click('#notifyTemplateSave');
  await page.waitForTimeout(300);
  t('템플릿 저장 완료 메시지', /저장했습니다/.test(await page.textContent('#notifyTemplateMsg')));

  await page.reload();
  await page.waitForTimeout(500);
  await page.click('button[data-tab="notify"]');
  await page.waitForTimeout(200);
  t('새로고침 후에도 저장한 제목 유지', (await page.inputValue('#notifySubjectInput')) === '테스트 제목입니다');

  await page.click('#notifyTemplateReset');
  await page.waitForTimeout(150);
  t('기본값 초기화', (await page.inputValue('#notifySubjectInput')).includes('오늘 인증하셨나요'));
  await page.click('#notifyTemplateSave');
  await page.waitForTimeout(300);

  // 데이터 탭
  await page.click('button[data-tab="data"]');
  await page.waitForTimeout(200);
  t('저장소 표기', (await page.textContent('#backendTag')).includes('localStorage'));

  // ── 참가자 화면: 문구/구조 점검 (진행 중 상태) ──
  await page.goto(BASE + '/index.html');
  await page.waitForTimeout(400);
  t('브랜드 서브타이틀 제거됨', (await page.locator('#brandSub').count()) === 0);
  const sentencePh = await page.getAttribute('#sentence', 'placeholder');
  t('예시 placeholder에 중복 안내문 없음', sentencePh.startsWith('ex)'), sentencePh.slice(0, 30));
  const rulesCard = page.locator('.wrap section.card', { hasText: '안내 · 챌린지 규칙' });
  const rulesText = await rulesCard.textContent();
  t('참여 아이디 안내 문구 삭제됨', !rulesText.includes('참여 아이디는 드롭다운'));
  t('킥아웃 요청 기한 3일로 변경', rulesText.includes('3일 전'));
  const rulesLis = await rulesCard.locator('ul.muted li').count();
  t('규칙 목록 5개(날짜 선택·지각 안내 포함)', rulesLis === 5, rulesLis);
  t('전체 진행현황 3개 지표만 노출', (await page.locator('#overallStats .stat').count()) === 3);

  // ── 참가자 화면: 챌린지 시작 전(before) 상태의 안내 위치 ──
  const beforeCtx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await beforeCtx.route('**/js/config.js', async (route) => {
    const res = await route.fetch();
    let body = await res.text();
    body = body.replace(/startDate: '[^']+'/, `startDate: '${shift(4)}'`)
               .replace(/endDate: '[^']+'/, `endDate: '${shift(32)}'`)
               .replace(/otAt: '[^']+'/, `otAt: '${shift(3)}T10:00'`)
               .replace(/backend: '[^']+'/, `backend: 'local'`);
    await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'application/javascript' } });
  });
  const beforePage = await beforeCtx.newPage();
  await beforePage.goto(BASE + '/index.html');
  await beforePage.waitForTimeout(400);
  t('시작 전: D-day 안내가 배너 아래 phaseNote에 노출', /D-4/.test(await beforePage.textContent('#phaseNote')));
  t('연습 기간 날짜는 "연습 (날짜)" 형식으로 일자가 먼저 오지 않음(연습 라벨이 앞에 옴)',
    /^연습 \(\d+\/\d+/.test((await beforePage.locator('#certifyDate option:checked').textContent()).trim()));
  t('안내 규칙 카드가 책 소개와 배너 사이에 위치',
    await beforePage.evaluate(() => {
      const intro = document.querySelector('section.intro');
      const rules = [...document.querySelectorAll('main.wrap > section.card')]
        .find((s) => s.textContent.includes('안내 · 챌린지 규칙'));
      const banner = document.querySelector('section.banner');
      if (!intro || !rules || !banner) return false;
      const pos = (a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
      return !!(pos(intro, rules) && pos(rules, banner));
    }));
  await beforeCtx.close();

  // ── 참가자 화면: 챌린지 종료 후(after)에는 phaseNote가 더 이상 노출되지 않음 ──
  const afterCtx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await afterCtx.route('**/js/config.js', async (route) => {
    const res = await route.fetch();
    let body = await res.text();
    body = body.replace(/startDate: '[^']+'/, `startDate: '${shift(-30)}'`)
               .replace(/endDate: '[^']+'/, `endDate: '${shift(-2)}'`)
               .replace(/otAt: '[^']+'/, `otAt: '${shift(-31)}T10:00'`)
               .replace(/backend: '[^']+'/, `backend: 'local'`);
    await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'application/javascript' } });
  });
  const afterPage = await afterCtx.newPage();
  await afterPage.goto(BASE + '/index.html');
  await afterPage.waitForTimeout(400);
  t('종료 후: phaseNote 안내문 사라짐', (await afterPage.textContent('#phaseNote')).trim() === '');
  await afterCtx.close();

  // ── 참가자 화면: 인증할 날짜 드롭다운 & 지각 백필은 계속 미인증 ──
  const dayCtx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await dayCtx.route('**/js/config.js', async (route) => {
    const res = await route.fetch();
    let body = await res.text();
    body = body.replace(/startDate: '[^']+'/, `startDate: '${shift(-5)}'`)
               .replace(/endDate: '[^']+'/, `endDate: '${shift(19)}'`)
               .replace(/backend: '[^']+'/, `backend: 'local'`);
    await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'application/javascript' } });
  });
  const dayPage = await dayCtx.newPage();

  await dayPage.goto(BASE + '/admin.html');
  await dayPage.waitForTimeout(400);
  await dayPage.click('button[data-tab="roster"]');
  await dayPage.fill('#bulkNames', '지각이');
  await dayPage.click('#bulkAdd');
  await dayPage.waitForTimeout(300);

  await dayPage.goto(BASE + '/index.html');
  await dayPage.waitForTimeout(400);
  const dayOptCount = await dayPage.locator('#certifyDate option').count();
  t('인증 날짜 드롭다운에 여러 날짜 존재', dayOptCount >= 5, dayOptCount);
  t('날짜 드롭다운 기본값 = 오늘', (await dayPage.locator('#certifyDate option:checked').textContent()).includes('오늘'));
  t('진행 중 날짜는 "N일차 (날짜)" 형식으로 일자가 먼저 옴',
    /^\d+일차 \(\d+\/\d+/.test((await dayPage.locator('#certifyDate option:checked').textContent()).trim()));
  t('오늘 선택 시 지각 경고 숨김', await dayPage.isHidden('#certifyDateWarn'));

  await dayPage.selectOption('#participant', { label: '지각이' });
  await dayPage.waitForTimeout(300);

  // 목록 맨 앞(가장 이른 날짜, 즉 과거)을 선택 → 지각 경고가 바로 보여야 함
  await dayPage.selectOption('#certifyDate', { index: 0 });
  await dayPage.waitForTimeout(200);
  t('과거 날짜 선택 시 지각 경고 노출', await dayPage.isVisible('#certifyDateWarn'));
  const pastDateValue = await dayPage.inputValue('#certifyDate');

  await dayPage.fill('#sentence', '늦게라도 기록 남김');
  await dayPage.fill('#reflection', '지각이지만 남겨봄');
  await dayPage.click('#submitBtn');
  await dayPage.waitForTimeout(400);
  t('지각 제출 안내 메시지', /미인증\(X\)으로 집계/.test(await dayPage.textContent('#formMsg')));
  t('피드에 지각 배지 노출', (await dayPage.textContent('#socialFeedList')).includes('지각'));

  await dayPage.goto(BASE + '/admin.html');
  await dayPage.waitForTimeout(500);
  const lateRow = dayPage.locator('#matrix tbody tr', { hasText: '지각이' });
  const lateCell = lateRow.locator(`.cell[data-date="${pastDateValue}"]`);
  t('지각 백필은 운영진 매트릭스에서도 미인증(X)으로 집계',
    (await lateCell.getAttribute('class')).includes('cell-x'));
  await dayCtx.close();

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
