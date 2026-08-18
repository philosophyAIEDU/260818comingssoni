/* Firebase(Firestore) 어댑터 - 로그인 없이 공용 읽기/쓰기 모드 + 관리자 인증 기능 탑재
 *
 * 컬렉션 구조
 *   participants/{id}  { nickname, status, joinDate, outDate, exemptDates[], note, createdAt }
 *   submissions/{id}   { participantId, nickname, date, chapter, sentence, reflection, upvotes, upvotedBy[], createdAt, updatedAt }
 *   meta/app           { ... }
 */
window.CS = window.CS || {};

CS.FirebaseStore = (function () {
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
  const APP = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
  const AUTH = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

  let db = null;
  let fs = null;
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
    fs = firestore;
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

  const col = (name) => fs.collection(db, name);
  const withId = (snap) => Object.assign({ id: snap.id }, snap.data());

  async function listParticipants() {
    await init();
    const snap = await fs.getDocs(col('participants'));
    return snap.docs.map(withId)
      .sort((a, b) => a.nickname.localeCompare(b.nickname, 'ko'));
  }

  async function addParticipant(nickname, patch) {
    await init();
    const nick = CS.U.normalizeNick(nickname);
    if (!nick) throw new Error('닉네임을 입력해 주세요.');
    const dup = await fs.getDocs(fs.query(col('participants'), fs.where('nickname', '==', nick)));
    if (!dup.empty) throw new Error(`이미 등록된 닉네임입니다: ${nick}`);
    const body = Object.assign({
      nickname: nick,
      status: 'active',
      joinDate: CS.CONFIG.startDate,
      outDate: null,
      exemptDates: [],
      note: '',
      createdAt: CS.U.nowStamp()
    }, patch || {});
    const ref = await fs.addDoc(col('participants'), body);
    return Object.assign({ id: ref.id }, body);
  }

  async function addParticipants(nicknames) {
    const existing = new Set((await listParticipants()).map((p) => p.nickname));
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
    await fs.updateDoc(fs.doc(db, 'participants', id), body);

    if (body.nickname) {
      const subs = await fs.getDocs(fs.query(col('submissions'), fs.where('participantId', '==', id)));
      await Promise.all(subs.docs.map((d) =>
        fs.updateDoc(fs.doc(db, 'submissions', d.id), { nickname: body.nickname })));
    }
    const snap = await fs.getDoc(fs.doc(db, 'participants', id));
    return withId(snap);
  }

  async function removeParticipant(id) {
    await init();
    const subs = await fs.getDocs(fs.query(col('submissions'), fs.where('participantId', '==', id)));
    await Promise.all(subs.docs.map((d) => fs.deleteDoc(fs.doc(db, 'submissions', d.id))));
    await fs.deleteDoc(fs.doc(db, 'participants', id));
  }

  async function listSubmissions(filter) {
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
      await fs.updateDoc(fs.doc(db, 'submissions', found.id), body);
      return Object.assign({}, found, body);
    }
    const body = Object.assign({
      upvotes: 0,
      upvotedBy: [],
      createdAt: now,
      updatedAt: now
    }, data);
    const ref = await fs.addDoc(col('submissions'), body);
    return Object.assign({ id: ref.id }, body);
  }

  async function removeSubmission(id) {
    await init();
    await fs.deleteDoc(fs.doc(db, 'submissions', id));
  }

  async function upvoteSubmission(id, clientId) {
    await init();
    const docRef = fs.doc(db, 'submissions', id);
    const snap = await fs.getDoc(docRef);
    if (!snap.exists()) return null;
    const data = snap.data();
    const upvotedBy = data.upvotedBy || [];
    if (upvotedBy.includes(clientId)) {
      throw new Error('이미 이 글을 추천했습니다.');
    }
    upvotedBy.push(clientId);
    const upvotes = (data.upvotes || 0) + 1;
    await fs.updateDoc(docRef, { upvotes, upvotedBy });
    return Object.assign({ id }, data, { upvotes, upvotedBy });
  }

  async function getMeta() {
    await init();
    const snap = await fs.getDoc(fs.doc(db, 'meta', 'app'));
    return snap.exists() ? snap.data() : {};
  }

  async function setMeta(patch) {
    await init();
    await fs.setDoc(fs.doc(db, 'meta', 'app'), patch, { merge: true });
    return getMeta();
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
      await fs.setDoc(fs.doc(db, 'participants', id), body);
    }
    for (const s of obj.submissions) {
      const { id } = s; const body = Object.assign({}, s); delete body.id;
      await fs.setDoc(fs.doc(db, 'submissions', id), body);
    }
    if (obj.meta) await setMeta(obj.meta);
  }

  async function clearAll() {
    await init();
    for (const name of ['participants', 'submissions']) {
      const snap = await fs.getDocs(col(name));
      await Promise.all(snap.docs.map((d) => fs.deleteDoc(fs.doc(db, name, d.id))));
    }
  }

  return {
    name: 'firebase',
    init, listParticipants, addParticipant, addParticipants, updateParticipant,
    removeParticipant, listSubmissions, getSubmission, saveSubmission,
    removeSubmission, upvoteSubmission, getMeta, setMeta, exportAll, importAll, clearAll,
    onAuthStateChanged, signInWithGoogle, signOut, getCurrentUser
  };
})();
