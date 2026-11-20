/* 예약 함수 — 매달 21일 00:30(KST) = 20일 15:30(UTC). 이번 기수 멤버를 앱 명단에 넣고 결과를 커밍쏜에게 메일로.
 * 규칙·안전장치는 _lib/rosterAuto.js 맨 위 설명. 21일 시작 시즌이 없으면 아무것도 하지 않는다. */
const { getDb } = require('./_lib/firebaseAdmin');
const { sendMail } = require('./_lib/mailer');
const RA = require('./_lib/rosterAuto');

exports.handler = async () => {
  const C = RA.kstDate(Date.now());
  if (!RA.seasonStartingOn(C)) return { statusCode: 200, body: JSON.stringify({ skipped: `${C} 시작 시즌 없음` }) };
  let r;
  try {
    r = await RA.syncRoster({ db: getDb(), C, write: true });
  } catch (err) {
    console.error('[roster-auto-sync] 실패', err);
    r = { cohort: C, stopped: `오류: ${err.message}` };
  }
  console.log('[roster-auto-sync]', JSON.stringify(r.counts || {}), r.stopped || '');
  try {
    await sendMail({ fromName: '퍼메스 독서 멤버십', to: RA.OWNER_EMAIL,
      subject: r.stopped ? `[명단 자동 반영 멈춤] ${C} 기수` : `[명단 자동 반영] ${C} 기수 ${r.counts.total}명 · 내보낼 분 ${r.dropped.length}명 · 초대 ${r.invite.length}명`,
      text: RA.reportText(r) });
  } catch (e) { console.error('[roster-auto-sync] 결과 메일 실패', e.message); }
  return { statusCode: 200, body: JSON.stringify({ ok: !r.stopped }) };
};
