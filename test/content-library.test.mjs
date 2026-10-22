import assert from 'node:assert/strict';
import handler, { pageCandidates, parseArchive, parseVideoFeed, channelIdFrom, parseContents, emailBlocks, isoDate, postUrl, resetCaches } from '../netlify/functions/content-library.mjs';
const posts = parseArchive(`<a href="/p/42"><span>독서와 실행 &amp; 나의 기록</span><time>2026. 10. 4.</time></a>
<a href="https://evil.example/p/1">외부 글</a><a href="javascript:alert(1)">잘못된 글</a>
<a href="/p/42">독서와 실행 &amp; 나의 기록</a>
<script id="__NEXT_DATA__" type="application/json">{"props":{"posts":[{"title":"브랜드 만들기","url":"/p/43","publishedAt":"2026-10-01"}]}}</script>`);
assert.equal(posts.length, 2);
assert.equal(posts[0].title, '독서와 실행 & 나의 기록');
assert.equal(posts[1].url, 'https://personalmakers.stibee.com/p/43');
assert.deepEqual(parseArchive('<html>본문 없는 목록</html>'), []);
assert.equal(parseArchive('<a href="https://stibee.com/api/v1.0/emails/share/exampleToken">공식 원문</a>')[0].title, '공식 원문');
assert.deepEqual(parseArchive('<a href="https://stibee.com/other">관련 없는 스티비 링크</a>'), []);
assert.equal((await handler(new Request('https://example.test', { method: 'POST' }))).status, 405);
const realFetch = globalThis.fetch;
globalThis.fetch = async url => url === 'https://personalmakers.stibee.com/'
  ? new Response('<a href="/p/42">독서와 실행</a>')
  : Response.json({ title: '테스트 영상 제목', author_name: '커밍쏜' });
resetCaches();
let response = await handler(new Request('https://example.test'));
let body = await response.json();
// 채널 피드를 못 읽으면 추천 영상 3편으로 대신하고, 곧 다시 시도하도록 짧게 캐시한다
assert.equal(body.columns.length, 1); assert.equal(body.videos.length, 3); assert.equal(body.archiveAvailable, true); assert.equal(body.videoSource, 'curated');
assert.match(response.headers.get('Cache-Control'), /s-maxage=60/);
globalThis.fetch = async () => { throw Error('Source unavailable'); };
resetCaches();
body = await (await handler(new Request('https://example.test'))).json();
assert.deepEqual(body.columns, []); assert.deepEqual(body.videos, []); assert.equal(body.archiveAvailable, false);
globalThis.fetch = async () => Response.json({ title: '다른 채널', author_name: '임의의 다른 사람' });
body = await (await handler(new Request('https://example.test'))).json();
assert.deepEqual(body.videos, []);

// 최신 영상: 채널 페이지 → 채널 ID → RSS. 쇼츠는 빼고 최신순, 다른 채널 피드는 버린다.
const CH = 'UCUzoht-2qT2sg7mPaZCKHWQ'; // 기본값으로 넣어 둔 커밍쏜 채널
assert.equal(channelIdFrom(`<script>var x={"externalId":"${CH}"}</script>`), CH);
assert.equal(channelIdFrom(`<link rel="canonical" href="https://www.youtube.com/channel/${CH}">`), CH);
assert.equal(channelIdFrom('<html></html>'), '');
const entry = (id, title, published, link = `https://www.youtube.com/watch?v=${id}`, desc = '') => `<entry><id>yt:video:${id}</id><yt:videoId>${id}</yt:videoId><title>${title}</title><link rel="alternate" href="${link}"/><published>${published}</published><media:group><media:description>${desc}</media:description></media:group></entry>`;
const feedXml = (author, entries) => `<?xml version="1.0"?><feed><title>${author}</title><author><name>${author}</name></author>${entries}</feed>`;
const feed = feedXml('커밍쏜', entry('AAAAAAAAAA1', '예전 영상', '2026-09-01T00:00:00+00:00')
  + entry('BBBBBBBBBB2', '새 영상 &amp; 이야기', '2026-10-20T00:00:00+00:00', undefined, 'https://link.example\n#태그\n책을 읽고 실행으로 옮기는 법을 이야기합니다.')
  + entry('CCCCCCCCCC3', '짧은 영상', '2026-10-21T00:00:00+00:00', 'https://www.youtube.com/shorts/CCCCCCCCCC3')
  + entry('DDDDDDDDDD4', '오늘의 한마디 #shorts', '2026-10-21T00:00:00+00:00'));
const parsed = parseVideoFeed(feed);
assert.deepEqual(parsed.map(v => v.id), ['BBBBBBBBBB2', 'AAAAAAAAAA1']);
assert.equal(parsed[0].title, '새 영상 & 이야기');
assert.equal(parsed[0].description, '책을 읽고 실행으로 옮기는 법을 이야기합니다.');
assert.deepEqual(parseVideoFeed(feedXml('다른 채널', entry('BBBBBBBBBB2', '남의 영상', '2026-10-20T00:00:00+00:00'))), []);

// 뉴스레터: RSS와 아카이브를 합쳐 최신순, 날짜는 YYYY-MM-DD
assert.equal(isoDate('2026. 10. 4.'), '2026-10-04'); assert.equal(isoDate('Mon, 19 Oct 2026 23:30:00 GMT'), '2026-10-20'); assert.equal(isoDate('언젠가'), '');
assert.equal(postUrl('https://personalmakers.stibee.com/p/7/?utm=x'), 'https://personalmakers.stibee.com/p/7/');
assert.equal(postUrl('https://personalmakers.stibee.com.evil.example/p/7'), null);
assert.equal(postUrl('http://personalmakers.stibee.com/p/7'), null);
// 스티비 페이지 글 목록 API: 필드 이름이 달라도 제목·주소·날짜를 찾고, 주소가 없으면 글 번호로 /p/{번호}/를 만든다
const contents = parseContents({ total: 3, items: [
  { id: 50, subject: '가장 새 글입니다', sentTime: '2026-10-19 06:00:00', permalink: 'https://stibee.com/api/v1.0/emails/share/tok50' },
  { contentId: '49', title: '지난주 글입니다', publishedAt: '2026-10-12T21:00:00.000Z' },
  { id: 7, title: '외부 주소 글', url: 'https://evil.example/p/7' },
  { id: 'x', title: '번호 없는 글' }
] });
assert.deepEqual(contents, [
  { id: '/p/50/', title: '가장 새 글입니다', url: 'https://personalmakers.stibee.com/p/50/', date: '2026-10-19', share: 'https://stibee.com/api/v1.0/emails/share/tok50' },
  { id: '/p/49/', title: '지난주 글입니다', url: 'https://personalmakers.stibee.com/p/49/', date: '2026-10-13', share: '' },
  { id: '/p/7/', title: '외부 주소 글', url: 'https://personalmakers.stibee.com/p/7/', date: '', share: '' }
]);
assert.deepEqual(parseContents([{ subject: '공유 주소만 있는 글', link: 'https://stibee.com/api/v1.0/emails/share/abc' }]).map(p => p.url), ['https://stibee.com/api/v1.0/emails/share/abc']);
assert.deepEqual(parseContents({ message: '오류' }), []);
assert.deepEqual(parseContents({ id: 376164, title: '커밍쏜의 퍼스널메이커스 뉴스레터', contents: [{ id: 3, title: '안쪽 글입니다' }] }).map(p => p.id), ['/p/3/']);

// 본문 → 읽기 블록: 스크립트·추적 이미지·수신거부 문구·위험한 링크는 빠진다
const blocks = emailBlocks(`<html><head><title>t</title><style>p{color:red}</style></head><body><table><tr><td><a href="https://stibee.com/v">웹에서 보기</a></td></tr>
<tr><td style="font-size:24px"><b>오늘의 칼럼</b></td></tr><tr><td><p>안녕하세요, <strong>커밍쏜</strong>입니다.<br>둘째 줄 <a href="https://example.com/a">링크</a></p>
<script>alert(1)</script><img src="https://img.stibee.com/a.png" alt="그림" width="600"><img src="https://stibee.com/open/x.gif" width="1" height="1"><img src="http://insecure.example/a.png">
<ul><li>하나</li><li>둘</li></ul><blockquote>인용</blockquote><p><a href="javascript:alert(1)" onclick="x()">눌러 보기</a></p><p>수신거부 | Unsubscribe</p></td></tr></table></body></html>`);
assert.deepEqual(blocks.map(b => b.type), ['h', 'p', 'img', 'li', 'li', 'quote', 'p']);
assert.deepEqual(blocks[1].runs, [{ t: '안녕하세요, ' }, { t: '커밍쏜', b: true }, { t: '입니다.\n둘째 줄 ' }, { t: '링크', href: 'https://example.com/a' }]);
assert.deepEqual(blocks[6].runs, [{ t: '눌러 보기' }]);
assert(!JSON.stringify(blocks).includes('alert'));

// 본문 요청: 허용된 글 주소만, 공유 메일이 있으면 그 본문을 읽는다
assert.equal((await handler(new Request('https://example.test/?post=' + encodeURIComponent('https://evil.example/p/1')))).status, 400);
assert.equal((await handler(new Request('https://example.test/?post=' + encodeURIComponent('http://169.254.169.254/latest')))).status, 400);
const longBody = '<p>' + '책을 덮고 나서 무엇을 할지 정하는 일이 독서의 절반입니다. '.repeat(8) + '</p>';
const requested = [];
globalThis.fetch = async (url) => {
  requested.push(String(url));
  if (url === 'https://personalmakers.stibee.com/p/42/') return new Response(`<html><head><meta property="og:title" content="독서와 실행"></head><body><nav>메뉴</nav><iframe src="https://stibee.com/api/v1.0/emails/share/tok123"></iframe></body></html>`);
  if (url === 'https://stibee.com/api/v1.0/emails/share/tok123') return new Response(`<html><body><h1>독서와 실행</h1>${longBody}</body></html>`);
  return new Response('not found', { status: 404 });
};
response = await handler(new Request('https://example.test/?post=' + encodeURIComponent('https://personalmakers.stibee.com/p/42/')));
body = await response.json();
assert.equal(response.status, 200); assert.equal(body.post.title, '독서와 실행');
assert.deepEqual(body.post.blocks.map(b => b.type), ['h', 'p']);
assert.match(response.headers.get('Cache-Control'), /s-maxage=86400/);
assert.deepEqual(requested, ['https://page.stibee.com/api/v1.0/lists/376164/contents', 'https://personalmakers.stibee.com/p/42/', 'https://stibee.com/api/v1.0/emails/share/tok123']);
// 리다이렉트로 스티비 밖으로 나가면 읽지 않는다
globalThis.fetch = async () => { const r = new Response('<p>' + 'x'.repeat(300) + '</p>'); Object.defineProperty(r, 'url', { value: 'https://evil.example/' }); return r; };
assert.equal((await handler(new Request('https://example.test/?post=' + encodeURIComponent('https://personalmakers.stibee.com/p/9')))).status, 502);

// 목록 전체: 최신 영상 피드 + 뉴스레터 최신순
globalThis.fetch = async (url) => {
  requested.push(String(url));
  if (url === `https://www.youtube.com/feeds/videos.xml?channel_id=${CH}`) return new Response(feed);
  if (url === 'https://page.stibee.com/api/v1.0/lists/376164/contents') return Response.json({ items: [
    { id: 42, title: '독서와 실행', sentTime: '2026-10-05 06:00:00' },
    { id: 50, subject: '가장 새 글입니다', sentTime: '2026-10-19 06:00:00', permalink: 'https://stibee.com/api/v1.0/emails/share/tok50' },
    { id: 49, title: '지난주 글입니다', sentTime: '2026-10-12 06:00:00' }] });
  if (url === 'https://stibee.com/api/v1.0/emails/share/tok50') return new Response(`<html><body><h1>가장 새 글입니다</h1>${longBody}</body></html>`);
  return new Response('', { status: 404 });
};
requested.length = 0; resetCaches();
response = await handler(new Request('https://example.test'));
body = await response.json();
assert.equal(body.videoSource, 'latest'); assert.deepEqual(body.videos.map(v => v.id), ['BBBBBBBBBB2', 'AAAAAAAAAA1']);
assert(!requested.some(u => u.startsWith('https://www.youtube.com/@')), '채널 ID를 알면 채널 페이지를 읽지 않음');
assert.deepEqual(body.columns, [
  { id: '/p/50/', title: '가장 새 글입니다', url: 'https://personalmakers.stibee.com/p/50/', date: '2026-10-19' },
  { id: '/p/49/', title: '지난주 글입니다', url: 'https://personalmakers.stibee.com/p/49/', date: '2026-10-12' },
  { id: '/p/42/', title: '독서와 실행', url: 'https://personalmakers.stibee.com/p/42/', date: '2026-10-05' }]);
assert.match(response.headers.get('Cache-Control'), /s-maxage=3600/);
// 목록 API가 알려 준 공유 메일로 본문을 읽는다(글 페이지는 열지 않아도 된다)
requested.length = 0;
response = await handler(new Request('https://example.test/?post=' + encodeURIComponent('https://personalmakers.stibee.com/p/50/')));
body = await response.json();
assert.equal(response.status, 200); assert.equal(body.post.title, '가장 새 글입니다'); assert.deepEqual(body.post.blocks.map(b => b.type), ['h', 'p']);
assert.deepEqual(requested, ['https://stibee.com/api/v1.0/emails/share/tok50']);
// 공유 주소를 모르면 글 페이지의 Next.js 데이터(T 줄)에서 본문을 찾는다
const rscBody = `<h2>쏜의 편지</h2>${longBody}`;
const rscText = `1:I[1,[],""]\n5:T${Buffer.byteLength(rscBody).toString(16)},${rscBody}2:["$","div",null,{}]\n`;
const rscPage = `<html><head><title>페이지 제목</title></head><body><div id="app"></div><script>self.__next_f.push(${JSON.stringify([1, rscText])})</script></body></html>`;
const blocksFromRsc = emailBlocks(pageCandidates(rscPage).htmls[0]);
assert.deepEqual(blocksFromRsc.map(b => b.type), ['h', 'p']); assert.equal(blocksFromRsc[0].runs[0].t, '쏜의 편지');
body = await (await handler(new Request('https://example.test/?debug=newsletter'))).json();
assert.equal(body.api.parsed.length, 3); assert.deepEqual(body.api.shape, { items: [3, { id: 42, title: '독서와 실행', sentTime: '2026-10-05 06:00:00' }] });
globalThis.fetch = realFetch;
console.log('콘텐츠 출처 제한·HTML/JSON 목록·장애 격리·채널 검증·최신 영상 피드·뉴스레터 최신순·본문 정제·글 주소 제한 통과');
