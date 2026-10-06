/* 연속 참여 시즌 수 — "이번 시즌 포함 몇 시즌째 연속으로 함께하는가".
 *
 * 규칙 (커밍쏜이 정한 것)
 *   - 1시즌째(처음 왔거나, 쉬었다 돌아온 사람)는 배지 없음. 이어서 2시즌째면 🔥 2, 3시즌째면 🔥 3 …
 *   - 바로 앞 시즌에 없었거나 앞 시즌에서 아웃이었으면 끊긴 것 → 다시 1(배지 없음)부터.
 *   - 같은 사람인지는 **이메일**과 **이름**으로 본다. 이메일이 같으면 같은 사람(이름을 바꿔도 이어짐).
 *     이메일이 안 맞으면 이름으로 보는데, 꼬리표까지 같은 이름만 같은 사람으로 친다.
 *     "이유진(1362)" = "이유진1362", 하지만 앞 시즌에 같은 이름이 둘 이상이었으면(동명이인) 이름으로는 잇지 않는다.
 *   - 세기 시작하는 시즌은 CS.COMMON.streakFromSeason (멤버십 첫 시즌 = 꿈과 돈). 그보다 앞 시즌은 보지 않는다.
 */

/** 이름 비교용 키 — 공백·괄호·기호를 떼고 글자와 숫자만 남긴다. "이유진(1362)" → "이유진1362" */
export const nameKey = (s) => String(s || '')
  .normalize('NFC')
  .replace(/[^가-힣A-Za-z0-9]/g, '');

export const emailKey = (s) => String(s || '').trim().toLowerCase();

/** 한 시즌의 명단을 빠른 조회용으로 바꾼다. rows: [{ nickname, email, status }] */
export function indexRoster(rows) {
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
  // 동명이인이 있던 이름은 이름만으로는 누구인지 모른다 — 이메일로만 잇는다.
  for (const [nm, n] of nameCount) if (n > 1) byName.delete(nm);
  return { byEmail, byName };
}

/** 사람 하나가 그 시즌 명단에 있는지. 이메일 → 이름 순. 있으면 그 행, 없으면 null. */
export function findInRoster(person, idx) {
  const em = emailKey(person.email);
  const nm = nameKey(person.nickname || person.name);
  return (em && idx.byEmail.get(em)) || (nm && idx.byName.get(nm)) || null;
}

/** priorIdx: 앞 시즌들의 인덱스를 **가까운 시즌부터** 순서대로. 이번 시즌 포함한 연속 수를 돌려준다. */
export function seasonStreakFor(person, priorIdx) {
  let streak = 1;
  for (const idx of priorIdx) {
    const hit = findInRoster(person, idx);
    if (!hit || hit.status === 'out') break;
    streak++;
  }
  return streak;
}

/** 이번 시즌 앞의, 세기 시작 시즌(fromId) 이후 시즌들을 가까운 시즌부터 돌려준다. */
export function priorSeasons(seasons, seasonId, fromId) {
  const at = seasons.findIndex((s) => s.id === seasonId);
  if (at < 0) throw new Error(`시즌 '${seasonId}'가 없습니다.`);
  const from = fromId ? seasons.findIndex((s) => s.id === fromId) : 0;
  return seasons.slice(Math.max(0, from), at).reverse();
}

/** Firestore에서 앞 시즌들 명단을 읽어 인덱스로 만든다(가까운 시즌부터).
 *  seasons: CS.SEASONS, seasonId: 이번 시즌, fromId: CS.COMMON.streakFromSeason, collectionNameFor(prefix, name) */
export async function loadPriorIndexes(db, seasons, seasonId, collectionNameFor, fromId) {
  const out = [];
  for (const s of priorSeasons(seasons, seasonId, fromId)) {
    const snap = await db.collection(collectionNameFor(s.dataPrefix, 'participants')).get();
    out.push({ season: s, idx: indexRoster(snap.docs.map((d) => d.data())) });
  }
  return out;
}
