/* 🚪 이번 기수 명단 자동 입력 — 래피드 결제 서버(latpeed-notify, Vercel)가 시작일 06:00에 명단을 밀어 넣는다.
 *
 * 받는 것: { season?, rows: [{ name, email, phone, status: 'paid'|'due' }], dryRun? }
 *   - status 'due' = 시작일(21일) 결제 예정자. 그대로 넣되 메모에 표시한다(결제 안 되면 운영진이 정리).
 *
 * 규칙 (tools/roster-upload.mjs·운영진 화면 업로드와 같다)
 *   - 이미 있는 사람(이메일 · 전화번호 · 이름 중 하나라도 같으면)은 건너뛴다 — 여러 번 보내도 안전.
 *     빈 이메일·전화번호만 채워 준다.
 *   - 이름이 같은데 다른 사람이면 "이름(전화 뒷4자리)"로 넣는다.
 *   - 이메일이 있으면 알림 메일(notifyEmails)에도 넣는다.
 *   - 앞 시즌 명단과 맞춰 연속 참여(🔥N)를 같이 넣는다.
 * 문서 ID는 이메일/전화로 정해지는 값이라, 겹쳐 실행돼도 같은 사람이 두 번 생기지 않는다. */
const { createHash } = require('crypto');
const { loadPriorIndexes, seasonStreakFor, nameKey, emailKey } = require('./streak');
const feedSnapshot = require('./feedSnapshot');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const digits = (s) => String(s || '').replace(/[^0-9]/g, '');
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const colFor = (cfg, name) => (cfg.dataPrefix ? `${cfg.dataPrefix}_${name}` : name);

/** 들어온 행을 다듬는다: 이름 공백 정리, 이메일 소문자, 전화 숫자만(+82 → 0) */
function cleanRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    let phone = digits(r && r.phone);
    if (phone.startsWith('82') && phone.length >= 11) phone = '0' + phone.slice(2);
    const email = emailKey(r && r.email);
    return {
      name: String((r && r.name) || '').trim().replace(/\s+/g, ' '),
      email: EMAIL_RE.test(email) ? email : '',
      phone,
      status: r && r.status === 'due' ? 'due' : 'paid'
    };
  }).filter((r) => r.name && (r.email || r.phone));
}

/** 받은 시즌 id가 없으면: 오늘~3일 안에 시작하는 시즌(모집 중 미리 보낸 경우), 없으면 지금 켜진 시즌 */
function pickTargetSeason(CS, seasonId, todayKST) {
  if (seasonId) return CS.configFor(seasonId);
  const soon = CS.SEASONS.find((s) => s.startDate && s.startDate >= todayKST
    && (Date.parse(s.startDate) - Date.parse(todayKST)) <= 3 * 86400000);
  return CS.configFor((soon || CS.pickSeason(CS.seasonNowKST())).id);
}

async function importRoster(db, CS, cfg, rowsIn, { dryRun = false, now = new Date().toISOString() } = {}) {
  const rows = cleanRows(rowsIn);
  const pCol = db.collection(colFor(cfg, 'participants'));
  const existing = (await pCol.get()).docs.map((d) => Object.assign({ id: d.id }, d.data()));
  const byEmail = new Map(); const byPhone = new Map(); const byName = new Map();
  const index = (p) => {
    if (p.email) byEmail.set(emailKey(p.email), p);
    if (digits(p.phone)) byPhone.set(digits(p.phone), p);
    if (p.nickname) byName.set(nameKey(p.nickname), p);
  };
  existing.forEach(index);

  const prior = await loadPriorIndexes(db, CS.SEASONS, cfg.seasonId,
    (prefix, name) => (prefix ? `${prefix}_${name}` : name), CS.COMMON.streakFromSeason);
  const priorIdx = prior.map((x) => x.idx);

  // 이번 묶음 안에서 같은 이름이 둘 이상이면 처음부터 꼬리표를 붙인다
  const nameCount = new Map(); const uniq = new Set();
  rows.forEach((r) => {
    if (uniq.has(r.email || r.phone)) return;
    uniq.add(r.email || r.phone);
    nameCount.set(nameKey(r.name), (nameCount.get(nameKey(r.name)) || 0) + 1);
  });

  const added = []; const skipped = []; const filled = []; const writes = [];
  const seen = new Set();
  for (const r of rows) {
    const key = r.email || r.phone;
    if (seen.has(key)) continue;
    seen.add(key);
    let same = (r.email && byEmail.get(r.email)) || (r.phone && byPhone.get(r.phone));
    // 이름만 있고 이메일·전화번호가 비어 있는 사람(운영진이 이름만 넣어 둔 경우)은 이름이 같으면 같은 사람으로 보고 채운다
    if (!same) {
      const byNm = byName.get(nameKey(r.name));
      if (byNm && !byNm.email && !digits(byNm.phone)) same = byNm;
    }
    if (same) {
      const patch = {};
      // 시작 전 결제 실패·취소로 아웃됐던 래피드 회원이 다시 결제하면 되살린다(운영진이 직접 아웃한 사람은 그대로)
      if (same.status === 'out' && same.source === 'latpeed' && /^시작 전/.test(String(same.note || ''))) {
        patch.status = 'active'; patch.outDate = null; patch.note = '';
      }
      if (!same.email && r.email) patch.email = r.email;
      if (!digits(same.phone) && r.phone) patch.phone = r.phone;
      if (Object.keys(patch).length) {
        Object.assign(same, patch); index(same);
        filled.push(same.nickname);
        writes.push(() => pCol.doc(same.id).set(patch, { merge: true }));
      } else skipped.push(same.nickname);
      continue;
    }
    let nickname = r.name;
    const clash = byName.get(nameKey(nickname));
    if (clash || nameCount.get(nameKey(r.name)) > 1) {
      if (r.phone.length < 4) { skipped.push(`${r.name}(동명이인·번호 없음)`); continue; }
      nickname = `${r.name}(${r.phone.slice(-4)})`;
      if (byName.has(nameKey(nickname))) { skipped.push(nickname); continue; }
    }
    const id = 'lp_' + sha(key).slice(0, 16);
    const doc = {
      nickname,
      email: r.email,
      phone: r.phone,
      kakaoJoined: '',
      status: 'active',
      joinDate: cfg.startDate,
      outDate: null,
      exemptDates: [],
      note: r.status === 'due' ? '시작일 결제 예정(래피드)' : '',
      source: 'latpeed',
      payment: r.status,
      seasonStreak: seasonStreakFor({ nickname, email: r.email }, priorIdx),
      createdAt: now
    };
    const p = Object.assign({ id }, doc);
    index(p);
    added.push({ id, nickname, payment: r.status, streak: doc.seasonStreak });
    writes.push(() => pCol.doc(id).set(doc));
  }

  // 알림 메일 — 이미 있는 주소는 건너뛴다
  const mCol = db.collection(colFor(cfg, 'notifyEmails'));
  const haveMail = new Set((await mCol.get()).docs.map((d) => emailKey(d.data().email)));
  for (const a of added) {
    const p = byName.get(nameKey(a.nickname));
    if (p && p.email && !haveMail.has(p.email)) {
      haveMail.add(p.email);
      writes.push(() => mCol.doc('lp_' + sha(p.email).slice(0, 16)).set({ name: a.nickname, email: p.email, createdAt: now }));
    }
  }

  if (!dryRun && writes.length) {
    for (let i = 0; i < writes.length; i += 20) await Promise.all(writes.slice(i, i + 20).map((w) => w()));
    await feedSnapshot.invalidate(db, { id: cfg.seasonId }, { roster: true });
  }
  return {
    season: cfg.seasonId, book: cfg.book && cfg.book.name, dryRun: !!dryRun,
    received: rows.length, added, filled, skipped, total: existing.length + added.length
  };
}

/** Authorization: Bearer <토큰> — 토큰 자체는 래피드 서버(Vercel 환경 변수)에만 있고, 여기엔 SHA-256만 둔다 */
function tokenOk(event, hashes) {
  const h = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const token = h.replace(/^Bearer\s+/i, '').trim();
  return !!token && (hashes || []).includes(sha(token));
}

/** 강퇴 대상 확인용: 이번 시즌 명단, 바로 앞 시즌 명단, 앞 시즌엔 있었는데 이번에 없는 사람.
 *  같은 사람인지는 이메일 → 전화번호 → 이름(공백·괄호 무시) 순으로 본다. */
async function rosterLists(db, CS, cfg, current) {
  const row = (p) => ({ name: p.nickname, email: p.email || '', phone: digits(p.phone), payment: p.payment || '', kakaoJoined: p.kakaoJoined || '' });
  const at = CS.SEASONS.findIndex((s) => s.id === cfg.seasonId);
  const prevSeason = at > 0 ? CS.configFor(CS.SEASONS[at - 1].id) : null;
  let previous = [];
  if (prevSeason) {
    previous = (await db.collection(colFor(prevSeason, 'participants')).get()).docs.map((d) => d.data()).filter((p) => p.status !== 'out');
  }
  const em = new Set(); const ph = new Set(); const nm = new Set();
  current.forEach((p) => { if (p.email) em.add(emailKey(p.email)); if (digits(p.phone)) ph.add(digits(p.phone)); if (p.nickname) nm.add(nameKey(p.nickname)); });
  const stays = (p) => (p.email && em.has(emailKey(p.email))) || (digits(p.phone) && ph.has(digits(p.phone))) || nm.has(nameKey(p.nickname));
  return {
    season: cfg.seasonId, book: cfg.book && cfg.book.name,
    current: current.map(row),
    previousSeason: prevSeason ? { id: prevSeason.seasonId, book: prevSeason.book && prevSeason.book.name } : null,
    previous: previous.map(row),
    dropped: previous.filter((p) => !stays(p)).map(row)
  };
}

module.exports = { importRoster, rosterLists, cleanRows, pickTargetSeason, tokenOk, sha };
