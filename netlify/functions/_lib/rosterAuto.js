/* 🗓 이번 기수 명단 자동 반영 — 앱 쪽 보조 규칙 (커밍쏜 확정 2026-11-21)
 *
 * 흐름: 문자 서버(latpeed-notify, 래피드 결제 알림을 다 받는 서버)가
 *   ① 모집 기간(18~21일) 결제·갱신·환불이 생길 때마다(15분 안) 이번 기수 명단 전체를 roster-import로 보내고
 *   ② 21일 00:30에 한 번 더 전체를 맞춘 뒤, 빠진 분(단톡방 정리용)을 커밍쏜에게 메일로 보낸다.
 * 앱에는 비밀값이 없다(문자 서버의 토큰은 SHA-256만 CS.COMMON.rosterImportSha256에).
 *
 * 여기서 하는 일(roster-import가 받을 때마다):
 *   - 결제자 → 참여자 이름 바꾸기(가족 대리결제) · 예외 참여자(쿠폰·해외 이체) 더하기 — Firestore rosterAuto/settings,
 *     운영진 화면 [명단 관리] 「명단 자동 반영」에서 편집. 개인정보라 저장소(공개)에는 두지 않는다.
 *   - 시작 전 환불(status 'out')된 분: 래피드로 들어온 사람(source latpeed)만 '아웃'으로 바꾼다. 지우지 않는다(운영진이 되돌릴 수 있게).
 *     예외 참여자·운영진이 직접 넣은 사람은 건드리지 않는다. 시즌이 시작된 뒤(시작일 다음 날부터)에는 아웃 처리하지 않는다.
 *   - 받을 때마다 rosterAuto/{시즌} 에 기록(운영진 화면에서 확인). */
const { U } = require('./appLogic');
const { nameKey, emailKey } = require('./streak');

const COL = 'rosterAuto';
const digits = (s) => String(s || '').replace(/[^0-9]/g, '');
const colFor = (cfg, name) => (cfg.dataPrefix ? `${cfg.dataPrefix}_${name}` : name);

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

/** 결제자 이름을 참여자 이름으로 바꾼다. 결제자는 이름 또는 전화번호(10자리 이상)로 적는다 */
function applyAliases(rows, settings) {
  return rows.map((r) => {
    const a = settings.aliases.find((x) => {
      const d = digits(x.payer);
      return d.length >= 10 ? d === digits(r.phone) : nameKey(x.payer) === nameKey(r.name);
    });
    return a ? { ...r, name: a.name, payer: r.name } : r;
  });
}

/** 연락처 없는 예외 참여자: 이름이 아직 없으면 이름만으로 넣는다(연락처가 있으면 importRoster가 처리) */
async function addNameOnly(db, cfg, extras, { dryRun, now }) {
  const col = db.collection(colFor(cfg, 'participants'));
  const names = new Set((await col.get()).docs.map((d) => nameKey(d.data().nickname)));
  const added = [];
  for (const x of extras) {
    if (names.has(nameKey(x.name))) continue;
    names.add(nameKey(x.name));
    added.push(x.name);
    if (!dryRun) {
      await col.doc('ex_' + Buffer.from(nameKey(x.name)).toString('hex').slice(0, 24)).set({
        nickname: x.name, email: '', phone: '', kakaoJoined: '', status: 'active', joinDate: cfg.startDate,
        outDate: null, exemptDates: [], note: '예외 참여(자동 반영)', source: 'extra', seasonStreak: 1, createdAt: now
      });
    }
  }
  return added;
}

/** 시작 전 환불된 분 → 아웃. 래피드로 들어온 사람만, 이번 묶음에 결제자로 다시 들어온 사람은 제외.
 *  graceEnd(결제 실패 유예가 끝나 확정, 시작일+3일까지): 예외 참여자만 빼고 누구든 — 인증 기록이 없으면 명단에서 지우고(알림 메일 목록도),
 *  인증 기록이 있으면 아웃으로 둔다(기록 보존). */
async function markOut(db, cfg, outRows, keepRows, { dryRun, today, now, graceEnd = false }) {
  if (!outRows.length) return [];
  const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  if (graceEnd ? today > addDays(cfg.startDate, 3) : today > cfg.startDate) return [];
  const col = db.collection(colFor(cfg, 'participants'));
  const docs = (await col.get()).docs.map((d) => Object.assign({ id: d.id }, d.data()));
  const keep = new Set(keepRows.flatMap((r) => [emailKey(r.email), digits(r.phone)]).filter(Boolean));
  const out = [];
  for (const r of outRows) {
    const em = emailKey(r.email); const ph = digits(r.phone);
    if ((em && keep.has(em)) || (ph && keep.has(ph))) continue;
    const p = docs.find((d) => (graceEnd ? d.source !== 'extra' : d.source === 'latpeed') && d.status !== 'out'
      && ((em && emailKey(d.email) === em) || (ph && digits(d.phone) === ph) || (graceEnd && nameKey(d.nickname) === nameKey(r.name) && !em && !ph)));
    if (!p) continue;
    out.push(p.nickname);
    p.status = 'out';
    if (dryRun) continue;
    if (graceEnd) {
      const subs = await db.collection(colFor(cfg, 'submissions')).where('participantId', '==', p.id).get();
      if (!subs.docs.length) {
        await col.doc(p.id).delete();
        const mails = await db.collection(colFor(cfg, 'notifyEmails')).get();
        for (const m of mails.docs) if (p.email && emailKey(m.data().email) === emailKey(p.email)) await db.collection(colFor(cfg, 'notifyEmails')).doc(m.id).delete();
        continue;
      }
      await col.doc(p.id).set({ status: 'out', outDate: today, note: `결제 실패 확정(래피드) ${now.slice(0, 10)}` }, { merge: true });
      continue;
    }
    await col.doc(p.id).set({ status: 'out', outDate: cfg.startDate, note: `시작 전 결제 취소·종료(래피드) ${now.slice(0, 10)}` }, { merge: true });
  }
  return out;
}

/** 받을 때마다 남기는 기록 — 운영진 화면에서 본다 */
async function logRun(db, cfg, r, { final, now }) {
  const ref = db.collection(COL).doc(cfg.seasonId);
  const snap = await ref.get();
  const prev = snap.exists ? snap.data() : {};
  const runs = [{ at: now, final: !!final, received: r.received, added: r.added.map((a) => a.nickname), filled: r.filled, outed: r.outed, total: r.total }]
    .concat(prev.runs || []).slice(0, 30);
  await ref.set({ season: cfg.seasonId, book: cfg.book && cfg.book.name, lastAt: now, lastFinalAt: final ? now : (prev.lastFinalAt || null), runs });
}

module.exports = { cleanSettings, loadSettings, saveSettings, applyAliases, addNameOnly, markOut, logRun, COL };
