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
    try {
      // 공지문(notices) 컬렉션은 새로 추가된 기능이라, Firestore 보안 규칙에서 아직 읽기·쓰기가
      // 막혀 있는 환경도 있을 수 있다. 여기서 실패해도 알림 메일 등 나머지 탭은 정상 동작해야
      // 하므로, 이 섹션만 격리해서 실패가 refresh() 전체를 중단시키지 않게 한다.
      await refreshNotices();
      loadNoticeForDate();
    } catch (e) {
      console.error('[공지문] 불러오기 실패', e);
      msg($('noticeMsg'),
        `공지문을 불러오지 못했습니다: ${esc(e.message)}. Firestore 보안 규칙에서 notices 컬렉션의 ` +
        '읽기·쓰기를 허용해 두었는지 확인해 주세요. (README 참고)', 'bad');
    }
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
      const risk = s.atRisk && p.status !== 'out'; // 위험(4회~) 또는 킥아웃 대상(6회~) 모두 포함 — 행 강조용
      const rt = U.riskTag(s);
      const nameTag = p.status === 'out' || risk ? ` <span class="tag ${rt.cls}">${rt.label}</span>` : '';
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

    const late = sub && U.isLate(date, sub.createdAt);
    const body = sub ? `
      <dl>
        <dt>인상 깊은 내용</dt><dd class="quote">“${esc(sub.sentence)}”</dd>
        <dt>느낀 점</dt><dd>${esc(sub.reflection)}</dd>
        <dt>제출 시각</dt><dd>${esc(U.stampLabel(sub.updatedAt || sub.createdAt))}${late ? ' — 마감 이후 (지각)' : ''}</dd>
      </dl>` : '<p class="muted">제출된 인증이 없습니다.</p>';

    box.innerHTML = `<div class="entry">
      <h4>${esc(p.nickname)} · ${esc(U.longLabel(date))}
        ${exempt ? '<span class="tag info">면제일</span>' : ''}
        ${sub ? `<span class="tag ${late ? 'bad' : 'ok'}">${late ? '지각(미인증)' : '인증'}</span>` : ''}
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
      const st = stats.find((s) => s.participant.id === p.id)
        || { participant: p, missed: 0, verified: 0, rate: 0, atRisk: false, kickoutEligible: false };
      const rt = U.riskTag(st);
      const chips = (p.exemptDates || []).sort().map((d) =>
        `<span class="chip">${U.shortLabel(d)}<button data-unexempt="${p.id}" data-date="${d}" title="면제 해제">×</button></span>`).join('');
      return `<tr>
        <td><input type="text" value="${esc(p.nickname)}" data-rename="${p.id}" style="min-width:120px"></td>
        <td><input type="email" value="${esc(p.email || '')}" data-editemail="${p.id}" placeholder="이메일 (선택)" style="min-width:160px"></td>
        <td><span class="tag ${rt.cls}">${rt.label}</span></td>
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
      <th>이름</th><th>이메일</th><th>상태</th><th class="num">인증</th><th class="num">미인증</th>
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
    t.querySelectorAll('[data-editemail]').forEach((el) => {
      el.addEventListener('change', async () => {
        try {
          await Store.updateParticipant(el.dataset.editemail, { email: el.value });
          msg($('rosterMsg'), '이메일을 수정했습니다.', 'ok');
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

  /* ── 명단 시트 업로드 (CSV/엑셀: 이름, 이메일) ─────── */

  /** 한 행(셀 값 배열)을 { name, email }로 정리한다. 앞의 두 빈 칸 아닌 값을 이름·메일로 본다. */
  function rowToEntry(cells) {
    const parts = cells.map((c) => String(c == null ? '' : c).trim()).filter(Boolean);
    return parts.length >= 2 ? { name: parts[0], email: parts[1] } : { name: '', email: parts[0] || '' };
  }

  /** CSV 한 줄을 "이름, 이메일"(또는 탭 구분)로 파싱한다. BOM·따옴표 감싼 값도 처리한다. */
  function parseRosterCsv(raw) {
    // 엑셀에서 저장한 CSV는 UTF-8 BOM(U+FEFF)으로 시작하는 경우가 있어 첫 글자로 걸러낸다.
    const text = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
    const unquote = (s) => {
      const t = s.trim();
      return (t.startsWith('"') && t.endsWith('"')) ? t.slice(1, -1).replace(/""/g, '"') : t;
    };
    return text.split('\n').map((line) => line.trim()).filter(Boolean)
      .map((line) => rowToEntry(line.split(/\t|,/).map(unquote)));
  }

  /** 엑셀 파일(.xlsx/.xls)의 첫 시트를 { name, email } 목록으로 변환한다. (SheetJS 필요) */
  function parseRosterWorkbook(arrayBuffer) {
    const wb = window.XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    return rows.map(rowToEntry).filter((e) => e.name || e.email);
  }

  // 엑셀 업로드를 실제로 시도할 때만 SheetJS를 CDN에서 불러온다. 대부분의 방문에서는
  // 이 라이브러리(수백 KB)를 아예 내려받지 않도록 admin.html에는 <script>로 고정 삽입하지 않았다.
  const XLSX_CDN_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  let xlsxLoadPromise = null;
  function loadXlsxLib() {
    if (window.XLSX) return Promise.resolve();
    if (!xlsxLoadPromise) {
      xlsxLoadPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = XLSX_CDN_URL;
        s.onload = () => resolve();
        s.onerror = () => {
          xlsxLoadPromise = null; // 실패하면 다음 시도 때 다시 불러와 보도록 초기화
          reject(new Error('엑셀 파일을 읽는 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하거나, CSV로 저장해서 다시 올려주세요.'));
        };
        document.head.appendChild(s);
      });
    }
    return xlsxLoadPromise;
  }

  /** 첫 줄이 "이름/성명/name" · "이메일/메일/email" 같은 제목 줄이면 건너뛴다. */
  function stripCsvHeader(entries) {
    if (!entries.length) return entries;
    const first = entries[0];
    const isHeaderCell = (s) => /^(이름|성명|name)$/i.test((s || '').trim());
    const isHeaderMail = (s) => /^(이메일|메일|메일\s*주소|e-?mail)$/i.test((s || '').trim());
    return (isHeaderCell(first.name) || isHeaderMail(first.email)) ? entries.slice(1) : entries;
  }

  async function uploadRosterCsv() {
    const input = $('rosterCsvInput');
    const file = input.files && input.files[0];
    if (!file) { msg($('rosterCsvMsg'), '업로드할 파일을 선택해 주세요.', 'warn'); return; }
    const isExcel = /\.xlsx?$/i.test(file.name);

    const btn = $('rosterCsvUploadBtn');
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '업로드 중…';
    try {
      let rawEntries;
      if (isExcel) {
        await loadXlsxLib();
        rawEntries = parseRosterWorkbook(await file.arrayBuffer());
      } else {
        rawEntries = parseRosterCsv(await file.text());
      }
      const entries = stripCsvHeader(rawEntries).filter((e) => e.name || e.email);
      if (!entries.length) {
        msg($('rosterCsvMsg'),
          '파일에서 이름·이메일 정보를 찾지 못했습니다. "이름, 이메일" 형식인지 확인해 주세요.', 'bad');
        return;
      }

      const names = entries.map((e) => e.name).filter(Boolean);
      const { added: pAdded, skipped: pSkipped } = names.length
        ? await Store.addParticipants(names)
        : { added: [], skipped: [] };

      const mailEntries = entries.filter((e) => e.email);
      const { added: mAdded, skipped: mSkipped, invalid: mInvalid } = mailEntries.length
        ? await Store.addNotifyEmails(mailEntries)
        : { added: [], skipped: [], invalid: [] };

      // 이름+이메일이 함께 있는 행은 [명단 관리] 표의 이메일 칸에도 채워 넣는다.
      // 이미 이메일이 등록돼 있는 참가자는(수동으로 고쳐둔 값을 덮어쓰지 않도록) 건드리지 않는다.
      const nameToEmail = new Map(
        entries.filter((e) => e.name && e.email).map((e) => [CS.U.normalizeNick(e.name), e.email]));
      if (nameToEmail.size) {
        const roster = await Store.listParticipants();
        for (const p of roster) {
          const email = nameToEmail.get(p.nickname);
          if (email && !p.email) {
            await Store.updateParticipant(p.id, { email }).catch(() => {});
          }
        }
      }

      const parts = [
        `참여자 ${pAdded.length}명 등록${pSkipped.length ? ` (중복 ${pSkipped.length}명 건너뜀)` : ''}`,
        `알림 메일 ${mAdded.length}건 등록${mSkipped.length ? ` (중복 ${mSkipped.length}건 건너뜀)` : ''}` +
          `${mInvalid.length ? ` (형식 오류 ${mInvalid.length}건 건너뜀)` : ''}`
      ];
      msg($('rosterCsvMsg'), parts.join(' · '), (pAdded.length || mAdded.length) ? 'ok' : 'warn');
      input.value = '';
      await refresh();
      await refreshNotify();
    } catch (e) {
      msg($('rosterCsvMsg'), `업로드 실패: ${esc(e.message)}`, 'bad');
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  /* ── 공지문 ───────────────────────────── */
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

  /** date(기본 오늘) 하루치 공지문 초안을 자동으로 만든다.
   *  아침에 미리 여러 날짜를 준비할 수 있도록 date를 인자로 받는다 — 이 경우 "어제 인증률"
   *  섹션은 그 날짜가 실제로 마감을 지난 날짜(lastSettledDate 이내)일 때만 보여준다.
   *  (미래 날짜는 아직 그 전날 데이터가 확정되지 않아 "전원 인증 완료"처럼 사실과
   *  다른 문구가 나올 수 있어서다.) 킥아웃 위험 안내는 항상 "지금 시점" 기준이다. */
  function buildNotice(date) {
    date = date || U.today();
    const idx = U.dayIndex(date);
    const total = U.challengeDates().length;
    const yest = U.addDays(date, -1);

    const L = [];
    L.push(`📖 ${CONFIG.title} ${idx ? `${idx}일차` : ''} 공지`);
    L.push(`${U.longLabel(date)}`);
    L.push('');

    if (U.phase(date) === 'before') {
      const d = U.diffDays(date, CONFIG.startDate);
      L.push(`챌린지 시작까지 D-${d} 입니다.`);
      L.push(`OT : ${U.longLabel(CONFIG.otAt.slice(0, 10))} 오전 10시`);
      L.push(`기간 : ${U.longLabel(CONFIG.startDate)} ~ ${U.longLabel(CONFIG.endDate)} (4주)`);
      L.push('');
      L.push('신청 시 등록하신 이름이 인증의 기준이 됩니다.');
      L.push('OT에서 인증 방법을 자세히 안내드릴게요. 🙌');
      return L.join('\n');
    }

    if (U.phase(date) === 'after') {
      const done = stats.reduce((n, s) => n + s.verified, 0);
      const perfect = stats.filter((s) => s.participant.status !== 'out' && s.missed === 0);
      L.push('4주간의 독서챌린지가 모두 끝났습니다. 🎉');
      L.push(`총 인증 ${done}건, 완주(미인증 0회) ${perfect.length}명!`);
      if (perfect.length) L.push(`👑 ${perfect.map((s) => s.participant.nickname).join(', ')}`);
      L.push('');
      L.push('함께 읽어주셔서 감사합니다.');
      return L.join('\n');
    }

    const settled = U.lastSettledDate();
    if (yest >= CONFIG.startDate && settled && yest <= settled) {
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

    const risk = stats.filter((s) => s.participant.status !== 'out' && s.atRisk);
    if (risk.length) {
      L.push(`⚠️ 누적 미인증 ${CONFIG.riskThreshold}회 이상 : ` +
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

  /* ── 공지문 (날짜별로 미리 써 두는 초안) ─────── */
  let notices = [];
  let noticeDirty = false; // 저장 안 한 편집 중인 내용을 다른 새로고침이 덮어쓰지 않도록

  async function refreshNotices() {
    notices = await Store.listNotices();
    $('noticeSavedCount').textContent = notices.length
      ? `저장된 공지 ${notices.length}일치`
      : '저장된 공지 없음 (모두 자동 생성 문구)';
  }

  function paintNoticeStatus(date) {
    const saved = notices.find((n) => n.date === date);
    $('noticeStatus').textContent = saved
      ? `저장됨 · 최근 수정 ${U.stampLabel(saved.updatedAt)}`
      : '자동 생성된 초안입니다 (아직 저장하지 않음).';
  }

  /** 날짜 선택창에 맞춰 공지문을 불러온다. 저장된 내용이 있으면 그걸, 없으면
   *  자동 생성 문구를 보여준다. 편집 중(dirty)이면 다른 화면 갱신이 덮어쓰지 않는다. */
  function loadNoticeForDate() {
    if (noticeDirty) return;
    const date = $('noticeDate').value || U.today();
    const saved = notices.find((n) => n.date === date);
    $('noticeOut').value = saved ? saved.text : buildNotice(date);
    paintNoticeStatus(date);
  }

  async function saveNotice() {
    const date = $('noticeDate').value || U.today();
    const text = $('noticeOut').value.trim();
    if (!text) { msg($('noticeMsg'), '저장할 공지 내용을 입력해 주세요.', 'warn'); return; }
    try {
      await Store.setNotice(date, text);
      noticeDirty = false;
      await refreshNotices();
      paintNoticeStatus(date);
      msg($('noticeMsg'), `${U.longLabel(date)} 공지문을 저장했습니다.`, 'ok');
    } catch (e) {
      msg($('noticeMsg'), `저장 실패: ${esc(e.message)}`, 'bad');
    }
  }

  function regenNotice() {
    const date = $('noticeDate').value || U.today();
    $('noticeOut').value = buildNotice(date);
    noticeDirty = true; // 다시 채우기만 했을 뿐 저장 전이므로 다음 새로고침에 덮어써지지 않게
    $('noticeStatus').textContent = '자동 생성 문구로 다시 채웠습니다 ([저장]을 눌러야 반영됩니다).';
  }

  async function deleteNotice() {
    const date = $('noticeDate').value || U.today();
    if (!confirm(`${U.longLabel(date)}에 저장해 둔 공지문을 삭제하고 자동 생성 문구로 되돌릴까요?`)) return;
    await Store.setNotice(date, '');
    noticeDirty = false;
    await refreshNotices();
    loadNoticeForDate();
    msg($('noticeMsg'), '저장한 공지문을 삭제했습니다.', 'ok');
  }

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
          ${U.isLate(s.date, s.createdAt) ? '<span class="tag bad">지각</span>' : ''}
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
  // 본문의 {{APP_URL}}은 CONFIG.appUrl로 발송 시 치환됩니다.
  function defaultNotifySubject() {
    return `[${CONFIG.title}] 오늘 인증하셨나요? 📖`;
  }
  function defaultNotifyBody() {
    return [
      '안녕하세요! 오늘 밤 24시까지 독서 인증을 잊지 않으셨는지 확인해 주세요.',
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
      .split('{{APP_URL}}').join(CONFIG.appUrl);
    $('notifyPreview').textContent = `제목: ${subject}\n\n${body}`;
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
    paintCustomMailResults();
  }

  /* ── 특정 대상에게 1회성 안내 메일 ─────── */

  let customMailTarget = null; // 검색 결과에서 선택된 { name, email }

  function paintCustomMailResults() {
    const kw = $('customMailSearch').value.trim().toLowerCase();
    const box = $('customMailResults');
    if (!kw) { box.innerHTML = ''; return; }

    const matches = notifyEmails.filter((e) => (e.name || '').toLowerCase().includes(kw));
    box.innerHTML = matches.length
      ? `<thead><tr><th>이름</th><th>메일 주소</th><th></th></tr></thead><tbody>${
        matches.map((e) => `<tr>
          <td>${e.name ? esc(e.name) : '<span class="muted">(이름 없음)</span>'}</td>
          <td>${esc(e.email)}</td>
          <td><button class="small" data-pickname="${esc(e.name || '')}" data-pickmail="${esc(e.email)}">선택</button></td>
        </tr>`).join('')}</tbody>`
      : '<tbody><tr><td class="empty">일치하는 이름이 없습니다.</td></tr></tbody>';

    box.querySelectorAll('[data-pickmail]').forEach((el) => {
      el.addEventListener('click', () => selectCustomMailTarget(el.dataset.pickname, el.dataset.pickmail));
    });
  }

  function selectCustomMailTarget(name, email) {
    customMailTarget = { name, email };
    $('customMailTarget').textContent = name ? `${name} (${email})` : email;
    $('customMailSubject').value = `[${CONFIG.title}] 안내드립니다`;
    $('customMailBody').value = name ? `안녕하세요, ${name}님,\n\n` : '안녕하세요,\n\n';
    $('customMailMsg').innerHTML = '';
    $('customMailForm').hidden = false;
    $('customMailBody').focus();
  }

  function cancelCustomMail() {
    customMailTarget = null;
    $('customMailForm').hidden = true;
    $('customMailSubject').value = '';
    $('customMailBody').value = '';
    $('customMailMsg').innerHTML = '';
  }

  async function sendCustomMail() {
    if (!customMailTarget) return;
    const subject = $('customMailSubject').value.trim();
    const body = $('customMailBody').value.trim();
    if (!subject || !body) {
      msg($('customMailMsg'), '제목과 본문을 모두 입력해 주세요.', 'bad');
      return;
    }
    const btn = $('customMailSendBtn');
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '보내는 중…';
    try {
      const res = await fetch('/.netlify/functions/send-custom-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: customMailTarget.email, subject, body })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `서버 응답 오류 (${res.status})`);
      msg($('customMailMsg'), `${esc(customMailTarget.name || customMailTarget.email)}님께 발송했습니다.`, 'ok');
    } catch (e) {
      msg($('customMailMsg'),
        `발송 실패: ${esc(e.message)}. Netlify Function이 배포·설정되어 있는지 확인해 주세요. (README 참고)`, 'bad');
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
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
      U.riskTag(s).label,
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

    $('fDate').min = CONFIG.startDate;
    $('fDate').max = CONFIG.endDate;

    // 공지문은 매일 아침 미리 준비할 수 있도록 시작일부터 최소 30일치(챌린지 기간이 더 길면 그만큼) 고른다.
    const noticeMax = CONFIG.endDate > U.addDays(CONFIG.startDate, 29) ? CONFIG.endDate : U.addDays(CONFIG.startDate, 29);
    $('noticeDate').min = CONFIG.startDate;
    $('noticeDate').max = noticeMax;
    $('noticeDate').value = (U.today() >= CONFIG.startDate && U.today() <= noticeMax) ? U.today() : CONFIG.startDate;

    $('bulkAdd').addEventListener('click', bulkAdd);
    $('rosterCsvUploadBtn').addEventListener('click', uploadRosterCsv);

    $('noticeDate').addEventListener('change', () => { noticeDirty = false; loadNoticeForDate(); });
    $('noticeOut').addEventListener('input', () => { noticeDirty = true; });
    $('noticeRegen').addEventListener('click', regenNotice);
    $('noticeSave').addEventListener('click', saveNotice);
    $('noticeDelete').addEventListener('click', deleteNotice);
    $('copyNotice').addEventListener('click', (e) => copyText($('noticeOut').value, e.target));

    $('applyFilter').addEventListener('click', paintEntries);
    $('fKeyword').addEventListener('keydown', (e) => { if (e.key === 'Enter') paintEntries(); });
    $('clearFilter').addEventListener('click', () => {
      $('fDate').value = ''; $('fParticipant').value = ''; $('fKeyword').value = '';
      paintEntries();
    });

    $('notifyAddBtn').addEventListener('click', addNotifyEmail);
    $('notifySendTest').addEventListener('click', sendNotifyTest);

    $('customMailSearch').addEventListener('input', paintCustomMailResults);
    $('customMailCancelBtn').addEventListener('click', cancelCustomMail);
    $('customMailSendBtn').addEventListener('click', sendCustomMail);

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
    }
  }

  boot().catch((err) => {
    console.error(err);
    document.getElementById('adminAuthGate').insertAdjacentHTML('afterbegin',
      `<div class="note bad">초기화 실패: ${esc(err.message)}</div>`);
  });
})();
