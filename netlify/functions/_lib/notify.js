/* 인증 알림 메일 발송 공통 로직 (지메일 SMTP 사용 — 별도 발송 서비스 비용 없음)
 *
 * send-daily-reminder.js(매일 밤 22시 예약 실행),
 * send-daily-reminder-test.js(운영진 화면의 "지금 테스트 발송" 버튼),
 * send-custom-email.js(운영진 화면의 "특정 대상에게 1회성 안내 메일 보내기")가 함께 사용합니다.
 *
 * 필요한 환경 변수 (Netlify 사이트 설정 → Environment variables)
 *   GMAIL_USER                  발신용 지메일 주소. 예) yourname@gmail.com
 *   GMAIL_APP_PASSWORD          구글 계정의 "앱 비밀번호"(App Password) 16자리
 *                                (2단계 인증을 켠 뒤 https://myaccount.google.com/apppasswords 에서 발급)
 *   FIREBASE_SERVICE_ACCOUNT_KEY  Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 →
 *                                "새 비공개 키 생성"으로 받은 JSON 파일의 내용을 그대로
 *                                (한 줄로) 붙여넣습니다. Firestore를 서버(Admin SDK)
 *                                권한으로 읽고 쓰기 위해 필요합니다 — README 참고.
 *
 * 지메일 개인 계정은 하루 최대 약 500통(수신자 합산 기준)까지 무료로 보낼 수 있어
 * 이 정도 규모의 챌린지에는 비용이 들지 않습니다.
 *
 * 필요하면 아래 두 값도 js/config.js 의 CS.CONFIG 와 맞춰 바꿔주세요.
 */
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');

// js/config.js 의 CS.CONFIG.title / appUrl / startDate / endDate / timezone 과 동일해야 합니다.
const CHALLENGE_TITLE = '퍼스널메이커스 독서 챌린지';
const APP_URL = 'https://comingssoni.netlify.app/';
const START_DATE = '2026-08-24';
const END_DATE = '2026-09-20'; // 챌린지 종료일(포함) — 종료일 다음 날부터는 발송하지 않음
const TIMEZONE = 'Asia/Seoul';

/** Firebase Admin SDK를 서비스 계정으로 초기화하고 Firestore 클라이언트를 반환한다.
 *  (이전에는 API 키만 붙여 Firestore REST를 "익명"으로 호출했는데, 그 방식은 프로젝트
 *  자체 할당량과 별개로 훨씬 낮은 "인증 안 된 요청" 한도에 걸려 429가 자주 났다. 서비스
 *  계정으로 진짜 인증된 요청을 보내면 이 문제가 없다.) 여러 함수 호출에서 재사용하도록
 *  모듈 스코프에 한 번만 초기화해 둔다(Netlify Functions는 같은 컨테이너가 재사용될 때
 *  이 캐시가 유지된다). */
let db = null;
function getDb() {
  if (db) return db;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_KEY 환경 변수가 설정되어 있지 않습니다. Firebase 콘솔 → 프로젝트 설정 → ' +
      '서비스 계정에서 새 비공개 키를 발급받아 Netlify 환경 변수로 등록해 주세요. (README 참고)');
  }
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_KEY 값이 올바른 JSON이 아닙니다. Firebase 콘솔에서 받은 키 파일의 내용을 ' +
      '그대로 붙여넣었는지 확인해 주세요.');
  }
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  db = admin.firestore();
  return db;
}

/** 챌린지 기준 시간대(KST)의 오늘 날짜 (YYYY-MM-DD). js/utils.js today()와 동일한 방식. */
function todayInChallengeTz() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const p = {};
  for (const { type, value } of fmt.formatToParts(new Date())) p[type] = value;
  return `${p.year}-${p.month}-${p.day}`;
}

/** notifyEmails 컬렉션을 읽는다. { name, email } 목록을 반환한다. */
async function fetchNotifyEmails() {
  const snap = await getDb().collection('notifyEmails').get();
  const list = snap.docs
    .map((doc) => {
      const d = doc.data();
      return d.email ? { name: d.name || '', email: d.email } : null;
    })
    .filter(Boolean);

  // 같은 주소가 목록에 중복 등록돼 있으면 한 사람이 메일을 여러 통 받게 되므로,
  // 실제 발송 전에 주소 기준으로 한 번 더 걸러낸다(대소문자 구분 없이).
  const seen = new Set();
  return list.filter((r) => {
    const key = r.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 운영진이 관리자 화면([알림 메일] 탭)에서 아직 저장한 적 없을 때 쓰이는 기본 제목·본문.
// admin.js 의 defaultNotifySubject()/defaultNotifyBody() 와 내용을 맞춰 주세요.
function defaultSubject() {
  return `[${CHALLENGE_TITLE}] 오늘 인증하셨나요? 📖`;
}
function defaultBody() {
  return [
    '안녕하세요! 오늘 밤 24시까지 독서 인증을 잊지 않으셨는지 확인해 주세요.',
    '마감은 24시 정각이며 유예 시간은 없습니다.',
    '',
    '인증하러 가기 → {{APP_URL}}',
    '',
    '오늘도 함께 읽어주셔서 감사합니다. 🙌',
    '',
    '※ 이 알림을 더 이상 받고 싶지 않으시면 운영진에게 말씀해 주세요. 운영진 페이지의 [알림 메일] 탭에서 목록에서 바로 삭제할 수 있습니다.'
  ].join('\n');
}

/** meta/app 문서에 저장된 운영진 커스텀 제목·본문을 읽는다.
 *  저장한 적이 없으면 null을 반환하고, 이 경우 호출부에서 기본값을 사용한다. */
async function fetchNotifyTemplate() {
  const doc = await getDb().doc('meta/app').get();
  if (!doc.exists) return null;
  const d = doc.data();
  return (d.notifySubject && d.notifyBody) ? { subject: d.notifySubject, body: d.notifyBody } : null;
}

/** template({subject,body}|null)으로 메일 1통 분을 만든다. */
function buildEmail(template) {
  const subject = (template && template.subject) || defaultSubject();
  const rawBody = (template && template.body) || defaultBody();
  const text = rawBody.split('{{APP_URL}}').join(APP_URL);
  const html = text
    .split('\n')
    .map((line) => (line.includes(APP_URL)
      ? line.replace(APP_URL, `<a href="${APP_URL}">${APP_URL}</a>`)
      : (line || '&nbsp;'))).map((l) => `<p>${l}</p>`)
    .join('\n');
  return { subject, text, html };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** GMAIL_USER / GMAIL_APP_PASSWORD 환경 변수를 확인하고 지메일 SMTP 전송기를 만든다. */
function getTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD 환경 변수가 설정되어 있지 않습니다.');
  }
  return { transporter: nodemailer.createTransport({ service: 'gmail', auth: { user, pass } }), user };
}

/** 지메일 SMTP로 등록된 수신자 전원에게 메일을 한 통씩 발송한다. */
async function sendViaGmail(recipients) {
  const { transporter, user } = getTransporter();
  if (!recipients.length) return { sent: 0, failed: 0 };

  const template = await fetchNotifyTemplate();

  let sent = 0;
  const failures = [];
  for (const r of recipients) {
    const { subject, text, html } = buildEmail(template);
    try {
      await transporter.sendMail({
        from: `"${CHALLENGE_TITLE}" <${user}>`,
        to: r.email,
        subject,
        text,
        html
      });
      sent++;
    } catch (err) {
      failures.push({ email: r.email, error: err.message });
    }
    await sleep(300); // 지메일 발송 속도 제한을 배려한 짧은 간격
  }
  return { sent, failed: failures.length, failures };
}

/** meta/app 문서의 notifyLastSentDate 필드에 오늘 날짜(KST)를 기록한다.
 *  같은 날 예약 함수가 중복 실행되더라도(Netlify 재시도 등) 두 번째 실행은 이 값을 보고 건너뛴다. */
async function markNotifySentToday(dateStr) {
  try {
    await getDb().doc('meta/app').set({ notifyLastSentDate: dateStr }, { merge: true });
  } catch (err) {
    // 기록 실패는 발송 자체를 실패시키지 않는다 — 다음 실행 때 다시 시도된다.
    console.error('[notify] notifyLastSentDate 기록 실패', err);
  }
}

/** 매일 밤 예약 발송(runNotification)을 실행해도 되는지 판단한다.
 *  - 챌린지 기간(START_DATE ~ END_DATE, 양 끝 포함) 밖이면 보내지 않는다.
 *  - 오늘 이미 한 번 보냈으면(메타 문서 기록 기준) 다시 보내지 않는다 — 예약 함수가
 *    같은 날 두 번 실행되어도(재시도, 배포 직후 중복 트리거 등) 중복 발송을 막는다. */
async function shouldRunScheduledReminder() {
  const today = todayInChallengeTz();
  if (today < START_DATE) {
    return { run: false, today, reason: `아직 챌린지 시작일(${START_DATE}) 전입니다.` };
  }
  if (today > END_DATE) {
    return { run: false, today, reason: `챌린지 종료일(${END_DATE})이 지났습니다.` };
  }
  const lastSent = await fetchNotifyLastSentDate();
  if (lastSent === today) {
    return { run: false, today, reason: '오늘은 이미 알림 메일을 발송했습니다.' };
  }
  return { run: true, today };
}

async function fetchNotifyLastSentDate() {
  const doc = await getDb().doc('meta/app').get();
  if (!doc.exists) return null;
  return doc.data().notifyLastSentDate || null;
}

async function runNotification() {
  const recipients = await fetchNotifyEmails();
  return sendViaGmail(recipients);
}

/** 매일 밤 예약 함수(send-daily-reminder.js) 전용 진입점.
 *  시작일 이전이거나 오늘 이미 발송했으면 건너뛰고, 아니면 발송 후 발송 기록을 남긴다. */
async function runScheduledReminder() {
  const check = await shouldRunScheduledReminder();
  if (!check.run) {
    return { sent: 0, skipped: true, reason: check.reason };
  }
  const result = await runNotification();
  await markNotifySentToday(check.today);
  return Object.assign({ skipped: false }, result);
}

/** 운영진이 [알림 메일] 탭에서 이름으로 검색해 고른 사람 한 명에게, 직접 적은 제목·본문으로
 *  메일 1통을 보낸다. 매일 밤 자동 발송되는 인증 알림과는 별개의 1회성 안내용.
 *  임의의 주소로 발송되는 것을 막기 위해, notifyEmails 컬렉션에 이미 등록된 주소로만 보낼 수 있다. */
async function sendOneOffEmail({ email, subject, body }) {
  const to = (email || '').trim();
  const cleanSubject = (subject || '').trim();
  const cleanBody = (body || '').trim();
  if (!to || !cleanSubject || !cleanBody) {
    throw new Error('받는 사람, 제목, 본문을 모두 입력해 주세요.');
  }

  const recipients = await fetchNotifyEmails();
  const known = recipients.find((r) => r.email.toLowerCase() === to.toLowerCase());
  if (!known) {
    throw new Error('등록된 메일 주소 목록에서 찾을 수 없는 수신자입니다. [알림 메일] 탭에서 먼저 등록해 주세요.');
  }

  const { transporter, user } = getTransporter();
  const html = cleanBody.split('\n').map((line) => `<p>${line || '&nbsp;'}</p>`).join('\n');
  await transporter.sendMail({
    from: `"${CHALLENGE_TITLE}" <${user}>`,
    to: known.email,
    subject: cleanSubject,
    text: cleanBody,
    html
  });
  return { sent: 1, email: known.email, name: known.name };
}

module.exports = {
  runNotification, runScheduledReminder, fetchNotifyEmails, buildEmail, fetchNotifyTemplate, sendOneOffEmail
};
