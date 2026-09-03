/* Firebase Admin SDK(서비스 계정) 초기화 — Firestore를 서버 권한으로 읽고 쓰기 위해 필요하다.
 *
 * (이전에는 API 키만 붙여 Firestore REST를 "익명"으로 호출했는데, 그 방식은 프로젝트 자체
 * 할당량과 별개로 훨씬 낮은 "인증 안 된 요청" 한도에 걸려 429가 자주 났다. 서비스 계정으로
 * 진짜 인증된 요청을 보내면 이 문제가 없다.)
 *
 * 필요한 환경 변수 (Netlify 사이트 설정 → Environment variables)
 *   FIREBASE_SERVICE_ACCOUNT_KEY   Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 →
 *                                  "새 비공개 키 생성"으로 받은 JSON 파일의 내용을 그대로
 *                                  (한 줄로) 붙여넣는다. — README 참고.
 *
 * 여러 함수 호출에서 재사용하도록 모듈 스코프에 한 번만 초기화해 둔다(Netlify Functions는
 * 같은 컨테이너가 재사용될 때 이 캐시가 유지된다). */
const admin = require('firebase-admin');

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

module.exports = { getDb };
