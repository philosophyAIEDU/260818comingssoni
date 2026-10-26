/* 공지·안내 탭의 "커밍쏜의 추천 콘텐츠" 카드 — 최신 영상과 최신 칼럼 한 편씩을 보여 주고, 누르면 그 콘텐츠가 바로 열린다.
 * 목록은 자료실과 같은 함수(CDN 캐시)에서 받는다. 못 받으면 아래 두 버튼만 남는다. */
(() => {
  const box = document.getElementById('contentInviteLatest');
  if (!box || !window.fetch) return;
  const prettyDate = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${+m[2]}월 ${+m[3]}일` : ''; };
  function row(kind, label, title, meta, href, thumb) {
    const a = document.createElement('a');
    a.className = 'invite-latest ' + kind;
    a.href = href;
    if (thumb) {
      const img = document.createElement('img');
      img.src = thumb; img.alt = ''; img.loading = 'lazy'; img.width = 96; img.height = 54;
      img.addEventListener('error', () => img.remove());
      a.append(img);
    } else {
      const icon = document.createElement('span'); icon.className = 'invite-latest-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = '✉';
      a.append(icon);
    }
    const text = document.createElement('span'); text.className = 'invite-latest-text';
    const small = document.createElement('small'); small.textContent = label + (meta ? ' · ' + meta : '');
    const strong = document.createElement('strong'); strong.textContent = title;
    text.append(small, strong);
    a.append(text);
    return a;
  }
  fetch('/.netlify/functions/content-library', { cache: 'no-cache', signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined })
    .then((r) => (r.ok ? r.json() : Promise.reject(Error('unavailable'))))
    .then((data) => {
      const rows = [];
      const video = (data.videos || []).find((v) => v && /^[\w-]{11}$/.test(v.id) && typeof v.title === 'string');
      if (video) rows.push(row('video', data.videoSource === 'latest' ? '최신 영상' : '추천 영상', video.title, prettyDate(video.published),
        'content.html#open=' + encodeURIComponent(video.id), `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`));
      const column = (data.columns || []).find((c) => c && typeof c.title === 'string' && typeof c.id === 'string' && /^https:\/\/(personalmakers\.)?stibee\.com\//.test(c.url));
      if (column) rows.push(row('column', '최신 칼럼', column.title, prettyDate(column.date), 'content.html#open=' + encodeURIComponent(column.id)));
      if (!rows.length) return;
      box.replaceChildren(...rows);
      box.hidden = false;
    })
    .catch(() => { /* 버튼만으로도 들어갈 수 있다 */ });
})();
