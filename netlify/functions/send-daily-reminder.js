/* 매일 밤 22시(KST) 자동 실행되는 예약 함수 — netlify.toml 의 schedule 설정으로 트리거됩니다.
 * notifyEmails 컬렉션에 등록된 메일 주소로 인증 알림 메일을 발송합니다. */
const { runNotification } = require('./_lib/notify');

exports.handler = async () => {
  try {
    const result = await runNotification();
    console.log(`[send-daily-reminder] 발송 완료: ${result.sent}건`);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error('[send-daily-reminder] 발송 실패', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
