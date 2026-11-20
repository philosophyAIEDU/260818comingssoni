/* 🔕 누락·미인증 알림 메일(21시 리마인드·누락 5회 안내)을 받지 않는 사람인지.
 *  - 명단에서 끈 사람(participants.noReminder) — 그 시즌에만
 *  - 시즌 설정 reminderOptOut(참여자 id) — 그 시즌에만
 *  - 공통 설정 reminderOptOutEmailSha256(이메일 소문자의 SHA-256) — 시즌이 바뀌어도 계속.
 *    이메일 주소 자체는 공개 저장소에 남기지 않으려고 해시 값만 둔다.
 * 정리본 메일에는 쓰지 않는다(선물은 그대로 받는다). */
const { createHash } = require('crypto');

const sha256 = (email) => createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex');

/** email: 알림 메일 목록에서 찾아낸 주소(명단 이메일이 비어 있을 때) — 있으면 그것도 본다 */
function isReminderOptedOut(participant, config, email) {
  if (!participant) return false;
  if (participant.noReminder === true) return true;
  if ((config.reminderOptOut || []).includes(participant.id)) return true;
  const hashes = config.reminderOptOutEmailSha256 || [];
  if (!hashes.length) return false;
  return [participant.email, email].some((e) => e && hashes.includes(sha256(e)));
}

module.exports = { isReminderOptedOut, sha256 };
