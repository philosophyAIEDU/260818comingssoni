// 읽기 줄이기 통합 시험: 멤버 앱(Firebase 모드)을 실제로 열어, Firestore 읽기가 얼마나 일어나는지 세고
// 화면(명단·피드·내 글·추천)이 제대로 나오는지 본다. 서버 함수(feed-read)는 실제 코드를 그대로 돌리고 Firestore만 가짜다.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('module'); const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'firebase-admin' ? 'firebase-admin-stub' : resolve.call(this, req, ...rest); };
require.cache['firebase-admin-stub'] = { id: 'firebase-admin-stub', loaded: true, exports: {} };
const { makeStore, SDK_APP, SDK_AUTH, SDK_FS } = require('./helpers/fakeFirestore');
const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const lib = path.join(__dirname, '../netlify/functions/_lib');

const store = makeStore();
const server = { reads: 0, writes: 0 }, browser = { reads: 0, writes: 0, log: [] };
require.cache[require.resolve(path.join(lib, 'firebaseAdmin.js'))] = { exports: { getDb: () => store.admin(server) } };
let adminOk = false;
require.cache[require.resolve(path.join(lib, 'adminAuth.js'))] = { exports: {
  json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  requireAdmin: async () => (adminOk ? { email: 'a@b.c' } : { error: { statusCode: 403, body: '{"error":"운영진만"}' } }) } };
const feedRead = require('../netlify/functions/feed-read.js');
const U = global.CS.U;

// 시험 시즌: 서버·브라우저 모두 s1(저장소 접두사 없음)을 "오늘이 9일차"가 되게 맞춘다(test/ui.test.js와 같은 방식)
const today = U.today(); const shift = (n) => U.addDays(today, n);
const START = shift(-8), END = shift(19);
Object.assign(global.CS.SEASONS.find((s) => s.id === 's1'), { startDate: START, endDate: END });

const N = 100;
for (let i = 0; i < N; i++) store.col('participants').set('p' + i, { nickname: `멤버${String(i).padStart(3, '0')}`, status: 'active', joinDate: START, outDate: null, exemptDates: [], email: `m${i}@x.com`, phone: '010-1111-' + i, note: '운영 메모', createdAt: '2026-01-01T00:00:00' });
let sid = 0;
const addSubs = (date, count) => { for (let i = 0; i < count; i++) store.col('submissions').set('seed' + (sid++), { participantId: 'p' + i, nickname: `멤버${String(i).padStart(3, '0')}`, date, sentence: `${date} 문장 ${i}`, reflection: '느낀 점 '.repeat(20), upvotes: 0, upvotedBy: [], createdAt: `${date}T0${i % 9}:00:00`, updatedAt: `${date}T0${i % 9}:00:00` }); };
addSubs(today, 60); addSubs(shift(-1), 40); addSubs(shift(-2), 50); addSubs(shift(-3), 50); addSubs(shift(-4), 50);

(async () => {
  const chromeArgs = {};
  const browserApp = await chromium.launch();
  const errors = [];
  async function openMember(label) {
    const ctx = await browserApp.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 1100, height: 900 } });
    await ctx.exposeFunction('__fsOp', store.clientOp(browser));
    await ctx.route('**/js/config.js', async (r) => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace('CS.pickSeason(CS.seasonNowKST(), CS.seasonOverride)', "CS.pickSeason(CS.seasonNowKST(), 's1')")
        .replace(/startDate: '[^']+'/, `startDate: '${START}'`).replace(/endDate: '[^']+'/, `endDate: '${END}'`)
        .replace(/lockAt: '[^']*'/g, 'lockAt: null').replace(/backend: '[^']+'/, "backend: 'firebase'")
        + "\ntry { localStorage.setItem(CS.CONFIG.storagePrefix + '.awardSeen', '9999-12-31'); } catch (e) {}\n";
      r.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'application/javascript' } });
    });
    const js = (body) => ({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
    await ctx.route('https://www.gstatic.com/firebasejs/**', (r) => { const u = r.request().url(); r.fulfill(js(/firebase-app/.test(u) ? SDK_APP : /firebase-auth/.test(u) ? SDK_AUTH : SDK_FS)); });
    await ctx.route((u) => u.pathname === '/.netlify/functions/feed-read', async (r) => {
      const u = new URL(r.request().url());
      const res = await feedRead.handler({ httpMethod: r.request().method(), headers: r.request().headers(), queryStringParameters: Object.fromEntries(u.searchParams), body: r.request().postData() });
      r.fulfill({ status: res.statusCode, headers: res.headers || {}, body: res.body });
    });
    await ctx.route((u) => /\/.netlify\/functions\/(content-library|track)$/.test(u.pathname), (r) => r.fulfill({ status: 204 }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(label + ': ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push(label + ' console: ' + m.text()); });
    return { ctx, page };
  }
  const feedCount = (page) => page.locator('#socialFeedList .feed-item').count();
  // 피드는 기본이 추천 많은 순 20건이라 새 글(추천 0)은 첫 쪽에 없다 — 이름 검색으로 좁혀 본다
  const searchFeed = async (page, name) => { await page.fill('#feedSearch', name); await page.waitForTimeout(250); };
  const feedText = (page) => page.locator('#socialFeedList').textContent();

  // 1) 첫 기기: 명단 100명·오늘 60건·어제 40건·그 앞 3일 150건이 화면에 나오고, Firestore를 직접 읽은 건 내 글 조회 정도
  let { ctx, page } = await openMember('첫 기기');
  await page.goto(BASE + '/index.html');
  await page.waitForFunction(() => document.querySelectorAll('#participant option').length >= 101);
  await page.waitForFunction(() => document.querySelectorAll('#socialFeedList .feed-item').length > 0);
  assert.equal(await page.locator('#participant option').count(), N + 1);
  const firstServerReads = server.reads;
  assert(firstServerReads >= 100 + 60 + 40 && firstServerReads < 700, '서버가 처음 한 번 읽은 양: ' + firstServerReads);
  assert(browser.reads <= 10, '브라우저가 Firestore에서 직접 읽은 양: ' + browser.reads + ' ' + browser.log.join(' | '));
  const firstOpenBrowserReads = browser.reads;
  await ctx.close();

  // 2) 다른 기기 20대가 연달아 열어도 Firestore 읽기는 거의 늘지 않는다
  const before = { server: server.reads, browser: browser.reads };
  for (let i = 0; i < 20; i++) {
    const m = await openMember('기기' + i);
    await m.page.goto(BASE + '/index.html');
    await m.page.waitForFunction(() => document.querySelectorAll('#participant option').length >= 101);
    await m.ctx.close();
  }
  const extraServer = server.reads - before.server, extraBrowser = browser.reads - before.browser;
  assert(extraServer <= 20, `20대가 더 열어도 서버 읽기 증가: ${extraServer}`);
  assert(extraBrowser <= 200, `20대가 더 열어도 브라우저 직접 읽기 증가(내 글 조회 등): ${extraBrowser}`);

  // 3) 인증하면: 쓰기는 Firestore로 바로, 내 글은 서버 스냅샷이 아직 따라오기 전에도 피드에 보인다
  ({ ctx, page } = await openMember('인증'));
  await page.goto(BASE + '/index.html');
  await page.waitForFunction(() => document.querySelectorAll('#participant option').length >= 101);
  const writesBefore = browser.writes, readsBefore = browser.reads;
  await page.selectOption('#participant', { label: '멤버099' });
  await page.waitForFunction(() => !document.querySelector('#myCard').hidden);
  assert(browser.reads - readsBefore <= 3, '이름을 고른 뒤 Firestore 직접 읽기(저장 전 확인 1건 등): ' + (browser.reads - readsBefore) + ' ' + browser.log.slice(-4).join(' | '));
  await page.fill('#sentence', '서버 스냅샷 전에도 내 글은 바로 보여요');
  await page.fill('#reflection', '내가 쓴 글이 피드에 바로 떠야 합니다');
  await page.click('#submitBtn');
  await page.waitForFunction(() => /인증이 저장되었습니다/.test(document.querySelector('#formMsg').textContent));
  assert.equal(browser.writes - writesBefore, 1, '인증 저장은 Firestore에 직접 1번 쓰기');
  assert.equal([...store.col('submissions').values()].filter((s) => s.sentence.includes('내 글은 바로')).length, 1);
  await searchFeed(page, '멤버099');
  await page.waitForFunction(() => document.querySelector('#socialFeedList').textContent.includes('서버 스냅샷 전에도 내 글은 바로 보여요'));
  // 새로고침해도(서버 스냅샷은 아직 옛것) 내 글이 보인다
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#participant option').length >= 101);
  await searchFeed(page, '멤버099');
  await page.waitForFunction(() => document.querySelector('#socialFeedList').textContent.includes('서버 스냅샷 전에도 내 글은 바로 보여요'), null, { timeout: 15000 });
  // 내 글 고치기 → 새로고침해도 고친 내용
  await page.selectOption('#participant', { label: '멤버099' });
  await page.waitForFunction(() => document.querySelector('#sentence').value.includes('서버 스냅샷'));
  await page.fill('#sentence', '고친 문장입니다');
  await page.click('#submitBtn');
  await searchFeed(page, '멤버099');
  await page.waitForFunction(() => document.querySelector('#socialFeedList').textContent.includes('고친 문장입니다'));
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#participant option').length >= 101);
  await searchFeed(page, '멤버099');
  await page.waitForFunction(() => document.querySelector('#socialFeedList').textContent.includes('고친 문장입니다'), null, { timeout: 15000 });
  assert(!(await page.locator('#socialFeedList').textContent()).includes('서버 스냅샷 전에도'), '옛 내용은 덮어써짐');

  // 3-2) 휴대폰(위 기기)에서 인증한 직후 다른 기기(컴퓨터)를 열어도: 서버 목록은 아직 옛것이지만
  //      내 현황은 오늘·어제를 Firestore에서 바로 확인해 "인증"으로 보이고, 피드에도 내 글이 보인다
  {
    const other = await openMember('다른 기기');
    await other.page.goto(BASE + '/index.html');
    await other.page.waitForFunction(() => document.querySelectorAll('#participant option').length >= 101);
    const before2 = browser.reads;
    await other.page.selectOption('#participant', { label: '멤버099' });
    // (멤버099는 앞선 기록이 없어 집계가 멈춘 상태라, 숫자 대신 "내 기록" 목록에 오늘 글이 보이는지로 본다)
    await other.page.waitForFunction(() => !document.querySelector('#myCard').hidden && document.querySelector('#myEntries').textContent.includes('고친 문장입니다'), null, { timeout: 15000 });
    assert(browser.reads - before2 <= 5, '다른 기기에서 내 현황 확인에 든 직접 읽기: ' + (browser.reads - before2));
    await searchFeed(other.page, '멤버099');
    await other.page.waitForFunction(() => document.querySelector('#socialFeedList').textContent.includes('고친 문장입니다'), null, { timeout: 15000 });
    await other.ctx.close();
  }

  // 4) 추천: 누르면 바로 반영되고, 새로고침해도 내가 누른 상태가 유지된다(스냅샷이 옛것이어도)
  await searchFeed(page, '멤버007');
  const btn = page.locator('#socialFeedList .upvote-btn:not(.self)').first();
  const voteId = await btn.getAttribute('data-id');
  await btn.click();
  await page.waitForFunction((id) => document.querySelector(`.upvote-btn[data-id="${id}"]`).classList.contains('voted'), voteId);
  await page.waitForTimeout(300);
  assert.equal(store.col('submissions').get(voteId).upvotes, 1);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#participant option').length >= 101);
  await searchFeed(page, '멤버007');
  await page.waitForFunction((id) => !!document.querySelector(`.upvote-btn[data-id="${id}"]`), voteId, { timeout: 15000 });
  assert(await page.locator(`.upvote-btn[data-id="${voteId}"]`).evaluate((b) => b.classList.contains('voted')), '새로고침해도 내가 누른 추천이 보인다');
  await ctx.close();

  // 5) 운영진이 명단을 고치면(갱신 요청) 다음 요청이 새 명단을 받는다. 운영진이 아니면 거절
  store.col('participants').set('pNew', { nickname: '새멤버', status: 'active', joinDate: START, exemptDates: [], email: 'new@x.com' });
  const post = (body) => feedRead.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer x' }, body: JSON.stringify(body) });
  adminOk = false; assert.equal((await post({ season: 's1', roster: true })).statusCode, 403);
  adminOk = true; assert.equal((await post({ season: 's1', roster: true })).statusCode, 200);
  ({ ctx, page } = await openMember('새 명단'));
  await page.goto(BASE + '/index.html');
  await page.waitForFunction(() => document.querySelectorAll('#participant option').length >= 102);
  assert(await page.locator('#participant option', { hasText: '새멤버' }).count() === 1);
  await ctx.close();

  // 6) 서버 목록을 못 받으면(함수 장애) 예전처럼 Firestore에서 직접 읽어 앱은 그대로 동작한다
  const ctx2 = await browserApp.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await ctx2.exposeFunction('__fsOp', store.clientOp(browser));
  await ctx2.route('**/js/config.js', async (r) => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()).replace('CS.pickSeason(CS.seasonNowKST(), CS.seasonOverride)', "CS.pickSeason(CS.seasonNowKST(), 's1')").replace(/startDate: '[^']+'/, `startDate: '${START}'`).replace(/endDate: '[^']+'/, `endDate: '${END}'`).replace(/lockAt: '[^']*'/g, 'lockAt: null').replace(/backend: '[^']+'/, "backend: 'firebase'") + "\ntry { localStorage.setItem(CS.CONFIG.storagePrefix + '.awardSeen', '9999-12-31'); } catch (e) {}\n", headers: { ...res.headers(), 'content-type': 'application/javascript' } }); });
  await ctx2.route('https://www.gstatic.com/firebasejs/**', (r) => { const u = r.request().url(); r.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: /firebase-app/.test(u) ? SDK_APP : /firebase-auth/.test(u) ? SDK_AUTH : SDK_FS }); });
  await ctx2.route((u) => u.pathname === '/.netlify/functions/feed-read', (r) => r.fulfill({ status: 500, body: '{"error":"x"}' }));
  await ctx2.route((u) => /\/.netlify\/functions\/(content-library|track)$/.test(u.pathname), (r) => r.fulfill({ status: 204 }));
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + '/index.html');
  await p2.waitForFunction(() => document.querySelectorAll('#participant option').length >= 102, null, { timeout: 15000 });
  await p2.waitForFunction(() => document.querySelectorAll('#socialFeedList .feed-item').length > 0);
  await ctx2.close();

  assert.deepEqual(errors.filter((e) => !/feed-read|500/.test(e)), []);
  console.log(`읽기 줄이기 통합: 기기가 처음 열 때 Firestore 직접 읽기 ${firstOpenBrowserReads}건·서버 목록 읽기 ${firstServerReads}건(한 번만)·20대 더 열어도 서버 +${extraServer}건·기기당 직접 읽기 ${Math.round(extraBrowser / 20)}건·인증 저장 1번 쓰기·내 글/수정/추천이 스냅샷보다 먼저 화면에 반영·운영진 갱신 요청·함수 장애 시 직접 읽기로 동작 통과`);
  await browserApp.close();
})().catch((e) => { console.error(e); process.exit(1); });
