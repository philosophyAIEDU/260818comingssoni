/* 운영진 화면([알림 메일] 탭 → 특정 대상 검색 후 "메일 보내기" 버튼)에서 호출하는 함수.
 * 요청 본문: { email, subject, body }
 * email은 notifyEmails 컬렉션에 이미 등록된 주소여야 발송됩니다(임의 주소 오발송 방지). */
const { sendOneOffEmail } = require('./_lib/notify');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: '요청 본문이 올바른 JSON이 아닙니다.' }) };
  }

  try {
    const result = await sendOneOffEmail(payload);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error('[send-custom-email] 발송 실패', err);
    return { statusCode: 400, body: JSON.stringify({ error: err.message }) };
  }
};
