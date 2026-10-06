#!/usr/bin/env node
/* 이번 시즌 참여자마다 "몇 시즌째 연속인지"(seasonStreak)를 앞 시즌 명단과 맞춰 다시 계산해 넣는다.
 *
 *   node tools/streak-sync.mjs --season s3            → 미리보기
 *   node tools/streak-sync.mjs --season s3 --write    → participants/{id}.seasonStreak 갱신
 *
 * roster-upload.mjs가 명단을 넣을 때 같은 계산을 이미 하므로, 보통은 돌릴 일이 없다.
 * 이름을 고쳤거나, 앞 시즌 명단이 바뀌었거나, 운영진 화면에서 손으로 넣은 값을 되돌리고 싶을 때 쓴다.
 * 필요한 것: FIREBASE_SERVICE_ACCOUNT_KEY (Netlify와 같은 서비스 계정 JSON)
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPriorIndexes, seasonStreakFor } from './lib/streak.mjs';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const seasonIdx = args.indexOf('--season');
const seasonId = seasonIdx >= 0 ? args[seasonIdx + 1] : '';
if (!seasonId) { console.error('사용법: node tools/streak-sync.mjs --season <시즌id> [--write]'); process.exit(2); }

process.env.CS_SEASON = seasonId;
global.window = global;
require(join(root, 'js/config.js'));
require(join(root, 'js/utils.js'));
const { CS } = global;
if (CS.CONFIG.seasonId !== seasonId) { console.error(`시즌 '${seasonId}'가 js/config.js에 없습니다.`); process.exit(2); }

const admin = require('firebase-admin');
const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!key) { console.error('FIREBASE_SERVICE_ACCOUNT_KEY 환경 변수가 없습니다.'); process.exit(2); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(key)) });
const db = admin.firestore();
const colName = (prefix, name) => (prefix ? `${prefix}_${name}` : name);

const prior = await loadPriorIndexes(db, CS.SEASONS, seasonId, colName, CS.COMMON.streakFromSeason);
const snap = await db.collection(colName(CS.CONFIG.dataPrefix, 'participants')).get();
const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

console.log(`■ ${CS.CONFIG.label} · 『${CS.CONFIG.book.name}』 — 앞 시즌 ${prior.length}개와 대조 (${prior.map((p) => p.season.label).join(' ← ') || '없음'})`);
const changes = [];
for (const p of rows) {
  const streak = seasonStreakFor(p, prior.map((x) => x.idx));
  const cur = p.seasonStreak || 1;
  if (streak !== cur) changes.push({ id: p.id, nickname: p.nickname, from: cur, to: streak });
}
const dist = {};
rows.forEach((p) => { const v = seasonStreakFor(p, prior.map((x) => x.idx)); dist[v] = (dist[v] || 0) + 1; });
console.log('   연속 시즌 분포:', Object.entries(dist).map(([k, v]) => `${k}시즌째 ${v}명`).join(' · '));
console.log(`   바뀌는 사람 ${changes.length}명`);
changes.forEach((c) => console.log(`   ${c.nickname}: ${c.from} → ${c.to}`));

if (!WRITE) { console.log('\n(미리보기입니다. 실제로 반영하려면 --write 를 붙이세요)'); process.exit(0); }
let batch = db.batch(); let n = 0;
for (const c of changes) {
  batch.update(db.collection(colName(CS.CONFIG.dataPrefix, 'participants')).doc(c.id), { seasonStreak: c.to });
  if (++n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
}
if (n) await batch.commit();
console.log(`\n✓ ${changes.length}명의 seasonStreak를 갱신했습니다.`);
