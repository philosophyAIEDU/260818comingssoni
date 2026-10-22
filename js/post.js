/* 남의 인증글을 "읽기 좋게" 보여 주는 공용 조각 — 인증 피드(js/app.js)와 전체 보기(js/feed-all.js)가 같이 쓴다.
 *
 * 스레드(Threads) 앱과 같은 짜임:
 *   (머리글자)  이름 🔥2  7시간
 *               ┌ 📖 혁명의 팡파르 ─────────┐
 *               │ 인상 깊은 내용(책 문장)      │   ← 스레드의 링크 미리보기 카드처럼 둥근 테두리 상자
 *               └──────────────────────────┘
 *               느낀 점(그 사람의 말)
 *               (길면 여덟 줄쯤에서 접고 [더 보기])
 *               👍 3    ⧉
 * 동그라미는 왼쪽 칸에만 있고, 이름·본문·버튼은 모두 그 오른쪽 한 줄(같은 왼쪽 선)에 맞춰 선다. */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  // 머리글자 동그라미 색 — 이름마다 늘 같은 색(눈으로 사람을 빨리 찾게). 초록 계열은 빼고 브랜드 블루와 어울리는 톤만
  const AVA = ['#e8eefc', '#fdf0e3', '#e6ecf5', '#f6e9f6', '#eceef2', '#e7f3f8', '#fbe9ea', '#efeaf9'];
  const AVA_INK = ['#173fa7', '#b25a00', '#2c4a7a', '#8a2f8a', '#4a5568', '#0f6a8a', '#b4232f', '#5a3fb0'];
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

  /** 스레드처럼 짧게 — 방금 · 12분 · 7시간 · 3일, 일주일이 넘으면 10/21. (정확한 시각은 title로) */
  function when(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    const diff = Date.now() - t;
    const M = 60 * 1000, H = 60 * M, D = 24 * H;
    if (diff >= 0 && diff < M) return '방금';
    if (diff >= 0 && diff < H) return `${Math.floor(diff / M)}분`;
    if (diff >= 0 && diff < D) return `${Math.floor(diff / H)}시간`;
    if (diff >= 0 && diff < 7 * D) return `${Math.floor(diff / D)}일`;
    return new Date(t).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' })
      .replace(/\.\s*/g, '/').replace(/\/$/, '');
  }

  /** 빈 줄로 나눈 문단은 스레드 앱처럼 반 줄 남짓만 띄운다(빈 줄을 통째로 두면 구멍처럼 벌어진다). */
  function paras(text) {
    return String(text == null ? '' : text).trim().split(/\n[ \t]*\n+/)
      .map((t) => `<p>${esc(t.trim())}</p>`).join('');
  }

  /** 본문(인상 깊은 내용 + 느낀 점). id가 있으면 '더 보기'로 펼친 상태를 기억할 수 있다. */
  function body(s, open) {
    const book = (CS.CONFIG && CS.CONFIG.book && CS.CONFIG.book.name) || '';
    // 처음부터 접힌 채로 그린다 — fit()이 접었다 재는 사이 화면 배치를 한 번 더 계산하지 않게
    return `<div class="post-body${open ? ' open' : ' clamp'}" data-subid="${esc(s.id)}">
        <figure class="post-quote">
          <figcaption class="quote-src">${book ? `『${esc(book)}』에서` : '인상 깊은 내용'}</figcaption>
          <blockquote class="feed-quote">${esc(stripQuotes(s.sentence))}</blockquote>
        </figure>
        <div class="feed-reflect">${paras(s.reflection)}</div>
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
    if (!container.getClientRects().length) return; // 지금 안 보이는 탭 — 열릴 때 다시 잰다
    // 이미 이 폭으로 잰 글은 다시 재지 않는다 — 탭을 옮길 때마다 글마다 높이를 다시 재느라 화면 전환이 굼떴다
    const w = String(container.clientWidth);
    const todo = [];
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
      if (el.dataset.fitW === w) return;
      todo.push({ el, btn });
    });
    if (!todo.length) return;
    // 쓰기(접기) → 읽기(높이) → 쓰기(결과)를 글마다 번갈아 하면 글 수만큼 화면 배치를 다시 계산한다.
    // 한꺼번에 접고, 한꺼번에 재고, 한꺼번에 반영한다(배치 계산 한 번).
    todo.forEach(({ el }) => el.classList.add('clamp'));
    const lh = parseFloat(getComputedStyle(todo[0].el).lineHeight) || 26;
    // 한두 줄 넘치는 정도면 접지 않는다 — 그 몇 줄을 보려고 [더 보기]를 누르게 하는 건 손해
    const over = todo.map(({ el }) => el.scrollHeight > el.clientHeight + lh * 2.5);
    todo.forEach(({ el, btn }, i) => {
      el.dataset.fitW = w;
      if (!over[i]) el.classList.remove('clamp');
      btn.hidden = !over[i];
    });
  }

  window.CS = window.CS || {};
  window.CS.Post = { esc, avatar, stripQuotes, when, body, fit };
})();
