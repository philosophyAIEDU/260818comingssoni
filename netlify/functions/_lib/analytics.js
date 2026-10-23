/* 이용 통계 — 사이트에 머문 시간, 영상 시청 시간, 뉴스레터 읽은 시간을 하루 단위로 모은다.
 *
 * 기기마다 무작위 ID를 만들고(브라우저 저장), 서버는 그 해시 앞부분으로 "오늘 다녀간 기기 수"를 센다.
 * 그 기기에서 인증(또는 댓글)한 멤버를 알면 브라우저가 참여자 ID와 시즌을 함께 보내고, 서버가 그 시즌 명단에서
 * 실제로 있는 사람인지 확인한 뒤 인증 이름으로 멤버별 이용량(members.{시즌_참여자ID})에 더한다.
 * 이메일·전화번호는 남기지 않는다. 보고서는 운영진만 본다.
 *
 * 저장: analyticsDaily/{YYYY-MM-DD(KST)}
 *   visits, activeSec, pages.{index|content|feed}, hours.{0..23}, devices.{해시}: 그 기기의 그날 이용 초,
 *   video.{openSec, playSec, opens}, column.{readSec, opens, completes},
 *   items.{v_영상ID | c_칼럼}: { title, kind, open, play, read, n, done }
 *   members.{시즌_참여자ID}: { name, season, active, play, read } — 멤버별로는 시간 합계만 둔다
 *     (언제 들어왔는지·몇 번 왔는지·무엇을 봤는지 같은 개인 행동 기록은 남기지 않는다)
 * 브라우저가 30~60초마다 그동안 쌓인 양을 보내고(track 함수), 서버는 숫자를 더하기만 한다.
 * 보고서(analytics-report 함수)는 운영진 로그인으로만 읽는다. */
const crypto = require('crypto');

const PAGES = ['index', 'content', 'feed'];
const MAX_FLUSH_SEC = 900; // 한 번에 보낼 수 있는 최대 초(보내기가 몇 번 실패해 쌓인 경우까지)
const MAX_ITEMS = 20;

const clampSec = (n) => (Number.isFinite(+n) ? Math.max(0, Math.min(MAX_FLUSH_SEC, Math.round(+n))) : 0);
const clampCount = (n) => (Number.isFinite(+n) ? Math.max(0, Math.min(20, Math.round(+n))) : 0);
const cleanTitle = (s) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

/** KST 날짜와 시(0~23) */
function kstParts(now = new Date()) {
  const k = new Date(now.getTime() + 9 * 3600e3);
  return { date: k.toISOString().slice(0, 10), hour: k.getUTCHours() };
}

/** 영상: v_ + 유튜브 ID / 칼럼: c_ + 경로를 필드 이름에 쓸 수 있게 고친 것 */
function itemKey(raw) {
  const s = String(raw || '');
  let m = s.match(/^v:([\w-]{11})$/);
  if (m) return { key: 'v_' + m[1], kind: 'video' };
  m = s.match(/^c:(\/[\w./-]{1,80})$/);
  if (m) return { key: 'c_' + m[1].replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60), kind: 'column' };
  return null;
}

/** 브라우저가 보낸 묶음을 검사해 쓸 수 있는 값만 남긴다. 이상하면 null. */
function sanitizeBeacon(body) {
  if (!body || typeof body !== 'object') return null;
  if (!/^[a-f0-9]{16,64}$/.test(String(body.d || ''))) return null;
  if (!PAGES.includes(body.p)) return null;
  const items = [];
  for (const [raw, v] of Object.entries(body.items && typeof body.items === 'object' ? body.items : {}).slice(0, MAX_ITEMS)) {
    const k = itemKey(raw);
    if (!k || !v || typeof v !== 'object') continue;
    const it = { key: k.key, kind: k.kind, title: cleanTitle(v.t), n: clampCount(v.n) };
    if (k.kind === 'video') Object.assign(it, { open: clampSec(v.open), play: clampSec(v.play) });
    else Object.assign(it, { read: clampSec(v.read), done: clampCount(v.done) });
    if (it.n || it.open || it.play || it.read || it.done) items.push(it);
  }
  const m = body.m && typeof body.m === 'object' && /^[\w-]{1,40}$/.test(String(body.m.p || '')) && /^[\w-]{1,10}$/.test(String(body.m.s || ''))
    ? { pid: String(body.m.p), season: String(body.m.s) } : null;
  const out = { device: crypto.createHash('sha256').update(body.d).digest('hex').slice(0, 16), page: body.p, visit: body.visit ? 1 : 0, active: clampSec(body.active), items, member: m };
  return out.visit || out.active || items.length ? out : null;
}

/** 묶음 하나를 그날 문서에 더할 값으로 바꾼다. inc: FieldValue.increment
 *  member: 서버가 명단에서 확인한 { pid, season, name } — 없으면 익명으로만 더한다. */
function toUpdate(b, inc, now = new Date(), member = null) {
  const { date, hour } = kstParts(now);
  const sum = (kind, field) => b.items.filter((i) => i.kind === kind).reduce((n, i) => n + (i[field] || 0), 0);
  const data = {
    date,
    visits: inc(b.visit),
    activeSec: inc(b.active),
    pages: { [b.page]: inc(b.active) },
    hours: { [hour]: inc(b.active) },
    devices: { [b.device]: inc(b.active) },
    video: { openSec: inc(sum('video', 'open')), playSec: inc(sum('video', 'play')), opens: inc(sum('video', 'n')) },
    column: { readSec: inc(sum('column', 'read')), opens: inc(sum('column', 'n')), completes: inc(sum('column', 'done')) },
    items: {}
  };
  if (member) {
    data.members = { [memberKey(member)]: { name: String(member.name).slice(0, 40), season: member.season,
      active: inc(b.active), play: inc(sum('video', 'play')), read: inc(sum('column', 'read')) } };
  }
  for (const i of b.items) {
    data.items[i.key] = Object.assign({ kind: i.kind, n: inc(i.n) }, i.title ? { title: i.title } : {},
      i.kind === 'video' ? { open: inc(i.open), play: inc(i.play) } : { read: inc(i.read), done: inc(i.done) });
  }
  return { date, data };
}

const memberKey = (m) => `${m.season}_${m.pid}`.replace(/[^\w-]/g, '_');

const DIST_BUCKETS = [
  { label: '1분 미만', max: 60 },
  { label: '1~5분', max: 300 },
  { label: '5~15분', max: 900 },
  { label: '15~30분', max: 1800 },
  { label: '30분 이상', max: Infinity }
];

/** 기간 안의 날짜 목록(KST, 오래된 날부터) */
function dateRange(days, now = new Date()) {
  const { date } = kstParts(now);
  const end = new Date(date + 'T00:00:00Z');
  return Array.from({ length: days }, (_, i) => new Date(end.getTime() - (days - 1 - i) * 864e5).toISOString().slice(0, 10));
}

/** 그날 문서들 → 화면에 그릴 보고서. docs: { 'YYYY-MM-DD': data } / comments: [{ createdAt }] */
function buildReport(docs, dates, comments = []) {
  const n = (v) => (Number.isFinite(+v) ? +v : 0);
  const hours = Array(24).fill(0);
  const pages = Object.fromEntries(PAGES.map((p) => [p, 0]));
  const devicesAll = new Set();
  const dist = DIST_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  const items = new Map();
  const members = new Map();
  const commentsByDay = {};
  for (const c of comments) {
    const d = kstParts(new Date(c.createdAt)).date;
    commentsByDay[d] = (commentsByDay[d] || 0) + 1;
  }
  const days = dates.map((date) => {
    const d = docs[date] || {};
    const devices = d.devices && typeof d.devices === 'object' ? d.devices : {};
    for (const [id, sec] of Object.entries(devices)) {
      devicesAll.add(id);
      if (n(sec) > 0) dist[DIST_BUCKETS.findIndex((b) => n(sec) < b.max)].count++;
    }
    for (let h = 0; h < 24; h++) hours[h] += n(d.hours && d.hours[h]);
    for (const p of PAGES) pages[p] += n(d.pages && d.pages[p]);
    for (const [key, v] of Object.entries(d.items || {})) {
      if (!v || typeof v !== 'object') continue;
      const cur = items.get(key) || { key, kind: v.kind === 'column' ? 'column' : 'video', title: '', opens: 0, openSec: 0, playSec: 0, readSec: 0, completes: 0 };
      if (v.title) cur.title = String(v.title);
      cur.opens += n(v.n); cur.openSec += n(v.open); cur.playSec += n(v.play); cur.readSec += n(v.read); cur.completes += n(v.done);
      items.set(key, cur);
    }
    for (const [key, v] of Object.entries(d.members || {})) {
      if (!v || typeof v !== 'object') continue;
      // 멤버별로는 기간 합계만 돌려준다(날짜별 기록은 넘기지 않는다)
      const cur = members.get(key) || { key, name: '', season: '', activeSec: 0, videoPlaySec: 0, columnReadSec: 0 };
      if (v.name) cur.name = String(v.name);
      if (v.season) cur.season = String(v.season);
      cur.activeSec += n(v.active); cur.videoPlaySec += n(v.play); cur.columnReadSec += n(v.read);
      members.set(key, cur);
    }
    const video = d.video || {}, column = d.column || {};
    return {
      date,
      visits: n(d.visits),
      devices: Object.values(devices).filter((s) => n(s) > 0).length,
      activeSec: n(d.activeSec),
      videoPlaySec: n(video.playSec),
      videoOpenSec: n(video.openSec),
      videoOpens: n(video.opens),
      columnReadSec: n(column.readSec),
      columnOpens: n(column.opens),
      columnCompletes: n(column.completes),
      comments: commentsByDay[date] || 0
    };
  });
  const total = (f) => days.reduce((s, d) => s + d[f], 0);
  const deviceDays = total('devices');
  const totals = {
    visits: total('visits'),
    uniqueDevices: devicesAll.size,
    activeSec: total('activeSec'),
    videoPlaySec: total('videoPlaySec'),
    videoOpenSec: total('videoOpenSec'),
    videoOpens: total('videoOpens'),
    columnReadSec: total('columnReadSec'),
    columnOpens: total('columnOpens'),
    columnCompletes: total('columnCompletes'),
    comments: total('comments'),
    perDeviceDaySec: deviceDays ? Math.round(total('activeSec') / deviceDays) : 0,
    members: 0,
    memberSec: 0
  };
  const memberList = [...members.values()].filter((m) => m.activeSec > 0 || m.videoPlaySec > 0 || m.columnReadSec > 0)
    .sort((a, b) => b.activeSec - a.activeSec || a.name.localeCompare(b.name, 'ko'));
  totals.members = memberList.length;
  totals.memberSec = memberList.reduce((s, m) => s + m.activeSec, 0);
  const top = (kind, field) => [...items.values()].filter((i) => i.kind === kind)
    .map((i) => Object.assign(i, { sec: kind === 'video' ? i.playSec : i.readSec }))
    .sort((a, b) => b[field] - a[field] || b.opens - a.opens).slice(0, 10);
  return { from: dates[0], to: dates[dates.length - 1], days, hours, pages, distribution: dist, totals, members: memberList, topVideos: top('video', 'sec'), topColumns: top('column', 'sec') };
}

module.exports = { PAGES, kstParts, itemKey, memberKey, sanitizeBeacon, toUpdate, dateRange, buildReport, DIST_BUCKETS };
