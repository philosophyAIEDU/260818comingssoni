/* 예약 함수 — 매달 21일 09:00·09:30(KST) = 21일 00:00·00:30(UTC). 00:30에 새로 들어온 분에게만 단톡방 초대 문자.
 * 사람마다 보냄을 기록해 두 번 보내지 않는다(09:30은 09:00에 실패·누락된 분만 다시 시도). */
const { getDb } = require('./_lib/firebaseAdmin');
const { sendMail } = require('./_lib/mailer');
const { sendSms } = require('./_lib/solapi');
const RA = require('./_lib/rosterAuto');

exports.handler = async () => {
  const C = RA.kstDate(Date.now());
  if (!RA.seasonStartingOn(C)) return { statusCode: 200, body: JSON.stringify({ skipped: `${C} 시작 시즌 없음` }) };
  let r;
  try { r = await RA.sendInvites({ db: getDb(), sendSms }); }
  catch (err) { console.error('[roster-auto-invite] 실패', err); r = { warn: true, skipped: `오류: ${err.message}` }; }
  console.log('[roster-auto-invite]', JSON.stringify(r));
  const kstHour = new Date(Date.now() + 9 * 3600000).getUTCHours();
  const first = kstHour === 9 && new Date().getUTCMinutes() < 20;
  // 메일: 첫 실행(09:00)에는 결과를 늘, 다시 시도(09:30)에는 보낸 것이 있거나 문제가 있을 때만
  if ((r.warn && first) || (!r.skipped && (first || r.sent || r.failed))) {
    const text = r.skipped
      ? `${C} 단톡방 초대 문자를 보내지 않았습니다.\n\n사유: ${r.skipped}\n\n필요하면 래피드 [메시지 관리 → 문자 발송]에서 직접 보내 주세요.`
      : `${C} 단톡방 초대 문자 — 보냄 ${r.sent}명 · 실패 ${r.failed}명 (대상 ${r.total}명)${r.errors.length ? `\n\n실패:\n${r.errors.join('\n')}` : ''}`;
    try { await sendMail({ fromName: '퍼메스 독서 멤버십', to: RA.OWNER_EMAIL, subject: `[단톡방 초대 문자] ${C} ${r.skipped ? '보내지 않음' : `${r.sent}명 발송`}`, text }); }
    catch (e) { console.error('[roster-auto-invite] 결과 메일 실패', e.message); }
  }
  return { statusCode: 200, body: JSON.stringify(r) };
};
