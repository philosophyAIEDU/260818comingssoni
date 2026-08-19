/* 운영진 화면([알림 메일] 탭 → "지금 테스트 발송" 버튼)에서 수동으로 호출하는 함수.
 * send-daily-reminder.js 와 동일한 로직을 즉시 1회 실행합니다. */
const { runNotification } = require('./_lib/notify');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const result = await runNotification();
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error('[send-daily-reminder-test] 발송 실패', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
