/* 화면 이동 — 휴대폰 하단 탭 · 전체 메뉴(js/sidenav.js) · 주소(#…)를 한 곳에서 맞춘다.
 *
 * 화면 내용과 동작은 전부 js/app.js가 그대로 맡고, 이 파일은 "지금 어느 자리(route)를 보여 줄지"만 정한다.
 *  - 휴대폰·PC 모두 다섯 묶음(.pane) 중 하나만 보인다 — 메뉴 하나가 화면 하나(위아래로 오가지 않는다).
 *    자리를 고르면 그 묶음을 열고 맨 위에서 시작한다(#rules처럼 묶음 안 카드를 가리키면 그 카드로).
 *
 * 자리(route) → 묶음(pane) · 카드
 *   #certify(주소 없음과 같다) 오늘의 인증 · #me 나의 현황 · #feed 인증 피드 · #fame 명예의 전당
 *   #overall 전체 진행현황(카드가 보일 때만) · #info 이번 책·일정 · #rules 안내·규칙
 * 메뉴·탭으로 옮기면 주소가 쌓여서(pushState) 뒤로 가기로 앞 화면·선택 상태로 돌아간다. 새로고침·직접 접속도 그 자리.
 * 인증 폼은 같은 페이지 안에서 옮기기만 하므로 쓰던 글이 그대로 남는다(임시 저장도 app.js가 계속 한다). */
(function () {
  const ROUTES = {
    certify: { pane: 'certify', target: 'certifyCard', top: true },
    me: { pane: 'me', target: 'whoCard', top: true },
    feed: { pane: 'feed', target: 'feedCard', top: true },
    fame: { pane: 'fame', target: 'fameCard', top: true },
    overall: { pane: 'fame', target: 'overallCard' },
    info: { pane: 'info', target: 'bookCard', top: true },
    rules: { pane: 'info', target: 'rulesCard' }
  };
  // 휴대폰 하단 탭이 고른 묶음 → 그 묶음의 대표 자리
  const PANE_ROUTE = { certify: 'certify', me: 'me', feed: 'feed', fame: 'fame', info: 'info' };
  const mq = window.matchMedia('(max-width: 899px)');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const $ = (id) => document.getElementById(id);
  let current = 'certify';      // 지금 묶음(pane)
  let currentRoute = 'certify'; // 지금 자리(route)

  const isMobile = () => mq.matches;

  /** 이 자리를 지금 보여 줄 수 있는지 — 숨긴 카드(지난 시즌 둘러보기·참여자에게 감춘 진행현황)에는 보내지 않는다 */
  function available(name) {
    const r = ROUTES[name];
    if (!r) return false;
    const el = $(r.target);
    if (!el) return false;
    const browse = document.body.classList.contains('season-browse');
    if (browse && ['certify', 'me', 'rules', 'overall'].includes(name)) return false;
    for (let n = el; n && n !== document.body; n = n.parentElement) if (n.hidden) return false;
    return true;
  }

  function hashFor(name) {
    // 인증 자리는 예전처럼 주소 없이(하단 탭) — 메뉴에서 고르면 #certify로 남겨 넓은 화면 새로고침에도 그 자리
    return name === 'certify' ? '' : '#' + name;
  }

  function scrollToTarget(name, smooth) {
    const r = ROUTES[name];
    const el = r && $(r.target);
    if (!el) return;
    if (r.top) { window.scrollTo(0, 0); return; }
    el.scrollIntoView({ block: 'start', behavior: smooth && !reduce.matches ? 'smooth' : 'auto' });
  }

  /** 자리로 옮긴다. opts: { push(주소 쌓기, 기본 true) · history:false(주소 그대로) · hash(쓸 주소) · scroll(false면 그대로) · smooth · focus } */
  function go(name, opts) {
    opts = opts || {};
    if (!ROUTES[name] || !available(name)) {
      // 감춘 카드면 같은 묶음의 대표 자리로(예: 전체 진행현황 → 명예의 전당), 그것도 없으면 인증 → 책 소개
      const same = ROUTES[name] && PANE_ROUTE[ROUTES[name].pane];
      name = same && available(same) ? same : available('certify') ? 'certify' : 'info';
    }
    const r = ROUTES[name];
    current = r.pane;
    currentRoute = name;
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === r.pane));
    document.querySelectorAll('#tabbar [data-go]').forEach((b) => {
      if (b.dataset.go === r.pane) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    document.body.dataset.tab = r.pane;
    if (opts.history !== false) {
      const want = opts.hash != null ? opts.hash : hashFor(name);
      const url = location.pathname + location.search + want;
      if (url !== location.pathname + location.search + location.hash) {
        try { history[opts.push === false ? 'replaceState' : 'pushState']({ route: name }, '', url); } catch (e) { /* 주소를 못 바꿔도 화면 전환은 된다 */ }
      }
    }
    if (opts.scroll !== false) scrollToTarget(name, opts.smooth);
    if (opts.focus) {
      const target = name === 'me' && $('myCard') && $('myCard').hidden ? $('meWho') : $(r.target);
      if (target) {
        if (!target.matches('a,button,input,select,textarea,[tabindex]')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
    }
    // 숨어 있던 탭이 막 보이게 됐다 — 긴 글 [더 보기] 같은 "보이는 폭으로 재는" 일을 다시 하라고 알린다
    document.dispatchEvent(new CustomEvent('cs:tab', { detail: { tab: r.pane, route: name } }));
    return name;
  }

  /** 예전 이름 — 하단 탭·인증 직후 바로가기가 묶음 이름으로 부른다 */
  function activate(pane, opts) {
    opts = opts || {};
    return go(PANE_ROUTE[pane] || 'certify', { push: opts.push, history: opts.push === false ? false : undefined, scroll: opts.keepScroll ? false : true });
  }

  function fromHash() {
    const h = (location.hash || '').replace('#', '');
    return ROUTES[h] ? h : 'certify';
  }

  // 주소가 바뀌었을 때(뒤로·앞으로 가기, 직접 #… 입력) — 화면만 맞추고 주소는 그대로 둔다
  function syncFromUrl() {
    const name = fromHash();
    const shown = go(name, { history: false });
    if (shown !== name) go(shown, { push: false }); // 숨긴 자리였으면 보이는 자리 주소로 바로잡기
  }

  // [내 현황] 빈 화면 안내 — 이름을 고르면 app.js가 #myCard를 연다
  function syncMyEmpty() {
    const card = $('myCard');
    const empty = $('myEmpty');
    if (!card || !empty) return;
    empty.hidden = !card.hidden;
  }

  function init() {
    if (!document.querySelector('.pane')) return;
    document.body.classList.add('has-tabs');
    document.querySelectorAll('#tabbar [data-go]').forEach((b) => {
      b.addEventListener('click', () => activate(b.dataset.go));
    });
    let last = location.href;
    const onNav = () => { if (location.href === last) return; last = location.href; syncFromUrl(); };
    window.addEventListener('popstate', onNav);
    window.addEventListener('hashchange', onNav);
    const keepLast = () => { last = location.href; };
    document.addEventListener('cs:tab', keepLast);

    // 처음 열 때: 주소의 자리(주소가 없으면 오늘의 인증)
    const first = fromHash();
    const shown = go(first, { history: false, scroll: false });
    if (shown !== first) go(shown, { push: false, scroll: false });
    if (location.hash && ROUTES[location.hash.slice(1)]) {
      // 카드 위 글·이미지가 자리를 잡은 뒤 한 번 더 맞춘다(새로고침·직접 접속)
      requestAnimationFrame(() => scrollToTarget(currentRoute, false));
      window.addEventListener('load', () => scrollToTarget(currentRoute, false), { once: true });
    }

    const card = $('myCard');
    if (card) {
      new MutationObserver(syncMyEmpty).observe(card, { attributes: true, attributeFilter: ['hidden'] });
      syncMyEmpty();
    }
    // 인증 직후 바로가기 — 피드·내 현황은 다른 화면에 있으니 길을 열어 준다
    document.addEventListener('cs:submitted', () => {
      const box = $('formMsg');
      if (!box) return;
      const old = box.querySelector('.quick-go');
      if (old) old.remove();
      const wrap = document.createElement('div');
      wrap.className = 'quick-go';
      wrap.innerHTML = '<button type="button" class="primary qg-card" data-card>오늘 인증 카드 만들기</button>'
        + '<button type="button" data-go="feed">다른 분들 글 보기</button>'
        + '<button type="button" data-go="me">내 현황 보기</button>'
        + '<a href="content.html">커밍쏜의 추천 콘텐츠 보기 →</a>';
      wrap.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => activate(b.dataset.go)));
      // 인증 직후가 자랑하고 싶은 순간 — 내 현황으로 넘어가 바로 인증 카드를 띄운다
      wrap.querySelector('[data-card]').addEventListener('click', () => {
        activate('me');
        setTimeout(() => { const b = $('myCardShare'); if (b) b.click(); }, 150);
      });
      box.appendChild(wrap);
      box.scrollIntoView({ block: 'center' });
    });
  }

  window.CS = window.CS || {};
  window.CS.Tabs = {
    activate, go, available, isMobile, ROUTES,
    current: () => current, route: () => currentRoute
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
