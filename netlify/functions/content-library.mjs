// 공개 채널의 메타데이터만 가져온다. 외부 HTML이나 본문은 실행·복제하지 않는다.
const NEWSLETTER = 'https://personalmakers.stibee.com/';
const VIDEO_IDS = ['xmd2_HKMgCU', 'gQZ6zI3epVo', 'XQSoFje8DKY'];
const text = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
export function parseArchive(html) {
  const posts = new Map();
  function add(url, title, date) {
    try {
      const u = new URL(url, NEWSLETTER);
      if (u.origin !== new URL(NEWSLETTER).origin || !/^\/p\/[^/?#]+\/?$/.test(u.pathname)) return;
      title = text(title).replace(/\s*\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*$/, '');
      if (title.length < 3) return;
      posts.set(u.pathname, { id: u.pathname, title, url: u.href, date: date || '' });
    } catch { /* 외부·잘못된 링크는 제외 */ }
  }
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    add(match[1], match[2], (text(match[2]).match(/\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\./) || [''])[0]);
  }
  // 서버 렌더링 없이 JSON으로 내려오는 아카이브도 처리한다.
  function walk(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 14) return;
    if (!Array.isArray(value)) {
      const title = value.title || value.subject || value.emailTitle || value.postTitle;
      const url = value.url || value.href || value.link || value.postUrl || value.archiveUrl;
      if (title && url) add(url, title, value.publishedAt || value.createdAt);
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child, depth + 1);
  }
  for (const script of html.matchAll(/<script\b[^>]*(?:type=["']application\/(?:ld\+)?json["']|id=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(script[1])); } catch { /* 일반 스크립트 제외 */ }
  }
  return [...posts.values()].slice(0, 20);
}
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'PersonalMakersReading/1.0' } });
  if (!response.ok) throw Error(`Source returned ${response.status}`);
  return response;
}
export default async function handler(req) {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  const [archive, ...videos] = await Promise.allSettled([
    get(NEWSLETTER).then(r => r.text()).then(html => {
      const posts = parseArchive(html);
      if (!posts.length) console.warn('[content-library] Archive format not recognized', { bytes: html.length, scripts: [...html.matchAll(/<script[^>]+src=["']([^"']+)/g)].map(m => m[1]).slice(0, 6) });
      return posts;
    }),
    ...VIDEO_IDS.map(async id => {
      const data = await get(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`).then(r => r.json());
      if (!String(data.author_name).includes('커밍쏜')) throw Error('Unexpected video channel');
      return { id, title: data.title, author: data.author_name };
    })
  ]);
  return Response.json({
    columns: archive.status === 'fulfilled' ? archive.value : [],
    videos: videos.filter(x => x.status === 'fulfilled').map(x => x.value),
    archiveAvailable: archive.status === 'fulfilled' && archive.value.length > 0,
  }, { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' } });
}
