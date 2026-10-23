// 시험용 가짜 Firestore — 읽은 문서 수를 센다. 서버(Admin SDK 모양)와 브라우저(클라이언트 SDK 모양) 둘 다 같은 저장소를 본다.
function makeStore() {
  const data = {};
  const col = (n) => (data[n] = data[n] || new Map());
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const snap = (id, v) => ({ id, exists: v !== undefined, data: () => clone(v) });
  const nextId = (() => { let n = 0; return () => 'auto' + (++n); })();
  // field가 '__id__'이면 문서 ID로 비교(FieldPath.documentId 대역)
  const matches = (d, w, id) => w.every(({ field, op, value }) => { const v = field === '__id__' ? id : d[field]; return op === '==' ? v === value : op === '>=' ? v >= value : op === '<=' ? v <= value : false; });

  /** Admin SDK 모양(서버 함수용) */
  function admin(stats) {
    const query = (name, w) => ({
      where: (field, op, value) => query(name, w.concat([{ field, op, value }])),
      get: async () => { const docs = [...col(name)].filter(([id, d]) => matches(d, w, id)); stats.reads += docs.length; return { docs: docs.map(([id, d]) => snap(id, d)) }; }
    });
    const apply = (name, id, v, o) => { stats.writes++; col(name).set(id, o && o.merge ? Object.assign({}, col(name).get(id), v) : clone(v)); };
    return {
      collection: (name) => Object.assign(query(name, []), {
        doc: (id) => ({ _n: name, _id: id, get: async () => { stats.reads++; return snap(id, col(name).get(id)); }, set: async (v, o) => apply(name, id, v, o), update: async (v) => apply(name, id, v, { merge: true }) })
      }),
      getAll: async (...refs) => refs.map((r) => { stats.reads++; return snap(r._id, col(r._n).get(r._id)); }),
      runTransaction: async (fn) => fn({
        get: async (ref) => { stats.reads++; return snap(ref._id, col(ref._n).get(ref._id)); },
        set: (ref, v, o) => apply(ref._n, ref._id, v, o)
      })
    };
  }

  /** 브라우저 클라이언트 SDK 대역이 부르는 연산(test가 page.exposeFunction으로 연결) */
  function clientOp(stats) {
    const patch = (cur, upd) => {
      const out = Object.assign({}, cur);
      for (const [k, v] of Object.entries(upd)) {
        if (v && v.__inc !== undefined) out[k] = (out[k] || 0) + v.__inc;
        else if (v && v.__union) out[k] = [...new Set([...(out[k] || []), ...v.__union])];
        else if (v && v.__remove) out[k] = (out[k] || []).filter((x) => !v.__remove.includes(x));
        else out[k] = v;
      }
      return out;
    };
    return async (op) => {
      const name = op.name;
      if (op.type === 'getDocs') {
        const docs = [...col(name)].filter(([, d]) => matches(d, op.where || []));
        stats.reads += docs.length; stats.log.push(`getDocs ${name} ${docs.length}`);
        return docs.map(([id, d]) => ({ id, data: clone(d) }));
      }
      if (op.type === 'getDoc') { stats.reads++; stats.log.push(`getDoc ${name}/${op.id}`); const v = col(name).get(op.id); return v === undefined ? null : { id: op.id, data: clone(v) }; }
      if (op.type === 'addDoc') { const id = nextId(); stats.writes++; col(name).set(id, clone(op.data)); return id; }
      if (op.type === 'setDoc') { stats.writes++; col(name).set(op.id, clone(op.data)); return null; }
      if (op.type === 'updateDoc') { stats.writes++; col(name).set(op.id, patch(col(name).get(op.id) || {}, op.data)); return null; }
      if (op.type === 'deleteDoc') { stats.writes++; col(name).delete(op.id); return null; }
      throw new Error('unknown op ' + op.type);
    };
  }
  return { data, col, admin, clientOp };
}

/** 브라우저에 끼워 넣을 Firebase SDK 대역(ES 모듈 소스). 모든 연산은 window.__fsOp(Node)로 간다. */
const SDK_APP = `export const initializeApp = () => ({});`;
const SDK_AUTH = `export const getAuth = () => ({});
export const onAuthStateChanged = (a, cb) => { setTimeout(() => cb(window.__adminUser || null), 0); return () => {}; };
export class GoogleAuthProvider {}
export const signInWithPopup = async () => ({});
export const signOut = async () => {};`;
const SDK_FS = `
const call = (op) => window.__fsOp(op);
export const getFirestore = () => ({});
export const collection = (_db, name) => ({ name, where: [] });
export const doc = (_db, name, id) => ({ name, id });
export const where = (field, op, value) => ({ field, op, value });
export const query = (c, ...w) => ({ name: c.name, where: c.where.concat(w) });
const mk = (id, data) => ({ id, data: () => data });
export const getDocs = async (q) => { const rows = await call({ type: 'getDocs', name: q.name, where: q.where }); return { docs: rows.map((r) => mk(r.id, r.data)), empty: !rows.length, size: rows.length }; };
export const getDoc = async (ref) => { const r = await call({ type: 'getDoc', name: ref.name, id: ref.id }); return { id: ref.id, exists: () => !!r, data: () => (r ? r.data : undefined) }; };
export const addDoc = async (c, data) => ({ id: await call({ type: 'addDoc', name: c.name, data }) });
export const setDoc = (ref, data) => call({ type: 'setDoc', name: ref.name, id: ref.id, data });
export const updateDoc = (ref, data) => call({ type: 'updateDoc', name: ref.name, id: ref.id, data });
export const deleteDoc = (ref) => call({ type: 'deleteDoc', name: ref.name, id: ref.id });
export const increment = (n) => ({ __inc: n });
export const arrayUnion = (...x) => ({ __union: x });
export const arrayRemove = (...x) => ({ __remove: x });`;

module.exports = { makeStore, SDK_APP, SDK_AUTH, SDK_FS };
