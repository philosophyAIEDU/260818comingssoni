/* 읽기 줄이기 — 멤버 앱이 쓰는 "명단"과 "그날 인증글 목록"을 서버가 한 번 읽어 모두에게 나눠 준다.
 *
 * 왜: Firebase 무료(Spark) 요금제는 하루 읽기가 5만 건이다. 예전엔 멤버가 앱을 열 때마다(그리고 켜 둔 채로 몇 분마다)
 * 브라우저가 명단과 오늘·어제 글을 문서 하나하나 읽어서, 멤버 수 × 열 때마다 읽기가 늘었다(하루 45만 건).
 * 이제는 같은 목록을 서버가 한 번만 읽어 Firestore에 스냅샷(feedSnapshots/{키})으로 저장해 두고, 멤버는 그 스냅샷
 * 문서 하나만 읽는다(= 읽기 1건). 목록을 다시 읽는 건 스냅샷이 오래됐을 때 딱 한 번뿐이다.
 *
 *  - 오래됨 기준(TTL): 명단 30분(운영진이 고치면 바로 갱신) · 오늘 글 10분 · 어제 글 45분 · 2~6일 전 12시간 · 그 이전 3일.
 *    지난 글일수록 거의 안 바뀐다(바뀌는 건 추천 수 정도 — 운영진이 글을 고치거나 지우면 그 날짜는 바로 갱신된다).
 *  - 여럿이 동시에 요청해도 목록을 다시 읽는 사람은 한 명(리스: leaseUntil). 나머지는 직전 스냅샷을 그대로 받는다.
 *  - 서버 인스턴스 메모리에도 45초 둔다(같은 인스턴스 안에서는 스냅샷 읽기도 생략).
 *  - 스냅샷은 gzip 후 base64 문자열 하나로 저장한다(Firestore 문서 1MiB 제한 안에 들어가게). 너무 크면 저장하지 않고 그대로 준다.
 *  - 내 글·내 추천은 브라우저가 바로 덧씌워 보여 주므로(js/feed-client.js) 스냅샷이 늦어도 내 화면은 즉시 맞다.
 * 쓰기(인증 저장·추천)는 예전처럼 브라우저가 Firestore에 직접 한다. 이 모듈은 읽기 전용이다. */
const zlib = require('zlib');

const COLLECTION = 'feedSnapshots';
const MIN = 60 * 1000;
// 명단은 운영진이 고칠 때마다 invalidate로 바로 갱신되므로 길게 둔다. 지난 글도 거의 안 바뀐다.
const TTL = { roster: 30 * MIN, today: 10 * MIN, yesterday: 45 * MIN, week: 12 * 60 * MIN, older: 72 * 60 * MIN };
const LEASE_MS = 25 * 1000;
const MEMORY_MS = 45 * 1000;
const MAX_STORED_CHARS = 900 * 1000;
// 멤버 앱이 쓰는 명단 필드만 내려보낸다(이메일·전화번호·메모 같은 운영용 정보는 멤버에게 보낼 이유가 없다).
const ROSTER_FIELDS = ['nickname', 'status', 'joinDate', 'outDate', 'exemptDates', 'kickReason', 'seasonStreak', 'createdAt'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const memory = new Map(); // 키 → { at(저장 시각), loadedAt, rows }

function publicParticipant(id, data) {
  const out = { id };
  for (const k of ROSTER_FIELDS) if (data[k] !== undefined) out[k] = data[k];
  return out;
}

const encode = (rows) => zlib.gzipSync(Buffer.from(JSON.stringify(rows))).toString('base64');
const decode = (z) => JSON.parse(zlib.gunzipSync(Buffer.from(z, 'base64')).toString());

/** 날짜 d가 오늘(today)로부터 얼마나 지난 날인지에 따라 스냅샷을 얼마나 오래 쓸지 */
function ttlFor(kind, date, today, addDays) {
  if (kind === 'roster') return TTL.roster;
  if (date >= today) return TTL.today;
  if (date === addDays(today, -1)) return TTL.yesterday;
  if (date >= addDays(today, -6)) return TTL.week;
  return TTL.older;
}

/** 스냅샷을 읽고, 오래됐으면 build()로 다시 만들어 저장한다.
 *  돌려주는 값: { rows, at } — at은 스냅샷을 만든 시각(ms). build가 실패하면 직전 스냅샷(있으면)을 대신 준다. */
async function readThrough(db, key, ttlMs, build, now = () => Date.now(), force = false) {
  // force: 방금 일어난 일까지 정확히 봐야 할 때(예약 메일이 "오늘 아직 안 낸 사람"을 고를 때) — 오래됨 판단·메모리를 건너뛰고 새로 읽는다
  const mem = force ? null : memory.get(key);
  if (mem && now() - mem.loadedAt < Math.min(MEMORY_MS, ttlMs) && now() - mem.at < ttlMs) return { rows: mem.rows, at: mem.at };

  const ref = db.collection(COLLECTION).doc(key);
  const snap = await ref.get();
  const cur = snap.exists ? snap.data() : null;
  const remember = (rows, at) => { memory.set(key, { rows, at, loadedAt: now() }); return { rows, at }; };
  if (!force && cur && cur.z && now() - cur.at < ttlMs) return remember(decode(cur.z), cur.at);

  // 오래됐거나 아직 없다 → 다시 읽을 사람은 한 명만(리스를 잡은 쪽)
  const got = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const d = s.exists ? s.data() : {};
    if (d.leaseUntil && d.leaseUntil > now()) return false;
    tx.set(ref, { leaseUntil: now() + LEASE_MS }, { merge: true });
    return true;
  });
  if (!got) {
    if (force) return { rows: await build(), at: now() }; // 누가 다시 읽는 중이어도 정확해야 하면 이번엔 직접
    if (cur && cur.z) return remember(decode(cur.z), cur.at); // 직전 스냅샷을 그대로
    for (let i = 0; i < 6; i++) { // 처음 만드는 중이면 잠깐 기다렸다 받는다
      await sleep(700);
      const s = await ref.get();
      if (s.exists && s.data().z) return remember(decode(s.data().z), s.data().at);
    }
    return { rows: await build(), at: now() }; // 끝내 없으면 이번 요청만 직접(저장 없이)
  }
  try {
    const rows = await build();
    const z = encode(rows);
    const at = now();
    if (z.length <= MAX_STORED_CHARS) await ref.set({ at, z, n: rows.length, leaseUntil: 0 });
    else await ref.set({ at: 0, n: rows.length, tooBig: true, leaseUntil: 0 }); // 너무 크면 저장하지 않는다(매번 직접 읽지 않도록 리스만 풀어 둔다)
    return remember(rows, at);
  } catch (err) {
    await ref.set({ leaseUntil: 0 }, { merge: true }).catch(() => {});
    if (cur && cur.z) return remember(decode(cur.z), cur.at); // 읽기에 실패해도(한도 초과 등) 직전 스냅샷으로 버틴다
    throw err;
  }
}

const rosterKey = (seasonId) => `${seasonId}__roster`;
const dayKey = (seasonId, date) => `${seasonId}__day__${date}`;
const collectionOf = (season, name) => (season.dataPrefix ? `${season.dataPrefix}_${name}` : name);

function getRoster(db, season, now) {
  return readThrough(db, rosterKey(season.id), TTL.roster, async () => {
    const snap = await db.collection(collectionOf(season, 'participants')).get();
    return snap.docs.map((d) => publicParticipant(d.id, d.data())).sort((a, b) => String(a.nickname).localeCompare(String(b.nickname), 'ko'));
  }, now);
}

function getDay(db, season, date, today, addDays, now, force) {
  return readThrough(db, dayKey(season.id, date), ttlFor('day', date, today, addDays), async () => {
    const snap = await db.collection(collectionOf(season, 'submissions')).where('date', '==', date).get();
    return snap.docs.map((d) => Object.assign({ id: d.id }, d.data()))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }, now, force);
}

/** 시즌의 인증글 전체를 날짜별 스냅샷으로 모은다 — 예약 메일(리마인드·경고)이 누락 횟수를 셀 때 쓴다.
 *  글 하나하나를 읽는 대신 지난 날은 스냅샷 문서 1건씩만 읽고, freshDates(오늘·어제)만 새로 읽는다.
 *  (지난 날의 늦은 제출은 어차피 미인증(X)이라 스냅샷이 하루 묵어도 누락 횟수는 같다.)
 *  U: 날짜 도구(today·addDays·dateRange), cfg: 그 시즌 설정(startDate·endDate) */
async function readSeasonSubmissions(db, season, cfg, U, { freshDates = [], now } = {}) {
  const today = U.today();
  const last = today < cfg.endDate ? today : cfg.endDate;
  const dates = cfg.startDate <= last ? U.dateRange(cfg.startDate, last) : [];
  const days = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, dates.length) }, async () => {
    while (next < dates.length) {
      const i = next++;
      days[i] = (await getDay(db, season, dates[i], today, U.addDays, now, freshDates.includes(dates[i]))).rows;
    }
  }));
  return days.flat();
}

/** 운영진이 명단·글을 고쳤을 때: 스냅샷을 오래된 것으로 표시해 다음 요청이 바로 다시 읽게 한다(문서는 지우지 않는다). */
async function invalidate(db, season, { roster, dates }) {
  const keys = [];
  if (roster) keys.push(rosterKey(season.id));
  for (const d of dates || []) keys.push(dayKey(season.id, d));
  await Promise.all(keys.map(async (k) => {
    memory.delete(k);
    await db.collection(COLLECTION).doc(k).set({ at: 0, leaseUntil: 0 }, { merge: true });
  }));
  return keys.length;
}

module.exports = { readSeasonSubmissions, COLLECTION, TTL, ROSTER_FIELDS, publicParticipant, ttlFor, readThrough, getRoster, getDay, invalidate, encode, decode, dayKey, rosterKey, _memory: memory };
