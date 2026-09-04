/* 솔라피(Solapi) API로 문자(SMS/LMS)를 보내는 공통 헬퍼.
 *
 * 필요한 환경 변수 (Netlify 사이트 설정 → Environment variables)
 *   SOLAPI_API_KEY       솔라피 콘솔 → [내 정보] → API Key 관리에서 발급한 API Key
 *   SOLAPI_API_SECRET    같은 화면에서 발급한 API Secret
 *   SOLAPI_SENDER        발신번호 — 솔라피에 사전 등록(본인 인증)해 둔 번호여야 발송된다
 *
 * subject를 함께 보내면(또는 본문이 길면) 솔라피가 자동으로 LMS로 전환해 주므로,
 * 여기서는 type을 따로 강제하지 않는다(autoTypeDetect 기본 동작에 맡김).
 */
const { SolapiMessageService } = require('solapi');

let service = null;

function getSolapiService() {
  if (service) return service;
  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error(
      'SOLAPI_API_KEY / SOLAPI_API_SECRET 환경 변수가 설정되어 있지 않습니다. 솔라피 콘솔에서 발급받아 ' +
      'Netlify 환경 변수로 등록해 주세요. (README 참고)');
  }
  service = new SolapiMessageService(apiKey, apiSecret);
  return service;
}

/** 하이픈·공백 등을 지우고 숫자만 남긴다 — 솔라피는 발신·수신번호에 특수문자가 섞이면 거부한다. */
function normalizePhone(raw) {
  return String(raw || '').replace(/[^0-9]/g, '');
}

/** 문자 1통을 보낸다. subject를 주면 솔라피가 자동으로 LMS로 전환해서 긴 본문도 잘리지 않는다. */
async function sendSms({ to, subject, text }) {
  const from = process.env.SOLAPI_SENDER;
  if (!from) {
    throw new Error('SOLAPI_SENDER(발신번호) 환경 변수가 설정되어 있지 않습니다. (README 참고)');
  }
  const toClean = normalizePhone(to);
  if (!toClean) throw new Error('받는 사람 전화번호가 없습니다.');

  await getSolapiService().send({
    to: toClean,
    from: normalizePhone(from),
    text,
    subject: subject || undefined
  });
}

module.exports = { sendSms, normalizePhone };
