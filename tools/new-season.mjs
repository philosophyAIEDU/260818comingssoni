#!/usr/bin/env node
/* 시즌 설명서(JSON) 한 장으로 다음 시즌을 통째로 준비한다.
 *
 *   node tools/new-season.mjs seasons/s3.json          → 미리보기만
 *   node tools/new-season.mjs seasons/s3.json --write  → config.js에 시즌 추가 + 문서 초안 생성
 *
 * 일정 규칙 (커밍쏜이 정한 것 — 매달 같다)
 *   - 매달 21일에 시작해서 28일(4주). 라이브는 각 주 7일째 = 7·14·21·28일차, 22:00.
 *     그래서 라이브 요일은 시작일 요일과 같다(9/21 월요일 시작 → 일요일 라이브).
 *   - 종료 다음 날부터 다음 달 20일까지는 회고 세션(정리본 발송 · 최고 문장 나눔 · 다음 책 준비).
 *   - 커리큘럼: 1일차 목차 훑기 → 2~19일차 1회독(라이브 날 제외 16일) → 20일차 1회독 결산
 *     → 22~26일차 2회독 → 27일차 밑줄 총정리. 목차(toc)만 주면 쪽수 비중으로 나눈다.
 *
 * 만들어 주는 것
 *   1) js/config.js 의 CS.SEASONS 에 시즌 객체 추가 (+ 앞 시즌 lockAt 자동)
 *   2) out/상세페이지.md · out/설명서.md · out/일정표.md · out/카톡공지.txt  (모집·안내 문구 초안)
 *   3) out/노션게시.json — 위 문서를 노션 어디에 어떤 제목으로 올릴지 (스킬이 읽는다)
 *   4) 사람이 확인해야 하는 것 목록
 *
 * 시즌이 config에 들어가 있으면 전환은 저절로 된다 — 활성 시즌은 배포가 아니라
 * startsAt(KST) 시각이 고르기 때문이다. 미리 머지해 두면 그날 새벽에 알아서 바뀐다.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [, , specPath, ...flags] = process.argv;
const WRITE = flags.includes('--write');
if (!specPath) {
  console.error('사용법: node tools/new-season.mjs <시즌.json> [--write]');
  process.exit(2);
}
const spec = JSON.parse(readFileSync(specPath, 'utf8'));

/* ── 날짜 도우미 (KST 기준, 시간대 계산 없이 문자열로만 다룬다) ── */
const D = (iso) => new Date(iso + 'T00:00:00Z');
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const wd = (s) => WD[D(s).getUTCDay()];
const md = (s) => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;
const longD = (s) => `${+s.slice(0, 4)}년 ${+s.slice(5, 7)}월 ${+s.slice(8, 10)}일(${wd(s)})`;
const shortD = (s) => `${md(s)}(${wd(s)})`;

const need = (k) => { if (spec[k] == null) { console.error(`시즌 설명서에 "${k}"가 없습니다.`); process.exit(2); } return spec[k]; };

/* ── 일정: 매달 21일 시작, 28일, 라이브 7·14·21·28일차, 회고는 다음 달 20일까지 ── */
const DAYS = 28;
const LIVE_DAYS = [7, 14, 21, 28];
let startDate = spec.startDate;
if (!startDate) {
  const month = need('month'); // "2026-10"
  if (!/^\d{4}-\d{2}$/.test(month)) { console.error('"month"는 "2026-10" 형식이어야 합니다.'); process.exit(2); }
  startDate = `${month}-21`;
}
const endDate = spec.endDate || addDays(startDate, DAYS - 1);
const days = Math.round((D(endDate) - D(startDate)) / 86400000) + 1;
const switchAt = spec.switchAt || `${startDate}T02:00`;
const lockPrevAt = `${startDate}T03:00`;
const retroFrom = addDays(endDate, 1);
// 회고는 다음 달 20일까지 — 다음 시즌이 21일에 시작하니까
const nextStart = (() => { const d = D(startDate); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(21); return iso(d); })();
const retroUntil = spec.retroUntil || addDays(nextStart, -1);
const recruitLabel = spec.recruitLabel
  || `${shortD(addDays(startDate, -3))} ~ ${shortD(addDays(startDate, -1))} 23:59, 3일간 모집`;
const monthLabel = spec.monthLabel || `${+startDate.slice(5, 7)}월`;
const liveTime = spec.liveTime || '22:00 - 22:30';

/* ── 커리큘럼 ── */
const INTRO_DAY = [{ ch: '', s: [
  '🎯 <strong>책 준비 + 목차 전체 훑어보기</strong>',
  '① 목차에서 <strong>가장 기대되는 꼭지 한 가지</strong>와, 왜 그런지',
  '② 이번 책에서 <strong>내가 얻고 싶은 것 1가지</strong>를 선언하세요'
] }];
const liveDay = (n) => [{ ch: '', s: [
  `🔴 <strong>라이브 ${n}회차</strong> — ${n === 4 ? '마지막 시간입니다. ' : (n === 3 ? '완독 기념. ' : '')}새로 읽을 분량은 없습니다. 밀린 분량이 있다면 오늘 따라잡아 주세요.`,
  '오전에 올라오는 <strong>발제문</strong>을 보고 생각을 정리해 <strong>[읽고 느낀 점]</strong>에 남기면 오늘 인증 완료입니다.'
] }];
const RECAP_DAY = [{ ch: '', s: [
  '📝 <strong>1회독 결산 — 내 밑줄 BEST 10 선정</strong>',
  '전체 밑줄 중 <strong>최고의 5문장</strong>을 골라 인증해주세요. (2회독과 마지막 라이브의 재료가 됩니다)',
  '못 읽은 부분이 있다면 오늘 마저!'
] }];
const FINAL_DAY = [{ ch: '', s: ['밑줄 총정리 · 🏆 <strong>28일 중 나의 최고 문장 1개</strong> 선정'] }];

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
function planFromToc(toc) {
  const firstReadDays = [];
  for (let d = 2; d <= 19; d++) if (!LIVE_DAYS.includes(d)) firstReadDays.push(d);
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
  plan[19] = RECAP_DAY;
  // 2회독: 22~26일차, 장 단위
  const chapters = toc.map((c) => ({ label: `${c.ch}${c.title ? ' ' + c.title : ''}`.trim(), w: c.pages || (c.s ? c.s.length : 1) }));
  const rechunks = splitByWeight(chapters, 5);
  [22, 23, 24, 25, 26].forEach((d, i) => {
    const cs = rechunks[i];
    plan[d - 1] = [{ ch: '2회독', s: [cs ? cs.map((c) => c.label).join(' + ') : '밑줄 친 부분 다시 읽기'] }];
  });
  plan[26] = FINAL_DAY;
  return plan;
}

const plan = spec.readingPlan || (spec.toc ? planFromToc(spec.toc) : null);
if (!plan) { console.error('시즌 설명서에 "toc"(목차)나 "readingPlan"이 있어야 합니다.'); process.exit(2); }

/* 라이브 회차 = "라이브 N회차"로 시작하는 줄이 있는 날 */
const isLive = (line) => /^\s*(?:[^\w가-힣]*\s*)?(?:<[^>]+>\s*)*라이브\s*\d+\s*회차/
  .test(String(line).replace(/<\/?strong>/g, ''));
const liveDates = plan
  .map((d, i) => ({ i, lines: d.flatMap((g) => g.s || []) }))
  .filter((x) => x.lines.some(isLive))
  .map((x) => addDays(startDate, x.i));
const liveWd = liveDates.length ? wd(liveDates[0]) : wd(addDays(startDate, 6));

/* ── 1) 시즌 객체 ── */
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const q = (v) => (v == null ? 'null' : `'${esc(v)}'`);
const planSrc = plan.map((day) => {
  const groups = day.map((g) =>
    `{ ch: '${esc(g.ch || '')}', s: [${(g.s || []).map((x) => `'${esc(x)}'`).join(', ')}] }`);
  return `    [${groups.join(',\n      ')}],`;
}).join('\n');
const promptsSrc = (spec.weeklyPrompts || []).map((w) =>
  `    { day: ${w.day}, questions: [\n${(w.questions || []).map((x) => `      '${esc(x)}'`).join(',\n')}\n    ] }`).join(',\n');

const seasonSrc = `, {
  id: ${q(need('id'))},
  label: ${q(need('label'))},
  startsAt: ${q(switchAt)},   // 이 시각(KST)이 지나면 저절로 이 시즌이 켜진다
  title: '퍼스널메이커스 독서 멤버십',
  subtitle: '${esc(spec.book.name)} 인증 시스템',
  periodLabel: '멤버십 기간',
  book: {
    name: ${q(spec.book.name)},
    tagline: ${q(spec.book.tagline || '')},
    byline: ${q(spec.book.byline)},
    cover: ${q(spec.book.cover)},
    desc: ${q(spec.book.desc)}
  },
  live: {
    label: '매주 ${liveWd}요일 ${esc(liveTime)} (${liveDates.map(md).join(' · ')})',
    note: '* 다시보기는 제공되지 않으니 꼭 시간내어 참여해주세요.'
  },
  rulesHeading: '안내 · 멤버십 규칙',
  headLinks: [
    { label: '독서 멤버십 OT 보기', icon: 'play', url: ${q(spec.otUrl)} },
    { label: '${esc(monthLabel)} 퍼메스 독서 멤버십 설명서', icon: 'book', url: ${q(spec.guideUrl)} }
  ],
  extraRules: [
    '<strong>${liveWd}요일은 새로 읽을 분량이 없습니다.</strong> 그날 오전 단톡방에 올라오는 <strong>발제문</strong>을 '
      + '보고 생각을 정리해 <strong>[읽고 느낀 점]</strong>에 남기면 그날 인증이 완료됩니다. '
      + '밀린 분량이 있다면 이날 따라잡아 주세요.',
    '인증을 놓쳐도 <strong>킥아웃되지 않습니다</strong>. 다만 ${days}일 동안 <strong>누락이 ${spec.giftMissLimit || 6}회 미만(${(spec.giftMissLimit || 6) - 1}회 이하)</strong>이면 '
      + '커밍쏜이 직접 정리한 『${esc(spec.book.name)}』 <strong>인사이트 정리본</strong>을 드립니다.',
    ${q(spec.bookEditionRule || '')} ,
    '${days}일간 기록한 내용은 <strong>한 번에 내려받을 수</strong> 있습니다. 화면 맨 아래 <strong>[나의 현황]</strong>에서 '
      + '지금까지 몇 번 인증했고 몇 번 놓쳤는지도 확인할 수 있습니다.'
  ].filter(Boolean),
  sentencePlaceholder: 'ex) 오늘 범위에서 가장 와닿은 한 문장을 그대로 옮겨 적고, '
    + '끝에 쪽수를 붙여 주세요. (예: … - 47쪽)',
  reflectionPlaceholder: '짧아도 좋습니다. 오늘 읽은 내용을 내 브랜드·일에 어떻게 적용할지 적어주세요.',
  startDate: ${q(startDate)},
  endDate: ${q(endDate)},
  // 1일차는 단톡방 입장 당일이라 누락으로 세지 않는다.
  gradeFrom: ${q(addDays(startDate, 1))},
  // 종료 다음 날부터 이 날까지는 회고 세션 — 앱이 안내를 띄운다(인증은 닫힌 채로).
  retroUntil: ${q(retroUntil)},
  dataPrefix: ${q(spec.id)},
  storagePrefix: ${q('comingsoon.reading.' + spec.id)},
  lockAt: null,
  kickoutEnabled: false,
  kickoutThreshold: Infinity,
  riskThreshold: Infinity,
  autoWarnThreshold: Infinity,
  // 🎁 정리본 선물 기준 — 누락이 이 횟수 미만이면 대상. 운영진 [알림 메일 › 선물 대상자]가 쓴다.
  giftMissLimit: ${spec.giftMissLimit || 6},
  // 📝 주간 발제문 — 라이브 날 앱 [오늘의 범위]와 운영진 [공지문 › 발제문]에 쓰인다.
  weeklyPrompts: [
${promptsSrc}
  ],
  readingPlan: [
${planSrc}
  ]
}];`;

/* ── 2) 문서 초안 ── */
const vars = {
  '월': monthLabel,
  '책이름': spec.book.name,
  '책소개': spec.book.desc,
  '저자표기': spec.book.byline,
  '일수': String(days),
  '기간표기': `${shortD(startDate)} ~ ${shortD(endDate)}`,
  '시작일표기': shortD(startDate),
  '라이브시간': liveTime,
  '라이브요일': liveWd,
  '라이브날짜': liveDates.map(md).join(' · '),
  '라이브횟수': String(liveDates.length),
  '라이브표': liveDates.map((d, i) => `| 라이브 ${i + 1}회차 | ${shortD(d)} 22:00 |`).join('\n'),
  '회고기간': `${shortD(retroFrom)} ~ ${shortD(retroUntil)}`,
  '모집기간': recruitLabel,
  '선물기준': String(spec.giftMissLimit || 6),
  'OT링크': spec.otUrl,
  '설명서링크': spec.guideUrl,
  '앱주소': spec.appUrl || 'https://personalmakersbook.netlify.app/',
  '책구매안내': spec.bookBuyNote || '(구매 안내를 적어 주세요)',
  '인증누락안내': spec.missNote
    || `놓쳐도 킥아웃되는 건 아닙니다. 다만 인증은 이 멤버십의 핵심이에요. ${days}일 동안 인증 누락이 ${spec.giftMissLimit || 6}회 미만이면 커밍쏜의 『${spec.book.name}』 인사이트 정리본을 드립니다.`,
  // 월 5만 원을 하루로 나눈 값(백 원 단위 반올림). 상세페이지의 가격 앵커.
  '하루비용': (Math.round(50000 / days / 100) * 100).toLocaleString('ko-KR'),
  '일정표': plan.map((day, i) => {
    const date = addDays(startDate, i);
    const text = day.map((g) => {
      const items = (g.s || []).map((x) => x.replace(/<[^>]+>/g, ''));
      return g.ch ? `${g.ch} — ${items.join(' / ')}` : items.join(' / ');
    }).join('<br>');
    return `| ${i + 1}일차 | ${shortD(date)} | ${text} |`;
  }).join('\n')
};
// 자리표시자 이름이 한글이라 \w로는 안 잡힌다 — 중괄호 사이를 통째로 본다.
const leftovers = new Set();
const fill = (t) => t.replace(/\{\{([^}]+)\}\}/g, (m, k) => {
  const v = vars[k.trim()];
  if (v == null) leftovers.add(k.trim());
  return v == null ? m : v;
});

/* ── 출력 ── */
console.log(`■ ${spec.label} · 『${spec.book.name}』`);
console.log(`   기간   ${longD(startDate)} ~ ${longD(endDate)}  (${days}일)`);
console.log(`   전환   ${switchAt} 에 자동으로 켜짐 · 앞 시즌은 ${lockPrevAt} 에 잠김`);
console.log(`   회차   ${plan.length}개${plan.length === days ? '' : `  ⚠ 기간(${days}일)과 다릅니다`}`);
console.log(`   라이브 매주 ${liveWd}요일 ${liveTime} — ${liveDates.map((d) => shortD(d)).join(' · ')}`);
console.log(`   회고   ${shortD(retroFrom)} ~ ${shortD(retroUntil)} (다음 시즌 ${shortD(nextStart)} 시작)`);
console.log(`   모집   ${recruitLabel}`);
const notLiveDay = liveDates.filter((d) => !LIVE_DAYS.includes(Math.round((D(d) - D(startDate)) / 86400000) + 1));
if (notLiveDay.length) console.log(`   ⚠ 7·14·21·28일차가 아닌 라이브: ${notLiveDay.map(shortD).join(', ')}`);
if (spec.toc) {
  console.log('\n■ 목차로 짠 커리큘럼 (1회독)');
  plan.forEach((day, i) => {
    if (LIVE_DAYS.includes(i + 1) || i === 0 || i >= 19) return;
    console.log(`   ${String(i + 1).padStart(2)}일차 ${shortD(addDays(startDate, i))}  ${day.map((g) => (g.ch ? g.ch + ' ' : '') + g.s.join(' / ')).join(' | ')}`);
  });
  console.log('   … 20일차 결산 · 22~26일차 2회독 · 27일차 총정리 · 라이브 7·14·21·28일차');
}
if (!(spec.weeklyPrompts || []).length) console.log('\n   ⚠ 발제문(weeklyPrompts)이 비어 있습니다 — 스킬이 목차로 초안을 써서 채워야 합니다.');

if (!WRITE) {
  console.log('\n(미리보기입니다. 실제로 반영하려면 --write 를 붙이세요)');
  process.exit(0);
}

const cfgPath = join(root, 'js/config.js');
let cfg = readFileSync(cfgPath, 'utf8');
if (cfg.includes(`id: '${spec.id}'`)) {
  console.error(`\n이미 '${spec.id}' 시즌이 config.js에 있습니다. id를 바꾸거나 기존 것을 지워 주세요.`);
  process.exit(1);
}
// CS.SEASONS는 '\n}];' 로 끝난다 — 여기서 '}'는 마지막 시즌 객체를 닫는 괄호이고
// '];' 가 배열을 닫는다. 그 사이에 끼워 넣어야 앞 시즌의 괄호를 먹지 않는다.
const marker = '\n}];';
const at = cfg.lastIndexOf(marker);
if (at < 0) { console.error('CS.SEASONS의 끝(}];)을 찾지 못했습니다.'); process.exit(1); }
// 앞 시즌(지금 마지막 시즌)의 lockAt: null → 새 시즌 전환 한 시간 뒤. 이미 값이 있으면 건드리지 않는다.
let head = cfg.slice(0, at);
const lockAtIdx = head.lastIndexOf('lockAt: null');
let lockedPrev = false;
if (lockAtIdx >= 0) {
  const lineEnd = head.indexOf('\n', lockAtIdx);
  head = head.slice(0, lockAtIdx)
    + `lockAt: '${lockPrevAt}',   // 다음 시즌(${spec.id}) 전환 한 시간 뒤에 잠긴다`
    + head.slice(lineEnd);
  lockedPrev = true;
}
writeFileSync(cfgPath, head + '\n}' + seasonSrc + cfg.slice(at + marker.length));

const outDir = join(root, 'out');
if (!existsSync(outDir)) mkdirSync(outDir);
for (const tpl of ['상세페이지.md', '설명서.md', '일정표.md', '카톡공지.txt']) {
  writeFileSync(join(outDir, tpl), fill(readFileSync(join(root, 'tools/templates', tpl), 'utf8')));
}

/* 노션에 올릴 때 쓰는 목록 — 어느 파일을 어떤 제목으로 어디에 만들지.
 * 파일 자체는 마크다운이라 notion-create-pages 에 그대로 넣으면 된다(HTML 주석은 빼고). */
const NOTION_PARENT = '3c2f15a6c51c80108cb1c88b5212be7d'; // 「퍼메스 독서챌린지」
writeFileSync(join(outDir, '노션게시.json'), JSON.stringify({
  parentPageId: NOTION_PARENT,
  pages: [
    { file: 'out/설명서.md', title: `${monthLabel} 퍼메스 독서 멤버십 설명서 『${spec.book.name}』`, icon: '📖',
      note: '구매자에게 나가는 문서. 만든 뒤 노션에서 "웹에 게시"를 켜야 링크가 열린다 → 그 링크가 guideUrl.' },
    { file: 'out/일정표.md', title: `${spec.book.name} ${days}일 독서 일정표`, icon: '🗓️',
      note: '설명서와 앱의 일정이 같은 원본(readingPlan)에서 나왔는지 여기서 한 번 더 본다.' },
    { file: 'out/상세페이지.md', title: `퍼스널메이커스 독서 멤버십 ${monthLabel} 『${spec.book.name}』`, icon: '📘',
      note: '모집용. 이미지(후기·저자 사진·표지)와 신청 북마크는 지난달 페이지에서 가져와 넣는다.' }
  ]
}, null, 2));

console.log('\n✓ js/config.js 에 시즌을 추가했습니다.' + (lockedPrev ? ` 앞 시즌 lockAt = ${lockPrevAt}` : ''));
console.log('✓ out/상세페이지.md · out/설명서.md · out/일정표.md · out/카톡공지.txt 를 만들었습니다.');
console.log('✓ out/노션게시.json — 노션에 올릴 제목·위치 목록 (new-season 스킬이 이걸 보고 페이지를 만든다)');
if (leftovers.size) {
  console.log(`\n⚠ 채우지 못한 자리표시자: ${[...leftovers].join(', ')} — 시즌 설명서에 값을 넣어 주세요.`);
}

console.log('\n■ 사람이 확인해야 하는 것');
const todo = [
  `표지 이미지 ${spec.book.cover} 를 저장소에 넣었는지`,
  '상세페이지의 "이 책을 왜 지금 읽는지" 두세 문장 (out/상세페이지.md)',
  spec.toc && '목차로 나눈 일자별 분량이 적당한지 (위 표 · 쪽수를 주면 더 고르게 나뉜다)',
  !(spec.weeklyPrompts || []).length && '발제문 4주치 (weeklyPrompts)',
  !spec.bookEditionRule && '판본 안내가 필요한 책인지 (다른 판과 목차가 다르면 규칙에 한 줄)',
  !spec.otUrl?.startsWith('http') && 'OT 영상 링크',
  !spec.guideUrl?.startsWith('http') && '설명서 노션 링크 (설명서를 먼저 게시해야 합니다)'
].filter(Boolean);
todo.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
console.log('\n다음: npm run check:season  → 통과하면 out/노션게시.json 대로 노션에 올리고 → PR');
