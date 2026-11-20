/* 운영진 화면 [명단 관리] → 「명단 자동 반영」 카드.
 * 매달 21일 00:30(KST)에 서버가 이번 기수 멤버를 앱 명단에 넣는다(netlify/functions/_lib/rosterAuto.js).
 * 여기서는 그 결과·미리보기를 보고, 예외 참여자·결제자 이름·초대 문자 켜기/끄기를 고친다. */
(function () {
  const { Store } = CS;
  const $ = (id) => document.getElementById(id);
  if (!$('raLoad')) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const note = (el, text, kind) => { el.innerHTML = text ? `<div class="note ${kind || 'info'}">${text}</div>` : ''; };
  let state = null;

  async function call(method, query, body) {
    if (!Store.getIdToken) throw new Error('Firebase 배포본에서만 쓸 수 있습니다.');
    const token = await Store.getIdToken();
    const res = await fetch('/.netlify/functions/roster-auto' + (query || ''), {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  const list = (rows, fmt) => (rows && rows.length ? rows.map(fmt).map(esc).join(', ') : '없음');
  function renderResult(r, title) {
    if (!r) return '';
    if (r.stopped) return `<div class="note warn"><strong>${esc(title)}</strong> — ${esc(r.stopped)}</div>`;
    const c = r.counts;
    return `<div class="note info"><strong>${esc(title)}</strong> · ${esc(r.cohort)} 『${esc(r.book || '')}』<br>
      이번 기수 명단 <strong>${c.total}명</strong> (래피드 ${c.payers} + 예외 ${c.extras}) · 새로 넣을 분 ${c.added}명 · 빈 이메일·전화 채울 분 ${c.filled}명 · 이미 있음 ${c.skipped}명<br>
      <strong>단톡방에서 내보낼 분 ${r.dropped.length}명</strong>: ${list(r.dropped, (x) => `${x.name}(${x.why})`)}<br>
      ${r.payerNames && r.payerNames.length ? `<br>결제자와 이름이 다른 분: ${list(r.payerNames, (x) => `${x.name}←${x.payer}`)}` : ''}</div>`;
  }
  function renderSettings(s) {
    $('raExtras').value = (s.extras || []).map((x) => [x.name, x.email, x.phone].filter(Boolean).join(', ')).join('\n');
    $('raAliases').value = (s.aliases || []).map((x) => `${x.payer} → ${x.name}`).join('\n');
  }
  function readSettings() {
    const extras = $('raExtras').value.split('\n').map((l) => l.split(/[,\t]/).map((x) => x.trim())).filter((a) => a[0])
      .map(([name, b, c]) => {
        const email = [b, c].find((x) => x && x.includes('@')) || '';
        const phone = [b, c].find((x) => x && /\d{4}/.test(x) && !x.includes('@')) || '';
        return { name, email, phone };
      });
    const aliases = $('raAliases').value.split('\n').map((l) => l.split(/→|->|=>|>/).map((x) => x.trim())).filter((a) => a[0] && a[1])
      .map(([payer, name]) => ({ payer, name }));
    return { extras, aliases };
  }

  async function load() {
    const btn = $('raLoad'); btn.disabled = true; note($('raMsg'), '불러오는 중… (문자 서버에서 이번 기수 멤버를 받아 미리 맞춰 봅니다)', 'info');
    try {
      state = await call('GET');
      renderSettings(state.settings);
      $('raRun').hidden = !state.preview || !!state.preview.stopped;
      $('raOut').innerHTML = (state.run ? renderResult(state.run, state.run.write ? '반영 기록' : '기록') : '')
        + renderResult(state.preview, `미리보기 (${state.date} 기준, 아직 쓰지 않음)`);
      note($('raMsg'), '');
    } catch (e) { note($('raMsg'), '불러오지 못했습니다: ' + esc(e.message), 'bad'); }
    btn.disabled = false;
  }
  async function save() {
    try { const r = await call('POST', '', { action: 'settings', settings: readSettings() }); renderSettings(r.settings); note($('raMsg'), '설정을 저장했습니다. [미리보기 불러오기]로 결과를 확인하세요.', 'ok'); }
    catch (e) { note($('raMsg'), '저장하지 못했습니다: ' + esc(e.message), 'bad'); }
  }
  async function runNow() {
    if (!state || !state.date) return;
    if (!confirm(`${state.date} 기수 멤버를 지금 앱 명단에 넣을까요?\n(이미 있는 분은 빈 이메일·전화만 채우고, 아무도 지우지 않습니다)`)) return;
    try { const r = await call('POST', '', { action: 'run', date: state.date }); $('raOut').innerHTML = renderResult(r, '지금 반영 결과'); note($('raMsg'), r.stopped ? '' : '반영했습니다. 아래 참가자 목록을 새로고침해 확인하세요.', 'ok'); }
    catch (e) { note($('raMsg'), '반영하지 못했습니다: ' + esc(e.message), 'bad'); }
  }
  $('raLoad').addEventListener('click', load);
  $('raSave').addEventListener('click', save);
  $('raRun').addEventListener('click', runNow);
})();
