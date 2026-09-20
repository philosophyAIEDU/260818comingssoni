/* 퍼스널메이커스 독서 멤버십 - 전역 설정
 *
 * ── 시즌 구조 ────────────────────────────────────────────────
 * 멤버십이 매달 새 책으로 이어지므로, 책마다 "시즌"을 하나씩 둔다.
 * 시즌마다 저장소가 갈라져서(아래 dataPrefix) 이전 시즌 기록은 그대로 남고
 * 새 시즌은 빈 상태에서 다시 쌓인다.
 *
 * 활성 시즌은 배포가 아니라 "시계"가 고른다 — startsAt이 지난 시즌 중 가장 나중 것.
 * 그래서 미리 배포해 두면 전환 시각에 사람이 아무것도 하지 않아도 저절로 바뀐다.
 * (시연·테스트 중에 시즌을 고정하고 싶으면 URL에 ?season=s1 을 붙인다)
 */
window.CS = window.CS || {};

/* 시즌과 무관하게 항상 같은 값 */
CS.COMMON = {
  logo: 'logo-header.jpg',               // 좌측 상단 로고 이미지 경로
  appUrl: 'https://comingssoni.netlify.app/', // 인증 알림 메일에 안내할 앱 주소
  timezone: 'Asia/Seoul',         // 마감/날짜 판정 기준 시간대
  deadlineHour: 24,               // 매일 24:00 정각 마감 (유예 없음)

  // 챌린지 기간(startDate~endDate) 밖에서도 인증 제출을 허용할지
  //  true  : 시작 전·종료 후에도 제출 가능 (시연/테스트용, 집계에는 반영되지 않음)
  //  false : 기간 안에서만 제출 가능 (실제 운영 시 권장)
  allowSubmitOutsidePeriod: true,

  // 저장소 백엔드: 'local' | 'firebase'
  //  - local    : 브라우저 localStorage
  //  - firebase : js/store-firebase.js 의 Firestore 어댑터 사용
  backend: 'firebase',

  // 관리자 구글 계정 화이트리스트
  adminEmails: ['warmcomfortforyou@gmail.com', 'comingssoni@gmail.com'],

  // 참고용 원본 구글폼 링크 (안내 문구에만 사용)
  links: {
    applyForm: 'https://docs.google.com/forms/d/1W1ElxSd80uDmjByiS_pOwdFhq8HiOqb5Y0EzVU9PuHI/edit',
    verifyForm: 'https://docs.google.com/forms/d/1F0SRIGR82TWdSM9ADmM9LCGzk6jSg6EblzY01IWy7qs/edit'
  }
};

/* 시즌 목록 — startsAt이 이른 것부터 적는다 */
CS.SEASONS = [{
  id: 's1',
  startsAt: null,                 // 첫 시즌: 기준 시각 없이 항상 후보
  title: '퍼스널메이커스 독서 챌린지',
  subtitle: '프로세스 이코노미 인증 시스템',
  periodLabel: '챌린지 기간',
  book: {
    name: '프로세스 이코노미',
    tagline: '',
    byline: '오바라 가즈히로 지음',
    cover: '프로세스이코노미.png',
    desc: '결과보다 과정을 파는 시대, 매일 독서 인증으로 과정을 공유하며 나만의 성장 팬덤을 함께 만들어 갑니다.'
  },
  live: {
    label: '매주 일요일 22:00 - 22:30',
    note: '* 다시보기는 제공되지 않으니 꼭 시간내어 참여해주세요'
  },
  rulesHeading: '안내 · 챌린지 규칙',
  // 안내·규칙 카드에서 이 시즌에만 붙는 줄(공통 규칙 뒤에 이어진다)
  extraRules: [],
  // 규칙 아래 한 줄로 붙는 바깥 링크(OT 영상 등). null이면 아무것도 안 나온다.
  otLink: null,
  startDate: '2026-08-24',        // 챌린지 시작일 (포함)
  endDate: '2026-09-20',          // 챌린지 종료일 (포함)

  // 시즌1의 데이터는 접두사 없이 기존 컬렉션(participants/submissions/…)에 그대로 있다.
  // 여기를 비워 두는 것이 곧 "기존 데이터를 건드리지 않는다"는 뜻이다.
  dataPrefix: '',
  storagePrefix: 'comingsoon.reading.v1',

  // 시즌1은 전환 후 운영진만 볼 수 있게 잠근다(데이터는 그대로 남는다)
  lockAt: '2026-09-21T03:00',

  kickoutEnabled: true,           // 킥아웃 판정·통보를 쓰는 시즌인지
  kickoutThreshold: 6,            // 누적 미인증 N회 이상 → 킥아웃 대상
  riskThreshold: 4,               // 누적 미인증 N회 이상 → "킥아웃 위험 인원"
  autoWarnThreshold: 5,           // 누적 미인증이 정확히 이 횟수가 된 날 자동 경고 메일

  // 날짜(startDate 기준 N일차)별 "오늘 읽을 부분" 안내. 배열 인덱스 0 = 1일차.
  // 실제 달력 날짜가 아니라 챌린지 시작일로부터 며칠째인지로 찾으므로, startDate를
  // 옮겨도(시연·테스트 등) 그대로 맞는 회차의 안내가 나온다.
  //
  // 하루치는 [{ ch: '장 이름', s: ['소제목', ...] }, ...] 형태다. 화면에는
  //   1장 - 소제목
  //   1장 - 소제목
  // 처럼 한 줄에 하나씩 세로로 나열된다. ch가 빈 값이면 장 표시 없이 글만 나온다.
  readingPlan: [
    // 1주차 — 왜 프로세스인가 (머리말 + 1·2장)
    [
      { ch: '머리말', s: ["이제 '결과'가 아니라 '과정'을 팔아라!"] },
      { ch: '1장', s: ['욕망하지 않는 세대의 등장', '벤츠에는 있고 도요타에는 없는 것'] }
    ],
    [{ ch: '1장', s: ['품질 vs. 커뮤니티, 무엇으로 승부할 것인가', '브랜드에서 소속감을 느끼는 소비자들', '내가 쓰는 브랜드가 나를 말한다'] }],
    [{ ch: '1장', s: ['종교를 대신하는 브랜드들', '인터넷 세상을 놀이터 삼는 세대', '파타고니아에서 굳이 불편한 쇼핑을 하는 이유'] }],
    [{ ch: '1장', s: ['아웃풋으로는 돈을 벌 수 없는 때가 온다', '2050년에는 전기를 무료로 쓴다?', '싱그러리티 대학교의 기하급수적 사고'] }],
    [{ ch: '2장', s: ['오바마 대통령을 탄생시킨 공감 메커니즘', '이야기로 감정에 호소하라', '마음을 사로잡는 시그니처 스토리'] }],
    [{ ch: '2장', s: ['인간의 궁극적인 욕망은 무엇인가', '하이네켄 광고가 보여주는 프로세스의 힘'] }],
    [{ ch: '', s: ['🔴 <strong>라이브 1회차</strong> (새 분량 없음)'] }],
    // 2주차 — 어떻게 실천하는가 (3·4·5장)
    [{ ch: '3장', s: ['정답은 언제든지 수정될 수 있다', '성공을 부르는 파랑새는 과정 속에 숨어 있다', '오케스트라형 대신 재즈형 일하기 방식으로'] }],
    [{ ch: '3장', s: ['깃발을 처음 세운 자가 가장 많은 정보를 얻는다', '프로세스의 자발적 참여자, 세컨드 크리에이터', '고객을 사로잡는 인사이드 아웃 방식'] }],
    [{ ch: '4장', s: ["프로세스에서 '왜'가 빠지면 쉽게 따라잡힌다", '공감 가는 고민과 철학으로 팬을 확보하라', "스티브 잡스가 말하는 애플의 '왜'", "최고의 브랜드 '종교'에서 배운다"] }],
    [{ ch: '4장', s: ["사람들은 '무엇'이 아니라 '왜'에 지갑을 연다", '라쿠텐 인기 가게의 3가지 법칙', '열정적으로 공감하게 하라', '고객에게 어떤 역할이든 맡겨라'] }],
    [{ ch: '5장', s: ['BTS가 세계 시장을 석권한 이유', '자니스 사무소의 치밀한 팬 전략', '샤오미, 미팬과 만드는 꿈의 스마트폰', '중고 거래 플랫폼에서는 채소를 팔아라'] }],
    [{ ch: '5장', s: ['북유럽 생활 도구점, 물건의 드라마를 상영합니다', '예측 불가능한 프로세스야말로 최고의 재미', '자포스, 광고비가 들지 않는 기업', '에어비앤비와 스트라이프를 탄생시킨 오피스 아워'] }],
    [{ ch: '', s: ['🔴 <strong>라이브 2회차</strong> (새 분량 없음)'] }],
    // 3주차 — 함정을 피하고 나의 무기로 (6·7장 + 맺음말 + 해제)
    [{ ch: '6장', s: ['프로세스에만 집중하면 위험하다', '알맹이 없는 꿈은 유혹에 빠지기 쉽다', '나만의 확고한 기준에 집중하라'] }],
    [{ ch: '6장', s: ['필터 버블에 빠지지 말고 객관성을 지켜라', '소셜 미디어에 인생을 조종당하지 마라'] }],
    [{ ch: '6장', s: ['이상과 현실의 괴리를 직시하라', 'Will-Can-Must에 얽매이지 않아도 된다'] }],
    [{ ch: '7장', s: ['정리 컨설턴트 곤도 마리에의 프로세스 이코노미', '과정 자체를 즐기는 EX', '몰입의 3가지 조건'] }],
    [{ ch: '7장', s: ["구글의 '20퍼센트 규칙'과 '마음챙김'", '일개미는 어떻게 설탕을 찾아낼까?', '떠돌이 개미 넷플릭스가 이룬 혁신'] }],
    [
      { ch: '7장', s: ['퍼즐형에서 레고형으로, 인생의 패러다임이 달라진다'] },
      { ch: '맺음말', s: ["'정답 지향주의'에서 '프로세스 지향주의'로"] },
      { ch: '해제의 글', s: ['김용섭 — 📕 <strong>완독일!</strong>'] }
    ],
    [{ ch: '', s: ['🔴 <strong>라이브 3회차</strong> — 완독 기념'] }],
    // 4주차 — 재독 주간 (밑줄 친 부분만). 새로 읽을 분량은 없고, 매일 같은 안내를 보여준다.
    [{ ch: '', s: ['재독 주간입니다. 새로 읽지 않고, 1~3주차에 <strong>밑줄 친 부분만</strong> 다시 읽습니다.'] }],
    [{ ch: '', s: ['재독 주간입니다. 새로 읽지 않고, 1~3주차에 <strong>밑줄 친 부분만</strong> 다시 읽습니다.'] }],
    [{ ch: '', s: ['재독 주간입니다. 새로 읽지 않고, 1~3주차에 <strong>밑줄 친 부분만</strong> 다시 읽습니다.'] }],
    [{ ch: '', s: ['재독 주간입니다. 새로 읽지 않고, 1~3주차에 <strong>밑줄 친 부분만</strong> 다시 읽습니다.'] }],
    [{ ch: '', s: ['재독 주간입니다. 새로 읽지 않고, 1~3주차에 <strong>밑줄 친 부분만</strong> 다시 읽습니다.'] }],
    [{ ch: '', s: ['재독 주간입니다. 새로 읽지 않고, 1~3주차에 <strong>밑줄 친 부분만</strong> 다시 읽습니다.'] }],
    [{ ch: '', s: ['재독 주간입니다. 새로 읽지 않고, 1~3주차에 <strong>밑줄 친 부분만</strong> 다시 읽습니다.'] }]
  ]
}, {
  id: 's2',
  startsAt: '2026-09-21T02:00',   // 이 시각(KST)이 지나면 저절로 이 시즌이 켜진다
  title: '퍼스널메이커스 독서 멤버십',
  subtitle: '꿈과 돈 인증 시스템',
  periodLabel: '멤버십 기간',
  book: {
    name: '꿈과 돈',
    tagline: '모든 꿈이 실현되는 미래',
    byline: '니시노 아키히로 지음 · 민경욱 옮김 · 소미미디어',
    cover: '꿈과돈.webp',
    desc: '콘텐츠는 넘치고 상품의 기능은 다 비슷해진 시대. 그런데 어떤 사람에게는 팬이 생기고 돈이 따라옵니다. '
      + '팬과 돈이 생기는 브랜딩을 하기 위해 지금 무엇을 해야 하는지를 한 달간 함께 배웁니다.'
  },
  live: {
    label: '매주 일요일 22:00 - 22:30 (9/27 · 10/4 · 10/11 · 10/18)',
    note: '* 다시보기는 제공되지 않으니 꼭 시간내어 참여해주세요. OT는 영상으로 제공됩니다(결제 후 전달된 노션 페이지 참고).'
  },
  rulesHeading: '안내 · 멤버십 규칙',
  otLink: {
    label: '퍼스널메이커스 독서 멤버십 OT 보기',
    url: 'https://www.youtube.com/watch?v=ny6lJ-8PMXI'
  },
  extraRules: [
    '인증을 놓쳐도 <strong>킥아웃되지 않습니다</strong>. 다만 28일 동안 <strong>누락이 6회 미만</strong>이면 '
      + '커밍쏜이 직접 정리한 『꿈과 돈』 <strong>인사이트 정리본</strong>을 드립니다.',
    '책은 <strong>소미미디어 판(2025년 10월 출간)</strong>으로 준비해 주세요. 다산북스 2024년 판은 '
      + '번역과 목차가 달라 이 커리큘럼과 맞지 않습니다.'
  ],
  startDate: '2026-09-21',
  endDate: '2026-10-18',

  // 시즌2의 데이터는 s2_ 접두사가 붙은 별도 컬렉션에 쌓인다.
  // 시즌1 컬렉션은 이름이 달라서 아예 닿지 않는다 = 기존 기록이 섞이거나 지워질 일이 없다.
  dataPrefix: 's2',
  storagePrefix: 'comingsoon.reading.s2',

  lockAt: null,                   // 진행 중인 시즌이므로 잠그지 않는다

  // 이 시즌엔 킥아웃이 없다. 누락 횟수는 그대로 세지만(운영진이 확인·검색할 수 있게)
  // 위험/아웃 판정도, 경고·통보 메일도 하지 않는다.
  kickoutEnabled: false,
  kickoutThreshold: Infinity,
  riskThreshold: Infinity,
  autoWarnThreshold: Infinity,

  // TODO: 2일차부터 28일차까지는 『꿈과 돈』 목차를 받는 대로 시즌1과 같은 형식으로 채운다.
  readingPlan: [
    // 1일차는 아직 책을 읽지 않고, 목차만 훑어보며 기대와 목표를 적는 날이다.
    [{ ch: '', s: [
      '책을 펴기 전에 <strong>목차부터</strong> 천천히 훑어보세요.',
      '① 목차에서 <strong>가장 기대되는 꼭지 한 가지</strong>와, 왜 그런지',
      '② 이 책을 다 읽고 나서 <strong>얻었으면 하는 것 한 가지</strong>',
      '이 두 가지를 오늘의 인증으로 남겨 주세요. 28일 뒤에 다시 읽어보면 재미있습니다.'
    ] }]
  ]
}];

/* ── 활성 시즌 고르기 ──────────────────────────────────────────
 * startsAt이 이미 지난 시즌 중 가장 나중 것. startsAt이 null이면 언제나 후보다.
 * 비교는 KST 벽시계 문자열끼리 한다 — startsAt을 KST로 적었으니, 지금 시각도
 * KST로 바꿔서 'YYYY-MM-DD HH:MM' 사전순으로 견주면 시간대 계산이 따로 필요 없다.
 */
CS.seasonNowKST = function (now) {
  // 'sv-SE' 로캘이 'YYYY-MM-DD HH:MM:SS' 형태를 주므로 사전순 비교가 곧 시간순 비교다.
  return new Date(now || Date.now())
    .toLocaleString('sv-SE', { timeZone: CS.COMMON.timezone })
    .replace(' ', 'T');
};

CS.pickSeason = function (nowKST, overrideId) {
  if (overrideId) {
    const forced = CS.SEASONS.find((s) => s.id === overrideId);
    if (forced) return forced;
  }
  const t = nowKST || CS.seasonNowKST();
  let picked = CS.SEASONS[0];
  CS.SEASONS.forEach((s) => {
    if (!s.startsAt || s.startsAt <= t) picked = s;
  });
  return picked;
};

/* 시연·테스트용 시즌 고정: 브라우저는 ?season=s1, Node는 CS_SEASON=s1 */
CS.seasonOverride = (function () {
  try {
    if (typeof location !== 'undefined' && location.search) {
      return new URLSearchParams(location.search).get('season') || '';
    }
    if (typeof process !== 'undefined' && process.env) return process.env.CS_SEASON || '';
  } catch (e) { /* 접근 불가한 환경이면 그냥 자동 선택 */ }
  return '';
})();

CS.SEASON = CS.pickSeason(CS.seasonNowKST(), CS.seasonOverride);

/* 앱 전체가 보는 설정 = 공통값 + 활성 시즌값.
 * 화면·서버 코드는 예전처럼 CS.CONFIG만 읽으면 되고, 시즌이 바뀌어도 고칠 곳이 없다. */
CS.CONFIG = Object.assign({}, CS.COMMON, CS.SEASON, { seasonId: CS.SEASON.id });

/* 지난 시즌이 잠겼는지. lockAt(KST)이 지나면 운영진 화면에서만 열 수 있다.
 * 다만 운영진이 "읽기 전용 공개"를 켜 두면(공유 flags.openSeasons) 누구나 볼 수 있되
 * 인증·추천 같은 쓰기는 모두 막힌다. 데이터 자체는 어느 쪽이든 그대로 남는다. */
CS.seasonLocked = function (season, nowKST) {
  if (!season || !season.lockAt) return false;
  return season.lockAt <= (nowKST || CS.seasonNowKST());
};

CS.seasonById = function (id) {
  return CS.SEASONS.find((s) => s.id === id) || null;
};

/* Firestore 컬렉션 이름에 시즌 접두사를 붙인다.
 * 시즌1은 dataPrefix가 비어 있어 예전 이름 그대로 — 기존 데이터를 옮길 필요가 없다. */
CS.collectionName = function (name) {
  const prefix = CS.CONFIG.dataPrefix;
  return prefix ? prefix + '_' + name : name;
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

