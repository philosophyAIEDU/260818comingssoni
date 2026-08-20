/* 운영진 대시보드 */
(function () {
  const { CONFIG, U, Store } = CS;
  const $ = (id) => document.getElementById(id);
  const CELL_CLASS = { O: 'cell-o', X: 'cell-x', P: 'cell-p', '-': 'cell-none', '·': 'cell-off' };
  const LABEL = { O: '인증', X: '미인증', P: '면제', '-': '마감 전', '·': '참여 기간 밖' };

  let participants = [];
  let submissions = [];
  let stats = [];
  let notifyEmails = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function msg(el, text, kind) {
    el.innerHTML = text ? `<div class="note ${kind || 'info'}">${text}</div>` : '';
    if (text) setTimeout(() => { if (el.firstChild) el.innerHTML = ''; }, 6000);
  }

  /* ── 데이터 로드 ─────────────────────── */
  async function refresh() {
    participants = await Store.listParticipants();
    submissions = await Store.listSubmissions();
    stats = U.buildStats(participants, submissions)
      .sort((a, b) => (b.missed - a.missed)
        || (a.verified - b.verified)
        || a.participant.nickname.localeCompare(b.participant.nickname, 'ko'));
    paintKpis();
    paintMatrix();
    paintRoster();
    paintParticipantFilter();
    paintEntries();
    paintNotice();
    await refreshNotify();
    await loadNotifyTemplate();
  }

  /* ── 상단 지표 ───────────────────────── */
  function paintKpis() {
    const today = U.today();
    const yest = U.addDays(today, -1);
    const active = stats.filter((s) => s.participant.status !== 'out');

    const todayDone = active.filter((s) => s.submittedToday).length;
    const yestCells = active.map((s) => s.cells.find((c) => c.date === yest));
    const yestMissed = yestCells.filter((c) => c && c.status === 'X').length;

    $('kTotal').textContent = active.length;
    $('kToday').textContent = todayDone;
    $('kTodayRate').textContent = active.length ? `${Math.round((todayDone / active.length) * 100)}%` : '0%';
    $('kYesterday').textContent = (yest >= CONFIG.startDate) ? yestMissed : 0;
    $('kRisk').textContent = active.filter((s) => s.atRisk).length;

    $('todayLabel').textContent = U.shortLabel(today);
    const idx = U.dayIndex(today);
    const total = U.challengeDates().length;
    $('dayLabel').textContent = idx ? `${idx} / ${total}일차` : `— / ${total}일차`;
    $('footRange').textContent = `${U.longLabel(CONFIG.startDate)} ~ ${U.longLabel(CONFIG.endDate)}`;
    const isFirebase = Store.name === 'firebase';
    $('backendTag').textContent = isFirebase ? 'Firebase Firestore' : 'localStorage (이 브라우저)';
    $('backendDesc').textContent = isFirebase
      ? '— 참가자들이 각자 어떤 기기·브라우저에서 제출하든 하나의 데이터베이스에 함께 저장·집계됩니다.'
      : '— 이 브라우저에만 저장됩니다. 기기를 바꾸거나 브라우저 데이터를 지우면 사라지므로 정기적으로 백업하세요.';
    $('firebaseInfo').innerHTML = isFirebase
      ? '✅ 이미 <strong>Firebase(Firestore)</strong>에 연결되어 있습니다. 참가자들이 각자 인증하면 실시간으로 이 화면에 모입니다. ' +
        '데이터를 보호하려면 위의 <strong>전체 백업</strong>을 정기적으로 받아두세요.'
      : '나중에 여러 기기에서 함께 쓰려면 <code>js/config.js</code>의 <code>CS.FIREBASE_CONFIG</code>를 채우고 ' +
        '<code>backend</code>를 <code>\'firebase\'</code>로 바꾸면 됩니다. 저장 인터페이스가 동일해 화면 코드는 그대로 동작합니다. ' +
        '전환 전에 위의 <strong>전체 백업</strong>을 받아두고, 전환 후 <strong>복원하기</strong>로 그대로 옮길 수 있습니다.';
  }

  function tick() { $('countdown').textContent = U.hhmmss(U.secondsToMidnight()); }

  /* ── 일일현황 매트릭스 ───────────────── */
  function paintMatrix() {
    const dates = U.challengeDates();
    const t = $('matrix');
    if (!participants.length) {
      t.innerHTML = '<tbody><tr><td class="empty">등록된 참가자가 없습니다. [명단 관리] 탭에서 먼저 등록해 주세요.</td></tr></tbody>';
      return;
    }

    const head = ['<thead><tr><th class="name">참가자</th>',
      '<th class="num">미인증</th><th class="num">인증률</th>']
      .concat(dates.map((d) => `<th title="${U.longLabel(d)}">${Number(d.slice(5, 7))}/${Number(d.slice(8))}<br>` +
        `<span style="font-weight:400;color:var(--text-faint)">${U.weekday(d)}</span></th>`))
      .concat(['</tr></thead>']).join('');

    const body = stats.map((s) => {
      const p = s.participant;
      const risk = s.atRisk && p.status !== 'out';
      const nameTag = p.status === 'out'
        ? ' <span class="tag bad">아웃</span>'
        : (risk ? ' <span class="tag bad">킥아웃</span>' : '');
      const cells = s.cells.map((c) =>
        `<td><span class="cell ${CELL_CLASS[c.status]}" data-pid="${p.id}" data-date="${c.date}" ` +
        `title="${esc(p.nickname)} · ${U.shortLabel(c.date)} · ${LABEL[c.status]}" style="cursor:pointer">` +
        `${c.status === '-' || c.status === '·' ? '·' : c.status}</span></td>`).join('');
      return `<tr class="${risk ? 'risk' : ''}">
        <td class="name" title="${esc(p.nickname)}">${esc(p.nickname)}${nameTag}</td>
        <td class="num">${s.missed}</td>
        <td class="num">${s.rate}%</td>${cells}</tr>`;
    }).join('');

    t.innerHTML = `${head}<tbody>${body}</tbody>`;

    t.querySelectorAll('.cell[data-pid]').forEach((el) => {
      el.addEventListener('click', () => showCell(el.dataset.pid, el.dataset.date));
    });
  }

  async function showCell(pid, date) {
    const p = participants.find((x) => x.id === pid);
    if (!p) return;
    const sub = await Store.getSubmission(pid, date);
    const exempt = (p.exemptDates || []).includes(date);
    const box = $('cellDetail');

    const body = sub ? `
      <dl>
        <dt>인상 깊은 내용</dt><dd class="quote">“${esc(sub.sentence)}”</dd>
        <dt>느낀 점</dt><dd>${esc(sub.reflection)}</dd>
        <dt>제출 시각</dt><dd>${esc(U.stampLabel(sub.updatedAt || sub.createdAt))}</dd>
      </dl>` : '<p class="muted">제출된 인증이 없습니다.</p>';

    box.innerHTML = `<div class="entry">
      <h4>${esc(p.nickname)} · ${esc(U.longLabel(date))}
        ${exempt ? '<span class="tag info">면제일</span>' : ''}
        ${sub ? '<span class="tag ok">인증</span>' : ''}
      </h4>
      ${body}
      <div class="actions" style="margin-top:12px">
        <button class="small" id="toggleExempt">${exempt ? '면제 해제' : '이 날짜를 면제일로 등록'}</button>
        ${sub ? '<button class="small danger" id="delSub">인증 기록 삭제</button>' : ''}
        <button class="small" id="closeCell">닫기</button>
      </div>
    </div>`;

    $('toggleExempt').addEventListener('click', async () => {
      const list = new Set(p.exemptDates || []);
      if (exempt) list.delete(date); else list.add(date);
      await Store.updateParticipant(pid, { exemptDates: Array.from(list).sort() });
      await refresh();
      showCell(pid, date);
    });
    const del = $('delSub');
    if (del) {
      del.addEventListener('click', async () => {
        if (!confirm(`${p.nickname} 님의 ${U.shortLabel(date)} 인증 기록을 삭제할까요?`)) return;
        await Store.removeSubmission(sub.id);
        await refresh();
        showCell(pid, date);
      });
    }
    $('closeCell').addEventListener('click', () => { box.innerHTML = ''; });
  }

  /* ── 명단 관리 ───────────────────────── */
  function paintRoster() {
    $('rosterCount').textContent =
      `총 ${participants.length}명 · 참여중 ${participants.filter((p) => p.status !== 'out').length}명`;

    const t = $('rosterTable');
    if (!participants.length) {
      t.innerHTML = '<tbody><tr><td class="empty">등록된 참가자가 없습니다.</td></tr></tbody>';
      return;
    }

    const rows = participants.map((p) => {
      const st = stats.find((s) => s.participant.id === p.id) || { missed: 0, verified: 0, rate: 0 };
      const chips = (p.exemptDates || []).sort().map((d) =>
        `<span class="chip">${U.shortLabel(d)}<button data-unexempt="${p.id}" data-date="${d}" title="면제 해제">×</button></span>`).join('');
      return `<tr>
        <td><input type="text" value="${esc(p.nickname)}" data-rename="${p.id}" style="min-width:120px"></td>
        <td>${p.status === 'out'
          ? '<span class="tag bad">아웃</span>'
          : (st.missed >= CONFIG.kickoutThreshold ? '<span class="tag bad">킥아웃 대상</span>' : '<span class="tag ok">참여중</span>')}</td>
        <td class="num">${st.verified}</td>
        <td class="num">${st.missed}</td>
        <td class="num">${st.rate}%</td>
        <td>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <input type="date" data-exemptdate="${p.id}" min="${CONFIG.startDate}" max="${CONFIG.endDate}" style="width:150px">
            <button class="small" data-addexempt="${p.id}">면제 추가</button>
          </div>
          <div class="chips">${chips}</div>
        </td>
        <td>
          <div class="actions">
            <button class="small" data-toggle="${p.id}">${p.status === 'out' ? '복귀' : '아웃 처리'}</button>
            <button class="small danger" data-del="${p.id}">삭제</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    t.innerHTML = `<thead><tr>
      <th>이름</th><th>상태</th><th class="num">인증</th><th class="num">미인증</th>
      <th class="num">인증률</th><th>면제일</th><th></th>
    </tr></thead><tbody>${rows}</tbody>`;

    t.querySelectorAll('[data-rename]').forEach((el) => {
      el.addEventListener('change', async () => {
        try {
          await Store.updateParticipant(el.dataset.rename, { nickname: el.value });
          msg($('rosterMsg'), '이름을 수정했습니다.', 'ok');
        } catch (e) { msg($('rosterMsg'), esc(e.message), 'bad'); }
        await refresh();
      });
    });
    t.querySelectorAll('[data-toggle]').forEach((el) => {
      el.addEventListener('click', async () => {
        const p = participants.find((x) => x.id === el.dataset.toggle);
        const out = p.status !== 'out';
        await Store.updateParticipant(p.id, {
          status: out ? 'out' : 'active',
          outDate: out ? U.today() : null
        });
        await refresh();
      });
    });
    t.querySelectorAll('[data-del]').forEach((el) => {
      el.addEventListener('click', async () => {
        const p = participants.find((x) => x.id === el.dataset.del);
        if (!confirm(`${p.nickname} 님을 명단에서 삭제할까요?\n제출한 인증 기록도 함께 삭제됩니다.`)) return;
        await Store.removeParticipant(p.id);
        await refresh();
      });
    });
    t.querySelectorAll('[data-addexempt]').forEach((el) => {
      el.addEventListener('click', async () => {
        const pid = el.dataset.addexempt;
        const input = t.querySelector(`[data-exemptdate="${pid}"]`);
        const d = input.value;
        if (!d) { msg($('rosterMsg'), '면제일 날짜를 먼저 선택해 주세요.', 'warn'); return; }
        const p = participants.find((x) => x.id === pid);
        const list = new Set(p.exemptDates || []);
        list.add(d);
        await Store.updateParticipant(pid, { exemptDates: Array.from(list).sort() });
        msg($('rosterMsg'), `${p.nickname} 님의 ${U.shortLabel(d)}을(를) 면제일로 등록했습니다.`, 'ok');
        await refresh();
      });
    });
    t.querySelectorAll('[data-unexempt]').forEach((el) => {
      el.addEventListener('click', async () => {
        const pid = el.dataset.unexempt;
        const p = participants.find((x) => x.id === pid);
        const list = (p.exemptDates || []).filter((d) => d !== el.dataset.date);
        await Store.updateParticipant(pid, { exemptDates: list });
        await refresh();
      });
    });
  }

  async function bulkAdd() {
    const raw = $('bulkNames').value;
    const names = raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (!names.length) { msg($('rosterMsg'), '등록할 이름을 입력해 주세요.', 'warn'); return; }
    const { added, skipped } = await Store.addParticipants(names);
    $('bulkNames').value = '';
    msg($('rosterMsg'),
      `${added.length}명 등록 완료${skipped.length ? ` · 중복 ${skipped.length}명 건너뜀 (${esc(skipped.join(', '))})` : ''}`,
      added.length ? 'ok' : 'warn');
    await refresh();
  }

  /* ── 리포트 / 공지문 ─────────────────── */
  function statusOn(date) {
    const active = stats.filter((s) => {
      const p = s.participant;
      if (p.status === 'out' && p.outDate && date > p.outDate) return false;
      return true;
    });
    const rows = active.map((s) => ({
      stat: s,
      status: (s.cells.find((c) => c.date === date) || {}).status
    }));
    return {
      target: rows.filter((r) => r.status === 'O' || r.status === 'X'),
      done: rows.filter((r) => r.status === 'O'),
      missed: rows.filter((r) => r.status === 'X'),
      exempt: rows.filter((r) => r.status === 'P')
    };
  }

  function buildReport(date) {
    if (date < CONFIG.startDate || date > CONFIG.endDate) {
      return `${U.longLabel(date)}은(는) 챌린지 기간(${CONFIG.startDate} ~ ${CONFIG.endDate}) 밖입니다.`;
    }
    if (date >= U.today()) {
      return `${U.longLabel(date)}은(는) 아직 마감(24:00) 전이라 미인증이 확정되지 않았습니다.\n` +
        `마감이 지난 날짜를 선택해 주세요. (가장 최근 확정일: ${U.lastSettledDate() ? U.longLabel(U.lastSettledDate()) : '없음'})`;
    }

    const g = statusOn(date);
    const rate = g.target.length ? Math.round((g.done.length / g.target.length) * 100) : 0;
    const risk = stats.filter((s) => s.participant.status !== 'out' && s.atRisk);
    const near = stats.filter((s) => s.participant.status !== 'out'
      && !s.atRisk && s.missed === CONFIG.kickoutThreshold - 1);

    const L = [];
    L.push(`[${CONFIG.title}] ${U.longLabel(date)} 인증 리포트`);
    L.push(`(${U.dayIndex(date)}일차 / 총 ${U.challengeDates().length}일)`);
    L.push('');
    L.push(`■ 인증률 : ${rate}%  (${g.done.length}/${g.target.length}명)`);
    L.push(`■ 면제   : ${g.exempt.length}명`);
    L.push('');
    L.push(`■ 미인증자 (${g.missed.length}명)`);
    L.push(g.missed.length
      ? g.missed
        .sort((a, b) => b.stat.missed - a.stat.missed)
        .map((r) => `   - ${r.stat.participant.nickname} (누적 ${r.stat.missed}회)`).join('\n')
      : '   없음 — 전원 인증 완료 👏');
    L.push('');
    L.push(`■ 킥아웃 대상 (누적 ${CONFIG.kickoutThreshold}회 이상, ${risk.length}명)`);
    L.push(risk.length
      ? risk.map((s) => `   - ${s.participant.nickname} (누적 ${s.missed}회)`).join('\n')
      : '   없음');
    L.push('');
    L.push(`■ 경고 대상 (누적 ${CONFIG.kickoutThreshold - 1}회, ${near.length}명)`);
    L.push(near.length
      ? near.map((s) => `   - ${s.participant.nickname}`).join('\n')
      : '   없음');
    L.push('');
    L.push(`■ 면제 처리 (${g.exempt.length}명)`);
    L.push(g.exempt.length
      ? g.exempt.map((r) => `   - ${r.stat.participant.nickname}`).join('\n')
      : '   없음');
    return L.join('\n');
  }

  function buildNotice() {
    const today = U.today();
    const idx = U.dayIndex(today);
    const total = U.challengeDates().length;
    const yest = U.addDays(today, -1);

    const L = [];
    L.push(`📖 ${CONFIG.title} ${idx ? `${idx}일차` : ''} 공지`);
    L.push(`${U.longLabel(today)}`);
    L.push('');

    if (U.phase() === 'before') {
      const d = U.diffDays(today, CONFIG.startDate);
      L.push(`챌린지 시작까지 D-${d} 입니다.`);
      L.push(`OT : ${U.longLabel(CONFIG.otAt.slice(0, 10))} 오전 10시`);
      L.push(`기간 : ${U.longLabel(CONFIG.startDate)} ~ ${U.longLabel(CONFIG.endDate)} (4주)`);
      L.push('');
      L.push('신청 시 등록하신 이름이 인증의 기준이 됩니다.');
      L.push('OT에서 인증 방법을 자세히 안내드릴게요. 🙌');
      return L.join('\n');
    }

    if (U.phase() === 'after') {
      const done = stats.reduce((n, s) => n + s.verified, 0);
      const perfect = stats.filter((s) => s.participant.status !== 'out' && s.missed === 0);
      L.push('4주간의 독서챌린지가 모두 끝났습니다. 🎉');
      L.push(`총 인증 ${done}건, 완주(미인증 0회) ${perfect.length}명!`);
      if (perfect.length) L.push(`👑 ${perfect.map((s) => s.participant.nickname).join(', ')}`);
      L.push('');
      L.push('함께 읽어주셔서 감사합니다.');
      return L.join('\n');
    }

    if (yest >= CONFIG.startDate) {
      const g = statusOn(yest);
      const rate = g.target.length ? Math.round((g.done.length / g.target.length) * 100) : 0;
      L.push(`■ 어제 ${U.shortLabel(yest)} 인증률 : ${rate}% (${g.done.length}/${g.target.length}명)`);
      if (g.missed.length) {
        L.push(`■ 어제 미인증 : ${g.missed.map((r) => r.stat.participant.nickname).join(', ')}`);
        L.push('   → 오늘은 잊지 말고 인증해 주세요!');
      } else {
        L.push('■ 어제는 전원 인증 완료했습니다! 👏');
      }
      L.push('');
    }

    const risk = stats.filter((s) => s.participant.status !== 'out'
      && s.missed >= CONFIG.kickoutThreshold - 1);
    if (risk.length) {
      L.push(`⚠️ 누적 미인증 ${CONFIG.kickoutThreshold - 1}회 이상 : ` +
        risk.map((s) => `${s.participant.nickname}(${s.missed}회)`).join(', '));
      L.push(`   누적 ${CONFIG.kickoutThreshold}회가 되면 킥아웃 대상입니다.`);
      L.push('');
    }

    L.push(`오늘은 ${idx}일차 / 총 ${total}일 (D-${total - idx}) 입니다.`);
    L.push('오늘 밤 24시까지 아래 2가지를 인증해 주세요.');
    L.push('  1) 오늘 읽은 챕터에서 가장 인상 깊었던 핵심 내용');
    L.push('  2) 오늘 책을 읽고 느낀 점 (나에게 어떻게 적용할지)');
    L.push('');
    L.push('마감은 24시 정각, 유예 없습니다. 오늘도 한 챕터 함께해요! 📚');
    return L.join('\n');
  }

  function paintNotice() { $('noticeOut').textContent = buildNotice(); }

  async function copyText(text, el) {
    try {
      await navigator.clipboard.writeText(text);
      const old = el.textContent;
      el.textContent = '복사됨 ✓';
      setTimeout(() => { el.textContent = old; }, 1600);
    } catch (e) {
      // 클립보드 권한이 없는 환경(file://, 구형 브라우저) 대비
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e2) { alert('복사에 실패했습니다. 직접 선택해 복사해 주세요.'); }
      ta.remove();
    }
  }

  /* ── 제출 기록 ───────────────────────── */
  function paintParticipantFilter() {
    const sel = $('fParticipant');
    const keep = sel.value;
    sel.innerHTML = '<option value="">전체</option>' +
      participants.map((p) => `<option value="${p.id}">${esc(p.nickname)}</option>`).join('');
    if (keep) sel.value = keep;
  }

  function paintEntries() {
    const date = $('fDate').value;
    const pid = $('fParticipant').value;
    const kw = $('fKeyword').value.trim().toLowerCase();

    let rows = submissions.slice().reverse();
    if (date) rows = rows.filter((s) => s.date === date);
    if (pid) rows = rows.filter((s) => s.participantId === pid);
    if (kw) {
      rows = rows.filter((s) => [s.sentence, s.reflection, s.nickname]
        .join(' ').toLowerCase().includes(kw));
    }

    $('entryList').innerHTML = rows.length ? rows.slice(0, 200).map((s) => `
      <div class="entry">
        <h4>${esc(s.nickname)} <span class="tag">${esc(U.shortLabel(s.date))}</span>
          <span class="muted">${esc(U.stampLabel(s.updatedAt || s.createdAt))} 제출</span></h4>
        <dl>
          <dt>인상 깊은 내용</dt><dd class="quote">“${esc(s.sentence)}”</dd>
          <dt>느낀 점</dt><dd>${esc(s.reflection)}</dd>
        </dl>
      </div>`).join('') + (rows.length > 200 ? '<p class="muted">최근 200건만 표시합니다.</p>' : '')
      : '<div class="empty">조건에 맞는 제출 기록이 없습니다.</div>';
  }

  /* ── 알림 메일 ───────────────────────── */

  // 운영진이 아직 한 번도 저장한 적 없을 때 쓰이는 기본 제목·본문.
  // 본문의 {{NAME}}은 받는 분 이름으로, {{APP_URL}}은 CONFIG.appUrl로 발송 시 치환됩니다.
  function defaultNotifySubject() {
    return `[${CONFIG.title}] 오늘 인증하셨나요? 📖`;
  }
  function defaultNotifyBody() {
    return [
      '안녕하세요, {{NAME}}님! 오늘 밤 24시까지 독서 인증을 잊지 않으셨는지 확인해 주세요.',
      '마감은 24시 정각이며 유예 시간은 없습니다.',
      '',
      '인증하러 가기 → {{APP_URL}}',
      '',
      '오늘도 함께 읽어주셔서 감사합니다. 🙌',
      '',
      '※ 이 알림을 더 이상 받고 싶지 않으시면 운영진에게 말씀해 주세요. 운영진 페이지의 [알림 메일] 탭에서 목록에서 바로 삭제할 수 있습니다.'
    ].join('\n');
  }

  let notifyTemplateDirty = false; // 저장 안 한 편집 중인 내용을 다른 새로고침이 덮어쓰지 않도록

  function paintNotifyPreview() {
    const subject = $('notifySubjectInput').value || defaultNotifySubject();
    const body = ($('notifyBodyInput').value || defaultNotifyBody())
      .split('{{APP_URL}}').join(CONFIG.appUrl)
      .split('{{NAME}}').join('OO'); // 미리보기는 특정 수신자가 없으므로 예시 이름으로 대체 표시
    $('notifyPreview').textContent = `제목: ${subject}\n\n${body}\n\n※ 실제 발송 시 {{NAME}}은 받는 분 각자의 이름으로 바뀝니다.`;
  }

  function paintNotify() {
    $('notifyCount').textContent = `${notifyEmails.length}명`;
    const t = $('notifyTable');
    t.innerHTML = notifyEmails.length
      ? `<thead><tr><th>이름</th><th>메일 주소</th><th>등록일</th><th></th></tr></thead><tbody>${
        notifyEmails.map((e) => `<tr>
          <td>${e.name ? esc(e.name) : '<span class="muted">(이름 없음)</span>'}</td>
          <td>${esc(e.email)}</td>
          <td class="muted">${esc(U.stampLabel(e.createdAt))}</td>
          <td><button class="small danger" data-delmail="${esc(e.id)}">삭제</button></td>
        </tr>`).join('')}</tbody>`
      : '<tbody><tr><td class="empty">등록된 메일 주소가 없습니다.</td></tr></tbody>';

    t.querySelectorAll('[data-delmail]').forEach((el) => {
      el.addEventListener('click', async () => {
        await Store.removeNotifyEmail(el.dataset.delmail);
        await refreshNotify();
      });
    });
  }

  async function refreshNotify() {
    notifyEmails = await Store.listNotifyEmails();
    paintNotify();
  }

  /** 저장된 제목·본문을 불러와 입력창에 채운다. 편집 중(dirty)이면 덮어쓰지 않는다. */
  async function loadNotifyTemplate() {
    if (notifyTemplateDirty) return;
    $('notifyAppUrlHint').textContent = CONFIG.appUrl;
    const meta = await Store.getMeta();
    $('notifySubjectInput').value = meta.notifySubject || defaultNotifySubject();
    $('notifyBodyInput').value = meta.notifyBody || defaultNotifyBody();
    paintNotifyPreview();
  }

  async function saveNotifyTemplate() {
    const subject = $('notifySubjectInput').value.trim();
    const body = $('notifyBodyInput').value.trim();
    if (!subject || !body) {
      msg($('notifyTemplateMsg'), '제목과 본문을 모두 입력해 주세요.', 'bad');
      return;
    }
    try {
      await Store.setMeta({ notifySubject: subject, notifyBody: body });
      notifyTemplateDirty = false;
      msg($('notifyTemplateMsg'), '저장했습니다. 다음 발송부터 반영됩니다.', 'ok');
      paintNotifyPreview();
    } catch (e) {
      msg($('notifyTemplateMsg'), `저장 실패: ${esc(e.message)}`, 'bad');
    }
  }

  function resetNotifyTemplate() {
    $('notifySubjectInput').value = defaultNotifySubject();
    $('notifyBodyInput').value = defaultNotifyBody();
    notifyTemplateDirty = true; // 초기화만 하고 아직 저장 전이므로 다음 새로고침에 덮어써지지 않게
    paintNotifyPreview();
    msg($('notifyTemplateMsg'), '기본값으로 채웠습니다. [저장]을 눌러야 실제로 반영됩니다.', 'warn');
  }

  /** "이름, 메일" 한 줄씩(엑셀에서 두 열을 복사하면 탭으로도 구분됨)을 { name, email } 목록으로 변환 */
  function parseNotifyLines(raw) {
    return raw.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const parts = line.split(/\t|,/).map((s) => s.trim()).filter(Boolean);
      return parts.length >= 2 ? { name: parts[0], email: parts[1] } : { name: '', email: parts[0] || '' };
    });
  }

  async function addNotifyEmail() {
    const input = $('notifyEmailInput');
    const entries = parseNotifyLines(input.value);
    if (!entries.length) { msg($('notifyMsg'), '등록할 이름과 메일 주소를 입력해 주세요.', 'warn'); return; }
    try {
      const { added, skipped, invalid } = await Store.addNotifyEmails(entries);
      input.value = '';
      const parts = [`${added.length}건 등록 완료`];
      if (skipped.length) parts.push(`중복 ${skipped.length}건 건너뜀 (${esc(skipped.join(', '))})`);
      if (invalid.length) parts.push(`형식 오류 ${invalid.length}건 건너뜀 (${esc(invalid.join(', '))})`);
      msg($('notifyMsg'), parts.join(' · '), added.length ? 'ok' : 'warn');
      await refreshNotify();
    } catch (e) {
      msg($('notifyMsg'), esc(e.message), 'bad');
    }
  }

  async function sendNotifyTest() {
    const btn = $('notifySendTest');
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '발송 중…';
    try {
      const res = await fetch('/.netlify/functions/send-daily-reminder-test', { method: 'POST' });
      if (!res.ok) throw new Error(`서버 응답 오류 (${res.status})`);
      const data = await res.json().catch(() => ({}));
      const failedNote = data.failed ? ` · 실패 ${data.failed}건` : '';
      msg($('notifyMsg'), `테스트 발송 완료 (${data.sent != null ? `${data.sent}건` : '완료'}${failedNote})`,
        data.failed ? 'warn' : 'ok');
    } catch (e) {
      msg($('notifyMsg'),
        `테스트 발송 실패: ${esc(e.message)}. Netlify Function이 배포·설정되어 있는지 확인해 주세요. (README 참고)`, 'bad');
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  /* ── 내보내기 / 가져오기 ─────────────── */
  function download(filename, text, mime) {
    const blob = new Blob(['﻿' + text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  const csvCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;

  function exportSubmissionsCsv() {
    const head = ['날짜', '이름', '인상 깊은 내용', '느낀 점', '제출시각'];
    const lines = [head.map(csvCell).join(',')].concat(
      submissions.map((s) => [s.date, s.nickname, s.sentence, s.reflection,
      U.stampLabel(s.updatedAt || s.createdAt)].map(csvCell).join(',')));
    download(`인증기록_${U.today()}.csv`, lines.join('\n'), 'text/csv');
  }

  function exportMatrixCsv() {
    const dates = U.challengeDates();
    const head = ['이름', '상태', '인증', '미인증', '면제', '인증률'].concat(dates.map(U.shortLabel));
    const lines = [head.map(csvCell).join(',')].concat(stats.map((s) => [
      s.participant.nickname,
      s.participant.status === 'out' ? '아웃' : (s.atRisk ? '킥아웃 대상' : '참여중'),
      s.verified, s.missed, s.exempt, `${s.rate}%`
    ].concat(s.cells.map((c) => c.status)).map(csvCell).join(',')));
    download(`일일현황_${U.today()}.csv`, lines.join('\n'), 'text/csv');
  }

  async function exportJson() {
    const data = await Store.exportAll();
    download(`독서챌린지_백업_${U.today()}.json`, JSON.stringify(data, null, 2), 'application/json');
    msg($('dataMsg'), '백업 파일을 내려받았습니다.', 'ok');
  }

  async function importJson() {
    const f = $('importFile').files[0];
    if (!f) { msg($('dataMsg'), '복원할 JSON 파일을 선택해 주세요.', 'warn'); return; }
    if (!confirm('현재 데이터를 백업 파일 내용으로 덮어씁니다. 계속할까요?')) return;
    try {
      const obj = JSON.parse(await f.text());
      await Store.importAll(obj);
      await refresh();
      msg($('dataMsg'), `복원 완료 · 참가자 ${obj.participants.length}명, 인증 ${obj.submissions.length}건`, 'ok');
    } catch (e) {
      msg($('dataMsg'), `복원 실패: ${esc(e.message)}`, 'bad');
    }
  }

  /* ── 탭 ──────────────────────────────── */
  function initTabs() {
    $('tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      $('tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
      document.querySelectorAll('.panel').forEach((p) => {
        p.hidden = p.dataset.panel !== btn.dataset.tab;
      });
      location.hash = btn.dataset.tab;
    });
    const openFromHash = () => {
      const tab = location.hash.slice(1);
      if (!tab) return;
      const btn = $('tabs').querySelector(`button[data-tab="${tab}"]`);
      if (btn && !btn.classList.contains('on')) btn.click();
    };
    openFromHash();
    // 주소창의 #탭 만 바뀌는 경우(뒤로가기·링크 공유)에도 탭이 따라오도록
    window.addEventListener('hashchange', openFromHash);
  }

  /* ── 초기화 ──────────────────────────── */
  async function boot() {
    await Store.init();
    tick();
    setInterval(tick, 1000);
    initTabs();

    const last = U.lastSettledDate();
    $('reportDate').value = last || CONFIG.startDate;
    $('reportDate').min = CONFIG.startDate;
    $('reportDate').max = CONFIG.endDate;
    $('fDate').min = CONFIG.startDate;
    $('fDate').max = CONFIG.endDate;

    $('bulkAdd').addEventListener('click', bulkAdd);
    $('genReport').addEventListener('click', () => {
      $('reportOut').textContent = buildReport($('reportDate').value || U.today());
    });
    $('copyReport').addEventListener('click', (e) => copyText($('reportOut').textContent, e.target));
    $('genNotice').addEventListener('click', paintNotice);
    $('copyNotice').addEventListener('click', (e) => copyText($('noticeOut').textContent, e.target));

    $('applyFilter').addEventListener('click', paintEntries);
    $('fKeyword').addEventListener('keydown', (e) => { if (e.key === 'Enter') paintEntries(); });
    $('clearFilter').addEventListener('click', () => {
      $('fDate').value = ''; $('fParticipant').value = ''; $('fKeyword').value = '';
      paintEntries();
    });

    $('notifyAddBtn').addEventListener('click', addNotifyEmail);
    $('notifySendTest').addEventListener('click', sendNotifyTest);

    $('notifyTemplateSave').addEventListener('click', saveNotifyTemplate);
    $('notifyTemplateReset').addEventListener('click', resetNotifyTemplate);
    ['notifySubjectInput', 'notifyBodyInput'].forEach((id) => {
      $(id).addEventListener('input', () => { notifyTemplateDirty = true; paintNotifyPreview(); });
    });

    $('exportJson').addEventListener('click', exportJson);
    $('exportCsvSub').addEventListener('click', exportSubmissionsCsv);
    $('exportCsvMatrix').addEventListener('click', exportMatrixCsv);
    $('importJson').addEventListener('click', importJson);
    $('wipe').addEventListener('click', async () => {
      if (!confirm('모든 참가자와 인증 기록을 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) return;
      if (!confirm('정말로 전체 삭제할까요? 먼저 백업을 받아두시는 것을 권합니다.')) return;
      await Store.clearAll();
      await refresh();
      msg($('dataMsg'), '전체 데이터를 삭제했습니다.', 'warn');
    });

    // 운영진 로그인 바인딩
    if (Store.onAuthStateChanged) {
      $('adminLoginBtn').addEventListener('click', async () => {
        try {
          await Store.signInWithGoogle();
        } catch (err) {
          msg($('adminAuthMsg'), '로그인 실패: ' + err.message, 'bad');
        }
      });
      $('adminLogoutBtn').addEventListener('click', async () => {
        try {
          await Store.signOut();
        } catch (err) {
          alert('로그아웃 실패: ' + err.message);
        }
      });

      Store.onAuthStateChanged(async (user) => {
        if (user) {
          const email = user.email || '';
          const whitelist = CONFIG.adminEmails || [];
          if (whitelist.includes(email)) {
            $('adminAuthGate').style.display = 'none';
            $('adminDashboard').style.display = 'block';
            $('adminAuthHeader').style.display = 'flex';
            $('adminEmailLabel').textContent = `${email} (운영진)`;
            await refresh();
            if (last) $('reportOut').textContent = buildReport(last);
          } else {
            $('adminAuthGate').style.display = 'block';
            $('adminDashboard').style.display = 'none';
            $('adminAuthHeader').style.display = 'none';
            msg($('adminAuthMsg'), `계정 권한이 없습니다: <strong>${esc(email)}</strong><br>승인된 운영진 Google 계정으로 로그인해 주세요.`, 'bad');
            // 비인증된 구글 세션 로그아웃 처리
            await Store.signOut();
          }
        } else {
          $('adminAuthGate').style.display = 'block';
          $('adminDashboard').style.display = 'none';
          $('adminAuthHeader').style.display = 'none';
          msg($('adminAuthMsg'), '', '');
        }
      });
    } else {
      // LocalStorage mode bypass
      $('adminAuthGate').style.display = 'none';
      $('adminDashboard').style.display = 'block';
      await refresh();
      if (last) $('reportOut').textContent = buildReport(last);
    }
  }

  boot().catch((err) => {
    console.error(err);
    document.getElementById('adminAuthGate').insertAdjacentHTML('afterbegin',
      `<div class="note bad">초기화 실패: ${esc(err.message)}</div>`);
  });
})();
