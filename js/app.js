/* 참가자 인증 화면 */
(function () {
  const { CONFIG, U, Store } = CS;
  const $ = (id) => document.getElementById(id);

  const CELL_CLASS = { O: 'cell-o', X: 'cell-x', P: 'cell-p', '-': 'cell-none', '·': 'cell-off' };
  const DRAFT_KEY = `${CONFIG.storagePrefix}.draft`;
  const CLIENT_KEY = `${CONFIG.storagePrefix}.clientId`;
  const FEED_PAGE_SIZE = 20;

  let participants = [];
  let feedDate = '';     // 피드에서 볼 날짜. 빈 값이면 전체 날짜(지금까지 올라온 모든 글, 최신 날짜부터)
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

  /* 지난 시즌을 "보기만" 하는 중인지. boot()에서 시즌 잠금 상태를 확인한 뒤 켜진다.
   * 켜지면 인증 폼과 추천 버튼이 모두 잠겨서 예전 기록이 손대지 않은 채로 남는다. */
  let READONLY = false;

  /* 세 번째 타일의 이름표. 킥아웃이 있는 시즌은 "위험 인원", 없는 시즌은 누락 집계만 한다. */
  const RISK_TILE = CONFIG.kickoutEnabled
    ? { label: '킥아웃 위험 인원',
      note: `누적 미인증 ${CONFIG.riskThreshold}회 이상 · ${CONFIG.kickoutThreshold}회부터 킥아웃 대상` }
    : { label: '누적 누락 인원', note: '누적 미인증이 1회 이상인 참여자' };

  /* 책 소개 카드 — 시즌 설정(js/config.js)에서 통째로 채운다.
   * 책이 바뀔 때 HTML을 고치는 대신 설정만 갈아 끼우면 되도록 했다. */
  function paintIntro() {
    const b = CONFIG.book;
    const cover = $('introCover');
    cover.src = b.cover;
    cover.alt = `${b.name} 책 표지`;
    $('introTitle').textContent = b.name;
    if (b.tagline) {
      $('introTagline').textContent = b.tagline;
      $('introTagline').hidden = false;
    }
    $('introByline').textContent = b.byline;

    const weeks = Math.round(U.challengeDates().length / 7);
    $('introMeta').innerHTML =
      `📅 <strong>${esc(CONFIG.periodLabel)}</strong> ${esc(U.longLabel(CONFIG.startDate))} ~ `
      + `${esc(U.longLabel(CONFIG.endDate))}, ${weeks}주간<br>`
      + `📢 <strong>독서모임</strong> ${esc(CONFIG.live.label)}`;
    $('introFineprint').textContent = CONFIG.live.note;
    // 설정의 \n은 넓은 화면에서만 줄바꿈(한 줄씩 블록) — 휴대폰에서는 띄어쓰기로 이어진다
    $('introDesc').innerHTML = String(b.desc || '').split('\n')
      .map((line) => `<span class="desc-line">${esc(line)}</span>`).join(' ');

    // 킥아웃이 없는 시즌에는 킥아웃 규칙 줄을 아예 내린다(빈 값이나 Infinity가 보이지 않게).
    if (CONFIG.kickoutEnabled) $('kickN').textContent = CONFIG.kickoutThreshold;
    else $('ruleKick').hidden = true;

    // 이 시즌에만 붙는 규칙을 공통 규칙 뒤에 이어 붙인다.
    const list = $('ruleList');
    (CONFIG.extraRules || []).forEach((html) => {
      const li = document.createElement('li');
      li.innerHTML = html;
      list.appendChild(li);
    });
    // 접혀 있으면 안에 뭐가 몇 개 있는지 모른다 — 펼칠지 판단할 수 있게 개수를 적어 둔다.
    const hidden = list.querySelectorAll('li:not([hidden])').length;
    $('ruleFold').querySelector('summary').textContent = `나머지 규칙 ${hidden}가지 보기`;

    $('ruleHeading').textContent = CONFIG.rulesHeading;
    $('sentence').placeholder = CONFIG.sentencePlaceholder;
    $('reflection').placeholder = CONFIG.reflectionPlaceholder;

    // 규칙 위에 나란히 놓이는 바깥 링크 버튼들(OT 영상·설명서 등)
    const links = CONFIG.headLinks || [];
    if (links.length) {
      $('headLinks').innerHTML = links.map((l) =>
        `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">`
        + `${U.icon(l.icon || 'play')}<span>${esc(l.label)}</span></a>`).join('');
      $('headLinks').hidden = false;
    }

    document.title = `${CONFIG.title} · 인증하기`;
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute('content', `${CONFIG.title} ${b.name} 인증 시스템`);
  }

  /* ── 헤더 / 배너 ─────────────────────── */
  function paintHeader() {
    $('brandTitle').textContent = CONFIG.title;
    if (!CONFIG.kickoutEnabled) {
      // 위험 경고가 아니라 단순 집계이므로 빨강(bad) 대신 주황(warn)으로 낮춘다.
      $('ovRiskLabel').textContent = RISK_TILE.label;
      $('ovRiskTile').classList.replace('bad', 'warn');
    }
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

  /** 라이브 날의 발제문. 그날이 되기 전에는 보여주지 않는다(미리 보면 라이브의 재미가 준다). */
  function promptHtml(dayIdx, date) {
    const entry = (CONFIG.weeklyPrompts || []).find((w) => w.day === dayIdx);
    if (!entry || !entry.questions || !entry.questions.length) return '';
    if (date > U.today()) return '';
    return `<div class="prompt-box"><b>📝 오늘의 발제문</b><ol>${
      entry.questions.map((q) => `<li>${esc(q)}</li>`).join('')
    }</ol><span class="muted">한 가지만 골라 [읽고 느낀 점]에 답을 남기면 오늘 인증 완료입니다.</span></div>`;
  }

  function renderTodayRange() {
    const fold = $('todayRangeFold');
    if (!fold) return;
    const plan = CONFIG.readingPlan || [];
    if (!plan.length) {
      $('todayRangeBody').hidden = true;
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
    $('todayRangeText').innerHTML = rangeHtml(plan[rangeDayIdx - 1]) + promptHtml(rangeDayIdx, date);
    $('rangePrevDay').disabled = rangeDayIdx <= 1;
    $('rangeNextDay').disabled = rangeDayIdx >= plan.length;
    $('todayRangeBody').hidden = false;
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

    // 회고 세션: 종료 다음 날 ~ retroUntil. 인증은 닫힌 채로 안내만 띄운다.
    const today = U.today();
    if (CONFIG.retroUntil && today > CONFIG.endDate && today <= CONFIG.retroUntil) {
      const days = U.challengeDates().length;
      box.innerHTML = `<div class="note retro">✍️ <strong>내 글 자산화 기간</strong> (${esc(U.shortLabel(U.addDays(CONFIG.endDate, 1)))} ~ ${esc(U.shortLabel(CONFIG.retroUntil))})<br>`
        + `${days}일 동안 고생 많으셨습니다. 인증은 끝났고, 다음 기수 전까지 이것만 해 보세요.<br>`
        + `① 아래에서 내 이름을 고르고 <strong>[내 기록 전체 복사]</strong>로 ${days}일치 글을 한 번에 가져가기<br>`
        + `② 그중 가장 좋았던 3개를 골라 <strong>블로그·스레드·인스타</strong>에 올리기 — "『${esc(CONFIG.book.name)}』을 읽고 내 브랜드에 적용한 3가지" 같은 제목이면 충분합니다<br>`
        + '③ 책 한 권을 읽고 글 한 편을 남기면, 그게 쌓여 나만의 콘텐츠이자 자산이 됩니다.</div>';
    }

    if (!open) {
      $('submitBtn').disabled = true;
      $('submitBtn').textContent = '기간 외 제출 잠김';
    }
  }


  /* ── 참가자 드롭다운 (이름·초성 검색으로 좁혀볼 수 있음) ── */

  const CHOSUNG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
    'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

  /** '커밍쏜' → 'ㅋㅁㅆ' (한글이 아닌 글자는 그대로 둔다) */
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

  /** 아웃 처리된 이름 옆에 붙일 안내 — 미인증 누적으로 킥아웃된 경우는 '아웃'보다 명확하게 구분해 보여준다. */
  function outSuffix(p) {
    if (p.status !== 'out') return '';
    return p.kickReason === 'kickout' ? ' (킥아웃)' : ' (아웃)';
  }

  /** 화면 뒤의 select에는 항상 전체 명단을 넣어 둔다 — id로 값을 지정하는 코드가 언제든 먹히도록. */
  function syncParticipantSelect() {
    const sel = $('participant');
    const keepId = sel.value;
    sel.innerHTML = '<option value="">— 이름 선택 —</option>';
    for (const p of participants) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = `${p.nickname}${outSuffix(p)}`;
      sel.appendChild(o);
    }
    sel.value = participants.some((p) => p.id === keepId) ? keepId : '';
    syncMeWho();
  }

  /** [내 현황]의 "본인 확인하기" — 이름 드롭다운. 고르면 인증 폼의 이름 칸과 같은 사람으로 맞춘다. */
  function syncMeWho() {
    const who = $('meWho');
    if (!who) return;
    const byName = (a, b) => a.nickname.localeCompare(b.nickname, 'ko');
    const active = participants.filter((p) => p.status !== 'out').sort(byName);
    const out = participants.filter((p) => p.status === 'out').sort(byName);
    who.innerHTML = '<option value="">내 이름을 골라 주세요</option>'
      + active.concat(out).map((p) => `<option value="${esc(p.id)}">${esc(comboLabel(p))}</option>`).join('');
    who.value = $('participant').value || '';
  }

  function comboLabel(p) { return `${p.nickname}${outSuffix(p)}`; }

  /* ── 연속 참여 배지 — 2시즌째부터 이름 옆에 🔥N ──
   * participants/{id}.seasonStreak (명단 업로드 때 앞 시즌 명단과 맞춰 넣는다).
   * 비어 있으면 js/streaks.js(CS.STREAKS — 한 번 채워 둔 id → 수)를 본다. */
  function streakBadge(p) {
    const n = p && (Number(p.seasonStreak) || ((CS.STREAKS || {})[CONFIG.seasonId] || {})[p.id]);
    if (!n || n < 2) return '';
    return `<span class="season-badge" title="${n}시즌 연속 참여">🔥 ${n}</span>`;
  }
  const byId = (pid) => participants.find((x) => x.id === pid);
  const byNick = (nick) => participants.find((x) => x.nickname === nick);

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
          data-pid="${esc(p.id)}">${esc(comboLabel(p))}${streakBadge(p)}</li>`).join('')
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
    paintCertifyDatePicker();
  }

  /* 화면에 보이는 드롭다운. 값은 숨겨 둔 <select>가 그대로 쥐고, 여기서는 그 내용을 비춰
   * 주기만 한다 — macOS가 <select> 글자를 OS 글꼴로 직접 그려서 앱 글꼴과 어긋나 보이기
   * 때문이다. 고르면 select.value를 바꾸고 change를 쏘아 기존 흐름을 그대로 탄다. */
  function paintCertifyDatePicker() {
    const sel = $('certifyDate');
    const cur = [...sel.options].find((o) => o.value === sel.value) || sel.options[0];
    $('certifyDateBtn').textContent = cur ? cur.textContent : '';
    $('certifyDateList').innerHTML = [...sel.options].map((o) =>
      `<li class="picker-option" role="option" data-value="${esc(o.value)}"`
      + ` aria-selected="${o.value === sel.value}">${esc(o.textContent)}</li>`).join('');
  }

  function openCertifyDatePicker(open) {
    $('certifyDateList').hidden = !open;
    $('certifyDatePicker').setAttribute('aria-expanded', String(open));
    $('certifyDateBtn').setAttribute('aria-expanded', String(open));
  }

  function bindCertifyDatePicker() {
    const list = $('certifyDateList');
    $('certifyDateBtn').addEventListener('click', () => openCertifyDatePicker(list.hidden));
    list.addEventListener('click', (e) => {
      const li = e.target.closest('.picker-option');
      if (!li) return;
      const sel = $('certifyDate');
      if (sel.value !== li.dataset.value) {
        sel.value = li.dataset.value;
        sel.dispatchEvent(new Event('change'));
      }
      paintCertifyDatePicker();
      openCertifyDatePicker(false);
      $('certifyDateBtn').focus();
    });
    // 바깥을 누르거나 Esc를 누르면 닫는다
    document.addEventListener('click', (e) => {
      if (!$('certifyDatePicker').contains(e.target)) openCertifyDatePicker(false);
    });
    $('certifyDatePicker').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { openCertifyDatePicker(false); $('certifyDateBtn').focus(); }
    });
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
    if ($('meWho')) $('meWho').value = pid || '';
    const card = $('myCard');
    if (!pid) {
      card.hidden = true; msg($('formMsg'), '');
      await refreshSocialFeed();
      return;
    }

    CS.ShareCard.rememberMe(pid); // 이 기기에서 남의 글을 복사하면 이 사람 이름으로 센다(이번 주 메신저)
    const p = participants.find((x) => x.id === pid);
    populateCertifyDateOptions(p);
    await loadEntryForm(pid, $('certifyDate').value);
    applyOutLock(p);

    await paintMine(pid);
    await refreshSocialFeed();
  }

  /** 아웃(킥아웃 포함) 처리된 이름은 더 이상 인증을 제출할 수 없다 — 폼 자체를 잠근다.
   *  loadEntryForm()이 canSubmitToday() 여부만 보고 버튼을 다시 켜 놓을 수 있어서,
   *  그 뒤에 항상 마지막으로 호출해 잠금 상태를 덮어써야 한다. */
  function applyOutLock(p) {
    if (p && p.status === 'out') {
      $('submitBtn').disabled = true;
      $('submitBtn').textContent = '인증 불가 (참여 종료)';
      msg($('formMsg'), '참여가 종료된 이름입니다. 이 이름으로는 더 이상 인증을 제출할 수 없습니다.', 'bad');
    }
  }

  async function onCertifyDateChange() {
    // 날짜를 먼저 고르는 순서라, 이름을 아직 안 골랐어도 지각 안내는 바로 보여 준다.
    paintCertifyDateWarn($('certifyDate').value);
    const pid = $('participant').value;
    if (!pid) return;
    await loadEntryForm(pid, $('certifyDate').value);
    applyOutLock(participants.find((x) => x.id === pid));
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

  /* ── 내 기록 내보내기 — 블로그·스레드에 바로 붙여 넣을 수 있는 글 형태로 ── */
  let mineForExport = null; // { p, subs }

  function myRecordText(p, subs) {
    const all = subs.slice().sort((a, b) => a.date.localeCompare(b.date));
    const head = [
      `『${CONFIG.book.name}』 ${U.challengeDates().length}일 독서 기록 — ${p.nickname}`,
      `${CONFIG.title} · ${U.shortLabel(CONFIG.startDate)} ~ ${U.shortLabel(CONFIG.endDate)} · ${all.length}개의 기록`,
      ''
    ];
    const body = all.map((s) => {
      const idx = U.dayIndex(s.date);
      return [
        `■ ${idx ? `${idx}일차 · ` : ''}${U.shortLabel(s.date)}`,
        `“${s.sentence}”`,
        s.reflection,
        ''
      ].join('\n');
    });
    return head.concat(body).join('\n').trim() + '\n';
  }

  async function copyMine() {
    if (!mineForExport) return;
    const text = myRecordText(mineForExport.p, mineForExport.subs);
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* noop */ }
      ta.remove();
    }
    msg($('myExportMsg'), `${mineForExport.subs.length}개의 기록을 복사했습니다. 블로그·스레드 글쓰기 창에 붙여 넣으세요.`, 'ok');
  }

  function saveMine() {
    if (!mineForExport) return;
    const text = myRecordText(mineForExport.p, mineForExport.subs);
    const blob = new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${CONFIG.book.name}_독서기록_${mineForExport.p.nickname}.txt`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ── 나의 현황 ───────────────────────── */
  async function paintMine(pid) {
    const p = participants.find((x) => x.id === pid);
    if (!p) return;
    const subs = await Store.listSubmissions({ participantId: pid });
    const stat = U.buildStats([p], subs)[0];

    // 참여자 화면에서 면제일은 따로 세지 않고 '통과'로 본다 — 인증 칸에 합쳐 세고, 인증률도 그 기준으로.
    // (면제 건수·날짜는 운영진 화면에서 따로 확인한다)
    const passed = stat.verified + stat.exempt;
    const myRate = passed + stat.missed ? Math.round((passed / (passed + stat.missed)) * 100) : 0;
    $('myCard').hidden = false;
    $('stVerified').textContent = passed;
    $('stMissed').textContent = stat.missed;
    $('stExempt').textContent = stat.exempt;
    $('stStreak').textContent = stat.streak;
    $('stRate').textContent = `${myRate}%`;

    // 성취감 — 완주율 링 · 연속 · 배지 · 다음 목표 · SNS용 인증 카드 (js/progress-card.js)
    if (CS.Progress) {
      CS.Progress.paint(stat, p, {
        today: U.today(), dayIndex: U.dayIndex, giftMissLimit: CONFIG.giftMissLimit,
        title: CONFIG.title, book: CONFIG.book.name, cover: CONFIG.book.cover,
        tag: `#퍼메스독서멤버십 #${String(CONFIG.book.name).replace(/\s+/g, '')}`,
      });
    }

    const tag = $('myStatusTag');
    const rt = U.riskTag(stat);
    tag.className = `tag ${rt.cls}`;
    tag.textContent = rt.label;

    // 한 줄만 — 킥아웃이 있는 시즌에서만 미인증 횟수를 알린다(나머지는 아래 O/X 칸으로 보인다)
    const left = CONFIG.kickoutThreshold - stat.missed;
    $('myHint').innerHTML = p.status === 'out'
      ? '참여가 종료된 상태입니다. 문의는 운영진에게 남겨 주세요.'
      : (CONFIG.kickoutEnabled && stat.missed
        ? `미인증 <strong>${stat.missed}회</strong> · 킥아웃까지 <strong>${Math.max(0, left)}회</strong>`
        : '');

    // 날짜 스트립 (화면 폭에 맞춰 자동 줄바꿈)
    const strip = $('myStrip');
    strip.innerHTML = stat.cells.map((c) => `
      <div class="strip-cell" title="${esc(U.shortLabel(c.date))} — ${esc(labelOf(c.status))}">
        <span class="cell ${CELL_CLASS[c.status === 'P' ? 'O' : c.status]}">${c.status === '-' ? '·' : (c.status === 'P' ? 'O' : c.status)}</span>
        <span class="d">${Number(c.date.slice(8))}</span>
      </div>`).join('');

    // 전체 기록 — 하루도 빠뜨리지 않고 1일차부터 오늘까지 날짜 순서대로.
    // 낸 날은 글 전체를, 안 낸 날은 "미인증", 면제일은 "통과" 한 줄로 남겨 빈 날이 어디인지 바로 보이게 한다.
    // 챌린지 날짜 밖(연습 기간 등)에 낸 글도 버리지 않고 맨 앞에 함께 둔다.
    const box = $('myEntries');
    const all = subs.slice().sort((a, b) => a.date.localeCompare(b.date));
    const byDate = new Map(all.map((s) => [s.date, s]));
    const inChallenge = new Set(stat.cells.map((c) => c.date));
    const rows = all.filter((s) => !inChallenge.has(s.date)).map(renderEntry);
    let missedRows = 0;
    for (const c of stat.cells) {
      const s = byDate.get(c.date);
      if (s) rows.push(renderEntry(s));
      else if (c.status === 'X') { rows.push(renderGap(c.date, 'X')); missedRows++; }
      else if (c.status === 'P') rows.push(renderGap(c.date, 'P'));
    }
    box.innerHTML = rows.length ? rows.join('') :
      '<div class="empty">아직 제출한 인증이 없습니다.</div>';
    $('myEntriesFold').querySelector('summary').textContent = all.length
      ? `내 인증 기록 ${all.length}건${missedRows ? ` · 미인증 ${missedRows}일` : ''}`
      : '내 인증 기록';

    // 내보내기: 기록이 하나라도 있으면 보인다. 회고 기간엔 "자산화" 문구로 더 크게 권한다.
    mineForExport = { p, subs: all };
    // 지난 시즌을 넘겨 보는 중에는 남의 시즌 기록을 통째로 가져가지 못하게 내려받기 창을 닫아 둔다
    $('myExport').hidden = READONLY || !all.length;
    const inRetro = CONFIG.retroUntil && U.today() > CONFIG.endDate && U.today() <= CONFIG.retroUntil;
    $('myExportHint').innerHTML = inRetro
      ? `✍️ <strong>${all.length}개의 기록이 쌓였습니다.</strong> 한 번에 복사해서 블로그·스레드에 올려 보세요. 내가 쓴 글이 내 콘텐츠이자 자산이 됩니다.`
      : '';
  }

  function labelOf(st) {
    return { O: '인증', X: '미인증', P: '통과', '-': '예정', '·': '집계 대상 아님' }[st] || st;
  }

  /** 글이 없는 날(미인증·통과) — 빈 날도 목록에서 빠지지 않게 한 줄로. 면제일은 참여자에게 '통과'로 보인다. */
  function renderGap(date, status) {
    const idx = U.dayIndex(date);
    return `<div class="entry gap">
      <h4>${idx ? `${idx}일차 · ` : ''}${esc(U.shortLabel(date))}
        <span class="tag ${status === 'X' ? 'bad' : 'ok'}">${status === 'X' ? '미인증' : '통과'}</span>
      </h4>
    </div>`;
  }

  function renderEntry(s) {
    const late = U.isLate(s.date, s.createdAt);
    const idx = U.dayIndex(s.date);
    return `<div class="entry">
      <h4>${idx ? `${idx}일차 · ` : ''}${esc(U.shortLabel(s.date))}
        <span class="tag ${late ? 'bad' : 'ok'}">${late ? '미인증(지각)' : '인증'}</span>
        <span class="muted">${esc(U.stampLabel(s.updatedAt || s.createdAt))} 제출</span>
      </h4>
      <dl>
        <dt>인상 깊은 내용</dt><dd class="quote">${esc(CS.Post.stripQuotes(s.sentence))}</dd>
        <dt>느낀 점</dt><dd>${esc(s.reflection)}</dd>
      </dl>
    </div>`;
  }

  /* ── 인증 피드 & 명예의 전당 ───────────────────── */

  /** 피드에서 고를 수 있는 날짜 범위. 챌린지 시작 전(연습 기간)에는 오늘 하루만. */
  function feedDateBounds() {
    const t = U.today();
    return { lo: t < CONFIG.startDate ? t : CONFIG.startDate, hi: t };
  }

  /** 날짜 고르기 칸: [전체 날짜] + 오늘부터 첫날까지 */
  function paintFeedDateSelect() {
    const sel = $('feedDateSelect');
    if (!sel) return;
    const { lo, hi } = feedDateBounds();
    const today = U.today();
    const dates = [];
    for (let d = hi; d >= lo; d = U.addDays(d, -1)) dates.push(d);
    const key = `${hi}|${lo}`;
    if (sel.dataset.key !== key) {
      sel.innerHTML = '<option value="">전체 날짜</option>' + dates.map((d) => {
        const idx = U.dayIndex(d);
        return `<option value="${d}">${d === today ? '오늘 · ' : ''}${esc(U.shortLabel(d))}${idx ? ` · ${idx}일차` : ''}</option>`;
      }).join('');
      sel.dataset.key = key;
    }
    sel.value = feedDate;
  }

  /** 피드에 올릴 글. 전체 날짜면 한 번 읽어 둔 전체 기록(캐시)에 오늘 글만 새로 읽어 얹는다
   *  — 지난 날짜 글은 거의 바뀌지 않으니 2분마다 전체를 다시 읽지 않는다. */
  async function feedSubs(date) {
    if (date) return (await Store.listSubmissions({ date })).slice();
    await loadAllSubs();
    const fresh = await Store.listSubmissions({ date: U.today() });
    fresh.forEach(upsertAllSubsCache);
    return allSubsCache.slice();
  }

  /** 본인 글인지 (선택된 참여 아이디 기준). 여론 조작 방지를 위해 본인 글은 추천할 수 없다. */
  function isOwnSubmission(s) {
    return !!currentPid && s.participantId === currentPid;
  }

  /* 피드는 2분마다(+화면 복귀 시) 자동으로 다시 그려지는데, 그때마다 전체 목록을 새 HTML로
   * 통째로 갈아 끼우다 보니 [더 보기]로 펼쳐 둔 긴 글도 매번 접힌 상태로 되돌아갔다
   * — 남의 글을 읽던 중 2분이 지나거나 다른 앱을 갔다 오면 저절로 접혀 버리는 문제였다.
   * 펼쳐 둔 글의 id를 따로 기억해 뒀다가, 다시 그릴 때 그대로 열어 둔다(CS.Post.fit). */
  const feedOpenIds = new Set();
  // 긴 글 접기는 화면에 보이는 폭으로 재므로, 피드 탭이 열리거나 화면 폭이 바뀌면 다시 잰다.
  const refitFeed = () => CS.Post.fit($('socialFeedList'), feedOpenIds);
  document.addEventListener('cs:tab', refitFeed);
  let refitTimer = null;
  window.addEventListener('resize', () => { clearTimeout(refitTimer); refitTimer = setTimeout(refitFeed, 150); });

  function bindUpvoteButtons(container) {
    if (READONLY) return; // 지난 시즌을 들여다보는 중 — 기록을 바꾸지 않는다
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
          // 전체 날짜로 보는 중 지난 날짜 글을 추천했다면 그날 기록만 새로 읽어 캐시에 반영한다
          if (btn.dataset.date && btn.dataset.date !== U.today() && allSubsCache) {
            (await Store.listSubmissions({ date: btn.dataset.date })).forEach(upsertAllSubsCache);
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
    const btnAttr = READONLY
      ? 'disabled title="지난 시즌 기록이라 추천할 수 없습니다"'
      : (own ? 'disabled title="본인 글은 추천할 수 없습니다"' : '');
    // 스레드처럼 한 글이 폭을 통째로 쓴다 — 이름 줄 / 본문 / 맨 아래 버튼 한 줄 (js/post.js)
    return `<article class="feed-item post${isWinner ? ' win' : ''}">
      <div class="post-head">
        ${CS.Post.avatar(s.nickname)}
        <div class="feed-top">
          <span class="feed-nick">${isWinner ? '👑 ' : ''}${esc(s.nickname)}${streakBadge(byId(s.participantId) || byNick(s.nickname))}</span>
          ${late ? '<span class="tag bad">지각</span>' : ''}
          <span class="feed-time" title="${esc(U.stampLabel(s.updatedAt || s.createdAt))}">${esc(CS.Post.when(s.updatedAt || s.createdAt))}</span>
        </div>
      </div>
      <div class="feed-main">
        ${CS.Post.body(s, feedOpenIds.has(s.id))}
      </div>
      <div class="feed-acts">
        <button type="button" class="${btnClass}" data-id="${esc(s.id)}" data-date="${esc(s.date)}"
          ${btnAttr} aria-label="엄지척 ${s.upvotes || 0}개, ${hasUpvoted ? '눌러서 취소' : '눌러서 추천'}">${U.icon('thumb')}${s.upvotes || 0}</button>
        <button type="button" class="share-btn" data-share
          data-nickname="${esc(s.nickname)}" data-date="${esc(s.date)}"
          data-sentence="${esc(s.sentence)}" data-reflection="${esc(s.reflection)}"
          data-winner="${isWinner ? '1' : ''}"${READONLY ? '' : ` data-id="${esc(s.id)}" data-author="${esc(s.participantId)}"`}
          aria-label="텍스트 복사" title="텍스트 복사">${U.icon('copy')}<span class="lbl">텍스트 복사</span></button>
      </div>
    </article>`;
  }

  function sortFeedDay(list) {
    // 정렬: 추천 많은순(기본) | 최신순. 동점·동시각이면 먼저 올린 사람이 위로.
    if (feedSort === 'recent') {
      return list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    }
    return list.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0) ||
      String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  async function refreshSocialFeed() {
    const date = feedDate;
    const subs = await feedSubs(date);
    const today = U.today();
    paintFeedDateSelect();

    // 날짜별로 묶어 최신 날짜부터. 그날 1등(가장 많이 추천된 사람, 공동 1등 모두)은 정렬·검색과
    // 무관하게 왕관을 단다 — 검색으로 걸러내기 전의 그날 전체를 기준으로 뽑는다.
    const byDate = new Map();
    for (const x of subs) {
      if (!byDate.has(x.date)) byDate.set(x.date, []);
      byDate.get(x.date).push(x);
    }
    const winnerIds = new Set();
    const groups = [...byDate.keys()].sort().reverse().map((d) => {
      const day = sortFeedDay(byDate.get(d));
      const maxVotes = day.reduce((m, x) => Math.max(m, x.upvotes || 0), 0);
      if (maxVotes > 0) day.filter((x) => (x.upvotes || 0) === maxVotes).forEach((x) => winnerIds.add(x.id));
      const shown = feedSearch ? day.filter((x) => nicknameMatches(x.nickname, feedSearch)) : day;
      return { date: d, shown };
    });
    const total = subs.length;
    const shownTotal = groups.reduce((n, g) => n + g.shown.length, 0);
    const unit = date ? '명' : '건';
    $('feedCount').textContent = feedSearch ? `${shownTotal}${unit} / ${total}${unit}` : `${total}${unit}`;

    const feedList = $('socialFeedList');
    const moreWrap = $('feedLoadMoreWrap');
    if (!shownTotal) {
      const isToday = date === today;
      feedList.innerHTML = total
        ? `<div class="empty">'${esc(feedSearch)}'와(과) 맞는 이름이 ${date ? '이 날짜에 ' : ''}없습니다.</div>`
        : `<div class="empty">${date ? `${isToday ? '오늘' : U.shortLabel(date) + '에'} ` : '아직 '}제출된 인증글이 없습니다.` +
          `${!date || isToday ? ' 첫 번째 글을 작성해 보세요!' : ''}</div>`;
      moreWrap.hidden = true;
      return;
    }

    // 정해진 개수만큼만 그리고 나머지는 [더 보기]. 전체 날짜일 때는 날짜마다 머리줄을 단다.
    let left = feedVisibleCount;
    const html = [];
    for (const g of groups) {
      if (left <= 0) break;
      if (!g.shown.length) continue;
      if (!date) {
        const idx = U.dayIndex(g.date);
        html.push(`<h3 class="feed-day">${g.date === today ? '오늘 · ' : ''}${esc(U.shortLabel(g.date))}${idx ? ` <span>${idx}일차</span>` : ''}</h3>`);
      }
      g.shown.slice(0, left).forEach((x) => {
        html.push(renderFeedItem(x, winnerIds.has(x.id), (x.upvotedBy || []).includes(clientId)));
      });
      left -= g.shown.length;
    }
    feedList.innerHTML = html.join('');
    bindUpvoteButtons(feedList);
    CS.Post.fit(feedList, feedOpenIds);
    CS.ShareCard.bindButtons(feedList, { title: CONFIG.title, dateLabel: date ? U.shortLabel(date) : '' });

    const remaining = shownTotal - Math.min(shownTotal, feedVisibleCount);
    if (remaining > 0) {
      moreWrap.hidden = false;
      $('feedLoadMoreBtn').textContent = `더 보기 (${remaining}${unit} 더 남음)`;
    } else {
      moreWrap.hidden = true;
    }
  }

  /* ── 이번 주 인기 게시자 · 메신저 ──────────
   * 일요일 0시(KST)가 되면 막 끝난 주(월~토)의 두 상을 발표한다. 그 주에 처음 들어오면 두 상을 한 장에
   * 담은 축하 카드가 화면 가득 한 번 뜨고(기기마다 한 주에 한 번), 피드 맨 위에는 다음 일요일까지 요약이 남는다.
   * 피드가 이미 읽어 둔 전체 기록(allSubsCache)으로 계산하므로 Firestore를 따로 읽지 않는다. */
  const AWARD_SEEN_KEY = `${CONFIG.storagePrefix}.awardSeen`;
  let awardItems = [];
  let awardRange = null;

  function awardList(awards) {
    return [
      ...awards.popular.map((w) => ({
        kind: 'popular', title: '이번 주 인기 게시자', emoji: '🏆', nickname: w.nickname, count: w.people || w.likes,
        text: `이번 주의 인기 게시자로 <strong>${esc(w.nickname)}님</strong>이 선정되셨습니다. ` +
          `1주일간 ${w.people || w.likes}분에게 좋아요를 받으셨습니다. ` +
          `앞으로도 좋은 인사이트 공유해주세요. 감사합니다. ${esc(w.nickname)}님`
      })),
      ...awards.messenger.map((w) => ({
        kind: 'messenger', title: '이번 주 메신저', emoji: '💌', nickname: w.nickname, count: w.authors,
        text: `이번 주의 메신저로 <strong>${esc(w.nickname)}님</strong>이 선정되셨습니다. ` +
          `1주일간 ${w.authors}분의 글을 공유해주셨습니다. ` +
          `덕분에 좋은 글을 함께 볼 수 있었습니다. 감사합니다 ${esc(w.nickname)}님.`
      }))
    ];
  }

  /** 올림픽 메달 — 엇갈린 리본에 매달린 둥근 금메달, 테두리 안쪽에 월계수, 가운데 숫자("N분"의 N).
   *  리본 색으로 상을 구분한다(인기 게시자 빨강 · 메신저 파랑). */
  function awardMedal(item, i) {
    const ribbon = item.kind === 'popular' ? ['#d62839', '#a3162a'] : ['#1f6fd1', '#14509c'];
    const cx = 80, cy = 146;
    const leaves = [];
    const leaf = (deg) => {
      const r = 37, a = deg * Math.PI / 180;
      const x = (cx + r * Math.cos(a)).toFixed(1), y = (cy + r * Math.sin(a)).toFixed(1);
      leaves.push(`<ellipse cx="${x}" cy="${y}" rx="5.2" ry="2.3" transform="rotate(${deg + 90 + (deg > 90 && deg < 270 ? -35 : 35)} ${x} ${y})"/>`);
    };
    for (let d = 110; d <= 235; d += 18) leaf(d);  // 왼쪽 가지(아래에서 위로)
    for (let d = 70; d >= -55; d -= 18) leaf(d);   // 오른쪽 가지
    const sp = (x, y, r) => `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z"/>`;
    return `<svg class="award-medal" viewBox="0 0 160 206" aria-hidden="true">
      <defs>
        <radialGradient id="medalFace${i}" cx="38%" cy="32%" r="75%">
          <stop offset="0" stop-color="#fff6c9"/><stop offset=".45" stop-color="#f7cf4b"/><stop offset="1" stop-color="#c58b14"/></radialGradient>
        <linearGradient id="medalRim${i}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ffe58a"/><stop offset=".5" stop-color="#d79c1c"/><stop offset="1" stop-color="#9c6a08"/></linearGradient>
      </defs>
      <g class="award-sparkle">${sp(18, 118, 8)}${sp(144, 104, 6)}${sp(146, 190, 7)}<circle cx="16" cy="182" r="3.5"/><circle cx="150" cy="140" r="3"/></g>
      <polygon points="22,0 56,0 94,96 70,104" fill="${ribbon[1]}"/>
      <polygon points="31,0 47,0 85,99 77,101" fill="#fff" opacity=".85"/>
      <polygon points="138,0 104,0 66,96 90,104" fill="${ribbon[0]}"/>
      <polygon points="129,0 113,0 75,99 83,101" fill="#fff" opacity=".85"/>
      <rect x="66" y="88" width="28" height="12" rx="3" fill="url(#medalRim${i})"/>
      <circle cx="${cx}" cy="${cy + 2}" r="54" fill="rgba(0,0,0,.18)"/>
      <circle cx="${cx}" cy="${cy}" r="54" fill="url(#medalRim${i})"/>
      <circle cx="${cx}" cy="${cy}" r="46" fill="url(#medalFace${i})"/>
      <circle cx="${cx}" cy="${cy}" r="46" fill="none" stroke="#a87410" stroke-opacity=".45" stroke-width="1.5"/>
      <g class="award-laurel">${leaves.join('')}</g>
      <ellipse cx="62" cy="122" rx="20" ry="9" transform="rotate(-30 62 122)" fill="#fff" opacity=".35"/>
      <text class="award-num" x="${cx}" y="${cy + 11}" text-anchor="middle">${item.count}<tspan class="award-unit" dx="1">분</tspan></text>
    </svg>`;
  }

  /** 두 상(동점이면 모두)을 한 장에 나란히 — 넘겨 봐야 하면 첫 장만 보고 닫기 쉽다. */
  function awardCardHtml() {
    return `<section class="award-card">
      <div class="award-brand">${esc(CONFIG.title)}</div>
      <h3 class="award-title">이번 주 시상</h3>
      <div class="award-date">${esc(U.shortLabel(awardRange.from))} ~ ${esc(U.shortLabel(awardRange.to))}</div>
      <div class="award-podium">${awardItems.map((x, i) => `<div class="award-winner">
        ${awardMedal(x, i)}
        <div class="award-kind-label">${esc(x.title.replace('이번 주 ', ''))}</div>
        <div class="award-who">${CS.Post.avatar(x.nickname)}<span>${esc(x.nickname)}님</span></div>
      </div>`).join('')}</div>
      <div class="award-msgs">${awardItems.map((x) => `<p class="award-msg"><span class="award-msg-kind">${x.emoji} ${esc(x.title)}</span>${x.text}</p>`).join('')}</div>
    </section>`;
  }

  function closeAwardModal() {
    const m = $('awardModal');
    if (!m) return;
    m.remove();
    document.body.classList.remove('award-open');
    document.removeEventListener('keydown', awardKeydown);
  }
  function awardKeydown(e) { if (e.key === 'Escape') closeAwardModal(); }

  function openAwardModal() {
    if (!awardItems.length) return;
    closeAwardModal();
    const m = document.createElement('div');
    m.id = 'awardModal';
    m.className = 'award-modal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-label', '이번 주 시상');
    m.tabIndex = -1;
    m.innerHTML = `<button type="button" class="award-close" aria-label="닫기"><svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg></button>
      ${awardCardHtml()}`;
    document.body.appendChild(m);
    document.body.classList.add('award-open');
    m.querySelector('.award-close').addEventListener('click', closeAwardModal);
    m.addEventListener('click', (e) => { if (e.target === m) closeAwardModal(); });
    document.addEventListener('keydown', awardKeydown);
    m.focus(); // 키보드·화면낭독기 초점을 팝업 안으로(닫기 버튼에 테두리가 뜨지 않게 팝업 자체에)
  }

  async function paintWeeklyAwards() {
    const box = $('weeklyAwards');
    if (!box) return;
    awardRange = U.lastAwardWeek();
    awardItems = awardRange ? awardList(U.weeklyAwards(await loadAllSubs(), awardRange, participants)) : [];
    box.hidden = !awardItems.length;
    box.innerHTML = awardItems.length
      ? `<div class="award-range">${esc(U.shortLabel(awardRange.from))} ~ ${esc(U.shortLabel(awardRange.to))} 이번 주 소식</div>` +
        awardItems.map((x) => `<div class="award"><div class="award-kind">${x.emoji} ${esc(x.title)}</div><p>${x.text}</p></div>`).join('') +
        '<div><button type="button" class="small award-open-btn" data-award-open>🎉 축하 카드 보기</button></div>'
      : '';
    const btn = box.querySelector('[data-award-open]');
    if (btn) btn.addEventListener('click', openAwardModal);

    // 이 기기에서 이번 발표를 처음 보는 거라면 축하 카드를 한 번 띄운다.
    if (!awardItems.length || READONLY) return;
    let seen = '';
    try { seen = localStorage.getItem(AWARD_SEEN_KEY) || ''; } catch (e) { /* 저장 불가 환경 */ }
    if (seen >= awardRange.to) return;
    try { localStorage.setItem(AWARD_SEEN_KEY, awardRange.to); } catch (e) { /* 저장 불가 환경 */ }
    openAwardModal();
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
          data-winner="${item.rank === 1 ? '1' : ''}"${READONLY ? '' : ` data-id="${esc(item.id)}" data-author="${esc(item.participantId)}"`}
          aria-label="텍스트 복사" title="텍스트 복사">${U.icon('copy')}<span class="lbl">텍스트 복사</span></button>
      </div>
      <div class="fame-entry">
        <div class="fame-entry-label">인상 깊은 내용</div>
        <blockquote class="quote">${esc(CS.Post.stripQuotes(item.sentence))}</blockquote>
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
          `<span class="who">${esc(item.nickname)}${streakBadge(byNick(item.nickname))}</span>` +
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
  // 명예의 전당은 일자별로 넘겨 볼 수 있다 — 기본은 어제(마감이 지나 확정된 가장 최근 날),
  // ◀로 챌린지 첫날까지 거슬러 갈 수 있다. 오늘은 아직 추천이 늘고 있으니 인증 피드에서 본다.
  let fameDate = null;
  function fameBounds() {
    const hi = U.lastSettledDate();
    return { lo: CONFIG.startDate, hi };
  }
  function shiftFameDate(delta) {
    const { lo, hi } = fameBounds();
    if (!hi) return;
    const next = U.addDays(fameDate || hi, delta);
    if (next < lo || next > hi) return;
    fameDate = next;
    fameOpenName = null;
    calculateRanksAndFame();
  }

  async function calculateRanksAndFame() {
    const { lo, hi } = fameBounds();
    if (!hi) fameDate = null;
    else if (!fameDate || fameDate > hi || fameDate < lo) fameDate = hi;
    const date = fameDate; // 기본은 어제 (챌린지 첫날이라 어제가 없으면 null)
    const daySubs = date ? await Store.listSubmissions({ date }) : [];
    const isLatest = !!date && date === hi;

    $('fameDateLabel').textContent = date ? `${U.shortLabel(date)}에` : '어제';
    const nav = $('fameDateNav');
    if (nav) {
      nav.hidden = !date;
      $('fameNavLabel').textContent = date
        ? `${U.dayIndex(date) ? `${U.dayIndex(date)}일차 · ` : ''}${U.shortLabel(date)}${isLatest ? ' · 어제' : ''}`
        : '-';
      $('famePrevDate').disabled = !date || date <= lo;
      $('fameNextDate').disabled = !date || date >= hi;
    }
    const tag = $('fameTag');
    if (tag) tag.textContent = isLatest || !date ? '전일 Top 5' : 'Top 5';
    fameEmptyMsg = date
      ? (isLatest ? '전일 인증글 중 추천받은 글이 없습니다.' : '이 날 인증글 중 추천받은 글이 없습니다.')
      : '아직 집계할 전일 기록이 없습니다.';

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
      return { id: s.id, participantId: s.participantId, nickname: s.nickname, votes, rank, date: s.date, sentence: s.sentence, reflection: s.reflection };
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
  let ovRiskDetail = [];  // 세 번째 타일의 명단 [{nickname, missed, kickout}] — 누락 많은 순

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
    // 이름만으로는 얼마나 밀렸는지 알 수 없으므로 누적 미인증 횟수를 함께 보여준다.
    box.innerHTML = `<strong>${esc(RISK_TILE.label)} (${ovRiskDetail.length}명)</strong>
      <span class="muted">${esc(RISK_TILE.note)}</span>
      <div class="ov-chips">${ovRiskDetail.length
        ? ovRiskDetail.map((r) => `<span class="ov-chip${r.kickout ? ' out' : ''}">${esc(r.nickname)}<b>${r.missed}회</b></span>`).join('')
        : '<span class="muted">해당하는 사람이 없습니다.</span>'}</div>`;
  }

  function toggleOvDetail(key) {
    ovOpenKey = ovOpenKey === key ? null : key;
    $('ovPrevMissTile').setAttribute('aria-expanded', String(ovOpenKey === 'miss'));
    $('ovRiskTile').setAttribute('aria-expanded', String(ovOpenKey === 'risk'));
    renderOvDetail();
  }

  let overallStats = [];       // paintOverall()이 채워 두는 원본 통계(정렬 전) — 정렬만 바꿀 때 재사용
  let overallSort = 'rate';    // 'rate' 인증률순 | 'name-asc' 이름순 | 'name-desc' 이름 역순

  /* "전체 진행현황"은 모든 참여자의 전체 인증 기록(submissions 전체)이 있어야 계산할 수 있다.
   * 이 화면을 열 때마다, 특히 "인증 제출하기"를 누를 때마다 매번 전체를 다시 읽으면 챌린지가
   * 진행될수록(기록이 쌓일수록) Firestore 읽기 비용이 눈덩이처럼 불어난다 — 한 번 읽어서 탭에
   * 캐시해 두고, 내가 방금 제출한 기록만 캐시에 직접 반영해서 다시 읽지 않고도 최신 상태를
   * 보여준다. 다른 사람의 새 기록까지 보려면 [🔄 새로고침] 버튼으로 명시적으로 다시 읽는다. */
  let allSubsCache = null;

  async function loadAllSubs(force) {
    if (force || !allSubsCache) allSubsCache = await Store.listSubmissions();
    return allSubsCache;
  }

  function upsertAllSubsCache(sub) {
    if (!allSubsCache) return;
    const idx = allSubsCache.findIndex((s) => s.participantId === sub.participantId && s.date === sub.date);
    if (idx >= 0) allSubsCache[idx] = sub; else allSubsCache.push(sub);
  }

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
        <td>${esc(p.nickname)}${streakBadge(p)}</td>
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

  async function paintOverall(opts) {
    if (!participants.length) {
      $('overallCount').textContent = '0명';
      $('overallTable').innerHTML = '<tbody><tr><td class="empty">등록된 참가자가 없습니다.</td></tr></tbody>';
      return;
    }
    const allSubs = await loadAllSubs(opts && opts.force);
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

    // 킥아웃이 있는 시즌: 누적 미인증이 riskThreshold회 이상인 사람 전부(이미 킥아웃 대상인
    // 사람도 포함) — 아래 표의 '위험'·'킥아웃 대상' 태그로 그중 실제 심각도를 구분해서 보여준다.
    // 킥아웃이 없는 시즌: 위험이라는 개념 자체가 없으므로, 누락이 한 번이라도 있는 사람을 모은다.
    const riskZone = CONFIG.kickoutEnabled
      ? active.filter((s) => s.atRisk)
      : active.filter((s) => s.missed > 0);

    ovLists = { miss: prevMissed.map((s) => s.participant.nickname).sort(byKo),
      risk: riskZone.map((s) => s.participant.nickname).sort(byKo) };
    // 위험한 순서(누락 많은 순)로 놓고, 같으면 이름순
    ovRiskDetail = riskZone
      .map((s) => ({ nickname: s.participant.nickname, missed: s.missed, kickout: s.kickoutEligible }))
      .sort((a, b) => b.missed - a.missed || byKo(a.nickname, b.nickname));
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
    if (p && p.status === 'out') {
      msg($('formMsg'), '참여가 종료된 이름입니다. 이 이름으로는 더 이상 인증을 제출할 수 없습니다.', 'bad');
      applyOutLock(p);
      return;
    }

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
      upsertAllSubsCache(saved); // 방금 저장한 내 기록만 캐시에 반영 — 전체를 다시 읽지 않아도 된다
      await paintOverall();
      if (feedDate && feedDate !== date) feedDate = date; // 날짜를 골라 보던 중이면 방금 낸 날짜로
      feedVisibleCount = FEED_PAGE_SIZE;
      await refreshSocialFeed();
      await calculateRanksAndFame();
      // 휴대폰 탭 화면(js/tabs.js)은 이 신호를 받아 "피드 보기 · 내 현황 보기" 바로가기를 띄운다.
      document.dispatchEvent(new CustomEvent('cs:submitted', { detail: { late } }));
      $('myCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      msg($('formMsg'), `저장 실패: ${esc(err.message)}`, 'bad');
    } finally {
      $('submitBtn').disabled = false;
    }
  }

  /* ── 초기화 ──────────────────────────── */
  /* 지난 시즌을 볼 수 있는지 판단한다.
   *  - 잠기지 않았으면 평소대로.
   *  - 잠겼고 운영진이 "읽기 전용 공개"를 켜 뒀으면 보기만 가능.
   *  - 잠겼는데 공개도 아니면 화면을 열지 않고 안내만 남긴다(운영진 화면에서 볼 수 있다).
   * 반환값 false = 이 화면을 더 그리지 않는다.
   */
  /* 운영진이 공개해 둔 지난 시즌 목록(meta/seasonFlags) — 문서 하나라 한 번만 읽어 둔다 */
  let flagsPromise = null;
  function seasonFlags() {
    if (!flagsPromise) flagsPromise = Store.getSeasonFlags().catch(() => ({}));
    return flagsPromise;
  }

  /* 책 소개 카드 양옆 화살표 — 이미 시작한 시즌 중 참여자가 볼 수 있는 시즌으로만 넘긴다
   * (설정에 browsable: true 인 시즌, 또는 운영진이 "지난 시즌 공개"를 켜 둔 시즌, 그리고 지금 시즌).
   * 지금 시즌에서는 다음 시즌이 아직 없으니 오른쪽 화살표가 없다.
   * 링크로 페이지를 새로 여는 방식이라 화살표를 누르기 전까지는 지난 시즌 데이터를 하나도 읽지 않는다. */
  async function paintShelf() {
    const flags = await seasonFlags();
    const open = Array.isArray(flags.openSeasons) ? flags.openSeasons : [];
    const now = CS.seasonNowKST();
    const auto = CS.pickSeason(now);
    const started = CS.SEASONS.filter((x) => !x.startsAt || x.startsAt <= now);
    const viewable = started.filter((x) => x.id === CS.SEASON.id || x.id === auto.id
      || x.browsable || open.includes(x.id));
    const i = viewable.findIndex((x) => x.id === CS.SEASON.id);
    if (i < 0) return;
    const chev = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
    const set = (el, target, dir) => {
      if (!target) { el.hidden = true; return; }
      // #info — 넘어가서도 같은 자리(책 소개)에서 바로 이어 넘길 수 있게
      el.href = (target.id === auto.id ? 'index.html' : `index.html?season=${encodeURIComponent(target.id)}`) + '#info';
      const label = `${dir === 'prev' ? '이전' : '다음'} 시즌 책 『${target.book.name}』 보기`;
      el.setAttribute('aria-label', label);
      el.title = label;
      el.innerHTML = chev(dir === 'prev' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7');
      el.hidden = false;
    };
    set($('shelfPrev'), viewable[i - 1], 'prev');
    set($('shelfNext'), viewable[i + 1], 'next');
  }

  async function applySeasonLock() {
    if (!CS.seasonLocked(CS.SEASON)) return true;

    const flags = await seasonFlags(); // 못 읽으면 빈 값 → 잠긴 것으로 본다
    const opened = CS.SEASON.browsable
      || (Array.isArray(flags.openSeasons) && flags.openSeasons.includes(CS.SEASON.id));

    const banner = $('seasonBanner');
    banner.hidden = false;
    if (!opened) {
      // 기록은 그대로 있고, 다만 이 화면에서 열지 않는다.
      document.querySelector('main.wrap').innerHTML = '';
      document.querySelector('main.wrap').appendChild(banner);
      msg(banner, `<strong>${esc(CONFIG.title)} · ${esc(CONFIG.book.name)}</strong> 시즌은 종료되었습니다.<br>`
        + '기록은 그대로 보관되어 있습니다. 예전 인증 내용이 필요하시면 운영진에게 말씀해 주세요.<br>'
        + '<a href="index.html">현재 진행 중인 시즌 보기</a>', 'warn');
      return false;
    }

    READONLY = true;
    // 지난 시즌 둘러보기에서는 책 소개 · 인증 피드 · 명예의 전당만 — 누락·킥아웃·진행현황·개인 현황은 감춘다
    document.body.classList.add('season-browse');
    if (!['info', 'feed', 'fame'].includes((location.hash || '').slice(1))) location.hash = 'info';
    msg(banner, `<strong>지난 시즌 『${esc(CONFIG.book.name)}』 둘러보기</strong> · 읽기 전용<br>`
      + '그때 멤버들이 남긴 인사이트를 [피드]에서 볼 수 있어요. '
      + '<a href="index.html#info">지금 시즌으로 돌아가기</a>', 'warn');
    $('certifyCard').hidden = true;
    return true;
  }

  async function boot() {
    await Store.init();
    if (!(await applySeasonLock())) return;
    paintIntro();
    paintShelf().catch(console.error);
    paintHeader();
    renderTodayRange();
    $('rangePrevDay').addEventListener('click', () => shiftRangeDay(-1));
    $('myCopyAll').addEventListener('click', copyMine);
    $('mySaveAll').addEventListener('click', saveMine);
    $('rangeNextDay').addEventListener('click', () => shiftRangeDay(1));
    paintPhase();
    tickCountdown();
    setInterval(tickCountdown, 1000);
    populateCertifyDateOptions(null);
    paintCertifyDateWarn($('certifyDate').value);
    await loadParticipants();

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
    $('meWho').addEventListener('change', (e) => {
      const p = participants.find((x) => x.id === e.target.value);
      if (p) pickParticipant(p);
      else { $('participant').value = ''; $('participantSearch').value = ''; $('participant').dispatchEvent(new Event('change')); }
    });
    bindParticipantCombo();
    $('certifyDate').addEventListener('change', onCertifyDateChange);
    bindCertifyDatePicker();
    $('verifyForm').addEventListener('submit', onSubmit);
    ['sentence', 'reflection'].forEach((k) =>
      $(k).addEventListener('input', saveDraft));
    ['sentence', 'reflection'].forEach((k) =>
      $(k).addEventListener('input', () => autoGrow($(k))));

    // 피드 날짜 고르기 (기본은 전체 날짜) · 명예의 전당 날짜 넘기기
    $('feedDateSelect').addEventListener('change', (e) => {
      feedDate = e.target.value;
      feedVisibleCount = FEED_PAGE_SIZE;
      refreshSocialFeed();
    });
    $('famePrevDate').addEventListener('click', () => shiftFameDate(-1));
    $('fameNextDate').addEventListener('click', () => shiftFameDate(1));
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

    // 피드 갱신: 수동 버튼(전체 재집계) + 화면이 보이는 동안 "오늘" 볼 때만 주기적 갱신
    // (명예의 전당도 하루치만 읽으므로 함께 갱신한다 — 추천이 들어오면 순위가 바로 따라간다)
    $('feedRefresh').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await loadAllSubs(true); // 수동 새로고침은 다른 사람의 새 기록까지 진짜로 다시 읽는다
        await refreshSocialFeed();
        await paintWeeklyAwards();
        await calculateRanksAndFame();
        await paintOverall();
      } finally { btn.disabled = false; }
    });
    const pollFeed = () => {
      if (document.visibilityState !== 'visible') return;
      // 피드는 '오늘'을 보고 있을 때만, 명예의 전당(전일 기준)은 어느 날짜를 보고 있든 갱신한다
      // — 지난 날짜 피드에서 추천을 누르면 전일 순위가 바뀔 수 있기 때문이다.
      if (!feedDate || feedDate === U.today()) refreshSocialFeed().catch(console.error);
      calculateRanksAndFame().catch(console.error);
    };
    setInterval(pollFeed, 120000);
    document.addEventListener('visibilitychange', pollFeed);

    // 피드(전체 날짜·글 천여 건)·명예의 전당·진행현황은 손을 바로 쓸 수 있게 한 다음에 그린다.
    // (예전엔 이걸 다 그린 뒤에야 이름 고르기·검색 같은 손길에 반응해서, 느린 폰·카톡 브라우저에서
    //  이름을 골라도 아무 일이 안 일어났다)
    await refreshSocialFeed();
    await paintWeeklyAwards();
    await calculateRanksAndFame();
    if (!READONLY) await paintOverall();

    // 실시간 동기화
    window.addEventListener('storage', async (e) => {
      if (e.key && e.key.startsWith(CONFIG.storagePrefix)) {
        const keep = $('participant').value;
        await loadParticipants();
        if (keep) { $('participant').value = keep; await onSelect(); }
        await refreshSocialFeed();
        await calculateRanksAndFame();
        await paintOverall({ force: true });
      }
    });
  }

  boot().catch((err) => {
    console.error(err);
    msg($('formMsg'), `초기화 실패: ${err.message}`, 'bad');
  });
})();
