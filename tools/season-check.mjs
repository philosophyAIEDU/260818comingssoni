#!/usr/bin/env node
/* 시즌 정의가 성립하는지 기계적으로 검사한다.
 *
 * 매달 새 책으로 시즌을 갈아 끼우는데, 그때 사람이 저지르는 실수는 늘 같은 종류다 —
 * 회차 수가 28일이 아니거나, 라이브가 7·14·21·28일차에 안 맞거나, 하루가 빈 채로 남거나,
 * 새 시즌의 저장소 접두사가 앞 시즌과 겹치거나. 전부 배포 전에 잡을 수 있는 것들이라
 * 여기 모아 두고 `npm run check:season` 한 번으로 본다.
 *
 * 실패가 하나라도 있으면 종료 코드 1 — CI나 자동화 파이프라인이 그대로 막을 수 있다.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { renderSeason, compareWith } from './season-render.mjs';
import { seasonObjectSrc } from './lib/season-app.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 표지 최소 가로 — 앱 116px(레티나 3배 ≈ 350px)·인증 카드 480px·노션 본문 폭(약 700px)에서 깨지지 않는 크기 */
const COVER_MIN_W = 800;

/** jpg·png·webp 머리에서 가로·세로만 읽는다(이미지 라이브러리 없이) */
function imageSize(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
  }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const t = b.toString('ascii', 12, 16);
    if (t === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (t === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (t === 'VP8L') { const n = b.readUInt32LE(21); return { w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1 }; }
  }
  return null;
}

/** config.js·utils.js는 브라우저용이라 window에 얹힌다. 샌드박스에서 그대로 불러온다. */
function loadCS() {
  const sandbox = { console, Intl, Date, Math, JSON, Promise, setTimeout, localStorage: null };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['js/config.js', 'js/utils.js']) {
    vm.runInContext(readFileSync(join(root, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.CS;
}

const CS = loadCS();
let fail = 0;
const results = [];
const warns = []; // 막지는 않지만 사람이 봐야 하는 것
const check = (season, name, ok, detail) => {
  results.push({ season, name, ok, detail });
  if (!ok) fail++;
};

/** 그 시즌 기준으로 U.* 를 돌리기 위해 CS.CONFIG을 잠깐 갈아 끼운다. */
function withSeason(season, fn) {
  const saved = CS.CONFIG;
  CS.CONFIG = Object.assign({}, CS.COMMON, season, { seasonId: season.id });
  try { return fn(CS.U); } finally { CS.CONFIG = saved; }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

for (const s of CS.SEASONS) {
  const L = s.label || s.id;

  // ── 필수 항목 ──
  for (const k of ['id', 'label', 'title', 'subtitle', 'startDate', 'endDate', 'storagePrefix', 'rulesHeading']) {
    check(L, `${k} 값이 있다`, !!s[k], s[k]);
  }
  check(L, 'dataPrefix가 정의되어 있다 (빈 문자열도 허용)', typeof s.dataPrefix === 'string', s.dataPrefix);
  check(L, '날짜 형식 (startDate/endDate)', ISO.test(s.startDate) && ISO.test(s.endDate),
    `${s.startDate} ~ ${s.endDate}`);
  check(L, 'startDate가 endDate보다 앞선다', s.startDate < s.endDate);
  for (const k of ['startsAt', 'lockAt']) {
    check(L, `${k}은 비었거나 'YYYY-MM-DDTHH:MM'`, s[k] == null || STAMP.test(s[k]), s[k]);
  }
  check(L, 'gradeFrom은 비었거나 기간 안의 날짜',
    s.gradeFrom == null || (ISO.test(s.gradeFrom) && s.gradeFrom > s.startDate && s.gradeFrom <= s.endDate),
    s.gradeFrom);

  // ── 책 정보 ──
  const b = s.book || {};
  for (const k of ['name', 'byline', 'cover', 'desc']) {
    check(L, `book.${k} 값이 있다`, !!b[k], b[k]);
  }
  if (b.cover) {
    let exists = true;
    try { readFileSync(join(root, b.cover)); } catch { exists = false; }
    check(L, `표지 파일이 실제로 있다 (${b.cover})`, exists);
  }

  // ── 커리큘럼 ──
  const days = withSeason(s, (U) => U.challengeDates());
  const plan = s.readingPlan || [];
  check(L, `기간 일수와 회차 수가 같다 (${days.length}일)`, plan.length === days.length,
    `기간 ${days.length}일 / 회차 ${plan.length}개`);

  const empty = [];
  plan.forEach((d, i) => {
    const has = Array.isArray(d) && d.length && d.every((g) => Array.isArray(g.s) && g.s.length
      && g.s.every((x) => typeof x === 'string' && x.trim()));
    if (!has) empty.push(i + 1);
  });
  check(L, '빈 회차가 없다', empty.length === 0, empty.length ? `${empty.join(', ')}일차` : '');

  // 라이브 회차는 일요일이어야 한다 — 날짜를 한 칸 밀면 바로 어긋나는 곳이다.
  // "라이브 N회차"로 시작하는 줄만 센다. 본문에 스쳐 지나가는 '라이브'(예: "마지막
  // 라이브의 재료가 됩니다")까지 세면 엉뚱한 날이 걸린다.
  const isLiveLine = (line) => /^\s*(?:[^\w가-힣]*\s*)?(?:<[^>]+>\s*)*라이브\s*\d+\s*회차/.test(
    line.replace(/<\/?strong>/g, ''));
  const liveDays = plan
    .map((d, i) => ({ i: i + 1, lines: d.flatMap((g) => g.s || []) }))
    .filter((x) => x.lines.some(isLiveLine));
  withSeason(s, (U) => {
    // 라이브는 각 주 7일째(7·14·21·28일차). 요일은 시작일에 따라 달라지므로 요일이 아니라 회차로 본다.
    const wrong = liveDays.filter((x) => x.i % 7 !== 0);
    check(L, `라이브 회차가 7·14·21·28일차 (${liveDays.length}회)`, wrong.length === 0,
      wrong.map((x) => `${x.i}일차=${U.weekday(U.addDays(s.startDate, x.i - 1))}`).join(', '));
    // 발제문은 라이브 날에만 붙는다
    const promptDays = (s.weeklyPrompts || []).map((w) => w.day);
    const liveSet = new Set(liveDays.map((x) => x.i));
    check(L, '발제문(weeklyPrompts)이 라이브 날에만 있다',
      promptDays.every((d) => liveSet.has(d)), promptDays.filter((d) => !liveSet.has(d)).join(', '));
    check(L, '발제문마다 질문이 1개 이상', (s.weeklyPrompts || []).every((w) => Array.isArray(w.questions) && w.questions.length));
    if (s.retroUntil) {
      check(L, '회고 종료일(retroUntil)이 종료일 뒤', ISO.test(s.retroUntil) && s.retroUntil > s.endDate, s.retroUntil);
    }
    check(L, '마지막 회차 날짜 = endDate',
      U.addDays(s.startDate, plan.length - 1) === s.endDate,
      U.addDays(s.startDate, plan.length - 1));
  });

  // ── 킥아웃 설정의 앞뒤가 맞는지 ──
  if (s.kickoutEnabled) {
    check(L, '위험 기준 < 킥아웃 기준', s.riskThreshold < s.kickoutThreshold,
      `${s.riskThreshold} / ${s.kickoutThreshold}`);
    check(L, '자동 경고 기준 < 킥아웃 기준', s.autoWarnThreshold < s.kickoutThreshold,
      `${s.autoWarnThreshold} / ${s.kickoutThreshold}`);
  } else {
    check(L, '킥아웃이 꺼진 시즌은 기준값이 Infinity',
      [s.kickoutThreshold, s.riskThreshold, s.autoWarnThreshold].every((v) => v === Infinity));
    // 킥아웃 대신 "누락 N회 미만이면 정리본 선물"이 이 시즌의 동기다 — 기준이 없으면 운영진 화면에
    // 선물 대상자 명단이 안 뜨고, 상세페이지 약속(6회 미만)과 앱이 어긋난다.
    check(L, '선물 기준(giftMissLimit)이 2 이상의 정수', Number.isInteger(s.giftMissLimit) && s.giftMissLimit >= 2,
      s.giftMissLimit);
  }

  // ── 바깥 링크 ──
  for (const l of s.headLinks || []) {
    check(L, `링크가 http(s)로 시작 (${l.label})`, /^https?:\/\//.test(l.url || ''), l.url);
    check(L, `링크에 이름이 있다`, !!l.label);
  }
}

// ── 시즌 사이 관계 ──
const ids = CS.SEASONS.map((s) => s.id);
check('전체', '시즌 id가 겹치지 않는다', new Set(ids).size === ids.length, ids);
const prefixes = CS.SEASONS.map((s) => s.dataPrefix);
check('전체', '저장소 접두사가 겹치지 않는다', new Set(prefixes).size === prefixes.length, prefixes);
const storages = CS.SEASONS.map((s) => s.storagePrefix);
check('전체', 'localStorage 접두사가 겹치지 않는다', new Set(storages).size === storages.length, storages);

const starts = CS.SEASONS.map((s) => s.startsAt);
check('전체', '첫 시즌만 startsAt이 비어 있다',
  starts[0] == null && starts.slice(1).every((x) => !!x), starts);
check('전체', 'startsAt이 시간순으로 놓여 있다',
  starts.slice(1).every((x, i) => i === 0 || x > starts[i]), starts);

// 앞 시즌이 잠기기 전에 다음 시즌이 시작해야, 참여자가 빈 화면을 보지 않는다.
CS.SEASONS.forEach((s, i) => {
  const next = CS.SEASONS[i + 1];
  if (!next || !s.lockAt || !next.startsAt) return;
  check('전체', `${s.label} 잠금이 ${next.label} 시작보다 뒤다`, s.lockAt >= next.startsAt,
    `${s.label} 잠금 ${s.lockAt} / ${next.label} 시작 ${next.startsAt}`);
});

// 보관함(archive/<시즌id>-<책>/)이 있는 시즌은 config에서 지워지면 안 된다 — 지난 시즌은 지우지 않고 보관한다
{
  const archiveDir = join(root, 'archive');
  const ids = new Set(CS.SEASONS.map((x) => x.id));
  const kept = existsSync(archiveDir)
    ? readdirSync(archiveDir).map((d) => (d.match(/^(s\d+)-/) || [])[1]).filter(Boolean)
    : [];
  const gone = kept.filter((id) => !ids.has(id));
  check('전체', `보관함에 있는 시즌이 config에 그대로 남아 있다 (${kept.join(', ') || '없음'})`, gone.length === 0,
    gone.length ? `config에서 사라짐: ${gone.join(', ')}` : '');
}

// 시즌 설명서(seasons/<id>.json) = 변수, tools/templates = 상수.
// ① 설명서의 일정·발제문이 앱(config.js)과 같아야 하고 ② 보관함에 노션 최종본 사본이 있으면
// 상수+변수로 렌더한 문서가 그 사본과 한 줄도 달라선 안 된다 — 그래야 다음 시즌도 변수만 바꾸면 된다.
{
  const specDir = join(root, 'seasons');
  const archiveDir = join(root, 'archive');
  const specs = existsSync(specDir) ? readdirSync(specDir).filter((f) => /^s\d+\.json$/.test(f)) : [];
  for (const f of specs) {
    const spec = JSON.parse(readFileSync(join(specDir, f), 'utf8'));
    const s = CS.SEASONS.find((x) => x.id === spec.id);
    const L = `seasons/${f}`;
    if (!s) continue; // 아직 config에 넣기 전
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    check(L, '일자별 분량(readingPlan)이 config.js와 같다', !spec.readingPlan || same(spec.readingPlan, s.readingPlan),
      '앱을 고쳤으면 시즌 설명서에도 옮겨 주세요');
    check(L, '발제문(weeklyPrompts)이 config.js와 같다', !spec.weeklyPrompts || same(spec.weeklyPrompts, s.weeklyPrompts));
    // 앱 시즌 객체 전체 = 앱 상수 틀(tools/lib/season-app.mjs) + 이 설명서. config에서 손으로 고친 문구가
    // 틀·설명서에 안 옮겨져 있으면 다음 시즌에 옛 문구로 돌아가니 여기서 잡는다.
    // 시즌 중에 바뀌는 값(lockAt — 다음 시즌이 넣는다, giftMail.link — 정리본이 나오면 채운다)은 빼고 본다.
    if (spec.pages) {
      const gen = vm.runInNewContext('(' + seasonObjectSrc(spec).replace(/^,\s*/, '').replace(/\];\s*$/, '') + ')');
      const norm = (o) => JSON.parse(JSON.stringify(o, (k, v) => {
        if (v === Infinity) return 'Infinity';
        // 노션 공개 주소는 제목 슬러그(…/10-<ID>)가 있어도 없어도 같은 페이지 — 페이지 ID로만 견준다
        if (typeof v === 'string' && /notion\.site\//.test(v)) return v.replace(/\/[^/]*-?([0-9a-f]{32})$/, '/$1');
        return v;
      }));
      const a = norm(Object.assign({}, gen, { lockAt: null, giftMail: Object.assign({}, gen.giftMail, { link: '' }) }));
      const b = norm(Object.assign({}, s, { lockAt: null, giftMail: Object.assign({}, s.giftMail, { link: '' }) }));
      const firstDiff = (x, y, path = '') => {
        if (JSON.stringify(x) === JSON.stringify(y)) return null;
        if (x && y && typeof x === 'object' && typeof y === 'object') {
          for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
            const d = firstDiff(x[k], y[k], path ? `${path}.${k}` : k);
            if (d) return d;
          }
        }
        return `${path}: 틀+설명서 「${JSON.stringify(x)}」 / config 「${JSON.stringify(y)}」`;
      };
      const d = firstDiff(a, b);
      check(L, '앱 시즌 객체 = 앱 상수 틀(season-app) + 시즌 설명서', !d, d && d.slice(0, 400));
    }
    // 표지 — 노션·인증 카드에서 크게 쓰여도 깨지지 않게 가로 800px 이상(시즌운영매뉴얼 「표지 이미지」)
    if (s.book && s.book.cover && existsSync(join(root, s.book.cover))) {
      const dim = imageSize(readFileSync(join(root, s.book.cover)));
      const ok = !!dim && dim.w >= COVER_MIN_W;
      const name = `표지 해상도 가로 ${COVER_MIN_W}px 이상 (${s.book.cover})`;
      const detail = dim ? `지금 ${dim.w}×${dim.h} — 서점 이미지 서버 원본으로 바꿔 주세요` : '크기를 읽지 못함(jpg·png·webp만)';
      // 준비 중인(아직 안 켜진) 시즌은 막고, 이미 진행 중인 시즌은 경고만 — 진행 중 시즌 때문에 다음 시즌 준비가 막히지 않게
      if (!s.startsAt || s.startsAt <= CS.seasonNowKST()) { if (!ok) warns.push(`${L} · ${name} → ${detail}`); }
      else check(L, name, ok, detail);
    }
    const arch = existsSync(archiveDir) && readdirSync(archiveDir).find((d) => d.startsWith(spec.id + '-'));
    if (!arch || !spec.pages) continue; // 템플릿 이전 시즌(s1·s2)은 대조하지 않는다
    const { docs, leftovers } = renderSeason(spec);
    check(L, '채우지 못한 자리표시자가 없다', leftovers.size === 0, [...leftovers].join(', '));
    for (const r of compareWith(docs, join(archiveDir, arch))) {
      if (r.skipped) continue;
      const d = r.diffs[0];
      check(L, `${r.tpl} 렌더 = 노션 최종본 사본(${r.snap})`, r.diffs.length === 0,
        d && `${r.diffs.length}줄 다름 — ${d.line}행 렌더 「${d.render ?? ''}」 / 사본 「${d.snapshot ?? ''}」`);
    }
  }
}

// ── 출력 ──
let cur = null;
for (const r of results) {
  if (r.season !== cur) { cur = r.season; console.log(`\n── ${cur} ──`); }
  if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? '  → ' + r.detail : ''}`);
}
if (warns.length) console.log('\n⚠ 확인 필요\n' + warns.map((w) => '  · ' + w).join('\n'));
const pass = results.length - fail;
console.log(fail ? `\n✗ ${fail}건 실패 / ${pass}건 통과` : `\n✓ 시즌 검사 전부 통과 (${pass}건)`);
process.exit(fail ? 1 : 0);
