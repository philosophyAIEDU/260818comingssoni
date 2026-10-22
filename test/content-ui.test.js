// 외부 서비스는 고정 응답으로 대체해 UI·저장·장애 처리를 독립적으로 검증한다.
const {chromium}=require('playwright');const assert=require('node:assert/strict');
const BASE=process.env.BASE || 'http://127.0.0.1:8765';
(async()=>{const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? ['--no-sandbox'] : []});
const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:'light'});const errors=[];let offline=false,postOffline=false;
const recent=new Date(Date.now()-2*864e5).toISOString();
const library={videoSource:'latest',archiveAvailable:true,
  videos:[{id:'NEWVIDEO001',title:'새로 올라온 영상',published:recent,description:'이번 주 새 영상 설명'},{id:'xmd2_HKMgCU',title:'성과가 더딜 때',published:'2026-09-01T00:00:00+00:00'}],
  columns:[{id:'/p/fixture',title:'테스트용 칼럼 제목',url:'https://personalmakers.stibee.com/p/fixture',date:'2026-10-04'},{id:'/p/second',title:'두 번째 칼럼',url:'https://personalmakers.stibee.com/p/second',date:'2026-09-27'}]};
const post={url:'https://personalmakers.stibee.com/p/fixture',title:'테스트용 칼럼 제목',blocks:[
  {type:'h',runs:[{t:'오늘의 칼럼'}]},{type:'p',runs:[{t:'안녕하세요, '},{t:'커밍쏜',b:true},{t:'입니다.\n둘째 줄 '},{t:'링크',href:'https://example.com/a'},{t:' 위험 ',href:'javascript:alert(1)'}]},
  {type:'img',src:'http://insecure.example/a.png',alt:'안전하지 않은 그림'},{type:'li',runs:[{t:'하나'}]},{type:'li',runs:[{t:'둘'}]},{type:'quote',runs:[{t:'인용문'}]},
  ...Array.from({length:30},(_,i)=>({type:'p',runs:[{t:`긴 본문 문단 ${i+1}. 책을 덮고 나서 무엇을 할지 정하는 일이 독서의 절반입니다.`}]}))]};
const comments=[{id:'c1',nickname:'김현우',text:'책의 문장과 영상이 겹쳤어요.\n<b>태그는 글자로</b>',book:'혁명의 팡파르',createdAt:new Date(Date.now()-3600e3).toISOString()}];
const postRequests=[];
await context.route(u=>u.pathname==='/.netlify/functions/content-library',r=>{const u=new URL(r.request().url());const p=u.searchParams.get('post');
  if(p){postRequests.push(p);return postOffline||p!==post.url?r.fulfill({status:502,contentType:'application/json',body:'{"error":"x"}'}):r.fulfill({contentType:'application/json',body:JSON.stringify({post})});}
  return r.fulfill({status:offline?503:200,contentType:'application/json',body:JSON.stringify(library)});});
await context.route(u=>u.pathname==='/.netlify/functions/content-comments',async r=>{const req=r.request();
  if(req.method()==='GET')return r.fulfill({contentType:'application/json',body:JSON.stringify({comments:new URL(req.url()).searchParams.get('video')==='NEWVIDEO001'?comments:[],book:'혁명의 팡파르'})});
  const body=JSON.parse(req.postData()||'{}');
  if(req.method()==='POST'){if(body.nickname!=='박지민')return r.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:`'${body.nickname}' 이름이 이번 독서 멤버십 명단에 없어요.`})});
    return r.fulfill({status:201,contentType:'application/json',body:JSON.stringify({comment:{id:'c2',nickname:'박지민',text:body.text,book:'혁명의 팡파르',createdAt:new Date().toISOString()},token:'tok-c2'})});}
  if(req.method()==='DELETE'){assert.deepEqual(body,{id:'c2',token:'tok-c2'});return r.fulfill({contentType:'application/json',body:'{"ok":true}'});}});
await context.route('https://www.youtube-nocookie.com/**',r=>r.fulfill({body:'<!doctype html><title>테스트 영상</title><p>영상 플레이어 테스트</p>',contentType:'text/html'}));
await context.route('https://i.ytimg.com/**',r=>r.fulfill({status:404}));
await context.route('https://personalmakers.stibee.com/**',r=>r.fulfill({body:'<!doctype html><title>공식 뉴스레터</title>',contentType:'text/html',headers:{'X-Frame-Options':'DENY'}}));
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(BASE + '/content.html');
await page.waitForFunction(()=>document.querySelectorAll('.library-item').length===4);
// 최신 영상이 먼저, 피드에 없는 추천 영상은 뒤에. 최근 2주 안 영상엔 NEW
assert.equal(await page.locator('[data-filter="videos"]').textContent(),'최신 영상');
assert.deepEqual(await page.locator('[data-open]').evaluateAll(a=>a.map(x=>x.dataset.open)),['NEWVIDEO001','xmd2_HKMgCU','gQZ6zI3epVo','XQSoFje8DKY']);
assert.equal(await page.locator('.library-item').first().locator('.content-new').count(),1);assert.equal(await page.locator('.library-item').nth(1).locator('.content-new').count(),0);
assert.match(await page.locator('.library-item').nth(1).textContent(),/꾸준한 실행/);
assert(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));
if(process.env.SHOT_DIR) await page.screenshot({path:process.env.SHOT_DIR + '/library-mobile.png',fullPage:true});
// 영상 보기 + 멤버 인사이트
await page.locator('[data-open]').first().click();assert(await page.locator('#contentReader').evaluate(e=>e.open));
assert.match(await page.locator('#readerMedia iframe').getAttribute('src'),/youtube-nocookie.com\/embed\/NEWVIDEO001/);
assert(await page.locator('#readerComments').isVisible());assert(await page.locator('#readerFont').isHidden());
await page.waitForFunction(()=>document.querySelectorAll('#commentList .comment').length===1);
assert.equal(await page.locator('#commentList .comment-text').first().textContent(),'책의 문장과 영상이 겹쳤어요.\n<b>태그는 글자로</b>');
assert.equal(await page.locator('#commentList b').count(),0);
assert.match(await page.locator('.comment-book').first().textContent(),/혁명의 팡파르/);
assert.match(await page.locator('#commentText').getAttribute('placeholder'),/『혁명의 팡파르』/);
assert.equal(await page.locator('.comment-delete').count(),0,'남의 댓글엔 삭제 없음');
await page.locator('#commentSubmit').click();assert.match(await page.locator('#commentMsg').textContent(),/이름/);
await page.fill('#commentName','모르는사람');await page.fill('#commentText','멤버가 아니에요');await page.locator('#commentSubmit').click();
await page.waitForFunction(()=>/명단에 없어요/.test(document.querySelector('#commentMsg').textContent));
await page.fill('#commentName','박지민');await page.fill('#commentText','오늘 읽은 장과 이어져요');assert.equal(await page.locator('#commentLength').textContent(),'13/500');
await page.locator('#commentSubmit').click();await page.waitForFunction(()=>document.querySelectorAll('#commentList .comment').length===2);
assert.equal(await page.locator('#commentList .comment strong').first().textContent(),'박지민','새 댓글이 맨 위');
assert.equal(await page.locator('#commentText').inputValue(),'');assert.equal(await page.locator('#commentCount').textContent(),'2');
if(process.env.SHOT_DIR) await page.screenshot({path:process.env.SHOT_DIR + '/video-comments.png',fullPage:true});
await page.locator('.comment-delete').click();await page.waitForFunction(()=>document.querySelectorAll('#commentList .comment').length===1);
await page.locator('#readerNext').click();assert.match(await page.locator('#readerMedia iframe').getAttribute('src'),/xmd2_HKMgCU/);
await page.waitForFunction(()=>!document.querySelector('#commentEmpty').hidden);assert.equal(await page.locator('#commentList .comment').count(),0);
assert.equal(await page.locator('#commentName').inputValue(),'박지민','멤버 이름 기억');
await page.locator('#readerSave').click();assert.equal(await page.locator('#savedCount').textContent(),'1');
await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#readerMedia iframe'));assert.equal(await page.locator('#readerMedia iframe').count(),0);
await page.locator('[data-filter="saved"]').click();assert.equal(await page.locator('.library-item').count(),1);
await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.library-item').length===4);assert.equal(await page.locator('#savedCount').textContent(),'1');
// 칼럼: 화면 안에서 읽기
await page.locator('[data-filter="columns"]').click();assert.equal(await page.locator('.library-item').count(),2);
assert.match(await page.locator('.content-item-footer').first().textContent(),/2026\. 10\. 4\./);
await page.locator('.library-open').first().click();assert(await page.locator('#contentReader').evaluate(e=>e.open));
await page.waitForSelector('.newsletter-body');
assert.equal(await page.locator('.newsletter-body h3').first().textContent(),'오늘의 칼럼');
assert.equal(await page.locator('.newsletter-body strong').first().textContent(),'커밍쏜');
assert.equal(await page.locator('.newsletter-body p').first().locator('br').count(),1);
assert.equal(await page.locator('.newsletter-body a[href="https://example.com/a"]').getAttribute('target'),'_blank');
assert.equal(await page.locator('.newsletter-body a[href^="javascript"]').count(),0);assert.equal(await page.locator('.newsletter-body img').count(),0);
assert.equal(await page.locator('.newsletter-body li').count(),2);assert.equal(await page.locator('.newsletter-body blockquote').count(),1);
assert.equal(await page.locator('#readerOriginal').getAttribute('href'),'https://personalmakers.stibee.com/p/fixture');
assert(await page.locator('#readerComments').isHidden());assert.equal(await page.locator('iframe').count(),0);
assert(await page.locator('#readerFont').isVisible());
const size=()=>page.locator('.newsletter-body').evaluate(e=>getComputedStyle(e).fontSize);
assert.equal(await size(),'17px');await page.locator('#fontUp').click();assert.equal(await size(),'19px');
await page.locator('.reader-scroll').evaluate(e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll'));});
assert.match(await page.locator('#readerProgress').evaluate(e=>e.style.transform),/scaleX\(1\)/);
assert(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));
if(process.env.SHOT_DIR) await page.screenshot({path:process.env.SHOT_DIR + '/column-reader.png'});
// 다음 칼럼은 본문을 못 읽으면 원문 링크로 안내
await page.locator('#readerNext').click();await page.waitForSelector('.reader-original-link');
assert.equal(await page.locator('.reader-original-link').getAttribute('href'),'https://personalmakers.stibee.com/p/second');
await page.locator('#readerNext').click();await page.waitForSelector('.newsletter-body');
assert.equal(postRequests.filter(p=>p===post.url).length,1,'읽은 본문은 다시 받지 않음');
await page.keyboard.press('Escape');
await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.library-item').length===4);assert.equal(await page.locator('#savedCount').textContent(),'1');
await page.locator('[data-filter="columns"]').click();await page.locator('.library-open').first().click();await page.waitForSelector('.newsletter-body');assert.equal(await size(),'19px','글자 크기 기억');
await page.keyboard.press('Escape');
offline=true;await page.reload();await page.locator('[data-filter="columns"]').click();await page.waitForFunction(()=>/불러오지 못했습니다/.test(document.querySelector('#contentStatus').textContent));assert.equal(await page.locator('iframe').count(),0);assert(await page.locator('#contentStatus a').isVisible());if(process.env.SHOT_DIR)await page.screenshot({path:process.env.SHOT_DIR+'/newsletter-unavailable.png',fullPage:true});
assert.equal(await page.locator('[data-filter="videos"]').evaluate(b=>{b.click();return document.querySelectorAll('.library-item').length;}),3,'목록을 못 받으면 추천 영상');
await page.locator('[data-filter="saved"]').click();await page.locator('[data-save]').click();assert.match(await page.locator('#contentStatus').textContent(),/나중에 보기/);
offline=false;await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.library-item').length===4);
for(const width of [360,1280]){await page.setViewportSize({width,height:900});await page.locator('[data-filter="videos"]').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));
  await page.locator('[data-open]').first().click();await page.waitForSelector('#commentList .comment');assert(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));await page.keyboard.press('Escape');}
await page.emulateMedia({colorScheme:'dark'});assert(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));
if(process.env.SHOT_DIR){await page.setViewportSize({width:390,height:844});await page.locator('[data-filter="columns"]').click();await page.locator('.library-open').first().click();await page.waitForSelector('.newsletter-body');await page.screenshot({path:process.env.SHOT_DIR+'/column-reader-dark.png'});await page.keyboard.press('Escape');}
assert.deepEqual(errors,[]);console.log('최신 영상 순서·NEW 표시, 영상 재생·멤버 인사이트(불러오기·이름 확인·작성·삭제·이름 기억), 칼럼 화면 읽기(정제된 본문·글자 크기·진행 표시·원문 대체·본문 캐시), 다음 콘텐츠, 보관·재방문·삭제, 닫을 때 재생 해제, 외부 장애 안내, 360/390/1280px·다크 모드 검증 통과');await browser.close();})().catch(e=>{console.error(e);process.exit(1);});
