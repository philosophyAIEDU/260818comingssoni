/* 참가자 인증 화면 */
(function () {
  const { CONFIG, U, Store } = CS;
  const $ = (id) => document.getElementById(id);

  const CELL_CLASS = { O: 'cell-o', X: 'cell-x', P: 'cell-p', '-': 'cell-none', '·': 'cell-off' };
  const DRAFT_KEY = `${CONFIG.storagePrefix}.draft`;
  const LAST_KEY = `${CONFIG.storagePrefix}.lastParticipant`;
  const CLIENT_KEY = `${CONFIG.storagePrefix}.clientId`;

  let participants = [];

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
    $('brandSub').textContent = CONFIG.subtitle;
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
    if (p === 'before') {
      const d = U.diffDays(U.today(), CONFIG.startDate);
      msg(box, `챌린지는 <strong>${U.longLabel(CONFIG.startDate)}</strong>에 시작합니다. (D-${d}) ` +
        `OT는 ${U.longLabel(CONFIG.otAt.slice(0, 10))} 오전 10시입니다. ` +
        (open
          ? '지금 올리는 인증은 <strong>연습용</strong>이며 집계에는 반영되지 않습니다.'
          : '인증은 시작일부터 제출할 수 있어요.'), 'info');
    } else if (p === 'after') {
      msg(box, `챌린지가 <strong>${U.longLabel(CONFIG.endDate)}</strong>에 종료되었습니다. ` +
        `4주간 고생 많으셨습니다! 🎉 아래에서 닉네임을 선택하면 나의 최종 기록을 볼 수 있습니다.`, 'ok');
    } else {
      msg(box, '');
    }

    if (!open) {
      $('submitBtn').disabled = true;
      $('submitBtn').textContent = '기간 외 제출 잠김';
    }
  }


  /* ── 참가자 드롭다운 ─────────────────── */
  async function loadParticipants() {
    participants = await Store.listParticipants();
    const sel = $('participant');
    const active = participants.filter((p) => p.status !== 'out');
    const out = participants.filter((p) => p.status === 'out');

    sel.innerHTML = '<option value="">— 닉네임 선택 —</option>';
    for (const p of active) {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = p.nickname;
      sel.appendChild(o);
    }
    if (out.length) {
      const g = document.createElement('optgroup');
      g.label = '참여 종료';
      for (const p of out) {
        const o = document.createElement('option');
        o.value = p.id; o.textContent = `${p.nickname} (아웃)`;
        g.appendChild(o);
      }
      sel.appendChild(g);
    }

    if (!participants.length) {
      msg($('formMsg'),
        '아직 등록된 참가자 명단이 없습니다. 운영진이 <a href="admin.html">운영진 화면</a>의 ' +
        '<strong>명단 관리</strong>에서 신청 폼으로 모은 닉네임을 먼저 등록해 주세요.', 'warn');
      $('submitBtn').disabled = true;
      return;
    }
    if (canSubmitToday()) $('submitBtn').disabled = false;

    const last = localStorage.getItem(LAST_KEY);
    if (last && participants.some((p) => p.id === last)) {
      sel.value = last;
      await onSelect();
    }
  }

  /* ── 선택 시: 오늘 제출분 불러오기 + 현황 ─ */
  async function onSelect() {
    const pid = $('participant').value;
    const card = $('myCard');
    if (!pid) { card.hidden = true; msg($('formMsg'), ''); return; }

    localStorage.setItem(LAST_KEY, pid);
    const today = U.today();
    const existing = await Store.getSubmission(pid, today);

    if (existing) {
      $('chapter').value = existing.chapter || '';
      $('sentence').value = existing.sentence || '';
      $('reflection').value = existing.reflection || '';
      if (canSubmitToday()) $('submitBtn').textContent = '인증 수정하기';
      msg($('formMsg'),
        `오늘(${U.shortLabel(today)}) 인증은 <strong>제출 완료</strong> 상태입니다. ` +
        `(${U.stampLabel(existing.updatedAt || existing.createdAt)}) 내용을 고치고 다시 제출하면 덮어씁니다.`, 'ok');
    } else {
      const draft = loadDraft(pid);
      $('chapter').value = draft.chapter || '';
      $('sentence').value = draft.sentence || '';
      $('reflection').value = draft.reflection || '';
      if (canSubmitToday()) $('submitBtn').textContent = '인증 제출하기';
      msg($('formMsg'), '');
    }

    await paintMine(pid);
  }

  /* ── 임시 저장 (작성 중 이탈 대비) ────── */
  function loadDraft(pid) {
    try {
      const all = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
      const d = all[`${pid}|${U.today()}`];
      if (d) $('draftNote').textContent = '작성 중이던 내용을 불러왔습니다.';
      return d || {};
    } catch (e) { return {}; }
  }

  function saveDraft() {
    const pid = $('participant').value;
    if (!pid) return;
    let all = {};
    try { all = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}'); } catch (e) { all = {}; }
    all[`${pid}|${U.today()}`] = {
      chapter: $('chapter').value,
      sentence: $('sentence').value,
      reflection: $('reflection').value
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(all));
  }

  function clearDraft(pid) {
    try {
      const all = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
      delete all[`${pid}|${U.today()}`];
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
    return `<div class="entry">
      <h4>${esc(U.shortLabel(s.date))}
        <span class="tag ok">인증</span>
        <span class="muted">${esc(U.stampLabel(s.updatedAt || s.createdAt))} 제출</span>
      </h4>
      <dl>
        <dt>챕터</dt><dd>${esc(s.chapter)}</dd>
        <dt>인상 깊은 내용</dt><dd class="quote">“${esc(s.sentence)}”</dd>
        <dt>느낀 점</dt><dd>${esc(s.reflection)}</dd>
      </dl>
    </div>`;
  }

  /* ── 오늘의 피드 & 명예의 전당 ───────────────────── */
  function renderFeedItem(s, isWinner, hasUpvoted) {
    return `<article class="feed-item${isWinner ? ' win' : ''}">
      <div class="feed-top">
        <span class="feed-nick">${isWinner ? '👑 ' : ''}${esc(s.nickname)}</span>
        <span class="feed-time">${esc(U.stampLabel(s.updatedAt || s.createdAt))}</span>
        <button type="button" class="upvote-btn${hasUpvoted ? ' voted' : ''}" data-id="${esc(s.id)}"
          ${hasUpvoted ? 'disabled' : ''} aria-label="엄지척 ${s.upvotes || 0}개">👍 ${s.upvotes || 0}</button>
      </div>
      <p class="feed-chapter">📖 ${esc(s.chapter)}</p>
      <p class="feed-quote">“${esc(s.sentence)}”</p>
      <details class="feed-more">
        <summary>느낀 점 보기</summary>
        <dl class="body">
          <dt>챕터</dt><dd>${esc(s.chapter)}</dd>
          <dt>인상 깊은 내용</dt><dd>${esc(s.sentence)}</dd>
          <dt>느낀 점</dt><dd>${esc(s.reflection)}</dd>
        </dl>
      </details>
    </article>`;
  }

  async function refreshSocialFeed() {
    const todayISO = U.today();
    const todaySubs = (await Store.listSubmissions({ date: todayISO })).slice();

    // 엄지척 순 내림차순 정렬 (동점이면 먼저 올린 사람이 위로)
    todaySubs.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0) ||
      String(a.createdAt).localeCompare(String(b.createdAt)));

    // 1등(가장 많이 추천된 사람) 선정 — 공동 1등 모두 인정
    const maxVotes = todaySubs.length ? (todaySubs[0].upvotes || 0) : 0;
    const winners = maxVotes > 0
      ? todaySubs.filter((s) => (s.upvotes || 0) === maxVotes).map((s) => s.nickname)
      : [];

    $('feedCount').textContent = `${todaySubs.length}명`;

    const badge = $('todayWinnerBadge');
    if (winners.length) {
      badge.textContent = `👑 오늘의 1등: ${winners.join(', ')} (👍 ${maxVotes})`;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }

    const feedList = $('socialFeedList');
    if (!todaySubs.length) {
      feedList.innerHTML = '<div class="empty">오늘 제출된 인증글이 없습니다. 첫 번째 글을 작성해 보세요!</div>';
      return;
    }

    const winnerSet = new Set(winners);
    feedList.innerHTML = todaySubs.map((s) =>
      renderFeedItem(s, winnerSet.has(s.nickname), (s.upvotedBy || []).includes(clientId))).join('');

    feedList.querySelectorAll('.upvote-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await Store.upvoteSubmission(btn.dataset.id, clientId);
          await refreshSocialFeed();
          await calculateRanksAndFame();
        } catch (err) {
          btn.disabled = false;
          alert(err.message);
        }
      });
    });
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
    const payload = {
      participantId: pid,
      nickname: p ? p.nickname : '',
      date: U.today(),
      chapter: $('chapter').value.trim(),
      sentence: $('sentence').value.trim(),
      reflection: $('reflection').value.trim()
    };
    if (!payload.chapter || !payload.sentence || !payload.reflection) {
      msg($('formMsg'), '세 항목을 모두 작성해 주세요.', 'bad');
      return;
    }

    $('submitBtn').disabled = true;
    try {
      await Store.saveSubmission(payload);
      clearDraft(pid);
      msg($('formMsg'),
        `<strong>${esc(payload.nickname)}</strong> 님, ${U.shortLabel(payload.date)} 인증이 저장되었습니다. 오늘도 수고하셨어요! 📖`, 'ok');
      $('submitBtn').textContent = '인증 수정하기';
      
      await paintMine(pid);
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
    paintPhase();
    tickCountdown();
    setInterval(tickCountdown, 1000);
    await loadParticipants();
    await refreshSocialFeed();
    await calculateRanksAndFame();

    $('participant').addEventListener('change', onSelect);
    $('verifyForm').addEventListener('submit', onSubmit);
    $('resetBtn').addEventListener('click', () => {
      ['chapter', 'sentence', 'reflection'].forEach((k) => { $(k).value = ''; });
      const pid = $('participant').value;
      if (pid) clearDraft(pid);
    });
    ['chapter', 'sentence', 'reflection'].forEach((k) =>
      $(k).addEventListener('input', saveDraft));

    // 피드 갱신: 수동 버튼(전체 재집계) + 화면이 보이는 동안 오늘 피드만 주기적 갱신
    // (명예의 전당은 전체 기록을 읽어야 해서 Firestore 읽기 비용이 크므로 자동 갱신에서 제외)
    $('feedRefresh').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await refreshSocialFeed();
        await calculateRanksAndFame();
      } finally { btn.disabled = false; }
    });
    const pollFeed = () => {
      if (document.visibilityState === 'visible') refreshSocialFeed().catch(console.error);
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
      }
    });
  }

  boot().catch((err) => {
    console.error(err);
    msg($('formMsg'), `초기화 실패: ${err.message}`, 'bad');
  });
})();
