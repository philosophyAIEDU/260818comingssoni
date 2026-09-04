/* 매일 자정 직후(KST) 자동 실행되는 예약 함수 — netlify.toml의 schedule 설정으로 트리거된다.
 * 누적 미인증이 정확히 5회(CONFIG.autoWarnThreshold)가 된 참여자에게, 1회만 더 미인증되면
 * 킥아웃 대상이 될 수 있다는 안내를 이메일·문자(솔라피)로 자동으로 보낸다. 이미 보낸 사람에게는
 * 중복 발송하지 않는다(_lib/missed5Warning.js의 warned5At 기록 참고). */
const { runMissed5Warning } = require('./_lib/missed5Warning');

exports.handler = async () => {
  try {
    const result = await runMissed5Warning();
    console.log(`[send-missed5-warning] 대상 ${result.candidates}명 중 이메일 ${result.sentEmail}건, ` +
      `문자 ${result.sentSms}건 발송, 연락처 없음 ${result.skippedNoContact}건, 실패 ${result.failed}건`);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error('[send-missed5-warning] 실행 실패', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
