/* 💬 단톡방 초대 문자 — 시즌 시작일, 앱 명단에 들어온 사람에게 한 번씩.
 *
 * 시즌 설정 kakaoInvite: { url, code?, at?: '09:00', until?: '22:00' }
 *   - url이 비어 있으면 아무것도 안 보낸다.
 *   - 시작일 at~until(KST) 사이에만 보낸다(밤 문자 방지). 그 사이에 명단에 새로 들어온 사람도 다음 실행 때 받는다.
 *   - 받은 사람은 invitedAt이 찍혀 다시 안 받는다. 보내기 전에 트랜잭션으로 inviteClaim을 잡아, 겹쳐 실행돼도 한 번만.
 *   - 문안은 CS.COMMON.inviteSms (자리표시자 {{이름}} {{책}} {{링크}} {{코드줄}} {{앱}}).
 * 한 번에 budgetMs만큼만 보내고 남으면 다음 실행(10분 뒤)에 이어서 보낸다. */
const colFor = (cfg, name) => (cfg.dataPrefix ? `${cfg.dataPrefix}_${name}` : name);
const CLAIM_MS = 10 * 60 * 1000;

function inviteText(CS, cfg, p) {
  const k = cfg.kakaoInvite || {};
  const t = CS.COMMON.inviteSms || {};
  const name = String(p.nickname || '').replace(/\(\d{4}\)$/, '');
  const fill = (s) => String(s || '')
    .replaceAll('{{이름}}', name)
    .replaceAll('{{책}}', (cfg.book && cfg.book.name) || '')
    .replaceAll('{{링크}}', k.url || '')
    .replaceAll('{{코드줄}}', k.code ? `\n(입장 코드: ${k.code})` : '')
    .replaceAll('{{앱}}', CS.COMMON.appUrl || '');
  return { subject: fill(t.subject), text: fill(t.body) };
}

/** 지금 보낼 시간인지: 시작일이고 at ≤ 지금 < until */
function inWindow(cfg, nowKST) {
  const k = cfg.kakaoInvite || {};
  if (!/^https?:\/\//.test(String(k.url || ''))) return 'no-url';
  const day = nowKST.slice(0, 10); const hm = nowKST.slice(11, 16);
  if (day !== cfg.startDate) return 'not-start-day';
  if (hm < (k.at || '09:00')) return 'too-early';
  if (hm >= (k.until || '22:00')) return 'too-late';
  return '';
}

async function runSeasonInvite({ db, CS, sendSms, nowKST = CS.seasonNowKST(), budgetMs = 8000, concurrency = 4, dryRun = false }) {
  const cfg = CS.configFor(CS.pickSeason(nowKST).id);
  const why = inWindow(cfg, nowKST);
  if (why) return { season: cfg.seasonId, skipped: why, sent: 0 };
  const pCol = db.collection(colFor(cfg, 'participants'));
  const now = Date.now();
  const todo = (await pCol.get()).docs.map((d) => Object.assign({ id: d.id }, d.data()))
    .filter((p) => p.status !== 'out' && String(p.phone || '').replace(/[^0-9]/g, '').length >= 10
      && !p.invitedAt && !(p.inviteClaim && now - Date.parse(p.inviteClaim) < CLAIM_MS));
  if (dryRun) return { season: cfg.seasonId, dryRun: true, pending: todo.length, sample: todo[0] ? inviteText(CS, cfg, todo[0]) : null };

  const started = Date.now();
  const sent = []; const failed = [];
  const claim = (p) => db.runTransaction(async (tx) => {
    const ref = pCol.doc(p.id);
    const s = await tx.get(ref);
    const d = s.exists ? s.data() : null;
    if (!d || d.invitedAt || (d.inviteClaim && Date.now() - Date.parse(d.inviteClaim) < CLAIM_MS)) return false;
    tx.set(ref, { inviteClaim: new Date().toISOString() }, { merge: true });
    return true;
  });
  let i = 0;
  const worker = async () => {
    while (i < todo.length && Date.now() - started < budgetMs) {
      const p = todo[i++];
      if (!(await claim(p))) continue;
      const { subject, text } = inviteText(CS, cfg, p);
      try {
        await sendSms({ to: p.phone, subject, text });
        await pCol.doc(p.id).set({ invitedAt: new Date().toISOString(), inviteClaim: null, inviteError: null }, { merge: true });
        sent.push(p.nickname);
      } catch (err) {
        await pCol.doc(p.id).set({ inviteClaim: null, inviteError: String(err.message || err).slice(0, 200) }, { merge: true });
        failed.push(p.nickname);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { season: cfg.seasonId, sent: sent.length, failed, remaining: Math.max(0, todo.length - sent.length - failed.length) };
}

module.exports = { runSeasonInvite, inviteText, inWindow };
