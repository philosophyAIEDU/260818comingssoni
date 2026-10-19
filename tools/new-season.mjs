#!/usr/bin/env node
/* 시즌 설명서(JSON) 한 장으로 다음 시즌을 통째로 준비한다.
 *
 *   node tools/new-season.mjs seasons/s3.json          → 미리보기만
 *   node tools/new-season.mjs seasons/s3.json --write  → config.js에 시즌 추가 + 문서 초안 생성
 *
 * 일정 규칙 (커밍쏜이 정한 것 — 매달 같다)
 *   - 매달 21일에 시작해서 28일(4주). 라이브는 각 주 7일째 = 7·14·21·28일차, 22:00.
 *     그래서 라이브 요일은 시작일 요일과 같다(9/21 월요일 시작 → 일요일 라이브).
 *   - 종료 다음 날부터 다음 달 20일까지는 내 글 자산화 기간(28일 기록을 블로그·SNS에 올리기 · 정리본 발송).
 *   - 커리큘럼: 1회독 3주 · 2회독 1주. 매주 7일째는 라이브(발제문 고민), 나머지는 읽고 인증하는 날이다.
 *       1일차 책 준비·목차 훑기 · 2~6 / 8~13 / 15~20일차 1회독(17일, 20일차에 완독·BEST 5)
 *       → 22~27일차 2회독(1회독 분량을 6등분, 27일차에 최고 문장).
 *     목차(toc)만 주면 쪽수 비중으로(쪽수가 없으면 꼭지 수로) 고르게 나눈다.
 *
 * 만들어 주는 것
 *   1) js/config.js 의 CS.SEASONS 에 시즌 객체 추가 (+ 앞 시즌 lockAt 자동)
 *   2) out/<시즌id>/상세페이지.md · 설명서.md · 일정표.md · 카톡공지.txt  (모집·안내 문구 초안)
 *   3) out/<시즌id>/노션게시.json — 위 문서를 노션 어디에 어떤 제목으로 올릴지 (스킬이 읽는다)
 *   초안은 시즌마다 따로 폴더에 남겨, 다음 시즌을 만들 때 앞 시즌 초안을 덮어쓰지 않는다.
 *   게시까지 끝난 최종본은 archive/<시즌id>-<책>/ 에 보관한다(archive/README.md).
 *   4) 사람이 확인해야 하는 것 목록
 *
 * 시즌이 config에 들어가 있으면 전환은 저절로 된다 — 활성 시즌은 배포가 아니라
 * startsAt(KST) 시각이 고르기 때문이다. 미리 머지해 두면 그날 새벽에 알아서 바뀐다.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seasonVars, josaEulReul, addDays, md, longD, shortD, LIVE_DAYS, D } from './lib/season-vars.mjs';
import { renderSeason } from './season-render.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [, , specPath, ...flags] = process.argv;
const WRITE = flags.includes('--write');
if (!specPath) {
  console.error('사용법: node tools/new-season.mjs <시즌.json> [--write]');
  process.exit(2);
}
const spec = JSON.parse(readFileSync(specPath, 'utf8'));

/* 일정·자리표시자 계산은 tools/lib/season-vars.mjs 하나에서 — 문서 렌더(season-render)와 같은 값을 쓴다 */
const need = (k) => { if (spec[k] == null) { console.error(`시즌 설명서에 "${k}"가 없습니다.`); process.exit(2); } return spec[k]; };
let S;
try { S = seasonVars(spec); } catch (e) { console.error(e.message); process.exit(2); }
const { startDate, endDate, days, switchAt, lockPrevAt, retroFrom, retroUntil, nextStart,
  recruitLabel, monthLabel, liveTime, plan, liveDates, liveWd } = S;

/* ── 1) 시즌 객체 ── */
// 정리본 메일 문구는 상수(tools/templates/정리본메일.txt — 첫 줄이 제목). {{이름}}·{{정리본링크}}는 발송 때 사람마다 채운다.
const [giftSubject, ...giftBody] = readFileSync(join(root, 'tools/templates/정리본메일.txt'), 'utf8')
  .replace(/\n+$/, '').replaceAll('{{책이름}}', spec.book.name).replaceAll('{{을를}}', josaEulReul(spec.book.name))
  .replace('{{다음책안내}}', spec.nextBookNote || '다음 책은 4주차 마지막 라이브에서 공개합니다.')
  .split('\n');
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
    desc: ${q(String(spec.book.desc || "").replace(/<[^>]+>/g, ""))}   // 앱은 글자 그대로 보여 준다 — 태그 빼고
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
    '지난달에 이어 함께하시는 분은 이름 옆에 <strong>🔥2 🔥3 …</strong> 연속 시즌 표시가 붙습니다. 한 달 더 할 때마다 올라갑니다.',
    '${days}일간 기록한 내용은 <strong>한 번에 내려받을 수</strong> 있습니다. 화면 맨 아래 <strong>[나의 현황]</strong>에서 '
      + '지금까지 몇 번 인증했고 몇 번 놓쳤는지도 확인할 수 있습니다.'
  ].filter(Boolean),
  sentencePlaceholder: '예) 오늘 범위에서 가장 와닿은 한 문장을 그대로 옮겨 적고, '
    + '끝에 쪽수를 붙여 주세요. (… - 47쪽)',
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
  // 🎁 정리본 메일 자동 발송 — link를 채워 배포하면 sendAt(KST)에 이 시즌 대상자 전원에게 한 번 보낸다.
  // 다음 시즌이 켜진 뒤여도 이 시즌 명단으로 계산한다. link가 비어 있으면 아무것도 안 보낸다.
  // 다음 책 소개 줄은 다음 책이 정해지면(4주차 라이브) 다음 시즌을 만들 때 채운다.
  giftMail: {
    sendAt: ${q(nextStart + 'T09:00')},
    link: '',
    subject: ${q(giftSubject)},
    body: [
${giftBody.map((l) => `      ${q(l)},`).join('\n')}
    ].join('\\n'),
  },
  // 📝 주간 발제문 — 라이브 날 앱 [오늘의 범위]와 운영진 [공지문 › 발제문]에 쓰인다.
  weeklyPrompts: [
${promptsSrc}
  ],
  readingPlan: [
${planSrc}
  ]
}];`;

/* ── 2) 문서 초안: 상수(tools/templates) + 변수(시즌 설명서) ── */
const { docs, leftovers } = renderSeason(spec);

/* ── 출력 ── */
console.log(`■ ${spec.label} · 『${spec.book.name}』`);
console.log(`   기간   ${longD(startDate)} ~ ${longD(endDate)}  (${days}일)`);
console.log(`   전환   ${switchAt} 에 자동으로 켜짐 · 앞 시즌은 ${lockPrevAt} 에 잠김`);
console.log(`   회차   ${plan.length}개${plan.length === days ? '' : `  ⚠ 기간(${days}일)과 다릅니다`}`);
console.log(`   라이브 매주 ${liveWd}요일 ${liveTime} — ${liveDates.map((d) => shortD(d)).join(' · ')}`);
console.log(`   자산화 ${shortD(retroFrom)} ~ ${shortD(retroUntil)} (다음 시즌 ${shortD(nextStart)} 시작)`);
console.log(`   모집   ${recruitLabel}`);
const notLiveDay = liveDates.filter((d) => !LIVE_DAYS.includes(Math.round((D(d) - D(startDate)) / 86400000) + 1));
if (notLiveDay.length) console.log(`   ⚠ 7·14·21·28일차가 아닌 라이브: ${notLiveDay.map(shortD).join(', ')}`);
if (spec.toc) {
  console.log('\n■ 목차로 짠 커리큘럼 (1·2회독)');
  plan.forEach((day, i) => {
    if (LIVE_DAYS.includes(i + 1) || i === 0 || i >= 27) return;
    console.log(`   ${String(i + 1).padStart(2)}일차 ${shortD(addDays(startDate, i))}  ${day.map((g) => (g.ch ? g.ch + ' ' : '') + g.s.join(' / ')).join(' | ')}`);
  });
  console.log('   … 20일차 1회독 완독 · 22~27일차 2회독 · 라이브(발제문) 7·14·21·28일차');
}
if (!(spec.weeklyPrompts || []).length) console.log('\n   ⚠ 발제문(weeklyPrompts)이 비어 있습니다 — 스킬이 목차로 초안을 써서 채워야 합니다.');

if (!WRITE) {
  console.log('\n(미리보기입니다. 실제로 반영하려면 --write 를 붙이세요)');
  process.exit(0);
}

const cfgPath = join(root, 'js/config.js');
let cfg = readFileSync(cfgPath, 'utf8');
if (cfg.includes(`id: '${spec.id}'`)) {
  console.error(`\n이미 '${spec.id}' 시즌이 config.js에 있습니다. 새 시즌은 새 id(예: s4)로 만들어 주세요 — 지난 시즌은 지우지 않고 보관합니다.`);
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

// 시즌마다 out/<시즌id>/ 에 따로 — 앞 시즌 초안을 덮어쓰지 않는다
const outRel = `out/${spec.id}`;
const outDir = join(root, outRel);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
for (const [tpl, text] of Object.entries(docs)) writeFileSync(join(outDir, tpl), text);

/* 노션에 올릴 때 쓰는 목록 — 어느 파일을 어떤 제목으로 어디에 만들지.
 * 파일 자체는 마크다운이라 notion-create-pages 에 그대로 넣으면 된다(HTML 주석은 빼고). */
const NOTION_PARENT = '3c2f15a6c51c80108cb1c88b5212be7d'; // 「퍼메스 독서챌린지」
writeFileSync(join(outDir, '노션게시.json'), JSON.stringify({
  parentPageId: NOTION_PARENT,
  pages: [
    { file: `${outRel}/설명서.md`, title: `${monthLabel} 퍼메스 독서 멤버십 설명서 『${spec.book.name}』`, icon: '📖',
      note: '구매자에게 나가는 문서. 만든 뒤 노션에서 "웹에 게시"를 켜야 링크가 열린다 → 그 링크가 guideUrl.' },
    { file: `${outRel}/일정표.md`, title: `${spec.book.name} ${days}일 독서 일정표`, icon: '🗓️',
      note: '설명서와 앱의 일정이 같은 원본(readingPlan)에서 나왔는지 여기서 한 번 더 본다.' },
    { file: `${outRel}/상세페이지.md`, title: `퍼스널메이커스 독서 멤버십 ${monthLabel} 『${spec.book.name}』`, icon: '📘',
      note: '모집용. 이미지(후기·저자 사진·표지)와 신청 북마크는 지난달 페이지에서 가져와 넣는다.' }
  ]
}, null, 2));

console.log('\n✓ js/config.js 에 시즌을 추가했습니다.' + (lockedPrev ? ` 앞 시즌 lockAt = ${lockPrevAt}` : ''));
console.log(`✓ ${outRel}/ 에 상세페이지.md · 설명서.md · 일정표.md · 카톡공지.txt 를 만들었습니다.`);
console.log(`✓ ${outRel}/노션게시.json — 노션에 올릴 제목·위치 목록 (new-season 스킬이 이걸 보고 페이지를 만든다)`);
console.log('  노션에 게시한 뒤에는 archive/ 에 최종본을 보관하세요(archive/README.md).');
if (leftovers.size) {
  console.log(`\n⚠ 채우지 못한 자리표시자: ${[...leftovers].join(', ')} — 시즌 설명서에 값을 넣어 주세요.`);
}

console.log('\n■ 사람이 확인해야 하는 것');
const todo = [
  `표지 이미지 ${spec.book.cover} 를 저장소에 넣었는지`,
  !spec.book.coverUrl && '상세페이지 표지 이미지 주소 (book.coverUrl — 알라딘 표지 등)',
  !spec.applyUrl && '래피드 신청 링크 (applyUrl) — 상세페이지 신청 버튼 3곳',
  !(spec.pages && spec.pages.detailBookIntro) && '상세페이지 책 소개 문단 (pages.detailBookIntro)',
  !(spec.pages && spec.pages.guideWeek4) && '설명서 4주차 읽는 방법 (pages.guideWeek4)',
  spec.toc && '목차로 나눈 일자별 분량이 적당한지 (위 표 · 쪽수를 주면 더 고르게 나뉜다)',
  !(spec.weeklyPrompts || []).length && '발제문 4주치 (weeklyPrompts)',
  !spec.bookEditionRule && '판본 안내가 필요한 책인지 (다른 판과 목차가 다르면 규칙에 한 줄)',
  !spec.otUrl?.startsWith('http') && 'OT 영상 링크',
  !spec.guideUrl?.startsWith('http') && '설명서 노션 링크 (설명서를 먼저 게시해야 합니다)',
  !spec.scheduleUrl?.startsWith('http') && '일정표 노션 링크 (scheduleUrl — 카톡 공지에 들어갑니다)'
].filter(Boolean);
todo.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
console.log('\n다음: npm run check:season  → 통과하면 out/노션게시.json 대로 노션에 올리고 → PR\n      게시 후 사본을 떠서 node tools/season-render.mjs <시즌.json> --compare archive/<폴더> 로 대조');
