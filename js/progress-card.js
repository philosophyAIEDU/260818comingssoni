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

  /** 다음 목표 한 줄 — 이모지 없이 짧게 */
  function nextText(d) {
    if (d.done >= d.total) return '28일 완주. 끝까지 해냈어요.';
    if (d.todayOpen && !d.todayDone) {
      return d.streak >= 1 ? `오늘 인증하면 ${d.streak + 1}일 연속이에요` : '오늘 인증으로 연속 기록을 시작해 보세요';
    }
    if (d.next) return `${d.next.need === 1 ? '하루' : `${d.next.need}일`}만 더 하면 ‘${d.next.label}’`;
    return '오늘도 잘하고 있어요';
  }

  function heroHtml(d, giftLeft) {
    const R = 54, C = 2 * Math.PI * R;
    const off = C * (1 - Math.min(1, d.pct / 100));
    return `
      <div class="hero-top">
        <div class="hero-ring" role="img" aria-label="완주율 ${d.pct}%">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle class="ring-track" cx="60" cy="60" r="${R}"/>
            <circle class="ring-bar" cx="60" cy="60" r="${R}" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
          </svg>
          <div class="ring-num"><b id="heroPct">${d.pct}<small>%</small></b><span>완주율</span></div>
        </div>
        <dl class="hero-meta">
          <div><dt>인증</dt><dd><b>${d.done}</b><span> / ${d.total}일</span></dd></div>
          <div><dt>연속</dt><dd><b class="hot">${d.streak}</b><span>일</span></dd></div>
          ${giftLeft != null ? `<div><dt>정리본까지 여유</dt><dd>${giftLeft >= 0 ? `<b>${giftLeft}</b><span>회</span>` : '<span>기준 지남</span>'}</dd></div>` : ''}
        </dl>
      </div>
      <p class="hero-next">${esc(nextText(d))}</p>
      <ul class="hero-badges" aria-label="배지">
        ${d.badges.map((b) => `<li class="${b.earned ? 'on' : ''}" title="${esc(b.label)}${b.earned ? ' — 획득' : ''}">${esc(b.label)}</li>`).join('')}
      </ul>
      <button type="button" class="hero-share" id="myCardShare"><svg class="ico" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2.6 5.6a1.4 1.4 0 0 1 1.4-1.4h1.3l1-1.4h3.4l1 1.4H12a1.4 1.4 0 0 1 1.4 1.4v5.8A1.4 1.4 0 0 1 12 12.8H4a1.4 1.4 0 0 1-1.4-1.4z"/><circle cx="8" cy="8.3" r="2.3"/></svg>인증 카드로 공유하기</button>`;
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

  const HOT = '#ff6a13';      // 형광 주황 — 카드에서 눈에 띄는 색은 이것 하나
  const INK = '#0b1538';      // 바탕 — 커밍쏜 네이비를 더 깊게

  async function drawCard(d, info) {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
    // 링 뒤로 아주 옅은 주황 빛 하나만
    const glow = ctx.createRadialGradient(W / 2, 600, 40, W / 2, 600, 520);
    glow.addColorStop(0, 'rgba(255,106,19,0.16)'); glow.addColorStop(1, 'rgba(255,106,19,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

    const pad = 88;
    const white = (a) => `rgba(255,255,255,${a})`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    // 머리 — 작은 영문 라벨 · 책 제목 · 이름
    ctx.fillStyle = white(0.5);
    ctx.font = `600 24px ${FONT}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
    ctx.fillText('PERSONAL MAKERS  READING', pad, 128);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 58px ${FONT}`;
    ctx.fillText(`『${info.book}』`, pad - 12, 206);
    ctx.fillStyle = white(0.68);
    ctx.font = `500 32px ${FONT}`;
    ctx.fillText(`${info.name}  ·  ${d.total}일 독서 기록`, pad, 258);

    const cover = await loadImg(info.cover);
    if (cover) {
      const cw = 112, ch = Math.round(cw * (cover.height / cover.width || 1.45));
      ctx.save(); roundRect(ctx, W - pad - cw, 92, cw, ch, 6); ctx.clip();
      ctx.drawImage(cover, W - pad - cw, 92, cw, ch); ctx.restore();
    }

    // 완주율 링 — 가는 선, 끝에 점 하나
    const cx = W / 2, cy = 610, R = 205;
    const end = -Math.PI / 2 + Math.PI * 2 * Math.min(1, d.pct / 100);
    ctx.lineWidth = 14; ctx.lineCap = 'round';
    ctx.strokeStyle = white(0.1);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    if (d.pct > 0) {
      ctx.strokeStyle = HOT;
      ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, end); ctx.stroke();
      ctx.fillStyle = HOT;
      ctx.beginPath(); ctx.arc(cx + R * Math.cos(end), cy + R * Math.sin(end), 15, 0, Math.PI * 2); ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 168px ${FONT}`;
    const num = String(d.pct);
    const nw = ctx.measureText(num).width;
    ctx.font = `700 64px ${FONT}`;
    const pw = ctx.measureText('%').width;
    const left = cx - (nw + pw + 6) / 2;
    ctx.textAlign = 'left';
    ctx.font = `700 168px ${FONT}`;
    ctx.fillText(num, left, cy + 52);
    ctx.fillStyle = HOT;
    ctx.font = `700 64px ${FONT}`;
    ctx.fillText('%', left + nw + 6, cy + 52);
    ctx.textAlign = 'center';
    ctx.fillStyle = white(0.55);
    ctx.font = `600 28px ${FONT}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
    ctx.fillText(d.done >= d.total ? '완 주' : '완 주 율', cx, cy + 112);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

    // 숫자 세 칸 — 인증 · 연속 · 배지
    const got = d.badges.filter((b) => b.earned);
    const cols = [
      [`${d.done}`, ` / ${d.total}`, '인증한 날'],
      [`${d.streak}`, '일', '연속'],
      [`${got.length}`, ` / ${d.badges.length}`, '배지'],
    ];
    const colW = (W - pad * 2) / 3;
    cols.forEach(([big, small, label], i) => {
      const x = pad + colW * i + colW / 2;
      ctx.font = `700 60px ${FONT}`;
      const bw = ctx.measureText(big).width;
      ctx.font = `500 32px ${FONT}`;
      const sw = ctx.measureText(small).width;
      const sx = x - (bw + sw) / 2;
      ctx.textAlign = 'left';
      ctx.fillStyle = i === 1 && d.streak ? HOT : '#ffffff';
      ctx.font = `700 60px ${FONT}`;
      ctx.fillText(big, sx, 960);
      ctx.fillStyle = white(0.5);
      ctx.font = `500 32px ${FONT}`;
      ctx.fillText(small, sx + bw, 960);
      ctx.textAlign = 'center';
      ctx.fillStyle = white(0.5);
      ctx.font = `500 26px ${FONT}`;
      ctx.fillText(label, x, 1004);
    });
    // 칸 사이 가는 세로선
    ctx.strokeStyle = white(0.12); ctx.lineWidth = 2;
    [1, 2].forEach((i) => { const x = pad + colW * i; ctx.beginPath(); ctx.moveTo(x, 912); ctx.lineTo(x, 1010); ctx.stroke(); });

    // 28일 점 한 줄 — 한 날이 점 하나
    const n = info.cells.length;
    const span = W - pad * 2;
    const step = span / n;
    info.cells.forEach((c, i) => {
      const x = pad + step * i + step / 2, y = 1110;
      const isDone = c.status === 'O' || c.status === 'P';
      ctx.beginPath(); ctx.arc(x, y, isDone ? 9 : 7, 0, Math.PI * 2);
      if (isDone) { ctx.fillStyle = HOT; ctx.fill(); }
      else { ctx.lineWidth = 2.5; ctx.strokeStyle = c.date === info.today ? white(0.9) : white(0.25); ctx.stroke(); }
    });
    ctx.textAlign = 'left'; ctx.fillStyle = white(0.4); ctx.font = `500 22px ${FONT}`;
    ctx.fillText('DAY 1', pad, 1156);
    ctx.textAlign = 'right';
    ctx.fillText(`DAY ${n}`, W - pad, 1156);

    // 바닥줄 — 가는 선 위에 날짜 · 해시태그
    ctx.strokeStyle = white(0.12); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pad, 1222); ctx.lineTo(W - pad, 1222); ctx.stroke();
    ctx.font = `500 26px ${FONT}`;
    ctx.fillStyle = white(0.5);
    ctx.textAlign = 'left';
    ctx.fillText(info.dateLabel, pad, 1272);
    ctx.textAlign = 'right';
    ctx.fillText(info.tag, W - pad, 1272);

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
