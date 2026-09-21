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
  appUrl: 'https://personalmakersbook.netlify.app/', // 인증 알림 메일에 안내할 앱 주소
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
  label: '시즌 0',                 // 운영진 화면에서 부르는 이름
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
  // 규칙 위에 나란히 놓이는 바깥 링크 버튼들. 비워 두면 아무것도 안 나온다.
  headLinks: [],
  // '읽은 문장' 입력칸에 흐리게 보이는 예시
  reflectionPlaceholder: '짧아도 좋습니다. 오늘 독서 후 나에게 어떻게 적용할지 적어주세요.',
  sentencePlaceholder: 'ex) 사람들은 왜 프로세스에 이끌릴까. 이는 그 사람만이 가진 ‘왜’ 때문이다. '
    + '흔들리지 않는 그 사람의 ‘왜’와 ‘가치관’에 반하고, 자신도 이를 닮고 싶어 한다. '
    + '그렇기 때문에 기꺼이 프로세스 이코노미의 참가자가 되어주고, 나아가 세컨드 크리에이터가 '
    + '되어 응원해주는 것이다. - 185쪽',
  // 안내·규칙 카드에서 이 시즌에만 붙는 줄(공통 규칙 뒤에 이어진다)
  extraRules: [],
  startDate: '2026-08-24',        // 챌린지 시작일 (포함)
  endDate: '2026-09-20',          // 챌린지 종료일 (포함)
  // 누락 집계를 시작하는 날. 비워 두면 첫날부터 센다.
  gradeFrom: null,

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
  label: '시즌 1',
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
    note: '* 다시보기는 제공되지 않으니 꼭 시간내어 참여해주세요.'
  },
  rulesHeading: '안내 · 멤버십 규칙',
  // 일정표 안내: "오늘 범위에서 와닿은 한 문장 + 내 브랜드/일에 적용할 점"
  reflectionPlaceholder: '짧아도 좋습니다. 오늘 읽은 내용을 내 브랜드·일에 어떻게 적용할지 적어주세요.',
  sentencePlaceholder: 'ex) 오늘 범위에서 가장 와닿은 한 문장을 그대로 옮겨 적고, '
    + '끝에 쪽수를 붙여 주세요. (예: … - 47쪽)',
  headLinks: [
    { label: '독서 멤버십 OT 보기', icon: 'play',
      url: 'https://youtu.be/ny6lJ-8PMXI' },
    { label: '9월 퍼메스 독서 멤버십 설명서', icon: 'book',
      url: 'https://capable-hook-3dd.notion.site/9-3dff15a6c51c8170aeaaf9cbe0974f92' }
  ],
  extraRules: [
    '<strong>일요일은 새로 읽을 분량이 없습니다.</strong> 그날 오전 단톡방에 올라오는 <strong>발제문</strong>을 '
      + '보고 생각을 정리해 <strong>[읽고 느낀 점]</strong>에 남기면 그날 인증이 완료됩니다. '
      + '밀린 분량이 있다면 이날 따라잡아 주세요.',
    '인증을 놓쳐도 <strong>킥아웃되지 않습니다</strong>. 다만 28일 동안 <strong>누락이 6회 미만(5회 이하)</strong>이면 '
      + '커밍쏜이 직접 정리한 『꿈과 돈』 <strong>인사이트 정리본</strong>을 드립니다.',
    '이 일정표는 <strong>소미미디어 판(2025년 10월, 민경욱 역)</strong> 기준입니다. 다산북스 판(2024)도 '
      + '장 구분과 내용은 같으니 그대로 쓰셔도 되고, 일부 번역과 소제목만 다른 점 참고해 주세요.',
    '28일간 기록한 내용은 <strong>한 번에 내려받을 수</strong> 있습니다. 화면 맨 아래 <strong>[나의 현황]</strong>에서 '
      + '지금까지 몇 번 인증했고 몇 번 놓쳤는지도 확인할 수 있습니다.'
  ],
  startDate: '2026-09-21',
  endDate: '2026-10-18',
  // 1일차(9/21)는 단톡방 입장 당일이라 누락으로 세지 않는다. 낸 사람은 인증으로 인정된다.
  gradeFrom: '2026-09-22',

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

  // 운영진 공식 일정표(노션 "꿈과 돈 28일 챌린지 — 독서 일정표")를 그대로 옮긴 것.
  // 소제목 표기는 소미미디어판 기준이다.
  readingPlan: [
    /* ── 1주차 — 부유층의 생태계: 누가 꿈에 돈을 내는가 (머리말 + 1장) ── */
    [{ ch: '', s: [
      '🎯 <strong>책 준비 + 목차 전체 훑어보기</strong>',
      '① 목차에서 <strong>가장 기대되는 꼭지 한 가지</strong>와, 왜 그런지',
      '② 이번 책에서 <strong>내가 얻고 싶은 것 1가지</strong>를 선언하세요'
    ] }],
    [
      { ch: '', s: ['<strong>머리말</strong>'] },
      { ch: '1장', s: ['지식 부족으로 목숨을 잃지 마라', '‘고가 상품’에 불평하는 바보'] }
    ],
    [{ ch: '1장', s: ['부유층을 알고, ‘프리미엄’과 ‘럭셔리’의 차이를 알라', '‘꿈’의 계산식'] }],
    [{ ch: '1장', s: ['기능을 파니까 ‘싸다’라고 느끼는 거다', '당신의 도전에 큰돈을 내는 사람의 생활을 상상하라'] }],
    [{ ch: '1장', s: ['《번외편》 ‘탈노동집약형’과 ‘탈완판사고’ — 🌕 추석 당일, 가장 가벼운 분량입니다'] }],
    [{ ch: '2장', s: ['‘기능’이 돈이 안 된다는 사실을 받아들여라', '역사적 대패에서 배우는 ‘하이 스펙’과 ‘오버 스펙’'] }],
    [{ ch: '', s: ['🔴 <strong>라이브 1회차</strong> — 새로 읽을 분량은 없습니다. 연휴 마지막 날이니 밀린 분량을 따라잡아 주세요.', '오전에 올라오는 <strong>발제문</strong>을 보고 생각을 정리해 <strong>[읽고 느낀 점]</strong>에 남기면 오늘 인증 완료입니다.'] }],
    /* ── 2주차 — 커뮤니티: 기능이 아니라 사람을 팔아라 (2장 + 3장 도입) ── */
    [{ ch: '2장', s: ['‘기능 검색’에서 ‘사람 검색’으로', '‘올바른 서비스’보다 ‘마음을 훔치는 서비스’로'] }],
    [{ ch: '2장', s: ['시장 가격을 무시할 수 있는 ‘사람 검색’의 실제 예시', '핵심은 ‘고객의 팬덤화’'] }],
    [{ ch: '2장', s: ['‘응원할 여지’의 계산식', '‘팬 만들기’의 실제 예시'] }],
    [{ ch: '2장', s: ['커뮤니케이션은 어디에서 생기는 걸까?', '불편이 가져다주는 것'] }],
    [
      { ch: '2장', s: ['《번외편》 돈의 기초 ~빚은 나쁘다?'] },
      { ch: '3장', s: ['바다에 잠겨 있는 돈 이야기'] }
    ],
    [{ ch: '3장', s: ['새로운 문 앞에는 언제나 긴 설명이 있다', 'NFT를 엄청 간단하게 설명하겠다', '그림책 작가의 새로운 수입원'] }],
    [{ ch: '', s: ['🔴 <strong>라이브 2회차</strong> — 새로 읽을 분량은 없습니다. 밀린 분량이 있다면 오늘 따라잡아 주세요.', '오전에 올라오는 <strong>발제문</strong>을 보고 생각을 정리해 <strong>[읽고 느낀 점]</strong>에 남기면 오늘 인증 완료입니다.'] }],
    /* ── 3주차 — NFT와 시대: 꿈을 지키는 돈의 구조 (3장 + 맺음말) ── */
    [{ ch: '3장', s: ['NFT라는 럭셔리 상품', '돈 같은 ‘공동 환상’'] }],
    [{ ch: '3장', s: ['‘디지털 폭탄 돌리기’가 된 NFT', 'AI × NFT로 활동 자금을 만든다'] }],
    [{ ch: '3장', s: ['사람을 돕는 돈을 모으는 도구'] }],
    [{ ch: '3장', s: ['시대를 바르게 파악하라'] }],
    [{ ch: '맺음말', s: ['~꿈과 돈~ — 📗 <strong>1회독 완독일!</strong>'] }],
    [{ ch: '', s: [
      '📝 <strong>1회독 결산 — 내 밑줄 BEST 10 선정</strong>',
      '전체 밑줄 중 최고의 5문장을 골라 인증해주세요. (2회독과 마지막 라이브의 재료가 됩니다)',
      '못 읽은 부분이 있다면 오늘 마저!'
    ] }],
    [{ ch: '', s: ['🔴 <strong>라이브 3회차</strong> — 완독 기념. 새로 읽을 분량은 없습니다.', '오전에 올라오는 <strong>발제문</strong>을 보고 생각을 정리해 <strong>[읽고 느낀 점]</strong>에 남기면 오늘 인증 완료입니다.'] }],
    /* ── 4주차 — 2회독: 내 것으로 ──
     * 처음부터 새로 읽지 않는다. 1회독 때 친 밑줄을 중심으로 장 단위로 빠르게 다시 읽는다. */
    [{ ch: '2회독', s: ['<strong>1장 부유층의 생태계</strong> 전체'] }],
    [{ ch: '2회독', s: ['<strong>2장 전반</strong> (‘기능’이 돈이 안 된다 ~ ‘응원할 여지’의 계산식)'] }],
    [{ ch: '2회독', s: ['<strong>2장 후반</strong> (‘팬 만들기’의 실제 예시 ~ 《번외편》 돈의 기초)'] }],
    [{ ch: '2회독', s: ['<strong>3장 전반</strong> (바다에 잠겨 있는 돈 ~ 돈 같은 ‘공동 환상’)'] }],
    [{ ch: '2회독', s: ['<strong>3장 후반 + 맺음말</strong> (‘디지털 폭탄 돌리기’ ~ 끝)'] }],
    [{ ch: '', s: ['밑줄 총정리 · 🏆 <strong>28일 중 나의 최고 문장 1개 선정</strong>'] }],
    [{ ch: '', s: ['🔴 <strong>라이브 4회차</strong> — 마지막 시간입니다. 새로 읽을 분량은 없습니다.', '오전에 올라오는 <strong>발제문</strong>을 보고 생각을 정리해 <strong>[읽고 느낀 점]</strong>에 남기면 오늘 인증 완료입니다.'] }]
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

