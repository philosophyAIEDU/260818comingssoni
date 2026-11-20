/* 이번 기수 명단 자동 반영 + 단톡방 초대 문자 (커밍쏜 요청 2026-11-21)
 *
 * 매달 21일(기수 시작일)
 *   00:30 KST  문자 서버(latpeed-notify)가 래피드 알림으로 알고 있는 '이번 기수 멤버'를 받아
 *              이번 시즌 앱 명단(participants·notifyEmails)에 넣는다 — 운영진이 엑셀을 올리던 일.
 *              18~20일 결제 완료 + 21일 갱신 예정(구독 중)이 멤버다. 결제 실패·해지·종료는 빠진다.
 *              예외 참여자(쿠폰·해외 이체)와 '결제자 → 참여자 이름'(가족 대리결제)은 운영진 화면에서 적어 둔다.
 *   09:00 KST  새로 들어온 분(바로 앞 시즌 명단에 없던 분)에게만 단톡방 초대 문자.
 *   결과 메일  커밍쏜에게: 넣은 사람 / 초대할 사람 / 지난 기수에 있었는데 이번엔 없는 사람(사유) — 단톡방 정리용.
 *
 * 안전 원칙
 *   - 넣기만 한다. 지우거나 아웃 처리하지 않는다(사람이 판단).
 *   - 이미 있는 이름·이메일·전화번호는 건너뛴다(엑셀을 먼저 올렸어도, 두 번 돌아도 안전).
 *   - 받은 멤버 수가 너무 적으면(10명 미만, 또는 지난 기수의 절반 미만) 아무것도 쓰지 않고 멈춘 뒤 메일로 알린다.
 *   - 문자 서버 연결 정보·단톡방 링크는 저장소가 아니라 Netlify 환경 변수에 둔다(저장소는 공개).
 *     LATPEED_NOTIFY_URL · LATPEED_NOTIFY_SECRET · CHAT_INVITE_URL · CHAT_INVITE_CODE
 *   - 예외 참여자 이름 같은 개인정보도 저장소가 아니라 Firestore rosterAuto/settings 에 둔다. */
const { U } = require('./appLogic');
const streak = require('./streak');

const CS = global.CS;
const COL = 'rosterAuto';
const MIN_MEMBERS = 10;

const digits = (s) => String(s || '').replace(/[^0-9]/g, '');
const emailKey = (s) => String(s || '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const kstDate = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
const colFor = (prefix, name) => (prefix ? `${prefix}_${name}` : name);

function seasonStartingOn(date) {
  return CS.SEASONS.find((s) => s.startDate === date) || null;
}
function prevSeasonOf(season) {
  const i = CS.SEASONS.findIndex((s) => s.id === season.id);
  return i > 0 ? CS.SEASONS[i - 1] : null;
}
/** 오늘 이후(오늘 포함) 가장 가까운 시즌 시작일 — 운영진 미리보기 기본값 */
function nextCohortDate(nowMs) {
  const today = kstDate(nowMs);
  const s = CS.SEASONS.map((x) => x.startDate).filter((d) => d >= today).sort()[0];
  return s || null;
}

/* ── 설정(Firestore rosterAuto/settings) ──
 * extras:  [{ name, email, phone }]  래피드 결제 기록 없이 참여하는 분(쿠폰·해외 이체). 매달 그대로 들어간다.
 * aliases: [{ payer, name }]         결제자(이름 또는 전화번호) → 앱에 넣을 이름. 결제자가 멤버일 때만 들어간다.
 * invite:  true | false              09시 단톡방 초대 문자 자동 발송 */
const DEFAULT_SETTINGS = { extras: [], aliases: [], invite: true };
function cleanSettings(s) {
  const src = s || {};
  const extras = (Array.isArray(src.extras) ? src.extras : []).map((x) => ({
    name: U.normalizeNick(x && x.name), email: emailKey(x && x.email), phone: digits(x && x.phone)
  })).filter((x) => x.name);
  const aliases = (Array.isArray(src.aliases) ? src.aliases : []).map((x) => ({
    payer: U.normalizeNick(x && x.payer), name: U.normalizeNick(x && x.name)
  })).filter((x) => x.payer && x.name);
  return { extras, aliases, invite: src.invite !== false };
}
async function loadSettings(db) {
  const snap = await db.collection(COL).doc('settings').get();
  return cleanSettings(snap.exists ? snap.data() : DEFAULT_SETTINGS);
}
async function saveSettings(db, s, by) {
  const clean = cleanSettings(s);
  await db.collection(COL).doc('settings').set({ ...clean, updatedAt: new Date().toISOString(), updatedBy: by || '' });
  return clean;
}

/* ── 문자 서버에서 이번 기수 멤버 받기 ──
 * GET {LATPEED_NOTIFY_URL}/api/chat?date=C (Bearer LATPEED_NOTIFY_SECRET) — 보내지 않는 미리보기 주소.
 * keep·invite·invited·missing = 구독 중(이번 기수 멤버). remove·wait·check = 아님(사유 포함). */
async function fetchPayers(C, { env = process.env, fetchImpl = fetch } = {}) {
  const base = String(env.LATPEED_NOTIFY_URL || '').trim().replace(/\/+$/, '');
  const secret = String(env.LATPEED_NOTIFY_SECRET || '').trim();
  if (!base || !secret) throw new Error('LATPEED_NOTIFY_URL / LATPEED_NOTIFY_SECRET 환경 변수가 Netlify에 없습니다.');
  const res = await fetchImpl(`${base}/api/chat?date=${encodeURIComponent(C)}`, { headers: { authorization: `Bearer ${secret}` } });
  if (!res.ok) throw new Error(`문자 서버 응답 ${res.status}`);
  const d = await res.json();
  if (!d || d.cohort !== C) throw new Error(`문자 서버가 다른 기수(${d && d.cohort})를 돌려줬습니다`);
  const pick = (k) => (Array.isArray(d[k]) ? d[k] : []);
  const byPhone = new Map();
  for (const m of [...pick('keep'), ...pick('invited'), ...pick('missing'), ...pick('invite')]) {
    const phone = digits(m.phone);
    if (phone.length < 10 || byPhone.has(phone)) continue;
    byPhone.set(phone, { name: U.normalizeNick(m.name), email: emailKey(m.email), phone });
  }
  const notMembers = [];
  for (const k of ['remove', 'wait', 'check']) {
    for (const m of pick(k)) notMembers.push({ name: U.normalizeNick(m.name), phone: digits(m.phone), why: m.why || k, kind: k });
  }
  return { payers: [...byPhone.values()].filter((p) => p.name), notMembers };
}

/** 결제자 → 참여자 이름, 예외 참여자를 더해 이번 기수 명단을 만든다. 동명이인은 "이름(뒷4자리)". */
function buildEntries(payers, settings) {
  const aliasFor = (p) => settings.aliases.find((a) => {
    const d = digits(a.payer);
    return d.length >= 10 ? d === p.phone : streak.nameKey(a.payer) === streak.nameKey(p.name);
  });
  const out = [];
  const seenPhone = new Set();
  const seenName = new Set();
  for (const p of payers) {
    const a = aliasFor(p);
    out.push({ ...p, name: a ? a.name : p.name, payer: a ? p.name : '', source: 'rapid' });
    seenPhone.add(p.phone);
  }
  out.forEach((e) => seenName.add(streak.nameKey(e.name)));
  for (const x of settings.extras) {
    if ((x.phone && seenPhone.has(x.phone)) || seenName.has(streak.nameKey(x.name))) continue;
    out.push({ ...x, payer: '', source: 'extra' });
    seenName.add(streak.nameKey(x.name));
  }
  // 동명이인: 같은 이름이 둘 이상이면 전부 "이름(뒷4자리)"
  const count = new Map();
  out.forEach((e) => count.set(streak.nameKey(e.name), (count.get(streak.nameKey(e.name)) || 0) + 1));
  return out.map((e) => (count.get(streak.nameKey(e.name)) > 1 && e.phone.length >= 4 ? { ...e, name: `${e.name}(${e.phone.slice(-4)})` } : e))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

/** 한 사람이 어떤 명단(rows: participants 문서들)에 있는지 — 전화번호 → 이메일 → 이름 */
function makeMatcher(rows) {
  const idx = streak.indexRoster(rows);
  const phones = new Map();
  rows.forEach((r) => { const p = digits(r.phone); if (p.length >= 10 && !phones.has(p)) phones.set(p, r); });
  return (person) => (person.phone && phones.get(digits(person.phone))) || streak.findInRoster(person, idx) || null;
}

/**
 * 이번 기수 C 명단을 앱에 반영한다(write=false면 미리보기만).
 * 반환: { cohort, season, counts, added[], skipped[], invite[], dropped[], extras[], stopped? }
 */
async function syncRoster({ db, C, write, env, fetchImpl, nowMs = Date.now() }) {
  const season = seasonStartingOn(C);
  if (!season) return { cohort: C, stopped: `${C}에 시작하는 시즌이 js/config.js에 없습니다` };
  const prev = prevSeasonOf(season);
  const settings = await loadSettings(db);
  const { payers, notMembers } = await fetchPayers(C, { env, fetchImpl });
  const entries = buildEntries(payers, settings);

  const prevRows = prev ? (await db.collection(colFor(prev.dataPrefix, 'participants')).get()).docs.map((d) => d.data()) : [];
  const prevActive = prevRows.filter((r) => r.status !== 'out').length;
  const base = { cohort: C, season: season.id, book: season.book && season.book.name, prevSeason: prev && prev.id, ranAt: new Date(nowMs).toISOString(), write: !!write };

  if (payers.length < MIN_MEMBERS || (prevActive && payers.length < prevActive * 0.5)) {
    return { ...base, counts: { payers: payers.length, prevActive }, stopped: `래피드 멤버가 ${payers.length}명뿐이라(지난 기수 ${prevActive}명) 명단을 넣지 않고 멈췄습니다` };
  }

  const curCol = db.collection(colFor(season.dataPrefix, 'participants'));
  const curRows = (await curCol.get()).docs.map((d) => d.data());
  const inCurrent = makeMatcher(curRows);
  const inPrev = makeMatcher(prevRows);

  const prior = await streak.loadPriorIndexes(db, CS.SEASONS, season.id, colFor, CS.COMMON.streakFromSeason);
  const streakOf = (e) => streak.seasonStreakFor({ nickname: e.name, email: e.email }, prior.map((x) => x.idx));

  const added = [];
  const skipped = [];
  for (const e of entries) (inCurrent(e) ? skipped : added).push(e);

  // 단톡방 초대: 래피드 결제로 들어온 분 중 바로 앞 시즌 명단에 없던 분(앞 시즌 = 이미 단톡방에 있던 분)
  const invite = entries.filter((e) => e.source === 'rapid' && e.phone && !inPrev(e))
    .map((e) => ({ name: e.name, phone: e.phone }));

  // 지난 기수에 있었는데 이번 명단에 없는 분 → 단톡방 정리 후보(사유는 문자 서버 기록)
  const inNow = makeMatcher(entries.map((e) => ({ nickname: e.name, email: e.email, phone: e.phone })));
  const why = (r) => {
    const p = digits(r.phone);
    const hit = notMembers.find((m) => (p && m.phone === p) || streak.nameKey(m.name) === streak.nameKey(r.nickname));
    return hit ? hit.why : '이번 기수 결제 기록 없음';
  };
  const dropped = prevRows.filter((r) => r.nickname && !inNow({ nickname: r.nickname, email: r.email, phone: r.phone }))
    .map((r) => ({ name: r.nickname, why: why(r) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  if (write && added.length) {
    const notifyCol = db.collection(colFor(season.dataPrefix, 'notifyEmails'));
    const haveMail = new Set((await notifyCol.get()).docs.map((d) => emailKey(d.data().email)));
    let batch = db.batch();
    let n = 0;
    const flush = async () => { if (n) { await batch.commit(); batch = db.batch(); n = 0; } };
    const stamp = U.nowStamp();
    for (const e of added) {
      batch.set(curCol.doc(), {
        nickname: e.name,
        email: EMAIL_RE.test(e.email) ? e.email : '',
        phone: e.phone || '',
        kakaoJoined: '',
        status: 'active',
        joinDate: season.startDate,
        outDate: null,
        exemptDates: [],
        note: e.payer ? `자동 반영 · 결제자 ${e.payer}` : e.source === 'extra' ? '자동 반영 · 예외 참여' : '자동 반영',
        seasonStreak: streakOf(e),
        createdAt: stamp
      });
      if (++n >= 400) await flush();
      if (EMAIL_RE.test(e.email) && !haveMail.has(e.email)) {
        haveMail.add(e.email);
        batch.set(notifyCol.doc(), { name: e.name, email: e.email, createdAt: stamp });
        if (++n >= 400) await flush();
      }
    }
    await flush();
  }

  const pub = (e) => ({ name: e.name, phone: e.phone || '', email: e.email || '', source: e.source, payer: e.payer || '', streak: streakOf(e) });
  const result = {
    ...base,
    counts: { payers: payers.length, extras: entries.filter((e) => e.source === 'extra').length, total: entries.length, added: added.length, skipped: skipped.length, invite: invite.length, dropped: dropped.length, prevActive },
    added: added.map(pub),
    skipped: skipped.map((e) => e.name),
    invite,
    dropped
  };
  if (write) {
    await db.collection(COL).doc(season.id).set({ ...result, inviteSent: {} }, { merge: true });
  }
  return result;
}

/* ── 결과 메일(커밍쏜) ── */
function reportText(r) {
  if (r.stopped) return `${r.cohort} 기수 명단 자동 반영을 멈췄습니다.\n\n사유: ${r.stopped}\n\n앱 명단은 그대로입니다. 운영진 화면 [명단 관리]에서 미리보기를 눌러 확인하거나, 예전처럼 엑셀을 올려 주세요.`;
  const L = [];
  const c = r.counts;
  L.push(`${U.longLabel(r.cohort)} 시작 『${r.book || ''}』 — 앱 명단 ${r.write ? '자동 반영 완료' : '미리보기'}`);
  L.push('');
  L.push(`■ 이번 기수 멤버 ${c.total}명 (래피드 ${c.payers} + 예외 ${c.extras})`);
  L.push(`   새로 넣음 ${c.added}명 · 이미 있어서 건너뜀 ${c.skipped}명`);
  L.push('');
  L.push(`■ 단톡방에서 내보낼 분 (지난 기수에 있었는데 이번 기수 결제 없음) ${r.dropped.length}명`);
  r.dropped.forEach((x) => L.push(`- ${x.name} · ${x.why}`));
  if (!r.dropped.length) L.push('- 없음');
  L.push('');
  L.push(`■ 단톡방 초대 문자 받을 분 (새로 오신 분, 09시 발송) ${r.invite.length}명`);
  L.push(r.invite.length ? r.invite.map((x) => `${x.name}(${x.phone.slice(-4)})`).join(', ') : '- 없음');
  L.push('');
  const fromPayer = r.added.filter((x) => x.payer);
  if (fromPayer.length) { L.push(`■ 결제자와 이름이 다른 분: ${fromPayer.map((x) => `${x.name}(결제자 ${x.payer})`).join(', ')}`); L.push(''); }
  const cont = r.added.filter((x) => x.streak >= 2);
  L.push(`■ 연속 참여(🔥) ${cont.length}명`);
  L.push('');
  L.push('예외 참여자(쿠폰·해외 이체)나 결제자 이름이 다른 분은 운영진 화면 [명단 관리] → 「명단 자동 반영」에서 고칠 수 있어요.');
  return L.join('\n');
}

/* ── 09시 단톡방 초대 문자 ── */
function inviteText(name, season, env = process.env) {
  const url = String(env.CHAT_INVITE_URL || '').trim();
  const code = String(env.CHAT_INVITE_CODE || '').trim();
  return [
    `안녕하세요 ${name}님 퍼스널메이커스입니다.`,
    '',
    '독서멤버십에 참여하시는 여러분을 진심으로 환영합니다.',
    '',
    `${U.shortLabel(season.startDate)} 오늘부터 바로 [${season.book.name}] 기반으로 퍼메스 멤버십 1일차가 진행될 예정입니다. 지금 바로 서둘러 입장해주세요!`,
    '',
    '* 입장 후 본인 확인을 위해 실명으로 변경부탁드립니다.',
    '',
    '[퍼메스 독서 멤버십 단톡방 입장하기]',
    url,
    ...(code ? [`코드 : ${code}`] : [])
  ].join('\n');
}

/** 오늘이 기수 시작일이고, 00:30 반영 기록이 있으면 아직 안 보낸 분에게만 보낸다(두 번 돌아도 한 번만). */
async function sendInvites({ db, nowMs = Date.now(), env = process.env, sendSms }) {
  const C = kstDate(nowMs);
  const season = seasonStartingOn(C);
  if (!season) return { skipped: '오늘 시작하는 시즌 없음' };
  const settings = await loadSettings(db);
  if (!settings.invite) return { skipped: '운영진 화면에서 초대 문자를 꺼 둠' };
  if (!String(env.CHAT_INVITE_URL || '').trim()) return { skipped: 'CHAT_INVITE_URL 환경 변수가 없어 보내지 않음', warn: true };
  const ref = db.collection(COL).doc(season.id);
  const run = await ref.get();
  if (!run.exists || run.data().cohort !== C || !run.data().write) return { skipped: '00:30 명단 반영 기록이 없어 보내지 않음', warn: true };
  const list = run.data().invite || [];
  let sent = 0, failed = 0;
  const errors = [];
  for (const m of list) {
    const phone = digits(m.phone);
    if (phone.length < 10) continue;
    let mine = false;
    await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      const box = (cur.data() && cur.data().inviteSent) || {};
      const p = box[phone];
      if (p && (p.status === 'sent' || (p.status === 'sending' && nowMs - Date.parse(p.at) < 20 * 60000))) return;
      mine = true;
      tx.set(ref, { inviteSent: { ...box, [phone]: { status: 'sending', at: new Date(nowMs).toISOString(), name: m.name } } }, { merge: true });
    });
    if (!mine) continue;
    let status = 'sent', error = '';
    try { await sendSms({ to: phone, subject: '퍼메스 독서 멤버십 단톡방 입장 안내', text: inviteText(m.name, season, env) }); sent++; }
    catch (e) { status = 'failed'; error = e.message; failed++; errors.push(`${m.name}: ${e.message}`); }
    await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      const box = (cur.data() && cur.data().inviteSent) || {};
      tx.set(ref, { inviteSent: { ...box, [phone]: { status, at: new Date().toISOString(), name: m.name, ...(error ? { error } : {}) } } }, { merge: true });
    });
  }
  return { cohort: C, total: list.length, sent, failed, errors };
}

module.exports = {
  kstDate, seasonStartingOn, prevSeasonOf, nextCohortDate,
  cleanSettings, loadSettings, saveSettings, fetchPayers, buildEntries, syncRoster, reportText, inviteText, sendInvites,
  OWNER_EMAIL: 'comingssoni@gmail.com'
};
