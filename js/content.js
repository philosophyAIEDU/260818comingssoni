/* 쏜님의 공개 콘텐츠. 영상은 공식 플레이어로 재생하고, 뉴스레터는 서버가 뽑아 준 문단 구조를 화면에서 바로 읽게 한다.
 * 외부 HTML은 넣지 않는다 — 본문·댓글은 모두 textContent와 검사한 주소로만 그린다. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const $ = id => document.getElementById(id);
  const KEY = 'personalmakers.content.saved.v1';
  const FONT_KEY = 'personalmakers.content.fontsize.v1';
  const NAME_KEY = 'personalmakers.content.commentName.v1';
  const TOKENS_KEY = 'personalmakers.content.commentTokens.v1';
  const FONT_SIZES = [15, 17, 19, 21];
  const LIBRARY = '/.netlify/functions/content-library';
  const COMMENTS = '/.netlify/functions/content-comments';
  // 쏜님이 직접 고른 영상 — 피드에 같은 영상이 있으면 분류·질문을 이어 붙이고, 피드를 못 읽으면 이 목록을 보여 준다.
  const curated = [
    { id: 'xmd2_HKMgCU', title: '성과가 더딜 때, 꾸준히 쌓아가는 법', category: '꾸준한 실행', description: '초보 유튜버의 성장 과정을 보며 나의 기록 습관을 돌아보세요.', question: '아직 눈에 보이는 성과가 없어도, 이번 주 계속 쌓아갈 수 있는 작은 기록은 무엇인가요?' },
    { id: 'gQZ6zI3epVo', title: '나의 경험을 브랜드와 수익으로 연결하기', category: '나만의 브랜드', description: '유튜브 브랜딩과 여러 수익 경로를 함께 생각해 보는 시간.', question: '오늘 책에서 배운 내용을 활용해, 내 경험이 누군가의 문제를 해결하도록 만들 수 있을까요?' },
    { id: 'XQSoFje8DKY', title: '디지털 노마드의 일과 수익 이야기', category: '1인 비즈니스', description: '일하는 방식과 지속 가능한 수익에 관한 인터뷰를 만나보세요.', question: '내가 원하는 일하는 방식에 가까워지기 위해, 오늘부터 작게 실험할 수 있는 것은 무엇인가요?' }
  ];
  const asVideo = v => ({ ...v, type: 'videos', url: `https://www.youtube.com/watch?v=${v.id}` });
  let videos = curated.map(asVideo), columns = [], filter = 'videos', active = null, loading = true, failed = false, latest = false;
  let book = '';
  const posts = new Map(); // 칼럼 본문 캐시
  const store = {
    get(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 불가 환경에서도 현재 화면에서는 사용 */ } }
  };
  let saved;
  { const data = store.get(KEY, []); saved = new Set(Array.isArray(data) ? data.filter(x => typeof x === 'string') : []); }
  let fontIndex = FONT_SIZES.indexOf(store.get(FONT_KEY, 17)); if (fontIndex < 0) fontIndex = 1;
  const tokens = (() => { const t = store.get(TOKENS_KEY, {}); return t && typeof t === 'object' && !Array.isArray(t) ? t : {}; })();

  function all() { return [...videos, ...columns]; }
  function persist() { store.set(KEY, [...saved]); }
  const prettyDate = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}. ${+m[2]}. ${+m[3]}.` : String(iso || ''); };
  const daysAgo = iso => { const t = Date.parse(iso); return isNaN(t) ? Infinity : (Date.now() - t) / 864e5; };
  function toggleSave(id) {
    if (saved.has(id)) saved.delete(id); else saved.add(id);
    persist(); render(); syncReaderSave();
  }
  function syncReaderSave() { if (active) { $('readerSave').textContent = saved.has(active.id) ? '✓ 보관 중' : '나중에 보기'; $('readerSave').setAttribute('aria-pressed', String(saved.has(active.id))); } }
  function render() {
    const items = filter === 'saved' ? all().filter(x => saved.has(x.id)) : filter === 'videos' ? videos : columns;
    $('savedCount').textContent = String([...saved].filter(id => all().some(x => x.id === id)).length);
    $('contentCount').textContent = items.length ? `${items.length}편` : '';
    $('contentHeading').textContent = filter === 'videos' ? '읽고, 보고, 한 걸음 더.' : filter === 'columns' ? '천천히 읽고, 오래 남길 이야기.' : '다시 꺼내 보고 싶은 이야기.';
    $('contentSubheading').textContent = filter === 'videos' ? (latest ? '커밍쏜 채널에 올라온 최신 영상부터' : '꾸준한 실행부터 나만의 브랜드까지') : filter === 'columns' ? '퍼스널메이커스 뉴스레터 최신 글 · 화면에서 바로 읽어요' : '현재 기기에 보관한 영상과 칼럼';
    document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)));
    $('contentGrid').classList.toggle('columns', filter === 'columns');
    const status = $('contentStatus');
    status.hidden = true;
    if (!items.length) {
      status.hidden = false;
      if (filter === 'saved') status.textContent = '마음에 드는 콘텐츠의 ‘나중에 보기’를 눌러보세요. 여기에 모아둘게요.';
      else if (loading) status.textContent = '쏜님의 칼럼을 불러오고 있습니다…';
      else status.innerHTML = '지금은 칼럼 목록을 불러오지 못했습니다. 공식 뉴스레터에서 글을 읽으실 수 있어요.<br><a href="https://personalmakers.stibee.com/" target="_blank" rel="noopener noreferrer">뉴스레터 새 창에서 읽기 ↗</a><br><button type="button" id="retryColumns">목록 다시 불러오기</button>';
    } else if (filter === 'columns' && failed) { status.hidden = false; status.textContent = '이전에 불러온 칼럼을 보여드리고 있어요.'; }
    $('contentGrid').innerHTML = items.map(item => {
      const video = item.type === 'videos';
      const fresh = daysAgo(item.published || item.date) <= 14;
      return `<article class="library-item">
      <button type="button" class="library-open" data-open="${esc(item.id)}" aria-label="${esc(item.title)} ${video ? '영상 보기' : '칼럼 읽기'}">
        ${video ? `<div class="content-thumb"><img src="https://i.ytimg.com/vi/${esc(item.id)}/hqdefault.jpg" alt="${esc(item.title)} 영상 썸네일" loading="lazy" width="480" height="270"><span class="content-play" aria-hidden="true">▶</span></div>` : ''}
        <span class="content-category">${fresh ? '<span class="content-new">NEW</span>' : ''}${esc(item.category)}</span><h3>${esc(item.title)}</h3>
        ${item.description ? `<p>${esc(item.description)}</p>` : ''}
        ${video ? '' : '<span class="column-original-label">화면에서 바로 읽기 →</span>'}
      </button>
      <div class="content-item-footer"><span>커밍쏜${item.published ? ' · ' + esc(prettyDate(item.published.slice(0, 10))) : item.date ? ' · ' + esc(prettyDate(item.date)) : video ? ' · YouTube' : ' · 뉴스레터'}</span><button type="button" class="save-content" data-save="${esc(item.id)}" aria-label="${esc(item.title)} ${saved.has(item.id) ? '보관 취소' : '나중에 보기'}" aria-pressed="${saved.has(item.id)}">${saved.has(item.id) ? '✓ 보관 중' : '+ 나중에 보기'}</button></div>
    </article>`;
    }).join('');
  }
  const siblingsOf = item => { const list = item.type === 'videos' ? videos : columns; return filter === 'saved' ? list.filter(x => saved.has(x.id)) : list; };
  // 이용 통계(js/analytics.js). 없으면 아무 일도 하지 않는다.
  const track = () => window.PMTrack || { videoOpen() {}, videoClose() {}, videoPlaying() {}, columnOpen() {}, columnClose() {}, columnDepth() {} };
  // 실제 재생 시간은 유튜브 플레이어 API의 재생 상태로 센다. API를 못 불러와도 영상은 그대로 나온다.
  let ytApi = null;
  function youtubeApi() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (!ytApi) ytApi = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (typeof prev === 'function') prev(); resolve(window.YT); };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api'; script.async = true;
      script.onerror = () => { ytApi = null; reject(Error('YouTube API unavailable')); };
      document.head.append(script);
    });
    return ytApi;
  }
  function watchPlayback(frame) {
    youtubeApi().then(YT => {
      if (!frame.isConnected) return;
      new YT.Player(frame, { events: { onStateChange: e => { if (frame.isConnected) track().videoPlaying(e.data === 1); } } });
    }).catch(() => { /* 재생 시간만 빠진다 */ });
  }
  function openItem(id) {
    const item = all().find(x => x.id === id);
    if (!item) return;
    track().videoClose(); track().columnClose();
    active = item;
    const video = item.type === 'videos';
    if (video) track().videoOpen(item.id, item.title); else track().columnOpen(item.id, item.title);
    $('contentReader').classList.toggle('is-column', !video);
    $('readerTitle').textContent = item.title;
    $('readerType').textContent = video ? '쏜님의 영상' : '쏜님의 칼럼';
    $('readerByline').textContent = `커밍쏜 · 퍼스널메이커스${item.published ? ' · ' + prettyDate(item.published.slice(0, 10)) : item.date ? ' · ' + prettyDate(item.date) : ''}`;
    $('readerOriginal').href = item.url;
    $('readerOriginal').textContent = video ? 'YouTube에서 보기 ↗' : '원문 보기 ↗';
    $('readerFont').hidden = video;
    if (video) {
      const frame = document.createElement('iframe');
      frame.title = item.title;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.className = 'video-frame';
      frame.src = `https://www.youtube-nocookie.com/embed/${item.id}?rel=0&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
      frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen';
      frame.allowFullscreen = true;
      $('readerMedia').replaceChildren(frame);
      const hint = document.createElement('p'); hint.className = 'reader-fallback';
      hint.textContent = '재생이 제한되면 위의 ‘YouTube에서 보기’를 눌러주세요.';
      $('readerMedia').append(hint);
      watchPlayback(frame);
    } else {
      openColumn(item);
    }
    $('readerReflection').innerHTML = `<strong>독서와 연결하기 · 멤버십 질문</strong><p>${esc(item.question || (video ? '이 영상에서 내 삶이나 브랜드에 적용하고 싶은 한 가지는 무엇인가요? 오늘 읽은 책의 문장과 함께 생각해 보세요.' : '이 글에서 내 삶이나 브랜드에 적용하고 싶은 한 가지는 무엇인가요? 오늘 읽은 책의 문장과 함께 생각해 보세요.'))}</p>`;
    openComments(item);
    syncReaderSave();
    $('readerNext').hidden = siblingsOf(item).length < 2;
    $('readerNext').textContent = video ? '다음 영상 →' : '다음 칼럼 →';
    if (!$('contentReader').open) $('contentReader').showModal();
    document.body.classList.add('content-reader-open');
    document.querySelector('.reader-scroll').scrollTop = 0;
    paintProgress();
  }

  /* ── 칼럼 본문 ─────────────────────────── */
  const safeUrl = (raw, protocols) => { try { const u = new URL(raw); return protocols.includes(u.protocol) ? u.href : ''; } catch { return ''; } };
  function link(href, children) {
    const a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.append(...children);
    return a;
  }
  function runsTo(el, runs) {
    for (const r of Array.isArray(runs) ? runs : []) {
      const parts = String(r.t ?? '').split('\n');
      const nodes = parts.flatMap((p, i) => i ? [document.createElement('br'), document.createTextNode(p)] : [document.createTextNode(p)]);
      let out = nodes;
      if (r.b) { const s = document.createElement('strong'); s.append(...out); out = [s]; }
      const href = r.href && safeUrl(r.href, ['https:', 'http:', 'mailto:']);
      if (href) out = [link(href, out)];
      el.append(...out);
    }
    return el;
  }
  function articleFrom(blocks) {
    const article = document.createElement('article');
    article.className = 'newsletter-body';
    let list = null;
    for (const b of Array.isArray(blocks) ? blocks : []) {
      if (b.type !== 'li') list = null;
      if (b.type === 'img') {
        const src = safeUrl(b.src, ['https:']);
        if (!src) continue;
        const fig = document.createElement('figure');
        const img = document.createElement('img');
        img.src = src; img.alt = String(b.alt || ''); img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
        img.addEventListener('error', () => fig.remove());
        const href = b.href && safeUrl(b.href, ['https:', 'http:']);
        fig.append(href ? link(href, [img]) : img);
        article.append(fig);
      } else if (b.type === 'hr') article.append(document.createElement('hr'));
      else if (b.type === 'li') {
        if (!list) { list = document.createElement('ul'); article.append(list); }
        list.append(runsTo(document.createElement('li'), b.runs));
      } else article.append(runsTo(document.createElement(b.type === 'h' ? 'h3' : b.type === 'quote' ? 'blockquote' : 'p'), b.runs));
    }
    return article;
  }
  function columnFallback(item, text) {
    const box = document.createElement('div'); box.className = 'reader-loading';
    const p = document.createElement('p'); p.textContent = text;
    box.append(p);
    if (!/불러오는/.test(text)) {
      const a = link(item.url, [document.createTextNode('원문에서 읽기 ↗')]); a.className = 'reader-original-link';
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '다시 불러오기';
      retry.addEventListener('click', () => { posts.delete(item.url); openColumn(item); });
      box.append(a, retry);
    }
    return box;
  }
  async function openColumn(item) {
    $('readerMedia').replaceChildren(columnFallback(item, '본문을 불러오는 중…'));
    applyFont();
    try {
      if (!posts.has(item.url)) {
        const request = fetch(`${LIBRARY}?post=${encodeURIComponent(item.url)}`, { signal: AbortSignal.timeout(15000) })
          .then(r => r.ok ? r.json() : Promise.reject(Error('unavailable')))
          .then(d => { if (!d.post || !Array.isArray(d.post.blocks) || !d.post.blocks.length) throw Error('empty'); return d.post; });
        posts.set(item.url, request);
        request.catch(() => posts.delete(item.url));
      }
      const post = await posts.get(item.url);
      if (active !== item) return;
      $('readerMedia').replaceChildren(articleFrom(post.blocks));
      applyFont(); paintProgress();
    } catch {
      if (active === item) $('readerMedia').replaceChildren(columnFallback(item, '지금은 이 화면에서 본문을 열지 못했어요. 원문에서 바로 읽으실 수 있어요.'));
    }
  }
  function applyFont() {
    $('contentReader').style.setProperty('--reader-font', FONT_SIZES[fontIndex] + 'px');
    $('fontDown').disabled = fontIndex === 0;
    $('fontUp').disabled = fontIndex === FONT_SIZES.length - 1;
  }
  function paintProgress() {
    const s = document.querySelector('.reader-scroll');
    const max = s.scrollHeight - s.clientHeight;
    $('readerProgress').style.transform = `scaleX(${max > 0 ? Math.min(1, s.scrollTop / max) : 0})`;
    if (active && active.type === 'columns' && $('readerMedia').querySelector('.newsletter-body')) track().columnDepth(max > 0 ? s.scrollTop / max : 1);
  }

  /* ── 영상 댓글: 멤버끼리 책과 영상을 이어 본 인사이트 ─────────────── */
  let commentsFor = '';
  const ago = iso => {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (isNaN(s)) return '';
    if (s < 60) return '방금';
    if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
    const d = new Date(iso); return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
  };
  function commentItem(c) {
    const li = document.createElement('li'); li.className = 'comment'; li.dataset.id = c.id;
    const meta = document.createElement('div'); meta.className = 'comment-meta';
    const avatar = document.createElement('span'); avatar.className = 'comment-avatar'; avatar.setAttribute('aria-hidden', 'true'); avatar.textContent = String(c.nickname || '?').slice(0, 1);
    const name = document.createElement('strong'); name.textContent = c.nickname;
    meta.append(avatar, name);
    if (c.book) { const b = document.createElement('span'); b.className = 'comment-book'; b.textContent = `『${c.book}』 읽는 중`; meta.append(b); }
    const time = document.createElement('time'); time.dateTime = c.createdAt; time.textContent = ago(c.createdAt); meta.append(time);
    const body = document.createElement('p'); body.className = 'comment-text'; body.textContent = c.text;
    li.append(meta, body);
    if (tokens[c.id]) {
      const del = document.createElement('button'); del.type = 'button'; del.className = 'comment-delete'; del.dataset.delete = c.id; del.textContent = '삭제';
      del.setAttribute('aria-label', '내 댓글 삭제');
      li.append(del);
    }
    return li;
  }
  function paintComments(list) {
    $('commentList').replaceChildren(...list.slice().reverse().map(commentItem));
    $('commentCount').textContent = list.length ? `${list.length}` : '';
    $('commentEmpty').hidden = list.length > 0;
  }
  let commentCache = [];
  // 영상은 videoId, 칼럼은 columnId(글 경로)로 댓글을 묶는다
  const commentTarget = item => item.type === 'videos' ? { query: 'video', field: 'videoId' } : { query: 'column', field: 'columnId' };
  async function openComments(item) {
    commentsFor = item.id;
    const video = item.type === 'videos';
    $('commentsLead').textContent = `이 ${video ? '영상' : '글'}과 지금 읽고 있는 책을 이어 본 생각을 나눠 주세요. 독서 멤버십 멤버만 남길 수 있어요.`;
    paintPlaceholder();
    commentCache = [];
    $('commentList').replaceChildren();
    $('commentCount').textContent = '';
    $('commentEmpty').hidden = true;
    $('commentMsg').textContent = '';
    $('commentText').value = '';
    paintLength();
    $('commentState').hidden = false;
    $('commentState').textContent = '멤버들의 인사이트를 불러오는 중…';
    try {
      const response = await fetch(`${COMMENTS}?${commentTarget(item).query}=${encodeURIComponent(item.id)}`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw Error('unavailable');
      const data = await response.json();
      if (commentsFor !== item.id) return;
      if (typeof data.book === 'string' && data.book) { book = data.book; paintPlaceholder(); }
      commentCache = (data.comments || []).filter(c => c && typeof c.id === 'string' && typeof c.text === 'string' && typeof c.nickname === 'string');
      $('commentState').hidden = true;
      paintComments(commentCache);
    } catch {
      if (commentsFor !== item.id) return;
      $('commentState').innerHTML = '지금은 댓글을 불러오지 못했어요. <button type="button" id="retryComments">다시 불러오기</button>';
    }
  }
  function paintPlaceholder() {
    const what = active && active.type === 'columns' ? '칼럼' : '영상';
    $('commentText').placeholder = book
      ? `예) 『${book}』에서 밑줄 친 문장이 ${what}의 이 이야기와 이어졌어요…`
      : `예) 지금 읽는 책의 한 문장이 ${what}의 이 이야기와 이어졌어요…`;
  }
  function paintLength() { $('commentLength').textContent = `${$('commentText').value.length}/500`; }
  $('commentText').addEventListener('input', paintLength);
  $('commentName').value = typeof store.get(NAME_KEY, '') === 'string' ? store.get(NAME_KEY, '') : '';
  $('commentForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!active) return;
    const nickname = $('commentName').value.trim(), text = $('commentText').value.trim();
    const say = (t, kind) => { $('commentMsg').textContent = t; $('commentMsg').dataset.kind = kind || ''; };
    if (!nickname) { say('멤버 이름을 적어 주세요. 인증할 때 쓰는 이름 그대로요.', 'error'); $('commentName').focus(); return; }
    if (text.length < 2) { say('나누고 싶은 생각을 적어 주세요.', 'error'); $('commentText').focus(); return; }
    const target = active, button = $('commentSubmit');
    button.disabled = true; say('남기는 중…');
    try {
      const response = await fetch(COMMENTS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [commentTarget(target).field]: target.id, nickname, text }), signal: AbortSignal.timeout(12000) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.comment) throw Error(data.error || '댓글을 남기지 못했어요. 잠시 뒤 다시 시도해 주세요.');
      store.set(NAME_KEY, nickname);
      tokens[data.comment.id] = data.token; store.set(TOKENS_KEY, tokens);
      if (commentsFor === target.id) {
        commentCache.push(data.comment); paintComments(commentCache); $('commentState').hidden = true;
        $('commentText').value = ''; paintLength();
      }
      say('인사이트를 남겼어요. 고마워요!', 'ok');
    } catch (e) {
      say(e.name === 'TimeoutError' || e.name === 'TypeError' ? '연결이 불안정해요. 잠시 뒤 다시 시도해 주세요.' : e.message, 'error');
    } finally { button.disabled = false; }
  });
  $('commentList').addEventListener('click', async event => {
    const del = event.target.closest('[data-delete]');
    if (!del || !confirm('이 댓글을 지울까요?')) return;
    const id = del.dataset.delete;
    del.disabled = true;
    try {
      const response = await fetch(COMMENTS, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, token: tokens[id] }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || '지우지 못했어요.');
      delete tokens[id]; store.set(TOKENS_KEY, tokens);
      commentCache = commentCache.filter(c => c.id !== id); paintComments(commentCache);
    } catch (e) { del.disabled = false; $('commentMsg').textContent = e.message; $('commentMsg').dataset.kind = 'error'; }
  });
  $('readerComments').addEventListener('click', e => { if (e.target.id === 'retryComments' && active) openComments(active); });

  $('contentGrid').addEventListener('error', event => {
    if (event.target.tagName === 'IMG') {
      event.target.hidden = true;
      event.target.parentElement.classList.add('thumbnail-unavailable');
    }
  }, true);
  $('contentGrid').addEventListener('click', event => {
    const open = event.target.closest('[data-open]'), save = event.target.closest('[data-save]');
    if (open) openItem(open.dataset.open);
    if (save) toggleSave(save.dataset.save);
  });
  // 주소로 바로 들어오기: content.html#videos · #columns · #saved, #open=<영상 ID 또는 칼럼 경로>
  const FILTERS = ['videos', 'columns', 'saved'];
  const setHash = h => { try { history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); } catch { /* file:// 등 */ } };
  let pendingOpen = '';
  function readHash() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (FILTERS.includes(h)) filter = h;
    else if (h.startsWith('open=')) pendingOpen = h.slice(5);
  }
  function openPending() {
    if (!pendingOpen) return;
    const item = all().find(x => x.id === pendingOpen);
    if (!item && loading) return; // 목록을 다 받은 뒤 다시 본다
    pendingOpen = '';
    if (!item) return;
    filter = item.type; render(); openItem(item.id);
  }
  window.addEventListener('hashchange', () => { readHash(); render(); openPending(); });
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; setHash(filter); render(); }));
  $('contentStatus').addEventListener('click', e => { if (e.target.id === 'retryColumns') load(); });
  $('readerClose').addEventListener('click', () => $('contentReader').close());
  $('contentReader').addEventListener('close', () => { track().videoClose(); track().columnClose(); $('readerMedia').replaceChildren(); active = null; if (location.hash.startsWith('#open=')) setHash(filter); commentsFor = ''; document.body.classList.remove('content-reader-open'); });
  $('readerSave').addEventListener('click', () => { if (active) toggleSave(active.id); });
  $('readerNext').addEventListener('click', () => {
    if (!active) return;
    const siblings = siblingsOf(active);
    if (siblings.length) openItem(siblings[(siblings.findIndex(x => x.id === active.id) + 1) % siblings.length].id);
  });
  $('fontDown').addEventListener('click', () => { fontIndex = Math.max(0, fontIndex - 1); store.set(FONT_KEY, FONT_SIZES[fontIndex]); applyFont(); });
  $('fontUp').addEventListener('click', () => { fontIndex = Math.min(FONT_SIZES.length - 1, fontIndex + 1); store.set(FONT_KEY, FONT_SIZES[fontIndex]); applyFont(); });
  document.querySelector('.reader-scroll').addEventListener('scroll', paintProgress, { passive: true });

  const allowedPost = url => { try { const u = new URL(url); return (u.origin === 'https://personalmakers.stibee.com' && /^\/p\/[^/?#]+\/?$/.test(u.pathname))
    || (u.origin === 'https://stibee.com' && /^\/api\/v1\.0\/emails\/share\/[^/?#]+$/.test(u.pathname)); } catch { return false; } };
  async function load() {
    loading = true; render();
    try {
      const response = await fetch(LIBRARY, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw Error('Content unavailable');
      const data = await response.json();
      const feed = (data.videos || []).filter(v => v && /^[\w-]{11}$/.test(v.id) && typeof v.title === 'string');
      if (feed.length) {
        latest = data.videoSource === 'latest';
        const byId = new Map(curated.map(v => [v.id, v]));
        const list = feed.map(v => ({ ...(byId.get(v.id) || {}), id: v.id, title: v.title,
          description: byId.get(v.id)?.description || (typeof v.description === 'string' ? v.description : ''),
          category: byId.get(v.id)?.category || (latest ? '최신 영상' : '추천 영상'),
          published: typeof v.published === 'string' ? v.published : '' }));
        // 피드에 없는(오래된) 추천 영상은 최신 영상 뒤에 이어 붙인다
        if (latest) list.push(...curated.filter(v => !feed.some(x => x.id === v.id)));
        videos = list.map(asVideo);
      }
      const safe = (data.columns || []).filter(x => allowedPost(x.url) && typeof x.title === 'string');
      if (safe.length) columns = safe.map(x => ({ ...x, type: 'columns', category: 'NEWSLETTER · 칼럼', date: String(x.date || '').slice(0, 32) }));
      failed = !data.archiveAvailable;
    } catch { failed = true; }
    loading = false; render(); openPending();
  }
  readHash(); paintPlaceholder(); applyFont(); render(); openPending(); load();
})();
