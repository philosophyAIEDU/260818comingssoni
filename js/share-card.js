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

  /** 이미지로 만들어 (1) 다운로드 폴더에 저장하고, (2) 새 탭에도 열어 길게 눌러(또는 우클릭해)
   *  갤러리에 저장할 수 있게 한다. 다운로드 폴더 파일은 기기·브라우저에 따라 카카오톡의
   *  "사진" 첨부(갤러리 기준)에는 안 보일 수 있어서, 갤러리 저장 경로를 함께 제공한다. */
  async function share(submission, meta) {
    // 팝업 차단을 피하려면 클릭과 같은 타이밍(비동기 작업 전)에 미리 빈 탭을 열어둬야 한다.
    const previewWin = window.open('', '_blank');

    let blob;
    try {
      blob = await build(submission, meta);
    } catch (err) {
      if (previewWin) previewWin.close();
      throw err;
    }
    if (!blob) {
      if (previewWin) previewWin.close();
      throw new Error('이미지를 만들지 못했습니다.');
    }
    const fileName = `인증-${safeFileName(submission.nickname)}-${submission.date || ''}.png`;
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();

    if (previewWin) {
      previewWin.document.title = fileName;
      previewWin.location.href = url;
    }

    // 새 탭에서도 봐야 하니 다운로드 링크보다 넉넉하게 유지한다.
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
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
          // 다운로드 폴더는 카카오톡 "사진" 첨부(갤러리 기준)에는 안 보일 수 있어서,
          // 갤러리에 확실히 저장되는 방법을 함께 안내한다.
          alert('이미지를 다운로드했어요. 새 탭에도 이미지를 열어뒀어요.\n\n'
            + '카카오톡으로 보내는 방법\n'
            + '① (추천) 새로 열린 탭의 이미지를 길게 눌러(PC는 마우스 오른쪽 버튼) "이미지 저장"을 선택하면 '
            + '갤러리에 저장되어, 카카오톡 사진 첨부로 바로 보낼 수 있어요.\n'
            + '② 또는 카카오톡 채팅방 + 버튼 → "파일"에서 방금 다운로드된 이미지를 찾아 첨부해도 됩니다.');
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
