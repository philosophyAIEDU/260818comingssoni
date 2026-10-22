/* 설치 창은 브라우저가 허용할 때만 연다. 그 외에는 기기에 맞는 추가 방법을 안내한다. */
(() => {
  const card = document.getElementById('installCard');
  const button = document.getElementById('installApp');
  const standalone = window.matchMedia('(display-mode: standalone)');
  let installPrompt = null;
  const refresh = () => { card.hidden = standalone.matches || navigator.standalone === true; };
  refresh();
  standalone.addEventListener('change', refresh);
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    card.hidden = true;
  });
  button.addEventListener('click', async () => {
    if (installPrompt) {
      const prompt = installPrompt;
      installPrompt = null;
      button.disabled = true;
      try {
        await prompt.prompt();
        await prompt.userChoice;
      } catch (error) {
        alert('브라우저 메뉴에서 “앱 설치” 또는 “홈 화면에 추가”를 선택해 주세요.');
      } finally { button.disabled = false; }
      return;
    }
    const ua = navigator.userAgent;
    if (/KAKAOTALK|Instagram|FBAN|FBAV|NAVER/i.test(ua)) {
      alert('현재 화면의 메뉴에서 “외부 브라우저로 열기”를 선택한 뒤 설치해 주세요.\n\n안드로이드: Chrome 메뉴(⋮) → 홈 화면에 추가 → 설치\n아이폰: Safari 공유 버튼 → 홈 화면에 추가');
    } else if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
      alert('Safari에서 아래 공유 버튼(□↑)을 누르고 “홈 화면에 추가” → “추가”를 선택해 주세요.');
    } else {
      alert('브라우저 메뉴(⋮)에서 “앱 설치” 또는 “홈 화면에 추가”를 선택해 주세요.\n\n설치 항목이 보이지 않으면 Chrome 또는 Samsung Internet에서 다시 열어주세요.');
    }
  });
})();
