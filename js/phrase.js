/* 고정 안내 문구를 '뜻 덩어리'로 줄바꿈 — 화면에 늘 떠 있는 안내·규칙·설명 문장에만 건다(멤버가 쓴 글에는 손대지 않는다).
 *
 * 브라우저는 띄어쓰기마다 줄을 바꿀 수 있어서 "28일 후 한 / 권의 나만의 핵심 요약본"처럼
 * 한 덩어리로 읽어야 할 말이 줄 끝에서 갈라졌다. 그래서
 *  1) 한 글자짜리 꾸밈말(한·두·몇·그·내 …)은 뒷말에, 한 글자짜리 매인이름씨(수·것·때·후 …)는 앞말에 붙여
 *     그 사이에서는 줄이 바뀌지 않게 하고(<span class="nb">로 감싼다),
 *  2) 짧은 굵은 글씨(핵심 문구)는 통째로 한 줄에 두고,
 *  3) 여러 문장으로 된 안내는 문장이 끝날 때마다 다음 줄에서 시작하게 한다(<br>).
 * 감싸기만 하고 글자는 그대로라 복사·읽기 프로그램·검색에는 아무 영향이 없다.
 * 안내 문구는 app.js가 그때그때 새로 채우므로, 바뀔 때마다 다시 손본다(MutationObserver). */
(function () {
  const TARGETS = [
    '.card > .hint', '.feed-card .hint', '.form-note', '.rule-key', '#ruleList li',
    '.field > label', '.intro-body .desc', '.intro-body .meta', '.intro-body .fineprint',
    '.note', '.my-empty .hint', '#myExportHint', '#myHint', '.prompt-box .muted', '.empty'
  ].join(',');
  // 문장마다 줄을 바꾸는 곳 — 여러 문장이 한 덩어리로 이어지던 안내들
  const SENTENCE_TARGETS = [
    '.card > .hint', '.feed-card .hint', '.form-note', '.rule-key', '#ruleList li',
    '.intro-body .desc', '.note', '.my-empty .hint', '#myExportHint'
  ].join(',');

  // 앞말에 붙는 한 글자 매인이름씨·단위 (할 수 / 읽은 것 / 28일 후 …)
  const GLUE_PREV = new Set('수 것 때 후 전 중 뒤 등 줄 듯 만 뿐 번 개 명 회 쪽 분 초 권 장 주 달 년 차 건 곳 데 바 채 대 간'.split(' '));
  const HANGUL1 = /^[가-힣]$/;
  const SENT_END = /[가-힣\d)][.!?]["'”’)\]]*$/;
  const SKIP = 'input, select, option, textarea, button, script, style, .nb, svg';

  function glueWords(text) {
    // 단어와 띄어쓰기를 번갈아 담은 배열 — 홀수 칸이 띄어쓰기
    const parts = text.split(/(\s+)/);
    const words = [];
    for (let i = 0; i < parts.length; i += 2) words.push(parts[i]);
    const join = []; // join[i] = i번째와 i+1번째 단어 사이를 붙일지
    for (let i = 0; i < words.length - 1; i++) {
      const a = words[i], b = words[i + 1];
      if (!a || !b || /\n/.test(parts[2 * i + 1])) { join.push(false); continue; }
      const aOne = HANGUL1.test(a) && !GLUE_PREV.has(a);
      const bPrev = HANGUL1.test(b) && GLUE_PREV.has(b);
      // "할 수 있다/없다"는 한 덩어리로
      const canDo = (a === '수' || a === '줄') && /^[있없]/.test(b);
      join.push(aOne || bPrev || canDo);
    }
    return { parts, words, join };
  }

  function processTextNode(node, withSentences) {
    const text = node.data;
    if (!/[가-힣]/.test(text) || !/\s/.test(text.trim())) return;
    const { parts, words, join } = glueWords(text);
    // 앞 조각(굵은 글씨 등)에 띄어쓰기 없이 바로 붙은 첫 글자는 토씨다 — 뒷말에 붙이지 않는다(앞에 붙이는 건 glueParticle)
    const prev = node.previousSibling;
    if (join.length && !/^\s/.test(text) && prev && prev.nodeType === 1) join[0] = false;
    const frag = document.createDocumentFragment();
    let changed = false;
    let i = 0;
    while (i < words.length) {
      // i부터 붙어 있는 단어 묶음 [i..j]
      let j = i;
      while (j < join.length && join[j]) j++;
      const chunk = parts.slice(2 * i, 2 * j + 1).join('');
      // 괄호 바로 뒤에 토씨가 붙은 낱말(미인증(X)으로, 「…」는)은 괄호에서 갈라지지 않게 통째로
      if (j > i || /[)\]」』][가-힣]/.test(chunk)) {
        const span = document.createElement('span');
        span.className = 'nb';
        span.textContent = chunk;
        frag.appendChild(span);
        changed = true;
      } else if (chunk) {
        frag.appendChild(document.createTextNode(chunk));
      }
      const sep = parts[2 * j + 1];
      if (sep !== undefined) {
        frag.appendChild(document.createTextNode(sep));
        // 문장 끝 + 뒤에 말이 더 있으면 다음 줄에서 시작 (띄어쓰기는 남겨 복사한 글이 그대로이게)
        // (이 조각의 마지막 문장 뒤에 굵은 글씨 같은 다른 조각이 이어져도 마찬가지)
        // 뒤에 오는 게 이모지뿐이면(…주세요! 💪) 같은 줄에 둔다
        const nextWord = words[j + 1];
        const more = (nextWord && /[가-힣A-Za-z0-9(]/.test(nextWord)) || (!nextWord && j + 1 === words.length - 1 && node.nextSibling);
        if (withSentences && SENT_END.test(words[j]) && more) {
          frag.appendChild(document.createElement('br'));
          changed = true;
        }
      }
      i = j + 1;
    }
    if (changed) node.replaceWith(frag);
  }

  /** 굵은 글씨로 끝난 문장(… <strong>없습니다.</strong> 다음 문장) 뒤에도 줄을 바꾼다 */
  function breakAfterInline(el) {
    el.querySelectorAll('strong, b').forEach((s) => {
      if (s.closest('.nb')) return;
      const t = s.textContent;
      if ([...t].length <= 16 && !/\s{2,}/.test(t)) s.classList.add('nb');
      if (!SENT_END.test(t.trim())) return;
      const next = s.nextSibling;
      if (!next || next.nodeType !== 3) return;
      const lead = next.data.match(/^\s+/);
      if (!lead) return;
      if (lead[0].length === next.data.length) {
        // 띄어쓰기만 든 조각 — 뒤에 말이 이어지면 그 뒤에서 줄을 바꾼다
        if (next.nextSibling) next.parentNode.insertBefore(document.createElement('br'), next.nextSibling);
      } else {
        next.data = next.data.slice(lead[0].length);
        next.parentNode.insertBefore(document.createTextNode(lead[0]), next);
        next.parentNode.insertBefore(document.createElement('br'), next);
      }
    });
  }

  /** 짧은 굵은 글씨 바로 뒤에 붙은 토씨(「…」는, 요약본이 …)가 줄 끝에서 떨어지지 않게 함께 묶는다 */
  function glueParticle(strong) {
    const next = strong.nextSibling;
    if (!next || next.nodeType !== 3) return;
    const m = next.data.match(/^[^\s]+/);
    if (!m) return;
    const wrap = document.createElement('span');
    wrap.className = 'nb';
    strong.parentNode.insertBefore(wrap, strong);
    wrap.appendChild(strong);
    wrap.appendChild(document.createTextNode(m[0]));
    next.data = next.data.slice(m[0].length);
  }

  function processEl(el) {
    const before = el.textContent;
    if (el.dataset.phrased === before) return;
    const withSentences = el.matches(SENTENCE_TARGETS);
    const nodes = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) nodes.push(n);
    nodes.forEach((n) => processTextNode(n, withSentences));
    if (withSentences) breakAfterInline(el);
    else el.querySelectorAll('strong, b').forEach((s) => { if ([...s.textContent].length <= 16) s.classList.add('nb'); });
    el.querySelectorAll('strong.nb, b.nb').forEach((s) => { if (!s.parentElement.classList.contains('nb')) glueParticle(s); });
    el.dataset.phrased = el.textContent;
  }

  let queued = false;
  function run() {
    queued = false;
    document.querySelectorAll(TARGETS).forEach((el) => {
      if (el.closest('.feed-item, .entry, .fame-entry')) return; // 멤버가 쓴 글은 그대로
      processEl(el);
    });
  }
  function schedule() {
    if (queued) return;
    queued = true;
    setTimeout(run, 60);
  }

  function init() {
    run();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  window.CS = window.CS || {};
  window.CS.Phrase = { run, glueWords };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
