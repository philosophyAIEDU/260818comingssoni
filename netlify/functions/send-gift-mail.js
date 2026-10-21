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
 * 실제 발송은 _lib/giftMail.js(예약 발송과 같은 코드). 같은 사람에게 두 번 가지 않도록 participants/{id}.giftSentAt 에 보낸 날짜를 남긴다.
 * resend: true 로 부르면 이미 받은 사람에게도 다시 보낸다(링크를 고쳤을 때 등).
 *
 * 요청(JSON): { link, subject?, body?, resend? }   — subject/body를 비우면 기본 문구
 * 응답(JSON): { sent, skippedAlready, skippedNoEmail, remaining, failed, failures, eligible }
 */
const { CONFIG, withSeason } = require('./_lib/appLogic');
const { runGiftMail } = require('./_lib/giftMail');
const { requireAdmin, json } = require('./_lib/adminAuth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: '요청 형식이 올바르지 않습니다.' }); }
  const target = global.CS.configFor(payload.seasonId) || CONFIG;
  if (!target.giftMissLimit) return json(400, { error: '이 시즌에는 정리본 선물 기준(giftMissLimit)이 없습니다.' });
  const link = String(payload.link || '').trim();
  if (!/^https?:\/\//.test(link)) return json(400, { error: '정리본 링크(https://…)를 입력해 주세요.' });

  // 운영진 화면이 보고 있던 시즌으로 계산한다(다음 시즌이 켜진 뒤 ?season=s2로 지난 시즌을 보낼 때도 맞게)
  const seasonId = global.CS.seasonById(payload.seasonId) ? payload.seasonId : CONFIG.seasonId;
  // 실행 시간 제한(약 10초) 안에 끝나도록 5초어치만 보내고 남은 인원(remaining)을 돌려준다 —
  // 운영진 화면이 remaining이 0이 될 때까지 다시 부른다(이미 받은 사람은 건너뛴다)
  const result = await withSeason(seasonId, () => runGiftMail({
    link, subject: payload.subject, body: payload.body, resend: !!payload.resend, by: auth.email, budgetMs: 5000
  }));
  return json(200, result);
};
