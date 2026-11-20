/* 🗓 이번 기수 명단 자동 반영 (커밍쏜 요청 2026-11-21 — "내가 손대지 않아도 참여자가 앱에 들어가고 누락 메일이 가게")
 *
 * 매달 21일(기수 시작일) 00:30 KST, 예약 함수 roster-auto-sync 가
 *   ① 문자 서버(latpeed-notify, 래피드 알림을 다 받고 있는 서버)의 미리보기 주소 GET /api/chat?date=C 에서
 *      이번 기수 멤버를 받는다 — 18~20일 결제 완료 + 21일 갱신 예정(구독 중). 결제 실패·해지·종료는 빠진다.
 *      (문자 서버는 읽기만 한다. 고치거나 다시 배포하지 않는다.)
 *   ② 운영진 화면에 적어 둔 결제자 → 참여자 이름(가족 대리결제)과 예외 참여자(쿠폰·해외 이체)를 더해
 *   ③ roster-import 와 같은 규칙(importRoster)으로 이번 시즌 명단·알림 메일 목록에 넣는다
 *      — 이미 있는 사람은 건너뛰고 빈 이메일·전화번호만 채운다. 넣기만 하고 아무도 지우지 않는다.
 *   ④ 커밍쏜에게 결과 메일: 지난 기수엔 있었는데 이번에 빠진 분(사유) = 단톡방 정리용
 * 이메일이 들어가 있으면 매일 21시 미인증 리마인드·누락 5회 안내 메일이 자동으로 간다(문자는 래피드에서).
 *
 * 안전장치: 멤버가 10명 미만이거나 지난 기수의 절반 미만이면 아무것도 쓰지 않고 멈춘 뒤 메일로 알린다.
 * 연결: 주소는 CS.COMMON.latpeedNotifyUrl, 비밀값은 Netlify 환경 변수 LATPEED_NOTIFY_SECRET(= latpeed-notify의 CRON_SECRET).
 * 예외 참여자·결제자 이름은 개인정보라 저장소가 아니라 Firestore rosterAuto/settings 에 둔다(운영진 화면에서 편집). */
const { U } = require('./appLogic');
const { nameKey, emailKey } = require('./streak');
const { importRoster, rosterLists } = require('./rosterImport');

const CS = global.CS;
const COL = 'rosterAuto';
const MIN_MEMBERS = 10;
const OWNER_EMAIL = 'comingssoni@gmail.com';

const digits = (s) => String(s || '').replace(/[^0-9]/g, '');
const kstDate = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
const colFor = (cfg, name) => (cfg.dataPrefix ? `${cfg.dataPrefix}_${name}` : name);

const seasonStartingOn = (date) => {
  const s = CS.SEASONS.find((x) => x.startDate === date);
  return s ? CS.configFor(s.id) : null;
};
/** 오늘 이후(오늘 포함) 가장 가까운 시즌 시작일 — 운영진 미리보기 기본값 */
const nextCohortDate = (nowMs) => CS.SEASONS.map((x) => x.startDate).filter((d) => d >= kstDate(nowMs)).sort()[0] || null;

/* ── 설정: extras [{name,email,phone}] · aliases [{payer,name}] ── */
function cleanSettings(s) {
  const src = s || {};
  const extras = (Array.isArray(src.extras) ? src.extras : []).map((x) => ({
    name: U.normalizeNick(x && x.name), email: emailKey(x && x.email), phone: digits(x && x.phone)
  })).filter((x) => x.name);
  const aliases = (Array.isArray(src.aliases) ? src.aliases : []).map((x) => ({
    payer: U.normalizeNick(x && x.payer), name: U.normalizeNick(x && x.name)
  })).filter((x) => x.payer && x.name);
  return { extras, aliases };
}
async function loadSettings(db) {
  const snap = await db.collection(COL).doc('settings').get();
  return cleanSettings(snap.exists ? snap.data() : {});
}
async function saveSettings(db, s, by) {
  const clean = cleanSettings(s);
  await db.collection(COL).doc('settings').set({ ...clean, updatedAt: new Date().toISOString(), updatedBy: by || '' });
  return clean;
}

/* ── 문자 서버에서 이번 기수 멤버 받기 ──
 * keep·invited·missing·invite = 구독 중(이번 기수 멤버). remove·wait·check = 아님(사유 포함). */
async function fetchPayers(C, { env = process.env, fetchImpl = fetch } = {}) {
  const base = String(env.LATPEED_NOTIFY_URL || CS.COMMON.latpeedNotifyUrl || '').trim().replace(/\/+$/, '');
  const secret = String(env.LATPEED_NOTIFY_SECRET || '').trim();
  if (!base || !secret) throw new Error('Netlify 환경 변수 LATPEED_NOTIFY_SECRET 이 없습니다(문자 서버 latpeed-notify의 CRON_SECRET과 같은 값).');
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
  for (const k of ['remove', 'wait', 'check']) for (const m of pick(k)) notMembers.push({ name: U.normalizeNick(m.name), phone: digits(m.phone), why: m.why || k });
  return { payers: [...byPhone.values()].filter((p) => p.name), notMembers };
}

/** 결제자 → 참여자 이름을 바꾼 래피드 행 + 예외 참여자(연락처가 없을 수 있음) */
function buildRows(payers, settings) {
  const aliasFor = (p) => settings.aliases.find((a) => {
    const d = digits(a.payer);
    return d.length >= 10 ? d === p.phone : nameKey(a.payer) === nameKey(p.name);
  });
  const rows = payers.map((p) => { const a = aliasFor(p); return { name: a ? a.name : p.name, email: p.email, phone: p.phone, status: 'paid', payer: a ? p.name : '' }; });
  const have = new Set(rows.map((r) => nameKey(r.name)));
  const extras = settings.extras.filter((x) => !have.has(nameKey(x.name)));
  return { rows, extras };
}

/** 연락처 없는 예외 참여자: 이름이 없으면 이름만으로 넣는다(연락처가 있으면 importRoster가 처리) */
async function addNameOnly(db, cfg, extras, write) {
  const col = db.collection(colFor(cfg, 'participants'));
  const names = new Set((await col.get()).docs.map((d) => nameKey(d.data().nickname)));
  const added = [];
  for (const x of extras) {
    if (names.has(nameKey(x.name))) continue;
    names.add(nameKey(x.name));
    added.push(x.name);
    if (write) {
      await col.doc('ex_' + Buffer.from(nameKey(x.name)).toString('hex').slice(0, 24)).set({
        nickname: x.name, email: '', phone: '', kakaoJoined: '', status: 'active', joinDate: cfg.startDate,
        outDate: null, exemptDates: [], note: '예외 참여(자동 반영)', source: 'extra', seasonStreak: 1, createdAt: new Date().toISOString()
      });
    }
  }
  return added;
}

/**
 * 기수 C 명단 반영(write=false면 미리보기). 반환: { cohort, season, book, counts, added[], filled[], dropped[], stopped? }
 */
async function syncRoster({ db, C, write, env, fetchImpl, nowMs = Date.now() }) {
  const cfg = seasonStartingOn(C);
  if (!cfg) return { cohort: C, stopped: `${C}에 시작하는 시즌이 js/config.js에 없습니다` };
  const base = { cohort: C, season: cfg.seasonId, book: cfg.book && cfg.book.name, write: !!write, ranAt: new Date(nowMs).toISOString() };
  const settings = await loadSettings(db);
  const { payers, notMembers } = await fetchPayers(C, { env, fetchImpl });

  const at = CS.SEASONS.findIndex((s) => s.id === cfg.seasonId);
  const prev = at > 0 ? CS.configFor(CS.SEASONS[at - 1].id) : null;
  const prevActive = prev ? (await db.collection(colFor(prev, 'participants')).get()).docs.filter((d) => d.data().status !== 'out').length : 0;
  if (payers.length < MIN_MEMBERS || (prevActive && payers.length < prevActive * 0.5)) {
    return { ...base, counts: { payers: payers.length, prevActive }, stopped: `래피드 멤버가 ${payers.length}명뿐이라(지난 기수 ${prevActive}명) 명단을 넣지 않고 멈췄습니다` };
  }

  const { rows, extras } = buildRows(payers, settings);
  const withContact = extras.filter((x) => x.email || x.phone).map((x) => ({ ...x, status: 'paid' }));
  const imp = await importRoster(db, CS, cfg, rows.concat(withContact), { dryRun: !write });
  const nameOnly = await addNameOnly(db, cfg, extras.filter((x) => !x.email && !x.phone), write);

  // 빠진 분(지난 기수엔 있었는데 이번 명단에 없음) — 미리보기면 이번에 넣을 사람까지 넣은 셈으로 계산
  const current = (await db.collection(colFor(cfg, 'participants')).get()).docs.map((d) => d.data()).filter((p) => p.status !== 'out');
  if (!write) {
    rows.concat(extras).forEach((r) => current.push({ nickname: r.name, email: r.email, phone: r.phone }));
  }
  const lists = await rosterLists(db, CS, cfg, current);
  const why = (r) => {
    const hit = notMembers.find((m) => (r.phone && m.phone === r.phone) || nameKey(m.name) === nameKey(r.name));
    return hit ? hit.why : '이번 기수 결제 기록 없음';
  };
  const dropped = lists.dropped.map((r) => ({ name: r.name, email: r.email, phone: r.phone, why: why(r) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  const result = {
    ...base,
    counts: { payers: payers.length, extras: extras.length, added: imp.added.length + nameOnly.length, filled: imp.filled.length, skipped: imp.skipped.length, dropped: dropped.length, total: lists.current.length, prevActive },
    added: imp.added.map((a) => ({ name: a.nickname, streak: a.streak })).concat(nameOnly.map((n) => ({ name: n, streak: 1 }))),
    filled: imp.filled,
    payerNames: rows.filter((r) => r.payer).map((r) => ({ name: r.name, payer: r.payer })),
    dropped
  };
  if (write) await db.collection(COL).doc(cfg.seasonId).set(result);
  return result;
}

/** 커밍쏜에게 보내는 결과 메일 본문 */
function reportText(r) {
  if (r.stopped) return `${r.cohort} 기수 명단 자동 반영을 멈췄습니다.\n\n사유: ${r.stopped}\n\n앱 명단은 그대로입니다. 운영진 화면 [명단 관리] → 「명단 자동 반영」에서 미리보기를 눌러 확인하거나, 예전처럼 엑셀을 올려 주세요.`;
  const c = r.counts;
  const L = [
    `${U.longLabel(r.cohort)} 시작 『${r.book || ''}』 — 앱 명단 ${r.write ? '자동 반영 완료' : '미리보기'}`,
    '',
    `■ 이번 기수 명단 ${c.total}명 (래피드 결제 ${c.payers}명 + 예외 참여 ${c.extras}명)`,
    `   새로 넣음 ${c.added}명 · 빈 이메일·전화 채움 ${c.filled}명 · 이미 있음 ${c.skipped}명`,
    '',
    `■ 단톡방에서 내보낼 분 — 지난 기수엔 있었는데 이번 기수 결제가 없음 ${r.dropped.length}명`,
    ...(r.dropped.length ? r.dropped.map((x) => `- ${x.name}${x.phone ? ` (${x.phone.slice(-4)})` : ''} · ${x.why}`) : ['- 없음']),
    ''
  ];
  if (r.payerNames && r.payerNames.length) L.push(`■ 결제자와 이름이 다른 분: ${r.payerNames.map((x) => `${x.name}(결제자 ${x.payer})`).join(', ')}`, '');
  L.push('이메일이 들어간 분은 매일 21시 미인증 리마인드 메일을 자동으로 받습니다. 단톡방 초대 문자는 래피드에서 보내 주세요.');
  L.push('예외 참여자(쿠폰·해외 이체)·결제자 이름은 운영진 화면 [명단 관리] → 「명단 자동 반영」에서 고칠 수 있어요.');
  return L.join('\n');
}

module.exports = { kstDate, seasonStartingOn, nextCohortDate, cleanSettings, loadSettings, saveSettings, fetchPayers, buildRows, syncRoster, reportText, OWNER_EMAIL };
