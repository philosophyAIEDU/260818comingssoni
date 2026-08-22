/* 저장소 추상화 레이어
 *
 * 모든 화면은 CS.Store 의 async API 만 사용합니다.
 * 나중에 Firebase 를 붙일 때는 config.js 의 backend 를 'firebase' 로 바꾸면
 * js/store-firebase.js 의 어댑터가 같은 인터페이스로 교체됩니다.
 *
 * ── 인터페이스 ──────────────────────────────────────────────
 *   init()                                → Promise<void>
 *   listParticipants()                    → Promise<Participant[]>
 *   addParticipant(nickname, patch?)      → Promise<Participant>
 *   addParticipants(nicknames[])          → Promise<{added, skipped}>
 *   updateParticipant(id, patch)          → Promise<Participant>
 *   removeParticipant(id)                 → Promise<void>
 *   listSubmissions(filter?)              → Promise<Submission[]>
 *   getSubmission(participantId, date)    → Promise<Submission|null>
 *   saveSubmission(data)                  → Promise<Submission>
 *   removeSubmission(id)                  → Promise<void>
 *   upvoteSubmission(id, clientId)        → Promise<Submission|null>
 *   unvoteSubmission(id, clientId)        → Promise<Submission|null>
 *   getMeta() / setMeta(patch)            → Promise<object>
 *   exportAll() / importAll(obj)          → Promise<object|void>
 *   clearAll()                            → Promise<void>
 *   listNotifyEmails()                    → Promise<NotifyEmail[]>
 *   addNotifyEmail(name, email)           → Promise<NotifyEmail>
 *   addNotifyEmails({name,email}[])       → Promise<{added, skipped, invalid}>
 *   removeNotifyEmail(id)                 → Promise<void>
 *   getNotice(date)                       → Promise<{text, updatedAt}|null>
 *   setNotice(date, text)                 → Promise<void>  (text가 빈 값이면 저장분 삭제)
 *   listNotices()                         → Promise<{date, text, updatedAt}[]>
 *
 *  Participant { id, nickname, email, kakaoJoined:''|'O'|'X', status:'active'|'out', joinDate, outDate,
 *                exemptDates:string[], note, createdAt }
 *  Submission  { id, participantId, nickname, date, sentence,
 *                reflection, upvotes, upvotedBy:string[], createdAt, updatedAt }
 *  NotifyEmail { id, name, email, createdAt }
 *  Notice(날짜별 미리 써 두는 공지문) { date, text, updatedAt }
 * ───────────────────────────────────────────────────────────
 */
window.CS = window.CS || {};

CS.LocalStore = (function () {
  const key = (name) => `${CS.CONFIG.storagePrefix}.${name}`;

  function read(name, fallback) {
    try {
      const raw = localStorage.getItem(key(name));
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('[store] 읽기 실패', name, e);
      return fallback;
    }
  }

  function write(name, value) {
    localStorage.setItem(key(name), JSON.stringify(value));
    // 다른 탭(운영진 대시보드 ↔ 인증 화면) 동기화를 위해 storage 이벤트에 의존
    return value;
  }

  const P = 'participants';
  const S = 'submissions';
  const M = 'meta';
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  async function init() {
    if (!localStorage.getItem(key(P))) write(P, []);
    if (!localStorage.getItem(key(S))) write(S, []);
    if (!localStorage.getItem(key(M))) write(M, { createdAt: CS.U.nowStamp() });
  }

  async function listParticipants() {
    return read(P, []).slice().sort((a, b) => a.nickname.localeCompare(b.nickname, 'ko'));
  }

  function makeParticipant(nickname, patch) {
    return Object.assign({
      id: CS.U.uid('p'),
      nickname: CS.U.normalizeNick(nickname),
      email: '',
      kakaoJoined: '',  // '' 미정 | 'O' 참여 | 'X' 미참여 — 카톡방 참여 여부(운영진이 [명단 관리]에서 직접 표시)
      status: 'active',
      joinDate: CS.CONFIG.startDate,
      outDate: null,
      exemptDates: [],
      note: '',
      createdAt: CS.U.nowStamp()
    }, patch || {});
  }

  async function addParticipant(nickname, patch) {
    const nick = CS.U.normalizeNick(nickname);
    if (!nick) throw new Error('닉네임을 입력해 주세요.');
    const all = read(P, []);
    if (all.some((p) => p.nickname === nick)) throw new Error(`이미 등록된 닉네임입니다: ${nick}`);
    const p = makeParticipant(nick, patch);
    all.push(p);
    write(P, all);
    return p;
  }

  async function addParticipants(nicknames) {
    const all = read(P, []);
    const existing = new Set(all.map((p) => p.nickname));
    const added = [];
    const skipped = [];
    for (const raw of nicknames) {
      const nick = CS.U.normalizeNick(raw);
      if (!nick) continue;
      if (existing.has(nick)) { skipped.push(nick); continue; }
      const p = makeParticipant(nick);
      all.push(p);
      existing.add(nick);
      added.push(p);
    }
    write(P, all);
    return { added, skipped };
  }

  async function updateParticipant(id, patch) {
    const all = read(P, []);
    const i = all.findIndex((p) => p.id === id);
    if (i < 0) throw new Error('참가자를 찾을 수 없습니다.');
    if (patch.nickname) {
      const nick = CS.U.normalizeNick(patch.nickname);
      if (all.some((p) => p.id !== id && p.nickname === nick)) {
        throw new Error(`이미 등록된 닉네임입니다: ${nick}`);
      }
      patch = Object.assign({}, patch, { nickname: nick });
    }
    if (patch.email != null) {
      const email = String(patch.email).trim().toLowerCase();
      if (email && !EMAIL_RE.test(email)) throw new Error('올바른 메일 주소를 입력해 주세요.');
      patch = Object.assign({}, patch, { email });
    }
    all[i] = Object.assign({}, all[i], patch);
    write(P, all);

    // 닉네임이 바뀌면 기존 제출 기록의 표시용 닉네임도 함께 갱신
    if (patch.nickname) {
      const subs = read(S, []);
      let touched = false;
      for (const s of subs) {
        if (s.participantId === id && s.nickname !== patch.nickname) {
          s.nickname = patch.nickname; touched = true;
        }
      }
      if (touched) write(S, subs);
    }
    return all[i];
  }

  async function removeParticipant(id) {
    write(P, read(P, []).filter((p) => p.id !== id));
    write(S, read(S, []).filter((s) => s.participantId !== id));
  }

  async function listSubmissions(filter) {
    const f = filter || {};
    let rows = read(S, []);
    if (f.participantId) rows = rows.filter((s) => s.participantId === f.participantId);
    if (f.date) rows = rows.filter((s) => s.date === f.date);
    if (f.from) rows = rows.filter((s) => s.date >= f.from);
    if (f.to) rows = rows.filter((s) => s.date <= f.to);
    return rows.sort((a, b) => (a.date === b.date
      ? String(a.createdAt).localeCompare(String(b.createdAt))
      : a.date.localeCompare(b.date)));
  }

  async function getSubmission(participantId, date) {
    return read(S, []).find((s) => s.participantId === participantId && s.date === date) || null;
  }

  async function saveSubmission(data) {
    const all = read(S, []);
    const i = all.findIndex((s) => s.participantId === data.participantId && s.date === data.date);
    const now = CS.U.nowStamp();
    if (i >= 0) {
      all[i] = Object.assign({}, all[i], data, { updatedAt: now });
      write(S, all);
      return all[i];
    }
    const row = Object.assign({
      id: CS.U.uid('s'),
      upvotes: 0,
      upvotedBy: [],
      createdAt: now,
      updatedAt: now
    }, data);
    all.push(row);
    write(S, all);
    return row;
  }

  async function removeSubmission(id) {
    write(S, read(S, []).filter((s) => s.id !== id));
  }

  async function upvoteSubmission(id, clientId) {
    const all = read(S, []);
    const i = all.findIndex((s) => s.id === id);
    if (i < 0) return null;
    const upvotedBy = all[i].upvotedBy || [];
    if (upvotedBy.includes(clientId)) throw new Error('이미 이 글을 추천했습니다.');
    all[i] = Object.assign({}, all[i], {
      upvotes: (all[i].upvotes || 0) + 1,
      upvotedBy: upvotedBy.concat(clientId)
    });
    write(S, all);
    return all[i];
  }

  /** 추천 취소 (본인이 눌렀던 엄지척을 되돌린다) */
  async function unvoteSubmission(id, clientId) {
    const all = read(S, []);
    const i = all.findIndex((s) => s.id === id);
    if (i < 0) return null;
    const upvotedBy = all[i].upvotedBy || [];
    if (!upvotedBy.includes(clientId)) throw new Error('추천한 적이 없는 글입니다.');
    all[i] = Object.assign({}, all[i], {
      upvotes: Math.max(0, (all[i].upvotes || 0) - 1),
      upvotedBy: upvotedBy.filter((c) => c !== clientId)
    });
    write(S, all);
    return all[i];
  }

  async function getMeta() { return read(M, {}); }
  async function setMeta(patch) { return write(M, Object.assign(read(M, {}), patch)); }

  /* ── 인증 알림 메일 수신자 목록 ───────── */
  const N = 'notifyEmails';

  // [명단 관리] 탭과 마찬가지로 이름 기준 가나다순으로 보여준다(이름이 없으면 맨 앞).
  async function listNotifyEmails() {
    return read(N, []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
  }

  async function addNotifyEmail(name, email) {
    const clean = String(email || '').trim().toLowerCase();
    if (!clean || !EMAIL_RE.test(clean)) throw new Error('올바른 메일 주소를 입력해 주세요.');
    const all = read(N, []);
    if (all.some((e) => e.email === clean)) throw new Error(`이미 등록된 메일 주소입니다: ${clean}`);
    const row = { id: CS.U.uid('mail'), name: CS.U.normalizeNick(name), email: clean, createdAt: CS.U.nowStamp() };
    all.push(row);
    write(N, all);
    return row;
  }

  /** 줄바꿈으로 구분된 { name, email } 목록을 한 번에 등록한다. */
  async function addNotifyEmails(entries) {
    const all = read(N, []);
    const existing = new Set(all.map((e) => e.email));
    const added = [];
    const skipped = [];
    const invalid = [];
    for (const entry of entries) {
      const clean = String((entry && entry.email) || '').trim().toLowerCase();
      if (!clean) continue;
      if (!EMAIL_RE.test(clean)) { invalid.push(clean); continue; }
      if (existing.has(clean)) { skipped.push(clean); continue; }
      const row = {
        id: CS.U.uid('mail'), name: CS.U.normalizeNick(entry && entry.name),
        email: clean, createdAt: CS.U.nowStamp()
      };
      all.push(row);
      existing.add(clean);
      added.push(row);
    }
    write(N, all);
    return { added, skipped, invalid };
  }

  async function removeNotifyEmail(id) {
    write(N, read(N, []).filter((e) => e.id !== id));
  }

  /* ── 공지문 (날짜별로 미리 써 두는 초안) ─── */
  const NT = 'notices'; // { [date]: { text, updatedAt } }

  async function getNotice(date) {
    const all = read(NT, {});
    return all[date] || null;
  }

  /** text가 빈 값이면 그 날짜의 저장분을 지운다(다음부터 자동 생성 문구로 되돌아감). */
  async function setNotice(date, text) {
    const all = read(NT, {});
    const clean = String(text || '').trim();
    if (!clean) delete all[date];
    else all[date] = { text: clean, updatedAt: CS.U.nowStamp() };
    write(NT, all);
  }

  async function listNotices() {
    const all = read(NT, {});
    return Object.keys(all).sort().map((date) => Object.assign({ date }, all[date]));
  }

  async function exportAll() {
    return {
      exportedAt: CS.U.nowStamp(),
      config: { startDate: CS.CONFIG.startDate, endDate: CS.CONFIG.endDate },
      participants: read(P, []),
      submissions: read(S, []),
      meta: read(M, {})
    };
  }

  async function importAll(obj) {
    if (!obj || !Array.isArray(obj.participants) || !Array.isArray(obj.submissions)) {
      throw new Error('백업 파일 형식이 올바르지 않습니다.');
    }
    write(P, obj.participants);
    write(S, obj.submissions);
    write(M, obj.meta || {});
  }

  async function clearAll() {
    write(P, []); write(S, []); write(M, { createdAt: CS.U.nowStamp() });
  }

  return {
    name: 'local',
    init, listParticipants, addParticipant, addParticipants, updateParticipant,
    removeParticipant, listSubmissions, getSubmission, saveSubmission,
    removeSubmission, upvoteSubmission, unvoteSubmission, getMeta, setMeta, exportAll, importAll, clearAll,
    listNotifyEmails, addNotifyEmail, addNotifyEmails, removeNotifyEmail,
    getNotice, setNotice, listNotices
  };
})();

/* 실제로 사용할 저장소 선택 */
CS.Store = (CS.CONFIG.backend === 'firebase' && CS.FirebaseStore)
  ? CS.FirebaseStore
  : CS.LocalStore;
