#!/usr/bin/env node
/* 카톡방 명단 ↔ 신청자 명단 대조.
 *
 * 매달 기수가 바뀔 때마다 하는 일이다 — 결제 안 한 사람은 내보내고, 결제했는데
 * 아직 안 들어온 사람은 초대해야 한다. 눈으로 63명 대 47명을 맞춰 보면 반드시 틀린다.
 *
 * 쓰는 법:
 *   node tools/roster-diff.mjs <신청자.xlsx|csv> <카톡이름.txt>
 *
 * 카톡 이름 파일은 대화상대 목록을 한 줄에 하나씩 붙여 넣으면 된다.
 * 이모지·괄호 꼬리표는 알아서 떼고 본다.
 *
 * 동명이인은 카톡 이름에 붙은 숫자(예: "이유진1362", "박선미(2703)")를 신청자
 * 전화번호와 맞춰 가른다 — 이름만 같고 번호가 다르면 다른 사람이다.
 *
 * 한 글자만 다른 이름(고태윤 ↔ 고다윤)은 자동으로 판정하지 않고 따로 세워 둔다.
 * 결제한 사람을 잘못 내보내는 것이 이 작업에서 가장 비싼 실수다.
 */
import { readFileSync } from 'node:fs';
import { readTable } from './lib/xlsx-lite.mjs';

const [, , rosterPath, kakaoPath] = process.argv;
if (!rosterPath || !kakaoPath) {
  console.error('사용법: node tools/roster-diff.mjs <신청자.xlsx|csv> <카톡이름.txt>');
  process.exit(2);
}

/* 운영진 계정은 명단에 없어도 내보내면 안 된다. 필요하면 여기에 더한다. */
const STAFF_HINTS = ['커밍쏜', '필로소피', '스텝', '운영', 'admin'];

const bare = (s) => String(s)
  .normalize('NFC')
  .replace(/\([^)]*\)/g, '')          // (2703) 같은 꼬리표
  .replace(/\d+/g, '')                 // 이유진1362 → 이유진
  .replace(/[^가-힣A-Za-z]/g, '');     // 이모지·공백·특수문자
const digits = (s) => String(s || '').replace(/\D/g, '');

// ── 신청자 ──
const rows = readTable(rosterPath).filter((r) => r.A);
const header = /이름|name/i.test(rows[0]?.A || '') ? rows.shift() : null;
const roster = rows.map((r) => ({ name: String(r.A).trim(), email: r.B || '', phone: r.C || '' }));
if (!roster.length) { console.error('신청자 명단이 비어 있습니다.'); process.exit(2); }

const byName = new Map();
for (const r of roster) {
  const k = bare(r.name);
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(r);
}

// ── 카톡 ──
const lines = readFileSync(kakaoPath, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const staff = lines.filter((l) => STAFF_HINTS.some((h) => l.includes(h)));
const members = lines.filter((l) => !staff.includes(l));

const keep = [], kick = [], ambiguous = [];
const matched = new Set();

for (const m of members) {
  const key = bare(m), tag = digits(m);
  const cands = byName.get(key) || [];
  if (!cands.length) {
    kick.push({ shown: m, why: '신청 명단에 이 이름이 없음' });
  } else if (cands.length === 1) {
    const r = cands[0], ph = digits(r.phone);
    if (tag && ph && !ph.endsWith(tag) && !ph.includes(tag)) {
      kick.push({ shown: m, why: `이름은 같지만 뒷번호 불일치 (신청자 ${r.name} = …${ph.slice(-4)})` });
    } else {
      keep.push({ shown: m, name: r.name });
      matched.add(r.name);
    }
  } else {
    // 신청자 쪽에도 같은 이름이 여럿 — 번호로 갈라 본다
    const hit = tag && cands.find((c) => digits(c.phone).endsWith(tag));
    if (hit) { keep.push({ shown: m, name: hit.name }); matched.add(hit.name); }
    else ambiguous.push({ shown: m, cands: cands.map((c) => `${c.name}(…${digits(c.phone).slice(-4)})`) });
  }
}

const missing = roster.filter((r) => !matched.has(r.name));

/* 내보낼 사람과 아직 안 들어온 신청자 사이에 한 글자만 다른 쌍이 있으면 따로 세운다. */
const risky = [];
for (const k of kick) {
  const a = bare(k.shown);
  for (const r of missing) {
    const b = bare(r.name);
    if (a.length === b.length && [...a].filter((ch, i) => ch !== b[i]).length === 1) {
      risky.push({ shown: k.shown, name: r.name, phone: r.phone });
    }
  }
}
const riskyNames = new Set(risky.map((x) => x.shown));
const safeKick = kick.filter((k) => !riskyNames.has(k.shown));

const line = (s) => console.log(s);
line(`카톡 ${lines.length}명 = 운영진 ${staff.length} + 멤버 ${members.length}`);
line(`신청자 ${roster.length}명${header ? '' : '  (머리글 줄이 없어 첫 줄도 사람으로 셌습니다 — 확인해 주세요)'}`);

line(`\n■ 바로 내보내기 — ${safeKick.length}명  (명단에 비슷한 이름조차 없음)`);
safeKick.forEach((k) => line(`   · ${k.shown}   ← ${k.why}`));
if (!safeKick.length) line('   없음');

line(`\n■ 번호 확인 후 결정 — ${risky.length}건  (한 글자 차이라 자동 판정하지 않음)`);
risky.forEach((r) => line(`   ⚠ 카톡 "${r.shown}"  ↔  신청자 "${r.name}" ${r.phone || '(번호없음)'}`));
if (!risky.length) line('   없음');

if (ambiguous.length) {
  line(`\n■ 사람이 확인 — ${ambiguous.length}명  (신청자 쪽에도 같은 이름이 여럿)`);
  ambiguous.forEach((a) => line(`   · ${a.shown} → ${a.cands.join(' / ')}`));
}

line(`\n■ 초대 필요 — ${missing.length}명  (신청했는데 카톡방에 없음)`);
missing.forEach((r) => line(`   · ${r.name}   ${r.phone || '(번호없음)'}`));
if (!missing.length) line('   없음');

line(`\n■ 유지 — ${keep.length}명`);

const okA = members.length === keep.length + kick.length + ambiguous.length;
const okB = roster.length === keep.length + missing.length;
line(`\n검산  멤버 ${members.length} = 유지 ${keep.length} + 내보내기 ${kick.length} + 확인 ${ambiguous.length}  → ${okA ? 'OK' : '어긋남!'}`);
line(`검산  신청 ${roster.length} = 유지 ${keep.length} + 초대 ${missing.length}  → ${okB ? 'OK' : '어긋남!'}`);
const noPhone = roster.filter((r) => !digits(r.phone)).map((r) => r.name);
if (noPhone.length) line(`\n※ 전화번호가 없는 신청자 ${noPhone.length}명 — 번호로 초대할 수 없습니다: ${noPhone.join(', ')}`);
process.exit(okA && okB ? 0 : 1);
