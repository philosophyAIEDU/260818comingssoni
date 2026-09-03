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

  return {
    fill,
    defaultKickoutSubject, defaultKickoutBody,
    defaultMissed5Subject, defaultMissed5Body
  };
})();
