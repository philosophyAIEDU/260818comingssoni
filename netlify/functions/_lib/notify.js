/* 인증 알림 메일 발송 공통 로직
 *
 * send-daily-reminder.js(매일 밤 22시 예약 실행)와
 * send-daily-reminder-test.js(운영진 화면의 "지금 테스트 발송" 버튼)가 함께 사용합니다.
 *
 * 필요한 환경 변수 (Netlify 사이트 설정 → Environment variables)
 *   RESEND_API_KEY   Resend(https://resend.com) API 키
 *   MAIL_FROM        발신자 주소. Resend에 도메인 인증을 마친 주소여야 합니다.
 *                     예) "퍼스널메이커스 독서 챌린지 <noreply@yourdomain.com>"
 *
 * 필요하면 아래 두 값도 js/config.js 의 CS.CONFIG 와 맞춰 바꿔주세요.
 */

// js/config.js 의 CS.FIREBASE_CONFIG.projectId 와 동일해야 합니다.
const FIREBASE_PROJECT_ID = 'comingssoni-e7517';
// js/config.js 의 CS.CONFIG.title / appUrl 과 동일해야 합니다.
const CHALLENGE_TITLE = '퍼스널메이커스 독서 챌린지';
const APP_URL = 'https://comingssoni.netlify.app/';

/** Firestore REST API로 notifyEmails 컬렉션을 읽는다.
 *  (별도 서비스 계정 없이 동작하려면 Firestore 보안 규칙에서 notifyEmails 컬렉션의
 *   읽기를 허용해 두어야 합니다.) */
async function fetchNotifyEmails() {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/notifyEmails`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Firestore 조회 실패 (${res.status}): notifyEmails 컬렉션의 읽기 권한을 확인해 주세요.`);
  }
  const data = await res.json();
  const docs = data.documents || [];
  return docs
    .map((d) => d.fields && d.fields.email && d.fields.email.stringValue)
    .filter(Boolean);
}

function buildEmail() {
  const subject = `[${CHALLENGE_TITLE}] 오늘 인증하셨나요? 📖`;
  const text = [
    '안녕하세요! 오늘 밤 24시까지 독서 인증을 잊지 않으셨는지 확인해 주세요.',
    '마감은 24시 정각이며 유예 시간은 없습니다.',
    '',
    `인증하러 가기 → ${APP_URL}`,
    '',
    '오늘도 함께 읽어주셔서 감사합니다. 🙌',
    '',
    '※ 이 알림을 더 이상 받고 싶지 않으시면 운영진에게 말씀해 주세요. 운영진 페이지의 [알림 메일] 탭에서 목록에서 바로 삭제할 수 있습니다.'
  ].join('\n');
  const html = text
    .split('\n')
    .map((line) => (line.includes(APP_URL)
      ? `<p><a href="${APP_URL}">${APP_URL}</a></p>`
      : `<p>${line || '&nbsp;'}</p>`))
    .join('\n');
  return { subject, text, html };
}

/** Resend API로 발송. bcc 로 넣어 수신자끼리 서로의 메일 주소가 노출되지 않게 한다. */
async function sendViaResend(recipients) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!apiKey || !from) {
    throw new Error('RESEND_API_KEY / MAIL_FROM 환경 변수가 설정되어 있지 않습니다.');
  }
  if (!recipients.length) return { sent: 0 };

  const { subject, text, html } = buildEmail();
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: from,
      bcc: recipients,
      subject,
      text,
      html
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`메일 발송 실패 (${res.status}): ${body}`);
  }
  return { sent: recipients.length };
}

async function runNotification() {
  const recipients = await fetchNotifyEmails();
  return sendViaResend(recipients);
}

module.exports = { runNotification, fetchNotifyEmails, buildEmail };
