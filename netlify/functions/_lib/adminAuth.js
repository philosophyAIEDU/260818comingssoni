/* 운영진 화면에서 부르는 함수의 로그인 확인 — Firebase 로그인 ID 토큰을 검증하고
 * 그 이메일이 CONFIG.adminEmails에 있어야 통과. 반환: { email } 또는 { error: 응답 } */
const admin = require('firebase-admin');
const { getDb } = require('./firebaseAdmin');
const { CONFIG } = require('./appLogic');

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
  if (!allowed.includes(email)) return { error: json(403, { error: '운영진 계정만 쓸 수 있습니다.' }) };
  return { email };
}

module.exports = { requireAdmin, json };
