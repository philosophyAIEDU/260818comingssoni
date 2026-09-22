#!/usr/bin/env node
/* 신청자 명단(xlsx/csv)을 앱(Firestore)에 바로 넣는다 — 운영진 화면에서 파일을 고르던 단계를 없앤다.
 *
 *   node tools/roster-upload.mjs <신청자.xlsx|csv> --season s3            → 미리보기(쓰지 않음)
 *   node tools/roster-upload.mjs <신청자.xlsx|csv> --season s3 --write    → 실제로 넣는다
 *
 * 필요한 것
 *   FIREBASE_SERVICE_ACCOUNT_KEY  — Netlify에 넣어 둔 것과 같은 서비스 계정 JSON(한 줄).
 *                                   Claude 환경 변수나 셸에 넣어 두면 된다. 저장소에는 절대 넣지 않는다.
 *
 * 하는 일 (운영진 화면의 "명단 시트 업로드"와 같은 규칙)
 *   - 열 순서: 이름 · 이메일 · 전화번호 (머리글 줄은 자동으로 건너뛴다)
 *   - 참여자(participants)를 만들고, 이메일이 있으면 알림 메일(notifyEmails)에도 넣는다
 *   - 같은 이름이 두 번 나오면(동명이인) 둘 다 "이름(전화 뒷4자리)"로 넣는다 — 앱 검색·카톡 대조가 갈린다
 *   - 이미 있는 이름·이메일은 건너뛴다(두 번 돌려도 안전)
 *   - 신청자 파일은 커밋하지 않는다(개인정보)
 */
import { readTable } from './lib/xlsx-lite.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const WRITE = args.includes('--write');
const seasonIdx = args.indexOf('--season');
const seasonId = seasonIdx >= 0 ? args[seasonIdx + 1] : '';
if (!file || !seasonId) {
  console.error('사용법: node tools/roster-upload.mjs <신청자.xlsx|csv> --season <시즌id> [--write]');
  process.exit(2);
}

/* 앱과 같은 config/utils를 Node에서 그대로 쓴다(Netlify 함수의 appLogic과 같은 방식). 시즌은 --season으로 고정. */
process.env.CS_SEASON = seasonId;
global.window = global;
require(join(root, 'js/config.js'));
require(join(root, 'js/utils.js'));
const { CONFIG, U, collectionName } = global.CS;
if (CONFIG.seasonId !== seasonId) {
  console.error(`시즌 '${seasonId}'가 js/config.js에 없습니다.`);
  process.exit(2);
}

/* ── 파일 읽기 ── */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const rows = readTable(file).filter((r) => r.A || r.B);
if (rows.length && /이름|name/i.test(String(rows[0].A || ''))) rows.shift();
const raw = rows.map((r) => ({
  name: U.normalizeNick(r.A),
  email: String(r.B || '').trim().toLowerCase(),
  phone: String(r.C || '').replace(/[^0-9]/g, '')
})).filter((r) => r.name || r.email);
if (!raw.length) { console.error('명단이 비어 있습니다.'); process.exit(2); }

/* 동명이인: 같은 이름이 둘 이상이면 전부 "이름(뒷4자리)"로. 번호가 없으면 사람이 갈라야 한다. */
const byName = new Map();
raw.forEach((r) => { if (r.name) byName.set(r.name, (byName.get(r.name) || 0) + 1); });
const needHuman = [];
const entries = raw.map((r) => {
  if (!r.name || byName.get(r.name) === 1) return r;
  if (r.phone.length >= 4) return { ...r, name: `${r.name}(${r.phone.slice(-4)})` };
  needHuman.push(r.name);
  return r;
});
const invalidEmails = entries.filter((r) => r.email && !EMAIL_RE.test(r.email)).map((r) => r.email);

/* ── Firestore ── */
const admin = require('firebase-admin');
const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!key) {
  console.error('FIREBASE_SERVICE_ACCOUNT_KEY 환경 변수가 없습니다. Netlify에 넣어 둔 서비스 계정 JSON을 그대로 넣어 주세요.');
  process.exit(2);
}
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(key)) });
const db = admin.firestore();
const col = (name) => db.collection(collectionName(name));

const existingP = new Set((await col('participants').get()).docs.map((d) => d.data().nickname));
const existingM = new Set((await col('notifyEmails').get()).docs.map((d) => String(d.data().email || '').toLowerCase()));

const addP = entries.filter((r) => r.name && !existingP.has(r.name));
const skipP = entries.filter((r) => r.name && existingP.has(r.name));
const addM = entries.filter((r) => r.email && EMAIL_RE.test(r.email) && !existingM.has(r.email));

console.log(`■ ${CONFIG.label} · 『${CONFIG.book.name}』 → 컬렉션 ${collectionName('participants')}`);
console.log(`   파일 ${entries.length}줄 · 새 참여자 ${addP.length}명 · 이미 있음 ${skipP.length}명 · 새 알림 메일 ${addM.length}건`);
if (skipP.length) console.log(`   이미 있음: ${skipP.map((r) => r.name).join(', ')}`);
if (needHuman.length) console.log(`   ⚠ 동명이인인데 전화번호가 없어 못 가른 이름: ${[...new Set(needHuman)].join(', ')} — 파일에서 직접 구분해 주세요`);
if (invalidEmails.length) console.log(`   ⚠ 이메일 형식이 아닌 값: ${invalidEmails.join(', ')}`);
const renamed = entries.filter((r, i) => r.name !== raw[i].name);
if (renamed.length) console.log(`   동명이인 표기: ${renamed.map((r) => r.name).join(', ')}`);

if (!WRITE) {
  console.log('\n(미리보기입니다. 실제로 넣으려면 --write 를 붙이세요)');
  process.exit(needHuman.length ? 1 : 0);
}
if (needHuman.length) {
  console.error('\n동명이인을 가르지 못한 이름이 있어 넣지 않았습니다. 파일을 고친 뒤 다시 돌려 주세요.');
  process.exit(1);
}

let batch = db.batch();
let n = 0;
const flush = async () => { if (n) { await batch.commit(); batch = db.batch(); n = 0; } };
for (const r of addP) {
  batch.set(col('participants').doc(), {
    nickname: r.name,
    email: EMAIL_RE.test(r.email) ? r.email : '',
    phone: r.phone || '',
    kakaoJoined: '',
    status: 'active',
    joinDate: CONFIG.startDate,
    outDate: null,
    exemptDates: [],
    note: '',
    createdAt: U.nowStamp()
  });
  if (++n >= 400) await flush();
}
for (const r of addM) {
  batch.set(col('notifyEmails').doc(), { name: r.name, email: r.email, createdAt: U.nowStamp() });
  if (++n >= 400) await flush();
}
await flush();
console.log(`\n✓ 참여자 ${addP.length}명, 알림 메일 ${addM.length}건을 넣었습니다.`);
console.log('다음: 운영진 화면 [명단 관리]에서 배너의 "보는 중" 시즌이 맞는지, 인원수가 맞는지 확인');
