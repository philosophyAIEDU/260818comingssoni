// 전체 메뉴(사이드바·서랍) 검수 — 375 · 768 · 1024 · 1440px
// 메뉴 목적지 · 홈/콘텐츠 같은 메뉴 · 하단 탭과 서랍 동기화 · 직접 접속·새로고침·뒤로 가기 · 접기/펼치기
// · 가로 스크롤·겹침 · 작성 중 글 보존 · 키보드 조작 · 동작 줄이기
function loadPlaywright() {
  for (const m of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { return require(m); } catch (e) { /* 다음 */ } }
  throw new Error('playwright 없음');
}
const { chromium } = loadPlaywright();
const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const SHOTS = process.env.SHOTS || '';
let pass = 0, fail = 0;
const errs = [];
const t = (n, c, x) => (c ? (pass++, console.log('  ok  ', n)) : (fail++, console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x))));

(async () => {
  const browser = await chromium.launch();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const shift = (n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  async function newCtx(opts) {
    const ctx = await browser.newContext(Object.assign({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' }, opts));
    await ctx.route((u) => u.pathname === '/.netlify/functions/content-library', (r) => r.fulfill({ json: { videos: [], columns: [] } }));
    await ctx.route((u) => u.pathname === '/.netlify/functions/track', (r) => r.fulfill({ status: 204 }));
    await ctx.route('**/js/config.js', async (route) => {
      const res = await route.fetch();
      const body = (await res.text())
        .replace(/startDate: '[^']+'/, `startDate: '${shift(-8)}'`).replace(/endDate: '[^']+'/, `endDate: '${shift(19)}'`)
        .replace(/backend: '[^']+'/, "backend: 'local'")
        .replace('CS.pickSeason(CS.seasonNowKST(), CS.seasonOverride)', "CS.pickSeason(CS.seasonNowKST(), 's1')")
        .replace(/lockAt: '[^']*'/g, 'lockAt: null')
        + "\ntry { localStorage.setItem(CS.CONFIG.storagePrefix + '.awardSeen', '9999-12-31'); } catch (e) {}\n";
      await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'application/javascript' } });
    });
    return ctx;
  }
  const watch = (p) => {
    p.on('pageerror', (e) => errs.push(`${p.viewportSize().width}px pageerror: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errs.push(`${p.viewportSize().width}px console: ${m.text()}`); });
    p.on('dialog', (d) => d.accept());
  };

  // 명단 한 번 넣어 둔다(로컬 저장소 — 같은 컨텍스트에서만 유지되므로 크기마다 새로 넣는다)
  async function seed(page) {
    await page.goto(BASE + '/admin.html');
    await page.waitForTimeout(300);
    await page.click('button[data-tab="roster"]');
    await page.fill('#bulkNames', '커밍쏜\n소니');
    await page.click('#bulkAdd');
    await page.waitForTimeout(300);
  }

  const MENU = ['오늘의 인증', '나의 현황', '인증 피드', '명예의 전당', '추천 유튜브', '뉴스레터 칼럼', '보관함', '멤버십 안내'];
  const menuLabels = (page) => page.$$eval('#sidenav .sn-scroll li:not([hidden]) .sn-label', (els) => els.map((e) => e.childNodes[0].textContent.trim()));
  const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const current = (page) => page.$$eval('#sidenav [aria-current="page"]', (els) => els.map((e) => e.closest('li').dataset.item));
  const inView = (page, sel) => page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    const head = document.querySelector('header.top');
    const hb = head && getComputedStyle(head).display !== 'none' && getComputedStyle(head).position === 'sticky' ? head.getBoundingClientRect().bottom : 0;
    return r.top >= hb - 1 && r.top < innerHeight - 80 && r.height > 0; // 제목이 머리에 가리지 않고 화면 안에
  }, sel);

  for (const W of [375, 768, 1024, 1440]) {
    console.log(`\n■ ${W}px`);
    const mobile = W < 900;
    const ctx = await newCtx({ viewport: { width: W, height: mobile ? 812 : 900 } });
    const page = await ctx.newPage();
    watch(page);
    await seed(page);
    await page.goto(BASE + '/index.html');
    await page.waitForTimeout(400);

    t(`${W}: 가로 스크롤 없음`, (await overflowX(page)) <= 0, await overflowX(page));
    t(`${W}: 메뉴 항목·순서`, JSON.stringify(await menuLabels(page)) === JSON.stringify(MENU), await menuLabels(page));
    t(`${W}: 전체 진행현황은 참여자에게 감춘 카드라 메뉴에서도 빠짐`, await page.locator('#sidenav [data-item="overall"]').isHidden());
    t(`${W}: 운영진 링크는 하단(admin.html)`, (await page.getAttribute('#sidenav .sn-foot a', 'href')) === 'admin.html');
    t(`${W}: 시즌·책 제목`, /『.+』/.test(await page.textContent('#sidenav .sn-book')));
    const small = await page.$$eval('#sidenav a[href], #sidenav button, .sn-menu-btn', (els) => els.filter((e) => e.getClientRects().length && !e.closest('[hidden]'))
      .filter((e) => { const r = e.getBoundingClientRect(); return r.height < 44 || r.width < 32; }).map((e) => e.className || e.textContent));
    if (!mobile) t(`${W}: 클릭 영역 최소 44px`, small.length === 0, small);

    if (!mobile) {
      // ── 넓은 화면: 왼쪽 고정 240px ──
      const box = await page.locator('#sidenav').boundingBox();
      t(`${W}: 사이드바 왼쪽 고정 240px`, box.x === 0 && box.width === 240 && box.height >= 899, box);
      t(`${W}: 위 머리 숨김·하단 탭 숨김·☰ 숨김`, await page.locator('header.top').isHidden() && await page.locator('#tabbar').isHidden() && await page.locator('.sn-menu-btn').isHidden());
      const mainX = (await page.locator('main.wrap').boundingBox()).x;
      t(`${W}: 본문이 사이드바와 겹치지 않음`, mainX >= 240, mainX);
      t(`${W}: 아이콘 + 이름이 함께`, await page.locator('#sidenav [data-item="feed"] .sn-ico').isVisible() && await page.locator('#sidenav [data-item="feed"] .sn-label').isVisible());
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/nav-${W}.png` });
      t(`${W}: 처음 열면 [오늘의 인증] 화면`, (await current(page)).join() === 'certify' && await page.isVisible('#certifyCard') && !(await page.isVisible('#bookCard')), await current(page));

      // 메뉴 하나 = 화면 하나 — 고른 화면만 보이고 맨 위에서 시작(위아래로 오가지 않음)
      const PANES = ['info', 'certify', 'feed', 'fame', 'me'];
      const DEST = { me: ['me', '#whoCard', '#me'], feed: ['feed', '#feedCard', '#feed'], fame: ['fame', '#fameCard', '#fame'], info: ['info', '#bookCard', '#info'], certify: ['certify', '#certifyCard', ''] };
      for (const [id, [pane, sel, hash]] of Object.entries(DEST)) {
        await page.evaluate(() => window.scrollTo(0, 300));
        await page.click(`#sidenav [data-item="${id}"] a`);
        await page.waitForTimeout(250);
        const vis = await page.evaluate((ps) => ps.filter((p) => getComputedStyle(document.getElementById('pane-' + p)).display !== 'none'), PANES);
        const st = { vis, cur: await current(page), hash: await page.evaluate(() => location.hash), y: await page.evaluate(() => window.scrollY) };
        t(`${W}: [${id}] → ${pane} 화면만 보임 · 맨 위 · 표시 · 주소 '${hash}'`,
          st.vis.join() === pane && await page.isVisible(sel) && st.y === 0 && st.cur.join() === id && st.hash === hash, st);
      }
      t(`${W}: [멤버십 안내] 한 화면에 이번 책·일정 + 안내·규칙`, await (async () => {
        await page.click('#sidenav [data-item="info"] a'); await page.waitForTimeout(200);
        return await page.isVisible('#bookCard') && await page.isVisible('#rulesCard');
      })());
      const curStyle = await page.$eval('#sidenav [data-item="info"] a', (a) => ({ bg: getComputedStyle(a).backgroundColor, bar: getComputedStyle(a, '::before').width }));
      t(`${W}: 지금 메뉴는 배경색 + 표시선`, curStyle.bg !== 'rgba(0, 0, 0, 0)' && curStyle.bar === '3px', curStyle);
      const top = await page.$eval('#pane-info', (e) => e.getBoundingClientRect().top);
      t(`${W}: 화면 제목이 위에 가려지지 않음`, top >= 0 && top < 60, top);
      // 뒤로 가기
      await page.click('#sidenav [data-item="feed"] a'); await page.waitForTimeout(900);
      await page.click('#sidenav [data-item="fame"] a'); await page.waitForTimeout(900);
      await page.goBack(); await page.waitForTimeout(900);
      t(`${W}: 뒤로 가기 → 피드 자리·표시`, (await page.evaluate(() => location.hash)) === '#feed' && (await current(page)).join() === 'feed' && await inView(page, '#feedCard'), await current(page));

      // 접기·펼치기 + 툴팁 + 본문 너비
      await page.click('#sidenav .sn-collapse');
      await page.waitForTimeout(200);
      const cw = (await page.locator('#sidenav').boundingBox()).width;
      const mainX2 = (await page.locator('main.wrap').boundingBox()).x;
      t(`${W}: 접으면 72px · 이름 숨김 · 본문 너비 따라감`, cw === 72 && await page.locator('#sidenav [data-item="feed"] .sn-label').evaluate((e) => e.getBoundingClientRect().width <= 1) && mainX2 >= 72 && mainX2 < mainX + 1, { cw, mainX2 });
      t(`${W}: 접은 상태 aria-expanded=false`, (await page.getAttribute('#sidenav .sn-collapse', 'aria-expanded')) === 'false');
      await page.hover('#sidenav [data-item="fame"] a');
      await page.waitForTimeout(100);
      t(`${W}: 접힌 메뉴에 마우스 → 이름표`, await page.isVisible('.sn-tip') && (await page.textContent('.sn-tip')) === '명예의 전당');
      if (SHOTS && W === 1440) await page.screenshot({ path: `${SHOTS}/nav-${W}-collapsed.png` });
      t(`${W}: 접은 상태에서도 가로 스크롤 없음`, (await overflowX(page)) <= 0);
      await page.reload(); await page.waitForTimeout(500);
      t(`${W}: 새로고침해도 접힘 유지 + 주소 자리(#feed) 그대로`, (await page.locator('#sidenav').boundingBox()).width === 72 && (await current(page)).join() === 'feed' && await inView(page, '#feedCard'));
      await page.click('#sidenav .sn-collapse'); await page.waitForTimeout(200);
      t(`${W}: 다시 펼치면 240px`, (await page.locator('#sidenav').boundingBox()).width === 240);

      // 키보드만으로: 메뉴 링크에 Tab으로 가서 Enter
      await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
      await page.focus('#sidenav .sn-brand');
      let reached = false;
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        if (await page.evaluate(() => document.activeElement && document.activeElement.closest('li') && document.activeElement.closest('li').dataset.item === 'fame')) { reached = true; break; }
      }
      const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
      await page.keyboard.press('Enter'); await page.waitForTimeout(900);
      t(`${W}: 키보드(Tab·Enter)로 메뉴 이동 + 포커스 표시`, reached && ring !== 'none' && await inView(page, '#fameCard') && (await current(page)).join() === 'fame', { reached, ring });
      t(`${W}: 키보드로 옮기면 그 카드로 포커스`, await page.evaluate(() => document.activeElement.id === 'fameCard'));
    } else {
      // ── 휴대폰: 고정 사이드바 숨김 · ☰ · 서랍 ──
      t(`${W}: 고정 사이드바 숨김·하단 탭 5칸 유지`, !(await page.locator('#sidenav').isVisible()) && (await page.locator('#tabbar [data-go]').count()) === 5 && await page.isVisible('#tabbar'));
      const btn = await page.locator('.sn-menu-btn').boundingBox();
      t(`${W}: 머리에 ☰(44px)`, btn && btn.width >= 44 && btn.height >= 44, btn);
      t(`${W}: 머리 한 줄(겹침 없음)`, (await page.locator('header.top').boundingBox()).height < 80);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/nav-${W}.png` });

      // 열기 → 배경 스크롤 막힘 → Esc 닫기 → 포커스 복귀
      await page.evaluate(() => window.scrollTo(0, 200));
      await page.click('.sn-menu-btn'); await page.waitForTimeout(300);
      const open = await page.locator('#sidenav').boundingBox();
      t(`${W}: ☰ → 왼쪽 서랍 열림`, await page.isVisible('#sidenav') && open.x === 0 && (await page.getAttribute('.sn-menu-btn', 'aria-expanded')) === 'true');
      t(`${W}: 열려 있으면 배경 스크롤 막힘`, await page.evaluate(() => getComputedStyle(document.body).position === 'fixed' && document.documentElement.classList.contains('sidenav-lock')));
      t(`${W}: 서랍 = 대화상자(aria-modal)`, (await page.getAttribute('#sidenav', 'aria-modal')) === 'true');
      const items = await page.$$eval('#sidenav .sn-scroll li:not([hidden]) a', (els) => els.map((e) => e.getBoundingClientRect().height));
      t(`${W}: 서랍 메뉴 클릭 영역 44px 이상`, items.every((h) => h >= 44), items);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/nav-${W}-drawer.png` });
      // Tab은 서랍 안에서만 돈다
      for (let i = 0; i < 20; i++) await page.keyboard.press('Tab');
      t(`${W}: 서랍 안에서 Tab이 돈다(밖으로 안 나감)`, await page.evaluate(() => !!document.activeElement.closest('#sidenav')));
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      t(`${W}: Esc로 닫힘 · 포커스는 ☰로 · 스크롤 위치 복원`, !(await page.isVisible('#sidenav')) && await page.evaluate(() => document.activeElement.classList.contains('sn-menu-btn')) && (await page.evaluate(() => window.scrollY)) === 200, await page.evaluate(() => window.scrollY));
      // 배경 클릭
      await page.click('.sn-menu-btn'); await page.waitForTimeout(300);
      await page.mouse.click(W - 10, 400); await page.waitForTimeout(300);
      t(`${W}: 배경 클릭으로 닫힘`, !(await page.isVisible('#sidenav')) && await page.evaluate(() => document.activeElement.classList.contains('sn-menu-btn')));

      // 메뉴 선택 → 그 pane을 먼저 열고 카드로
      const DEST = { feed: ['feed', '#feedCard'], fame: ['fame', '#fameCard'], info: ['info', '#bookCard'], me: ['me', '#whoCard'], certify: ['certify', '#certifyCard'] };
      for (const [id, [pane, sel]] of Object.entries(DEST)) {
        await page.click('.sn-menu-btn'); await page.waitForTimeout(250);
        await page.click(`#sidenav [data-item="${id}"] a`); await page.waitForTimeout(400);
        const st = await page.evaluate((p) => ({ pane: document.querySelector('.pane.active').dataset.pane, tab: (document.querySelector('#tabbar [aria-current]') || {}).dataset?.go }), pane);
        t(`${W}: [${id}] → ${pane} 화면 열고 ${sel} 보임 · 서랍 닫힘 · 하단 탭 ${pane} 표시 · 포커스 ☰`,
          st.pane === pane && st.tab === pane && await inView(page, sel) && !(await page.isVisible('#sidenav'))
          && await page.evaluate(() => document.activeElement.classList.contains('sn-menu-btn')), st);
      }
      // 하단 탭 → 서랍 표시도 같이
      await page.click('#tabbar [data-go="fame"]'); await page.waitForTimeout(200);
      t(`${W}: 하단 탭 [명예의 전당] → 서랍 메뉴도 명예의 전당`, (await current(page)).join() === 'fame');
      await page.click('#tabbar [data-go="feed"]'); await page.waitForTimeout(200);
      await page.goBack(); await page.waitForTimeout(300);
      t(`${W}: 뒤로 가기 → 명예의 전당 화면·탭·메뉴 함께`, await page.evaluate(() => document.querySelector('.pane.active').dataset.pane) === 'fame'
        && (await page.getAttribute('#tabbar [data-go="fame"]', 'aria-current')) === 'page' && (await current(page)).join() === 'fame');
      // [나의 현황] 이름을 안 골랐으면 이름 고르기 안내
      await page.click('#tabbar [data-go="me"]'); await page.waitForTimeout(200);
      t(`${W}: 나의 현황 — 이름 전이면 기존 이름 선택 안내`, await page.isVisible('#meWho') && await page.isVisible('#myEmpty') && !(await page.isVisible('#myCard')));
      // 키보드만으로: ☰에 포커스 → Enter → 메뉴 → Enter
      await page.focus('.sn-menu-btn'); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
      const firstFocus = await page.evaluate(() => document.activeElement.closest('li') ? document.activeElement.closest('li').dataset.item : document.activeElement.className);
      let reached = false;
      for (let i = 0; i < 14; i++) {
        if (await page.evaluate(() => document.activeElement.closest('li') && document.activeElement.closest('li').dataset.item === 'feed')) { reached = true; break; }
        await page.keyboard.press('Tab');
      }
      await page.keyboard.press('Enter'); await page.waitForTimeout(350);
      t(`${W}: 키보드만으로 ☰ 열기 → 메뉴 → 이동 (열면 지금 메뉴에 포커스: ${firstFocus})`, firstFocus === 'me' && reached && await page.evaluate(() => document.querySelector('.pane.active').dataset.pane) === 'feed');
    }

    // ── 직접 접속 · 새로고침 ──
    await page.goto(BASE + '/index.html#rules'); await page.waitForTimeout(600);
    t(`${W}: 예전 주소 #rules로 직접 접속 → 멤버십 안내 화면의 규칙 카드 · 메뉴는 [멤버십 안내]`, await inView(page, '#rulesCard') && (await current(page)).join() === 'info');
    await page.goto(BASE + '/index.html#me'); await page.waitForTimeout(500);
    await page.reload(); await page.waitForTimeout(600);
    t(`${W}: 기존 #me 새로고침 → 나의 현황`, await page.isVisible('#whoCard') && (await current(page)).join() === 'me');
    await page.goto(BASE + '/index.html#overall'); await page.waitForTimeout(500);
    t(`${W}: 감춘 카드 주소(#overall)로 오면 보이는 자리로 바로잡음`, (await page.evaluate(() => location.hash)) === '#fame' && (await current(page)).join() === 'fame');

    // ── 작성 중 인증 글 보존 ──
    await page.goto(BASE + '/index.html'); await page.waitForTimeout(500);
    if (mobile) { await page.click('#tabbar [data-go="certify"]'); await page.waitForTimeout(150); }
    await page.selectOption('#participant', { label: '커밍쏜' });
    await page.fill('#sentence', `작성 중 문장 ${W}`);
    await page.fill('#reflection', `느낀 점 ${W}`);
    if (mobile) { await page.click('.sn-menu-btn'); await page.waitForTimeout(250); }
    await page.click('#sidenav [data-item="feed"] a'); await page.waitForTimeout(600);
    if (mobile) { await page.click('.sn-menu-btn'); await page.waitForTimeout(250); }
    await page.click('#sidenav [data-item="certify"] a'); await page.waitForTimeout(600);
    t(`${W}: 메뉴를 오가도 쓰던 인증 글 그대로`, (await page.inputValue('#sentence')) === `작성 중 문장 ${W}` && (await page.inputValue('#reflection')) === `느낀 점 ${W}`);
    // 콘텐츠 화면에 다녀와도(새 페이지) 임시 저장으로 돌아옴
    if (mobile) { await page.click('.sn-menu-btn'); await page.waitForTimeout(250); }
    await page.click('#sidenav [data-item="columns"] a'); await page.waitForURL('**/content.html#columns'); await page.waitForTimeout(500);
    t(`${W}: [뉴스레터 칼럼] → 콘텐츠 화면 칼럼 탭`, (await page.getAttribute('.content-tabs [data-filter="columns"]', 'aria-pressed')) === 'true' && (await current(page)).join() === 'columns');
    t(`${W}: 콘텐츠 화면도 같은 메뉴`, JSON.stringify(await menuLabels(page)) === JSON.stringify(MENU), await menuLabels(page));
    t(`${W}: 콘텐츠 화면 가로 스크롤 없음`, (await overflowX(page)) <= 0, await overflowX(page));
    if (SHOTS && (W === 375 || W === 1440)) await page.screenshot({ path: `${SHOTS}/nav-${W}-content.png` });
    // 콘텐츠 화면 안에서 메뉴로 탭 바꾸기 + 뒤로 가기
    if (mobile) { await page.click('.sn-menu-btn'); await page.waitForTimeout(250); }
    await page.click('#sidenav [data-item="saved"] a'); await page.waitForTimeout(300);
    t(`${W}: 콘텐츠 화면 [보관함] → 보관함 탭 · 주소 #saved`, (await page.getAttribute('.content-tabs [data-filter="saved"]', 'aria-pressed')) === 'true' && (await page.evaluate(() => location.hash)) === '#saved' && (await current(page)).join() === 'saved');
    await page.click('.content-tabs [data-filter="videos"]'); await page.waitForTimeout(200);
    t(`${W}: 콘텐츠 탭 버튼을 눌러도 메뉴 표시 따라감`, (await current(page)).join() === 'videos');
    await page.goBack(); await page.waitForTimeout(300);
    t(`${W}: 뒤로 가기 → 보관함 탭·메뉴 함께`, (await page.getAttribute('.content-tabs [data-filter="saved"]', 'aria-pressed')) === 'true' && (await current(page)).join() === 'saved');
    await page.goBack(); await page.waitForTimeout(300);
    t(`${W}: 한 번 더 뒤로 → 칼럼 탭`, (await page.getAttribute('.content-tabs [data-filter="columns"]', 'aria-pressed')) === 'true' && (await current(page)).join() === 'columns');
    // 콘텐츠 → 오늘의 인증
    if (mobile) { await page.click('.sn-menu-btn'); await page.waitForTimeout(250); }
    await page.click('#sidenav [data-item="certify"] a'); await page.waitForURL((u) => u.pathname.endsWith('/index.html') && !u.hash); await page.waitForTimeout(700);
    if (mobile) t(`${W}: 콘텐츠 → [오늘의 인증] 인증 화면`, await page.evaluate(() => document.querySelector('.pane.active').dataset.pane) === 'certify');
    else t(`${W}: 콘텐츠 → [오늘의 인증] 인증 카드로`, await inView(page, '#certifyCard'));
    await page.selectOption('#participant', { label: '커밍쏜' }); await page.waitForTimeout(200);
    t(`${W}: 다른 화면에 다녀와도 쓰던 글 복원(임시 저장)`, (await page.inputValue('#sentence')) === `작성 중 문장 ${W}`, await page.inputValue('#sentence'));
    // 기존 인증 기능 그대로
    await page.click('#submitBtn'); await page.waitForTimeout(600);
    t(`${W}: 인증 제출 동작`, /인증|완료|저장/.test(await page.textContent('#formMsg')), (await page.textContent('#formMsg')).slice(0, 40));
    t(`${W}: 인증 직후 "다른 분들 글 보기 · 내 현황 보기" 바로가기(PC에도)`, await page.isVisible('#formMsg .quick-go'));
    await page.click('#formMsg .quick-go [data-go="feed"]'); await page.waitForTimeout(250);
    t(`${W}: 바로가기 → 인증 피드 화면 · 메뉴 표시`, await page.isVisible('#feedCard') && !(await page.isVisible('#certifyCard')) && (await current(page)).join() === 'feed');
    await ctx.close();
  }

  // ── 지난 시즌 둘러보기: 감춘 화면은 메뉴에서도 빠지고, 메뉴 주소에 시즌이 붙는다 ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route((u) => u.pathname === '/.netlify/functions/content-library', (r) => r.fulfill({ json: { videos: [], columns: [] } }));
    await ctx.route((u) => u.pathname === '/.netlify/functions/track', (r) => r.fulfill({ status: 204 }));
    await ctx.route((u) => /\/\.netlify\/functions\/feed-read/.test(u.pathname), (r) => r.fulfill({ json: { posts: [], participants: [] } }));
    const page = await ctx.newPage();
    await page.goto(BASE + '/content.html?season=s3#videos'); await page.waitForTimeout(500);
    const labels = await menuLabels(page);
    t('지난 시즌(콘텐츠 화면): 인증·나의 현황 메뉴 빠짐', !labels.includes('오늘의 인증') && !labels.includes('나의 현황') && labels.includes('멤버십 안내') && labels.includes('인증 피드'), labels);
    t('지난 시즌: 메뉴 주소에 ?season=s3 유지', (await page.getAttribute('#sidenav [data-item="feed"] a', 'href')) === 'index.html?season=s3#feed');
    t('지난 시즌: 시즌 표시', /지난 시즌/.test(await page.textContent('#sidenav .sn-season')));
    await ctx.close();
  }

  // ── 동작 줄이기 ──
  {
    const ctx = await newCtx({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/index.html'); await page.waitForTimeout(300);
    t('동작 줄이기: 서랍 움직임 끔', (await page.$eval('#sidenav', (e) => getComputedStyle(e).transitionDuration)).split(',').every((x) => parseFloat(x) === 0));
    await ctx.close();
  }

  await browser.close();
  console.log(`\nJS 오류: ${errs.length ? errs.join(' | ') : '없음'}`);
  console.log(`결과: ${pass} pass / ${fail} fail`);
  process.exit(fail || errs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
