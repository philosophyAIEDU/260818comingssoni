/* 운영진 화면 [명단 관리] → 「명단 자동 반영」 카드.
 * 래피드 결제가 생길 때마다(15분 안), 그리고 21일 00:30에 한 번 더 문자 서버가 이번 기수 명단을 앱에 넣는다.
 * 여기서는 그 기록을 보고, 예외 참여자(쿠폰·해외 이체)·결제자 이름(가족 대리결제)을 고친다. */
(function () {
  const { Store } = CS;
  const $ = (id) => document.getElementById(id);
  if (!$('raLoad')) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const note = (el, text, kind) => { el.innerHTML = text ? `<div class="note ${kind || 'info'}">${text}</div>` : ''; };

  async function call(method, body) {
    if (!Store.getIdToken) throw new Error('Firebase 배포본에서만 쓸 수 있습니다.');
    const token = await Store.getIdToken();
    const res = await fetch('/.netlify/functions/roster-auto', {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  const when = (iso) => { const d = new Date(new Date(iso).getTime() + 9 * 3600000).toISOString(); return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))} ${d.slice(11, 16)}`; };
  const names = (a) => (a && a.length ? a.map(esc).join(', ') : '');
  function renderLogs(logs) {
    if (!logs.length) return '<div class="note info">아직 자동 반영 기록이 없습니다. 모집 기간(18~20일) 첫 결제부터 기록됩니다.</div>';
    return logs.map((l) => {
      const rows = (l.runs || []).slice(0, 10).map((r) => `<li>${when(r.at)}${r.final ? ' <strong>[21일 00:30 최종]</strong>' : ''} — 받음 ${r.received}명 · 명단 ${r.total}명`
        + (r.added && r.added.length ? ` · 새로 ${r.added.length}명(${names(r.added)})` : '')
        + (r.filled && r.filled.length ? ` · 이메일·전화 채움 ${r.filled.length}명` : '')
        + (r.outed && r.outed.length ? ` · <strong>아웃 ${r.outed.length}명(${names(r.outed)})</strong>` : '') + '</li>').join('');
      return `<div class="note info"><strong>${esc(l.season)} 『${esc(l.book || '')}』</strong> · 마지막 ${when(l.lastAt)}${l.lastFinalAt ? ` · 최종 맞춤 ${when(l.lastFinalAt)}` : ''}<ul>${rows}</ul></div>`;
    }).join('');
  }
  function renderSettings(s) {
    $('raExtras').value = (s.extras || []).map((x) => [x.name, x.email, x.phone].filter(Boolean).join(', ')).join('\n');
    $('raAliases').value = (s.aliases || []).map((x) => `${x.payer} → ${x.name}`).join('\n');
  }
  function readSettings() {
    const extras = $('raExtras').value.split('\n').map((l) => l.split(/[,\t]/).map((x) => x.trim())).filter((a) => a[0])
      .map(([name, b, c]) => ({
        name,
        email: [b, c].find((x) => x && x.includes('@')) || '',
        phone: [b, c].find((x) => x && /\d{4}/.test(x) && !x.includes('@')) || ''
      }));
    const aliases = $('raAliases').value.split('\n').map((l) => l.split(/→|->|=>|>/).map((x) => x.trim())).filter((a) => a[0] && a[1])
      .map(([payer, name]) => ({ payer, name }));
    return { extras, aliases };
  }
  async function load() {
    $('raLoad').disabled = true;
    try { const d = await call('GET'); renderSettings(d.settings); $('raOut').innerHTML = renderLogs(d.logs || []); note($('raMsg'), ''); }
    catch (e) { note($('raMsg'), '불러오지 못했습니다: ' + esc(e.message), 'bad'); }
    $('raLoad').disabled = false;
  }
  async function save() {
    try { const r = await call('POST', { action: 'settings', settings: readSettings() }); renderSettings(r.settings); note($('raMsg'), '저장했습니다. 다음 자동 반영(결제가 생길 때·21일 00:30)부터 적용됩니다.', 'ok'); }
    catch (e) { note($('raMsg'), '저장하지 못했습니다: ' + esc(e.message), 'bad'); }
  }
  $('raLoad').addEventListener('click', load);
  $('raSave').addEventListener('click', save);
})();
