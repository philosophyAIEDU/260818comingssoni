// 운영진 화면(Firebase 모드)의 읽기: 인증 기록은 멤버와 같은 서버 스냅샷을 쓰고(수천 건을 직접 읽지 않음),
// [최신으로 새로고침]은 오늘·어제만 새로 읽는다. 서버 함수는 실제 코드, Firestore만 가짜.
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
const server = { reads: 0, writes: 0 }, client = { reads: 0, writes: 0, log: [] };
require.cache[require.resolve(path.join(lib, 'firebaseAdmin.js'))] = { exports: { getDb: () => store.admin(server) } };
const posts = [];
require.cache[require.resolve(path.join(lib, 'adminAuth.js'))] = { exports: {
  json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  requireAdmin: async (event) => ((event.headers.authorization || '').startsWith('Bearer ') ? { email: 'a@b.c' } : { error: { statusCode: 401, body: '{"error":"로그인"}' } }) } };
const feedRead = require('../netlify/functions/feed-read.js');
const U = global.CS.U;
const adminEmail = global.CS.CONFIG.adminEmails[0];

const today = U.today(); const shift = (n) => U.addDays(today, n);
const START = shift(-8), END = shift(19);
Object.assign(global.CS.SEASONS.find((s) => s.id === 's1'), { startDate: START, endDate: END });
const N = 100;
for (let i = 0; i < N; i++) store.col('participants').set('p' + i, { nickname: `멤버${String(i).padStart(3, '0')}`, status: 'active', joinDate: START, outDate: null, exemptDates: [], email: `m${i}@x.com`, createdAt: '2026-01-01T00:00:00' });
let sid = 0;
const addSub = (i, date) => store.col('submissions').set('seed' + (sid++), { participantId: 'p' + i, nickname: `멤버${String(i).padStart(3, '0')}`, date, sentence: '문장', reflection: '느낀 점', upvotes: 0, upvotedBy: [], createdAt: `${date}T10:00:00`, updatedAt: `${date}T10:00:00` });
for (const d of [shift(-4), shift(-3), shift(-2), shift(-1)]) for (let i = 0; i < 60; i++) addSub(i, d); // 지난 4일 × 60건
for (let i = 0; i < 40; i++) addSub(i, today);

(async () => {
  const app = await chromium.launch();
  const errors = [];
  const ctx = await app.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 1280, height: 900 } });
  await ctx.exposeFunction('__fsOp', store.clientOp(client));
  await ctx.addInitScript((email) => { window.__adminUser = { email, getIdToken: async () => 'tok' }; }, adminEmail);
  await ctx.route('**/js/config.js', async (r) => {
    const res = await r.fetch();
    const body = (await res.text()).replace('CS.pickSeason(CS.seasonNowKST(), CS.seasonOverride)', "CS.pickSeason(CS.seasonNowKST(), 's1')")
      .replace(/startDate: '[^']+'/, `startDate: '${START}'`).replace(/endDate: '[^']+'/, `endDate: '${END}'`)
      .replace(/lockAt: '[^']*'/g, 'lockAt: null').replace(/backend: '[^']+'/, "backend: 'firebase'");
    r.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'application/javascript' } });
  });
  await ctx.route('https://www.gstatic.com/firebasejs/**', (r) => { const u = r.request().url(); r.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: /firebase-app/.test(u) ? SDK_APP : /firebase-auth/.test(u) ? SDK_AUTH : SDK_FS }); });
  await ctx.route((u) => u.pathname === '/.netlify/functions/feed-read', async (r) => {
    const u = new URL(r.request().url());
    if (r.request().method() === 'POST') posts.push(JSON.parse(r.request().postData() || '{}'));
    const res = await feedRead.handler({ httpMethod: r.request().method(), headers: r.request().headers(), queryStringParameters: Object.fromEntries(u.searchParams), body: r.request().postData() });
    r.fulfill({ status: res.statusCode, headers: res.headers || {}, body: res.body });
  });
  await ctx.route((u) => /\/\.netlify\/functions\/(analytics-report|track|content-library)$/.test(u.pathname), (r) => r.fulfill({ status: 204 }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE + '/admin.html');
  await page.waitForFunction(() => document.querySelectorAll('#matrix .cell-o').length > 0, null, { timeout: 20000 });

  // 1) 열 때: 명단(이메일 등 전체 필드가 필요해 직접)은 읽지만 인증 기록 260건은 직접 읽지 않는다
  const openReads = client.reads;
  assert(client.reads >= N && client.reads < N + 60, `운영진 화면이 직접 읽은 양(명단 ${N}명 + 소량): ${client.reads} ${client.log.join(' | ')}`);
  assert(!client.log.some((l) => /getDocs submissions/.test(l)), '인증 기록은 Firestore에서 직접 읽지 않는다');
  const oCells = await page.locator('#matrix .cell-o').count();
  assert(oCells >= 250, '스냅샷으로 일일현황이 그려진다: ' + oCells);
  assert.match(await page.locator('#feedAsOf').textContent(), /인증 기록 (오전|오후) \d{1,2}:\d{2} 기준/);
  assert(await page.locator('#adminEmailLabel').textContent().then((t) => t.includes(adminEmail)));
  const loads = client.log.filter((l) => /getDocs participants/.test(l)).length;
  assert.equal(loads, 1, '로그인 알림이 여러 번 와도 한 번만 읽는다: ' + loads);

  // 2) 멤버가 방금 인증했다 → 스냅샷은 몇 분 늦을 수 있어 아직 안 보인다. [최신으로 새로고침]을 누르면 보인다
  store.col('submissions').set('late1', { participantId: 'p50', nickname: '멤버050', date: today, sentence: '방금', reflection: '방금', upvotes: 0, upvotedBy: [], createdAt: `${today}T11:00:00`, updatedAt: `${today}T11:00:00` });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#matrix .cell-o').length > 0);
  const before = await page.locator('#matrix .cell-o').count();
  const serverBefore = server.reads;
  await page.locator('#feedRefresh').click();
  await page.waitForFunction((n) => document.querySelectorAll('#matrix .cell-o').length === n + 1, before, { timeout: 15000 });
  assert.deepEqual(posts.at(-1).dates, [today, shift(-1)]); assert.equal(posts.at(-1).season, 's1');
  const refreshReads = server.reads - serverBefore;
  assert(refreshReads >= 40 && refreshReads <= 160, `새로고침이 서버에서 읽은 양(오늘 41 + 어제 60 + 스냅샷 문서): ${refreshReads}`);
  assert(!client.log.some((l) => /getDocs submissions/.test(l)));
  // 30초 안에 또 누르면 막는다(읽기 낭비 방지)
  const serverAfter = server.reads;
  await page.locator('#feedRefresh').click();
  await page.waitForFunction(() => /다시 눌러 주세요/.test(document.querySelector('#feedRefreshMsg').textContent));
  assert.equal(server.reads, serverAfter, '연타해도 읽기는 늘지 않는다');

  // 2-2) 명단을 고쳐도 명단 전체를 다시 읽지 않는다(기억해 둔 명단을 바로 맞춘다). 이 화면이 직접 읽은 수가 아래에 보인다
  await page.locator('[data-tab="roster"]').click();
  const rosterReadsBefore = client.log.filter((l) => /getDocs participants/.test(l)).length;
  const readsBeforeEdit = client.reads;
  const kakao = page.locator('[data-editkakao]').first();
  await kakao.selectOption('O');
  await page.waitForFunction(() => /카톡방 참여 여부를 수정했습니다/.test(document.querySelector('#rosterMsg').textContent));
  await page.waitForTimeout(300);
  assert.equal(client.log.filter((l) => /getDocs participants/.test(l)).length, rosterReadsBefore, '고친 뒤 명단 전체를 다시 읽지 않는다');
  assert(client.reads - readsBeforeEdit <= 2, '명단 한 건을 고치는 데 든 읽기: ' + (client.reads - readsBeforeEdit) + ' ' + client.log.slice(-6).join(' | '));
  assert.equal(await page.locator('[data-editkakao]').first().inputValue(), 'O', '고친 값이 화면에 반영');
  assert.match(await page.locator('#readMeter').textContent(), /직접 읽은 Firestore 문서 [\d,]+건/);
  const shown = +(await page.locator('#readMeter').textContent()).match(/문서 ([\d,]+)건/)[1].replace(/,/g, '');
  assert(shown >= N && shown <= client.reads, '표시기 숫자는 이 화면이 읽은 양: ' + shown + ' / ' + client.reads);

  // 3) 운영진이 인증 기록을 지우면 그 날짜 스냅샷이 오래된 것으로 표시된다(멤버 화면이 곧 새로 받음)
  const del = page.locator('[data-tab="entries"]');
  await del.click();
  const target = page.locator('[data-delentry]').first();
  const id = await target.getAttribute('data-delentry');
  const delDate = store.col('submissions').get(id).date;
  await target.click();
  await page.waitForFunction((i) => !document.querySelector(`[data-delentry="${i}"]`), id);
  await new Promise((r) => setTimeout(r, 1200));
  assert(posts.some((p) => (p.dates || []).includes(delDate)), '지운 날짜의 스냅샷 갱신 요청이 갔다: ' + JSON.stringify(posts.slice(-3)));
  assert.equal(store.col('submissions').has(id), false);

  assert.deepEqual(errors, []);
  console.log(`운영진 읽기: 열 때 직접 읽기 ${openReads}건(명단뿐·인증 기록 260건은 스냅샷)·로그인 알림 중복 없음·[최신으로 새로고침]은 오늘·어제만 읽음(${refreshReads}건)·연타 방지·삭제 시 스냅샷 갱신 통과`);
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
