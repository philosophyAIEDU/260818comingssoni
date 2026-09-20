/* 매일 21:00(KST)에 자동 실행되는 예약 함수 — netlify.toml의 schedule 설정으로 트리거된다.
 * 그날 아직 인증하지 않은 참여자에게 마감(24:00)이 세 시간 남았다는 안내 메일을 보낸다.
 * 같은 사람에게 하루 두 번 가지는 않는다(_lib/dailyReminder.js의 remindedAt 기록 참고). */
const { runDailyReminder } = require('./_lib/dailyReminder');

exports.handler = async () => {
  try {
    const result = await runDailyReminder();
    if (result.skipped) {
      console.log(`[send-daily-reminder] 건너뜀(${result.skipped}) · ${result.today}`);
    } else {
      console.log(`[send-daily-reminder] 대상 ${result.candidates}명 중 ${result.sent}건 발송, ` +
        `이메일 없음 ${result.skippedNoEmail}건, 실패 ${result.failed}건`);
    }
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error('[send-daily-reminder] 실행 실패', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
