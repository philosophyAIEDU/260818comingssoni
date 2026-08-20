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
  let allFeedVisibleCount = FEED_PAGE_SIZE;
  let feedTab = 'date';
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

  /** 오늘 인증을 제출할 수 있는지
   *  기본은 챌린지 기간 안에서만 허용. CONFIG.allowSubmitOutsidePeriod 가 true 면
   *  시작 전·종료 후에도 제출할 수 있다(시연·테스트용).
   */
  function canSubmitToday() {
    return CONFIG.allowSubmitOutsidePeriod === true || U.phase() === 'running';
  }


  function paintPhase() {
    const p = U.phase();
    const box = $('phaseNote');
    const open = canSubmitToday();
    const introNote = $('introPhaseNote');

    if (p === 'before') {
      const d = U.diffDays(U.today(), CONFIG.startDate);
      msg(box, '');
      msg(introNote, `챌린지는 <strong>${U.longLabel(CONFIG.startDate)}</strong>에 시작합니다. (D-${d}) ` +
        `OT는 ${U.longLabel(CONFIG.otAt.slice(0, 10))} 오전 10시입니다. ` +
        (open
          ? '지금 올리는 인증은 <strong>연습용</strong>이며 집계에는 반영되지 않습니다.'
          : '인증은 시작일부터 제출할 수 있어요.'), 'info');
    } else if (p === 'after') {
      msg(box, `챌린지가 <strong>${U.longLabel(CONFIG.endDate)}</strong>에 종료되었습니다. ` +
        `4주간 고생 많으셨습니다! 🎉 아래에서 이름을 선택하면 나의 최종 기록을 볼 수 있습니다.`, 'ok');
      msg(introNote, '');
    } else {
      msg(box, '');
      msg(introNote, '');
    }

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

  /** 검색어에 맞는 닉네임만 남기고 드롭다운을 다시 그린다.
   *  이미 선택되어 있던 사람은 검색어와 안 맞아도 목록에서 사라지지 않는다. */
  function renderParticipantOptions() {
    const sel = $('participant');
    const keepId = sel.value;
    const term = $('participantSearch').value.trim().toLowerCase();
    const matches = (nick) => nicknameMatches(nick, term);
    // 앞부분이 맞는 이름을 위로 (같은 순위면 원래의 가나다순 유지)
    const byRank = (a, b) => matchRank(b.nickname, term) - matchRank(a.nickname, term);

    let activeList = participants.filter((p) => p.status !== 'out' && matches(p.nickname)).sort(byRank);
    let outList = participants.filter((p) => p.status === 'out' && matches(p.nickname)).sort(byRank);

    const kept = participants.find((p) => p.id === keepId);
    if (kept && kept.status !== 'out' && !activeList.some((p) => p.id === kept.id)) activeList = [kept, ...activeList];
    if (kept && kept.status === 'out' && !outList.some((p) => p.id === kept.id)) outList = [kept, ...outList];

    sel.innerHTML = '<option value="">— 이름 선택 —</option>';
    for (const p of activeList) {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = p.nickname;
      sel.appendChild(o);
    }
    if (outList.length) {
      const g = document.createElement('optgroup');
      g.label = '참여 종료';
      for (const p of outList) {
        const o = document.createElement('option');
        o.value = p.id; o.textContent = `${p.nickname} (아웃)`;
        g.appendChild(o);
      }
      sel.appendChild(g);
    }
    sel.value = kept ? kept.id : '';

    const count = activeList.length + outList.length;
    $('participantSearch').title = term ? `'${term}' 검색 결과 ${count}명` : '';
  }

  async function loadParticipants() {
    participants = await Store.listParticipants();
    renderParticipantOptions();

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
      const label = idx ? `${idx}일차 (${U.shortLabel(d)})` : `${U.shortLabel(d)} (연습)`;
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
      await refreshAllFeed();
      return;
    }

    const p = participants.find((x) => x.id === pid);
    populateCertifyDateOptions(p);
    await loadEntryForm(pid, $('certifyDate').value);

    await paintMine(pid);
    await refreshSocialFeed();
    await refreshAllFeed();
  }

  async function onCertifyDateChange() {
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
    if (p.status === 'out') { tag.className = 'tag bad'; tag.textContent = '아웃'; }
    else if (stat.atRisk) { tag.className = 'tag bad'; tag.textContent = '킥아웃 대상'; }
    else { tag.className = 'tag ok'; tag.textContent = '참여중'; }

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
          await refreshAllFeed();
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
    return `<article class="feed-item${isWinner ? ' win' : ''}">
      <div class="feed-top">
        <span class="feed-nick">${isWinner ? '👑 ' : ''}${esc(s.nickname)}</span>
        ${late ? '<span class="tag bad">지각</span>' : ''}
        <span class="feed-time">${esc(U.stampLabel(s.updatedAt || s.createdAt))}</span>
        <button type="button" class="${btnClass}" data-id="${esc(s.id)}"
          ${btnAttr} aria-label="엄지척 ${s.upvotes || 0}개, ${hasUpvoted ? '눌러서 취소' : '눌러서 추천'}">👍 ${s.upvotes || 0}</button>
      </div>
      <p class="feed-quote">“${esc(s.sentence)}”</p>
      <details class="feed-more">
        <summary>느낀 점 보기</summary>
        <dl class="body">
          <dt>인상 깊은 내용</dt><dd>${esc(s.sentence)}</dd>
          <dt>느낀 점</dt><dd>${esc(s.reflection)}</dd>
        </dl>
      </details>
    </article>`;
  }

  async function refreshSocialFeed() {
    const date = feedDate;
    const daySubs = (await Store.listSubmissions({ date })).slice();

    // 엄지척 순 내림차순 정렬 (동점이면 먼저 올린 사람이 위로)
    daySubs.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0) ||
      String(a.createdAt).localeCompare(String(b.createdAt)));

    // 1등(가장 많이 추천된 사람) 선정 — 공동 1등 모두 인정
    const maxVotes = daySubs.length ? (daySubs[0].upvotes || 0) : 0;
    const winners = maxVotes > 0
      ? daySubs.filter((s) => (s.upvotes || 0) === maxVotes).map((s) => s.nickname)
      : [];

    $('feedCount').textContent = `${daySubs.length}명`;

    // 날짜 넘기기 컨트롤
    const { lo, hi } = feedDateBounds();
    const isToday = date === U.today();
    $('feedPrevDate').disabled = date <= lo;
    $('feedNextDate').disabled = date >= hi;
    $('feedDateLabel').textContent = isToday ? `오늘 · ${U.shortLabel(date)}` : U.shortLabel(date);

    const badge = $('todayWinnerBadge');
    if (winners.length) {
      badge.textContent = `👑 1등: ${winners.join(', ')} (👍 ${maxVotes})`;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }

    const feedList = $('socialFeedList');
    const moreWrap = $('feedLoadMoreWrap');
    if (!daySubs.length) {
      feedList.innerHTML = `<div class="empty">${isToday ? '오늘' : U.shortLabel(date) + '에'} 제출된 인증글이 없습니다.` +
        `${isToday ? ' 첫 번째 글을 작성해 보세요!' : ''}</div>`;
      moreWrap.hidden = true;
      return;
    }

    const winnerSet = new Set(winners);
    const visible = daySubs.slice(0, feedVisibleCount);
    feedList.innerHTML = visible.map((s) =>
      renderFeedItem(s, winnerSet.has(s.nickname), (s.upvotedBy || []).includes(clientId))).join('');
    bindUpvoteButtons(feedList);

    const remaining = daySubs.length - visible.length;
    if (remaining > 0) {
      moreWrap.hidden = false;
      $('feedLoadMoreBtn').textContent = `더 보기 (${remaining}명 더 남음)`;
    } else {
      moreWrap.hidden = true;
    }
  }

  /* ── 인증 피드 전체 보기 ─────────────────────── */
  function renderAllFeedItem(s) {
    const own = isOwnSubmission(s);
    const late = U.isLate(s.date, s.createdAt);
    const hasUpvoted = (s.upvotedBy || []).includes(clientId);
    const btnClass = ['upvote-btn', hasUpvoted ? 'voted' : '', own ? 'self' : ''].filter(Boolean).join(' ');
    const btnAttr = own ? 'disabled title="본인 글은 추천할 수 없습니다"' : '';
    return `<article class="feed-item">
      <div class="feed-top">
        <span class="feed-nick">${esc(s.nickname)}</span>
        ${late ? '<span class="tag bad">지각</span>' : ''}
        <span class="feed-time">${esc(U.shortLabel(s.date))} · ${esc(U.stampLabel(s.updatedAt || s.createdAt))}</span>
        <button type="button" class="${btnClass}" data-id="${esc(s.id)}"
          ${btnAttr} aria-label="엄지척 ${s.upvotes || 0}개">👍 ${s.upvotes || 0}</button>
      </div>
      <p class="feed-quote">“${esc(s.sentence)}”</p>
      <details class="feed-more">
        <summary>느낀 점 보기</summary>
        <dl class="body">
          <dt>느낀 점</dt><dd>${esc(s.reflection)}</dd>
        </dl>
      </details>
    </article>`;
  }

  async function refreshAllFeed() {
    if (feedTab !== 'all') return;
    const all = (await Store.listSubmissions()).slice()
      .sort((a, b) => (b.date === a.date
        ? String(b.createdAt).localeCompare(String(a.createdAt))
        : b.date.localeCompare(a.date)));

    const list = $('allFeedList');
    const moreWrap = $('allFeedLoadMoreWrap');
    if (!all.length) {
      list.innerHTML = '<div class="empty">제출된 인증글이 없습니다.</div>';
      moreWrap.hidden = true;
      return;
    }
    const visible = all.slice(0, allFeedVisibleCount);
    list.innerHTML = visible.map(renderAllFeedItem).join('');
    bindUpvoteButtons(list);

    const remaining = all.length - visible.length;
    if (remaining > 0) {
      moreWrap.hidden = false;
      $('allFeedLoadMoreBtn').textContent = `더 보기 (${remaining}건 더 남음)`;
    } else {
      moreWrap.hidden = true;
    }
  }

  function switchFeedTab(tab) {
    feedTab = tab;
    $('feedTabs').querySelectorAll('button[data-feedtab]').forEach((b) =>
      b.classList.toggle('on', b.dataset.feedtab === tab));
    $('feedDateView').hidden = tab !== 'date';
    $('feedAllView').hidden = tab !== 'all';
    if (tab === 'all') {
      allFeedVisibleCount = FEED_PAGE_SIZE;
      refreshAllFeed();
    }
  }

  // 날짜별 1등 횟수를 집계해서 명예의 전당 Top 5 목록 렌더링
  async function calculateRanksAndFame() {
    const allSubs = await Store.listSubmissions();

    // 제출이 있는 날짜별로 묶어 1등을 뽑는다 (공동 1등 모두 인정)
    const byDate = new Map();
    for (const s of allSubs) {
      if (!byDate.has(s.date)) byDate.set(s.date, []);
      byDate.get(s.date).push(s);
    }

    const winsMap = {}; // 닉네임 → 1등 횟수
    for (const daySubs of byDate.values()) {
      const maxVotes = daySubs.reduce((m, s) => Math.max(m, s.upvotes || 0), 0);
      if (maxVotes <= 0) continue;
      for (const s of daySubs) {
        if ((s.upvotes || 0) === maxVotes) winsMap[s.nickname] = (winsMap[s.nickname] || 0) + 1;
      }
    }

    const sortedFame = Object.entries(winsMap)
      .map(([nickname, wins]) => ({ nickname, wins }))
      .sort((a, b) => b.wins - a.wins || a.nickname.localeCompare(b.nickname, 'ko'))
      .slice(0, 5);

    const fameList = $('hallOfFameList');
    fameList.innerHTML = sortedFame.length
      ? sortedFame.map((user, idx) => {
        const medal = ['🥇', '🥈', '🥉'][idx] || '⭐';
        return `<li><span class="medal">${medal}</span>` +
          `<span class="who">${esc(user.nickname)}</span>` +
          `<span class="cnt">1등 ${user.wins}회</span></li>`;
      }).join('')
      : '<li class="none">집계된 순위가 없습니다.</li>';
  }

  /* ── 전체 진행현황 대시보드 (모든 참여자 공개) ─── */
  async function paintOverall() {
    if (!participants.length) {
      $('overallCount').textContent = '0명';
      $('overallTable').innerHTML = '<tbody><tr><td class="empty">등록된 참가자가 없습니다.</td></tr></tbody>';
      return;
    }
    const allSubs = await Store.listSubmissions();
    const stats = U.buildStats(participants, allSubs)
      .sort((a, b) => (b.rate - a.rate) || (b.streak - a.streak)
        || a.participant.nickname.localeCompare(b.participant.nickname, 'ko'));

    const active = stats.filter((s) => s.participant.status !== 'out');
    const todayDone = active.filter((s) => s.submittedToday).length;
    // 킥아웃 위험 인원: 아직 킥아웃 기준(missed>=kickoutThreshold)에는 못 미쳤지만
    // 누적 미인증이 3~4회로 임박한 사람 (실제 킥아웃 대상은 아래 표의 '킥아웃 대상' 태그 참고)
    const riskZone = active.filter((s) => s.missed === 3 || s.missed === 4).length;

    $('overallCount').textContent = `${active.length}명`;
    $('ovToday').textContent = active.length ? `${Math.round((todayDone / active.length) * 100)}%` : '0%';
    $('ovActive').textContent = active.length;
    $('ovRisk').textContent = riskZone;

    const head = '<thead><tr><th>이름</th><th class="num">인증</th><th class="num">미인증</th>' +
      '<th class="num">인증률</th><th class="num">연속 인증</th><th>오늘</th><th>상태</th></tr></thead>';
    const body = stats.map((s) => {
      const p = s.participant;
      const statusTag = p.status === 'out'
        ? '<span class="tag bad">아웃</span>'
        : (s.atRisk ? '<span class="tag bad">킥아웃 대상</span>' : '<span class="tag ok">참여중</span>');
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
      await refreshAllFeed();
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
    paintPhase();
    tickCountdown();
    setInterval(tickCountdown, 1000);
    populateCertifyDateOptions(null);
    paintCertifyDateWarn($('certifyDate').value);
    await loadParticipants();
    await refreshSocialFeed();
    await calculateRanksAndFame();
    await paintOverall();

    $('participant').addEventListener('change', onSelect);
    $('participantSearch').addEventListener('input', renderParticipantOptions);
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
    bindFeedSwipe(document.querySelector('.feed-card'));

    // 인증 피드: 날짜별 보기 / 전체 보기 탭
    $('feedTabs').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-feedtab]');
      if (!btn) return;
      switchFeedTab(btn.dataset.feedtab);
    });
    $('allFeedLoadMoreBtn').addEventListener('click', () => {
      allFeedVisibleCount += FEED_PAGE_SIZE;
      refreshAllFeed();
    });

    // 피드 갱신: 수동 버튼(전체 재집계) + 화면이 보이는 동안 "오늘" 볼 때만 주기적 갱신
    // (명예의 전당은 전체 기록을 읽어야 해서 Firestore 읽기 비용이 크므로 자동 갱신에서 제외)
    $('feedRefresh').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await refreshSocialFeed();
        await refreshAllFeed();
        await calculateRanksAndFame();
        await paintOverall();
      } finally { btn.disabled = false; }
    });
    const pollFeed = () => {
      if (document.visibilityState === 'visible' && feedDate === U.today()) {
        refreshSocialFeed().catch(console.error);
      }
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
        await refreshAllFeed();
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
