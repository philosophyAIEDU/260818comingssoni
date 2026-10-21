/* 🎁 인사이트 정리본 발송 — 지금 보내기(send-gift-mail)와 예약 발송(send-gift-scheduled)이 함께 쓴다.
 *
 * 누구에게 보낼지는 서버가 정한다: 활성 시즌의 참여자·인증 기록을 읽어 "누락이 giftMissLimit 미만이고
 * 아웃이 아닌 사람"을 앱 화면과 같은 U.buildStats로 계산한다.
 * 같은 사람에게 두 번 가지 않도록 participants/{id}.giftSentAt 에 보낸 날짜를 남긴다(resend면 다시 보냄).
 * 운영진이 [받는 사람 추가]로 넣은 사람(meta/app.giftExtras [{ name, email }])에게도 같은 메일을 보낸다 —
 * 대상자와 이메일이 겹치면 건너뛰고, 보낸 날짜는 그 항목의 sentAt에 남긴다.
 *
 * 함수 실행 시간 제한(지금 보내기 약 10초 · 예약 30초) 때문에 한 번에 다 못 보낸다(2026-10-21: 40명 중 14명에서 끊김).
 * budgetMs가 지나면 새 메일을 더 시작하지 않고 멈춘 뒤 remaining(남은 인원)을 돌려준다 —
 * 이미 보낸 사람은 giftSentAt/sentAt으로 건너뛰니, 같은 호출을 남은 인원이 0이 될 때까지 되풀이하면 된다.
 * 보낸 사람 이름은 '커밍쏜', 답장은 커밍쏜 메일(GIFT_REPLY_TO)로 오게 한다. */
const { getDb } = require('./firebaseAdmin');
const { sendMail, sleep, closePool } = require('./mailer');
const { U, MailTemplates, collectionName, currentConfig } = require('./appLogic');

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
async function runGiftMail({ link, subject, body, resend, by, budgetMs = Infinity }) {
  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > budgetMs;
  const CONFIG = currentConfig(); // withSeason 안에서 부르면 그 시즌 설정
  const subjectTpl = String(subject || '').trim() || MailTemplates.defaultGiftSubject();
  const bodyTpl = String(body || '').trim() || MailTemplates.defaultGiftBody();

  const [pSnap, sSnap, nSnap, mSnap] = await Promise.all([
    col('participants').get(), col('submissions').get(), col('notifyEmails').get(), metaDoc().get()
  ]);
  const extras = ((mSnap.exists && mSnap.data().giftExtras) || []).filter((x) => x && x.email);
  const participants = pSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
  const submissions = sSnap.docs.map((d) => d.data());
  const notifyEmails = nSnap.docs.map((d) => d.data()).filter((d) => d.email);

  const todayISO = U.today();
  const stats = U.buildStats(participants, submissions, todayISO);
  const eligible = stats.filter((s) => s.participant.status !== 'out' && s.missed < CONFIG.giftMissLimit);

  const liveCount = (CONFIG.weeklyPrompts || []).length || 4;
  const days = U.challengeDates().length;

  let sent = 0, skippedAlready = 0, skippedNoEmail = 0, extrasSent = 0, remaining = 0;
  const failures = [];
  const eligibleEmails = new Set();
  for (const s of eligible) {
    const p = s.participant;
    const email = resolveEmailFor(p, notifyEmails);
    if (email) eligibleEmails.add(email.toLowerCase());
    if (p.giftSentAt && !resend) { skippedAlready++; continue; }
    if (!email) { skippedNoEmail++; continue; }
    if (outOfTime()) { remaining++; continue; }
    const vars = {
      이름: p.nickname, 누락횟수: s.missed, 책이름: CONFIG.book.name, 일수: days,
      라이브횟수: liveCount, 정리본링크: link, 앱주소: CONFIG.appUrl
    };
    try {
      await sendMail({
        fromName: GIFT_FROM_NAME, replyTo: GIFT_REPLY_TO, to: email, pool: true,
        subject: MailTemplates.fill(subjectTpl, vars), text: MailTemplates.fill(bodyTpl, vars)
      });
      sent++;
      // 발송 확인용: 날짜 · 시각 · 받은 주소를 남긴다(운영진 명단의 ✅)
      await col('participants').doc(p.id).update({ giftSentAt: todayISO, giftSentStamp: U.nowStamp(), giftSentTo: email, giftError: null });
    } catch (err) {
      failures.push({ id: p.id, nickname: p.nickname, error: err.message });
      await col('participants').doc(p.id).update({ giftError: String(err.message).slice(0, 200) }).catch(() => {});
    }
    await sleep(100);
  }

  // 운영진이 추가한 받는 사람 — 대상자와 겹치지 않는 사람에게만
  let extrasChanged = false;
  const extrasOut = [];
  for (const x of extras) {
    const email = String(x.email).trim().toLowerCase();
    if (eligibleEmails.has(email)) { extrasOut.push(x); continue; }
    if (x.sentAt && !resend) { skippedAlready++; extrasOut.push(x); continue; }
    if (outOfTime()) { remaining++; extrasOut.push(x); continue; }
    const vars = {
      이름: x.name || email.split('@')[0], 누락횟수: '', 책이름: CONFIG.book.name, 일수: days,
      라이브횟수: liveCount, 정리본링크: link, 앱주소: CONFIG.appUrl
    };
    try {
      await sendMail({
        fromName: GIFT_FROM_NAME, replyTo: GIFT_REPLY_TO, to: email, pool: true,
        subject: MailTemplates.fill(subjectTpl, vars), text: MailTemplates.fill(bodyTpl, vars)
      });
      sent++; extrasSent++; extrasChanged = true;
      extrasOut.push(Object.assign({}, x, { sentAt: todayISO }));
    } catch (err) {
      failures.push({ id: email, nickname: x.name || email, error: err.message });
      extrasOut.push(x);
    }
    await sleep(100);
  }
  closePool();
  if (extrasChanged) {
    // 발송 중 운영진이 목록을 고쳤을 수 있으니 최신 목록에 sentAt만 옮겨 적는다
    const latest = ((await metaDoc().get()).data() || {}).giftExtras || [];
    const sentMap = new Map(extrasOut.filter((x) => x.sentAt).map((x) => [String(x.email).toLowerCase(), x.sentAt]));
    await metaDoc().set({ giftExtras: latest.map((x) => (x && sentMap.has(String(x.email).toLowerCase())
      ? Object.assign({}, x, { sentAt: sentMap.get(String(x.email).toLowerCase()) }) : x)) }, { merge: true });
  }

  const result = { eligible: eligible.length, extras: extras.length, extrasSent, sent, skippedAlready, skippedNoEmail, remaining, failed: failures.length, failures };
  await metaDoc().set({
    // skippedAlready = 이미 받은 사람(앞선 묶음 포함) → sent + skippedAlready 가 지금까지 받은 인원
    giftLastRun: { at: U.nowStamp(), by, link, eligible: eligible.length, extrasSent, sent, skippedAlready, skippedNoEmail, remaining, failed: failures.length }
  }, { merge: true });
  return result;
}

module.exports = { runGiftMail, metaDoc, GIFT_REPLY_TO };
