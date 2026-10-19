/* 🎁 정리본 예약 발송 — 매시 정각(UTC) 자동 실행(netlify.toml schedule).
 *
 * 시즌마다(정리본 기준 giftMissLimit이 있는 시즌만) 아래 둘 중 하나가 있으면, 예약 시각이 지났고 그 시즌의
 * 인증 기간이 끝났을 때 그 시즌 대상자 전원에게 한 번 보낸다.
 *   1) 운영진 화면 [이 시각에 예약하기]로 저장한 meta/app.giftSchedule (status:'scheduled')
 *   2) js/config.js 시즌 설정의 giftMail { sendAt(KST), link, subject, body } — link가 채워져 있을 때만
 *      (운영진 화면 예약이 있으면 그쪽이 우선. 예약을 취소하면 status:'cancelled'라 둘 다 안 보낸다)
 * 다음 시즌이 이미 켜진 뒤여도 withSeason으로 그 시즌 명단·기록·날짜 기준으로 계산한다.
 * 보내기 전에 트랜잭션으로 status를 'sending'으로 잡아 두어, 겹쳐 실행돼도 두 번 보내지 않는다. */
const { U, withSeason, collectionName } = require('./_lib/appLogic');
const { runGiftMail } = require('./_lib/giftMail');
const { getDb } = require('./_lib/firebaseAdmin');

const KST = '+09:00';

/** 이 시즌에 지금 보낼 예약이 있으면 'sending'으로 잡고 그 예약을 돌려준다 */
async function claimDue(cfg) {
  const ref = getDb().collection(collectionName('meta')).doc('app');
  return getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    let sch = (snap.exists && snap.data().giftSchedule) || null;
    if (!sch) {
      const g = cfg.giftMail;
      if (!g || !/^https?:\/\//.test(String(g.link || '')) || !g.sendAt) return null;
      sch = { link: g.link, subject: g.subject || '', body: g.body || '', at: new Date(g.sendAt + ':00' + KST).toISOString(),
        seasonId: cfg.seasonId, source: 'config' };
    } else if (sch.status !== 'scheduled') {
      return null; // 이미 보냄·보내는 중·실패·취소
    }
    if (sch.seasonId && sch.seasonId !== cfg.seasonId) return null;
    if (Date.now() < Date.parse(sch.at)) return null;
    // 인증 기간이 끝나야 누락 횟수가 확정된다 — 그 전이면 다음 정각에 다시 본다
    if (U.today() <= cfg.endDate) return null;
    const claimed = Object.assign({}, sch, { status: 'sending', startedAt: U.nowStamp() });
    tx.set(ref, { giftSchedule: claimed }, { merge: true });
    return { ref, sch: claimed };
  });
}

exports.handler = async () => {
  const results = [];
  for (const season of global.CS.SEASONS) {
    if (!season.giftMissLimit) continue;
    try {
      await withSeason(season.id, async (cfg) => {
        const due = await claimDue(cfg);
        if (!due) return;
        const { ref, sch } = due;
        try {
          const r = await runGiftMail({ link: sch.link, subject: sch.subject, body: sch.body, resend: false, by: '예약 발송' });
          await ref.set({ giftSchedule: Object.assign({}, sch, {
            status: 'sent', doneAt: U.nowStamp(), sent: r.sent, eligible: r.eligible, failed: r.failed
          }) }, { merge: true });
          console.log(`[send-gift-scheduled] ${cfg.seasonId} 대상 ${r.eligible}명 중 ${r.sent}건 발송, 실패 ${r.failed}건`);
          results.push(Object.assign({ season: cfg.seasonId }, r));
        } catch (err) {
          await ref.set({ giftSchedule: Object.assign({}, sch, { status: 'failed', error: err.message, doneAt: U.nowStamp() }) }, { merge: true });
          throw err;
        }
      });
    } catch (err) {
      console.error(`[send-gift-scheduled] ${season.id} 실행 실패`, err);
      results.push({ season: season.id, error: err.message });
    }
  }
  return { statusCode: 200, body: JSON.stringify(results.length ? results : 'nothing due') };
};
