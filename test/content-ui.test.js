// 외부 서비스는 고정 응답으로 대체해 UI·저장·장애 처리를 독립적으로 검증한다.
const {chromium}=require('playwright');const assert=require('node:assert/strict');
const BASE=process.env.BASE || 'http://127.0.0.1:8765';
(async()=>{const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? ['--no-sandbox'] : []});
const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:'light'});const errors=[];let offline=false;
await context.route('**/.netlify/functions/content-library',r=>r.fulfill({status:offline?503:200,contentType:'application/json',body:JSON.stringify({videos:[],archiveAvailable:true,columns:[{id:'/p/fixture',title:'테스트용 칼럼 제목',url:'https://personalmakers.stibee.com/p/fixture',date:'2026. 10. 4.'}]})}));
await context.route('https://www.youtube-nocookie.com/**',r=>r.fulfill({body:'<!doctype html><title>테스트 영상</title><p>영상 플레이어 테스트</p>',contentType:'text/html'}));
await context.route('https://personalmakers.stibee.com/**',r=>r.fulfill({body:'<!doctype html><title>공식 뉴스레터</title>',contentType:'text/html',headers:{'X-Frame-Options':'DENY'}}));
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(BASE + '/content.html');
await page.waitForTimeout(300);assert.equal(await page.locator('.library-item').count(),3);
assert.equal(await page.locator('.content-thumb img').count(),3);
assert(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));
if(process.env.SHOT_DIR) await page.screenshot({path:process.env.SHOT_DIR + '/library-mobile.png',fullPage:true});
await page.locator('[data-open]').first().click();assert(await page.locator('#contentReader').evaluate(e=>e.open));
assert.match(await page.locator('#readerMedia iframe').getAttribute('src'),/youtube-nocookie.com/);
await page.locator('#readerNext').click();assert.match(await page.locator('#readerMedia iframe').getAttribute('src'),/gQZ6zI3epVo/);
await page.locator('#readerSave').click();assert.equal(await page.locator('#savedCount').textContent(),'1');
await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#readerMedia iframe'));assert.equal(await page.locator('#readerMedia iframe').count(),0);
await page.locator('[data-filter="saved"]').click();assert.equal(await page.locator('.library-item').count(),1);
await page.reload();await page.waitForTimeout(100);assert.equal(await page.locator('#savedCount').textContent(),'1');
await page.locator('[data-filter="columns"]').click();assert.equal(await page.locator('.library-item').count(),1);
assert.equal(await page.locator('.library-open').first().getAttribute('href'),'https://personalmakers.stibee.com/p/fixture');
const popupEvent=page.waitForEvent('popup');await page.locator('.library-open').first().click();const popup=await popupEvent;await popup.waitForLoadState('domcontentloaded');assert.match(popup.url(),/stibee.com\/p\/fixture/);await popup.close();
assert.equal(await page.locator('iframe').count(),0);
offline=true;await page.reload();await page.locator('[data-filter="columns"]').click();await page.waitForTimeout(100);assert.equal(await page.locator('iframe').count(),0);assert(await page.locator('#contentStatus a').isVisible());assert.match(await page.locator('#contentStatus').textContent(),/불러오지 못했습니다/);if(process.env.SHOT_DIR)await page.screenshot({path:process.env.SHOT_DIR+'/newsletter-unavailable.png',fullPage:true});
await page.locator('[data-filter="saved"]').click();await page.locator('[data-save]').click();assert.match(await page.locator('#contentStatus').textContent(),/나중에 보기/);
for(const width of [360,1280]){await page.setViewportSize({width,height:900});await page.locator('[data-filter="videos"]').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));}
await page.emulateMedia({colorScheme:'dark'});assert(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));
assert.deepEqual(errors,[]);console.log('영상 재생·칼럼 새 창 링크, 삽입 차단 시 뉴스레터 iframe 없음, 다음 영상, 보관·재방문·삭제, 닫을 때 재생 해제, 외부 장애 안내, 360/390/1280px·다크 모드 검증 통과');await browser.close();})();
