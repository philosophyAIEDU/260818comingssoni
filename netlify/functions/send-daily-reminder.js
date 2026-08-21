/* 매일 밤 22시(KST) 자동 실행되는 예약 함수 — netlify.toml 의 schedule 설정으로 트리거됩니다.
 * notifyEmails 컬렉션에 등록된 메일 주소로 인증 알림 메일을 발송합니다.
 *
 * runScheduledReminder()가 아래 두 가지를 자동으로 걸러 준다.
 *   1) 챌린지 시작일(CONFIG.startDate) 이전에는 보내지 않음
 *   2) 오늘 이미 한 번 보냈으면(메타 문서 기록 기준) 다시 보내지 않음
 *      — 배포 직후 중복 트리거 등으로 예약 함수가 하루에 두 번 실행돼도 중복 발송을 막는다. */
const { runScheduledReminder } = require('./_lib/notify');

exports.handler = async () => {
  try {
    const result = await runScheduledReminder();
    if (result.skipped) {
      console.log(`[send-daily-reminder] 발송 건너뜀: ${result.reason}`);
    } else {
      console.log(`[send-daily-reminder] 발송 완료: ${result.sent}건`);
    }
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error('[send-daily-reminder] 발송 실패', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
