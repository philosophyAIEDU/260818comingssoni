// 공개 채널의 최신 목록과 뉴스레터 본문을 가져온다.
// 외부 HTML은 그대로 내려보내지 않는다 — 문단·제목·이미지 같은 구조만 뽑아 JSON으로 주고, 화면은 그 값을 글자로만 그린다.
const NEWSLETTER = 'https://personalmakers.stibee.com/';
// 뉴스레터 페이지는 글 목록을 브라우저에서 이 API로 받아 그린다(HTML에는 목록이 없다). 376164 = 퍼스널메이커스 뉴스레터
const PAGE_API = 'https://page.stibee.com/api/v1.0/lists/376164';
const CHANNEL_ID = 'UCUzoht-2qT2sg7mPaZCKHWQ'; // 커밍쏜 채널(뉴스레터 페이지에 걸린 유튜브 링크)
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
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) { const d = new Date(s); if (!isNaN(d)) return kst(d); } // 시간대가 붙은 시각은 한국 날짜로
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

/** 스티비 페이지 글 목록 API 응답 → 글 목록. 응답 모양이 바뀌어도 버티도록 제목·주소·날짜 필드를 넓게 찾는다.
 *  share: 같은 글의 스티비 공유 메일 주소(본문을 가장 정확히 읽을 수 있는 곳). 없으면 ''. */
const TITLE_KEYS = ['title', 'subject', 'emailSubject', 'emailTitle', 'postTitle', 'contentTitle'];
const DATE_KEYS = ['publishedAt', 'publishDate', 'publishedTime', 'sentTime', 'sendTime', 'sendDate', 'sentAt', 'sendAt', 'reservedTime', 'createdTime', 'createdAt', 'regDate', 'date'];
const ID_KEYS = ['postId', 'contentId', 'contentsId', 'id', 'emailId'];
export function parseContents(data) {
  const posts = new Map();
  const visit = (v, depth = 0) => {
    if (!v || typeof v !== 'object' || depth > 8) return;
    if (Array.isArray(v)) { v.forEach((x) => visit(x, depth + 1)); return; }
    const titleKey = TITLE_KEYS.find((k) => typeof v[k] === 'string' && text(v[k]).length >= 3);
    // 안에 목록을 품은 객체(응답 껍데기·뉴스레터 정보)는 글이 아니다
    if (titleKey && !Object.values(v).some(Array.isArray)) {
      let page = '', share = '';
      for (const val of Object.values(v)) {
        if (typeof val !== 'string') continue;
        const u = postUrl(decode(val));
        if (u && u.startsWith(NEWSLETTER)) page = page || u; else if (u) share = share || u;
      }
      if (!page) { const k = ID_KEYS.find((k) => /^\d+$/.test(String(v[k] ?? ''))); if (k) page = `${NEWSLETTER}p/${v[k]}/`; }
      const url = page || share;
      if (url) {
        const id = new URL(url).pathname;
        const dateKey = DATE_KEYS.find((k) => isoDate(v[k]));
        posts.set(id, { id, title: text(v[titleKey]), url, date: dateKey ? isoDate(v[dateKey]) : '', share: share && share !== url ? share : '' });
        return;
      }
    }
    for (const child of Object.values(v)) if (child && typeof child === 'object') visit(child, depth + 1);
  };
  visit(data);
  return [...posts.values()];
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
  // Next.js(app router)는 화면 데이터를 self.__next_f.push([1,"…"]) 조각으로 싣는다. 긴 글은 "id:T길이,본문" 줄로 들어온다.
  let rsc = '';
  for (const m of String(html).matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)\s*<\/script>/g)) {
    try { const chunk = JSON.parse(m[1]); if (typeof chunk[1] === 'string') rsc += chunk[1]; } catch { /* 형식이 다른 조각은 건너뛴다 */ }
  }
  let rscLongest = '';
  const keep = (str) => { if (str.length > rscLongest.length && /<(?:p|div|table|br|span|h[1-6])\b/i.test(str)) rscLongest = str; };
  for (const m of rsc.matchAll(/(?:^|\n)[0-9a-z]+:T([0-9a-f]+),/g)) {
    keep(Buffer.from(rsc.slice(m.index + m[0].length)).subarray(0, parseInt(m[1], 16)).toString());
  }
  for (const m of rsc.matchAll(/"((?:[^"\\]|\\.){200,})"/g)) { try { keep(JSON.parse(`"${m[1]}"`)); } catch { /* 문자열이 아니면 무시 */ } }
  const share = (String(html) + rsc).match(/https:(?:\\?\/){2}stibee\.com(?:\\?\/)api(?:\\?\/)v1\.0(?:\\?\/)emails(?:\\?\/)share(?:\\?\/)[\w-]+/);
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
  if (rscLongest) out.htmls.push(rscLongest);
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
  let best = [], title = '';
  const consider = (blocks) => { if (blockChars(blocks) > blockChars(best)) best = blocks; };
  const enough = () => blockChars(best) >= 200;
  // 1) 목록 API가 알려 준 공유 메일 주소 — 메일 본문 그대로라 가장 정확하다
  const known = url.startsWith(NEWSLETTER) ? (await newsletterIndex().catch(() => [])).find((p) => p.url === url) : null;
  if (known) title = known.title;
  if (known?.share) { try { consider(emailBlocks(await getStibee(known.share))); } catch (e) { console.warn('[content-library] Shared email unavailable:', e.message); } }
  // 2) 글 페이지(HTML·Next.js 데이터 속 본문이나 공유 메일 주소)
  if (!enough()) {
    try {
      const html = await getStibee(url);
      title = title || metaTitle(html);
      const found = pageCandidates(html);
      if (found.shareUrl && found.shareUrl !== url && found.shareUrl !== known?.share) {
        try { consider(emailBlocks(await getStibee(found.shareUrl))); } catch (e) { console.warn('[content-library] Shared email unavailable:', e.message); }
      }
      if (!enough()) for (const h of found.htmls) consider(emailBlocks(h));
    } catch (e) { console.warn('[content-library] Post page unavailable:', e.message); }
  }
  // 3) 글 하나를 주는 API(있으면) — 응답 속 가장 긴 HTML을 본문으로 본다
  const postId = (url.match(/\/p\/(\d+)\/?$/) || [])[1];
  if (!enough() && postId) {
    try {
      let longest = '';
      const visit = (v, d = 0) => { if (d > 10 || v == null) return; if (typeof v === 'string') { if (v.length > longest.length && /<(?:p|div|table|br|span)\b/i.test(v)) longest = v; return; } if (typeof v === 'object') Object.values(v).forEach((c) => visit(c, d + 1)); };
      visit(await get(`${PAGE_API}/contents/${postId}`, 'application/json').then((r) => r.json()));
      if (longest) consider(emailBlocks(longest));
    } catch (e) { console.warn('[content-library] Post API unavailable:', e.message); }
  }
  if (blockChars(best) < 40) throw Error('Post body not recognized');
  return { url, title, blocks: best };
}

let channelId = process.env.YOUTUBE_CHANNEL_ID || CHANNEL_ID;
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
let indexCache = null;
export function resetCaches() { indexCache = null; } // 테스트용 // { at, promise } — 목록과 본문 요청이 같은 목록 API 응답을 잠시 같이 쓴다
function newsletterIndex() {
  if (indexCache && Date.now() - indexCache.at < 5 * 60e3) return indexCache.promise;
  const promise = get(`${PAGE_API}/contents`, 'application/json').then((r) => r.json()).then((data) => {
    const posts = parseContents(data);
    if (!posts.length) { console.warn('[content-library] Contents API format not recognized', JSON.stringify(describe(data)).slice(0, 1500)); indexCache = null; }
    return posts;
  });
  indexCache = { at: Date.now(), promise };
  promise.catch(() => { indexCache = null; });
  return promise;
}
/** 응답 모양만 요약한다(값은 앞부분만) — 형식이 바뀌었을 때 로그와 ?debug=newsletter로 확인 */
function describe(v, depth = 0) {
  if (Array.isArray(v)) return depth > 3 ? `[${v.length}]` : [v.length, describe(v[0], depth + 1)];
  if (v && typeof v === 'object') return depth > 3 ? '{…}' : Object.fromEntries(Object.entries(v).slice(0, 40).map(([k, x]) => [k, describe(x, depth + 1)]));
  return typeof v === 'string' ? v.slice(0, 60) : v;
}
async function newsletterPosts() {
  let posts = await newsletterIndex().catch((e) => { console.warn('[content-library] Contents API unavailable:', e.message); return []; });
  if (!posts.length) {
    // 목록 API가 막히거나 바뀌면 페이지 HTML에 남은 링크라도 읽는다
    const html = await get(NEWSLETTER).then((r) => r.text());
    posts = parseArchive(html);
    if (!posts.length) console.warn('[content-library] Archive format not recognized', { bytes: html.length });
  }
  // 날짜가 있는 글은 최신순, 날짜를 못 읽은 글은 받은 순서대로 뒤에
  return posts.map((p, i) => ({ p, i })).sort((a, b) => (b.p.date || '').localeCompare(a.p.date || '') || a.i - b.i)
    .map(({ p }) => ({ id: p.id, title: p.title, url: p.url, date: p.date })).slice(0, 20);
}

// 새 칼럼·영상이 올라오면 10분 안에 앱에 보이게 — 브라우저는 매번 확인하고, 중간 서버(CDN)는 10분만 들고 있는다.
// (예전엔 1시간 + 하루까지 묵은 목록을 내줄 수 있어 새 뉴스레터가 늦게 보였다)
const CACHE_OK = 'public, max-age=0, s-maxage=600, stale-while-revalidate=600';
const CACHE_SHORT = 'public, max-age=0, s-maxage=60, stale-while-revalidate=60';

export default async function handler(req) {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  const params = new URL(req.url).searchParams;
  if (params.get('debug') === 'newsletter') {
    const [api, page] = await Promise.allSettled([get(`${PAGE_API}/contents`, 'application/json').then((r) => r.json()), get(NEWSLETTER).then((r) => r.text())]);
    return Response.json({
      api: api.status === 'fulfilled' ? { shape: describe(api.value), parsed: parseContents(api.value).slice(0, 5) } : { error: api.reason?.message },
      page: page.status === 'fulfilled' ? { bytes: page.value.length, parsed: parseArchive(page.value).length } : { error: page.reason?.message },
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const requested = params.get('post');
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
