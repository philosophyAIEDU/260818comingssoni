/* 시즌 설명서(seasons/<id>.json) → 일정 계산 + 문서 자리표시자 값.
 *
 * 문서는 두 겹으로 나뉜다.
 *   상수 — tools/templates/*  : 상세페이지·설명서·일정표·카톡공지의 구조와 문구. 책이 바뀌어도 그대로.
 *   변수 — seasons/<id>.json  : 책 정보·링크·책마다 다른 문단(pages.*)·일자별 분량.
 *          날짜·요일·회차·기간 같은 값은 여기서 month 하나로 계산한다 — 사람이 손으로 적지 않는다.
 * new-season.mjs(시즌 추가)와 season-render.mjs(문서 렌더·최종본 대조)가 같이 쓴다.
 */

/* ── 날짜 도우미 (KST 기준, 시간대 계산 없이 문자열로만 다룬다) ── */
export const D = (iso) => new Date(iso + 'T00:00:00Z');
export const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const addMonths = (s, n) => { const d = D(s); d.setUTCMonth(d.getUTCMonth() + n); return iso(d); };
const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const wd = (s) => WD[D(s).getUTCDay()];
export const md = (s) => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;
export const longD = (s) => `${+s.slice(0, 4)}년 ${+s.slice(5, 7)}월 ${+s.slice(8, 10)}일(${wd(s)})`;
export const shortD = (s) => `${md(s)}(${wd(s)})`;

/* ── 일정 규칙 (매달 같다) ── */
export const DAYS = 28;
export const LIVE_DAYS = [7, 14, 21, 28];
const FIRST_READ_LAST = 20;
const REREAD_DAYS = [22, 23, 24, 25, 26, 27];

/* ── 커리큘럼 (목차만 있을 때 초안) ── */
const INTRO_DAY = [{ ch: '', s: [
  '🎯 <strong>책 준비 + 목차 전체 훑어보기</strong>',
  '① 목차에서 <strong>가장 기대되는 꼭지 한 가지</strong>와, 왜 그런지',
  '② 이번 책에서 <strong>내가 얻고 싶은 것 1가지</strong>를 선언하세요'
] }];
const liveDay = (n) => [{ ch: '', s: [
  `🔴 <strong>라이브 ${n}회차</strong> — ${n === 4 ? '마지막 시간입니다. ' : (n === 3 ? '완독 기념. ' : '')}새로 읽을 분량은 없습니다. 밀린 분량이 있다면 오늘 따라잡아 주세요.`,
  '오전에 올라오는 <strong>발제문</strong>을 보고 생각을 정리해 <strong>[읽고 느낀 점]</strong>에 남기면 오늘 인증 완료입니다.'
] }];
// 1회독 마지막 날(20일차)·2회독 마지막 날(27일차)에 그날 분량 뒤로 붙이는 한 줄
const RECAP_NOTE = '📗 <strong>1회독 완독!</strong> 내 밑줄 BEST 5를 골라 두세요 (2회독과 마지막 라이브의 재료가 됩니다)';
const FINAL_NOTE = '🏆 내일 마지막 라이브 전에 <strong>28일 중 나의 최고 문장 1개</strong>를 골라 두세요';

/** 무게(쪽수)가 있는 항목들을 순서를 지키며 n개 묶음으로 나눈다. 묶음마다 최소 1개. */
function splitByWeight(items, n) {
  if (items.length <= n) return items.map((x) => [x]);
  const total = items.reduce((a, x) => a + x.w, 0);
  const out = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * (k + 1)) / n;
    const chunk = [items[i++]];
    let acc = out.flat().reduce((a, x) => a + x.w, 0) + chunk[0].w;
    // 남은 묶음 수만큼은 항목을 남겨 둬야 한다
    while (i < items.length && items.length - i > n - k - 1 && acc + items[i].w / 2 <= target) {
      acc += items[i].w;
      chunk.push(items[i++]);
    }
    out.push(chunk);
  }
  while (i < items.length) out[out.length - 1].push(items[i++]);
  return out;
}

/** 목차 → 28일 커리큘럼. toc: [{ ch:'1장', title:'…', s:['소제목'…], pages?: 40 }] */
export function planFromToc(toc) {
  const firstReadDays = [];
  for (let d = 2; d <= FIRST_READ_LAST; d++) if (!LIVE_DAYS.includes(d)) firstReadDays.push(d);
  // 소제목 단위로 펼치고, 장의 쪽수를 소제목 수로 나눠 무게로 쓴다(쪽수가 없으면 1)
  const items = [];
  toc.forEach((c) => {
    const subs = c.s && c.s.length ? c.s : [c.title || c.ch];
    const w = c.pages ? c.pages / subs.length : 1;
    subs.forEach((t) => items.push({ ch: c.ch || '', text: t, w }));
  });
  const chunks = splitByWeight(items, firstReadDays.length);
  const plan = new Array(DAYS).fill(null);
  plan[0] = INTRO_DAY;
  LIVE_DAYS.forEach((d, i) => { plan[d - 1] = liveDay(i + 1); });
  firstReadDays.forEach((d, i) => {
    const chunk = chunks[i];
    if (!chunk) { plan[d - 1] = [{ ch: '', s: ['📌 지난 이틀 분량을 다시 읽고 밑줄을 정리하세요'] }]; return; }
    const groups = [];
    chunk.forEach((it) => {
      const last = groups[groups.length - 1];
      if (last && last.ch === it.ch) last.s.push(it.text);
      else groups.push({ ch: it.ch, s: [it.text] });
    });
    plan[d - 1] = groups;
  });
  plan[FIRST_READ_LAST - 1] = [...plan[FIRST_READ_LAST - 1], { ch: '', s: [RECAP_NOTE] }];
  // 2회독: 22~27일차 — 1회독과 같은 무게로 6등분해 "몇 번째 꼭지부터 몇 번째까지"로 보여 준다
  const rechunks = splitByWeight(items, REREAD_DAYS.length);
  const head = (it) => `「${String(it.text).split(' / ')[0]}」`;
  REREAD_DAYS.forEach((d, i) => {
    const cs = rechunks[i];
    plan[d - 1] = [{ ch: '2회독', s: [cs ? `${head(cs[0])} ~ ${head(cs[cs.length - 1])}` : '밑줄 친 부분 다시 읽기'] }];
  });
  plan[REREAD_DAYS[REREAD_DAYS.length - 1] - 1][0].s.push(FINAL_NOTE);
  return plan;
}

/** 받침이 있으면 '은', 없으면 '는' — 『혁명의 팡파르』는 · 『꿈과 돈』은 */
export function josaEunNeun(word) {
  const c = String(word).trim().slice(-1).charCodeAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 ? '은' : '는';
  return '은(는)';
}

/** 받침이 있으면 '을', 없으면 '를' */
export function josaEulReul(word) {
  const c = String(word).trim().slice(-1).charCodeAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 ? '을' : '를';
  return '을(를)';
}

/** "22:00" → "22시", "21:30" → "21시 30분" */
const hourLabel = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return m ? `${h}시 ${m}분` : `${h}시`;
};

/* 라이브 회차 = "라이브 N회차"로 시작하는 줄이 있는 날 */
const isLive = (line) => /^\s*(?:[^\w가-힣]*\s*)?(?:<[^>]+>\s*)*라이브\s*\d+\s*회차/
  .test(String(line).replace(/<\/?strong>/g, ''));

const strip = (s) => String(s).replace(/<[^>]+>/g, '');

/** 시즌 설명서 → 일정 + 자리표시자 값. 필수 항목이 없으면 Error. */
export function seasonVars(spec) {
  const need = (v, k) => { if (v == null || v === '') throw new Error(`시즌 설명서에 "${k}"가 없습니다.`); return v; };
  let startDate = spec.startDate;
  if (!startDate) {
    const month = need(spec.month, 'month'); // "2026-10"
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('"month"는 "2026-10" 형식이어야 합니다.');
    startDate = `${month}-21`;
  }
  const endDate = spec.endDate || addDays(startDate, DAYS - 1);
  const days = Math.round((D(endDate) - D(startDate)) / 86400000) + 1;
  const switchAt = spec.switchAt || `${startDate}T01:00`;
  const lockPrevAt = `${startDate}T02:00`;
  const retroFrom = addDays(endDate, 1);
  // 자산화 기간은 다음 달 20일까지 — 다음 시즌이 21일에 시작하니까
  const nextStart = (() => { const d = D(startDate); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(21); return iso(d); })();
  const retroUntil = spec.retroUntil || addDays(nextStart, -1);
  const recruitLabel = spec.recruitLabel
    || `${shortD(addDays(startDate, -3))} ~ ${shortD(addDays(startDate, -1))} 23:59, 3일간 모집`;
  const monthLabel = spec.monthLabel || `${+startDate.slice(5, 7)}월`;
  const liveStart = spec.liveStart || '22:00';
  const liveEnd = spec.liveEnd || '22:30';
  const liveTime = spec.liveTime || `${liveStart} - ${liveEnd}`;
  const gift = spec.giftMissLimit || 6;

  const plan = spec.readingPlan || (spec.toc ? planFromToc(spec.toc) : null);
  if (!plan) throw new Error('시즌 설명서에 "toc"(목차)나 "readingPlan"이 있어야 합니다.');

  const liveDates = plan
    .map((d, i) => ({ i, lines: d.flatMap((g) => g.s || []) }))
    .filter((x) => x.lines.some(isLive))
    .map((x) => addDays(startDate, x.i));
  const liveWd = liveDates.length ? wd(liveDates[0]) : wd(addDays(startDate, 6));
  // 자동결제 예시: 모집 둘째 날 결제 → 다음 달 같은 날
  const payEx = addDays(startDate, -2);
  const book = spec.book || {};
  const pages = spec.pages || {};

  const vars = {
    '월': monthLabel,
    '다음월': `${+addMonths(startDate, 1).slice(5, 7)}월`,
    '책이름': book.name,
    '은는': josaEunNeun(book.name || ''),
    // 앱 책 소개의 \n은 넓은 화면 줄바꿈 자리 — 카톡 공지에서는 한 문단으로 잇는다
    '책소개': String(book.desc || '').replace(/\s*\n\s*/g, ' '),
    '저자표기': book.byline,
    '책표지URL': book.coverUrl,
    '일수': String(days),
    '기간표기': `${shortD(startDate)} ~ ${shortD(endDate)}`,
    '시작일표기': shortD(startDate),
    '종료일표기': shortD(endDate),
    '모집기간': recruitLabel,
    '라이브요일': liveWd,
    '라이브시작': liveStart,
    '라이브끝': liveEnd,
    '라이브시각': hourLabel(liveStart),
    '라이브날짜': liveDates.map(md).join(' · '),
    '라이브횟수': String(liveDates.length),
    '라이브표': liveDates.map((d, i) => `| 라이브 ${i + 1}회차 | ${shortD(d)} ${liveStart} |`).join('\n'),
    '자산화기간': `${shortD(retroFrom)} ~ ${shortD(retroUntil)}`,
    '결제예시일': md(payEx),
    '결제예시다음': md(addMonths(payEx, 1)),
    '선물기준': String(gift),
    '신청링크': spec.applyUrl,
    'OT링크': spec.otUrl,
    '설명서링크': spec.guideUrl,
    '일정표링크': spec.scheduleUrl,
    '앱주소': spec.appUrl || 'https://personalmakersbook.netlify.app/',
    // 책마다 다른 문단 — 시즌 설명서 pages.* 에 적는다
    '상세_책소개': pages.detailBookIntro,
    '상세_책준비': pages.detailBookPrep,
    '설명서_책준비': pages.guideBookPrep,
    '4주차방법': pages.guideWeek4,
    '기준도서': pages.baseBook,
    // 노션 표 한 칸 안에서 줄을 바꾼다. 장 표기(ch)가 있으면 첫 줄 앞에 "ch — "
    '일정표': plan.map((day, i) => {
      const lines = day.flatMap((g) => {
        const items = (g.s || []).map(strip);
        if (g.ch && items.length) items[0] = `${g.ch} — ${items[0]}`;
        return items;
      });
      return `| ${i + 1}일차 | ${shortD(addDays(startDate, i))} | ${lines.join('\n')} |`;
    }).join('\n')
  };

  return {
    startDate, endDate, days, switchAt, lockPrevAt, retroFrom, retroUntil, nextStart,
    recruitLabel, monthLabel, liveTime, liveStart, liveEnd, gift, plan, liveDates, liveWd, vars
  };
}

/** {{자리표시자}} 채우기. 값 안에 든 자리표시자도 한 번 더 채운다(책 문단에 {{시작일표기}} 등).
 *  채우지 못한 이름은 leftovers 에 모은다. */
export function fill(text, vars, leftovers = new Set()) {
  const once = (t) => t.replace(/\{\{([^}]+)\}\}/g, (m, k) => {
    const v = vars[k.trim()];
    return v == null ? m : v;
  });
  const out = once(once(text));
  for (const m of out.matchAll(/\{\{([^}]+)\}\}/g)) leftovers.add(m[1].trim());
  return out;
}

export const TEMPLATES = ['상세페이지.md', '설명서.md', '일정표.md', '카톡공지.txt'];
