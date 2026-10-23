/* [웹앱 설치] — 누르면 기기에서 할 수 있는 가장 빠른 방법으로 설치까지 데려간다.
 *
 * - 크롬·삼성 인터넷·엣지: 서비스 워커(sw.js)가 있으면 브라우저가 설치 창을 준비해 둔다(beforeinstallprompt).
 *   버튼 한 번에 그 창을 띄운다 → [설치]만 누르면 끝.
 * - 카카오톡 등 앱 안 브라우저: 거기서는 설치가 안 된다. 안드로이드는 크롬으로, 아이폰은 사파리로 이 페이지를
 *   바로 넘겨 열고(?install=1), 넘어간 쪽에서 설치 단계를 이어서 보여 준다.
 * - 아이폰·아이패드: 애플이 자동 설치를 막아 두어 [공유 → 홈 화면에 추가]를 그림 안내로 보여 준다.
 * - 그 밖: 브라우저 메뉴의 설치 항목을 안내한다. */
(() => {
  const card = document.getElementById('installCard');
  const button = document.getElementById('installApp');
  if (!card || !button) return;
  const standalone = window.matchMedia('(display-mode: standalone)');
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isKakao = /KAKAOTALK/i.test(ua);
  const isInApp = isKakao || /Instagram|FBAN|FBAV|NAVER\(inapp|Line\/|DaumApps|Whale\/.*inapp|; wv\)/i.test(ua);
  const isIOSOtherBrowser = isIOS && /CriOS|FxiOS|EdgiOS|Whale/i.test(ua);
  let installPrompt = null;
  let waiting = null; // 버튼을 눌렀는데 설치 창이 아직 준비 전이면 잠깐 기다린다

  const refresh = () => { card.hidden = standalone.matches || navigator.standalone === true; };
  refresh();
  standalone.addEventListener('change', refresh);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* 없어도 사이트는 그대로 쓴다 */ });
  }
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    if (waiting) { waiting(event); waiting = null; }
    if (fromRedirect) showSheet('ready'); // 카톡에서 넘어왔으면 "지금 설치" 한 번으로
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    card.hidden = true;
    closeSheet();
  });

  /* ── 안내 창 ── */
  let sheet = null;
  function closeSheet() { if (sheet && sheet.open) sheet.close(); }
  const STEPS = {
    ios: {
      title: '아이폰 홈 화면에 추가하기',
      lead: '아이폰은 버튼만으로 설치할 수 없어서, 사파리에서 아래 세 단계만 눌러 주세요.',
      steps: [['⬆️', '화면 아래(또는 위)의 공유 버튼 □↑을 눌러요', '안 보이면 주소창 옆 ··· 버튼 안에 있어요'], ['➕', '목록을 내려 “홈 화면에 추가”를 눌러요', ''], ['✅', '오른쪽 위 “추가”를 누르면 끝!', '홈 화면의 파란 아이콘으로 바로 열려요']]
    },
    iosOther: {
      title: '홈 화면에 추가하기',
      lead: '주소창 오른쪽의 공유 버튼을 눌러 홈 화면에 추가해 주세요. 잘 안 되면 사파리에서 열어 주세요.',
      steps: [['⬆️', '주소창 오른쪽 공유 버튼 □↑을 눌러요', ''], ['➕', '“홈 화면에 추가”를 눌러요', ''], ['✅', '“추가”를 누르면 끝!', '']]
    },
    android: {
      title: '홈 화면에 설치하기',
      lead: '브라우저 메뉴에서 바로 설치할 수 있어요.',
      steps: [['⋮', '오른쪽 위 메뉴(⋮)를 눌러요', '삼성 인터넷은 아래 ☰ 메뉴'], ['📲', '“앱 설치” 또는 “홈 화면에 추가”를 눌러요', ''], ['✅', '“설치”를 누르면 끝!', '']]
    },
    desktop: {
      title: '컴퓨터에 설치하기',
      lead: '크롬·엣지 주소창 오른쪽의 설치 아이콘을 누르면 바로 설치돼요.',
      steps: [['⊕', '주소창 오른쪽 설치 아이콘(모니터·⊕ 모양)을 눌러요', '안 보이면 메뉴(⋮) → “앱 설치”'], ['✅', '“설치”를 누르면 끝!', '']]
    },
    inapp: {
      title: '사파리에서 열어 주세요',
      lead: '이 앱 안의 브라우저에서는 설치가 안 돼요. 사파리에서 열면 바로 이어서 안내해 드릴게요.',
      steps: [['···', '오른쪽 아래(또는 위) ··· 메뉴를 눌러요', ''], ['🧭', '“Safari로 열기” 또는 “기본 브라우저로 열기”를 눌러요', ''], ['➕', '사파리에서 [웹앱 설치]를 한 번 더 눌러요', '']]
    }
  };
  function showSheet(kind) {
    if (!sheet) {
      sheet = document.createElement('dialog');
      sheet.className = 'install-sheet';
      sheet.id = 'installSheet';
      sheet.setAttribute('aria-labelledby', 'installSheetTitle');
      sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); }); // 바깥 누르면 닫기
      document.body.append(sheet);
    }
    const box = document.createElement('div');
    box.className = 'install-sheet-box';
    const head = document.createElement('div');
    head.className = 'install-sheet-head';
    const icon = document.createElement('img');
    icon.src = 'icons/icon-192.png?v=blue-logo-2'; icon.alt = ''; icon.width = 44; icon.height = 44;
    const title = document.createElement('h2'); title.id = 'installSheetTitle';
    head.append(icon, title);
    const lead = document.createElement('p'); lead.className = 'install-sheet-lead';
    box.append(head, lead);
    if (kind === 'ready') {
      title.textContent = '설치 준비가 끝났어요';
      lead.textContent = '아래 버튼을 누르고 [설치]를 선택하면 홈 화면에 파란 아이콘이 생겨요.';
      const go = document.createElement('button'); go.type = 'button'; go.className = 'primary install-sheet-go'; go.textContent = '지금 설치하기';
      go.addEventListener('click', () => { closeSheet(); install(); });
      box.append(go);
    } else {
      const info = STEPS[kind];
      title.textContent = info.title;
      lead.textContent = info.lead;
      const ol = document.createElement('ol'); ol.className = 'install-steps';
      info.steps.forEach(([mark, text, sub]) => {
        const li = document.createElement('li');
        const m = document.createElement('span'); m.className = 'install-step-mark'; m.setAttribute('aria-hidden', 'true'); m.textContent = mark;
        const t = document.createElement('span'); t.className = 'install-step-text'; t.textContent = text;
        if (sub) { const s = document.createElement('small'); s.textContent = sub; t.append(s); }
        li.append(m, t); ol.append(li);
      });
      box.append(ol);
    }
    const close = document.createElement('button'); close.type = 'button'; close.className = 'install-sheet-close'; close.textContent = '닫기';
    close.addEventListener('click', closeSheet);
    box.append(close);
    sheet.replaceChildren(box);
    sheet.dataset.kind = kind;
    if (!sheet.open) sheet.showModal();
  }

  /* ── 앱 안 브라우저에서 바깥 브라우저로 넘기기 ── */
  function externalUrl() {
    const u = new URL(location.href);
    u.searchParams.set('install', '1');
    return u.href;
  }
  function openOutside() {
    const target = externalUrl();
    let jump = '';
    if (isAndroid) {
      const u = new URL(target);
      jump = `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(target)};end`;
    } else if (isKakao) {
      jump = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(target);
    }
    if (!jump) return false;
    document.documentElement.dataset.installRedirect = jump; // 테스트·문제 확인용
    location.href = jump;
    return true;
  }

  async function install() {
    let prompt = installPrompt;
    if (!prompt && !isIOS && !isInApp && 'serviceWorker' in navigator) {
      // 서비스 워커를 막 등록한 첫 방문이면 설치 창이 1~2초 늦게 준비된다
      button.disabled = true;
      prompt = await new Promise((resolve) => { waiting = resolve; setTimeout(() => resolve(null), 2500); });
      waiting = null;
      button.disabled = false;
    }
    if (prompt) {
      installPrompt = null;
      button.disabled = true;
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice && choice.outcome === 'accepted') card.hidden = true;
      } catch {
        showSheet(isIOS ? 'ios' : isAndroid ? 'android' : 'desktop');
      } finally { button.disabled = false; }
      return;
    }
    if (isInApp) {
      if (openOutside()) return;
      showSheet('inapp');
      return;
    }
    if (isIOS) { showSheet(isIOSOtherBrowser ? 'iosOther' : 'ios'); return; }
    showSheet(isAndroid ? 'android' : 'desktop');
  }
  button.addEventListener('click', install);

  // 카톡 등에서 넘어온 경우: 주소의 ?install=1을 지우고 이어서 안내한다
  const params = new URLSearchParams(location.search);
  const fromRedirect = params.get('install') === '1';
  if (fromRedirect) {
    params.delete('install');
    try { history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash); } catch { /* 무시 */ }
    if (!card.hidden) {
      if (installPrompt) showSheet('ready');
      else if (isIOS) showSheet(isIOSOtherBrowser ? 'iosOther' : 'ios');
      // 안드로이드 크롬은 설치 창이 준비되는 순간(beforeinstallprompt) "지금 설치" 창을 띄운다
    }
  }
})();
