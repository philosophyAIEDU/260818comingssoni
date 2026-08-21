/* 인증글을 이미지 카드로 만들어 다운로드할 수 있게 한다.
 * index.html(js/app.js)과 feed-all.html(js/feed-all.js)이 함께 사용한다.
 *
 * 처음엔 모바일에서 OS 공유 시트(navigator.share)로 바로 보내도록 만들었는데, 기기에 따라
 * 공유 시트가 어디로 갔는지 알기 어렵다는 피드백이 있어 — 모든 환경에서 항상 브라우저의
 * 표준 다운로드(다운로드 폴더에 저장)로 동작하도록 통일했다. 저장한 이미지는 카카오톡 등에서
 * 사진 첨부로 바로 보내면 된다. 별도 외부 서비스·API 키 없이 캔버스로 이미지를 그린다. */
window.CS = window.CS || {};

CS.ShareCard = (function () {
  const WIDTH = 720;
  const PAD = 48;
  const FONT = "'Pretendard', -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";

  /** 글자 단위로 줄바꿈한다 (한글은 띄어쓰기가 없어도 줄바꿈이 필요할 수 있어서). */
  function wrapLines(ctx, text, maxWidth) {
    const lines = [];
    String(text || '').split('\n').forEach((para) => {
      let line = '';
      for (const ch of para) {
        const test = line + ch;
        if (line && ctx.measureText(test).width > maxWidth) {
          lines.push(line);
          line = ch;
        } else {
          line = test;
        }
      }
      lines.push(line);
    });
    return lines;
  }

  function drawLines(ctx, lines, x, y, lineHeight) {
    lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
    return y + lines.length * lineHeight;
  }

  /** submission: { nickname, date, sentence, reflection, isWinner }
   *  meta: { title, dateLabel } */
  async function build(submission, meta) {
    meta = meta || {};
    const contentWidth = WIDTH - PAD * 2;
    const m = document.createElement('canvas').getContext('2d');

    const heading = (submission.isWinner ? '👑 ' : '') + `참여자 ${submission.nickname || ''}님의 인사이트`;
    m.font = `800 30px ${FONT}`;
    const headingLines = wrapLines(m, heading, contentWidth);
    m.font = `italic 700 26px ${FONT}`;
    const quoteLines = wrapLines(m, `“${submission.sentence || ''}”`, contentWidth);
    m.font = `400 22px ${FONT}`;
    const reflectionLines = wrapLines(m, submission.reflection || '', contentWidth);

    const headerH = 92;
    const headingLineH = 40;
    const nickH = headingLines.length * headingLineH + 14;
    const quoteLineH = 38;
    const quoteH = quoteLines.length * quoteLineH + 24;
    const reflectionLabelH = 32;
    const reflectionLineH = 32;
    const reflectionH = reflectionLines.length * reflectionLineH;
    const footerH = 60;
    const height = PAD + headerH + nickH + quoteH + reflectionLabelH + reflectionH + footerH + PAD;

    const scale = 2; // 레티나 화면에서도 선명하도록 2배 해상도로 그린다
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#173fa7');
    grad.addColorStop(1, '#081d58');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, height);

    let cy = PAD;
    ctx.fillStyle = '#ffe600';
    ctx.font = `700 20px ${FONT}`;
    ctx.fillText(meta.title || '독서 챌린지', PAD, cy + 22);
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.font = `400 17px ${FONT}`;
    ctx.fillText(meta.dateLabel || submission.date || '', PAD, cy + 50);
    cy += headerH;

    ctx.fillStyle = '#ffffff';
    ctx.font = `800 30px ${FONT}`;
    cy = drawLines(ctx, headingLines, PAD, cy + 28, headingLineH) + 14;

    ctx.fillStyle = '#ffe600';
    ctx.font = `italic 700 26px ${FONT}`;
    cy = drawLines(ctx, quoteLines, PAD, cy + 30, quoteLineH) + 14;

    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.font = `700 16px ${FONT}`;
    ctx.fillText('느낀 점', PAD, cy);
    cy += reflectionLabelH;

    ctx.fillStyle = '#ffffff';
    ctx.font = `400 22px ${FONT}`;
    drawLines(ctx, reflectionLines, PAD, cy + 2, reflectionLineH);

    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.font = `400 15px ${FONT}`;
    ctx.fillText('📖 ' + (meta.title || '독서 챌린지') + ' 인증', PAD, height - PAD + 8);

    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  function safeFileName(s) {
    return String(s || '').replace(/[^\w가-힣-]+/g, '') || 'card';
  }

  /** 이미지로 만들어 브라우저의 표준 다운로드(다운로드 폴더)로 저장한다. */
  async function share(submission, meta) {
    const blob = await build(submission, meta);
    if (!blob) throw new Error('이미지를 만들지 못했습니다.');
    const fileName = `인증-${safeFileName(submission.nickname)}-${submission.date || ''}.png`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'downloaded';
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

  /** container 안의 [data-share] 버튼들에 다운로드 동작을 연결한다. */
  function bindButtons(container, meta) {
    container.querySelectorAll('[data-share]').forEach((btn) => {
      const original = btn.textContent;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '⏳ 만드는 중…';
        try {
          await share(submissionFromDataset(btn.dataset), meta);
          btn.textContent = '✅ 내려받기 완료';
          // 버튼 문구만으로는 놓치기 쉬워서, 어디에 저장됐는지 분명하게 안내한다.
          alert('이미지를 다운로드 폴더에 저장했어요.\n'
            + '(브라우저의 다운로드 목록이나 기기의 "다운로드/Download" 폴더에서 찾을 수 있어요.)\n\n'
            + '카카오톡에서는 사진 첨부로 바로 보내면 됩니다.');
        } catch (err) {
          alert('다운로드 중 문제가 발생했습니다: ' + err.message);
        } finally {
          btn.textContent = original;
          btn.disabled = false;
        }
      });
    });
  }

  return { build, share, bindButtons };
})();
