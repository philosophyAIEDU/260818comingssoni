/* 퍼스널메이커스 독서 챌린지 - 전역 설정
 * 이 파일의 값만 바꾸면 챌린지 기간/기준을 재사용할 수 있습니다.
 */
window.CS = window.CS || {};

CS.CONFIG = {
  // 챌린지 기본 정보
  title: '퍼스널메이커스 독서 챌린지',
  subtitle: '프로세스 이코노미 인증 시스템',
  logo: 'logo-header.jpg',               // 좌측 상단 로고 이미지 경로
  appUrl: 'https://comingssoni.netlify.app/', // 인증 알림 메일에 안내할 앱 주소
  otAt: '2026-08-23T10:00',       // OT 일시 (KST)
  startDate: '2026-08-24',        // 챌린지 시작일 (포함)
  endDate: '2026-09-20',          // 챌린지 종료일 (포함)

  // 운영 기준
  timezone: 'Asia/Seoul',         // 마감/날짜 판정 기준 시간대
  deadlineHour: 24,               // 매일 24:00 정각 마감 (유예 없음)
  kickoutThreshold: 6,            // 누적 미인증 N회 이상 → 실제 킥아웃 대상
  riskThreshold: 4,               // 누적 미인증 N회 이상 → "킥아웃 위험 인원"으로 분류(아직 킥아웃 대상은 아님)

  // 챌린지 기간(startDate~endDate) 밖에서도 인증 제출을 허용할지
  //  true  : 시작 전·종료 후에도 제출 가능 (시연/테스트용, 집계에는 반영되지 않음)
  //  false : 기간 안에서만 제출 가능 (실제 운영 시 권장)
  allowSubmitOutsidePeriod: true,

  // 저장소 백엔드: 'local' | 'firebase'
  //  - local    : 브라우저 localStorage (현재 기본값)
  //  - firebase : js/store-firebase.js 의 Firestore 어댑터 사용
  backend: 'firebase',

  // 로컬 저장소 키 접두사 (버전 올리면 기존 데이터와 분리됨)
  storagePrefix: 'comingsoon.reading.v1',

  // 관리자 구글 계정 화이트리스트
  adminEmails: ['warmcomfortforyou@gmail.com', 'comingssoni@gmail.com'],

  // 참고용 원본 구글폼 링크 (안내 문구에만 사용)
  links: {
    applyForm: 'https://docs.google.com/forms/d/1W1ElxSd80uDmjByiS_pOwdFhq8HiOqb5Y0EzVU9PuHI/edit',
    verifyForm: 'https://docs.google.com/forms/d/1F0SRIGR82TWdSM9ADmM9LCGzk6jSg6EblzY01IWy7qs/edit'
  }
};

// Firebase 연결 시 채워 넣을 자리 (backend: 'firebase' 로 바꾼 뒤 사용)
CS.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDZU5Q6GTnFuZxu3NbPcWrM_pedoLA4frY",
  authDomain: "comingssoni-e7517.firebaseapp.com",
  projectId: "comingssoni-e7517",
  storageBucket: "comingssoni-e7517.firebasestorage.app",
  messagingSenderId: "454941132246",
  appId: "1:454941132246:web:37df91296b01d9966cd077"
};

