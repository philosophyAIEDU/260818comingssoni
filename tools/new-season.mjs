#!/usr/bin/env node
/* 시즌 설명서(JSON) 한 장으로 다음 시즌을 통째로 준비한다.
 *
 *   node tools/new-season.mjs seasons/s3.json          → 미리보기만
 *   node tools/new-season.mjs seasons/s3.json --write  → config.js에 시즌 추가 + 문서 초안 생성
 *
 * 만들어 주는 것
 *   1) js/config.js 의 CS.SEASONS 에 시즌 객체 추가
 *   2) out/상세페이지.md · out/설명서.md · out/카톡공지.txt  (모집·안내 문구 초안)
 *   3) 사람이 확인해야 하는 것 목록
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

const startDate = need('startDate');
const endDate = need('endDate');
const plan = need('readingPlan');
const days = Math.round((D(endDate) - D(startDate)) / 86400000) + 1;

/* 라이브 회차 = "라이브 N회차"로 시작하는 줄이 있는 날 */
const isLive = (line) => /^\s*(?:[^\w가-힣]*\s*)?(?:<[^>]+>\s*)*라이브\s*\d+\s*회차/
  .test(String(line).replace(/<\/?strong>/g, ''));
const liveDates = plan
  .map((d, i) => ({ i, lines: d.flatMap((g) => g.s || []) }))
  .filter((x) => x.lines.some(isLive))
  .map((x) => addDays(startDate, x.i));

/* ── 1) 시즌 객체 ── */
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const q = (v) => (v == null ? 'null' : `'${esc(v)}'`);
const planSrc = plan.map((day) => {
  const groups = day.map((g) =>
    `{ ch: '${esc(g.ch || '')}', s: [${(g.s || []).map((x) => `'${esc(x)}'`).join(', ')}] }`);
  return `    [${groups.join(',\n      ')}],`;
}).join('\n');

const seasonSrc = `, {
  id: ${q(need('id'))},
  label: ${q(need('label'))},
  startsAt: ${q(need('switchAt'))},   // 이 시각(KST)이 지나면 저절로 이 시즌이 켜진다
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
    label: '매주 일요일 ${esc(spec.liveTime || '22:00 - 22:30')} (${liveDates.map(md).join(' · ')})',
    note: '* 다시보기는 제공되지 않으니 꼭 시간내어 참여해주세요.'
  },
  rulesHeading: '안내 · 멤버십 규칙',
  headLinks: [
    { label: '독서 멤버십 OT 보기', icon: 'play', url: ${q(spec.otUrl)} },
    { label: '${esc(spec.label)} 퍼메스 독서 멤버십 설명서', icon: 'book', url: ${q(spec.guideUrl)} }
  ],
  extraRules: [
    '<strong>일요일은 새로 읽을 분량이 없습니다.</strong> 그날 오전 단톡방에 올라오는 <strong>발제문</strong>을 '
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
  dataPrefix: ${q(spec.id)},
  storagePrefix: ${q('comingsoon.reading.' + spec.id)},
  lockAt: null,
  kickoutEnabled: false,
  kickoutThreshold: Infinity,
  riskThreshold: Infinity,
  autoWarnThreshold: Infinity,
  readingPlan: [
${planSrc}
  ]
}];`;

/* ── 2) 문서 초안 ── */
const vars = {
  '월': spec.monthLabel || `${+startDate.slice(5, 7)}월`,
  '책이름': spec.book.name,
  '책소개': spec.book.desc,
  '저자표기': spec.book.byline,
  '일수': String(days),
  '기간표기': `${shortD(startDate)} ~ ${shortD(endDate)}`,
  '시작일표기': shortD(startDate),
  '라이브시간': spec.liveTime || '22:00 - 22:30',
  '라이브날짜': liveDates.map(md).join(' · '),
  '라이브횟수': String(liveDates.length),
  '라이브표': liveDates.map((d, i) => `| 라이브 ${i + 1}회차 | ${shortD(d)} 22:00 |`).join('\n'),
  '모집기간': spec.recruitLabel || '(모집 기간을 적어 주세요)',
  '선물기준': String(spec.giftMissLimit || 6),
  'OT링크': spec.otUrl,
  '설명서링크': spec.guideUrl,
  '앱주소': spec.appUrl || 'https://personalmakersbook.netlify.app/',
  '책구매안내': spec.bookBuyNote || '(구매 안내를 적어 주세요)',
  '인증누락안내': spec.missNote
    || `놓쳐도 킥아웃되는 건 아닙니다. 다만 인증은 이 멤버십의 핵심이에요. ${days}일 동안 인증 누락이 ${spec.giftMissLimit || 6}회 미만이면 커밍쏜의 『${spec.book.name}』 인사이트 정리본을 드립니다.`
};
// 자리표시자 이름이 한글이라 \w로는 안 잡힌다 — 중괄호 사이를 통째로 본다.
const fill = (t) => t.replace(/\{\{([^}]+)\}\}/g, (m, k) => {
  const v = vars[k.trim()];
  if (v == null) leftovers.add(k.trim());
  return v == null ? m : v;
});
const leftovers = new Set();

/* ── 출력 ── */
console.log(`■ ${spec.label} · 『${spec.book.name}』`);
console.log(`   기간   ${longD(startDate)} ~ ${longD(endDate)}  (${days}일)`);
console.log(`   전환   ${spec.switchAt} 에 자동으로 켜짐`);
console.log(`   회차   ${plan.length}개${plan.length === days ? '' : `  ⚠ 기간(${days}일)과 다릅니다`}`);
console.log(`   라이브 ${liveDates.length}회 — ${liveDates.map((d) => shortD(d)).join(' · ')}`);
const notSunday = liveDates.filter((d) => wd(d) !== '일');
if (notSunday.length) console.log(`   ⚠ 일요일이 아닌 라이브: ${notSunday.map(shortD).join(', ')}`);

if (!WRITE) {
  console.log('\n(미리보기입니다. 실제로 반영하려면 --write 를 붙이세요)');
  process.exit(0);
}

const cfgPath = join(root, 'js/config.js');
const cfg = readFileSync(cfgPath, 'utf8');
if (cfg.includes(`id: '${spec.id}'`)) {
  console.error(`\n이미 '${spec.id}' 시즌이 config.js에 있습니다. id를 바꾸거나 기존 것을 지워 주세요.`);
  process.exit(1);
}
// CS.SEASONS는 '\n}];' 로 끝난다 — 여기서 '}'는 마지막 시즌 객체를 닫는 괄호이고
// '];' 가 배열을 닫는다. 그 사이에 끼워 넣어야 앞 시즌의 괄호를 먹지 않는다.
const marker = '\n}];';
const at = cfg.lastIndexOf(marker);
if (at < 0) { console.error('CS.SEASONS의 끝(}];)을 찾지 못했습니다.'); process.exit(1); }
writeFileSync(cfgPath, cfg.slice(0, at) + '\n}' + seasonSrc + cfg.slice(at + marker.length));

const outDir = join(root, 'out');
if (!existsSync(outDir)) mkdirSync(outDir);
for (const [tpl, out] of [['상세페이지.md', '상세페이지.md'], ['설명서.md', '설명서.md'], ['카톡공지.txt', '카톡공지.txt']]) {
  writeFileSync(join(outDir, out), fill(readFileSync(join(root, 'tools/templates', tpl), 'utf8')));
}

console.log('\n✓ js/config.js 에 시즌을 추가했습니다.');
console.log('✓ out/상세페이지.md · out/설명서.md · out/카톡공지.txt 를 만들었습니다.');
if (leftovers.size) {
  console.log(`\n⚠ 채우지 못한 자리표시자: ${[...leftovers].join(', ')} — 시즌 설명서에 값을 넣어 주세요.`);
}

console.log('\n■ 사람이 확인해야 하는 것');
const todo = [
  `표지 이미지 ${spec.book.cover} 를 저장소에 넣었는지`,
  '상세페이지의 "이 책을 왜 지금 읽는지" 두세 문장 (out/상세페이지.md)',
  '모집 기간 표기',
  !spec.bookEditionRule && '판본 안내가 필요한 책인지 (다른 판과 목차가 다르면 규칙에 한 줄)',
  !spec.otUrl?.startsWith('http') && 'OT 영상 링크',
  !spec.guideUrl?.startsWith('http') && '설명서 노션 링크 (설명서를 먼저 게시해야 합니다)',
  '앞 시즌의 lockAt — 새 시즌이 켜진 뒤 언제 잠글지 (js/config.js)'
].filter(Boolean);
todo.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
console.log('\n다음: npm run check:season  → 통과하면 PR');
