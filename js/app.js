/* 참가자 인증 화면 */
(function () {
  const { CONFIG, U, Store } = CS;
  const $ = (id) => document.getElementById(id);

  const CELL_CLASS = { O: 'cell-o', X: 'cell-x', P: 'cell-p', '-': 'cell-none', '·': 'cell-off' };
  const DRAFT_KEY = `${CONFIG.storagePrefix}.draft`;
  const CLIENT_KEY = `${CONFIG.storagePrefix}.clientId`;
  const FEED_PAGE_SIZE = 20;

  let participants = [];
  let feedDate = U.today();
  let feedVisibleCount = FEED_PAGE_SIZE;
  let feedSort = 'likes'; // 'likes' 추천 많은순(기본) | 'recent' 최신순
  let feedSearch = '';    // 피드에서 찾을 이름(초성도 됨). 빈 값이면 전체.
  let currentPid = '';

  // 중복 추천 방지를 위해 로컬 고유 식별자 생성
  let clientId = localStorage.getItem(CLIENT_KEY);
  if (!clientId) {
    clientId = U.uid('cli');
    localStorage.setItem(CLIENT_KEY, clientId);
  }

  function msg(el, text, kind) {
    el.innerHTML = text ? `<div class="note ${kind || 'info'}">${text}</div>` : '';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* ── 헤더 / 배너 ─────────────────────── */
  function paintHeader() {
    $('brandTitle').textContent = CONFIG.title;
    $('kickN').textContent = CONFIG.kickoutThreshold;
    $('footRange').textContent =
      `${U.longLabel(CONFIG.startDate)} ~ ${U.longLabel(CONFIG.endDate)}`;

    const t = U.today();
    $('todayLabel').textContent = U.shortLabel(t);
    const idx = U.dayIndex(t);
    const total = U.challengeDates().length;
    $('dayLabel').textContent = idx ? `${idx} / ${total}일차` : `— / ${total}일차`;
  }

  function tickCountdown() {
    $('countdown').textContent = U.hhmmss(U.secondsToMidnight());
  }

  /* ── 배너: "오늘의 범위" — 오늘 회차뿐 아니라 ◀▶로 다른 날짜의 범위도 넘겨볼 수 있다 ── */
  let rangeDayIdx = null; // 1-based. null이면 다음 렌더링 때 오늘(또는 1일차)로 초기화

  /** 하루치 읽을 범위를 '1장 - 소제목' 형태로 한 줄에 하나씩 세로로 나열한다.
   *  (한 줄에 ' · '로 이어 붙이면 길어질 때 어디까지가 한 꼭지인지 알아보기 어렵다.)
   *  예전처럼 문자열 한 줄로 적어 둔 회차도 그대로 보여준다. */
  function rangeHtml(entry) {
    if (!entry) return '';
    if (typeof entry === 'string') return entry;
    const lines = [];
    for (const group of entry) {
      for (const text of group.s || []) {
        lines.push(group.ch
          ? `<li><b class="range-ch">${esc(group.ch)}</b><span class="range-sep">-</span>${text}</li>`
          : `<li class="range-plain">${text}</li>`);
      }
    }
    return `<ul class="range-list">${lines.join('')}</ul>`;
  }

  function renderTodayRange() {
    const fold = $('todayRangeFold');
    if (!fold) return;
    const plan = CONFIG.readingPlan || [];
    if (!plan.length) {
      fold.hidden = true;
      return;
    }
    const todayIdx = U.dayIndex(U.today());
    if (rangeDayIdx == null) {
      // 진행 중이면 오늘 회차, 시작 전이면 1일차(다가올 첫 회차), 종료 후면 마지막 회차(가장
      // 최근에 읽었을 내용)를 기본값으로 보여준다.
      if (todayIdx && todayIdx <= plan.length) rangeDayIdx = todayIdx;
      else rangeDayIdx = U.today() > CONFIG.endDate ? plan.length : 1;
    }
    rangeDayIdx = Math.min(Math.max(rangeDayIdx, 1), plan.length);

    const date = U.addDays(CONFIG.startDate, rangeDayIdx - 1);
    $('rangeDayLabel').textContent = `${rangeDayIdx}일차 (${U.shortLabel(date)})`
      + (rangeDayIdx === todayIdx ? ' · 오늘' : '');
    $('todayRangeText').innerHTML = rangeHtml(plan[rangeDayIdx - 1]);
    $('rangePrevDay').disabled = rangeDayIdx <= 1;
    $('rangeNextDay').disabled = rangeDayIdx >= plan.length;
    fold.hidden = false;
  }

  function shiftRangeDay(delta) {
    rangeDayIdx = (rangeDayIdx || 1) + delta;
    renderTodayRange();
  }

  /** 오늘 인증을 제출할 수 있는지
   *  기본은 챌린지 기간 안에서만 허용. CONFIG.allowSubmitOutsidePeriod 가 true 면
   *  시작 전·종료 후에도 제출할 수 있다(시연·테스트용).
   */
  function canSubmitToday() {
    return CONFIG.allowSubmitOutsidePeriod === true || U.phase() === 'running';
  }


  function paintPhase() {
    const box = $('phaseNote');
    const open = canSubmitToday();

    // 시작 전 D-day/OT 안내 배너는 더 이상 보여주지 않는다(요청에 따라 제거).
    // 제출 가능 여부에 따른 버튼 잠금 동작은 그대로 유지한다.
    msg(box, '');

    if (!open) {
      $('submitBtn').disabled = true;
      $('submitBtn').textContent = '기간 외 제출 잠김';
    }
  }


  /* ── 참가자 드롭다운 (이름·초성 검색으로 좁혀볼 수 있음) ── */

  const CHOSUNG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
    'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

  /** '필로소피' → 'ㅍㄹㅅㅍ' (한글이 아닌 글자는 그대로 둔다) */
  function chosungOf(str) {
    let out = '';
    for (const ch of String(str)) {
      const code = ch.charCodeAt(0);
      out += (code >= 0xac00 && code <= 0xd7a3)
        ? CHOSUNG[Math.floor((code - 0xac00) / 588)]
        : ch;
    }
    return out;
  }

  /** 검색어가 닉네임과 맞는지
   *  - 'ㅍ', 'ㅍㄹ' 처럼 자음만 입력하면 초성으로 찾는다 (한글 입력 중간 상태도 그대로 동작)
   *  - '필로' 처럼 글자를 입력하면 이름 앞부분으로 찾고, 못 찾으면 이름 중간도 찾아본다
   */
  function nicknameMatches(nick, term) {
    return matchRank(nick, term) > 0;
  }

  /** 검색 우선순위: 이름 앞부분(3) > 초성(2) > 이름 중간(1) > 안 맞음(0) */
  function matchRank(nick, term) {
    if (!term) return 3;
    const n = String(nick).toLowerCase();
    if (n.startsWith(term)) return 3;
    if (/^[ㄱ-ㅎ]+$/.test(term)) return chosungOf(n).startsWith(term) ? 2 : 0;
    return n.includes(term) ? 1 : 0;
  }

  /* ── 참여 아이디 콤보박스 ──────────────
   * 검색창과 드롭다운을 한 칸으로 합쳤다. 입력창에 이름/초성을 치면 바로 아래 목록이
   * 좁혀지고, Enter나 클릭으로 고른다. 고른 값은 화면에 보이지 않는 <select id="participant">가
   * 들고 있어서(그리고 change 이벤트를 쏴서) 나머지 코드는 예전 그대로 동작한다. */
  let comboOpen = false;
  let comboItems = [];   // 현재 목록에 보이는 참가자들
  let comboActive = -1;  // 키보드로 짚고 있는 항목

  /** 화면 뒤의 select에는 항상 전체 명단을 넣어 둔다 — id로 값을 지정하는 코드가 언제든 먹히도록. */
  function syncParticipantSelect() {
    const sel = $('participant');
    const keepId = sel.value;
    sel.innerHTML = '<option value="">— 이름 선택 —</option>';
    for (const p of participants) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.status === 'out' ? `${p.nickname} (아웃)` : p.nickname;
      sel.appendChild(o);
    }
    sel.value = participants.some((p) => p.id === keepId) ? keepId : '';
  }

  function comboLabel(p) { return p.status === 'out' ? `${p.nickname} (아웃)` : p.nickname; }

  /** 검색어로 후보를 좁힌다. 참여 중인 사람이 위, 아웃은 아래. */
  function comboCandidates(term) {
    const matches = (nick) => nicknameMatches(nick, term);
    const byRank = (a, b) => matchRank(b.nickname, term) - matchRank(a.nickname, term);
    return [
      ...participants.filter((p) => p.status !== 'out' && matches(p.nickname)).sort(byRank),
      ...participants.filter((p) => p.status === 'out' && matches(p.nickname)).sort(byRank)
    ];
  }

  function renderComboList() {
    const box = $('participantListbox');
    const input = $('participantSearch');
    box.innerHTML = comboItems.length
      ? comboItems.map((p, i) => `<li class="combo-option${i === comboActive ? ' active' : ''}"
          role="option" id="combo-opt-${i}" aria-selected="${$('participant').value === p.id}"
          data-pid="${esc(p.id)}">${esc(comboLabel(p))}</li>`).join('')
      : '<li class="combo-empty">검색 결과가 없습니다.</li>';
    box.hidden = !comboOpen;
    input.setAttribute('aria-expanded', String(comboOpen));
    input.setAttribute('aria-activedescendant', comboActive >= 0 ? `combo-opt-${comboActive}` : '');
    const active = box.querySelector('.combo-option.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function openCombo(term) {
    comboItems = comboCandidates(term === undefined ? $('participantSearch').value.trim().toLowerCase() : term);
    comboOpen = true;
    // 이미 고른 사람이 있으면 그 줄을, 아니면 첫 줄을 짚어 둔다.
    const cur = $('participant').value;
    const curIdx = comboItems.findIndex((p) => p.id === cur);
    comboActive = comboItems.length ? (curIdx >= 0 ? curIdx : 0) : -1;
    renderComboList();
  }

  function closeCombo() {
    comboOpen = false; comboActive = -1;
    renderComboList();
  }

  /** 확정된 사람을 입력칸 아래에 '선택 완료'로 보여 준다 (p가 null이면 표시를 지운다). */
  function markPicked(p) {
    const note = $('participantPicked');
    $('participantCombo').classList.toggle('picked', !!p);
    if (!p) { note.hidden = true; note.textContent = ''; return; }
    note.hidden = false;
    note.textContent = `✓ ${comboLabel(p)} 님으로 선택되었습니다.`;
  }

  /** 한 명을 확정한다. select에 값을 넣고 change를 쏴서 기존 onSelect가 그대로 돌게 한다. */
  function pickParticipant(p) {
    const sel = $('participant');
    sel.value = p.id;
    $('participantSearch').value = comboLabel(p);
    closeCombo();
    markPicked(p);
    sel.dispatchEvent(new Event('change'));
  }

  function bindParticipantCombo() {
    const input = $('participantSearch');
    const box = $('participantListbox');

    input.addEventListener('input', () => {
      const term = input.value.trim().toLowerCase();
      markPicked(null); // 다시 입력하기 시작하면 '선택됨' 표시를 지운다
      openCombo(term);
      // 이름을 정확히 다 쳤으면 그 줄을 짚어 둔다. 다만 자동으로 확정하지는 않는다 —
      // 목록이 곧바로 닫혀 버리면 제대로 선택됐는지 알 수 없다는 의견이 있었다.
      // Enter를 치거나 그 줄을 눌러야 확정되고, 확정되면 아래에 '선택 완료'가 뜬다.
      const exactIdx = comboItems.findIndex((p) => p.nickname.toLowerCase() === term);
      if (exactIdx >= 0) { comboActive = exactIdx; renderComboList(); }
    });
    input.addEventListener('focus', () => openCombo());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!comboOpen) { openCombo(); return; }
        if (!comboItems.length) return;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        comboActive = (comboActive + step + comboItems.length) % comboItems.length;
        renderComboList();
      } else if (e.key === 'Enter') {
        // 폼이 제출되지 않도록 막고, 짚고 있는 사람을 고른다.
        if (comboOpen && comboItems.length) {
          e.preventDefault();
          pickParticipant(comboItems[Math.max(0, comboActive)]);
        } else if (comboItems.length === 1) {
          e.preventDefault();
          pickParticipant(comboItems[0]);
        }
      } else if (e.key === 'Escape') {
        closeCombo();
      }
    });
    // 목록을 클릭할 때 input의 blur가 먼저 나 목록이 닫히는 것을 막는다.
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      const li = e.target.closest('[data-pid]');
      if (!li) return;
      const p = participants.find((x) => x.id === li.dataset.pid);
      if (p) pickParticipant(p);
    });
    $('participantToggle').addEventListener('mousedown', (e) => e.preventDefault());
    $('participantToggle').addEventListener('click', () => {
      if (comboOpen) { closeCombo(); return; }
      input.focus();
      openCombo('');       // 토글로 열 때는 전체 명단을 보여준다
    });
    input.addEventListener('blur', () => closeCombo());
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#participantCombo')) closeCombo();
    });
    // 테스트나 다른 코드가 select 값을 직접 바꿔도 입력창 글자가 따라가게 한다.
    $('participant').addEventListener('change', () => {
      const p = participants.find((x) => x.id === $('participant').value);
      input.value = p ? comboLabel(p) : '';
      markPicked(p || null);
    });
  }

  async function loadParticipants() {
    participants = await Store.listParticipants();
    syncParticipantSelect();

    if (!participants.length) {
      msg($('formMsg'),
        '아직 등록된 참가자 명단이 없습니다. 운영진이 <a href="admin.html">운영진 화면</a>의 ' +
        '<strong>명단 관리</strong>에서 신청 폼으로 모은 이름을 먼저 등록해 주세요.', 'warn');
      $('submitBtn').disabled = true;
      return;
    }
    if (canSubmitToday()) $('submitBtn').disabled = false;
  }

  /* ── 인증할 날짜 드롭다운 ─────────────── */
  /** 참여자가 고를 수 있는 날짜 범위: (참가자의 합류일 또는 챌린지 시작일) ~ 오늘.
   *  챌린지 시작 전(연습 기간)에는 오늘 하루만 보여준다. */
  function populateCertifyDateOptions(p) {
    const sel = $('certifyDate');
    const today = U.today();
    const start = (p && p.joinDate && p.joinDate > CONFIG.startDate) ? p.joinDate : CONFIG.startDate;
    const from = start <= today ? start : today;
    const dates = U.dateRange(from, today);
    const keep = sel.value;
    sel.innerHTML = dates.map((d) => {
      const idx = U.dayIndex(d);
      const label = idx ? `${idx}일차 (${U.shortLabel(d)})` : `연습 (${U.shortLabel(d)})`;
      return `<option value="${d}">${label}${d === today ? ' · 오늘' : ''}</option>`;
    }).join('');
    sel.value = dates.includes(keep) ? keep : today;
  }

  /** 선택된 날짜가 이미 마감을 넘겼는지 안내 (오늘이 아니면 항상 마감 지남) */
  function paintCertifyDateWarn(date) {
    $('certifyDateWarn').hidden = date === U.today();
  }

  /* ── 선택된 참여자·날짜의 제출분 불러오기 + 현황 ─ */
  async function loadEntryForm(pid, date) {
    const existing = await Store.getSubmission(pid, date);

    if (existing) {
      $('sentence').value = existing.sentence || '';
      $('reflection').value = existing.reflection || '';
      if (canSubmitToday()) $('submitBtn').textContent = '인증 수정하기';
      const lateNote = U.isLate(date, existing.createdAt) ? ' <strong class="bad">(지각 제출 — 미인증(X)으로 집계)</strong>' : '';
      msg($('formMsg'),
        `${U.shortLabel(date)} 인증은 <strong>제출 완료</strong> 상태입니다.${lateNote} ` +
        `(${U.stampLabel(existing.updatedAt || existing.createdAt)}) 내용을 고치고 다시 제출하면 덮어씁니다.`,
        U.isLate(date, existing.createdAt) ? 'warn' : 'ok');
    } else {
      const draft = loadDraft(pid, date);
      $('sentence').value = draft.sentence || '';
      $('reflection').value = draft.reflection || '';
      if (canSubmitToday()) $('submitBtn').textContent = '인증하기';
      msg($('formMsg'), '');
    }
    autoGrow($('sentence'));
    autoGrow($('reflection'));
    paintCertifyDateWarn(date);
  }

  async function onSelect() {
    const pid = $('participant').value;
    currentPid = pid;
    const card = $('myCard');
    if (!pid) {
      card.hidden = true; msg($('formMsg'), '');
      await refreshSocialFeed();
      return;
    }

    const p = participants.find((x) => x.id === pid);
    populateCertifyDateOptions(p);
    await loadEntryForm(pid, $('certifyDate').value);

    await paintMine(pid);
    await refreshSocialFeed();
  }

  async function onCertifyDateChange() {
    // 날짜를 먼저 고르는 순서라, 이름을 아직 안 골랐어도 지각 안내는 바로 보여 준다.
    paintCertifyDateWarn($('certifyDate').value);
    const pid = $('participant').value;
    if (!pid) return;
    await loadEntryForm(pid, $('certifyDate').value);
  }

  /** 입력한 만큼 textarea 높이가 자동으로 늘어나게 (min-height/max-height는 CSS가 담당) */
  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  /* ── 임시 저장 (작성 중 이탈 대비) ────── */
  function loadDraft(pid, date) {
    try {
      const all = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
      const d = all[`${pid}|${date}`];
      if (d) $('draftNote').textContent = '작성 중이던 내용을 불러왔습니다.';
      return d || {};
    } catch (e) { return {}; }
  }

  function saveDraft() {
    const pid = $('participant').value;
    if (!pid) return;
    let all = {};
    try { all = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}'); } catch (e) { all = {}; }
    all[`${pid}|${$('certifyDate').value}`] = {
      sentence: $('sentence').value,
      reflection: $('reflection').value
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(all));
  }

  function clearDraft(pid, date) {
    try {
      const all = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
      delete all[`${pid}|${date}`];
      localStorage.setItem(DRAFT_KEY, JSON.stringify(all));
    } catch (e) { /* noop */ }
    $('draftNote').textContent = '';
  }

  /* ── 나의 현황 ───────────────────────── */
  async function paintMine(pid) {
    const p = participants.find((x) => x.id === pid);
    if (!p) return;
    const subs = await Store.listSubmissions({ participantId: pid });
    const stat = U.buildStats([p], subs)[0];

    $('myCard').hidden = false;
    $('stVerified').textContent = stat.verified;
    $('stMissed').textContent = stat.missed;
    $('stExempt').textContent = stat.exempt;
    $('stStreak').textContent = stat.streak;
    $('stRate').textContent = `${stat.rate}%`;

    const tag = $('myStatusTag');
    const rt = U.riskTag(stat);
    tag.className = `tag ${rt.cls}`;
    tag.textContent = rt.label;

    const left = CONFIG.kickoutThreshold - stat.missed;
    $('myHint').innerHTML = p.status === 'out'
      ? '참여가 종료된 상태입니다. 문의는 운영진에게 남겨 주세요.'
      : (stat.missed === 0
        ? '아직 미인증이 없습니다. 이 페이스를 지켜 주세요! 💪'
        : `누적 미인증 <strong>${stat.missed}회</strong> — 킥아웃까지 <strong>${Math.max(0, left)}회</strong> 남았습니다.`);

    // 날짜 스트립 (화면 폭에 맞춰 자동 줄바꿈)
    const strip = $('myStrip');
    strip.innerHTML = stat.cells.map((c) => `
      <div class="strip-cell" title="${esc(U.shortLabel(c.date))} — ${esc(labelOf(c.status))}">
        <span class="cell ${CELL_CLASS[c.status]}">${c.status === '-' ? '·' : c.status}</span>
        <span class="d">${Number(c.date.slice(8))}</span>
      </div>`).join('');

    // 최근 기록 (최신 5건)
    const box = $('myEntries');
    const recent = subs.slice().reverse().slice(0, 5);
    box.innerHTML = recent.length ? recent.map(renderEntry).join('') :
      '<div class="empty">아직 제출한 인증이 없습니다.</div>';
    $('myEntriesFold').querySelector('summary').textContent =
      recent.length ? `최근 인증 기록 ${recent.length}건 보기` : '최근 인증 기록 보기';
  }

  function labelOf(st) {
    return { O: '인증', X: '미인증', P: '면제', '-': '예정', '·': '해당 없음' }[st] || st;
  }

  function renderEntry(s) {
    const late = U.isLate(s.date, s.createdAt);
    return `<div class="entry">
      <h4>${esc(U.shortLabel(s.date))}
        <span class="tag ${late ? 'bad' : 'ok'}">${late ? '미인증(지각)' : '인증'}</span>
        <span class="muted">${esc(U.stampLabel(s.updatedAt || s.createdAt))} 제출</span>
      </h4>
      <dl>
        <dt>인상 깊은 내용</dt><dd class="quote">“${esc(s.sentence)}”</dd>
        <dt>느낀 점</dt><dd>${esc(s.reflection)}</dd>
      </dl>
    </div>`;
  }

  /* ── 인증 피드 & 명예의 전당 ───────────────────── */

  /** 피드에서 넘겨볼 수 있는 날짜 범위. 챌린지 시작 전(연습 기간)에는 오늘 하루만 보여준다. */
  function feedDateBounds() {
    const t = U.today();
    return { lo: t < CONFIG.startDate ? t : CONFIG.startDate, hi: t };
  }

  function shiftFeedDate(delta) {
    const { lo, hi } = feedDateBounds();
    const next = U.addDays(feedDate, delta);
    if (next < lo || next > hi) return;
    feedDate = next;
    feedVisibleCount = FEED_PAGE_SIZE;
    refreshSocialFeed();
  }

  /** 피드 카드에서 좌우로 밀면 이전/다음 날짜로 이동 (모바일 스와이프) */
  function bindFeedSwipe(el) {
    if (!el) return;
    let sx = 0, sy = 0, tracking = false;
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      // 세로 스크롤과 헷갈리지 않도록 충분히 수평에 가까운 스와이프만 인정
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        shiftFeedDate(dx < 0 ? 1 : -1);
      }
    }, { passive: true });
  }

  /** 본인 글인지 (선택된 참여 아이디 기준). 여론 조작 방지를 위해 본인 글은 추천할 수 없다. */
  function isOwnSubmission(s) {
    return !!currentPid && s.participantId === currentPid;
  }

  function bindUpvoteButtons(container) {
    container.querySelectorAll('.upvote-btn').forEach((btn) => {
      if (btn.classList.contains('self')) return; // 본인 글: 클릭 자체를 막는다
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          if (btn.classList.contains('voted')) {
            await Store.unvoteSubmission(btn.dataset.id, clientId);
          } else {
            await Store.upvoteSubmission(btn.dataset.id, clientId);
          }
          await refreshSocialFeed();
          await calculateRanksAndFame();
        } catch (err) {
          btn.disabled = false;
          alert(err.message);
        }
      });
    });
  }

  function renderFeedItem(s, isWinner, hasUpvoted) {
    const own = isOwnSubmission(s);
    const late = U.isLate(s.date, s.createdAt);
    const btnClass = ['upvote-btn', hasUpvoted ? 'voted' : '', own ? 'self' : ''].filter(Boolean).join(' ');
    const btnAttr = own ? 'disabled title="본인 글은 추천할 수 없습니다"' : '';
    // 왼쪽에는 글(이름·시간·본문)만, 오른쪽에는 버튼만 모아 둔다 — 본문이 버튼 사이로 파고들지 않게.
    return `<article class="feed-item${isWinner ? ' win' : ''}">
      <div class="feed-main">
        <div class="feed-top">
          <span class="feed-nick">${isWinner ? '👑 ' : ''}${esc(s.nickname)}</span>
          ${late ? '<span class="tag bad">지각</span>' : ''}
          <span class="feed-time">${esc(U.stampLabel(s.updatedAt || s.createdAt))}</span>
        </div>
        <p class="feed-quote">“${esc(s.sentence)}”</p>
        <details class="feed-more">
          <summary>느낀 점 보기</summary>
          <dl class="body">
            <dt>느낀 점</dt><dd>${esc(s.reflection)}</dd>
          </dl>
        </details>
      </div>
      <div class="feed-acts">
        <button type="button" class="share-btn" data-share
          data-nickname="${esc(s.nickname)}" data-date="${esc(s.date)}"
          data-sentence="${esc(s.sentence)}" data-reflection="${esc(s.reflection)}"
          data-winner="${isWinner ? '1' : ''}"
          aria-label="텍스트 복사" title="텍스트 복사">${U.icon('copy')}<span class="lbl">텍스트 복사</span></button>
        <button type="button" class="${btnClass}" data-id="${esc(s.id)}"
          ${btnAttr} aria-label="엄지척 ${s.upvotes || 0}개, ${hasUpvoted ? '눌러서 취소' : '눌러서 추천'}">${U.icon('thumb')}${s.upvotes || 0}</button>
      </div>
    </article>`;
  }

  async function refreshSocialFeed() {
    const date = feedDate;
    const daySubs = (await Store.listSubmissions({ date })).slice();

    // 정렬: 추천 많은순(기본) | 최신순. 동점·동시각이면 먼저 올린 사람이 위로.
    if (feedSort === 'recent') {
      daySubs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    } else {
      daySubs.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0) ||
        String(a.createdAt).localeCompare(String(b.createdAt)));
    }

    // 1등(가장 많이 추천된 사람) — 공동 1등 모두 인정. 정렬·검색과 무관하게 왕관을 달아 준다.
    // (검색으로 걸러내기 전의 그날 전체를 기준으로 뽑아야 1등이 검색어에 따라 바뀌지 않는다)
    const maxVotes = daySubs.reduce((m, s) => Math.max(m, s.upvotes || 0), 0);
    const winners = maxVotes > 0
      ? daySubs.filter((s) => (s.upvotes || 0) === maxVotes).map((s) => s.nickname)
      : [];

    const shown = feedSearch
      ? daySubs.filter((s) => nicknameMatches(s.nickname, feedSearch))
      : daySubs;

    $('feedCount').textContent = feedSearch
      ? `${shown.length}명 / ${daySubs.length}명`
      : `${daySubs.length}명`;

    // 날짜 넘기기 컨트롤
    const { lo, hi } = feedDateBounds();
    const isToday = date === U.today();
    $('feedPrevDate').disabled = date <= lo;
    $('feedNextDate').disabled = date >= hi;
    $('feedDateLabel').textContent = isToday ? `오늘 · ${U.shortLabel(date)}` : U.shortLabel(date);

    const feedList = $('socialFeedList');
    const moreWrap = $('feedLoadMoreWrap');
    if (!shown.length) {
      feedList.innerHTML = daySubs.length
        ? `<div class="empty">'${esc(feedSearch)}'와(과) 맞는 이름이 이 날짜에 없습니다.</div>`
        : `<div class="empty">${isToday ? '오늘' : U.shortLabel(date) + '에'} 제출된 인증글이 없습니다.` +
          `${isToday ? ' 첫 번째 글을 작성해 보세요!' : ''}</div>`;
      moreWrap.hidden = true;
      return;
    }

    const winnerSet = new Set(winners);
    const visible = shown.slice(0, feedVisibleCount);
    feedList.innerHTML = visible.map((s) =>
      renderFeedItem(s, winnerSet.has(s.nickname), (s.upvotedBy || []).includes(clientId))).join('');
    bindUpvoteButtons(feedList);
    CS.ShareCard.bindButtons(feedList, { title: CONFIG.title, dateLabel: U.shortLabel(date) });

    const remaining = shown.length - visible.length;
    if (remaining > 0) {
      moreWrap.hidden = false;
      $('feedLoadMoreBtn').textContent = `더 보기 (${remaining}명 더 남음)`;
    } else {
      moreWrap.hidden = true;
    }
  }

  // 인증 피드 "전체 보기"는 feed-all.html(새 창)에서 js/feed-all.js가 별도로 렌더링합니다.

  // 명예의 전당에서 이름을 클릭하면 그 사람이 그날 쓴 인사이트를 펼쳐 보여준다.
  let fameOpenName = null; // 현재 펼쳐진 이름 (null이면 닫힘)

  const FAME_TOP_RANK = 5; // 몇 등까지 보여줄지 (인원수가 아니라 등수 기준)
  let fameRanked = [];     // 전일 순위 [{nickname, votes, rank, sentence, reflection, date}]
  let fameEmptyMsg = '아직 집계할 전일 기록이 없습니다.';

  /** 펼쳐진 사람의 기록 — 목록의 그 사람 줄 바로 아래에 끼워 넣는다. */
  function fameDetailHtml(item) {
    return `<div id="fameDetail" class="fame-detail">
      <div class="fame-detail-head">
        <strong>${esc(item.nickname)}님의 ${esc(U.shortLabel(item.date))} 기록</strong>
        <button type="button" class="share-btn" data-share
          data-nickname="${esc(item.nickname)}" data-date="${esc(item.date)}"
          data-sentence="${esc(item.sentence)}" data-reflection="${esc(item.reflection)}"
          data-winner="${item.rank === 1 ? '1' : ''}"
          aria-label="텍스트 복사" title="텍스트 복사">${U.icon('copy')}<span class="lbl">텍스트 복사</span></button>
      </div>
      <div class="fame-entry">
        <div class="fame-entry-label">인상 깊은 내용</div>
        <p class="quote">“${esc(item.sentence)}”</p>
        <div class="fame-entry-label">느낀 점</div>
        <p>${esc(item.reflection)}</p>
      </div>
    </div>`;
  }

  function renderFameList() {
    const fameList = $('hallOfFameList');
    fameList.innerHTML = fameRanked.length
      ? fameRanked.map((item) => {
        const medal = ['🥇', '🥈', '🥉'][item.rank - 1] || '⭐';
        const isOpen = fameOpenName === item.nickname;
        return `<li class="fame-item">
          <div class="fame-row" data-fame="${esc(item.nickname)}" role="button" tabindex="0"
            aria-expanded="${isOpen}" title="클릭하면 이 사람이 쓴 인상 깊은 내용과 느낀 점을 볼 수 있어요">
            <span class="medal">${medal}</span>` +
          `<span class="who">${esc(item.nickname)}</span>` +
          `<span class="cnt">${item.rank}등 · ${U.icon('thumb')}${item.votes}</span>
          </div>${isOpen ? fameDetailHtml(item) : ''}</li>`;
      }).join('')
      : `<li class="none">${esc(fameEmptyMsg)}</li>`;

    fameList.querySelectorAll('[data-fame]').forEach((el) => {
      const toggle = () => {
        fameOpenName = fameOpenName === el.dataset.fame ? null : el.dataset.fame;
        renderFameList(); // 펼침 위치가 바뀌므로 목록을 다시 그린다
        if (fameOpenName) {
          const row = $('hallOfFameList').querySelector(`[data-fame="${CSS.escape(fameOpenName)}"]`);
          if (row) row.focus(); // 다시 그려도 키보드 초점은 방금 누른 줄에 남긴다
        }
      };
      el.addEventListener('click', toggle);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });
    // 펼친 기록의 텍스트 복사 버튼
    CS.ShareCard.bindButtons(fameList, { title: CONFIG.title });
  }

  // 전일(어제) 인증글을 엄지척(추천) 많이 받은 순으로 줄 세워 1~5등을 보여준다.
  // '5명'이 아니라 '5등까지'라, 동점으로 5등 안에 드는 사람은 인원수와 상관없이 모두 올린다.
  // 오늘 순위는 인증 피드에서 실시간으로 볼 수 있으므로, 여기서는 마감이 지나
  // 추천이 더는 늘지 않는 어제 것을 "확정된 명예"로 남긴다.
  async function calculateRanksAndFame() {
    const date = U.lastSettledDate(); // 어제 (챌린지 첫날이라 어제가 없으면 null)
    const daySubs = date ? await Store.listSubmissions({ date }) : [];

    $('fameDateLabel').textContent = date ? `${U.shortLabel(date)}에` : '어제';
    fameEmptyMsg = date ? '전일 인증글 중 추천받은 글이 없습니다.' : '아직 집계할 전일 기록이 없습니다.';

    // 추천 많은 순 → 동점이면 먼저 올린 사람이 위로.
    // 추천이 없는 글과, 마감(24:00)을 넘겨 올린 지각 글은 순위에서 제외한다
    // (지각 글은 다른 화면에서도 인증으로 인정하지 않으므로 명예의 전당에도 올리지 않는다).
    const ranked = daySubs
      .filter((s) => (s.upvotes || 0) > 0 && !U.isLate(s.date, s.createdAt))
      .sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0) ||
        String(a.createdAt).localeCompare(String(b.createdAt)));

    let prevVotes = null, prevRank = 0;
    fameRanked = ranked.map((s, idx) => {
      const votes = s.upvotes || 0;
      // 동점이면 같은 등수(1,1,3…). 공동 1등을 둘 다 1등으로 보여주기 위함.
      const rank = votes === prevVotes ? prevRank : idx + 1;
      prevVotes = votes; prevRank = rank;
      return { nickname: s.nickname, votes, rank, date: s.date, sentence: s.sentence, reflection: s.reflection };
    }).filter((item) => item.rank <= FAME_TOP_RANK);

    // 순위가 바뀌면서 펼쳐 두었던 사람이 목록에서 사라질 수 있으니 닫아 준다.
    if (fameOpenName && !fameRanked.some((i) => i.nickname === fameOpenName)) fameOpenName = null;

    renderFameList();
  }

  /* ── 전체 진행현황 대시보드 (모든 참여자 공개) ─── */
  // 통계 타일 클릭 시 아래에 펼쳐 보여줄 명단. paintOverall()이 매번 최신 내용으로 채운다.
  let ovOpenKey = null; // 'miss' | 'risk' | null(닫힘)
  let ovLists = { miss: [], risk: [] };
  let ovMissDetail = { missed: [], late: [] }; // 전일 미제출 / 지각 명단 (나눠서 보여준다)

  const byKo = (a, b) => a.localeCompare(b, 'ko');

  let ovPrevTitle = '전일 누락 · 지각'; // paintOverall()이 실제 날짜를 넣어 갱신한다

  const nameLine = (names) => (names.length
    ? names.map(esc).join(', ')
    : '<span class="muted">해당하는 사람이 없습니다.</span>');

  function renderOvDetail() {
    const box = $('ovDetail');
    if (!ovOpenKey) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    if (ovOpenKey === 'miss') {
      // 미제출과 지각은 성격이 달라(아예 안 올림 / 마감 넘겨 올림) 나눠서 보여준다.
      const { missed, late } = ovMissDetail;
      box.innerHTML = `<strong>${esc(ovPrevTitle)} (${missed.length + late.length}명)</strong>
        <div class="ov-detail-row"><span class="ov-detail-key">미제출 ${missed.length}명</span> ${nameLine(missed)}</div>
        <div class="ov-detail-row"><span class="ov-detail-key">지각 ${late.length}명</span> ${nameLine(late)}</div>`;
      return;
    }
    const names = ovLists[ovOpenKey];
    box.innerHTML = `<strong>킥아웃 위험 인원 (${names.length}명)</strong><br>${nameLine(names)}`;
  }

  function toggleOvDetail(key) {
    ovOpenKey = ovOpenKey === key ? null : key;
    $('ovPrevMissTile').setAttribute('aria-expanded', String(ovOpenKey === 'miss'));
    $('ovRiskTile').setAttribute('aria-expanded', String(ovOpenKey === 'risk'));
    renderOvDetail();
  }

  let overallStats = [];       // paintOverall()이 채워 두는 원본 통계(정렬 전) — 정렬만 바꿀 때 재사용
  let overallSort = 'rate';    // 'rate' 인증률순 | 'name-asc' 이름순 | 'name-desc' 이름 역순

  function sortOverallStats(stats, sort) {
    const byNameAsc = (a, b) => a.participant.nickname.localeCompare(b.participant.nickname, 'ko');
    if (sort === 'name-asc') return stats.slice().sort(byNameAsc);
    if (sort === 'name-desc') return stats.slice().sort((a, b) => byNameAsc(b, a));
    return stats.slice().sort((a, b) => (b.rate - a.rate) || (b.streak - a.streak) || byNameAsc(a, b));
  }

  /** 정렬 선택만 바뀌었을 때는 데이터를 다시 불러오지 않고 표만 다시 그린다. */
  function renderOverallTable() {
    const sorted = sortOverallStats(overallStats, overallSort);
    const head = '<thead><tr><th>이름</th><th class="num">인증</th><th class="num">미인증</th>' +
      '<th class="num">인증률</th><th class="num">연속 인증</th><th>오늘</th><th>상태</th></tr></thead>';
    const body = sorted.map((s) => {
      const p = s.participant;
      const rt = U.riskTag(s);
      const statusTag = `<span class="tag ${rt.cls}">${rt.label}</span>`;
      const todayTag = s.submittedToday ? '<span class="tag ok">인증</span>' : '<span class="tag">-</span>';
      return `<tr>
        <td>${esc(p.nickname)}</td>
        <td class="num">${s.verified}</td>
        <td class="num">${s.missed}</td>
        <td class="num">${s.rate}%</td>
        <td class="num">${s.streak}</td>
        <td>${todayTag}</td>
        <td>${statusTag}</td>
      </tr>`;
    }).join('');
    $('overallTable').innerHTML = `${head}<tbody>${body}</tbody>`;
  }

  async function paintOverall() {
    if (!participants.length) {
      $('overallCount').textContent = '0명';
      $('overallTable').innerHTML = '<tbody><tr><td class="empty">등록된 참가자가 없습니다.</td></tr></tbody>';
      return;
    }
    const allSubs = await Store.listSubmissions();
    overallStats = U.buildStats(participants, allSubs);

    const active = overallStats.filter((s) => s.participant.status !== 'out');

    // 전일(어제) 기준 집계. 오늘은 24:00 마감 전이라 아직 확정되지 않으므로, 마감이 지나
    // O/X가 확정된 마지막 날인 어제를 기준으로 삼는다. 마감을 넘겨 올린 지각 제출은
    // 다른 화면과 동일하게 인증으로 치지 않는다(statusFor 규칙).
    const prevDate = U.lastSettledDate(); // 챌린지 첫날이라 어제가 없으면 null
    const prevCell = (s) => s.cells.find((c) => c.date === prevDate);
    // 면제(P)·참여 전(·)인 사람은 인증률 분모에서 빼고, O/X로 확정된 사람만 센다.
    const prevGraded = prevDate
      ? active.filter((s) => { const c = prevCell(s); return c && (c.status === 'O' || c.status === 'X'); })
      : [];
    const prevDone = prevGraded.filter((s) => prevCell(s).status === 'O');
    // 인증으로 인정받지 못한 사람(X) = 아예 안 올린 사람 + 마감을 넘겨 올린 사람
    const prevMissed = prevGraded.filter((s) => prevCell(s).status === 'X');
    const prevSubIds = new Set(allSubs.filter((s) => s.date === prevDate).map((s) => s.participantId));

    // 킥아웃 위험 인원: 누적 미인증이 riskThreshold회 이상인 사람 전부(이미 킥아웃 대상인
    // 사람도 포함) — 아래 표의 '위험'·'킥아웃 대상' 태그로 그중 실제 심각도를 구분해서 보여준다.
    const riskZone = active.filter((s) => s.atRisk);

    ovLists = { miss: prevMissed.map((s) => s.participant.nickname).sort(byKo),
      risk: riskZone.map((s) => s.participant.nickname).sort(byKo) };
    ovMissDetail = {
      missed: prevMissed.filter((s) => !prevSubIds.has(s.participant.id))
        .map((s) => s.participant.nickname).sort(byKo),
      late: prevMissed.filter((s) => prevSubIds.has(s.participant.id))
        .map((s) => s.participant.nickname).sort(byKo)
    };
    ovPrevTitle = prevDate ? `${U.shortLabel(prevDate)} 누락 · 지각` : '전일 누락 · 지각';

    $('overallCount').textContent = `${active.length}명`;
    $('ovPrevDateLabel').textContent = prevDate ? U.shortLabel(prevDate) : '어제';
    // 아직 마감이 지난 날이 없으면(챌린지 첫날) 숫자 대신 '-'로 비워 둔다.
    $('ovPrevRate').textContent = prevDate
      ? (prevGraded.length ? `${Math.round((prevDone.length / prevGraded.length) * 100)}%` : '0%')
      : '-';
    $('ovPrevMiss').textContent = prevDate ? prevMissed.length : '-';
    $('ovRisk').textContent = riskZone.length;
    renderOvDetail(); // 갱신 중에도 펼쳐 둔 명단이 있으면 최신 내용으로 다시 그린다

    renderOverallTable();
  }

  /* ── 제출 ────────────────────────────── */
  async function onSubmit(e) {
    e.preventDefault();
    const pid = $('participant').value;
    if (!pid) { msg($('formMsg'), '참여 아이디를 선택해 주세요.', 'bad'); return; }

    if (!canSubmitToday()) {
      msg($('formMsg'),
        `인증은 챌린지 기간(${U.longLabel(CONFIG.startDate)} ~ ${U.longLabel(CONFIG.endDate)})에만 제출할 수 있습니다.`, 'bad');
      return;
    }

    const p = participants.find((x) => x.id === pid);
    const date = $('certifyDate').value || U.today();
    const payload = {
      participantId: pid,
      nickname: p ? p.nickname : '',
      date,
      sentence: $('sentence').value.trim(),
      reflection: $('reflection').value.trim()
    };
    if (!payload.sentence || !payload.reflection) {
      msg($('formMsg'), '두 항목을 모두 작성해 주세요.', 'bad');
      return;
    }

    $('submitBtn').disabled = true;
    try {
      const saved = await Store.saveSubmission(payload);
      clearDraft(pid, date);
      const late = U.isLate(date, saved.createdAt);
      msg($('formMsg'),
        `<strong>${esc(payload.nickname)}</strong> 님, ${U.shortLabel(payload.date)} 인증이 저장되었습니다.` +
        (late
          ? ' <strong>다만 마감을 넘겨 미인증(X)으로 집계됩니다.</strong> 기록은 남았어요!'
          : ' 오늘도 수고하셨어요! 📖'),
        late ? 'warn' : 'ok');
      $('submitBtn').textContent = '인증 수정하기';
      paintCertifyDateWarn(date);

      await paintMine(pid);
      await paintOverall();
      feedDate = date;
      feedVisibleCount = FEED_PAGE_SIZE;
      await refreshSocialFeed();
      await calculateRanksAndFame();
      $('myCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      msg($('formMsg'), `저장 실패: ${esc(err.message)}`, 'bad');
    } finally {
      $('submitBtn').disabled = false;
    }
  }

  /* ── 초기화 ──────────────────────────── */
  async function boot() {
    await Store.init();
    paintHeader();
    renderTodayRange();
    $('rangePrevDay').addEventListener('click', () => shiftRangeDay(-1));
    $('rangeNextDay').addEventListener('click', () => shiftRangeDay(1));
    paintPhase();
    tickCountdown();
    setInterval(tickCountdown, 1000);
    populateCertifyDateOptions(null);
    paintCertifyDateWarn($('certifyDate').value);
    await loadParticipants();
    await refreshSocialFeed();
    await calculateRanksAndFame();
    await paintOverall();

    // 전체 진행현황: "인증 완료 인원" · "킥아웃 위험 인원" 타일을 클릭하면 명단이 펼쳐짐
    [['ovPrevMissTile', 'miss'], ['ovRiskTile', 'risk']].forEach(([id, key]) => {
      const tile = $(id);
      tile.addEventListener('click', () => toggleOvDetail(key));
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleOvDetail(key); }
      });
    });
    $('ovSortSelect').addEventListener('change', (e) => {
      overallSort = e.target.value;
      renderOverallTable();
    });

    $('participant').addEventListener('change', onSelect);
    bindParticipantCombo();
    $('certifyDate').addEventListener('change', onCertifyDateChange);
    $('verifyForm').addEventListener('submit', onSubmit);
    ['sentence', 'reflection'].forEach((k) =>
      $(k).addEventListener('input', saveDraft));
    ['sentence', 'reflection'].forEach((k) =>
      $(k).addEventListener('input', () => autoGrow($(k))));

    // 피드 날짜 넘기기 (버튼 + 좌우 스와이프)
    $('feedPrevDate').addEventListener('click', () => shiftFeedDate(-1));
    $('feedNextDate').addEventListener('click', () => shiftFeedDate(1));
    $('feedLoadMoreBtn').addEventListener('click', () => {
      feedVisibleCount += FEED_PAGE_SIZE;
      refreshSocialFeed();
    });
    $('feedSearch').addEventListener('input', (e) => {
      feedSearch = e.target.value.trim().toLowerCase();
      feedVisibleCount = FEED_PAGE_SIZE; // 검색어가 바뀌면 처음부터 다시 보여준다
      refreshSocialFeed();
    });
    $('feedSortSelect').addEventListener('change', (e) => {
      feedSort = e.target.value;
      feedVisibleCount = FEED_PAGE_SIZE; // 정렬이 바뀌면 처음부터 다시 보여준다
      refreshSocialFeed();
    });
    bindFeedSwipe(document.querySelector('.feed-card'));

    // 피드 갱신: 수동 버튼(전체 재집계) + 화면이 보이는 동안 "오늘" 볼 때만 주기적 갱신
    // (명예의 전당도 하루치만 읽으므로 함께 갱신한다 — 추천이 들어오면 순위가 바로 따라간다)
    $('feedRefresh').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await refreshSocialFeed();
        await calculateRanksAndFame();
        await paintOverall();
      } finally { btn.disabled = false; }
    });
    const pollFeed = () => {
      if (document.visibilityState !== 'visible') return;
      // 피드는 '오늘'을 보고 있을 때만, 명예의 전당(전일 기준)은 어느 날짜를 보고 있든 갱신한다
      // — 지난 날짜 피드에서 추천을 누르면 전일 순위가 바뀔 수 있기 때문이다.
      if (feedDate === U.today()) refreshSocialFeed().catch(console.error);
      calculateRanksAndFame().catch(console.error);
    };
    setInterval(pollFeed, 120000);
    document.addEventListener('visibilitychange', pollFeed);

    // 실시간 동기화
    window.addEventListener('storage', async (e) => {
      if (e.key && e.key.startsWith(CONFIG.storagePrefix)) {
        const keep = $('participant').value;
        await loadParticipants();
        if (keep) { $('participant').value = keep; await onSelect(); }
        await refreshSocialFeed();
        await calculateRanksAndFame();
        await paintOverall();
      }
    });
  }

  boot().catch((err) => {
    console.error(err);
    msg($('formMsg'), `초기화 실패: ${err.message}`, 'bad');
  });
})();
