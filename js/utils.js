/* 날짜 / 집계 유틸 (시간대는 CONFIG.timezone 기준으로 계산) */
window.CS = window.CS || {};

CS.U = (function () {
  const TZ = () => CS.CONFIG.timezone;

  /** 지정 시간대의 현재 시각 조각 { date:'YYYY-MM-DD', h, m, s } */
  function nowParts() {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ(),
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });
    const p = {};
    for (const { type, value } of fmt.formatToParts(new Date())) p[type] = value;
    // Intl 은 자정을 '24' 로 주는 경우가 있어 보정
    const h = p.hour === '24' ? 0 : Number(p.hour);
    return {
      date: `${p.year}-${p.month}-${p.day}`,
      h, m: Number(p.minute), s: Number(p.second)
    };
  }

  /** 오늘 날짜 (YYYY-MM-DD, 챌린지 기준 시간대) */
  function today() { return nowParts().date; }

  /** 자정(24:00)까지 남은 초 */
  function secondsToMidnight() {
    const { h, m, s } = nowParts();
    return 24 * 3600 - (h * 3600 + m * 60 + s);
  }

  /** 'YYYY-MM-DD' → UTC 자정 Date (날짜 연산 전용, 시간대 영향 없음) */
  function toDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  function toISO(dt) {
    return dt.toISOString().slice(0, 10);
  }

  function addDays(iso, n) {
    const dt = toDate(iso);
    dt.setUTCDate(dt.getUTCDate() + n);
    return toISO(dt);
  }

  /** from~to (양끝 포함) 날짜 배열 */
  function dateRange(from, to) {
    const out = [];
    let cur = from;
    let guard = 0;
    while (cur <= to && guard++ < 1000) { out.push(cur); cur = addDays(cur, 1); }
    return out;
  }

  function diffDays(a, b) {
    return Math.round((toDate(b) - toDate(a)) / 86400000);
  }

  const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
  function weekday(iso) { return WEEKDAY[toDate(iso).getUTCDay()]; }

  /** '8/24(월)' 형태 */
  function shortLabel(iso) {
    const [, m, d] = iso.split('-');
    return `${Number(m)}/${Number(d)}(${weekday(iso)})`;
  }

  /** '2026년 8월 24일(월)' 형태 */
  function longLabel(iso) {
    const [y, m, d] = iso.split('-');
    return `${y}년 ${Number(m)}월 ${Number(d)}일(${weekday(iso)})`;
  }

  /** 챌린지 전체 날짜 배열 */
  function challengeDates() {
    return dateRange(CS.CONFIG.startDate, CS.CONFIG.endDate);
  }

  /** 챌린지 기준 오늘이 며칠차인지 (1-based, 범위 밖이면 null) */
  function dayIndex(iso) {
    const i = diffDays(CS.CONFIG.startDate, iso) + 1;
    return i >= 1 && i <= challengeDates().length ? i : null;
  }

  /** 특정 날짜(기본은 오늘)가 챌린지 기간 중인지. 공지문을 미리 쓸 미래 날짜를
   *  판정할 때는 iso를 넘겨서 그 날짜 기준으로 before/running/after를 가른다. */
  function phase(iso) {
    const t = iso || today();
    if (t < CS.CONFIG.startDate) return 'before';
    if (t > CS.CONFIG.endDate) return 'after';
    return 'running';
  }

  /**
   * 집계 대상 마지막 날짜 = 어제.
   * 오늘은 24:00 마감 전이라 미인증으로 확정하지 않는다.
   */
  function lastSettledDate() {
    const y = addDays(today(), -1);
    if (y < CS.CONFIG.startDate) return null;
    return y > CS.CONFIG.endDate ? CS.CONFIG.endDate : y;
  }

  /** 확정된(마감이 지난) 날짜 배열 */
  function settledDates() {
    const last = lastSettledDate();
    return last ? dateRange(CS.CONFIG.startDate, last) : [];
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function hhmmss(totalSec) {
    const s = Math.max(0, totalSec);
    return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`;
  }

  /** 제출 시각 표시용 (KST) */
  function stampLabel(isoTimestamp) {
    if (!isoTimestamp) return '-';
    return new Date(isoTimestamp).toLocaleString('ko-KR', {
      timeZone: TZ(), month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  }

  function nowStamp() { return new Date().toISOString(); }

  /** 특정 날짜의 마감 시각(그 날 24:00 KST = 다음날 00:00 KST)을 UTC ISO 문자열로.
   *  createdAt(둘 다 new Date().toISOString() 형식이라 문자열 비교로 정확히 비교 가능)과 비교해
   *  "그 날짜 안에 제출됐는지"를 판정하는 데 쓴다. */
  function deadlineInstant(date) {
    return `${date}T15:00:00.000Z`;
  }

  /** 해당 날짜의 제출이 마감을 넘겨 이뤄졌는지 (지각 여부) */
  function isLate(date, createdAt) {
    return !!createdAt && createdAt > deadlineInstant(date);
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeNick(s) {
    return String(s || '').trim().replace(/\s+/g, ' ');
  }

  /** 참가자 한 명의 날짜별 상태 계산
   *  'O' 인증 / 'X' 미인증 / 'P' 면제 / '-' 아직 안 지난 날 / '·' 참여 전·아웃 이후
   *
   *  참가자는 인증 폼에서 어떤 날짜로 제출할지 직접 고를 수 있어(지난 날짜 포함),
   *  단순히 "그 날짜로 제출 기록이 있는지"만으로는 지각 여부를 가릴 수 없다.
   *  그래서 제출 기록의 실제 생성 시각(createdAt)이 그 날짜의 마감(24:00 KST)
   *  이전인지로 인증(O) 여부를 판정한다 — 마감을 넘긴 제출은 기록은 남지만 계속 'X'다.
   */
  function statusFor(participant, date, submissionByDate, todayISO) {
    // 1) 참여 기간 밖 (합류 전 / 아웃 이후) — 집계 대상 자체가 아님
    if (participant.joinDate && date < participant.joinDate) return '·';
    if (participant.status === 'out' && participant.outDate && date > participant.outDate) return '·';
    // 2) 마감 전에 제출된 기록이 있으면 면제일이어도 인증으로 인정
    const sub = submissionByDate.get(date);
    if (sub && !isLate(date, sub.createdAt)) return 'O';
    // 3) 운영진이 등록한 면제일 (지각 제출로 기록만 남은 경우도 면제일이면 P)
    if ((participant.exemptDates || []).includes(date)) return 'P';
    // 4) 오늘은 24:00 마감 전이므로 아직 미확정, 미래도 마찬가지
    if (date >= todayISO) return '-';
    return 'X';
  }

  /** 참가자별 통계 (미인증 수, 인증 수, 연속 인증 등) */
  function buildStats(participants, submissions, todayISO) {
    todayISO = todayISO || today();
    const dates = challengeDates();
    const byPid = new Map();
    for (const s of submissions) {
      if (!byPid.has(s.participantId)) byPid.set(s.participantId, new Map());
      byPid.get(s.participantId).set(s.date, s);
    }

    return participants.map((p) => {
      const subMap = byPid.get(p.id) || new Map();

      // 킥아웃이 확정된 날(누적 미인증이 kickoutThreshold에 도달한 날)에서 집계를 멈춘다.
      // 그 뒤 날짜는 '·'(해당 없음)로 두어 미인증이 계속 쌓이지 않게 한다.
      let running = 0;
      let kickoutDate = null;
      const cells = dates.map((d) => {
        if (kickoutDate) return { date: d, status: '·' };
        const status = statusFor(p, d, subMap, todayISO);
        if (status === 'X' && ++running >= CS.CONFIG.kickoutThreshold) kickoutDate = d;
        return { date: d, status };
      });

      const missed = cells.filter((c) => c.status === 'X').length;
      const verified = cells.filter((c) => c.status === 'O').length;
      const exempt = cells.filter((c) => c.status === 'P').length;
      const gradable = verified + missed;

      // 연속 인증 (오늘 또는 어제부터 거슬러 올라가며, 면제는 연속을 끊지 않음)
      let streak = 0;
      for (const c of cells.filter((x) => x.date <= todayISO).reverse()) {
        if (c.status === 'O') streak++;
        else if (c.status === 'P' || (c.date === todayISO && c.status === '-')) continue;
        else break;
      }

      return {
        participant: p,
        cells,
        missed,
        verified,
        exempt,
        rate: gradable ? Math.round((verified / gradable) * 100) : 0,
        streak,
        submittedToday: subMap.has(todayISO),
        // atRisk(위험군, riskThreshold 이상)와 kickoutEligible(실제 킥아웃 대상, kickoutThreshold 이상)을
        // 분리해서, "위험" 단계를 킥아웃보다 먼저 경고로 보여줄 수 있게 한다. kickoutEligible이면
        // atRisk도 항상 true다(더 심한 상태를 포함).
        atRisk: missed >= CS.CONFIG.riskThreshold,
        kickoutEligible: missed >= CS.CONFIG.kickoutThreshold,
        // 킥아웃이 확정된 날짜 (아직 아니면 null) — 이 날 이후는 집계하지 않는다
        kickoutDate
      };
    });
  }

  /** 참가자 한 명의 상태 뱃지 { cls, label } — 심한 순서로 킥아웃/아웃 > 킥아웃 대상 > 위험 > 참여중.
   *  '아웃' 처리된 사람 중에서도 kickReason이 'kickout'이면(미인증 누적으로 실제 킥아웃된 경우)
   *  더 명확하게 '킥아웃'으로 구분해서 보여준다.
   *  admin.js·app.js의 명단/매트릭스/전체현황/나의현황 화면이 공통으로 사용한다. */
  function riskTag(stat) {
    if (stat.participant.status === 'out') {
      return stat.participant.kickReason === 'kickout'
        ? { cls: 'bad', label: '킥아웃' }
        : { cls: 'bad', label: '아웃' };
    }
    if (stat.kickoutEligible) return { cls: 'bad', label: '킥아웃 대상' };
    if (stat.atRisk) return { cls: 'warn', label: '위험' };
    return { cls: 'ok', label: '참여중' };
  }

  /* ── 아이콘 ────────────────────────────
   * 이모지 대신 쓰는 미니멀 선(stroke) 아이콘. 색은 글자색(currentColor)을 따라가고
   * 크기는 em 기준이라 버튼 글씨 크기에 맞춰 자연스럽게 커지고 작아진다. */
  const ICON_PATHS = {
    // 사각형 두 개가 겹친 전형적인 '복사' 표시
    copy: '<rect x="5.6" y="5.6" width="8" height="8" rx="1.6"/>'
        + '<path d="M10.4 2.6H4.1a1.5 1.5 0 0 0-1.5 1.5v6.3"/>',
    check: '<path d="M3 8.6 6.4 12l6.6-7.4"/>',
    thumb: '<rect x="1.7" y="6.9" width="3.1" height="6.9" rx="0.9"/>'
         + '<path d="M4.8 7.5 8.2 2.6a1.3 1.3 0 0 1 2.34 1l-.44 2.8h3.1a1.4 1.4 0 0 1 1.37 1.7l-.95 4.3a1.5 1.5 0 0 1-1.47 1.18H4.8z"/>',
    refresh: '<path d="M13.4 8a5.4 5.4 0 1 1-1.6-3.85"/><path d="M13.7 2.7v3h-3"/>',
    download: '<path d="M8 2.7v7.5"/><path d="M4.9 7.3 8 10.4l3.1-3.1"/>'
            + '<path d="M2.8 12.4v.7a1.2 1.2 0 0 0 1.2 1.2h8a1.2 1.2 0 0 0 1.2-1.2v-.7"/>',
    down: '<path d="M4.2 6.3 8 10.1l3.8-3.8"/>',
    left: '<path d="M10 3.4 5.6 8l4.4 4.6"/>',
    right: '<path d="M6 3.4 10.4 8 6 12.6"/>'
  };

  /** 이름으로 인라인 SVG 아이콘 문자열을 만든다. 버튼 안에 그대로 넣어 쓴다. */
  function icon(name) {
    const d = ICON_PATHS[name];
    if (!d) return '';
    return `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${d}</svg>`;
  }

  return {
    icon,
    nowParts, today, secondsToMidnight, addDays, dateRange, diffDays,
    weekday, shortLabel, longLabel, challengeDates, dayIndex, phase,
    lastSettledDate, settledDates, hhmmss, stampLabel, nowStamp, uid,
    normalizeNick, deadlineInstant, isLate, statusFor, buildStats, riskTag, pad2
  };
})();
