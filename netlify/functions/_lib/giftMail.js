/* 🎁 인사이트 정리본 발송 — 지금 보내기(send-gift-mail)와 예약 발송(send-gift-scheduled)이 함께 쓴다.
 *
 * 누구에게 보낼지는 서버가 정한다: 활성 시즌의 참여자·인증 기록을 읽어 "누락이 giftMissLimit 미만이고
 * 아웃이 아닌 사람"을 앱 화면과 같은 U.buildStats로 계산한다.
 * 같은 사람에게 두 번 가지 않도록 participants/{id}.giftSentAt 에 보낸 날짜를 남긴다(resend면 다시 보냄).
 * 보낸 사람 이름은 '커밍쏜', 답장은 커밍쏜 메일(GIFT_REPLY_TO)로 오게 한다. */
const { getDb } = require('./firebaseAdmin');
const { sendMail, sleep } = require('./mailer');
const { CONFIG, U, MailTemplates, collectionName } = require('./appLogic');

const GIFT_FROM_NAME = '커밍쏜';
const GIFT_REPLY_TO = 'comingssoni@gmail.com';

const col = (name) => getDb().collection(collectionName(name));
const metaDoc = () => getDb().collection(collectionName('meta')).doc('app');

function resolveEmailFor(participant, notifyEmails) {
  const email = (participant.email || '').trim();
  if (email) return email;
  const byName = notifyEmails.find((e) => e.name === participant.nickname);
  return byName ? byName.email : '';
}

/** 정리본 메일을 대상자 전원에게 보낸다. by: 누가/무엇이 보냈는지(기록용) */
async function runGiftMail({ link, subject, body, resend, by }) {
  const subjectTpl = String(subject || '').trim() || MailTemplates.defaultGiftSubject();
  const bodyTpl = String(body || '').trim() || MailTemplates.defaultGiftBody();

  const [pSnap, sSnap, nSnap] = await Promise.all([
    col('participants').get(), col('submissions').get(), col('notifyEmails').get()
  ]);
  const participants = pSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
  const submissions = sSnap.docs.map((d) => d.data());
  const notifyEmails = nSnap.docs.map((d) => d.data()).filter((d) => d.email);

  const todayISO = U.today();
  const stats = U.buildStats(participants, submissions, todayISO);
  const eligible = stats.filter((s) => s.participant.status !== 'out' && s.missed < CONFIG.giftMissLimit);

  const liveCount = (CONFIG.weeklyPrompts || []).length || 4;
  const days = U.challengeDates().length;

  let sent = 0, skippedAlready = 0, skippedNoEmail = 0;
  const failures = [];
  for (const s of eligible) {
    const p = s.participant;
    if (p.giftSentAt && !resend) { skippedAlready++; continue; }
    const email = resolveEmailFor(p, notifyEmails);
    if (!email) { skippedNoEmail++; continue; }
    const vars = {
      이름: p.nickname, 누락횟수: s.missed, 책이름: CONFIG.book.name, 일수: days,
      라이브횟수: liveCount, 정리본링크: link, 앱주소: CONFIG.appUrl
    };
    try {
      await sendMail({
        fromName: GIFT_FROM_NAME, replyTo: GIFT_REPLY_TO, to: email,
        subject: MailTemplates.fill(subjectTpl, vars), text: MailTemplates.fill(bodyTpl, vars)
      });
      sent++;
      await col('participants').doc(p.id).update({ giftSentAt: todayISO });
    } catch (err) {
      failures.push({ id: p.id, nickname: p.nickname, error: err.message });
    }
    await sleep(300);
  }

  const result = { eligible: eligible.length, sent, skippedAlready, skippedNoEmail, failed: failures.length, failures };
  await metaDoc().set({
    giftLastRun: { at: U.nowStamp(), by, link, eligible: eligible.length, sent, skippedAlready, skippedNoEmail, failed: failures.length }
  }, { merge: true });
  return result;
}

module.exports = { runGiftMail, metaDoc, GIFT_REPLY_TO };
