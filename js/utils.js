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

  /** 오늘이 챌린지 기간 중인지 */
  function phase() {
    const t = today();
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

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeNick(s) {
    return String(s || '').trim().replace(/\s+/g, ' ');
  }

  /** 참가자 한 명의 날짜별 상태 계산
   *  'O' 인증 / 'X' 미인증 / 'P' 면제 / '-' 아직 안 지난 날 / '·' 참여 전·아웃 이후
   */
  function statusFor(participant, date, submittedDates, todayISO) {
    // 1) 참여 기간 밖 (합류 전 / 아웃 이후) — 집계 대상 자체가 아님
    if (participant.joinDate && date < participant.joinDate) return '·';
    if (participant.status === 'out' && participant.outDate && date > participant.outDate) return '·';
    // 2) 실제 제출이 있으면 면제일이어도 인증으로 인정
    if (submittedDates.has(date)) return 'O';
    // 3) 운영진이 등록한 면제일
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
      if (!byPid.has(s.participantId)) byPid.set(s.participantId, new Set());
      byPid.get(s.participantId).add(s.date);
    }

    return participants.map((p) => {
      const done = byPid.get(p.id) || new Set();
      const cells = dates.map((d) => ({ date: d, status: statusFor(p, d, done, todayISO) }));
      const missed = cells.filter((c) => c.status === 'X').length;
      const verified = cells.filter((c) => c.status === 'O').length;
      const exempt = cells.filter((c) => c.status === 'P').length;
      const gradable = verified + missed;

      // 연속 인증 (오늘 또는 어제부터 거슬러 올라가며, 면제는 연속을 끊지 않음)
      let streak = 0;
      const upto = dates.filter((d) => d <= todayISO).reverse();
      for (const d of upto) {
        const st = statusFor(p, d, done, todayISO);
        if (st === 'O') streak++;
        else if (st === 'P' || (d === todayISO && st === '-')) continue;
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
        submittedToday: done.has(todayISO),
        atRisk: missed >= CS.CONFIG.kickoutThreshold
      };
    });
  }

  return {
    nowParts, today, secondsToMidnight, addDays, dateRange, diffDays,
    weekday, shortLabel, longLabel, challengeDates, dayIndex, phase,
    lastSettledDate, settledDates, hhmmss, stampLabel, nowStamp, uid,
    normalizeNick, statusFor, buildStats, pad2
  };
})();
