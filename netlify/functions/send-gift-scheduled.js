/* 🎁 정리본 예약 발송 — 매시 정각(UTC) 자동 실행(netlify.toml schedule).
 *
 * 운영진 화면 [선물 대상자 › 정리본 메일 보내기]에서 링크를 넣고 [예약하기]를 누르면
 * meta/app.giftSchedule = { link, subject, body, at(UTC ISO), seasonId, status:'scheduled' } 가 저장된다.
 * 이 함수는 매시간 그것만 확인해서, 예약 시각이 지났고 시즌 인증 기간이 끝났으면 한 번 보낸다.
 *   기본 예약 시각은 시즌이 끝난 뒤 월요일 09:00(KST) = 월요일 00:00(UTC) — 이 함수가 도는 정각과 맞다.
 * 보내기 전에 status를 'sending'으로 바꿔 두어, 겹쳐 실행돼도 두 번 보내지 않는다. */
const { CONFIG, U } = require('./_lib/appLogic');
const { runGiftMail, metaDoc } = require('./_lib/giftMail');
const { getDb } = require('./_lib/firebaseAdmin');

exports.handler = async () => {
  try {
    if (!CONFIG.giftMissLimit) return { statusCode: 200, body: 'no gift in this season' };
    const ref = metaDoc();
    const claimed = await getDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const sch = (snap.exists && snap.data().giftSchedule) || null;
      if (!sch || sch.status !== 'scheduled') return null;
      if (sch.seasonId && sch.seasonId !== CONFIG.seasonId) return null;
      if (Date.now() < Date.parse(sch.at)) return null;
      // 인증 기간이 끝나야 누락 횟수가 확정된다 — 그 전이면 다음 정각에 다시 본다
      if (U.today() <= CONFIG.endDate) return null;
      tx.set(ref, { giftSchedule: Object.assign({}, sch, { status: 'sending', startedAt: U.nowStamp() }) }, { merge: true });
      return sch;
    });
    if (!claimed) return { statusCode: 200, body: 'nothing due' };

    let result;
    try {
      result = await runGiftMail({
        link: claimed.link, subject: claimed.subject, body: claimed.body, resend: false, by: '예약 발송'
      });
    } catch (err) {
      await ref.set({ giftSchedule: Object.assign({}, claimed, { status: 'failed', error: err.message, doneAt: U.nowStamp() }) }, { merge: true });
      throw err;
    }
    await ref.set({ giftSchedule: Object.assign({}, claimed, {
      status: 'sent', doneAt: U.nowStamp(), sent: result.sent, eligible: result.eligible, failed: result.failed
    }) }, { merge: true });
    console.log(`[send-gift-scheduled] 대상 ${result.eligible}명 중 ${result.sent}건 발송, 실패 ${result.failed}건`);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error('[send-gift-scheduled] 실행 실패', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
