// 공개 채널의 최신 목록과 뉴스레터 본문을 가져온다.
// 외부 HTML은 그대로 내려보내지 않는다 — 문단·제목·이미지 같은 구조만 뽑아 JSON으로 주고, 화면은 그 값을 글자로만 그린다.
const NEWSLETTER = 'https://personalmakers.stibee.com/';
const CHANNEL_PAGE = 'https://www.youtube.com/@%EC%BB%A4%EB%B0%8D%EC%8F%9C';
const CHANNEL_NAME = '커밍쏜';
const VIDEO_IDS = ['xmd2_HKMgCU', 'gQZ6zI3epVo', 'XQSoFje8DKY']; // 피드를 못 읽을 때 보여 줄 추천 영상
const MAX_VIDEOS = 12;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', bull: '•', copy: '©' };
const decode = (s) => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return ''; } }
  return ENTITIES[e.toLowerCase()] ?? m;
});
const text = (s) => decode(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** 뉴스레터 글 주소로 허용하는 것: 퍼스널메이커스 페이지의 /p/{id} 와 스티비 공유 메일. 그 밖은 null. */
export function postUrl(url, base = NEWSLETTER) {
  try {
    const u = new URL(url, base);
    const pagePost = u.origin === new URL(NEWSLETTER).origin && /^\/p\/[^/?#]+\/?$/.test(u.pathname);
    const sharedEmail = u.origin === 'https://stibee.com' && /^\/api\/v1\.0\/emails\/share\/[^/?#]+$/.test(u.pathname);
    return pagePost || sharedEmail ? u.origin + u.pathname : null;
  } catch { return null; }
}

/** '2026. 10. 4.' · '2026-10-04T…' · RSS의 'Sun, 04 Oct 2026 …' → '2026-10-04'. 못 읽으면 ''. */
export function isoDate(value) {
  const s = String(value || '').trim();
  const m = s.match(/(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if (typeof value === 'number' || /^\d{10,13}$/.test(s)) { const n = Number(s); const d = new Date(n < 1e12 ? n * 1000 : n); return isNaN(d) ? '' : kst(d); }
  const d = new Date(s);
  return s && !isNaN(d) ? kst(d) : '';
}
const kst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);

export function parseArchive(html) {
  const posts = new Map();
  function add(url, title, date) {
    const href = postUrl(url);
    if (!href || typeof title !== 'string') return;
    title = text(title).replace(/\s*\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*$/, '');
    if (title.length < 3) return;
    const id = new URL(href).pathname;
    const existing = posts.get(id);
    posts.set(id, { id, title, url: href, date: isoDate(date) || existing?.date || '' });
  }
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    add(decode(match[1]), match[2], (text(match[2]).match(/\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\./) || [''])[0]);
  }
  // 서버 렌더링 없이 JSON으로 내려오는 아카이브도 처리한다.
  function walk(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 14) return;
    if (!Array.isArray(value)) {
      const title = value.title || value.subject || value.emailTitle || value.postTitle || value.emailSubject;
      const url = value.url || value.href || value.link || value.postUrl || value.archiveUrl || value.permalink || value.webViewUrl;
      if (title && url) add(url, title, value.publishedAt || value.sentAt || value.sendDate || value.createdAt);
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child, depth + 1);
  }
  for (const script of html.matchAll(/<script\b[^>]*(?:type=["']application\/(?:ld\+)?json["']|id=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(script[1])); } catch { /* 일반 스크립트 제외 */ }
  }
  return [...posts.values()].slice(0, 30);
}

/** RSS 2.0 / Atom 뉴스레터 피드 → 글 목록(허용된 주소만) */
export function parseNewsletterFeed(xml) {
  const posts = [];
  for (const [, item] of String(xml).matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)) {
    const tag = (name) => (item.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i')) || [])[1] || '';
    const link = text(tag('link')) || (item.match(/<link\b[^>]*href=["']([^"']+)/i) || [])[1] || text(tag('guid'));
    const href = postUrl(decode(link));
    const title = text(tag('title'));
    if (href && title.length >= 3) posts.push({ id: new URL(href).pathname, title, url: href, date: isoDate(text(tag('pubDate')) || text(tag('published')) || text(tag('updated'))) });
  }
  return posts;
}

/** 채널 페이지 HTML에서 채널 ID(UC…)를 찾는다 */
export function channelIdFrom(html) {
  const m = String(html).match(/"externalId":"(UC[\w-]{22})"/) || String(html).match(/<link[^>]+rel=["']canonical["'][^>]+\/channel\/(UC[\w-]{22})/i)
    || String(html).match(/<meta[^>]+itemprop=["'](?:channelId|identifier)["'][^>]+content=["'](UC[\w-]{22})/i) || String(html).match(/youtube\.com\/channel\/(UC[\w-]{22})/);
  return m ? m[1] : '';
}

/** 유튜브 채널 RSS → 최신 영상(쇼츠 제외, 최신순). 채널 이름이 다르면 비운다. */
export function parseVideoFeed(xml) {
  const feedAuthor = text((String(xml).match(/<author>\s*<name>([\s\S]*?)<\/name>/i) || [])[1]);
  if (!feedAuthor.includes(CHANNEL_NAME)) return [];
  const videos = [];
  for (const [, entry] of String(xml).matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const id = (entry.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1];
    const title = text((entry.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
    const link = (entry.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)/i) || entry.match(/<link\b[^>]*href=["']([^"']+)/i) || [])[1] || '';
    const description = decode(((entry.match(/<media:description\b[^>]*>([\s\S]*?)<\/media:description>/i) || [])[1] || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
    if (!id || !title || /\/shorts\//.test(link) || /#shorts?\b/i.test(title + ' ' + description)) continue;
    videos.push({ id, title, author: feedAuthor, published: (entry.match(/<published>([^<]+)<\/published>/) || [])[1] || '', description: summary(description) });
  }
  return videos.sort((a, b) => b.published.localeCompare(a.published)).slice(0, MAX_VIDEOS);
}
/** 영상 설명 첫머리 — 링크·해시태그·타임스탬프 줄은 건너뛰고 한두 문장만 */
function summary(description) {
  const line = description.split(/\r?\n/).map((x) => x.trim()).find((x) => x.length >= 8 && !/https?:\/\/|^#|^\d{1,2}:\d{2}|^[-=_*·]{3,}/.test(x)) || '';
  return line.length > 90 ? line.slice(0, 88).trim() + '…' : line;
}

/* ── 뉴스레터 본문 → 읽기용 블록 ──────────────────────────────────────────
 * 블록: { type: 'h'|'p'|'li'|'quote', runs: [{ t, b?, href? }] } | { type: 'img', src, alt } | { type: 'hr' } */
const BLOCK_TAGS = new Set(['p', 'div', 'td', 'th', 'tr', 'table', 'tbody', 'section', 'article', 'header', 'footer', 'center', 'ul', 'ol', 'figure', 'figcaption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre']);
const NOISE = /수신\s*거부|구독\s*(?:취소|해지)|unsubscribe|웹(?:에서|으로)\s*보기|브라우저에서\s*보기|view\s+in\s+browser|Stibee로\s*만든|powered by stibee|이 메일은 .*(?:발송|수신 동의)|광고성 정보/i;
const safeHref = (raw) => { try { const u = new URL(decode(raw)); return ['https:', 'http:', 'mailto:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };

export function emailBlocks(html) {
  const src = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(head|script|style|noscript|template|svg|iframe|object|title)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(head|script|style|noscript|template|svg|iframe|object|title)\b[^>]*\/?>/gi, ' ');
  const blocks = [];
  const stack = []; // { name, bold, href }
  let runs = [], kind = 'p', quote = 0;
  const bold = () => stack.some((x) => x.bold);
  const href = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].href) return stack[i].href; return ''; };
  function flush() {
    const joined = runs.map((r) => r.t).join('');
    const trimmed = joined.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').trim();
    if (trimmed) {
      const merged = [];
      for (const r of runs) {
        const last = merged[merged.length - 1];
        if (last && !!last.b === !!r.b && (last.href || '') === (r.href || '')) last.t += r.t; else merged.push({ ...r });
      }
      merged.forEach((r) => { r.t = r.t.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n'); });
      while (merged.length && !merged[0].t.trim()) merged.shift();
      while (merged.length && !merged[merged.length - 1].t.trim()) merged.pop();
      if (merged.length) { merged[0].t = merged[0].t.replace(/^\s+/, ''); merged[merged.length - 1].t = merged[merged.length - 1].t.replace(/\s+$/, ''); }
      const type = quote ? 'quote' : kind;
      const last = blocks[blocks.length - 1];
      if (!NOISE.test(trimmed) && !(last && last.runs && last.runs.map((r) => r.t).join('') === trimmed)) blocks.push({ type, runs: merged.map((r) => Object.assign({ t: r.t }, r.b ? { b: true } : {}, r.href ? { href: r.href } : {})) });
    }
    runs = [];
  }
  for (const m of src.matchAll(/<(\/?)([a-zA-Z][\w-]*)\b([^>]*)>|([^<]+)/g)) {
    if (m[4] != null) { const t = decode(m[4]).replace(/\s+/g, ' '); if (t.trim() || runs.length) runs.push({ t, b: bold(), href: href() }); continue; }
    const closing = m[1] === '/', name = m[2].toLowerCase(), attrs = m[3] || '';
    const attr = (a) => decode((attrs.match(new RegExp(`\\b${a}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')) || []).slice(1).find((x) => x != null) || '');
    if (name === 'br') { runs.push({ t: '\n', b: bold(), href: href() }); continue; }
    if (name === 'hr') { flush(); if (blocks.length && blocks[blocks.length - 1].type !== 'hr') blocks.push({ type: 'hr' }); continue; }
    if (name === 'img') {
      const s = attr('src'), w = parseInt(attr('width'), 10), h = parseInt(attr('height'), 10);
      if (/^https:\/\//i.test(s) && !(w <= 3 || h <= 3) && !/\/(?:open|track|pixel|beacon)\b|[?&](?:utm_|open=)/i.test(s) && s.length < 2000) {
        flush();
        blocks.push({ type: 'img', src: s, alt: text(attr('alt')).slice(0, 200), ...(href() ? { href: href() } : {}) });
      }
      continue;
    }
    const block = BLOCK_TAGS.has(name);
    if (block) flush();
    if (closing) {
      const i = stack.map((x) => x.name).lastIndexOf(name);
      if (i >= 0) stack.splice(i);
      if (name === 'blockquote') quote = Math.max(0, quote - 1);
      if (block) kind = 'p';
      continue;
    }
    if (/\/\s*$/.test(attrs)) continue;
    const style = attr('style');
    const isBold = ['b', 'strong'].includes(name) || /font-weight\s*:\s*(?:bold|[6-9]00)/i.test(style);
    const link = name === 'a' ? safeHref(attr('href')) : '';
    if (!block || isBold || link) stack.push({ name, bold: isBold, href: link });
    else stack.push({ name, bold: false, href: '' });
    if (/^h[1-6]$/.test(name)) kind = 'h';
    else if (name === 'li') kind = 'li';
    else if (name === 'blockquote') quote++;
    else if (block) kind = /font-size\s*:\s*(?:2[0-9]|[3-9]\d)px/i.test(style) ? 'h' : 'p';
  }
  flush();
  // 큰 글씨 덩어리가 문단만큼 길면 제목이 아니라 강조 문단이다
  for (const b of blocks) if (b.type === 'h' && b.runs.map((r) => r.t).join('').length > 80) b.type = 'p';
  while (blocks.length && blocks[blocks.length - 1].type === 'hr') blocks.pop();
  while (blocks.length && blocks[0].type === 'hr') blocks.shift();
  return blocks.slice(0, 600);
}
const blockChars = (blocks) => blocks.reduce((n, b) => n + (b.runs ? b.runs.reduce((m, r) => m + r.t.length, 0) : 0), 0);

/** 글 페이지 HTML에서 본문 후보를 고른다: 공유 메일 주소(가장 정확) → JSON 속 가장 긴 HTML → 페이지의 article/main */
export function pageCandidates(html) {
  const out = { shareUrl: '', htmls: [] };
  const share = String(html).match(/https:(?:\\?\/){2}stibee\.com(?:\\?\/)api(?:\\?\/)v1\.0(?:\\?\/)emails(?:\\?\/)share(?:\\?\/)[\w-]+/);
  if (share) out.shareUrl = postUrl(share[0].replace(/\\\//g, '/')) || '';
  let longest = '';
  const visit = (v, d = 0) => {
    if (d > 16 || v == null) return;
    if (typeof v === 'string') { if (v.length > longest.length && /<(?:p|div|table|br|span)\b/i.test(v)) longest = v; return; }
    if (typeof v === 'object') for (const c of Object.values(v)) visit(c, d + 1);
  };
  for (const script of String(html).matchAll(/<script\b[^>]*(?:type=["']application\/(?:ld\+)?json["']|id=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(script[1])); } catch { /* 일반 스크립트 제외 */ }
  }
  if (longest) out.htmls.push(longest);
  const region = String(html).match(/<article\b[\s\S]*<\/article>/i) || String(html).match(/<main\b[\s\S]*<\/main>/i);
  out.htmls.push(region ? region[0] : String(html));
  return out;
}
const metaTitle = (html) => text((String(html).match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);

async function get(url, accept) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PersonalMakersReading/1.0)', 'Accept-Language': 'ko-KR,ko;q=0.9', ...(accept ? { Accept: accept } : {}), ...(url.startsWith('https://www.youtube.com/@') ? { Cookie: 'SOCS=CAI; CONSENT=YES+' } : {}) } });
  if (!response.ok) throw Error(`Source returned ${response.status}`);
  return response;
}
/** 리다이렉트를 따라간 뒤에도 스티비 안에 있을 때만 본문을 읽는다 */
async function getStibee(url) {
  const response = await get(url, 'text/html');
  const host = new URL(response.url || url).hostname;
  if (host !== 'stibee.com' && !host.endsWith('.stibee.com')) throw Error('Unexpected redirect');
  return response.text();
}

export async function readPost(url) {
  const html = await getStibee(url);
  const found = pageCandidates(html);
  let best = [];
  const consider = (blocks) => { if (blockChars(blocks) > blockChars(best)) best = blocks; };
  if (found.shareUrl && found.shareUrl !== url) {
    try { consider(emailBlocks(await getStibee(found.shareUrl))); } catch (e) { console.warn('[content-library] Shared email unavailable:', e.message); }
  }
  if (blockChars(best) < 200) for (const h of found.htmls) consider(emailBlocks(h));
  if (blockChars(best) < 40) throw Error('Post body not recognized');
  return { url, title: metaTitle(html), blocks: best };
}

let channelId = process.env.YOUTUBE_CHANNEL_ID || '';
async function latestVideos() {
  if (!channelId) channelId = channelIdFrom(await get(CHANNEL_PAGE, 'text/html').then((r) => r.text()));
  if (!channelId) throw Error('Channel id not found');
  const videos = parseVideoFeed(await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`).then((r) => r.text()));
  if (!videos.length) throw Error('Feed empty or unexpected channel');
  return videos;
}
async function curatedVideos() {
  const results = await Promise.allSettled(VIDEO_IDS.map(async (id) => {
    const data = await get(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`).then((r) => r.json());
    if (!String(data.author_name).includes(CHANNEL_NAME)) throw Error('Unexpected video channel');
    return { id, title: data.title, author: data.author_name };
  }));
  return results.filter((x) => x.status === 'fulfilled').map((x) => x.value);
}
async function newsletterPosts() {
  const [feed, archive] = await Promise.allSettled([
    get(NEWSLETTER + 'rss').then((r) => r.text()).then(parseNewsletterFeed),
    get(NEWSLETTER).then((r) => r.text()).then((html) => {
      const posts = parseArchive(html);
      if (!posts.length) console.warn('[content-library] Archive format not recognized', { bytes: html.length, scripts: [...html.matchAll(/<script[^>]+src=["']([^"']+)/g)].map((m) => m[1]).slice(0, 6) });
      return posts;
    })
  ]);
  if (feed.status === 'rejected' && archive.status === 'rejected') throw archive.reason;
  const byId = new Map();
  for (const p of [...(archive.value || []), ...(feed.value || [])]) byId.set(p.id, { ...byId.get(p.id), ...p, date: p.date || byId.get(p.id)?.date || '' });
  // 날짜가 있는 글은 최신순, 날짜를 못 읽은 글은 아카이브에 나온 순서대로 뒤에
  return [...byId.values()].map((p, i) => ({ p, i })).sort((a, b) => (b.p.date || '').localeCompare(a.p.date || '') || a.i - b.i).map((x) => x.p).slice(0, 20);
}

const CACHE_OK = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';
const CACHE_SHORT = 'public, max-age=0, s-maxage=60, stale-while-revalidate=60';

export default async function handler(req) {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  const requested = new URL(req.url).searchParams.get('post');
  if (requested != null) {
    const url = postUrl(requested);
    if (!url) return Response.json({ error: '허용되지 않은 글 주소입니다.' }, { status: 400 });
    try {
      return Response.json({ post: await readPost(url) }, { headers: { 'Cache-Control': 'public, max-age=600, s-maxage=86400, stale-while-revalidate=604800' } });
    } catch (e) {
      console.warn('[content-library] Post unavailable:', e.message);
      return Response.json({ error: '본문을 불러오지 못했습니다.' }, { status: 502, headers: { 'Cache-Control': CACHE_SHORT } });
    }
  }
  const [archive, latest] = await Promise.allSettled([newsletterPosts(), latestVideos()]);
  if (archive.status === 'rejected') console.warn('[content-library] Newsletter unavailable:', archive.reason?.message || 'unknown error');
  if (latest.status === 'rejected') console.warn('[content-library] Video feed unavailable:', latest.reason?.message || 'unknown error');
  const videos = latest.status === 'fulfilled' ? latest.value : await curatedVideos();
  const archiveAvailable = archive.status === 'fulfilled' && archive.value.length > 0;
  return Response.json({
    columns: archive.status === 'fulfilled' ? archive.value : [],
    videos,
    videoSource: latest.status === 'fulfilled' ? 'latest' : 'curated',
    archiveAvailable,
  }, { headers: { 'Cache-Control': archiveAvailable && latest.status === 'fulfilled' ? CACHE_OK : CACHE_SHORT } });
}
