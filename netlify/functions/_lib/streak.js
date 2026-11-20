/* tools/lib/streak.mjs 의 CommonJS 판 — Netlify 함수(명단 자동 반영)에서 같은 규칙으로 쓴다.
 * 규칙을 고치면 두 파일을 같이 고친다(test/roster-auto.test.js 가 두 판이 같은 답을 내는지 본다). */
const nameKey = (s) => String(s || '').normalize('NFC').replace(/[^가-힣A-Za-z0-9]/g, '');
const emailKey = (s) => String(s || '').trim().toLowerCase();

function indexRoster(rows) {
  const byEmail = new Map();
  const byName = new Map();
  const nameCount = new Map();
  for (const r of rows) {
    const em = emailKey(r.email);
    const nm = nameKey(r.nickname || r.name);
    if (em && !byEmail.has(em)) byEmail.set(em, r);
    if (nm) {
      nameCount.set(nm, (nameCount.get(nm) || 0) + 1);
      if (!byName.has(nm)) byName.set(nm, r);
    }
  }
  for (const [nm, n] of nameCount) if (n > 1) byName.delete(nm);
  return { byEmail, byName };
}

function findInRoster(person, idx) {
  const em = emailKey(person.email);
  const nm = nameKey(person.nickname || person.name);
  return (em && idx.byEmail.get(em)) || (nm && idx.byName.get(nm)) || null;
}

function seasonStreakFor(person, priorIdx) {
  let streak = 1;
  for (const idx of priorIdx) {
    const hit = findInRoster(person, idx);
    if (!hit || hit.status === 'out') break;
    streak++;
  }
  return streak;
}

function priorSeasons(seasons, seasonId, fromId) {
  const at = seasons.findIndex((s) => s.id === seasonId);
  if (at < 0) throw new Error(`시즌 '${seasonId}'가 없습니다.`);
  const from = fromId ? seasons.findIndex((s) => s.id === fromId) : 0;
  return seasons.slice(Math.max(0, from), at).reverse();
}

async function loadPriorIndexes(db, seasons, seasonId, collectionNameFor, fromId) {
  const out = [];
  for (const s of priorSeasons(seasons, seasonId, fromId)) {
    const snap = await db.collection(collectionNameFor(s.dataPrefix, 'participants')).get();
    const rows = snap.docs.map((d) => d.data());
    out.push({ season: s, rows, idx: indexRoster(rows) });
  }
  return out;
}

module.exports = { nameKey, emailKey, indexRoster, findInRoster, seasonStreakFor, priorSeasons, loadPriorIndexes };
