import assert from 'node:assert/strict';
import handler, { parseArchive } from '../netlify/functions/content-library.mjs';
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
let response = await handler(new Request('https://example.test'));
let body = await response.json();
assert.equal(body.columns.length, 1); assert.equal(body.videos.length, 3); assert.equal(body.archiveAvailable, true);
assert.match(response.headers.get('Cache-Control'), /s-maxage=3600/);
globalThis.fetch = async () => { throw Error('Source unavailable'); };
body = await (await handler(new Request('https://example.test'))).json();
assert.deepEqual(body.columns, []); assert.deepEqual(body.videos, []); assert.equal(body.archiveAvailable, false);
globalThis.fetch = async () => Response.json({ title: '다른 채널', author_name: '임의의 다른 사람' });
body = await (await handler(new Request('https://example.test'))).json();
assert.deepEqual(body.videos, []);
globalThis.fetch = realFetch;
console.log('콘텐츠 출처 제한·HTML/JSON 목록·장애 격리·채널 검증 통과');
