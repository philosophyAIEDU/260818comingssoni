/* 운영진 [이용현황] 탭 — 사이트 체류·영상 시청·뉴스레터 읽기 시간을 기간별로 보여 준다.
 * 데이터: /.netlify/functions/analytics-report (운영진 로그인 토큰 필요). 모으는 쪽은 js/analytics.js.
 * 차트는 라이브러리 없이 SVG로 그린다 — 막대·선은 가늘게, 격자는 옅은 실선, 2개 이상 계열엔 범례,
 * 모든 차트에 마우스·키보드 툴팁과 "표로 보기"가 있다. 계열 색은 고정 순서(영상·뉴스레터·그 밖의 이용). */
(() => {
  const $ = (id) => document.getElementById(id);
  const panel = document.querySelector('[data-panel="usage"]');
  if (!panel) return;
  const SVG = 'http://www.w3.org/2000/svg';
  let days = 14, report = null, loading = false, loadedOnce = false, lastWidth = 0;

  /* ── 숫자·시간 표기 ── */
  const fmtNum = (n) => (n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'K' : Math.round(n).toLocaleString('ko-KR'));
  function fmtDur(sec) {
    sec = Math.round(sec || 0);
    if (sec < 60) return `${sec}초`;
    const m = Math.round(sec / 60);
    if (m < 60) return `${m}분`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h}시간 ${r}분` : `${h}시간`;
  }
  const minutes = (sec) => sec / 60;
  const shortDate = (iso) => { const [, m, d] = iso.split('-'); return `${+m}/${+d}`; };
  const weekday = (iso) => '일월화수목금토'[new Date(iso + 'T00:00:00Z').getUTCDay()];
  /** 눈금: 1·2·2.5·5 단위의 깔끔한 간격으로 4칸 안팎. minutes면 1시간이 넘을 때 시간 단위로 맞춘다. 정수만이면 2.5는 쓰지 않는다. */
  function niceScale(v, { minutes = false, integer = false } = {}) {
    if (minutes && v > 90) { const h = niceScale(v / 60); return { top: h.top * 60, step: h.step * 60 }; }
    if (v <= 0) return { top: integer ? 4 : 1, step: integer ? 1 : 0.25 };
    const raw = v / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    const steps = integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
    let step = steps.find((x) => f <= x) * p;
    if (integer) step = Math.max(1, Math.round(step));
    return { top: Math.ceil(v / step - 1e-9) * step, step };
  }
  /** 마지막 날짜는 늘 보이게 하되, 바로 앞 눈금과 겹치면 앞 것을 뺀다 */
  const showLabel = (i, n, every) => i === n - 1 || (i % every === 0 && n - 1 - i >= Math.ceil(every / 2));
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const svgEl = (tag, attrs) => { const e = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); return e; };

  /* ── 툴팁: 값이 앞, 이름이 뒤. 줄 앞의 짧은 선이 계열 색 ── */
  const tip = el('div', 'usage-tip'); tip.hidden = true; tip.setAttribute('role', 'status');
  function showTip(host, x, y, title, rows) {
    tip.replaceChildren(el('div', 'usage-tip-title', title), ...rows.map((r) => {
      const row = el('div', 'usage-tip-row');
      if (r.color) { const k = el('span', 'usage-tip-key'); k.style.background = r.color; row.append(k); }
      row.append(el('strong', '', r.value), el('span', '', r.name));
      return row;
    }));
    if (tip.parentElement !== host) host.append(tip);
    tip.hidden = false;
    const w = host.clientWidth, tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(w - tw, x - tw / 2)) + 'px';
    tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + 'px';
  }
  const hideTip = () => { tip.hidden = true; };

  /* ── 표로 보기(차트마다) ── */
  function tableView(headers, rows) {
    const d = el('details', 'usage-table'); d.append(el('summary', '', '표로 보기'));
    const t = el('table'); const tr = el('tr'); headers.forEach((h) => tr.append(el('th', '', h)));
    const thead = el('thead'); thead.append(tr); const tbody = el('tbody');
    rows.forEach((r) => { const row = el('tr'); r.forEach((c, i) => row.append(el(i ? 'td' : 'th', '', c))); tbody.append(row); });
    t.append(thead, tbody); d.append(t);
    return d;
  }
  function legend(series) {
    if (series.length < 2) return null;
    const l = el('div', 'usage-legend');
    series.forEach((s) => { const i = el('span', 'usage-legend-item'); const k = el('span', 'usage-swatch ' + (s.line ? 'line' : '')); k.style.background = s.color; i.append(k, document.createTextNode(s.name)); l.append(i); });
    return l;
  }
  const color = (n) => `var(--series-${n})`;

  /* ── 세로 막대(쌓기 가능). 막대는 최대 24px, 위쪽만 4px 둥글게, 쌓인 조각 사이 2px 틈 ── */
  function roundedTop(x, y, w, h, r) {
    r = Math.min(r, h, w / 2);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function columnChart(host, { labels, tipTitles, series, height = 220, format = (v) => fmtNum(v), axisFormat = format, labelEvery = 1, scale = {} }) {
    const width = Math.max(280, host.clientWidth || 600);
    const pad = { t: 12, r: 8, b: 26, l: 44 };
    const plotW = width - pad.l - pad.r, plotH = height - pad.t - pad.b;
    const totals = labels.map((_, i) => series.reduce((s, se) => s + (se.values[i] || 0), 0));
    const { top: max, step } = niceScale(Math.max(...totals), scale);
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'usage-svg', role: 'img' });
    for (let k = 0; k * step <= max + 1e-9; k++) {
      const v = step * k, y = pad.t + plotH - (v / max) * plotH;
      svg.append(svgEl('line', { x1: pad.l, x2: width - pad.r, y1: y, y2: y, class: k ? 'usage-grid' : 'usage-axis' }));
      const t = svgEl('text', { x: pad.l - 6, y: y + 4, class: 'usage-tick', 'text-anchor': 'end' }); t.textContent = axisFormat(v); svg.append(t);
    }
    const band = plotW / labels.length, barW = Math.max(2, Math.min(24, band * 0.62));
    labels.forEach((label, i) => {
      const cx = pad.l + band * i + band / 2;
      let base = pad.t + plotH;
      const visible = series.filter((s) => (s.values[i] || 0) > 0);
      visible.forEach((s, j) => {
        const h = ((s.values[i] || 0) / max) * plotH;
        const top = j === visible.length - 1;
        const gap = j > 0 ? 2 : 0; // 아래 조각과의 틈
        const segH = Math.max(0, h - gap);
        if (segH > 0) svg.append(svgEl('path', { d: top ? roundedTop(cx - barW / 2, base - h, barW, segH, 4) : `M${cx - barW / 2},${base - h}h${barW}v${segH}h${-barW}Z`, fill: s.color, class: 'usage-mark' }));
        base -= h;
      });
      if (showLabel(i, labels.length, labelEvery)) {
        const t = svgEl('text', { x: cx, y: height - 8, class: 'usage-tick', 'text-anchor': 'middle' }); t.textContent = label; svg.append(t);
      }
      // 칸 전체가 툴팁 대상(막대보다 넓게)
      const hit = svgEl('rect', { x: cx - band / 2, y: pad.t, width: band, height: plotH, class: 'usage-hit', tabindex: 0, 'aria-label': `${tipTitles ? tipTitles[i] : label}: ${series.map((s) => s.name + ' ' + format(s.values[i] || 0)).join(', ')}` });
      const show = () => {
        svg.querySelectorAll('.usage-hit.on').forEach((h) => h.classList.remove('on')); hit.classList.add('on');
        const rows = series.map((s) => ({ color: series.length > 1 ? s.color : null, value: format(s.values[i] || 0), name: s.name }));
        if (series.length > 1) rows.push({ value: format(totals[i]), name: '합계' });
        showTip(host, cx, pad.t + plotH - (totals[i] / max) * plotH, tipTitles ? tipTitles[i] : label, rows);
      };
      hit.addEventListener('pointerenter', show); hit.addEventListener('focus', show);
      hit.addEventListener('pointerleave', () => { hit.classList.remove('on'); hideTip(); }); hit.addEventListener('blur', () => { hit.classList.remove('on'); hideTip(); });
      svg.append(hit);
    });
    return svg;
  }

  /* ── 선(한 계열). 2px 선, 끝점 표시, 10% 면, 십자선이 가장 가까운 날짜를 찾는다 ── */
  function lineChart(host, { labels, tipTitles, values, name, height = 200, format = fmtNum, labelEvery = 1, scale = {} }) {
    const width = Math.max(280, host.clientWidth || 600);
    const pad = { t: 14, r: 14, b: 26, l: 44 };
    const plotW = width - pad.l - pad.r, plotH = height - pad.t - pad.b;
    const { top: max, step } = niceScale(Math.max(...values), scale);
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'usage-svg', role: 'img' });
    for (let k = 0; k * step <= max + 1e-9; k++) {
      const v = step * k, y = pad.t + plotH - (v / max) * plotH;
      svg.append(svgEl('line', { x1: pad.l, x2: width - pad.r, y1: y, y2: y, class: k ? 'usage-grid' : 'usage-axis' }));
      const t = svgEl('text', { x: pad.l - 6, y: y + 4, class: 'usage-tick', 'text-anchor': 'end' }); t.textContent = format(v); svg.append(t);
    }
    const x = (i) => pad.l + (labels.length < 2 ? plotW / 2 : (plotW * i) / (labels.length - 1));
    const y = (v) => pad.t + plotH - (v / max) * plotH;
    const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    svg.append(svgEl('polygon', { points: `${x(0)},${y(0)} ${pts} ${x(values.length - 1)},${y(0)}`, class: 'usage-area' }));
    svg.append(svgEl('polyline', { points: pts, class: 'usage-line' }));
    const last = values.length - 1;
    svg.append(svgEl('circle', { cx: x(last), cy: y(values[last]), r: 4, class: 'usage-dot' }));
    const endLabel = svgEl('text', { x: x(last) - 8, y: y(values[last]) - 10, class: 'usage-value', 'text-anchor': 'end' }); endLabel.textContent = format(values[last]); svg.append(endLabel);
    labels.forEach((label, i) => {
      if (showLabel(i, labels.length, labelEvery)) { const t = svgEl('text', { x: x(i), y: height - 8, class: 'usage-tick', 'text-anchor': 'middle' }); t.textContent = label; svg.append(t); }
    });
    const cross = svgEl('line', { y1: pad.t, y2: pad.t + plotH, class: 'usage-cross' }); cross.style.display = 'none';
    const focusDot = svgEl('circle', { r: 4, class: 'usage-dot' }); focusDot.style.display = 'none';
    const hit = svgEl('rect', { x: pad.l - 8, y: 0, width: plotW + 16, height, class: 'usage-hit', tabindex: 0, 'aria-label': `${name} — 좌우 화살표로 날짜 이동` });
    let idx = last;
    const show = (i) => {
      idx = Math.max(0, Math.min(last, i));
      cross.setAttribute('x1', x(idx)); cross.setAttribute('x2', x(idx)); cross.style.display = '';
      focusDot.setAttribute('cx', x(idx)); focusDot.setAttribute('cy', y(values[idx])); focusDot.style.display = '';
      showTip(host, x(idx), y(values[idx]), tipTitles ? tipTitles[idx] : labels[idx], [{ value: format(values[idx]), name }]);
    };
    const hide = () => { cross.style.display = 'none'; focusDot.style.display = 'none'; hideTip(); };
    hit.addEventListener('pointermove', (e) => { const r = svg.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * width; show(Math.round(((px - pad.l) / plotW) * last)); });
    hit.addEventListener('pointerleave', hide); hit.addEventListener('blur', hide); hit.addEventListener('focus', () => show(idx));
    hit.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); show(idx + (e.key === 'ArrowRight' ? 1 : -1)); } });
    svg.append(cross, focusDot, hit);
    return svg;
  }

  /* ── 가로 막대 목록(화면별·많이 본 콘텐츠). 값은 막대 끝에 ── */
  function barList(rows, { format = fmtDur } = {}) {
    const max = Math.max(...rows.map((r) => r.value), 1);
    const list = el('div', 'usage-bars');
    rows.forEach((r) => {
      const row = el('div', 'usage-bar-row');
      const name = el('div', 'usage-bar-name', r.name);
      if (r.sub) name.append(el('small', '', r.sub));
      const track = el('div', 'usage-bar-track');
      const fill = el('div', 'usage-bar-fill'); fill.style.width = Math.max(r.value > 0 ? 1.5 : 0, (r.value / max) * 100) + '%';
      track.append(fill, el('span', 'usage-bar-value', format(r.value)));
      row.append(name, track);
      row.tabIndex = 0;
      row.setAttribute('aria-label', `${r.name}: ${format(r.value)}${r.sub ? ' · ' + r.sub : ''}`);
      list.append(row);
    });
    return list;
  }

  function figure(title, sub) {
    const f = el('figure', 'usage-figure');
    const cap = el('figcaption'); cap.append(el('h3', '', title)); if (sub) cap.append(el('p', '', sub));
    const plot = el('div', 'usage-plot');
    f.append(cap, plot);
    return { f, plot };
  }

  /* ── 그리기 ── */
  function render() {
    const body = $('usageBody');
    if (!report) return;
    const r = report, t = r.totals;
    const labelEvery = r.days.length > 31 ? 14 : r.days.length > 14 ? 7 : r.days.length > 7 ? 2 : 1;
    const labels = r.days.map((d) => shortDate(d.date));
    const tipTitles = r.days.map((d) => `${shortDate(d.date)}(${weekday(d.date)})`);
    const nodes = [];

    // 대표 숫자 하나 + 지표 타일
    const hero = el('div', 'usage-hero');
    hero.append(el('span', 'usage-hero-label', `최근 ${r.days.length}일 총 이용 시간`), el('strong', 'usage-hero-value', fmtDur(t.activeSec)),
      el('span', 'usage-hero-sub', `${shortDate(r.from)} ~ ${shortDate(r.to)} · 화면을 실제로 보고 있던 시간`));
    const tiles = el('div', 'usage-tiles');
    [
      ['이용한 멤버', `${fmtNum(t.members || 0)}명`, '인증한 이름 기준'],
      ['다녀간 기기', `${fmtNum(t.uniqueDevices)}대`, `방문 ${fmtNum(t.visits)}회`],
      ['1인 하루 평균', fmtDur(t.perDeviceDaySec), '그날 들어온 기기 기준'],
      ['영상 시청', fmtDur(t.videoPlaySec), `영상 연 횟수 ${fmtNum(t.videoOpens)}회`],
      ['뉴스레터 읽기', fmtDur(t.columnReadSec), `칼럼 연 횟수 ${fmtNum(t.columnOpens)}회 · 끝까지 ${fmtNum(t.columnCompletes)}회`],
      ['인사이트 댓글', `${fmtNum(t.comments)}개`, '영상·칼럼 댓글']
    ].forEach(([k, v, s]) => { const tile = el('div', 'usage-tile'); tile.append(el('span', 'usage-tile-label', k), el('strong', 'usage-tile-value', v), el('span', 'usage-tile-sub', s)); tiles.append(tile); });
    nodes.push(hero, tiles);

    if (!t.activeSec && !t.visits) {
      nodes.push(el('p', 'usage-empty', '아직 이 기간에 모인 이용 기록이 없습니다. 멤버들이 사이트를 쓰기 시작하면 30초~1분 안에 쌓이기 시작해요.'));
      body.replaceChildren(...nodes);
      return;
    }

    // 0) 멤버별 이용 시간
    nodes.push(memberSection(r));

    // 1) 날짜별 이용 시간 — 영상 시청 / 뉴스레터 읽기 / 그 밖의 이용(인증·피드 등)
    const series = [
      { name: '영상 시청', color: color(1), values: r.days.map((d) => minutes(d.videoPlaySec)) },
      { name: '뉴스레터 읽기', color: color(2), values: r.days.map((d) => minutes(d.columnReadSec)) },
      { name: '그 밖의 이용', color: color(3), values: r.days.map((d) => minutes(Math.max(0, d.activeSec - d.videoPlaySec - d.columnReadSec))) }
    ];
    const daily = figure('날짜별 이용 시간', '분 단위 · 영상 시청은 실제 재생된 시간, 뉴스레터는 읽기 창을 보고 있던 시간');
    daily.f.id = 'usageDaily';
    const legendEl = legend(series); if (legendEl) daily.f.insertBefore(legendEl, daily.plot);
    nodes.push(daily.f);

    // 2) 날짜별 방문 기기 수
    const visitors = figure('날짜별 방문 기기 수', '그날 한 번이라도 들어온 기기(같은 기기는 하루 1대)');
    visitors.f.id = 'usageVisitors';
    nodes.push(visitors.f);

    // 3) 시간대 · 화면
    const grid = el('div', 'usage-grid2');
    const hours = figure('시간대별 이용', '하루 중 언제 많이 머무는지 · 분 (한국 시간)');
    hours.f.id = 'usageHours';
    const pages = figure('화면별 이용 시간', '어느 화면에서 시간을 보내는지');
    pages.f.id = 'usagePages';
    grid.append(hours.f, pages.f);
    nodes.push(grid);

    // 4) 하루 이용 시간 분포
    const dist = figure('하루 이용 시간 분포', '기기 × 날짜 기준 — 하루에 얼마나 오래 머무는 사람이 많은지');
    dist.f.id = 'usageDist';
    nodes.push(dist.f);

    // 5) 많이 본 콘텐츠
    const grid2 = el('div', 'usage-grid2');
    const topV = figure('많이 본 영상', '실제 재생 시간 순');
    topV.f.id = 'usageTopVideos';
    const topC = figure('많이 읽은 칼럼', '읽은 시간 순');
    topC.f.id = 'usageTopColumns';
    grid2.append(topV.f, topC.f);
    nodes.push(grid2);

    body.replaceChildren(...nodes);

    // 그리기는 붙인 뒤에(너비를 알아야 한다)
    const minFmt = (v) => fmtDur(v * 60);
    const axisMin = (v) => (v >= 60 || (v > 0 && v % 60 === 0) ? `${+(v / 60).toFixed(2)}시간` : `${+v.toFixed(1)}분`);
    daily.plot.append(columnChart(daily.plot, { labels, tipTitles, series, format: minFmt, axisFormat: axisMin, labelEvery, scale: { minutes: true } }));
    daily.f.append(tableView(['날짜', '영상 시청', '뉴스레터 읽기', '그 밖의 이용', '합계', '방문 기기', '방문'], r.days.map((d, i) => [tipTitles[i], ...series.map((s) => minFmt(s.values[i])), fmtDur(d.activeSec), `${d.devices}대`, `${d.visits}회`])));

    visitors.plot.append(lineChart(visitors.plot, { labels, tipTitles, values: r.days.map((d) => d.devices), name: '방문 기기', format: (v) => `${fmtNum(v)}대`, labelEvery, scale: { integer: true } }));
    visitors.f.append(tableView(['날짜', '방문 기기', '방문 횟수', '인사이트 댓글'], r.days.map((d, i) => [tipTitles[i], `${d.devices}대`, `${d.visits}회`, `${d.comments}개`])));

    const hourLabels = r.hours.map((_, h) => String(h));
    hours.plot.append(columnChart(hours.plot, { labels: hourLabels, tipTitles: r.hours.map((_, h) => `${h}시 ~ ${h + 1}시`), series: [{ name: '이용 시간', color: color(1), values: r.hours.map(minutes) }], format: minFmt, axisFormat: axisMin, labelEvery: 3, height: 200, scale: { minutes: true } }));
    hours.f.append(tableView(['시간대', '이용 시간'], r.hours.map((s, h) => [`${h}시`, fmtDur(s)])));

    const pageRows = [['index', '인증 앱'], ['content', '추천 콘텐츠'], ['feed', '전체 피드']].map(([k, n]) => ({ name: n, value: r.pages[k] || 0 }));
    pages.plot.append(barList(pageRows));
    pages.f.append(tableView(['화면', '이용 시간'], pageRows.map((p) => [p.name, fmtDur(p.value)])));

    dist.plot.append(columnChart(dist.plot, { labels: r.distribution.map((b) => b.label), series: [{ name: '기기·날짜 수', color: color(1), values: r.distribution.map((b) => b.count) }], format: (v) => `${fmtNum(v)}건`, height: 190, scale: { integer: true } }));
    dist.f.append(tableView(['하루 이용 시간', '기기·날짜 수'], r.distribution.map((b) => [b.label, `${b.count}건`])));

    const vRows = r.topVideos.map((v) => ({ name: v.title || v.key.slice(2), value: v.sec, sub: `${v.opens}회 열림` }));
    topV.plot.append(vRows.length ? barList(vRows) : el('p', 'usage-empty', '아직 재생된 영상이 없습니다.'));
    topV.f.append(tableView(['영상', '재생 시간', '열림', '창 열어 둔 시간'], r.topVideos.map((v) => [v.title || v.key, fmtDur(v.playSec), `${v.opens}회`, fmtDur(v.openSec)])));
    const cRows = r.topColumns.map((c) => ({ name: c.title || c.key.slice(2), value: c.sec, sub: `${c.opens}회 열림 · 끝까지 ${c.completes}회` }));
    topC.plot.append(cRows.length ? barList(cRows) : el('p', 'usage-empty', '아직 읽은 칼럼이 없습니다.'));
    topC.f.append(tableView(['칼럼', '읽은 시간', '열림', '끝까지 읽음'], r.topColumns.map((c) => [c.title || c.key, fmtDur(c.readSec), `${c.opens}회`, `${c.completes}회`])));
    lastWidth = panel.clientWidth; // 이 너비로 그렸다 — 같은 너비의 크기 변화 알림엔 다시 그리지 않는다
  }

  /* ── 멤버별 이용 시간: 이름 찾기·정렬, 한 줄에 영상/뉴스레터/그 밖의 이용을 쌓은 막대 ──
   * 멤버별로는 기간 합계만 보여 준다(언제 들어왔는지·날짜별 기록·방문 횟수는 개인 행동 기록이라 두지 않는다). */
  const SORTS = {
    active: ['총 이용 시간', (m) => m.activeSec],
    video: ['영상 시청', (m) => m.videoPlaySec],
    column: ['뉴스레터 읽기', (m) => m.columnReadSec],
    name: ['이름', null]
  };
  let memberSort = 'active', memberQuery = '', memberAll = false;
  const parts = (m) => {
    const video = m.videoPlaySec, column = m.columnReadSec;
    return [video, column, Math.max(0, m.activeSec - video - column)];
  };
  function memberSection(r) {
    const t = r.totals;
    const share = t.activeSec ? Math.min(100, Math.round((t.memberSec / t.activeSec) * 100)) : 0;
    const fig = figure('멤버별 이용 시간', `인증한 이름 기준 · ${fmtNum(t.members || 0)}명 · 기간 합계 · 전체 이용 시간의 ${share}%가 이름이 확인된 이용`);
    fig.f.id = 'usageMembers';
    const names = ['영상 시청', '뉴스레터 읽기', '그 밖의 이용'];
    const legendEl = legend(names.map((name, i) => ({ name, color: color(i + 1) })));
    const tools = el('div', 'member-tools');
    const search = el('input'); search.type = 'search'; search.placeholder = '이름 찾기'; search.id = 'memberSearch'; search.value = memberQuery; search.setAttribute('aria-label', '멤버 이름 찾기');
    const sort = el('select'); sort.id = 'memberSort'; sort.setAttribute('aria-label', '정렬');
    for (const [k, [label]] of Object.entries(SORTS)) { const o = el('option', '', label + ' 순'); o.value = k; sort.append(o); }
    sort.value = memberSort;
    tools.append(search, sort);
    fig.f.insertBefore(tools, fig.plot);
    if (legendEl) fig.f.insertBefore(legendEl, fig.plot);
    const list = el('div', 'member-list');
    const more = el('button', 'member-more'); more.type = 'button';
    fig.plot.append(list, more);
    const members = r.members || [];
    const max = Math.max(...members.map((m) => parts(m).reduce((a, b) => a + b, 0)), 1);
    function paint() {
      const q = memberQuery.trim();
      const key = SORTS[memberSort][1];
      const rows = members.filter((m) => !q || m.name.includes(q))
        .sort((a, b) => (key ? key(b) - key(a) || b.activeSec - a.activeSec : a.name.localeCompare(b.name, 'ko')));
      const shown = memberAll ? rows : rows.slice(0, 20);
      list.replaceChildren(...shown.map((m) => {
        const row = el('div', 'member-row'); row.tabIndex = 0;
        const [v, c, o] = parts(m);
        row.setAttribute('aria-label', `${m.name}: 총 ${fmtDur(m.activeSec)}, 영상 ${fmtDur(v)}, 뉴스레터 ${fmtDur(c)}, 그 밖의 이용 ${fmtDur(o)}`);
        const name = el('div', 'member-name'); name.append(el('strong', '', m.name || '(이름 없음)'));
        const bar = el('div', 'member-bar');
        const stack = el('div', 'member-stack');
        [v, c, o].forEach((sec, i) => { if (sec <= 0) return; const seg = el('span', 'member-seg'); seg.style.width = (sec / max) * 100 + '%'; seg.style.background = color(i + 1); stack.append(seg); });
        bar.append(stack, el('span', 'member-total', fmtDur(m.activeSec)));
        row.append(name, bar);
        const show = () => {
          const box = row.getBoundingClientRect(), host = fig.plot.getBoundingClientRect();
          showTip(fig.plot, box.left - host.left + Math.min(box.width / 2, 260), box.top - host.top, m.name, [
            { color: color(1), value: fmtDur(v), name: '영상 시청' }, { color: color(2), value: fmtDur(c), name: '뉴스레터 읽기' },
            { color: color(3), value: fmtDur(o), name: '그 밖의 이용' }, { value: fmtDur(m.activeSec), name: '합계' }]);
        };
        row.addEventListener('pointerenter', show); row.addEventListener('focus', show);
        row.addEventListener('pointerleave', hideTip); row.addEventListener('blur', hideTip);
        return row;
      }));
      if (!rows.length) list.append(el('p', 'usage-empty', members.length ? `'${q}' 이름의 이용 기록이 없습니다.` : '아직 이름이 확인된 이용 기록이 없습니다. 멤버가 인증하거나 댓글을 남긴 기기부터 이름으로 쌓입니다.'));
      more.hidden = memberAll || rows.length <= 20;
      more.textContent = `${rows.length - 20}명 더 보기`;
    }
    search.addEventListener('input', () => { memberQuery = search.value; paint(); });
    sort.addEventListener('change', () => { memberSort = sort.value; paint(); });
    more.addEventListener('click', () => { memberAll = true; paint(); });
    paint();
    fig.f.append(tableView(['멤버', '총 이용', '영상 시청', '뉴스레터 읽기', '그 밖의 이용'],
      members.map((m) => { const [v, c, o] = parts(m); return [m.name, fmtDur(m.activeSec), fmtDur(v), fmtDur(c), fmtDur(o)]; })));
    return fig.f;
  }

  /* ── 불러오기: 다시 받는 동안 앞의 그림을 흐리게 둔다(깜빡임 없이) ── */
  // 운영진 로그인으로 대시보드가 열린 뒤에만 부른다(서버도 운영진 토큰이 없으면 거절한다).
  const dashboardOpen = () => { const d = $('adminDashboard'); return !d || d.style.display !== 'none'; };
  async function load() {
    if (loading || !dashboardOpen()) return;
    loading = true;
    $('usageBody').classList.add('is-loading');
    $('usageMsg').textContent = report ? '' : '불러오는 중…';
    try {
      const Store = window.CS && CS.Store;
      const token = Store && Store.getIdToken ? await Store.getIdToken() : null;
      const res = await fetch(`/.netlify/functions/analytics-report?days=${days}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Error(data.error || `통계를 불러오지 못했습니다(${res.status}).`);
      report = data; loadedOnce = true;
      $('usageMsg').textContent = '';
      render();
      $('usageUpdated').textContent = `${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준`;
    } catch (e) {
      $('usageMsg').textContent = e.message || '통계를 불러오지 못했습니다.';
    } finally {
      loading = false;
      $('usageBody').classList.remove('is-loading');
    }
  }

  panel.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => {
    days = +b.dataset.days;
    panel.querySelectorAll('[data-days]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    load();
  }));
  $('usageRefresh').addEventListener('click', load);
  // 탭이 열릴 때 처음 한 번 불러온다(일일현황만 보는 운영진에게 매번 부담을 주지 않게)
  const maybeLoad = () => { if (!panel.hidden && !loadedOnce && dashboardOpen()) load(); };
  new MutationObserver(maybeLoad).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  if ($('adminDashboard')) new MutationObserver(() => {
    if (!dashboardOpen()) { report = null; loadedOnce = false; $('usageBody').replaceChildren(); } // 로그아웃하면 보던 통계도 지운다
    else maybeLoad();
  }).observe($('adminDashboard'), { attributes: true, attributeFilter: ['style'] });
  maybeLoad();
  let resizeTimer = 0;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (report && !panel.hidden && panel.clientWidth !== lastWidth) render(); }, 150);
  }).observe(panel);
})();
