/* [내 현황] 성취감 — 완주율 링 · 연속 · 배지 · 다음 목표, 그리고 SNS에 바로 올릴 "인증 카드" 이미지.
 *
 * app.js의 paintMine()이 집계(stat)를 넘기면 여기서 화면 윗부분(#myHero)을 그린다.
 * 인증 카드는 화면을 찍는 대신 canvas로 1080×1350(인스타 피드 4:5) 이미지를 직접 그린다 —
 * 기기마다 화면 캡처 결과가 달라지지 않고, 글자가 또렷하다.
 * 휴대폰에서는 공유 시트(카톡·인스타·사진에 저장)로 바로 넘기고, 안 되면 PNG로 내려받는다. */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const BADGES = [
    { k: 'first', e: '🌱', label: '첫 인증', kind: 'count', n: 1 },
    { k: 's3', e: '🔥', label: '3일 연속', kind: 'streak', n: 3 },
    { k: 's7', e: '⚡', label: '7일 연속', kind: 'streak', n: 7 },
    { k: 'half', e: '🏃', label: '절반 돌파', kind: 'count', n: 'half' },
    { k: 'd21', e: '💪', label: '21일 달성', kind: 'count', n: 21 },
    { k: 'all', e: '🏆', label: '완주', kind: 'count', n: 'all' },
  ];

  /** 집계 → 화면·카드에 쓸 숫자들. 면제일은 참여자에게 '통과'라 인증과 똑같이 센다. */
  function compute(stat, todayISO) {
    const cells = stat.cells || [];
    const total = cells.length || 28;
    const isDone = (c) => c.status === 'O' || c.status === 'P';
    const done = cells.filter(isDone).length;
    let run = 0, maxStreak = 0;
    for (const c of cells) {
      if (c.date > todayISO) break;
      if (isDone(c)) { run++; maxStreak = Math.max(maxStreak, run); }
      else if (c.date === todayISO && c.status === '-') { /* 오늘은 아직 마감 전 — 끊지 않는다 */ }
      else run = 0;
    }
    const todayCell = cells.find((c) => c.date === todayISO);
    const todayDone = !!todayCell && isDone(todayCell);
    const todayOpen = !!todayCell && todayCell.status === '-';
    const pct = Math.round((done / total) * 100);
    const target = (b) => (b.n === 'half' ? Math.ceil(total / 2) : b.n === 'all' ? total : b.n);
    const badges = BADGES.map((b) => {
      const t = target(b);
      const earned = b.kind === 'streak' ? maxStreak >= t : done >= t;
      return { ...b, target: t, earned };
    });
    // 다음 목표 — 가장 가까운 배지 하나
    const left = total - cells.filter((c) => c.date < todayISO || isDone(c)).length; // 아직 남은(인증 가능한) 날
    let next = null;
    for (const b of badges) {
      if (b.earned) continue;
      const need = b.kind === 'streak' ? b.target - stat.streak : b.target - done;
      if (need <= 0 || need > left) continue;
      if (!next || need < next.need) next = { ...b, need };
    }
    return {
      total, done, pct, missed: stat.missed || 0, streak: stat.streak || 0, maxStreak,
      badges, next, todayDone, todayOpen,
    };
  }

  /** 링 위의 큰 숫자 아래 한 줄 응원 */
  function cheer(d) {
    if (d.done >= d.total) return '완주';
    if (d.pct >= 75) return '거의 다 왔어요';
    if (d.pct >= 50) return '절반 넘었어요';
    if (d.pct >= 25) return '순항 중';
    return '완주까지';
  }

  function heroHtml(d, giftLeft) {
    const R = 52, C = 2 * Math.PI * R;
    const off = C * (1 - Math.min(1, d.pct / 100));
    const nl = d.done >= d.total ? '🏆 28일 완주! 끝까지 해낸 나를 자랑해 주세요.'
      : (d.todayOpen && !d.todayDone)
        ? (d.streak >= 1 ? `오늘 인증하면 🔥 ${d.streak + 1}일 연속이에요.` : '오늘 인증하고 다시 불을 붙여 보세요 🔥')
        : d.next ? `${d.next.need === 1 ? '하루' : `${d.next.need}일`}만 더 하면 ${d.next.e} ${d.next.label}`
          : '오늘도 한 페이지씩, 잘하고 있어요 👏';
    return `
      <div class="hero-top">
        <div class="hero-ring" role="img" aria-label="완주율 ${d.pct}%">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle class="ring-track" cx="60" cy="60" r="${R}"/>
            <circle class="ring-bar" cx="60" cy="60" r="${R}" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
          </svg>
          <div class="ring-num"><b id="heroPct">${d.pct}<small>%</small></b><span>${esc(cheer(d))}</span></div>
        </div>
        <div class="hero-side">
          <p class="hero-days"><b>${d.done}</b> / ${d.total}일 인증</p>
          <p class="hero-streak">${d.streak ? `🔥 <b>${d.streak}일</b> 연속` : '🔥 연속 기록을 시작해 보세요'}</p>
          ${giftLeft != null ? `<p class="hero-gift">${giftLeft >= 0 ? `🎁 정리본까지 누락 여유 <b>${giftLeft}회</b>` : '🎁 이번 시즌 정리본 기준은 지났어요'}</p>` : ''}
        </div>
      </div>
      <p class="hero-next">${esc(nl)}</p>
      <ul class="hero-badges" aria-label="배지">
        ${d.badges.map((b) => `<li class="${b.earned ? 'on' : ''}" title="${esc(b.label)}${b.earned ? ' — 획득' : ''}"><span class="b-e">${b.e}</span><span class="b-l">${esc(b.label)}</span></li>`).join('')}
      </ul>
      <button type="button" class="primary hero-share" id="myCardShare">📸 인증 카드 만들기 · SNS 공유</button>`;
  }

  /* ── 인증 카드 이미지 (canvas) ── */
  const W = 1080, H = 1350;
  const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';

  function loadImg(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = src;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  async function drawCard(d, info) {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    // 바탕 — 커밍쏜 네이비 → 블루
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#0b1f63'); g.addColorStop(1, '#173fa7');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // 은은한 원 장식
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath(); ctx.arc(W - 80, 120, 260, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(60, H - 60, 200, 0, Math.PI * 2); ctx.fill();

    const pad = 80;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = `600 34px ${FONT}`;
    ctx.fillText(info.title, pad, 120);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 64px ${FONT}`;
    ctx.fillText(`『${info.book}』`, pad - 14, 210);
    ctx.font = `500 40px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(`${info.name}님의 ${d.total}일 독서 기록`, pad, 274);

    // 표지
    const cover = await loadImg(info.cover);
    if (cover) {
      const cw = 150, ch = Math.round(cw * (cover.height / cover.width || 1.45));
      ctx.save(); roundRect(ctx, W - pad - cw, 70, cw, ch, 10); ctx.clip();
      ctx.drawImage(cover, W - pad - cw, 70, cw, ch); ctx.restore();
    }

    // 완주율 링
    const cx = W / 2, cy = 545, R = 195;
    ctx.lineWidth = 34; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ffe600';
    ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, d.pct / 100)); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 150px ${FONT}`;
    ctx.fillText(`${d.pct}%`, cx, cy + 40);
    ctx.font = `600 40px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(d.done >= d.total ? '완주!' : '완주율', cx, cy + 100);

    ctx.font = `700 46px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${d.done} / ${d.total}일 인증${d.streak ? `  ·  🔥 ${d.streak}일 연속` : ''}`, cx, 835);

    // 28일 도장판 — 4줄 × 7칸
    const cols = 7, cell = 64, gap = 22;
    const gw = cols * cell + (cols - 1) * gap;
    const gx = (W - gw) / 2, gy = 880;
    info.cells.forEach((c, i) => {
      const x = gx + (i % cols) * (cell + gap) + cell / 2;
      const y = gy + Math.floor(i / cols) * (cell + 12) + cell / 2;
      const isDone = c.status === 'O' || c.status === 'P';
      ctx.beginPath(); ctx.arc(x, y, cell / 2 - 4, 0, Math.PI * 2);
      if (isDone) { ctx.fillStyle = '#ffe600'; ctx.fill(); }
      else { ctx.lineWidth = 4; ctx.strokeStyle = c.date === info.today ? '#ffffff' : 'rgba(255,255,255,0.28)'; ctx.stroke(); }
      if (isDone) {
        ctx.strokeStyle = '#0b1f63'; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(x - 13, y + 1); ctx.lineTo(x - 3, y + 11); ctx.lineTo(x + 15, y - 10); ctx.stroke();
      }
    });

    // 배지(얻은 것만)
    const got = d.badges.filter((b) => b.earned);
    if (got.length) {
      ctx.font = `600 32px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(got.map((b) => `${b.e} ${b.label}`).join('   '), cx, 1240);
    }
    // 바닥줄
    ctx.font = `500 28px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.textAlign = 'left';
    ctx.fillText(info.dateLabel, pad, H - 40);
    ctx.textAlign = 'right';
    ctx.fillText(info.tag, W - pad, H - 40);

    return new Promise((resolve) => cv.toBlob((b) => resolve({ blob: b, url: cv.toDataURL('image/png') }), 'image/png'));
  }

  /* ── 미리보기 · 저장 · 공유 ── */
  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  function openPreview(img, filename, shareText) {
    let box = document.getElementById('cardPreview');
    if (box) box.remove();
    box = document.createElement('div');
    box.id = 'cardPreview';
    box.className = 'card-preview';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', '인증 카드');
    const file = new File([img.blob], filename, { type: 'image/png' });
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    box.innerHTML = `
      <div class="cp-sheet">
        <img src="${img.url}" alt="내 독서 인증 카드">
        <p class="cp-tip">이미지를 길게 누르면 사진에 바로 저장할 수도 있어요.</p>
        <div class="cp-acts">
          ${canShare ? '<button type="button" class="primary" data-cp="share">공유하기 (인스타·카톡)</button>' : ''}
          <button type="button" class="${canShare ? '' : 'primary'}" data-cp="save">이미지 저장</button>
          <button type="button" data-cp="close">닫기</button>
        </div>
      </div>`;
    document.body.appendChild(box);
    const close = () => box.remove();
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    box.querySelector('[data-cp="close"]').addEventListener('click', close);
    box.querySelector('[data-cp="save"]').addEventListener('click', () => download(img.blob, filename));
    const sh = box.querySelector('[data-cp="share"]');
    if (sh) sh.addEventListener('click', async () => {
      try { await navigator.share({ files: [file], text: shareText }); } catch (e) { /* 사용자가 닫음 */ }
    });
  }

  /** paintMine()에서 부른다 */
  function paint(stat, p, ctx) {
    const box = document.getElementById('myHero');
    if (!box) return;
    const today = ctx.today;
    const d = compute(stat, today);
    const limit = ctx.giftMissLimit;
    const giftLeft = limit ? (limit - 1) - d.missed : null;
    box.innerHTML = heroHtml(d, giftLeft);
    box.hidden = false;
    const btn = document.getElementById('myCardShare');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const idx = ctx.dayIndex(today);
        const img = await drawCard(d, {
          title: ctx.title, book: ctx.book, cover: ctx.cover, name: p.nickname, cells: stat.cells, today,
          dateLabel: `${today.replace(/-/g, '.')}${idx ? ` · ${idx}일차` : ''}`,
          tag: ctx.tag,
        });
        openPreview(img, `${ctx.book}_인증카드_${p.nickname}_${today}.png`,
          `『${ctx.book}』 ${d.total}일 독서 ${d.done}일째 · 완주율 ${d.pct}% ${ctx.tag}`);
      } finally { btn.disabled = false; }
    });
  }

  window.CS = window.CS || {};
  window.CS.Progress = { compute, paint, drawCard };
})();
