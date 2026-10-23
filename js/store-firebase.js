/* Firebase(Firestore) 어댑터 - 로그인 없이 공용 읽기/쓰기 모드 + 관리자 인증 기능 탑재
 *
 * 컬렉션 구조
 *   participants/{id}  { nickname, email, kakaoJoined, status, joinDate, outDate, exemptDates[], note, createdAt }
 *   submissions/{id}   { participantId, nickname, date, sentence, reflection, upvotes, upvotedBy[], createdAt, updatedAt }
 *   notifyEmails/{id}  { name, email, createdAt }  ← 야간 인증 알림 메일 수신자 목록
 *   notices/{date}     { text, updatedAt }         ← 날짜별로 미리 써 두는 공지문 초안
 *   meta/app           { ... }
 */
window.CS = window.CS || {};

CS.FirebaseStore = (function () {
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
  const APP = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
  const AUTH = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

  let db = null;
  let fs = null;
  const readMeter = { docs: 0 };
  // 운영진 화면은 명단을 이 화면 안에서 15분 기억하고, 고칠 때마다 기억해 둔 명단을 바로 맞춘다 —
  // 고칠 때마다 명단 전체(수백 건)를 다시 읽지 않으려는 것(Firebase 무료 읽기 한도).
  const ROSTER_TTL = 15 * 60 * 1000;
  let rosterCache = null; // { key: 컬렉션 이름, at, rows }
  const cloneRows = (rows) => JSON.parse(JSON.stringify(rows));
  const sortRoster = (rows) => rows.sort((a, b) => a.nickname.localeCompare(b.nickname, 'ko'));
  const patchRoster = (fn) => { if (rosterCache) { fn(rosterCache.rows); sortRoster(rosterCache.rows); } };
  let authModule = null;
  let auth = null;
  let currentUser = null;
  let authStateListeners = [];

  async function init() {
    if (db) return;
    const cfg = CS.FIREBASE_CONFIG || {};
    if (!cfg.projectId) {
      throw new Error('CS.FIREBASE_CONFIG 가 비어 있습니다. js/config.js 를 먼저 채워 주세요.');
    }
    const [{ initializeApp }, firestore, authMod] = await Promise.all([
      import(APP),
      import(SDK),
      import(AUTH)
    ]);
    // 이 화면이 Firestore에서 직접 읽은 문서 수를 센다(운영진 화면 아래에 표시 — 무료 읽기 한도를 눈으로 확인하는 용도)
    fs = Object.assign({}, firestore, {
      getDocs: async (...a) => { const snap = await firestore.getDocs(...a); readMeter.docs += snap.size != null ? snap.size : snap.docs.length; return snap; },
      getDoc: async (...a) => { readMeter.docs++; return firestore.getDoc(...a); }
    });
    authModule = authMod;
    
    const app = initializeApp(cfg);
    db = fs.getFirestore(app);
    auth = authModule.getAuth(app);

    // 로그인 상태 리스너 등록
    authModule.onAuthStateChanged(auth, (user) => {
      currentUser = user;
      for (const cb of authStateListeners) {
        try { cb(user); } catch (e) { console.error(e); }
      }
    });
  }

  // Auth Helper Methods
  function onAuthStateChanged(callback) {
    authStateListeners.push(callback);
    // 이미 로그인 정보가 있으면 즉시 1회 호출
    if (db) {
      callback(currentUser);
    }
    return () => {
      authStateListeners = authStateListeners.filter(cb => cb !== callback);
    };
  }

  async function signInWithGoogle() {
    await init();
    const provider = new authModule.GoogleAuthProvider();
    return authModule.signInWithPopup(auth, provider);
  }

  async function signOut() {
    await init();
    return authModule.signOut(auth);
  }

  function getCurrentUser() {
    return currentUser;
  }

  /** 서버 함수(정리본 발송 등)에 "운영진이 맞다"를 증명할 Firebase ID 토큰. 로그인 전이면 null. */
  async function getIdToken() {
    await init();
    return currentUser ? currentUser.getIdToken() : null;
  }

  /* 컬렉션 이름에 시즌 접두사를 붙여서 연다(js/config.js의 CS.collectionName).
   * 시즌마다 데이터가 다른 컬렉션에 쌓이므로 이전 시즌 기록은 그대로 남는다. */
  const col = (name) => fs.collection(db, CS.collectionName(name));
  const docRef = (name, id) => fs.doc(db, CS.collectionName(name), id);
  const withId = (snap) => Object.assign({ id: snap.id }, snap.data());
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /* 멤버 화면(CS.FEED_API)은 명단·그날 글 목록을 서버 스냅샷으로 받는다(js/feed-client.js) — Firestore 읽기를 아끼려는 것.
   * 못 받으면 아래처럼 예전 방식(Firestore에서 직접)으로 읽는다. */
  const viaApi = () => !!(CS.FeedClient && CS.FeedClient.enabled());
  const rosterViaApi = () => !!(CS.FeedClient && CS.FeedClient.rosterEnabled());

  /** 운영진이 명단·글을 고친 뒤: 서버 스냅샷을 오래된 것으로 표시해 멤버 화면이 곧바로 새 내용을 받게 한다(실패해도 무시). */
  async function invalidateFeed(opts) {
    try {
      const token = await getIdToken();
      if (!token || typeof fetch !== 'function') return;
      await fetch('/.netlify/functions/feed-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(Object.assign({ season: CS.CONFIG.seasonId }, opts))
      });
    } catch (e) { /* 멤버 화면은 곧 스냅샷이 오래되어 알아서 새로 받는다 */ }
  }

  // 여러 건을 연달아 고쳐도(일괄 등록 등) 알림은 한 번만 보낸다
  let pendingInv = null, invTimer = null;
  function scheduleInvalidate(opts) {
    pendingInv = pendingInv || { roster: false, dates: new Set() };
    if (opts.roster) pendingInv.roster = true;
    (opts.dates || []).forEach((d) => { if (d) pendingInv.dates.add(d); });
    clearTimeout(invTimer);
    invTimer = setTimeout(() => { const o = pendingInv; pendingInv = null; invalidateFeed({ roster: o.roster, dates: [...o.dates] }); }, 800);
  }

  /** 운영진 [최신으로 새로고침]: 오늘·어제 글 목록 스냅샷을 오래된 것으로 표시해 다음에 읽을 때 새로 만들게 한다(운영진 토큰 필요). */
  async function refreshFeedNow() {
    const today = CS.U.today();
    await invalidateFeed({ dates: [today, CS.U.addDays(today, -1)] });
  }
  const feedTodayAt = () => (CS.FeedClient ? CS.FeedClient.todayAt() : 0);

  /** opts.fresh: 기억해 둔 명단을 쓰지 않고 Firestore에서 바로 읽는다(서버 함수가 고친 값(발송 기록 등)을 봐야 할 때) */
  async function listParticipants(opts) {
    if (rosterViaApi()) {
      try { return await CS.FeedClient.roster(); } catch (e) { console.warn('[feed] 명단 스냅샷을 못 받아 직접 읽습니다:', e.message); }
    }
    await init();
    const key = CS.collectionName('participants');
    if (!(opts && opts.fresh) && rosterCache && rosterCache.key === key && Date.now() - rosterCache.at < ROSTER_TTL) return cloneRows(rosterCache.rows);
    const snap = await fs.getDocs(col('participants'));
    const rows = sortRoster(snap.docs.map(withId));
    rosterCache = { key, at: Date.now(), rows: cloneRows(rows) };
    return rows;
  }

  /** 다른 시즌의 명단(읽기만) — 연속 참여 배지 계산용. season: CS.SEASONS 항목 */
  async function listParticipantsOf(season) {
    await init();
    const name = season.dataPrefix ? `${season.dataPrefix}_participants` : 'participants';
    const snap = await fs.getDocs(fs.collection(db, name));
    return snap.docs.map(withId);
  }

  async function addParticipant(nickname, patch) {
    await init();
    const nick = CS.U.normalizeNick(nickname);
    if (!nick) throw new Error('닉네임을 입력해 주세요.');
    const dup = await fs.getDocs(fs.query(col('participants'), fs.where('nickname', '==', nick)));
    if (!dup.empty) throw new Error(`이미 등록된 닉네임입니다: ${nick}`);
    const body = Object.assign({
      nickname: nick,
      email: '',
      kakaoJoined: '',  // '' 미정 | 'O' 참여 | 'X' 미참여
      status: 'active',
      joinDate: CS.CONFIG.startDate,
      outDate: null,
      exemptDates: [],
      note: '',
      createdAt: CS.U.nowStamp()
    }, patch || {});
    const ref = await fs.addDoc(col('participants'), body);
    patchRoster((rows) => rows.push(Object.assign({ id: ref.id }, cloneRows(body))));
    scheduleInvalidate({ roster: true });
    return Object.assign({ id: ref.id }, body);
  }

  async function addParticipants(nicknames) {
    const existing = new Set((await listParticipants({ fresh: true })).map((p) => p.nickname));
    const added = [];
    const skipped = [];
    for (const raw of nicknames) {
      const nick = CS.U.normalizeNick(raw);
      if (!nick) continue;
      if (existing.has(nick)) { skipped.push(nick); continue; }
      added.push(await addParticipant(nick));
      existing.add(nick);
    }
    return { added, skipped };
  }

  async function updateParticipant(id, patch) {
    await init();
    const body = Object.assign({}, patch);
    if (body.nickname) body.nickname = CS.U.normalizeNick(body.nickname);
    if (body.email != null) {
      const email = String(body.email).trim().toLowerCase();
      if (email && !EMAIL_RE.test(email)) throw new Error('올바른 메일 주소를 입력해 주세요.');
      body.email = email;
    }
    await fs.updateDoc(docRef('participants', id), body);
    scheduleInvalidate({ roster: true });

    if (body.nickname) {
      const subs = await fs.getDocs(fs.query(col('submissions'), fs.where('participantId', '==', id)));
      await Promise.all(subs.docs.map((d) =>
        fs.updateDoc(docRef('submissions', d.id), { nickname: body.nickname })));
      scheduleInvalidate({ dates: subs.docs.map((d) => d.data().date) });
    }
    const snap = await fs.getDoc(docRef('participants', id));
    const updated = withId(snap);
    patchRoster((rows) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows[i] = cloneRows(updated); });
    return updated;
  }

  async function removeParticipant(id) {
    await init();
    const subs = await fs.getDocs(fs.query(col('submissions'), fs.where('participantId', '==', id)));
    await Promise.all(subs.docs.map((d) => fs.deleteDoc(docRef('submissions', d.id))));
    await fs.deleteDoc(docRef('participants', id));
    patchRoster((rows) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); });
    scheduleInvalidate({ roster: true, dates: subs.docs.map((d) => d.data().date) });
  }

  async function listSubmissions(filter) {
    if (viaApi()) {
      try {
        const rows = await CS.FeedClient.submissions(filter);
        if (rows) return rows;
      } catch (e) { console.warn('[feed] 글 목록 스냅샷을 못 받아 직접 읽습니다:', e.message); }
    }
    await init();
    const f = filter || {};
    const clauses = [];
    if (f.participantId) clauses.push(fs.where('participantId', '==', f.participantId));
    if (f.date) clauses.push(fs.where('date', '==', f.date));
    if (f.from) clauses.push(fs.where('date', '>=', f.from));
    if (f.to) clauses.push(fs.where('date', '<=', f.to));
    const snap = await fs.getDocs(clauses.length ? fs.query(col('submissions'), ...clauses) : col('submissions'));
    return snap.docs.map(withId).sort((a, b) => (a.date === b.date
      ? String(a.createdAt).localeCompare(String(b.createdAt))
      : a.date.localeCompare(b.date)));
  }

  async function getSubmission(participantId, date) {
    const rows = await listSubmissions({ participantId, date });
    return rows[0] || null;
  }

  async function saveSubmission(data) {
    await init();
    const now = CS.U.nowStamp();
    const found = await getSubmission(data.participantId, data.date);
    if (found) {
      const body = Object.assign({}, data, { updatedAt: now });
      await fs.updateDoc(docRef('submissions', found.id), body);
      const updated = Object.assign({}, found, body);
      if (viaApi()) CS.FeedClient.remember(updated);
      return updated;
    }
    const body = Object.assign({
      upvotes: 0,
      upvotedBy: [],
      createdAt: now,
      updatedAt: now
    }, data);
    const ref = await fs.addDoc(col('submissions'), body);
    const created = Object.assign({ id: ref.id }, body);
    if (viaApi()) CS.FeedClient.remember(created); // 서버 목록이 따라오기 전에도 내 화면엔 바로 보이게
    return created;
  }

  async function removeSubmission(id) {
    await init();
    const old = await fs.getDoc(docRef('submissions', id)); // 어느 날짜 목록을 새로 받게 할지 알려고(운영진 화면이라 1건)
    await fs.deleteDoc(docRef('submissions', id));
    if (old.exists()) scheduleInvalidate({ dates: [old.data().date] });
  }

  async function upvoteSubmission(id, clientId) {
    await init();
    const ref = docRef('submissions', id);
    const snap = await fs.getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    const upvotedBy = data.upvotedBy || [];
    if (upvotedBy.includes(clientId)) {
      throw new Error('이미 이 글을 추천했습니다.');
    }
    // 여러 명이 동시에 눌러도 표가 유실되지 않도록 서버 측 원자 연산 사용
    await fs.updateDoc(ref, {
      upvotes: fs.increment(1),
      upvotedBy: fs.arrayUnion(clientId)
    });
    const voted = Object.assign({ id }, data, {
      upvotes: (data.upvotes || 0) + 1,
      upvotedBy: upvotedBy.concat(clientId)
    });
    if (viaApi()) CS.FeedClient.remember(voted);
    return voted;
  }

  /** 남의 글을 [텍스트 복사]한 참여자를 그 글에 남긴다(이번 주 메신저 집계용).
   *  읽기 없이 쓰기 1번 — arrayUnion이라 같은 사람이 같은 글을 여러 번 복사해도 한 번만 남는다. */
  async function recordCopy(id, participantId) {
    await init();
    await fs.updateDoc(docRef('submissions', id), { copiedBy: fs.arrayUnion(participantId) });
  }

  /** 추천 취소 (본인이 눌렀던 엄지척을 되돌린다) */
  async function unvoteSubmission(id, clientId) {
    await init();
    const ref = docRef('submissions', id);
    const snap = await fs.getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    const upvotedBy = data.upvotedBy || [];
    if (!upvotedBy.includes(clientId)) {
      throw new Error('추천한 적이 없는 글입니다.');
    }
    await fs.updateDoc(ref, {
      upvotes: fs.increment(-1),
      upvotedBy: fs.arrayRemove(clientId)
    });
    const unvoted = Object.assign({ id }, data, {
      upvotes: Math.max(0, (data.upvotes || 0) - 1),
      upvotedBy: upvotedBy.filter((c) => c !== clientId)
    });
    if (viaApi()) CS.FeedClient.remember(unvoted);
    return unvoted;
  }

  /* ── 인증 알림 메일 수신자 목록 ───────── */
  // [명단 관리] 탭과 마찬가지로 이름 기준 가나다순으로 보여준다(이름이 없으면 맨 앞).
  async function listNotifyEmails() {
    await init();
    const snap = await fs.getDocs(col('notifyEmails'));
    return snap.docs.map(withId).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
  }

  async function addNotifyEmail(name, email) {
    await init();
    const clean = String(email || '').trim().toLowerCase();
    if (!clean || !EMAIL_RE.test(clean)) throw new Error('올바른 메일 주소를 입력해 주세요.');
    const dup = await fs.getDocs(fs.query(col('notifyEmails'), fs.where('email', '==', clean)));
    if (!dup.empty) throw new Error(`이미 등록된 메일 주소입니다: ${clean}`);
    const body = { name: CS.U.normalizeNick(name), email: clean, createdAt: CS.U.nowStamp() };
    const ref = await fs.addDoc(col('notifyEmails'), body);
    return Object.assign({ id: ref.id }, body);
  }

  /** 줄바꿈으로 구분된 { name, email } 목록을 한 번에 등록한다. */
  async function addNotifyEmails(entries) {
    const existing = new Set((await listNotifyEmails()).map((e) => e.email));
    const added = [];
    const skipped = [];
    const invalid = [];
    for (const entry of entries) {
      const clean = String((entry && entry.email) || '').trim().toLowerCase();
      if (!clean) continue;
      if (!EMAIL_RE.test(clean)) { invalid.push(clean); continue; }
      if (existing.has(clean)) { skipped.push(clean); continue; }
      added.push(await addNotifyEmail(entry && entry.name, clean));
      existing.add(clean);
    }
    return { added, skipped, invalid };
  }

  async function removeNotifyEmail(id) {
    await init();
    await fs.deleteDoc(docRef('notifyEmails', id));
  }

  /* ── 공지문 (날짜별로 미리 써 두는 초안) ─── */
  async function getNotice(date) {
    await init();
    const snap = await fs.getDoc(docRef('notices', date));
    return snap.exists() ? snap.data() : null;
  }

  /** text가 빈 값이면 그 날짜의 저장분을 지운다(다음부터 자동 생성 문구로 되돌아감). */
  async function setNotice(date, text) {
    await init();
    const clean = String(text || '').trim();
    if (!clean) {
      await fs.deleteDoc(docRef('notices', date));
      return;
    }
    await fs.setDoc(docRef('notices', date), { text: clean, updatedAt: CS.U.nowStamp() });
  }

  async function listNotices() {
    await init();
    const snap = await fs.getDocs(col('notices'));
    return snap.docs.map((d) => Object.assign({ date: d.id }, d.data()))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // 운영진 화면이 화면을 다시 그릴 때마다 meta를 몇 번씩 읽지 않도록 10분 기억한다. 고치면(setMeta) 바로 새로 읽고,
  // 운영진 화면의 전체 새로 읽기(refresh)는 invalidateMeta()로 비운다(서버 함수가 고친 발송 기록 등을 봐야 해서).
  const META_TTL = 10 * 60 * 1000;
  let metaCache = null; // { key, at, data }
  const invalidateMeta = () => { metaCache = null; };
  async function getMeta(opts) {
    await init();
    const key = CS.collectionName('meta');
    if (!(opts && opts.fresh) && metaCache && metaCache.key === key && Date.now() - metaCache.at < META_TTL) return cloneRows(metaCache.data);
    const snap = await fs.getDoc(docRef('meta', 'app'));
    const data = snap.exists() ? snap.data() : {};
    metaCache = { key, at: Date.now(), data: cloneRows(data) };
    return data;
  }

  async function setMeta(patch) {
    await init();
    await fs.setDoc(docRef('meta', 'app'), patch, { merge: true });
    return getMeta({ fresh: true });
  }

  /* 시즌 공용 설정. collectionName()을 거치지 않고 항상 같은 문서를 본다 —
   * "지난 시즌을 열어 둘지"는 지금 보고 있는 시즌과 무관하게 같은 답이어야 한다. */
  async function getSeasonFlags() {
    await init();
    const snap = await fs.getDoc(fs.doc(db, 'meta', 'seasonFlags'));
    return snap.exists() ? snap.data() : {};
  }

  async function setSeasonFlags(patch) {
    await init();
    await fs.setDoc(fs.doc(db, 'meta', 'seasonFlags'), patch, { merge: true });
    return getSeasonFlags();
  }

  async function exportAll() {
    return {
      exportedAt: CS.U.nowStamp(),
      config: { startDate: CS.CONFIG.startDate, endDate: CS.CONFIG.endDate },
      participants: await listParticipants(),
      submissions: await listSubmissions(),
      meta: await getMeta()
    };
  }

  async function importAll(obj) {
    await init();
    if (!obj || !Array.isArray(obj.participants) || !Array.isArray(obj.submissions)) {
      throw new Error('백업 파일 형식이 올바르지 않습니다.');
    }
    for (const p of obj.participants) {
      const { id } = p; const body = Object.assign({}, p); delete body.id;
      await fs.setDoc(docRef('participants', id), body);
    }
    for (const s of obj.submissions) {
      const { id } = s; const body = Object.assign({}, s); delete body.id;
      await fs.setDoc(docRef('submissions', id), body);
    }
    if (obj.meta) await setMeta(obj.meta);
    rosterCache = null;
    scheduleInvalidate({ roster: true, dates: obj.submissions.map((x) => x.date) });
  }

  async function clearAll() {
    await init();
    for (const name of ['participants', 'submissions']) {
      const snap = await fs.getDocs(col(name));
      await Promise.all(snap.docs.map((d) => fs.deleteDoc(docRef(name, d.id))));
      if (name === 'participants') rosterCache = null;
      scheduleInvalidate(name === 'participants' ? { roster: true } : { dates: snap.docs.map((d) => d.data().date) });
    }
  }

  return {
    name: 'firebase',
    init, listParticipants, listParticipantsOf, addParticipant, addParticipants, updateParticipant,
    removeParticipant, listSubmissions, getSubmission, saveSubmission,
    removeSubmission, upvoteSubmission, unvoteSubmission, recordCopy, getMeta, setMeta, refreshFeedNow, feedTodayAt,
    readCount: () => readMeter.docs, invalidateMeta,
    getSeasonFlags, setSeasonFlags, exportAll, importAll, clearAll,
    onAuthStateChanged, signInWithGoogle, signOut, getCurrentUser, getIdToken,
    listNotifyEmails, addNotifyEmail, addNotifyEmails, removeNotifyEmail,
    getNotice, setNotice, listNotices
  };
})();
