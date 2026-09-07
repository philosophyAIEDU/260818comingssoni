/* 운영진 화면([알림 메일] 탭의 메일 작성창 → "문자도 함께 보내기")에서 호출하는 함수.
 * 이메일과 달리 문자는 건당 비용이 있어서, 임의 번호로 남용되지 않도록 이 앱에 등록된
 * 참여자 전화번호로만 보낼 수 있게 제한한다 — 예전 send-custom-email.js가 notifyEmails에
 * 등록된 주소로만 보내게 제한했던 것과 같은 취지. */
const { getDb } = require('./_lib/firebaseAdmin');
const { sendSms, normalizePhone } = require('./_lib/solapi');

async function isRegisteredPhone(phone) {
  const clean = normalizePhone(phone);
  if (!clean) return false;
  const snap = await getDb().collection('participants').get();
  return snap.docs.some((d) => normalizePhone(d.data().phone) === clean);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: '요청 형식이 올바르지 않습니다.' }) };
  }
  const { to, subject, text } = payload;
  if (!to || !subject || !text) {
    return { statusCode: 400, body: JSON.stringify({ error: '받는 사람, 제목, 본문을 모두 입력해 주세요.' }) };
  }
  try {
    if (!(await isRegisteredPhone(to))) {
      return { statusCode: 403, body: JSON.stringify({ error: '등록된 참여자 전화번호로만 보낼 수 있습니다.' }) };
    }
    await sendSms({ to, subject, text });
    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  } catch (err) {
    console.error('[send-sms] 발송 실패', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
