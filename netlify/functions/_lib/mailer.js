/* 지메일 SMTP로 메일을 보내는 공통 헬퍼(별도 발송 서비스 비용 없음).
 *
 * 필요한 환경 변수 (Netlify 사이트 설정 → Environment variables)
 *   GMAIL_USER           발신용 지메일 주소. 예) yourname@gmail.com
 *   GMAIL_APP_PASSWORD   구글 계정의 "앱 비밀번호"(App Password) 16자리
 *                        (2단계 인증을 켠 뒤 https://myaccount.google.com/apppasswords 에서 발급)
 *
 * 지메일 개인 계정은 하루 최대 약 500통(수신자 합산 기준)까지 무료로 보낼 수 있어
 * 이 정도 규모의 챌린지에는 비용이 들지 않는다. */
const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      'GMAIL_USER / GMAIL_APP_PASSWORD 환경 변수가 설정되어 있지 않습니다. 지메일 계정의 앱 비밀번호를 ' +
      '발급받아 Netlify 환경 변수로 등록해 주세요. (README 참고)');
  }
  transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  return transporter;
}

/** 본문 줄바꿈을 그대로 <p> 문단으로 바꿔 아주 단순한 HTML 버전도 함께 보낸다. */
function textToHtml(text) {
  return text.split('\n').map((line) => `<p>${line || '&nbsp;'}</p>`).join('\n');
}

/** 제목·본문(text) 그대로 한 통 보낸다. fromName은 발신자 표시 이름(제목 앞 [챌린지명] 등). */
async function sendMail({ fromName, to, subject, text }) {
  const user = process.env.GMAIL_USER;
  await getTransporter().sendMail({
    from: `"${fromName}" <${user}>`,
    to,
    subject,
    text,
    html: textToHtml(text)
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { sendMail, sleep };
