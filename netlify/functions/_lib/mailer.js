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
let pooled = null;

function credentials() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      'GMAIL_USER / GMAIL_APP_PASSWORD 환경 변수가 설정되어 있지 않습니다. 지메일 계정의 앱 비밀번호를 ' +
      '발급받아 Netlify 환경 변수로 등록해 주세요. (README 참고)');
  }
  return { user, pass };
}

function getTransporter() {
  if (!transporter) transporter = nodemailer.createTransport({ service: 'gmail', auth: credentials() });
  return transporter;
}

/* 여러 통을 이어 보낼 때(정리본) — 연결 하나를 열어 두고 재사용한다.
 * 한 통마다 새로 연결하면 3초쯤 걸려 함수 제한 시간 안에 두세 통밖에 못 보냈다(2026-10-21).
 * 다 보낸 뒤 closePool()로 닫는다(다음 실행 때 끊긴 연결을 다시 쓰지 않게). */
function getPool() {
  if (!pooled) pooled = nodemailer.createTransport({ service: 'gmail', auth: credentials(), pool: true, maxConnections: 4, maxMessages: 200 });
  return pooled;
}
function closePool() {
  if (pooled) { try { pooled.close(); } catch (e) { /* 이미 닫힘 */ } pooled = null; }
}

/** 본문 줄바꿈을 그대로 <p> 문단으로 바꿔 아주 단순한 HTML 버전도 함께 보낸다. */
function textToHtml(text) {
  return text.split('\n').map((line) => `<p>${line || '&nbsp;'}</p>`).join('\n');
}

/** 제목·본문(text) 그대로 한 통 보낸다. fromName은 발신자 표시 이름(제목 앞 [챌린지명] 등).
 *  replyTo를 주면 받은 사람이 [답장]을 눌렀을 때 그 주소로 간다. */
async function sendMail({ fromName, to, subject, text, replyTo, pool }) {
  const user = process.env.GMAIL_USER;
  await (pool ? getPool() : getTransporter()).sendMail({
    from: `"${fromName}" <${user}>`,
    ...(replyTo ? { replyTo } : {}),
    to,
    subject,
    text,
    html: textToHtml(text)
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { sendMail, sleep, closePool };
