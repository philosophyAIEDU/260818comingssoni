/* 쏜님의 공개 콘텐츠. 원문은 공식 서비스에서 재생·표시하고, 독서 연결 질문은 멤버십이 제공한다. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const $ = id => document.getElementById(id);
  const KEY = 'personalmakers.content.saved.v1';
  const videos = [
    { id: 'xmd2_HKMgCU', type: 'videos', title: '성과가 더딜 때, 꾸준히 쌓아가는 법', category: '꾸준한 실행', description: '초보 유튜버의 성장 과정을 보며 나의 기록 습관을 돌아보세요.', question: '아직 눈에 보이는 성과가 없어도, 이번 주 계속 쌓아갈 수 있는 작은 기록은 무엇인가요?' },
    { id: 'gQZ6zI3epVo', type: 'videos', title: '나의 경험을 브랜드와 수익으로 연결하기', category: '나만의 브랜드', description: '유튜브 브랜딩과 여러 수익 경로를 함께 생각해 보는 시간.', question: '오늘 책에서 배운 내용을 활용해, 내 경험이 누군가의 문제를 해결하도록 만들 수 있을까요?' },
    { id: 'XQSoFje8DKY', type: 'videos', title: '디지털 노마드의 일과 수익 이야기', category: '1인 비즈니스', description: '일하는 방식과 지속 가능한 수익에 관한 인터뷰를 만나보세요.', question: '내가 원하는 일하는 방식에 가까워지기 위해, 오늘부터 작게 실험할 수 있는 것은 무엇인가요?' }
  ].map(v => ({ ...v, url: `https://www.youtube.com/watch?v=${v.id}` }));
  let columns = [], filter = 'videos', active = null, loading = true, failed = false;
  let saved;
  try { const data = JSON.parse(localStorage.getItem(KEY) || '[]'); saved = new Set(Array.isArray(data) ? data.filter(x => typeof x === 'string') : []); } catch { saved = new Set(); }
  function all() { return [...videos, ...columns]; }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify([...saved])); } catch { /* 저장 불가 환경에서도 현재 화면에서는 사용 */ } }
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
    $('contentSubheading').textContent = filter === 'videos' ? '꾸준한 실행부터 나만의 브랜드까지' : filter === 'columns' ? '커밍쏜의 퍼스널메이커스 뉴스레터' : '현재 기기에 보관한 영상과 칼럼';
    document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)));
    $('contentGrid').classList.toggle('columns', filter === 'columns');
    const status = $('contentStatus');
    status.hidden = true;
    if (!items.length) {
      status.hidden = false;
      if (filter === 'saved') status.textContent = '마음에 드는 콘텐츠의 ‘나중에 보기’를 눌러보세요. 여기에 모아둘게요.';
      else if (loading) status.textContent = '쏜님의 칼럼을 불러오고 있습니다…';
      else status.innerHTML = '쏜님의 공식 뉴스레터에서 칼럼을 골라 읽어보세요. 목록이 보이지 않으면 새 창에서 열 수 있습니다.<br><a href="https://personalmakers.stibee.com/" target="_blank" rel="noopener noreferrer">뉴스레터 새 창에서 읽기 ↗</a><br><button type="button" id="retryColumns">목록 다시 불러오기</button>';
    } else if (filter === 'columns' && failed) { status.hidden = false; status.textContent = '이전에 불러온 칼럼을 보여드리고 있어요.'; }
    if (filter === 'columns' && !loading && !items.length) {
      const frame = document.createElement('iframe');
      frame.className = 'column-frame archive-frame'; frame.title = '커밍쏜 공식 뉴스레터 칼럼 목록';
      frame.src = 'https://personalmakers.stibee.com/';
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
      $('contentGrid').replaceChildren(frame);
      return;
    }
    $('contentGrid').innerHTML = items.map(item => `<article class="library-item">
      <button type="button" class="library-open" data-open="${esc(item.id)}" aria-label="${esc(item.title)} ${item.type === 'videos' ? '영상 보기' : '칼럼 읽기'}">
        ${item.type === 'videos' ? `<div class="content-thumb"><img src="https://i.ytimg.com/vi/${item.id}/hqdefault.jpg" alt="${esc(item.title)} 영상 썸네일" loading="lazy" width="480" height="270"><span class="content-play" aria-hidden="true">▶</span></div>` : ''}
        <span class="content-category">${esc(item.category)}</span><h3>${esc(item.title)}</h3>
        ${item.description ? `<p>${esc(item.description)}</p>` : ''}
      </button>
      <div class="content-item-footer"><span>커밍쏜${item.date ? ' · ' + esc(item.date) : ' · YouTube'}</span><button type="button" class="save-content" data-save="${esc(item.id)}" aria-label="${esc(item.title)} ${saved.has(item.id) ? '보관 취소' : '나중에 보기'}" aria-pressed="${saved.has(item.id)}">${saved.has(item.id) ? '✓ 보관 중' : '+ 나중에 보기'}</button></div>
    </article>`).join('');
  }
  function openItem(id) {
    const item = all().find(x => x.id === id);
    if (!item) return;
    active = item;
    $('readerTitle').textContent = item.title;
    $('readerType').textContent = item.type === 'videos' ? '쏜님의 영상' : '쏜님의 칼럼';
    $('readerOriginal').href = item.url;
    $('readerOriginal').textContent = item.type === 'videos' ? 'YouTube에서 보기 ↗' : '뉴스레터 원문 보기 ↗';
    const frame = document.createElement('iframe');
    frame.title = item.title;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    if (item.type === 'videos') {
      frame.className = 'video-frame';
      frame.src = `https://www.youtube-nocookie.com/embed/${item.id}?rel=0&playsinline=1`;
      frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen';
      frame.allowFullscreen = true;
    } else {
      frame.className = 'column-frame';
      frame.src = item.url;
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    }
    $('readerMedia').replaceChildren(frame);
    const hint = document.createElement('p'); hint.className = 'reader-fallback';
    hint.textContent = item.type === 'videos' ? '재생이 제한되면 위의 ‘YouTube에서 보기’를 눌러주세요.' : '공식 뉴스레터 원문입니다. 본문이 표시되지 않으면 위의 ‘뉴스레터 원문 보기’를 눌러주세요.';
    $('readerMedia').append(hint);
    $('readerReflection').innerHTML = `<strong>독서와 연결하기 · 멤버십 질문</strong><p>${esc(item.question || '이 글에서 내 삶이나 브랜드에 적용하고 싶은 한 가지는 무엇인가요? 오늘 읽은 책의 문장과 함께 생각해 보세요.')}</p>`;
    syncReaderSave();
    const siblings = filter === 'saved' ? all().filter(x => saved.has(x.id)) : item.type === 'videos' ? videos : columns;
    $('readerNext').hidden = siblings.length < 2;
    if (!$('contentReader').open) $('contentReader').showModal();
    document.body.classList.add('content-reader-open');
    document.querySelector('.reader-scroll').scrollTop = 0;
  }
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
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; render(); }));
  $('contentStatus').addEventListener('click', e => { if (e.target.id === 'retryColumns') load(); });
  $('readerClose').addEventListener('click', () => $('contentReader').close());
  $('contentReader').addEventListener('close', () => { $('readerMedia').replaceChildren(); document.body.classList.remove('content-reader-open'); });
  $('readerSave').addEventListener('click', () => { if (active) toggleSave(active.id); });
  $('readerNext').addEventListener('click', () => {
    const siblings = filter === 'saved' ? all().filter(x => saved.has(x.id)) : active.type === 'videos' ? videos : columns;
    if (siblings.length) openItem(siblings[(siblings.findIndex(x => x.id === active.id) + 1) % siblings.length].id);
  });
  async function load() {
    loading = true; render();
    try {
      const response = await fetch('/.netlify/functions/content-library', { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw Error('Content unavailable');
      const data = await response.json();
      for (const update of data.videos || []) { const video = videos.find(x => x.id === update.id); if (video && typeof update.title === 'string') video.title = update.title; }
      const safe = (data.columns || []).filter(x => { try { const u = new URL(x.url); const pagePost = u.origin === 'https://personalmakers.stibee.com' && /^\/p\/[^/?#]+\/?$/.test(u.pathname);
        const sharedEmail = u.origin === 'https://stibee.com' && /^\/api\/v1\.0\/emails\/share\/[^/?#]+$/.test(u.pathname);
        return (pagePost || sharedEmail) && typeof x.title === 'string'; } catch { return false; } });
      if (safe.length) columns = safe.map(x => ({ ...x, type: 'columns', category: 'NEWSLETTER · 칼럼', date: String(x.date || '').slice(0, 32) }));
      failed = !data.archiveAvailable;
    } catch { failed = true; }
    loading = false; render();
  }
  render(); load();
})();
