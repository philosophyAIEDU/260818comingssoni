/* 휴대폰 하단 탭 — 공지·안내 / 피드 / 인증(가운데 ＋) / 명예의 전당 / 내 현황
 *
 * 화면 내용과 동작은 전부 js/app.js가 그대로 맡고, 이 파일은 "지금 어느 묶음(pane)을 보여 줄지"만 정한다.
 * 넓은 화면(900px 이상)에서는 탭바를 숨기고 네 묶음을 위에서 아래로 이어서 보여 준다 —
 * 그래서 PC에서 쓰던 흐름과 기존 화면 테스트는 바뀌지 않는다.
 *
 * - 지금 탭은 주소의 #info · #feed · #fame · #me 로 남는다(인증 탭은 주소 없이)(새로고침·뒤로 가기에도 그 탭).
 * - 인증을 마치면(app.js의 'cs:submitted') 결과 문구 아래 "피드 보기 · 내 현황 보기" 바로가기를 띄운다.
 * - [내 현황]은 맨 위 "본인 확인하기"에서 이름을 고르고, 고르기 전에는 안내 한 줄(#myEmpty)만 보인다. */
(function () {
  const TABS = ['info', 'feed', 'certify', 'fame', 'me'];
  const mq = window.matchMedia('(max-width: 899px)');
  const $ = (id) => document.getElementById(id);
  let current = 'certify';

  const isMobile = () => mq.matches;

  function activate(name, opts) {
    if (!TABS.includes(name)) name = 'certify';
    current = name;
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
    document.querySelectorAll('#tabbar [data-go]').forEach((b) => {
      if (b.dataset.go === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    document.body.dataset.tab = name;
    if (!(opts && opts.push === false)) {
      const url = name === 'certify' ? location.pathname + location.search : `#${name}`;
      try { history.replaceState(null, '', url); } catch (e) { /* 주소를 못 바꿔도 탭 전환은 된다 */ }
    }
    if (isMobile() && !(opts && opts.keepScroll)) window.scrollTo(0, 0);
    // 숨어 있던 탭이 막 보이게 됐다 — 긴 글 [더 보기] 같은 "보이는 폭으로 재는" 일을 다시 하라고 알린다
    document.dispatchEvent(new CustomEvent('cs:tab', { detail: { tab: name } }));
  }

  function fromHash() {
    const h = (location.hash || '').replace('#', '');
    return TABS.includes(h) ? h : 'certify';
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
    window.addEventListener('hashchange', () => activate(fromHash(), { push: false }));
    activate(fromHash(), { push: false, keepScroll: true });

    const card = $('myCard');
    if (card) {
      new MutationObserver(syncMyEmpty).observe(card, { attributes: true, attributeFilter: ['hidden'] });
      syncMyEmpty();
    }
    // 인증 직후 바로가기 — 휴대폰에서는 아래 카드들이 다른 탭에 있으니 길을 열어 준다
    document.addEventListener('cs:submitted', () => {
      const box = $('formMsg');
      if (!box || !isMobile()) return;
      const old = box.querySelector('.quick-go');
      if (old) old.remove();
      const wrap = document.createElement('div');
      wrap.className = 'quick-go';
      wrap.innerHTML = '<button type="button" class="primary qg-card" data-card>오늘 인증 카드 만들기</button>'
        + '<button type="button" data-go="feed">다른 분들 글 보기</button>'
        + '<button type="button" data-go="me">내 현황 보기</button>';
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
  window.CS.Tabs = { activate, isMobile, current: () => current };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
