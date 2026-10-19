/* 운영진 화면 [알림 메일 › 래피드 멤버십 자동 문자]가 부른다 — 최근 구독 상태와 예정·발송 문자 목록(운영진 로그인 필요). */
const { getDb } = require('./_lib/firebaseAdmin');
const { requireAdmin, json } = require('./_lib/adminAuth');
const L = require('./_lib/latpeed');

exports.handler = async (event) => {
  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;
  const snap = await getDb().collection(L.SUBS).orderBy('updatedAt', 'desc').limit(100).get();
  const subs = snap.docs.map((d) => {
    const s = d.data();
    return {
      name: s.name, phone: s.phone ? s.phone.replace(/(\d{3})\D?(\d{3,4})\D?(\d{4})$/, '$1-****-$3') : '',
      membershipName: s.membershipName, status: s.status, finishedAt: s.finishedAt, lastEvent: s.lastEvent,
      lastEventDate: s.lastEventDate,
      reminders: (s.reminders || []).map((r) => ({ kind: r.kind, dueAt: r.dueAt, status: r.status, sentAt: r.sentAt || null, error: r.error || null })),
    };
  });
  return json(200, { subs });
};
