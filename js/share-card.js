/* 인증글을 텍스트로 클립보드에 복사할 수 있게 한다.
 * index.html(js/app.js)과 feed-all.html(js/feed-all.js)이 함께 사용한다.
 *
 * 처음엔 캔버스로 이미지 카드를 그려 다운로드하는 방식이었는데, 카카오톡 인앱 브라우저 등
 * 일부 환경에서 다운로드한 이미지가 파일·갤러리로 잘 이어지지 않는다는 문제가 반복됐고,
 * 후기를 길게 남기는 참여자에게는 이미지보다 텍스트가 더 유용하다는 의견이 있어 — 이미지
 * 대신 인증 내용을 그대로 텍스트로 복사하는 방식으로 바꿨다. 버튼 클릭(사용자 동작) 시점에
 * 바로 실행되어, 카카오톡 인앱 브라우저를 포함한 대부분의 환경에서 안정적으로 동작한다. */
window.CS = window.CS || {};

CS.ShareCard = (function () {
  /** submission: { nickname, date, sentence, reflection, isWinner }
   *  meta: { title, dateLabel } */
  function buildText(submission, meta) {
    meta = meta || {};
    const heading = (submission.isWinner ? '👑 ' : '') + `참여자 ${submission.nickname || ''}님의 인사이트`;
    return [
      `📖 ${meta.title || '독서 챌린지'} · ${meta.dateLabel || submission.date || ''}`,
      heading,
      '',
      `“${submission.sentence || ''}”`,
      '',
      '느낀 점',
      submission.reflection || ''
    ].join('\n');
  }

  /** 클립보드로 텍스트를 복사한다. Clipboard API를 우선 쓰고, 지원하지 않는 환경(구형
   *  브라우저·일부 인앱 브라우저)에서는 숨긴 textarea + execCommand('copy')로 대신한다. */
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (err) {
      // 아래 폴백으로 이어짐
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    ta.remove();
    if (!ok) throw new Error('클립보드 복사에 실패했습니다. 직접 선택해서 복사해 주세요.');
  }

  function submissionFromDataset(ds) {
    return {
      nickname: ds.nickname || '',
      date: ds.date || '',
      sentence: ds.sentence || '',
      reflection: ds.reflection || '',
      isWinner: ds.winner === '1'
    };
  }

  /** container 안의 [data-share] 버튼들에 텍스트 복사 동작을 연결한다. */
  function bindButtons(container, meta) {
    container.querySelectorAll('[data-share]').forEach((btn) => {
      const original = btn.textContent;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const text = buildText(submissionFromDataset(btn.dataset), meta);
          await copyToClipboard(text);
          btn.textContent = '✅ 복사 완료';
        } catch (err) {
          alert('텍스트 복사에 실패했습니다: ' + err.message);
        } finally {
          setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1200);
        }
      });
    });
  }

  return { buildText, bindButtons };
})();
