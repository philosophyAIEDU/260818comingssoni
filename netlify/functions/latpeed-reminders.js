/* 래피드 멤버십 안내 문자 — 매시 정각(UTC) 자동 실행(netlify.toml schedule).
 * 웹훅이 잡아 둔 문자 중 때가 된 것(해지 D-2·D-1, 결제 실패 다음 날 마지막 안내, 즉시 발송 재시도)을 보낸다.
 * 보내기 직전에 구독 상태를 다시 보고, 그 사이 철회·복구·종료됐으면 보내지 않는다. */
const { getDb } = require('./_lib/firebaseAdmin');
const { sendSms } = require('./_lib/solapi');
const L = require('./_lib/latpeed');

exports.handler = async () => {
  try {
    const db = getDb();
    const now = Date.now();
    const snap = await db.collection(L.SUBS).where('hasPending', '==', true).get();
    let sent = 0, cancelled = 0, failed = 0;
    for (const doc of snap.docs) {
      const res = await L.sendDue(db, doc.ref, now, sendSms);
      res.forEach((r) => { if (r.status === 'sent') sent++; else if (r.status === 'cancelled') cancelled++; else if (r.status === 'failed') failed++; });
    }
    console.log(`[latpeed-reminders] 대기 구독 ${snap.size}건 · 발송 ${sent} · 취소 ${cancelled} · 실패 ${failed}`);
    return { statusCode: 200, body: JSON.stringify({ subs: snap.size, sent, cancelled, failed }) };
  } catch (err) {
    console.error('[latpeed-reminders] 실행 실패', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
