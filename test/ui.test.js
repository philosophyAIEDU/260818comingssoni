// playwright 는 전역 설치본도 허용 (npm i -g playwright)
function loadPlaywright() {
  for (const m of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(m); } catch (e) { /* 다음 후보 */ }
  }
  throw new Error('playwright 를 찾을 수 없습니다. `npm i -D playwright` 후 다시 실행하세요.');
}
const { chromium } = loadPlaywright();
const fs = require('fs');
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
  // 삭제 등 confirm() 대화상자는 기본적으로 수락(승인)해서 실제 동작을 검증한다.
  page.on('dialog', (d) => d.accept());

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

  // 명단 관리 — 이메일도 이름처럼 표에서 바로 수정 가능
  const emailInputs = page.locator('#rosterTable tbody tr td input[data-editemail]');
  await emailInputs.first().fill('bamtol@example.com');
  await emailInputs.first().dispatchEvent('change');
  await page.waitForTimeout(300);
  t('이메일 수정 완료 메시지', /이메일을 수정했습니다/.test(await page.textContent('#rosterMsg')));
  t('명단 표에 수정한 이메일이 반영됨',
    (await page.locator('#rosterTable tbody tr td input[data-editemail]').first().inputValue()) === 'bamtol@example.com');
  await emailInputs.first().fill('이상한값');
  await emailInputs.first().dispatchEvent('change');
  await page.waitForTimeout(300);
  t('잘못된 이메일 형식은 거부됨', /올바른 메일 주소/.test(await page.textContent('#rosterMsg')));

  // 명단 관리 — 카톡방 참여 여부를 드롭다운(미정/O/X)으로 표시
  const kakaoSelects = page.locator('#rosterTable tbody tr td select[data-editkakao]');
  t('카톡방 참여 여부 드롭다운 기본값은 미정', (await kakaoSelects.first().inputValue()) === '');
  await kakaoSelects.first().selectOption('O');
  await page.waitForTimeout(300);
  t('카톡방 참여 여부 수정 완료 메시지', /카톡방 참여 여부를 수정했습니다/.test(await page.textContent('#rosterMsg')));
  t('명단 표에 수정한 카톡방 참여 여부가 반영됨(새로고침 후에도 유지)',
    (await page.locator('#rosterTable tbody tr td select[data-editkakao]').first().inputValue()) === 'O');

  // 명단 관리 — 카톡방 참여 여부로 필터링(미참여자만 보기 등)
  await kakaoSelects.nth(1).selectOption('X'); // 두 번째 사람(소니)을 미참여로 표시
  await page.waitForTimeout(300);

  await page.selectOption('#rosterKakaoFilter', 'X');
  await page.waitForTimeout(200);
  t('미참여(X) 필터 적용 시 1명만 표시', (await page.locator('#rosterTable tbody tr').count()) === 1);
  t('미참여 필터로 걸러진 사람이 실제로 X로 표시해 둔 사람',
    (await page.locator('#rosterTable tbody tr td input[data-rename]').first().inputValue()) === '소니');

  await page.selectOption('#rosterKakaoFilter', 'O');
  await page.waitForTimeout(200);
  t('참여(O) 필터 적용 시 1명만 표시', (await page.locator('#rosterTable tbody tr').count()) === 1);

  await page.selectOption('#rosterKakaoFilter', 'unset');
  await page.waitForTimeout(200);
  t('미정 필터 적용 시 나머지 2명 표시', (await page.locator('#rosterTable tbody tr').count()) === 2);

  await page.selectOption('#rosterKakaoFilter', '');
  await page.waitForTimeout(200);
  t('필터를 전체 보기로 되돌리면 4명 모두 표시', (await page.locator('#rosterTable tbody tr').count()) === 4);

  // ── 참가자 화면: 인증 제출 ──
  await page.goto(BASE + '/index.html');
  await page.waitForTimeout(400);
  t('브랜드 로고 노출', await page.isVisible('.brand-logo'));
  t('브랜드명 반영', (await page.textContent('#brandTitle')).includes('퍼스널메이커스'));

  // ── 배너: "오늘의 범위" 접이식 (이 컨텍스트는 오늘이 9일차) ──
  t('오늘의 범위는 기본적으로 접혀 있음', !(await page.locator('#todayRangeFold').evaluate((el) => el.open)));
  t('접힌 상태에서는 오늘의 범위 안내가 화면에 노출되지 않음', !(await page.isVisible('#todayRangeText')));
  await page.click('#todayRangeFold summary');
  await page.waitForTimeout(150);
  t('오늘의 범위를 펼치면 9일차 안내가 보임',
    (await page.textContent('#todayRangeText')).includes('세컨드 크리에이터'),
    await page.textContent('#todayRangeText'));
  t('오늘 회차에는 "오늘" 표시가 붙음', (await page.textContent('#rangeDayLabel')).includes('9일차')
    && (await page.textContent('#rangeDayLabel')).includes('오늘'));

  // ── 배너: "오늘의 범위" ◀▶로 다른 날짜의 범위도 넘겨볼 수 있음 ──
  await page.click('#rangeNextDay');
  await page.waitForTimeout(150);
  t('다음(▶) 클릭 시 10일차 범위로 이동', (await page.textContent('#todayRangeText')).includes('스티브 잡스가 말하는 애플'));
  t('다른 날짜로 이동하면 "오늘" 표시가 사라짐', !(await page.textContent('#rangeDayLabel')).includes('오늘'));
  await page.click('#rangePrevDay');
  await page.click('#rangePrevDay');
  await page.waitForTimeout(150);
  t('이전(◀) 두 번 클릭 시 8일차 범위로 이동', (await page.textContent('#todayRangeText')).includes('오케스트라형'));

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

  // ── 전체 진행현황: "전일 인증 완료 인원" 타일 + 클릭 시 명단 펼치기 ──
  t('전일 기준 라벨로 표시', (await page.textContent('#overallStats')).includes('전일 인증 완료 인원'));
  t('전일 인증률 라벨로 표시', (await page.textContent('#overallStats')).includes('전일 인증률'));
  // 이 컨텍스트의 인증은 전부 '오늘' 것이라, 어제 기준 집계는 0명이어야 한다.
  t('오늘 인증만 있으면 전일 인증 완료 인원은 0', (await page.textContent('#ovPrevDone')) === '0',
    await page.textContent('#ovPrevDone'));
  await page.click('#ovPrevDoneTile');
  await page.waitForTimeout(150);
  const ovDetailText = await page.textContent('#ovDetail');
  t('완료 인원 타일 클릭 시 명단 영역 노출', ovDetailText.includes('인증 완료'), ovDetailText);
  await page.click('#ovPrevDoneTile');
  await page.waitForTimeout(150);
  t('같은 타일 재클릭 시 명단 다시 숨김', await page.isHidden('#ovDetail'));
  await page.click('#ovRiskTile');
  await page.waitForTimeout(150);
  t('킥아웃 위험 타일 클릭 시 명단 영역 노출(0명이어도 안내문 표시)',
    (await page.textContent('#ovDetail')).includes('킥아웃 위험 인원'));
  await page.click('#ovRiskTile');
  await page.waitForTimeout(150);

  // ── 전체 진행현황: 참여자별 상세는 접혔다 펼 수 있고, 이름순/역순/인증률순 정렬 가능 ──
  t('참여자별 상세는 기본적으로 접혀 있음', !(await page.locator('#overallTableFold').evaluate((el) => el.open)));
  await page.click('#overallTableFold summary');
  await page.waitForTimeout(150);
  t('클릭하면 펼쳐짐', await page.locator('#overallTableFold').evaluate((el) => el.open));

  const overallNames = () => page.locator('#overallTable tbody tr td:first-child').allTextContents();
  t('기본 정렬(인증률순)', JSON.stringify(await overallNames()) === JSON.stringify(['밤톨', '커밍쏜', '소니', '책읽는고래']),
    await overallNames());
  await page.selectOption('#ovSortSelect', 'name-asc');
  await page.waitForTimeout(150);
  t('이름순 정렬', JSON.stringify(await overallNames()) === JSON.stringify(['밤톨', '소니', '책읽는고래', '커밍쏜']),
    await overallNames());
  await page.selectOption('#ovSortSelect', 'name-desc');
  await page.waitForTimeout(150);
  t('이름 역순 정렬', JSON.stringify(await overallNames()) === JSON.stringify(['커밍쏜', '책읽는고래', '소니', '밤톨']),
    await overallNames());
  await page.selectOption('#ovSortSelect', 'rate');
  await page.waitForTimeout(150);

  // ── 인증 피드: "전체 보기"는 새 창(feed-all.html)으로 링크됨 ──
  const feedAllLink = page.locator('#feedTabs a.on');
  t('전체 보기 링크가 feed-all.html을 새 창으로 엶',
    (await feedAllLink.getAttribute('href')) === 'feed-all.html'
    && (await feedAllLink.getAttribute('target')) === '_blank');
  t('인증 피드(날짜별 보기)에 카톡방 공유 안내 문구 노출',
    (await page.locator('.feed-card .hint').allTextContents())
      .some((t2) => t2.includes('독서 챌린지 카톡방에서 공유해보세요')));
  const feedAllPage = await ctx.newPage();
  await feedAllPage.goto(BASE + '/feed-all.html');
  await feedAllPage.waitForTimeout(400);
  t('전체 보기 페이지에 인증 카드 노출', (await feedAllPage.locator('#allFeedList .feed-item').count()) >= 2);
  t('전체 보기 페이지 건수 표시', /\d+건/.test(await feedAllPage.textContent('#feedCount')));
  t('전체 보기 페이지에도 카톡방 공유 안내 문구 노출',
    (await feedAllPage.locator('.feed-card .hint').allTextContents())
      .some((t2) => t2.includes('독서 챌린지 카톡방에서 공유해보세요')));
  t('날짜별 그룹 헤더 노출', (await feedAllPage.locator('.all-feed-date-heading').count()) >= 1);
  // 회귀 테스트: 그리드 카드 안에서도(넓은 화면이어도 카드 자체가 좁아서) 작성자 이름이
  // 폭 0으로 눌려 안 보이던 문제가 있었다 — 첫 카드의 이름이 실제로 보이는 너비를 갖는지 확인.
  const firstNickBox = await feedAllPage.locator('#allFeedList .feed-nick').first().boundingBox();
  t('전체 보기 그리드 카드에서도 작성자 이름이 보임(너비 0으로 눌리지 않음)',
    !!firstNickBox && firstNickBox.width > 10, firstNickBox);
  await feedAllPage.close();

  // ── 인증 피드: 인상 깊은 구절은 항상 보이고, 느낀 점만 펼쳐야 보임 ──
  const bomtolQuoteCard = page.locator('#socialFeedList .feed-item', { hasText: '밤톨' });
  t('인상 깊은 구절은 펼치지 않아도 바로 보임',
    (await bomtolQuoteCard.locator('.feed-quote').textContent()).includes('읽는다는 건 버티는 일이다'));
  t('느낀 점 영역은 기본적으로 접혀 있음', !(await bomtolQuoteCard.locator('.feed-more').evaluate((el) => el.open)));
  t('접힌 상태에서는 느낀 점 텍스트가 화면에 노출되지 않음',
    !(await bomtolQuoteCard.locator('dd').first().isVisible()));
  await bomtolQuoteCard.locator('.feed-more summary').click();
  await page.waitForTimeout(150);
  t('느낀 점 보기를 누르면 느낀 점이 펼쳐짐',
    (await bomtolQuoteCard.locator('.feed-more dd').first().textContent()).includes('오늘은 30분만 읽었다'));

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

  // ── 명예의 전당은 전일 기준이라, 오늘 받은 추천은 올라오지 않는다 ──
  // (전일 기준 순위·펼치기 동작은 아래 전용 컨텍스트에서 따로 검증한다)
  await upvoteBtn.click(); // 커밍쏜을 다시 추천해 '오늘의 1등'으로 만든다
  await page.waitForTimeout(400);
  t('엄지척 다시 1로', (await upvoteBtn.textContent()).includes('👍 1'));
  await page.click('#feedRefresh');
  await page.waitForTimeout(400);
  const fameNames = await page.locator('#hallOfFameList .who').allTextContents();
  t('오늘 추천은 명예의 전당(전일 기준)에 오르지 않음', !fameNames.includes('커밍쏜'), fameNames);
  t('전일 기록이 없으면 안내 문구 표시',
    (await page.textContent('#hallOfFameList')).includes('없습니다'), await page.textContent('#hallOfFameList'));

  // ── 인증 피드: 추천순 / 최신순 정렬 + 1등 배너 제거 ──
  t('중복이던 "👑 1등" 배너 제거됨', (await page.locator('#todayWinnerBadge').count()) === 0);
  t('피드 정렬 기본값은 추천 많은순',
    (await page.locator('#feedSortSelect').inputValue()) === 'likes',
    await page.locator('#feedSortSelect').inputValue());
  const feedOrder = () => page.locator('#socialFeedList .feed-nick').allTextContents();
  // 이 시점에 커밍쏜만 👍 1표(밤톨 0표), 작성 순서는 커밍쏜 → 밤톨
  t('추천순: 표를 받은 커밍쏜이 맨 위',
    (await feedOrder())[0].includes('커밍쏜'), await feedOrder());
  await page.selectOption('#feedSortSelect', 'recent');
  await page.waitForTimeout(300);
  t('최신순: 나중에 올린 밤톨이 맨 위',
    (await feedOrder())[0].includes('밤톨'), await feedOrder());
  t('최신순에서도 1등에게는 왕관이 그대로 붙음',
    (await page.locator('#socialFeedList .feed-nick').allTextContents()).some((n) => n.includes('👑')),
    await feedOrder());
  await page.selectOption('#feedSortSelect', 'likes');
  await page.waitForTimeout(300);
  t('다시 추천순으로 되돌릴 수 있음', (await feedOrder())[0].includes('커밍쏜'), await feedOrder());


  // ── 인증글 텍스트 복사 ──
  const shareBtn = otherCard.locator('[data-share]');
  t('복사 버튼에 인증 내용이 담겨 있음',
    (await shareBtn.getAttribute('data-nickname')) === '커밍쏜'
    && !!(await shareBtn.getAttribute('data-sentence')));
  t('버튼 라벨이 텍스트 복사로 표시됨', (await shareBtn.textContent()).includes('텍스트 복사'));

  await page.evaluate(() => {
    window.__copiedText = null;
    navigator.clipboard.writeText = (text) => { window.__copiedText = text; return Promise.resolve(); };
  });
  await shareBtn.click();
  await page.waitForTimeout(300);
  const copiedText = await page.evaluate(() => window.__copiedText);
  t('클립보드에 인증 내용이 텍스트로 복사됨',
    !!copiedText && copiedText.includes('커밍쏜') && copiedText.includes('팬이 되는 순간'), copiedText);
  t('복사된 텍스트가 요청한 형식(참여자/인상 깊었던 내용/책을 읽고 느낀 점)을 따름',
    !!copiedText
    && /참여자\s*:\s*커밍쏜님/.test(copiedText)
    && copiedText.includes('인상 깊었던 내용 : 팬이 되는 순간')
    && copiedText.includes('책을 읽고 느낀 점 :'), copiedText);
  t('복사 완료 버튼 표시', (await shareBtn.textContent()).includes('복사 완료'));

  // ── 운영진 화면: 현황 ──
  await page.goto(BASE + '/admin.html');
  await page.waitForTimeout(500);
  t('오늘 인증 2명', (await page.textContent('#kToday')) === '2', await page.textContent('#kToday'));
  t('참여중 4명', (await page.textContent('#kTotal')) === '4');
  t('오늘 인증률 50%', (await page.textContent('#kTodayRate')) === '50%', await page.textContent('#kTodayRate'));
  t('킥아웃 위험 인원 KPI 라벨 (위험군과 실제 킥아웃 대상을 함께 집계)',
    (await page.locator('.stat.bad .k', { hasText: '킥아웃 위험 인원' }).count()) > 0);

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

  // 공지문 — 날짜별로 미리 작성/저장 (최대 30일치)
  await page.click('button[data-tab="report"]');
  await page.waitForTimeout(300);
  const notice = await page.inputValue('#noticeOut');
  t('공지문 자동 생성됨', notice.length > 60 && notice.includes('퍼스널메이커스 독서 챌린지'), notice.slice(0, 80));
  t('저장 전에는 자동 생성 상태 표시', /자동 생성/.test(await page.textContent('#noticeStatus')));

  const noticeDateVal = await page.inputValue('#noticeDate');
  const tomorrow = await page.evaluate((d) => {
    const dt = new Date(d + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + 1); return dt.toISOString().slice(0, 10);
  }, noticeDateVal);

  await page.fill('#noticeOut', '내일은 아침 일찍 인증해 주세요! (미리 써 둔 공지)');
  await page.click('#noticeSave');
  await page.waitForTimeout(300);
  t('공지문 저장 완료 메시지', /저장했습니다/.test(await page.textContent('#noticeMsg')));
  t('저장 후 상태가 저장됨으로 바뀜', /저장됨/.test(await page.textContent('#noticeStatus')));
  t('저장된 공지 1일치로 표시', /저장된 공지 1일치/.test(await page.textContent('#noticeSavedCount')));

  // 다른 날짜로 옮기면 그 날짜는 아직 자동 생성 문구(저장 안 한 상태)
  await page.fill('#noticeDate', tomorrow);
  await page.dispatchEvent('#noticeDate', 'change');
  await page.waitForTimeout(200);
  t('다른 날짜는 자동 생성 문구로 표시', /자동 생성/.test(await page.textContent('#noticeStatus')));

  // 다시 저장했던 날짜로 돌아오면 저장한 내용이 그대로 보임(새로고침 없이도 유지)
  await page.fill('#noticeDate', noticeDateVal);
  await page.dispatchEvent('#noticeDate', 'change');
  await page.waitForTimeout(200);
  t('저장했던 날짜로 돌아오면 내용 유지',
    (await page.inputValue('#noticeOut')).includes('미리 써 둔 공지'));

  await page.reload();
  await page.waitForTimeout(500);
  await page.click('button[data-tab="report"]');
  await page.waitForTimeout(300);
  t('새로고침 후에도 저장한 공지 유지',
    (await page.inputValue('#noticeOut')).includes('미리 써 둔 공지'));

  await page.click('#noticeDelete');
  await page.waitForTimeout(300);
  t('삭제 후 자동 생성 문구로 되돌아감', /자동 생성/.test(await page.textContent('#noticeStatus')));
  t('삭제 후 저장된 공지 0건', /저장된 공지 없음/.test(await page.textContent('#noticeSavedCount')));

  // 제출 기록 필터
  await page.click('button[data-tab="entries"]');
  await page.waitForTimeout(300);
  await page.fill('#fKeyword', '버티는');
  await page.click('#applyFilter');
  await page.waitForTimeout(300);
  const ec = await page.locator('#entryList .entry').count();
  t('검색어 필터 1건', ec === 1, ec);

  // 제출 기록 삭제 — 확인창(confirm)을 거쳐 해당 건만 지워지고 목록에서 사라짐
  t('삭제 버튼 노출', (await page.locator('#entryList [data-delentry]').count()) === 1);
  await page.click('#entryList [data-delentry]');
  await page.waitForTimeout(300);
  t('삭제 후 검색 결과 0건(빈 목록 안내)',
    (await page.textContent('#entryList')).includes('조건에 맞는 제출 기록이 없습니다'));
  await page.fill('#fKeyword', '');
  await page.click('#applyFilter');
  await page.waitForTimeout(300);
  t('필터 해제 후에도 삭제된 건은 다시 나타나지 않음',
    !(await page.textContent('#entryList')).includes('버티는'));

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
  // [명단 관리]와 마찬가지로 이름 가나다순 — 김철수(ㄱ)가 홍길동(ㅎ)보다 먼저 나와야 함
  const notifyNames = await page.locator('#notifyTable tbody tr td:first-child').allTextContents();
  t('알림 메일 목록이 이름 가나다순으로 정렬됨',
    notifyNames.indexOf('김철수') < notifyNames.indexOf('홍길동'), notifyNames);
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

  // ── 회귀 테스트: 공지문(notices) 로딩이 실패해도 알림 메일 등 나머지 탭은 정상 동작해야 함
  //    (공지문 기능을 추가하며 refresh()의 이 부분을 try/catch로 감싸지 않아, 여기서 예외가 나면
  //    이후의 refreshNotify() 호출이 아예 실행되지 않아 알림 메일 목록이 통째로 사라졌던 회귀 버그) ──
  const errsBeforeNoticeFail = errs.length;
  await page.evaluate(() => {
    CS.Store.listNotices = () => Promise.reject(new Error('테스트: 공지문 컬렉션 접근 실패 시뮬레이션'));
  });
  await page.click('button[data-tab="roster"]');
  await page.waitForTimeout(200);
  await page.locator('#rosterTable [data-exemptdate]').first().fill(shift(0));
  await page.locator('#rosterTable [data-addexempt]').first().click();
  await page.waitForTimeout(400); // 이 클릭이 refresh() 전체를 다시 실행시킨다
  await page.click('button[data-tab="notify"]');
  await page.waitForTimeout(200);
  t('공지문 로딩이 실패해도 알림 메일 목록은 그대로 보임',
    /1명/.test(await page.textContent('#notifyCount')) && (await page.textContent('#notifyTable')).includes('홍길동'));
  t('공지문 로딩 실패 안내 메시지 표시', /공지문을 불러오지 못했습니다/.test(await page.textContent('#noticeMsg')));
  // 방금 콘솔에 찍힌 console.error는 이 테스트가 의도적으로 유발한 것이라 전체 "JS 오류" 집계에서 제외한다.
  errs.length = errsBeforeNoticeFail;

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
  t('시작 전: D-day/OT 안내 배너는 더 이상 노출되지 않음(요청에 따라 제거)',
    (await beforePage.textContent('#phaseNote')).trim() === '');
  t('시작 전에도 오늘의 범위를 볼 수 있음(다른 날짜의 범위도 미리 볼 수 있도록)',
    await beforePage.isVisible('#todayRangeFold'));
  await beforePage.click('#todayRangeFold summary');
  await beforePage.waitForTimeout(150);
  t('시작 전 기본값은 1일차(다가올 첫 회차)', (await beforePage.textContent('#rangeDayLabel')).includes('1일차'));
  t('시작 전에는 이전 버튼이 비활성(1일차가 처음)', await beforePage.isDisabled('#rangePrevDay'));
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
  t('종료 후에도 오늘의 범위를 볼 수 있음(지난 회차를 돌아볼 수 있도록)',
    await afterPage.isVisible('#todayRangeFold'));
  await afterPage.click('#todayRangeFold summary');
  await afterPage.waitForTimeout(150);
  t('종료 후 기본값은 마지막 회차', (await afterPage.textContent('#rangeDayLabel')).includes('28일차'));
  t('종료 후에는 다음 버튼이 비활성(마지막 회차)', await afterPage.isDisabled('#rangeNextDay'));
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

  // ── 전체 보기: 날짜별 그룹핑 + 추천(👍) 많은순 정렬 (이 컨텍스트엔 과거·오늘 두 날짜가 있음) ──
  await dayPage.goto(BASE + '/index.html');
  await dayPage.waitForTimeout(400);
  await dayPage.selectOption('#participant', { label: '지각이' });
  await dayPage.waitForTimeout(300); // certifyDate 기본값은 오늘 — 그대로 제출
  await dayPage.fill('#sentence', '오늘은 제때 제출');
  await dayPage.fill('#reflection', '늦지 않게 남겼다');
  await dayPage.click('#submitBtn');
  await dayPage.waitForTimeout(400);

  await dayPage.goto(BASE + '/feed-all.html');
  await dayPage.waitForTimeout(400);
  const dateHeadings = await dayPage.locator('.all-feed-date-heading').allTextContents();
  t('전체 보기에서 날짜별로(최소 2개) 그룹으로 나뉨', dateHeadings.length >= 2, dateHeadings);

  const todayCard = dayPage.locator('#allFeedList .feed-item', { hasText: '오늘은 제때 제출' });
  await todayCard.locator('.upvote-btn').click();
  await dayPage.waitForTimeout(300);
  await dayPage.selectOption('#allFeedSort', 'likes');
  await dayPage.waitForTimeout(300);
  const firstCardText = await dayPage.locator('#allFeedList .feed-item').first().textContent();
  t('추천(👍) 많은순 정렬 시 추천받은 글이 맨 위로', firstCardText.includes('오늘은 제때 제출'), firstCardText);

  // ── 전체 보기: 사람별로 보기 + 인증 기록 TXT 다운로드
  //    (나중에 한꺼번에 모아 보거나 이중으로 백업해 두고 싶다는 요청에 따른 기능) ──
  await dayPage.goto(BASE + '/admin.html');
  await dayPage.waitForTimeout(400);
  await dayPage.click('button[data-tab="roster"]');
  await dayPage.fill('#bulkNames', '다른사람');
  await dayPage.click('#bulkAdd');
  await dayPage.waitForTimeout(300);

  await dayPage.goto(BASE + '/index.html');
  await dayPage.waitForTimeout(400);
  await dayPage.selectOption('#participant', { label: '다른사람' });
  await dayPage.waitForTimeout(300);
  await dayPage.fill('#sentence', '다른사람의 오늘 인증');
  await dayPage.fill('#reflection', '다른사람 소감');
  await dayPage.click('#submitBtn');
  await dayPage.waitForTimeout(400);

  await dayPage.goto(BASE + '/feed-all.html');
  await dayPage.waitForTimeout(400);
  const personOptions = await dayPage.locator('#allFeedPerson option').allTextContents();
  t('사람별로 보기 드롭다운에 참가자 이름 노출',
    personOptions.includes('지각이') && personOptions.includes('다른사람'), personOptions);
  t('전체 선택 상태에서는 다운로드 버튼 비활성', await dayPage.isDisabled('#allFeedDownloadBtn'));

  await dayPage.selectOption('#allFeedPerson', { label: '지각이' });
  await dayPage.waitForTimeout(300);
  t('사람별로 보기 선택 시 그 사람 건수만 표시',
    (await dayPage.textContent('#feedCount')) === '2건', await dayPage.textContent('#feedCount'));
  t('선택한 사람 외의 글은 보이지 않음',
    !(await dayPage.textContent('#allFeedList')).includes('다른사람의 오늘 인증'));
  t('사람 선택 시 다운로드 버튼 활성화', !(await dayPage.isDisabled('#allFeedDownloadBtn')));

  // 헤드리스 브라우저에 따라 download 속성의 한글 파일명을 그대로 보고하지 않을 수 있어
  // (실제로 이 샌드박스의 크로미움은 "download"로 뭉개서 보고함) 브라우저가 보고하는
  // suggestedFilename 대신, 우리 코드가 실제로 설정한 <a download> 속성값을 직접 확인한다.
  const filenamePromise = dayPage.evaluate(() => new Promise((resolve) => {
    const orig = document.body.appendChild.bind(document.body);
    document.body.appendChild = (el) => {
      if (el.tagName === 'A' && el.download) resolve(el.download);
      return orig(el);
    };
  }));
  const [dl] = await Promise.all([
    dayPage.waitForEvent('download'),
    dayPage.click('#allFeedDownloadBtn')
  ]);
  const dlFilename = await filenamePromise;
  t('다운로드 파일명에 이름 포함 및 .txt 확장자', dlFilename.includes('지각이') && dlFilename.endsWith('.txt'), dlFilename);
  const dlText = fs.readFileSync(await dl.path(), 'utf-8');
  t('다운로드한 텍스트에 두 건의 인증 내용이 모두 포함됨',
    dlText.includes('늦게라도 기록 남김') && dlText.includes('오늘은 제때 제출'), dlText.slice(0, 200));
  t('다운로드한 텍스트에 다른 사람의 글은 포함되지 않음', !dlText.includes('다른사람의 오늘 인증'));

  await dayCtx.close();

  // ── 운영진 화면: 명단 시트(CSV) 업로드 — 참가자 명단 + 알림 메일 수신자에 동시 등록
  //    (참가자·메일 수는 이후 나오지 않으므로 마지막에 실행) ──
  await page.goto(BASE + '/admin.html');
  await page.waitForTimeout(400);
  await page.click('button[data-tab="roster"]');
  const csvContent = '이름,이메일\n글벗,csvreader1@example.com\n책모임,csvreader2@example.com\n';
  await page.setInputFiles('#rosterCsvInput', {
    name: 'roster.csv', mimeType: 'text/csv', buffer: Buffer.from(csvContent, 'utf-8')
  });
  await page.click('#rosterCsvUploadBtn');
  await page.waitForTimeout(400);
  const csvMsg = await page.textContent('#rosterCsvMsg');
  t('CSV 업로드 결과 메시지(참여자·알림 메일 동시 등록)',
    /참여자 2명 등록/.test(csvMsg) && /알림 메일 2건 등록/.test(csvMsg), csvMsg.trim());
  // 이름 칸은 인라인 수정용 <input>이라 textContent에는 잡히지 않으므로 값을 직접 읽는다.
  const rosterNames = await page.locator('#rosterTable tbody tr td input[data-rename]').evaluateAll(
    (els) => els.map((e) => e.value));
  t('CSV로 올린 이름이 명단 표에 추가됨', rosterNames.includes('글벗') && rosterNames.includes('책모임'), rosterNames);
  // 이름+이메일이 함께 있는 CSV라 명단 표의 이메일 칸에도 자동으로 채워져야 함
  const rosterEmails = await page.locator('#rosterTable tbody tr td input[data-editemail]').evaluateAll(
    (els) => els.map((e) => e.value));
  t('CSV로 올린 이메일이 명단 표 이메일 칸에도 채워짐',
    rosterEmails.includes('csvreader1@example.com') && rosterEmails.includes('csvreader2@example.com'), rosterEmails);
  await page.click('button[data-tab="notify"]');
  await page.waitForTimeout(200);
  t('CSV로 올린 메일이 알림 메일 목록에도 추가됨', (await page.textContent('#notifyTable')).includes('csvreader1@example.com'));

  await page.click('button[data-tab="roster"]');
  await page.waitForTimeout(200);

  // ── 엑셀(.xlsx) 업로드 — 라이브러리(SheetJS)가 없을 때도 안전하게 안내 메시지로 처리됨
  //    (이 샌드박스는 CDN이 막혀 있어 실제로도 이 경로를 타지만, 어느 환경에서든 같은 결과가 나오도록
  //    window.XLSX를 명시적으로 지워서 테스트한다. CDN 로드 실패는 이 시나리오에서 당연히
  //    발생하는 네트워크 오류라 전체 "JS 오류" 집계에서는 제외한다) ──
  const errsBeforeXlsxFail = errs.length;
  await page.evaluate(() => { delete window.XLSX; });
  await page.setInputFiles('#rosterCsvInput', {
    name: 'roster.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('dummy', 'utf-8')
  });
  await page.click('#rosterCsvUploadBtn');
  // CDN 접속 시도 자체가 네트워크 타임아웃까지 걸릴 수 있어 넉넉히 폴링해서 기다린다.
  await page.waitForFunction(
    () => (document.getElementById('rosterCsvMsg').textContent || '').includes('라이브러리'),
    { timeout: 15000 }
  ).catch(() => {});
  t('엑셀 라이브러리 미탑재 시 안내 메시지로 안전 처리', /라이브러리/.test(await page.textContent('#rosterCsvMsg')));
  errs.length = errsBeforeXlsxFail;

  // ── 엑셀(.xlsx) 업로드 — 라이브러리가 있을 때의 파싱·등록 로직 검증
  //    (SheetJS 자체의 바이너리 파싱은 외부 라이브러리 영역이라 테스트하지 않고,
  //    XLSX.read/sheet_to_json 결과를 흉내 내어 그 다음 처리 로직만 검증한다) ──
  await page.evaluate(() => {
    window.XLSX = {
      read: () => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }),
      utils: {
        sheet_to_json: () => [
          ['이름', '이메일'],
          ['엑셀참여', 'excelreader1@example.com'],
          ['엑셀모임', 'excelreader2@example.com']
        ]
      }
    };
  });
  await page.setInputFiles('#rosterCsvInput', {
    name: 'roster.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('dummy', 'utf-8')
  });
  await page.click('#rosterCsvUploadBtn');
  await page.waitForTimeout(400);
  const xlsxMsg = await page.textContent('#rosterCsvMsg');
  t('엑셀 업로드 결과 메시지(참여자·알림 메일 동시 등록)',
    /참여자 2명 등록/.test(xlsxMsg) && /알림 메일 2건 등록/.test(xlsxMsg), xlsxMsg.trim());
  const rosterNames2 = await page.locator('#rosterTable tbody tr td input[data-rename]').evaluateAll(
    (els) => els.map((e) => e.value));
  t('엑셀로 올린 이름이 명단 표에 추가됨(제목 줄 자동 건너뜀)',
    rosterNames2.includes('엑셀참여') && rosterNames2.includes('엑셀모임'), rosterNames2);

  // ── [명단 관리]: [알림 메일] 목록의 이름·메일을 이용해 비어 있는 이메일 칸 채우기 ──
  await page.click('button[data-tab="notify"]');
  await page.waitForTimeout(200);
  await page.fill('#notifyEmailInput', '소니, sony-sync@example.com');
  await page.click('#notifyAddBtn');
  await page.waitForTimeout(300);

  await page.click('button[data-tab="roster"]');
  await page.waitForTimeout(200);
  const nickInputsBeforeSync = page.locator('#rosterTable tbody tr td input[data-rename]');
  const nickValuesBeforeSync = await nickInputsBeforeSync.evaluateAll((els) => els.map((e) => e.value));
  const sonyIdx = nickValuesBeforeSync.indexOf('소니');
  const emailInputsAll = page.locator('#rosterTable tbody tr td input[data-editemail]');
  t('동기화 전에는 소니 이메일이 비어 있음', (await emailInputsAll.nth(sonyIdx).inputValue()) === '');

  await page.click('#syncEmailFromNotify');
  await page.waitForTimeout(400);
  t('이메일 채우기 완료 메시지', /명의 이메일을 채웠습니다/.test(await page.textContent('#syncEmailMsg')));
  const nickValuesAfterSync = await page.locator('#rosterTable tbody tr td input[data-rename]').evaluateAll(
    (els) => els.map((e) => e.value));
  const sonyIdxAfter = nickValuesAfterSync.indexOf('소니');
  t('[알림 메일] 목록의 이메일이 명단 관리 이메일 칸에 채워짐',
    (await page.locator('#rosterTable tbody tr td input[data-editemail]').nth(sonyIdxAfter).inputValue())
      === 'sony-sync@example.com');

  // ── 전체 보기: 전체 일정을 다 인증하고 나면 TXT 다운로드에 1일차~마지막 날 라벨과
  //    완주 축하 안내가 포함됨 (짧은(3일) 챌린지 컨텍스트에서 전 일정 인증) ──
  const finishCtx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await finishCtx.route('**/js/config.js', async (route) => {
    const res = await route.fetch();
    let body = await res.text();
    body = body.replace(/startDate: '[^']+'/, `startDate: '${shift(-2)}'`)
               .replace(/endDate: '[^']+'/, `endDate: '${shift(0)}'`)
               .replace(/backend: '[^']+'/, `backend: 'local'`);
    await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'application/javascript' } });
  });
  const finishPage = await finishCtx.newPage();

  await finishPage.goto(BASE + '/admin.html');
  await finishPage.waitForTimeout(400);
  await finishPage.click('button[data-tab="roster"]');
  await finishPage.fill('#bulkNames', '완주자');
  await finishPage.click('#bulkAdd');
  await finishPage.waitForTimeout(300);

  await finishPage.goto(BASE + '/index.html');
  await finishPage.waitForTimeout(400);
  const finishDateCount = await finishPage.locator('#certifyDate option').count();
  t('짧은(3일) 챌린지 컨텍스트에 3일치 날짜 존재', finishDateCount === 3, finishDateCount);
  await finishPage.selectOption('#participant', { label: '완주자' });
  await finishPage.waitForTimeout(300);
  for (let i = 0; i < finishDateCount; i++) {
    await finishPage.selectOption('#certifyDate', { index: i });
    await finishPage.waitForTimeout(150);
    await finishPage.fill('#sentence', `${i + 1}일차 인상 깊은 문장`);
    await finishPage.fill('#reflection', `${i + 1}일차 느낀 점`);
    await finishPage.click('#submitBtn');
    await finishPage.waitForTimeout(300);
  }

  await finishPage.goto(BASE + '/feed-all.html');
  await finishPage.waitForTimeout(400);
  await finishPage.selectOption('#allFeedPerson', { label: '완주자' });
  await finishPage.waitForTimeout(300);
  t('전체 일정을 인증하면 그 사람 건수가 전체 일수와 같음',
    (await finishPage.textContent('#feedCount')) === '3건', await finishPage.textContent('#feedCount'));

  const [finishDl] = await Promise.all([
    finishPage.waitForEvent('download'),
    finishPage.click('#allFeedDownloadBtn')
  ]);
  const finishText = fs.readFileSync(await finishDl.path(), 'utf-8');
  t('완주 시 다운로드 텍스트에 1일차~3일차 라벨이 모두 포함됨',
    finishText.includes('1일차') && finishText.includes('2일차') && finishText.includes('3일차'),
    finishText.slice(0, 400));
  t('완주 시 다운로드 텍스트에 완주 축하 안내 포함',
    finishText.includes('전체 완주하셨습니다'), finishText.slice(0, 200));

  await finishCtx.close();

  // ── 전체 진행현황: 전일(어제 24시 마감 확정) 기준 인증률·완료 인원 ──
  const prevCtx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await prevCtx.route('**/js/config.js', async (route) => {
    const res = await route.fetch();
    let body = await res.text();
    body = body.replace(/startDate: '[^']+'/, `startDate: '${shift(-5)}'`)
               .replace(/endDate: '[^']+'/, `endDate: '${shift(19)}'`)
               .replace(/backend: '[^']+'/, `backend: 'local'`);
    await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'application/javascript' } });
  });
  {
    const yest = shift(-1);
    const onTime = `${yest}T10:00:00.000Z`;          // 어제 마감(15:00Z) 전 → 인증(O)
    const tooLate = `${shift(0)}T02:00:00.000Z`;     // 어제 마감 후 → 지각이라 미인증(X)
    // 어제: 정시 3명 / 지각 1명 / 미제출 2명(마루·오늘만) → 완료 3명, 인증률 3÷6 = 50%
    const parts = ['가온', '나린', '다솜', '라온', '마루', '오늘만'].map((n, i) => ({
      id: 'p' + i, nickname: n, email: '', kakaoJoined: '', createdAt: shift(-5) + 'T00:00:00.000Z',
    }));
    const mk = (i, date, createdAt) => ({
      id: `s${i}_${date}`, participantId: 'p' + i, nickname: parts[i].nickname, date,
      sentence: '문장', reflection: '느낀 점', upvotes: 0, upvotedBy: [], createdAt, updatedAt: createdAt,
    });
    const subs = [mk(0, yest, onTime), mk(1, yest, onTime), mk(2, yest, onTime), mk(3, yest, tooLate)];
    // '마루'(p4)는 어제 미제출. '오늘만'(p5)은 오늘만 인증 — 전일 집계에 섞이면 안 된다.
    subs.push(mk(5, today, `${today}T01:00:00.000Z`));
    await prevCtx.addInitScript(({ parts, subs }) => {
      const K = 'comingsoon.reading.v1';
      localStorage.setItem(K + '.participants', JSON.stringify(parts));
      localStorage.setItem(K + '.submissions', JSON.stringify(subs));
      localStorage.setItem(K + '.meta', JSON.stringify({ createdAt: '2026-01-01T00:00:00.000Z' }));
    }, { parts, subs });

    const prevPage = await prevCtx.newPage();
    await prevPage.goto(BASE + '/index.html');
    await prevPage.waitForTimeout(500);

    t('전일 인증 완료 인원 = 어제 정시 인증한 3명',
      (await prevPage.textContent('#ovPrevDone')) === '3', await prevPage.textContent('#ovPrevDone'));
    t('전일 인증률 = 3÷6 = 50% (지각·미제출은 모두 분모에 포함)',
      (await prevPage.textContent('#ovPrevRate')) === '50%', await prevPage.textContent('#ovPrevRate'));
    t('안내 문구에 기준 날짜(어제)가 표시됨',
      (await prevPage.textContent('#ovPrevDateLabel')) === `${Number(yest.slice(5, 7))}/${Number(yest.slice(8, 10))}(${'일월화수목금토'[new Date(yest + 'T00:00:00Z').getUTCDay()]})`,
      await prevPage.textContent('#ovPrevDateLabel'));

    await prevPage.click('#ovPrevDoneTile');
    await prevPage.waitForSelector('#ovDetail:not([hidden])');
    const prevNames = await prevPage.textContent('#ovDetail');
    t('완료 명단에 어제 정시 인증자만 표시',
      prevNames.includes('가온') && prevNames.includes('나린') && prevNames.includes('다솜'), prevNames);
    t('어제 지각 제출자는 완료 명단에서 제외', !prevNames.includes('라온'), prevNames);
    t('어제 미제출자는 완료 명단에서 제외', !prevNames.includes('마루'), prevNames);
    t('오늘만 인증한 사람은 전일 집계에 섞이지 않음', !prevNames.includes('오늘만'), prevNames);
  }
  await prevCtx.close();

  // ── 명예의 전당: 전일(어제) 인증글을 추천(👍) 많은 순으로 1~10위 ──
  // 추천은 한 브라우저당 1표만 누를 수 있어 UI로는 득표차를 만들 수 없으므로 저장소를 직접 심는다.
  const fameCtx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await fameCtx.route('**/js/config.js', async (route) => {
    const res = await route.fetch();
    let body = await res.text();
    body = body.replace(/startDate: '[^']+'/, `startDate: '${shift(-5)}'`)
               .replace(/endDate: '[^']+'/, `endDate: '${shift(19)}'`)
               .replace(/backend: '[^']+'/, `backend: 'local'`);
    await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'application/javascript' } });
  });
  {
    const yest = shift(-1);
    const onTime = `${yest}T10:00:00.000Z`;      // 어제 마감(15:00Z) 전
    const tooLate = `${today}T02:00:00.000Z`;    // 어제 마감 후 → 지각
    // 어제 12명(11표~0표) + 지각 1명(몰표) + 오늘 1명(몰표)
    const rows = [
      ['일번', 11], ['이번', 10], ['삼번', 9], ['사번', 8], ['오번', 7],
      ['육번', 6], ['칠번', 5], ['팔번', 4], ['구번', 3], ['십번', 2],
      ['십일번', 1], ['영표', 0],
    ];
    const parts = rows.map(([n], i) => ({ id: 'p' + i, nickname: n, email: '', kakaoJoined: '', createdAt: shift(-5) + 'T00:00:00.000Z' }));
    const subs = rows.map(([n, v], i) => ({
      id: 's' + i, participantId: 'p' + i, nickname: n, date: yest,
      sentence: `${n}의 어제 인상 깊은 내용`, reflection: `${n}의 어제 느낀 점`,
      upvotes: v, upvotedBy: [], createdAt: onTime, updatedAt: onTime,
    }));
    parts.push({ id: 'pL', nickname: '지각왕', email: '', kakaoJoined: '', createdAt: shift(-5) + 'T00:00:00.000Z' });
    subs.push({ id: 'sL', participantId: 'pL', nickname: '지각왕', date: yest,
      sentence: '지각 문장', reflection: '지각 느낀 점', upvotes: 99, upvotedBy: [],
      createdAt: tooLate, updatedAt: tooLate });
    parts.push({ id: 'pT', nickname: '오늘왕', email: '', kakaoJoined: '', createdAt: shift(-5) + 'T00:00:00.000Z' });
    subs.push({ id: 'sT', participantId: 'pT', nickname: '오늘왕', date: today,
      sentence: '오늘 문장', reflection: '오늘 느낀 점', upvotes: 98, upvotedBy: [],
      createdAt: `${today}T01:00:00.000Z`, updatedAt: `${today}T01:00:00.000Z` });

    await fameCtx.addInitScript(({ parts, subs }) => {
      const K = 'comingsoon.reading.v1';
      localStorage.setItem(K + '.participants', JSON.stringify(parts));
      localStorage.setItem(K + '.submissions', JSON.stringify(subs));
      localStorage.setItem(K + '.meta', JSON.stringify({ createdAt: '2026-01-01T00:00:00.000Z' }));
    }, { parts, subs });

    const famePage = await fameCtx.newPage();
    await famePage.goto(BASE + '/index.html');
    await famePage.waitForSelector('#hallOfFameList li[data-fame]');

    const names = await famePage.locator('#hallOfFameList .who').allTextContents();
    t('명예의 전당은 10위까지 보임', names.length === 10, names.length);
    t('명예의 전당이 전일 추천 많은 순서대로 줄 세워짐',
      JSON.stringify(names) === JSON.stringify(['일번', '이번', '삼번', '사번', '오번', '육번', '칠번', '팔번', '구번', '십번']),
      names);
    t('11위 이하는 잘림', !names.includes('십일번'), names);
    t('추천 0표인 사람은 순위에 오르지 않음', !names.includes('영표'), names);
    t('어제 지각 제출은 몰표를 받아도 명예의 전당에서 제외', !names.includes('지각왕'), names);
    t('오늘 글은 전일 순위에 섞이지 않음', !names.includes('오늘왕'), names);

    const cnts = await famePage.locator('#hallOfFameList .cnt').allTextContents();
    t('순위 옆에 실제 추천 수가 함께 표시됨', cnts[0].includes('👍 11') && cnts[1].includes('👍 10'), cnts);
    t('등수가 1등부터 순서대로 매겨짐', cnts[0].startsWith('1등') && cnts[9].startsWith('10등'), cnts);
    t('안내 문구에 기준 날짜(어제)가 표시됨',
      (await famePage.textContent('#fameDateLabel')).includes(String(Number(yest.slice(5, 7))) + '/'),
      await famePage.textContent('#fameDateLabel'));

    await famePage.click('#hallOfFameList li[data-fame="삼번"]');
    await famePage.waitForSelector('#fameDetail:not([hidden])');
    const fameText = await famePage.textContent('#fameDetail');
    t('이름을 누르면 인상 깊은 내용이 펼쳐짐', fameText.includes('삼번의 어제 인상 깊은 내용'), fameText);
    t('이름을 누르면 느낀 점도 함께 펼쳐짐', fameText.includes('삼번의 어제 느낀 점'), fameText);
    t('펼친 내용에 항목 라벨이 붙음',
      fameText.includes('인상 깊은 내용') && fameText.includes('느낀 점'), fameText);
    await famePage.click('#hallOfFameList li[data-fame="삼번"]');
    await famePage.waitForTimeout(150);
    t('다시 누르면 접힘', await famePage.isHidden('#fameDetail'));
  }
  await fameCtx.close();

  // 모바일 뷰포트에서 가로 스크롤 없는지 + 한글 텍스트가 이상하게(글자 하나씩) 줄바꿈되지 않는지
  const m = await ctx.newPage();
  await m.setViewportSize({ width: 360, height: 780 }); // 실제 좁은 안드로이드 기기 폭 기준
  await m.goto(BASE + '/index.html');
  await m.waitForTimeout(400);
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  t('모바일 가로 오버플로 없음', overflow <= 1, overflow);
  t('본문 word-break: keep-all 적용(단어 중간이 아니라 띄어쓰기 기준 줄바꿈)',
    (await m.evaluate(() => getComputedStyle(document.body).wordBreak)) === 'keep-all');
  const feedNickWS = await m.evaluate(() => {
    const el = document.querySelector('#socialFeedList .feed-nick');
    return el && getComputedStyle(el).whiteSpace;
  });
  t('좁은 화면에서 피드 이름이 "커…" 처럼 뭉개지지 않고 한 줄을 다 씀(white-space: normal)',
    feedNickWS === 'normal', feedNickWS);

  await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/admin.png', fullPage: true });
  await m.screenshot({ path: (process.env.SHOT_DIR || '.') + '/mobile.png', fullPage: true });

  console.log('\nJS 오류:', errs.length ? errs : '없음');
  console.log(`결과: ${pass} pass / ${fail} fail`);
  await browser.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
