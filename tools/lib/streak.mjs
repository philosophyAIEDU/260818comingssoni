/* 연속 참여 시즌 수 — "이번 시즌 포함 몇 시즌째 연속으로 함께하는가".
 *
 * 앞 시즌 명단과 사람을 맞추는 규칙(roster-diff와 같은 취지):
 *   전화번호(숫자만) → 이메일(소문자) → 이름(괄호·숫자·공백을 뗀 것) 순으로, 하나라도 맞으면 같은 사람.
 * 앞 시즌에서 '아웃'(status: 'out')이었던 시즌은 연속으로 치지 않는다 — 거기서 끊긴다.
 *
 * 결과: 2 이상이면 앱에서 이름 옆에 🔥N 배지가 붙는다. 1이면 배지가 없다.
 */

export const bareName = (s) => String(s || '')
  .normalize('NFC')
  .replace(/\([^)]*\)/g, '')
  .replace(/\d+/g, '')
  .replace(/[^가-힣A-Za-z]/g, '');

export const digits = (s) => String(s || '').replace(/\D/g, '');

/** 한 시즌의 명단을 빠른 조회용으로 바꾼다. rows: [{ nickname, email, phone, status }] */
export function indexRoster(rows) {
  const byPhone = new Map(), byEmail = new Map(), byName = new Map();
  for (const r of rows) {
    const ph = digits(r.phone);
    const em = String(r.email || '').trim().toLowerCase();
    const nm = bareName(r.nickname || r.name);
    if (ph.length >= 8 && !byPhone.has(ph)) byPhone.set(ph, r);
    if (em && !byEmail.has(em)) byEmail.set(em, r);
    if (nm && !byName.has(nm)) byName.set(nm, r);
  }
  return { byPhone, byEmail, byName };
}

/** 사람 하나가 그 시즌 명단에 있는지. 있으면 그 행을, 없으면 null. */
export function findInRoster(person, idx) {
  const ph = digits(person.phone);
  const em = String(person.email || '').trim().toLowerCase();
  const nm = bareName(person.nickname || person.name);
  return (ph.length >= 8 && idx.byPhone.get(ph))
    || (em && idx.byEmail.get(em))
    || (nm && idx.byName.get(nm))
    || null;
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

/** Firestore에서 앞 시즌들 명단을 읽어 인덱스로 만든다(가까운 시즌부터).
 *  seasons: CS.SEASONS, seasonId: 이번 시즌, collectionNameFor(prefix, name) */
export async function loadPriorIndexes(db, seasons, seasonId, collectionNameFor) {
  const at = seasons.findIndex((s) => s.id === seasonId);
  if (at < 0) throw new Error(`시즌 '${seasonId}'가 없습니다.`);
  const prior = seasons.slice(0, at).reverse();
  const out = [];
  for (const s of prior) {
    const snap = await db.collection(collectionNameFor(s.dataPrefix, 'participants')).get();
    out.push({ season: s, idx: indexRoster(snap.docs.map((d) => d.data())) });
  }
  return out;
}
