/* 참가자 인증 화면 */
(function () {
  const { CONFIG, U, Store } = CS;
  const $ = (id) => document.getElementById(id);

  const CELL_CLASS = { O: 'cell-o', X: 'cell-x', P: 'cell-p', '-': 'cell-none', '·': 'cell-off' };
  const DRAFT_KEY = `${CONFIG.storagePrefix}.draft`;
  const LAST_KEY = `${CONFIG.storagePrefix}.lastParticipant`;

  let participants = [];

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

  /** 오늘이 인증 가능한 날인지 (챌린지 기간 안) */
  function canSubmitToday() { return U.phase() === 'running'; }

  function paintPhase() {
    const p = U.phase();
    const box = $('phaseNote');
    if (p === 'before') {
      const d = U.diffDays(U.today(), CONFIG.startDate);
      msg(box, `챌린지는 <strong>${U.longLabel(CONFIG.startDate)}</strong>에 시작합니다. (D-${d}) ` +
        `OT는 ${U.longLabel(CONFIG.otAt.slice(0, 10))} 오전 10시입니다. ` +
        `인증은 시작일부터 제출할 수 있어요.`, 'info');
    } else if (p === 'after') {
      msg(box, `챌린지가 <strong>${U.longLabel(CONFIG.endDate)}</strong>에 종료되었습니다. ` +
        `4주간 고생 많으셨습니다! 🎉 아래에서 닉네임을 선택하면 나의 최종 기록을 볼 수 있습니다.`, 'ok');
    } else {
      msg(box, '');
    }

    // 기간 밖에는 제출을 막는다 (기록해도 집계에 반영되지 않기 때문)
    if (!canSubmitToday()) {
      ['chapter', 'sentence', 'reflection'].forEach((k) => { $(k).disabled = true; });
      $('submitBtn').disabled = true;
      $('submitBtn').textContent = p === 'before' ? '챌린지 시작 후 제출 가능' : '챌린지 종료';
      $('resetBtn').disabled = true;
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

    // 날짜 스트립
    const strip = $('myStrip');
    strip.innerHTML = '';
    for (const c of stat.cells) {
      const td = document.createElement('td');
      td.title = `${U.shortLabel(c.date)} — ${labelOf(c.status)}`;
      td.innerHTML = `<span class="cell ${CELL_CLASS[c.status]}">${c.status === '-' ? '·' : c.status}</span>` +
        `<div style="font-size:9px;color:var(--text-faint)">${Number(c.date.slice(8))}</div>`;
      strip.appendChild(td);
    }

    // 최근 기록 (최신 5건)
    const box = $('myEntries');
    const recent = subs.slice().reverse().slice(0, 5);
    box.innerHTML = recent.length ? recent.map(renderEntry).join('') :
      '<div class="empty">아직 제출한 인증이 없습니다.</div>';
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
        <dt>좋았던 문장</dt><dd class="quote">“${esc(s.sentence)}”</dd>
        <dt>느낀 점</dt><dd>${esc(s.reflection)}</dd>
      </dl>
    </div>`;
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

    $('participant').addEventListener('change', onSelect);
    $('verifyForm').addEventListener('submit', onSubmit);
    $('resetBtn').addEventListener('click', () => {
      ['chapter', 'sentence', 'reflection'].forEach((k) => { $(k).value = ''; });
      const pid = $('participant').value;
      if (pid) clearDraft(pid);
    });
    ['chapter', 'sentence', 'reflection'].forEach((k) =>
      $(k).addEventListener('input', saveDraft));

    // 운영진 화면에서 명단을 바꾸면 이 탭에도 반영
    window.addEventListener('storage', async (e) => {
      if (e.key && e.key.startsWith(CONFIG.storagePrefix)) {
        const keep = $('participant').value;
        await loadParticipants();
        if (keep) { $('participant').value = keep; await onSelect(); }
      }
    });
  }

  boot().catch((err) => {
    console.error(err);
    msg($('formMsg'), `초기화 실패: ${err.message}`, 'bad');
  });
})();
