/* 전체 메뉴 — 넓은 화면(900px 이상)은 왼쪽 고정 사이드바, 휴대폰은 머리의 ☰ 버튼으로 여는 왼쪽 서랍.
 * 인증 화면(index.html)과 추천 콘텐츠 화면(content.html)에 같은 메뉴를 그린다.
 *
 *  - 독서 활동 메뉴는 js/tabs.js의 자리(route)로 바로 간다. 콘텐츠 화면에서는 index.html#자리 로 넘어간다.
 *  - 추천 콘텐츠 메뉴는 content.html#videos · #columns · #saved (콘텐츠 화면에서는 그 탭을 바로 연다).
 *  - 지금 보이지 않는 카드(지난 시즌 둘러보기에서 감춘 인증·내 현황·규칙, 참여자에게 감춘 전체 진행현황)는 메뉴에서도 뺀다.
 *  - 지난 시즌을 보는 중(?season=…)이면 메뉴 주소에도 그대로 붙여 시즌이 풀리지 않게 한다.
 *  - 접기 상태는 이 기기에만 기억한다(localStorage, 못 쓰면 매번 펼친 채). */
(function () {
  const CS = window.CS || {};
  const page = document.body.classList.contains('content-app') ? 'content' : 'index';
  const desktop = window.matchMedia('(min-width: 900px)');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const COLLAPSE_KEY = 'pm.sidenav.collapsed';
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 저장 못 해도 메뉴는 된다 */ } }
  };

  // 한 가지 스타일(24px 선 아이콘, 1.9 두께)로 통일
  const P = {
    certify: '<path d="M12 20h8"/><path d="M16.4 3.6a2 2 0 0 1 2.9 2.9L7.6 18.2 4 19l.8-3.6z"/>',
    me: '<circle cx="12" cy="8.2" r="4"/><path d="M4.4 20.6c1.1-3.7 4-5.8 7.6-5.8s6.5 2.1 7.6 5.8"/>',
    feed: '<path d="M3.8 10.4 12 3.6l8.2 6.8v9a1.4 1.4 0 0 1-1.4 1.4h-4.3v-5.6a2.5 2.5 0 0 0-5 0v5.6H5.2a1.4 1.4 0 0 1-1.4-1.4z"/>',
    fame: '<path d="M7.5 3.8h9v5.9a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 5.8H4.6a3.2 3.2 0 0 0 3.4 4.6"/><path d="M16.5 5.8h2.9a3.2 3.2 0 0 1-3.4 4.6"/><path d="M12 14.2v3.6"/><path d="M8.2 20.6h7.6"/>',
    overall: '<path d="M4 20h16"/><path d="M7 16v-5"/><path d="M12 16V6"/><path d="M17 16v-8"/>',
    videos: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9.2 5 2.8-5 2.8z"/>',
    columns: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.8 6.5 8.2 6.3 8.2-6.3"/>',
    saved: '<path d="M6.5 3.8h11v16.4L12 16.3l-5.5 3.9z"/>',
    info: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/>',
    rules: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2"/><path d="M12 7.6v.2"/>',
    admin: '<path d="M12 3.6 19 6.4v5.2c0 4.3-3 7.4-7 8.8-4-1.4-7-4.5-7-8.8V6.4z"/><path d="m9.2 12 2 2 3.6-3.8"/>',
    menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
    close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
    collapse: '<path d="M14.5 6.5 9 12l5.5 5.5"/><path d="M4.5 4.5v15"/>',
    prev: '<path d="M14.5 6.5 9 12l5.5 5.5"/>',
    next: '<path d="M9.5 6.5 15 12l-5.5 5.5"/>'
  };
  const icon = (k) => `<svg class="sn-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${P[k]}</svg>`;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 지난 시즌을 보는 중이면 메뉴 주소에도 시즌을 붙인다
  const seasonParam = new URLSearchParams(location.search).get('season') || '';
  const q = seasonParam ? `?season=${encodeURIComponent(seasonParam)}` : '';
  const browse = !!(CS.SEASON && CS.seasonLocked && CS.seasonLocked(CS.SEASON));

  const GROUPS = [
    { title: '독서 활동', items: [
      { id: 'certify', label: '오늘의 인증', route: 'certify', primary: true },
      { id: 'me', label: '나의 현황', route: 'me' },
      { id: 'feed', label: '인증 피드', route: 'feed' },
      { id: 'fame', label: '명예의 전당', route: 'fame' },
      { id: 'overall', label: '전체 진행현황', route: 'overall' }
    ] },
    { title: '추천 콘텐츠', items: [
      { id: 'videos', label: '추천 유튜브', filter: 'videos' },
      { id: 'columns', label: '뉴스레터 칼럼', filter: 'columns' },
      { id: 'saved', label: '보관함', filter: 'saved' }
    ] },
    { title: '멤버십', items: [
      { id: 'info', label: '멤버십 안내', route: 'info' } // 이번 책·일정 + 안내·규칙을 한 화면에(#rules 주소는 그 화면의 규칙 카드로)
    ] }
  ];

  const hrefOf = (it) => (it.filter ? `content.html${q}#${it.filter}` : `index.html${q}${it.route === 'certify' ? '' : '#' + it.route}`);

  /** 이 메뉴가 지금 갈 수 있는 곳인지 — 인증 화면은 실제 카드 상태로, 콘텐츠 화면은 같은 규칙(시즌·감춘 카드)으로 */
  function itemAvailable(it) {
    if (it.filter) return true;
    if (page === 'index' && CS.Tabs) return CS.Tabs.available(it.route);
    if (it.route === 'overall') return false; // 참여자 화면에서는 감춘 카드(운영진 화면에서 본다)
    if (browse && ['certify', 'me'].includes(it.route)) return false;
    return true;
  }

  function seasonLine() {
    const cfg = CS.CONFIG;
    if (!cfg || !cfg.book) return '';
    return `<p class="sn-season"><span class="sn-season-label">${esc(cfg.label || '')}${browse ? ' · 지난 시즌' : ''}</span>`
      + `<span class="sn-book">『${esc(cfg.book.name)}』</span></p>`;
  }

  /** 이전·다음 시즌 화살표 — 인증 화면은 책 소개 카드의 화살표(운영진 공개 설정까지 반영)를 그대로 따라가고,
   *  콘텐츠 화면은 설정의 볼 수 있는 시즌(browsable·지금 시즌)으로 계산한다 */
  function seasonLinks() {
    if (page === 'index') {
      const a = document.getElementById('shelfPrev'); const b = document.getElementById('shelfNext');
      return { prev: a && !a.hidden && a.getAttribute('href') ? { href: a.getAttribute('href'), label: a.getAttribute('aria-label') } : null,
        next: b && !b.hidden && b.getAttribute('href') ? { href: b.getAttribute('href'), label: b.getAttribute('aria-label') } : null };
    }
    if (!CS.SEASONS || !CS.pickSeason) return {};
    const now = CS.seasonNowKST();
    const auto = CS.pickSeason(now);
    const list = CS.SEASONS.filter((x) => (!x.startsAt || x.startsAt <= now) && (x.id === CS.SEASON.id || x.id === auto.id || x.browsable));
    const i = list.findIndex((x) => x.id === CS.SEASON.id);
    const link = (t, dir) => t && { href: (t.id === auto.id ? 'index.html' : `index.html?season=${encodeURIComponent(t.id)}`) + '#info',
      label: `${dir === 'prev' ? '이전' : '다음'} 시즌 책 『${t.book.name}』 보기` };
    return i < 0 ? {} : { prev: link(list[i - 1], 'prev'), next: link(list[i + 1], 'next') };
  }

  function paintSeasonNav(nav) {
    const box = nav.querySelector('.sn-season-nav');
    if (!box) return;
    const { prev, next } = seasonLinks();
    const a = (l, dir) => (l
      ? `<a class="sn-sbtn" href="${esc(l.href)}" aria-label="${esc(l.label)}" title="${esc(l.label)}">${icon(dir)}</a>`
      : `<span class="sn-sbtn is-off" aria-hidden="true">${icon(dir)}</span>`);
    box.innerHTML = a(prev, 'prev') + a(next, 'next');
    box.hidden = !prev && !next;
  }

  function build() {
    const cfg = CS.CONFIG || {};
    const nav = document.createElement('aside');
    nav.className = 'sidenav';
    nav.id = 'sidenav';
    nav.setAttribute('aria-label', '전체 메뉴');
    nav.innerHTML = `
      <div class="sn-head">
        <a class="sn-brand" href="index.html${q}" aria-label="${esc(cfg.title || '퍼스널메이커스 독서 멤버십')} 홈">
          <img src="logo-header.jpg" alt="" width="36" height="36">
          <span class="sn-brand-name">${esc(cfg.title || '퍼스널메이커스 독서 멤버십')}</span>
        </a>
        <button type="button" class="sn-close" aria-label="메뉴 닫기">${icon('close')}</button>
      </div>
      <div class="sn-season-row">${seasonLine()}<div class="sn-season-nav" hidden></div></div>
      <nav class="sn-scroll" aria-label="메뉴">
        ${GROUPS.map((g, gi) => `<div class="sn-group" role="group" aria-labelledby="snG${gi}">
          <h2 class="sn-gtitle" id="snG${gi}">${esc(g.title)}</h2>
          <ul>${g.items.map((it) => `<li data-item="${it.id}"><a class="sn-link${it.primary ? ' is-primary' : ''}" href="${hrefOf(it)}"
            data-sn-route="${it.route || ''}" data-sn-filter="${it.filter || ''}" data-tip="${esc(it.label)}">${icon(it.id)}<span class="sn-label">${esc(it.label)}${it.id === 'saved' ? ' <span class="sn-count" data-saved-count></span>' : ''}</span></a></li>`).join('')}</ul>
        </div>`).join('')}
      </nav>
      <div class="sn-foot">
        <a class="sn-link" href="admin.html" data-tip="운영진">${icon('admin')}<span class="sn-label">운영진</span></a>
        <button type="button" class="sn-collapse" aria-expanded="true" aria-controls="sidenav" data-tip="메뉴 접기">${icon('collapse')}<span class="sn-label">메뉴 접기</span></button>
      </div>`;
    return nav;
  }

  function init() {
    const nav = build();
    document.body.prepend(nav);
    const backdrop = document.createElement('div');
    backdrop.className = 'sidenav-backdrop';
    backdrop.hidden = true;
    document.body.insertBefore(backdrop, nav.nextSibling);
    document.body.classList.add('has-sidenav');

    // 머리의 ☰ — 휴대폰에서만 보인다
    const top = document.querySelector('header.top .top-in');
    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'sn-menu-btn';
    menuBtn.setAttribute('aria-label', '전체 메뉴 열기');
    menuBtn.setAttribute('aria-controls', 'sidenav');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.innerHTML = icon('menu');
    if (top) top.prepend(menuBtn);

    const links = [...nav.querySelectorAll('.sn-scroll .sn-link')];
    const collapseBtn = nav.querySelector('.sn-collapse');

    /* ── 지금 자리 표시(aria-current) ── */
    let activeId = '';
    function setActive(id) {
      activeId = id;
      links.forEach((a) => {
        const on = a.parentElement.dataset.item === id;
        if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      });
    }
    function refreshAvailability() {
      GROUPS.forEach((g) => g.items.forEach((it) => {
        const li = nav.querySelector(`[data-item="${it.id}"]`);
        if (li) li.hidden = !itemAvailable(it);
      }));
    }

    /* ── 접기(넓은 화면) ── */
    function applyCollapsed(on) {
      document.body.classList.toggle('sidenav-collapsed', on);
      collapseBtn.setAttribute('aria-expanded', String(!on));
      const t = on ? '메뉴 펼치기' : '메뉴 접기';
      collapseBtn.setAttribute('aria-label', t);
      collapseBtn.dataset.tip = t;
      collapseBtn.querySelector('.sn-label').textContent = t;
    }
    applyCollapsed(store.get(COLLAPSE_KEY) === '1');
    collapseBtn.addEventListener('click', () => {
      const on = !document.body.classList.contains('sidenav-collapsed');
      applyCollapsed(on);
      store.set(COLLAPSE_KEY, on ? '1' : '0');
    });

    /* 접힌 메뉴의 이름표 — 목록이 스크롤 상자라 CSS ::after는 잘린다. 하나를 화면에 띄워 옆에 붙인다 */
    const tip = document.createElement('div');
    tip.className = 'sn-tip';
    tip.setAttribute('aria-hidden', 'true');
    tip.hidden = true;
    document.body.appendChild(tip);
    const showTip = (el) => {
      if (!desktop.matches || !document.body.classList.contains('sidenav-collapsed')) return;
      const r = el.getBoundingClientRect();
      tip.textContent = el.dataset.tip || '';
      tip.hidden = false;
      tip.style.left = `${r.right + 10}px`;
      tip.style.top = `${r.top + r.height / 2 - tip.offsetHeight / 2}px`;
    };
    const hideTip = () => { tip.hidden = true; };
    nav.querySelectorAll('[data-tip]').forEach((el) => {
      el.addEventListener('mouseenter', () => showTip(el));
      el.addEventListener('focus', () => showTip(el));
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('blur', hideTip);
    });
    nav.querySelector('.sn-scroll').addEventListener('scroll', hideTip, { passive: true });
    collapseBtn.addEventListener('click', hideTip);

    /* ── 서랍(휴대폰) ── */
    let lastScrollY = 0;
    const isOpen = () => nav.classList.contains('open');
    function focusables() {
      return [...nav.querySelectorAll('a[href], button')].filter((el) => !el.closest('[hidden]') && el.getClientRects().length);
    }
    function openDrawer() {
      if (desktop.matches || isOpen()) return;
      lastScrollY = window.scrollY;
      nav.classList.add('open');
      backdrop.hidden = false;
      document.documentElement.classList.add('sidenav-lock');
      document.body.style.top = `-${lastScrollY}px`;
      menuBtn.setAttribute('aria-expanded', 'true');
      nav.setAttribute('role', 'dialog');
      nav.setAttribute('aria-modal', 'true');
      const cur = nav.querySelector('.sn-link[aria-current="page"]');
      (cur && cur.getClientRects().length ? cur : nav.querySelector('.sn-close')).focus();
    }
    function closeDrawer(opts) {
      if (!isOpen()) return;
      nav.classList.remove('open');
      backdrop.hidden = true;
      document.documentElement.classList.remove('sidenav-lock');
      document.body.style.top = '';
      if (!(opts && opts.keepScroll === false)) window.scrollTo(0, lastScrollY);
      menuBtn.setAttribute('aria-expanded', 'false');
      nav.removeAttribute('role');
      nav.removeAttribute('aria-modal');
      if (!(opts && opts.noFocus)) menuBtn.focus();
    }
    menuBtn.addEventListener('click', openDrawer);
    nav.querySelector('.sn-close').addEventListener('click', () => closeDrawer());
    backdrop.addEventListener('click', () => closeDrawer());
    document.addEventListener('keydown', (e) => {
      if (!isOpen()) return;
      if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); return; }
      if (e.key === 'Tab') { // 서랍 안에서만 돈다
        const f = focusables();
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    desktop.addEventListener('change', () => { if (desktop.matches) closeDrawer({ noFocus: true }); });

    /* ── 메뉴 누르기 ── */
    links.forEach((a) => a.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const route = a.dataset.snRoute; const filter = a.dataset.snFilter;
      const wasDrawer = isOpen();
      if (page === 'index' && route && CS.Tabs) {
        e.preventDefault();
        if (wasDrawer) closeDrawer({ noFocus: true, keepScroll: false });
        setActive(a.parentElement.dataset.item);
        CS.Tabs.go(route, { hash: route === 'certify' ? '' : '#' + route, focus: !wasDrawer });
        if (wasDrawer) menuBtn.focus({ preventScroll: true });
      } else if (page === 'content' && filter) {
        e.preventDefault();
        if (wasDrawer) closeDrawer({ noFocus: true });
        const reader = document.getElementById('contentReader');
        if (reader && reader.open) reader.close();
        if (location.hash !== '#' + filter) location.hash = filter; // 주소가 쌓여 뒤로 가기로 앞 탭에 돌아온다
        setActive(filter);
        const tabs = document.querySelector('.content-tabs');
        if (tabs) tabs.scrollIntoView({ block: 'start', behavior: reduce.matches ? 'auto' : 'smooth' });
        if (wasDrawer) menuBtn.focus({ preventScroll: true });
      } else if (wasDrawer) {
        closeDrawer({ noFocus: true });
      }
    }));

    /* ── 화면과 맞추기 ── */
    if (page === 'index') {
      document.addEventListener('cs:tab', (e) => {
        refreshAvailability();
        if (e.detail && e.detail.route) setActive(e.detail.route === 'rules' ? 'info' : e.detail.route);
      });
      if (CS.Tabs) setActive(CS.Tabs.route() === 'rules' ? 'info' : CS.Tabs.route());
      // 지난 시즌 둘러보기·카드 숨김이 늦게 정해져도(시즌 잠금 확인은 비동기) 메뉴가 따라간다
      new MutationObserver(refreshAvailability).observe(document.body, { attributes: true, attributeFilter: ['class'] });
      ['overallCard', 'certifyCard', 'rulesCard'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) new MutationObserver(refreshAvailability).observe(el, { attributes: true, attributeFilter: ['hidden'] });
      });
      // 책 소개 카드의 시즌 화살표가 그려지면 메뉴의 시즌 화살표도 같은 곳으로
      ['shelfPrev', 'shelfNext'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) new MutationObserver(() => paintSeasonNav(nav)).observe(el, { attributes: true, attributeFilter: ['hidden', 'href'] });
      });

    } else {
      const fromHash = () => {
        const h = (location.hash || '').slice(1);
        return ['videos', 'columns', 'saved'].includes(h) ? h : (h.startsWith('open=') ? activeId || 'videos' : 'videos');
      };
      setActive(fromHash());
      window.addEventListener('hashchange', () => setActive(fromHash()));
      document.addEventListener('cs:content-filter', (e) => { if (e.detail && e.detail.filter) setActive(e.detail.filter); });
      const count = document.getElementById('savedCount');
      const mirror = () => { const c = nav.querySelector('[data-saved-count]'); if (c && count) c.textContent = count.textContent; };
      if (count) { new MutationObserver(mirror).observe(count, { childList: true, characterData: true, subtree: true }); mirror(); }
    }
    refreshAvailability();
    paintSeasonNav(nav);
  }

  window.CS = window.CS || {};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
