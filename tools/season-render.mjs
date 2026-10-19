#!/usr/bin/env node
/* 상수(tools/templates/*) + 변수(seasons/<id>.json) → 그 시즌의 노션 문서·카톡 공지.
 *
 *   node tools/season-render.mjs seasons/s4.json                 → out/s4/ 에 4개 문서
 *   node tools/season-render.mjs seasons/s3.json --compare archive/s3-혁명의팡파르
 *       → 렌더 결과를 노션 최종본 사본(가장 최근 날짜 판)과 한 줄씩 대조. 다르면 종료 코드 1.
 *
 * --compare 가 통과한다 = 템플릿이 그 시즌 최종본을 그대로 재현한다 = 다음 시즌도 변수만 바꾸면 된다.
 * 노션에서 문구를 직접 고쳤다면 사본을 새로 뜬 뒤(notion-snapshot) 여기서 어긋난 줄을 템플릿·설명서에 옮긴다.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';
import { seasonVars, fill, TEMPLATES } from './lib/season-vars.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const abs = (p) => (isAbsolute(p) ? p : join(root, p));

/** 시즌 설명서 → { 파일이름: 본문 } 와 채우지 못한 자리표시자 */
export function renderSeason(spec) {
  const s = seasonVars(spec);
  const leftovers = new Set();
  const docs = {};
  for (const tpl of TEMPLATES) {
    docs[tpl] = fill(readFileSync(join(root, 'tools/templates', tpl), 'utf8'), s.vars, leftovers);
  }
  return { docs, leftovers, season: s };
}

/** 보관 폴더에서 그 문서의 가장 최근 사본: 상세페이지.2026-10-20_0309.md > 상세페이지.md */
export function latestSnapshot(dir, tpl) {
  const base = tpl.replace(/\.(md|txt)$/, '');
  const ext = tpl.slice(base.length);
  const files = readdirSync(dir).filter((f) => f === tpl || (f.startsWith(base + '.') && f.endsWith(ext)
    && /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(f.slice(base.length + 1, -ext.length))));
  files.sort(); // 날짜 붙은 판이 이름순으로 뒤에 온다
  const dated = files.filter((f) => f !== tpl);
  return dated.length ? dated[dated.length - 1] : files[0] || null;
}

/** 대조할 때 무시하는 것: 사본 맨 위 출처 주석, 줄 끝 공백, 끝의 빈 줄 */
const norm = (t) => t.replace(/^<!--[^\n]*-->\n+/, '').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '');

export function compareWith(docs, dir) {
  const report = [];
  for (const tpl of TEMPLATES) {
    const snap = latestSnapshot(dir, tpl);
    if (!snap) { report.push({ tpl, skipped: true }); continue; }
    const a = norm(docs[tpl]).split('\n');
    const b = norm(readFileSync(join(dir, snap), 'utf8')).split('\n');
    const diffs = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) diffs.push({ line: i + 1, render: a[i], snapshot: b[i] });
    }
    report.push({ tpl, snap, diffs });
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , specPath, ...flags] = process.argv;
  if (!specPath) {
    console.error('사용법: node tools/season-render.mjs <시즌.json> [--compare <보관 폴더>] [--out <폴더>]');
    process.exit(2);
  }
  const opt = (k) => { const i = flags.indexOf(k); return i >= 0 ? flags[i + 1] : null; };
  const spec = JSON.parse(readFileSync(abs(specPath), 'utf8'));
  let r;
  try { r = renderSeason(spec); } catch (e) { console.error(e.message); process.exit(2); }
  const { docs, leftovers } = r;
  if (leftovers.size) console.log(`⚠ 채우지 못한 자리표시자: ${[...leftovers].join(', ')} — 시즌 설명서에 값을 넣어 주세요.`);

  const cmp = opt('--compare');
  if (cmp) {
    let bad = 0;
    for (const x of compareWith(docs, abs(cmp))) {
      if (x.skipped) { console.log(`- ${x.tpl}: 사본 없음 (건너뜀)`); continue; }
      if (!x.diffs.length) { console.log(`✓ ${x.tpl} = ${x.snap}`); continue; }
      bad++;
      console.log(`✗ ${x.tpl} ≠ ${x.snap} — ${x.diffs.length}줄 다름`);
      x.diffs.slice(0, 8).forEach((d) => console.log(`   ${d.line}행\n     렌더: ${d.render ?? '(없음)'}\n     사본: ${d.snapshot ?? '(없음)'}`));
    }
    process.exit(bad || leftovers.size ? 1 : 0);
  }

  const outDir = abs(opt('--out') || `out/${spec.id}`);
  mkdirSync(outDir, { recursive: true });
  for (const [tpl, text] of Object.entries(docs)) writeFileSync(join(outDir, tpl), text);
  console.log(`✓ ${outDir.replace(root + '/', '')}/ 에 ${Object.keys(docs).join(' · ')}`);
}
