/* 그날 아직 인증하지 않은 참여자에게 "오늘 인증이 아직입니다"라고 알려주는 리마인드 메일.
 *
 * netlify.toml의 schedule 설정으로 매일 21:00(KST)에 실행된다(send-daily-reminder.js).
 * 마감 3시간 전이라 지금 알려주면 아직 늦지 않았다는 것이 이 시각을 고른 이유다.
 *
 * 킥아웃 경고와 달리 이 메일은 이메일로만 보낸다 — 매일 나가는 안내라 문자로 보내면
 * 건당 비용이 계속 쌓이고, 매일 받는 문자는 알림이 아니라 소음이 된다.
 *
 * 하루에 여러 번 실행되어도(재시도 등) 같은 사람에게 두 번 가지 않도록
 * participants/{id}.remindedAt 에 보낸 날짜(KST)를 남겨 둔다. 날짜가 바뀌면 다시 보낸다.
 */
const { getDb } = require('./firebaseAdmin');
const { sendMail, sleep } = require('./mailer');
const { CONFIG, U, MailTemplates, collectionName } = require('./appLogic');

const col = (name) => getDb().collection(collectionName(name));
const metaDoc = () => getDb().collection(collectionName('meta')).doc('app');

async function fetchAll(name) {
  const snap = await col(name).get();
  return snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
}

async function fetchMeta() {
  const doc = await metaDoc().get();
  return doc.exists ? doc.data() : {};
}

/** 참여자 본인 이메일이 비어 있으면 [알림 메일] 목록에서 같은 이름으로 등록된 주소를 쓴다. */
function resolveEmailFor(participant, notifyEmails) {
  const email = (participant.email || '').trim();
  if (email) return email;
  const byName = notifyEmails.find((e) => e.name === participant.nickname);
  return byName ? byName.email : '';
}

function reminderTemplate(meta) {
  const saved = meta.reminderMailTemplate;
  return {
    subject: (saved && saved.subject) || MailTemplates.defaultReminderSubject(),
    body: (saved && saved.body) || MailTemplates.defaultReminderBody()
  };
}

/** 3시간 12분 남았으면 '약 3시간' — 분 단위까지 적으면 메일을 읽는 시점엔 이미 틀려 있다. */
function remainingLabel() {
  const sec = U.secondsToMidnight();
  const hours = Math.floor(sec / 3600);
  if (hours >= 1) return `약 ${hours}시간`;
  return `약 ${Math.max(1, Math.round(sec / 60))}분`;
}

async function runDailyReminder() {
  const todayISO = U.today();

  // 챌린지 기간 밖에는 보낼 일이 없다(시작 전·종료 후).
  if (todayISO < CONFIG.startDate || todayISO > CONFIG.endDate) {
    return { skipped: 'outside-period', season: CONFIG.seasonId, today: todayISO };
  }

  const [participants, submissions, notifyEmails, meta] = await Promise.all([
    fetchAll('participants'), fetchAll('submissions'), fetchAll('notifyEmails'), fetchMeta()
  ]);

  const stats = U.buildStats(participants, submissions, todayISO);
  const template = reminderTemplate(meta);

  // 오늘 아직 안 낸 사람. 아웃된 사람, 오늘이 면제일인 사람, 이미 오늘 받은 사람은 뺀다.
  const candidates = stats.filter((s) => {
    const p = s.participant;
    if (p.status === 'out') return false;
    if (s.submittedToday) return false;
    if ((p.exemptDates || []).includes(todayISO)) return false;
    return p.remindedAt !== todayISO;
  });

  let sent = 0;
  let skippedNoEmail = 0;
  const failures = [];
  const remaining = remainingLabel();
  const withEmail = notifyEmails.filter((e) => e.email);

  for (const s of candidates) {
    const p = s.participant;
    const email = resolveEmailFor(p, withEmail);
    if (!email) { skippedNoEmail++; continue; }

    const vars = {
      이름: p.nickname,
      날짜: U.longLabel(todayISO),
      남은시간: remaining,
      앱주소: CONFIG.appUrl
    };
    try {
      await sendMail({
        fromName: CONFIG.title,
        to: email,
        subject: MailTemplates.fill(template.subject, vars),
        text: MailTemplates.fill(template.body, vars)
      });
      sent++;
      await col('participants').doc(p.id).update({ remindedAt: todayISO });
    } catch (err) {
      failures.push({ id: p.id, nickname: p.nickname, error: err.message });
    }
    await sleep(300); // 지메일 발송 속도 제한을 배려한 짧은 간격
  }

  const result = {
    today: todayISO,
    season: CONFIG.seasonId,
    candidates: candidates.length,
    sent,
    skippedNoEmail,
    failed: failures.length,
    failures
  };

  // 운영진 화면에서 "자동 발송이 실제로 동작하는지" 확인할 수 있도록 마지막 실행 결과를 남긴다.
  await metaDoc().set({
    reminderLastRun: {
      at: U.nowStamp(), today: todayISO, candidates: candidates.length,
      sent, skippedNoEmail, failed: failures.length
    }
  }, { merge: true });

  return result;
}

module.exports = { runDailyReminder };
