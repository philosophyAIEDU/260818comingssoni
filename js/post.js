/* 남의 인증글을 "읽기 좋게" 보여 주는 공용 조각 — 인증 피드(js/app.js)와 전체 보기(js/feed-all.js)가 같이 쓴다.
 *
 * 스레드(Threads)처럼 한 글이 화면 폭을 통째로 쓴다:
 *   [동그란 이름 머리글자] 이름 · 🔥 · 몇 분 전
 *   ┃ 인상 깊은 내용(책 문장 — 왼쪽 선 하나로 '인용'임을 알린다)
 *   느낀 점(그 사람의 말 — 본문색 그대로)
 *   (길면 여덟 줄쯤에서 접고 [더 보기])
 *   👍 3   ⧉
 * 예전에는 버튼단이 오른쪽에 세로로 서 있어 본문이 화면의 절반 남짓한 폭에 갇혔고,
 * 느낀 점은 한 번 더 눌러야 보였다. 이제 버튼은 글 아래 한 줄로 내려가고, 느낀 점은 바로 보인다. */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  // 머리글자 동그라미 색 — 이름마다 늘 같은 색(눈으로 사람을 빨리 찾게)
  const AVA = ['#e8eefc', '#fdf0e3', '#e6f6ee', '#f6e9f6', '#eef2e3', '#e7f3f8', '#fbe9ea', '#efeaf9'];
  const AVA_INK = ['#173fa7', '#b25a00', '#137a46', '#8a2f8a', '#56661a', '#0f6a8a', '#b4232f', '#5a3fb0'];
  function hue(name) {
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return h % AVA.length;
  }
  function avatar(name) {
    const clean = String(name || '').replace(/[(（].*$/, '').trim() || String(name || '?');
    const i = hue(clean);
    return `<span class="post-ava" aria-hidden="true" style="--ava:${AVA[i]};--ava-ink:${AVA_INK[i]}">${esc([...clean][0] || '?')}</span>`;
  }

  /** 멤버가 이미 따옴표를 쳐서 올린 문장에 따옴표가 두 겹으로 붙지 않게 바깥 따옴표 한 겹을 걷어 낸다. */
  function stripQuotes(s) {
    const t = String(s == null ? '' : s).trim();
    const m = t.match(/^["“”'‘’「『](.*)["“”'‘’」』]$/s);
    return m && !/["“”]/.test(m[1]) ? m[1].trim() : t;
  }

  /** 오늘 올라온 글은 "12분 전"처럼, 하루가 넘으면 날짜·시각으로. */
  function when(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    if (diff >= 0 && diff < 60 * 1000) return '방금';
    if (diff >= 0 && diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}분 전`;
    if (diff >= 0 && diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}시간 전`;
    return CS.U.stampLabel(iso);
  }

  /** 본문(인상 깊은 내용 + 느낀 점). id가 있으면 '더 보기'로 펼친 상태를 기억할 수 있다. */
  function body(s, open) {
    return `<div class="post-body${open ? ' open' : ''}" data-subid="${esc(s.id)}">
        <blockquote class="feed-quote">${esc(stripQuotes(s.sentence))}</blockquote>
        <p class="feed-reflect">${esc(s.reflection)}</p>
      </div>
      <button type="button" class="post-more" hidden>더 보기</button>`;
  }

  /**
   * 긴 글만 접고 [더 보기]를 붙인다. 화면에 보이는 폭으로 재야 해서, 숨은 탭(display:none)에
   * 있을 땐 건너뛰었다가 그 탭이 열릴 때(tabs.js의 'cs:tab') 다시 잰다.
   * openIds: 펼쳐 둔 글 id를 담는 Set — 피드가 2분마다 다시 그려져도 펼친 글은 펼친 채로 둔다.
   */
  function fit(container, openIds) {
    if (!container) return;
    container.querySelectorAll('.post-body').forEach((el) => {
      const btn = el.nextElementSibling;
      if (!btn || !btn.classList.contains('post-more')) return;
      if (!btn.dataset.bound) {
        btn.dataset.bound = '1';
        btn.addEventListener('click', () => {
          el.classList.add('open');
          el.classList.remove('clamp');
          btn.hidden = true;
          if (openIds) openIds.add(el.dataset.subid);
        });
      }
      if (el.classList.contains('open') || (openIds && openIds.has(el.dataset.subid))) {
        el.classList.add('open'); el.classList.remove('clamp'); btn.hidden = true;
        return;
      }
      if (!el.getClientRects().length) return; // 지금 안 보이는 탭 — 열릴 때 다시 잰다
      el.classList.add('clamp');
      // 한두 줄 넘치는 정도면 접지 않는다 — 그 몇 줄을 보려고 [더 보기]를 누르게 하는 건 손해
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 26;
      const over = el.scrollHeight > el.clientHeight + lh * 2.5;
      if (!over) el.classList.remove('clamp');
      btn.hidden = !over;
    });
  }

  window.CS = window.CS || {};
  window.CS.Post = { esc, avatar, stripQuotes, when, body, fit };
})();
