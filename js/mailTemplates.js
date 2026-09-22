/* 자동/수동으로 나가는 안내 메일의 기본 제목·본문 + {{자리표시자}} 치환 로직을 한 곳에 모아둔다.
 *
 * 왜 따로 파일을 뒀는가: 운영진 화면(admin.js, 브라우저)의 "문구 편집" 화면에 보이는 기본값과,
 * Netlify 예약 함수(Node)가 실제로 발송할 때 쓰는 기본값이 서로 다른 코드에 따로 적혀 있으면
 * 언젠가 둘이 어긋난다("화면엔 이렇게 뜨는데 실제로는 다른 문구가 나갔다"). 이 파일 하나를
 * 브라우저에서는 <script> 태그로, Node에서는 netlify/functions/_lib/appLogic.js가 require해서
 * 똑같이 불러 쓰면 그럴 일이 없다.
 *
 * config.js·utils.js와 마찬가지로 window.CS 네임스페이스에 얹는 브라우저 스타일 파일이다 —
 * Node에서 쓰는 방법은 appLogic.js의 주석을 참고.
 */
window.CS = window.CS || {};

CS.MailTemplates = (function () {
  /** raw 안의 {{키}} 자리표시자를 vars[키] 값으로 전부 바꾼다. */
  function fill(raw, vars) {
    let out = raw;
    for (const key of Object.keys(vars)) {
      out = out.split(`{{${key}}}`).join(String(vars[key]));
    }
    return out;
  }

  /* ── 킥아웃 통보 메일(관리자가 킥아웃 처리 후 [메일 작성]으로 직접 확인·발송) ── */
  function defaultKickoutSubject() {
    return `[${CS.CONFIG.title}] 챌린지 참여 종료 안내`;
  }
  function defaultKickoutBody() {
    return [
      '안녕하세요 {{이름}} 님, 퍼스널메이커스입니다.',
      '',
      '{{이름}}님은 이번 독서챌린지의 킥아웃 기준인 인증 누락 {{킥아웃기준}}회가 되어, ' +
        '아쉽게도 챌린지에서 더이상 참여가 어렵습니다.',
      '',
      '하지만 다음 챌린지가 오픈될때  얼마든 신청 가능하십니다. 참여 준비가 되셨을 때 다시 더 좋은 기회로 함께 했으면 좋겠습니다.',
      '',
      '감사합니다.',
      '',
      '퍼스널메이커스 드림.'
    ].join('\n');
  }

  /* ── 미인증 5회 자동 경고 메일(Netlify 예약 함수가 매일 자동으로 발송) ── */
  function defaultMissed5Subject() {
    return `[${CS.CONFIG.title}] 미인증 안내드립니다`;
  }
  function defaultMissed5Body() {
    return [
      '안녕하세요, {{이름}}님. 퍼스널메이커스입니다.',
      '',
      '먼저 그동안 독서챌린지에 함께해 주셔서 진심으로 감사드립니다.',
      '',
      '다름이 아니라 확인해 보니 {{이름}}님의 누적 미인증 횟수가 {{자동경고기준}}회가 되어 조심스럽게 안내드립니다. ' +
        '챌린지 운영 기준상 누적 미인증이 {{킥아웃기준}}회가 되면 아쉽게도 더 이상 함께하기 어려울 수 있어, ' +
        '혹시 놓치신 부분은 없으신지 여쭙고 싶어 메일 드립니다.',
      '',
      '바쁘신 와중에도 조금만 더 신경 써 챙겨 주시면 정말 감사하겠습니다. 혹시 개인 사정으로 인증이 어려우신 날이 ' +
        '있다면 운영진에게 미리 말씀해 주세요 — 면제 처리를 도와드릴 수 있습니다.',
      '',
      '앞으로도 끝까지 함께해 주시길 바라는 마음으로 안내드립니다. 감사합니다.',
      '',
      '인증하러 가기 → {{앱주소}}',
      '',
      '퍼스널메이커스 드림.'
    ].join('\n');
  }

  /* ── 누락 5회 자동 안내(킥아웃이 없는 시즌 — "한 번 더 놓치면 정리본을 못 받아요") ──
   *  같은 예약 함수(send-missed5-warning)가 giftMissLimit이 있는 시즌에서는 이 문구를 쓴다.
   *  누락이 정확히 (giftMissLimit - 1)회가 된 사람에게 한 번 나간다. */
  function defaultGiftWarnSubject() {
    return `[${CS.CONFIG.title}] 인증 누락 {{누락횟수}}회 — 한 번 더 놓치면 정리본을 못 받아요`;
  }
  function defaultGiftWarnBody() {
    return [
      '안녕하세요, {{이름}}님. 퍼스널메이커스입니다.',
      '',
      '확인해 보니 {{이름}}님의 인증 누락이 {{누락횟수}}회가 되어 살짝 알려드립니다.',
      '',
      '이번 멤버십은 킥아웃이 없습니다. 다만 누락이 {{선물기준}}회 미만이어야 ' +
        '커밍쏜이 직접 정리한 『{{책이름}}』 인사이트 정리본을 받으실 수 있어요. ' +
        '지금 딱 경계에 계십니다 — 한 번만 더 놓치면 정리본 대상에서 빠집니다.',
      '',
      '남은 날은 하루도 놓치지 않으셨으면 합니다. 짧아도 괜찮아요. 오늘 읽은 문장 한 줄과 느낀 점이면 충분합니다.',
      '혹시 개인 사정으로 어려운 날이 있다면 운영진에게 미리 말씀해 주세요 — 면제 처리를 도와드릴 수 있습니다.',
      '',
      '인증하러 가기 → {{앱주소}}',
      '',
      '퍼스널메이커스 드림.'
    ].join('\n');
  }

  /* ── 당일 인증 리마인드 메일(Netlify 예약 함수가 매일 21시 KST에 발송) ── */
  function defaultReminderSubject() {
    return `[${CS.CONFIG.title}] 오늘 인증 아직이에요 🙌`;
  }
  function defaultReminderBody() {
    return [
      '안녕하세요, {{이름}}님. 퍼스널메이커스입니다.',
      '',
      '{{날짜}} 인증이 아직 등록되지 않아 살짝 알려드립니다.',
      '마감은 오늘 밤 23:59이고, 지금은 {{남은시간}} 남았습니다.',
      '',
      '오늘 읽은 문장 한 줄과 느낀 점이면 충분합니다. 잠깐이면 끝나요!',
      '',
      '인증하러 가기 → {{앱주소}}',
      '',
      '이미 인증을 마치셨다면 이 메일은 지나쳐 주세요.',
      '',
      '퍼스널메이커스 드림.'
    ].join('\n');
  }

  /* ── 리마인드의 "경계" 판 — 누락이 이미 (giftMissLimit - 1)회라 오늘 놓치면 정리본을 못 받는 사람에게,
   *  21시 리마인드가 일반 문구 대신 이 문구로 나간다. 매일, 인증할 때까지. */
  function defaultReminderUrgentSubject() {
    return `[${CS.CONFIG.title}] 오늘 놓치면 정리본을 못 받아요 — {{남은시간}} 남았습니다`;
  }
  function defaultReminderUrgentBody() {
    return [
      '안녕하세요, {{이름}}님. 퍼스널메이커스입니다.',
      '',
      '{{날짜}} 인증이 아직 등록되지 않았습니다. 마감은 오늘 밤 23:59, 지금 {{남은시간}} 남았습니다.',
      '',
      '{{이름}}님은 지금 누락 {{누락횟수}}회입니다. 오늘까지 놓치면 {{선물기준}}회가 되어 ' +
        '『{{책이름}}』 인사이트 정리본 대상에서 빠집니다.',
      '',
      '문장 한 줄, 느낀 점 한 줄이면 됩니다. 지금 잠깐이면 끝나요.',
      '',
      '인증하러 가기 → {{앱주소}}',
      '',
      '이미 인증을 마치셨다면 이 메일은 지나쳐 주세요.',
      '',
      '퍼스널메이커스 드림.'
    ].join('\n');
  }

  /* ── 🎁 정리본 발송 메일(운영진 화면 [선물 대상자 › 정리본 메일 보내기]) ── */
  function defaultGiftSubject() {
    return `[${CS.CONFIG.title}] 🎁 『{{책이름}}』 인사이트 정리본을 보내드립니다`;
  }
  function defaultGiftBody() {
    return [
      '안녕하세요, {{이름}}님. 커밍쏜입니다.',
      '',
      '{{일수}}일 동안 정말 고생 많으셨습니다. 누락 {{누락횟수}}회로 끝까지 함께해 주셔서, ' +
        '약속드린 『{{책이름}}』 인사이트 정리본을 보내드립니다.',
      '',
      '정리본 보기 → {{정리본링크}}',
      '',
      '라이브 {{라이브횟수}}번에서 제가 말한 것 중 여러분 것으로 가져가셨으면 하는 것만 남겼습니다. ' +
        '한 꼭지라도 내 브랜드에 적용해 보시면, 이 책은 값을 한 겁니다.',
      '',
      '다음 달에도 함께 읽어요.',
      '',
      '결국, 그렇게 내가 주인공이 되는 시간이 커밍쏜.'
    ].join('\n');
  }

  return {
    fill,
    defaultKickoutSubject, defaultKickoutBody,
    defaultMissed5Subject, defaultMissed5Body,
    defaultReminderSubject, defaultReminderBody,
    defaultGiftWarnSubject, defaultGiftWarnBody,
    defaultReminderUrgentSubject, defaultReminderUrgentBody,
    defaultGiftSubject, defaultGiftBody
  };
})();
