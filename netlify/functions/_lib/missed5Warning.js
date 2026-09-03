/* 누적 미인증이 정확히 CONFIG.autoWarnThreshold(기본 5)회가 된 참여자에게, 1회만 더
 * 미인증되면 킥아웃 대상이 될 수 있다는 점을 정중하게 안내하는 메일을 자동으로 보낸다.
 *
 * netlify.toml의 schedule 설정으로 매일 자정 직후(KST) 실행된다(send-missed5-warning.js).
 * 하루에 여러 번 실행되어도(재시도 등) 이미 경고 메일을 보낸 사람에게는 다시 보내지 않도록
 * participants/{id}.warned5At 필드에 발송한 날짜(KST)를 기록해 둔다 — [명단 관리]에서
 * "복귀" 처리하면 이 값이 지워져서 그 사람은 다음에 다시 5회가 되면 새로 경고를 받을 수 있다.
 */
const { getDb } = require('./firebaseAdmin');
const { sendMail, sleep } = require('./mailer');
const { CONFIG, U, MailTemplates } = require('./appLogic');

async function fetchParticipants() {
  const snap = await getDb().collection('participants').get();
  return snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
}

async function fetchSubmissions() {
  const snap = await getDb().collection('submissions').get();
  return snap.docs.map((d) => d.data());
}

async function fetchNotifyEmails() {
  const snap = await getDb().collection('notifyEmails').get();
  return snap.docs.map((d) => d.data()).filter((d) => d.email);
}

async function fetchMeta() {
  const doc = await getDb().doc('meta/app').get();
  return doc.exists ? doc.data() : {};
}

/** 참여자 본인 이메일이 비어 있으면, [알림 메일] 목록에서 같은 이름으로 등록된 주소를
 *  대신 찾아본다 — admin.js의 resolveEmailFor()와 동일한 규칙. */
function resolveEmailFor(participant, notifyEmails) {
  const email = (participant.email || '').trim();
  if (email) return email;
  const byName = notifyEmails.find((e) => e.name === participant.nickname);
  return byName ? byName.email : '';
}

function missed5Template(meta) {
  const saved = meta.missed5MailTemplate;
  return {
    subject: (saved && saved.subject) || MailTemplates.defaultMissed5Subject(),
    body: (saved && saved.body) || MailTemplates.defaultMissed5Body()
  };
}

async function runMissed5Warning() {
  const db = getDb();
  const [participants, submissions, notifyEmails, meta] = await Promise.all([
    fetchParticipants(), fetchSubmissions(), fetchNotifyEmails(), fetchMeta()
  ]);

  const todayISO = U.today();
  const stats = U.buildStats(participants, submissions, todayISO);
  const template = missed5Template(meta);

  const candidates = stats.filter((s) =>
    s.missed === CONFIG.autoWarnThreshold
    && s.participant.status !== 'out'
    && !s.participant.warned5At);

  let sent = 0;
  let skippedNoEmail = 0;
  const failures = [];

  for (const s of candidates) {
    const p = s.participant;
    const email = resolveEmailFor(p, notifyEmails);
    if (!email) { skippedNoEmail++; continue; }

    const vars = {
      이름: p.nickname,
      자동경고기준: CONFIG.autoWarnThreshold,
      킥아웃기준: CONFIG.kickoutThreshold,
      앱주소: CONFIG.appUrl
    };
    try {
      await sendMail({
        fromName: CONFIG.title,
        to: email,
        subject: MailTemplates.fill(template.subject, vars),
        text: MailTemplates.fill(template.body, vars)
      });
      await db.collection('participants').doc(p.id).update({ warned5At: todayISO });
      sent++;
    } catch (err) {
      failures.push({ id: p.id, nickname: p.nickname, error: err.message });
    }
    await sleep(300); // 지메일 발송 속도 제한을 배려한 짧은 간격
  }

  const result = {
    today: todayISO,
    candidates: candidates.length,
    sent,
    skippedNoEmail,
    failed: failures.length,
    failures
  };

  // 운영진 화면에서 "자동 발송이 실제로 동작하는지" 확인할 수 있도록 마지막 실행 결과를 남겨 둔다.
  await db.doc('meta/app').set({
    missed5LastRun: { at: U.nowStamp(), today: todayISO, sent, skippedNoEmail, failed: failures.length }
  }, { merge: true });

  return result;
}

module.exports = { runMissed5Warning };
