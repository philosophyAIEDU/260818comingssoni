/* 🎁 인사이트 정리본 발송 — 운영진 화면 [알림 메일 › 선물 대상자 › 정리본 메일 보내기]가 호출한다.
 *
 * 누구에게 보낼지는 클라이언트가 정하지 않는다. 서버가 활성 시즌의 참여자·인증 기록을 읽어
 * "누락이 giftMissLimit 미만이고 아웃이 아닌 사람"을 직접 계산한다 — 앱 화면과 같은
 * U.buildStats 코드라 화면에 보이는 명단과 실제 발송 명단이 어긋나지 않는다.
 *
 * 호출은 운영진만 할 수 있다. 앱의 Firebase 로그인 ID 토큰을 Authorization 헤더로 받아
 * Admin SDK로 검증하고, 그 이메일이 CONFIG.adminEmails에 있어야 한다. (문자 발송 함수와 달리
 * 임의 링크를 멤버 전원에게 뿌릴 수 있는 기능이라 반드시 막아 둔다.)
 *
 * 같은 사람에게 두 번 가지 않도록 participants/{id}.giftSentAt 에 보낸 날짜를 남긴다.
 * resend: true 로 부르면 이미 받은 사람에게도 다시 보낸다(링크를 고쳤을 때 등).
 *
 * 요청(JSON): { link, subject?, body?, resend? }   — subject/body를 비우면 기본 문구
 * 응답(JSON): { sent, skippedAlready, skippedNoEmail, failed, failures, eligible }
 */
const admin = require('firebase-admin');
const { getDb } = require('./_lib/firebaseAdmin');
const { sendMail, sleep } = require('./_lib/mailer');
const { CONFIG, U, MailTemplates, collectionName } = require('./_lib/appLogic');

const col = (name) => getDb().collection(collectionName(name));
const metaDoc = () => getDb().collection(collectionName('meta')).doc('app');

const json = (statusCode, body) => ({ statusCode, body: JSON.stringify(body) });

async function requireAdmin(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: json(401, { error: '로그인 정보가 없습니다. 운영진 화면에서 다시 로그인해 주세요.' }) };
  getDb(); // Admin SDK 초기화(서비스 계정)
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch (err) {
    return { error: json(401, { error: '로그인 정보를 확인할 수 없습니다: ' + err.message }) };
  }
  const email = (decoded.email || '').toLowerCase();
  const allowed = (CONFIG.adminEmails || []).map((e) => e.toLowerCase());
  if (!allowed.includes(email)) return { error: json(403, { error: '운영진 계정만 보낼 수 있습니다.' }) };
  return { email };
}

function resolveEmailFor(participant, notifyEmails) {
  const email = (participant.email || '').trim();
  if (email) return email;
  const byName = notifyEmails.find((e) => e.name === participant.nickname);
  return byName ? byName.email : '';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  if (!CONFIG.giftMissLimit) return json(400, { error: '이 시즌에는 정리본 선물 기준(giftMissLimit)이 없습니다.' });

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: '요청 형식이 올바르지 않습니다.' }); }
  const link = String(payload.link || '').trim();
  if (!/^https?:\/\//.test(link)) return json(400, { error: '정리본 링크(https://…)를 입력해 주세요.' });
  const subjectTpl = String(payload.subject || '').trim() || MailTemplates.defaultGiftSubject();
  const bodyTpl = String(payload.body || '').trim() || MailTemplates.defaultGiftBody();
  const resend = !!payload.resend;

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
        fromName: CONFIG.title, to: email,
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
    giftLastRun: { at: U.nowStamp(), by: auth.email, link, eligible: eligible.length, sent, skippedAlready, skippedNoEmail, failed: failures.length }
  }, { merge: true });
  return json(200, result);
};
