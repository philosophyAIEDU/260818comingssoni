/* 래피드 웹훅 → 멤버십 안내 문자 시나리오 테스트 (가짜 Firestore·가짜 문자, 실제 발송 없음)
 *   node test/latpeed.test.js */
const Module = require('module');
const path = require('path');
const crypto = require('crypto');

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };

/* ── 가짜 Firestore ── */
function fakeDb() {
  const store = {};
  const docRef = (c, id) => ({
    id, _k: `${c}/${id}`,
    async get() { const k = `${c}/${id}`; return { exists: k in store, data: () => JSON.parse(JSON.stringify(store[k])) }; },
    async set(v, o) { const k = `${c}/${id}`; store[k] = o && o.merge ? Object.assign({}, store[k] || {}, v) : v; },
    async create(v) { const k = `${c}/${id}`; if (k in store) { const e = new Error('6 ALREADY_EXISTS: Document already exists'); e.code = 6; throw e; } store[k] = v; },
  });
  return {
    store,
    collection: (c) => ({
      doc: (id) => docRef(c, id),
      where: (f, op, v) => ({ async get() {
        const docs = Object.keys(store).filter((k) => k.startsWith(c + '/') && store[k][f] === v)
          .map((k) => ({ id: k.slice(c.length + 1), ref: docRef(c, k.slice(c.length + 1)), data: () => store[k] }));
        return { docs, size: docs.length };
      } }),
    }),
    async runTransaction(fn) { return fn({ get: (r) => r.get(), set: (r, v, o) => r.set(v, o) }); },
  };
}

const sentSms = [];
const fakeSend = async (m) => { sentSms.push(m); };

const L = require(path.join(__dirname, '../netlify/functions/_lib/latpeed'));
const KST = (s) => Date.parse(s + '+09:00');
const sub = (over) => Object.assign({
  subscriptionId: 'sub_a', status: 'CANCEL', subscribedAt: '2026-10-21T15:00:00.000+09:00',
  startedAt: '2026-10-21T15:00:00.000+09:00', finishedAt: '2026-11-21T15:00:00.000+09:00',
}, over);
const ev = (subtype, date, subOver, extra) => Object.assign({
  type: 'MEMBERSHIP_PAYMENT', subtype, eventId: 'evt_' + Math.random().toString(16).slice(2), date,
  membership: { membershipId: 'pm-reading', name: '퍼스널메이커스 독서 멤버십' },
  subscriber: { name: '김계현', email: 'a@ex.com', phoneNumber: '010-1234-5678' },
  subscription: sub(subOver),
}, extra || {});

(async () => {
  console.log('■ 요청 검증');
  const secret = 'whsec_test';
  const body = '{"a":1}';
  const ts = String(Date.now());
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  t('래피드 웹훅 시크릿 서명이 맞으면 통과', L.verifyRequest({ rawBody: body, timestamp: ts, signature: sig, secret }));
  t('서명이 틀리면 거부', !L.verifyRequest({ rawBody: body + ' ', timestamp: ts, signature: sig, secret }));
  t('5분 넘은 요청은 거부', !L.verifyRequest({ rawBody: body, timestamp: String(Date.now() - 6 * 60000), signature: sig, secret }));
  t('주소 토큰이 맞으면 통과', L.verifyRequest({ token: 'tok' }, Object.assign({}, L.CFG, { webhookTokenSha256: L.sha256hex('tok') })));
  t('토큰·서명 둘 다 없으면 거부', !L.verifyRequest({ rawBody: body }));

  console.log('■ 구독 해지 → 결제일 2일 전·1일 전 10시');
  let db = fakeDb(); sentSms.length = 0;
  let now = KST('2026-11-10T13:00:00');
  let ref = await L.applyEvent(db, ev('SUBSCRIPTION_CANCELED', '2026-11-10T13:00:00.000+09:00'), now);
  let d = (await ref.get()).data();
  t('예정 두 통: 11/19 10:00, 11/20 10:00', d.reminders.length === 2
    && d.reminders[0].dueAt === new Date(KST('2026-11-19T10:00:00')).toISOString()
    && d.reminders[1].dueAt === new Date(KST('2026-11-20T10:00:00')).toISOString(), d.reminders.map((r) => r.dueAt));
  await L.sendDue(db, ref, now, fakeSend);
  t('해지 당일에는 아무것도 안 감', sentSms.length === 0);
  await L.sendDue(db, ref, KST('2026-11-19T10:00:30'), fakeSend);
  t('D-2 10시에 한 통', sentSms.length === 1 && /2일|해지가 예약/.test(sentSms[0].text), sentSms.map((m) => m.text));
  t('결제일·퇴장기한 날짜가 채워짐(11월 21일(토))', sentSms[0].text.includes('11월 21일(토)까지 결제가') && sentSms[0].text.includes('11월 21일(토)까지 단톡방'), sentSms[0].text);
  t('받는 번호는 구독자 번호', sentSms[0].to === '010-1234-5678');
  await L.sendDue(db, ref, KST('2026-11-19T11:00:00'), fakeSend);
  t('같은 문자가 두 번 안 감', sentSms.length === 1);
  // D-1 전에 해지 철회
  await L.applyEvent(db, ev('SUBSCRIPTION_RESUMED', '2026-11-19T20:00:00.000+09:00', { status: 'PROGRESS', previousStatus: 'CANCEL' }), KST('2026-11-19T20:00:00'));
  await L.sendDue(db, ref, KST('2026-11-20T10:00:00'), fakeSend);
  d = (await ref.get()).data();
  t('해지 철회하면 D-1 문자는 취소', sentSms.length === 1 && d.reminders[1].status === 'cancelled' && d.hasPending === false, d.reminders);

  console.log('■ 해지가 늦게 들어오면');
  db = fakeDb(); sentSms.length = 0;
  ref = await L.applyEvent(db, ev('SUBSCRIPTION_CANCELED', '2026-11-20T15:00:00.000+09:00'), KST('2026-11-20T15:00:00'));
  d = (await ref.get()).data();
  t('결제일 전날 오후 해지 → D-1 한 통만 바로', d.reminders.length === 1 && d.reminders[0].kind === 'cancelD1'
    && d.reminders[0].dueAt === new Date(KST('2026-11-20T15:00:00')).toISOString(), d.reminders);
  ref = await L.applyEvent(fakeDb(), ev('SUBSCRIPTION_CANCELED', '2026-11-20T22:30:00.000+09:00'), KST('2026-11-20T22:30:00'));
  d = (await ref.get()).data();
  t('밤 10시 반 해지 → 다음 날 아침 9시로 미룸', d.reminders.length === 1 && d.reminders[0].dueAt === new Date(KST('2026-11-21T09:00:00')).toISOString(), d.reminders);
  ref = await L.applyEvent(fakeDb(), ev('SUBSCRIPTION_CANCELED', '2026-11-21T16:00:00.000+09:00'), KST('2026-11-21T16:00:00'));
  t('이용기간이 이미 끝났으면 안 보냄', (await ref.get()).data().reminders.length === 0);

  console.log('■ 정기 결제 실패 → 바로 + 다음 날 10시 마지막');
  db = fakeDb(); sentSms.length = 0;
  now = KST('2026-11-21T15:00:05');
  const failEv = ev('SUBSCRIPTION_RENEWAL_FAILED', '2026-11-21T15:00:00.000+09:00', { status: 'FAILED', previousStatus: 'PROGRESS' },
    { payment: { status: 'SUBSCRIPTION_FAILED', failedReason: '카드 승인 실패', phoneNumber: '010-1234-5678', name: '김계현' } });
  ref = await L.applyEvent(db, failEv, now);
  await L.sendDue(db, ref, now, fakeSend);
  t('실패 즉시 한 통', sentSms.length === 1 && /정기 결제가 실패/.test(sentSms[0].text), sentSms.map((m) => m.text));
  t('재결제 기한 = 다음 날 밤 12시(11월 22일(일))', sentSms[0].text.includes('11월 22일(일) 밤 12시까지'), sentSms[0].text);
  t('실패 사유가 들어감', sentSms[0].text.includes('카드 승인 실패'));
  await L.sendDue(db, ref, KST('2026-11-22T10:00:00'), fakeSend);
  t('다음 날 10시 마지막 안내', sentSms.length === 2 && /마지막 안내/.test(sentSms[1].text), sentSms.map((m) => m.text));
  // 같은 실패인데 다음 날 아침에 재결제 성공
  db = fakeDb(); sentSms.length = 0;
  ref = await L.applyEvent(db, Object.assign({}, failEv, { eventId: 'evt_f2' }), now);
  await L.sendDue(db, ref, now, fakeSend);
  await L.applyEvent(db, ev('SUBSCRIPTION_RECOVERED', '2026-11-22T08:00:00.000+09:00', { status: 'PROGRESS', previousStatus: 'FAILED' }), KST('2026-11-22T08:00:00'));
  await L.sendDue(db, ref, KST('2026-11-22T10:00:00'), fakeSend);
  t('재결제(복구)하면 마지막 안내 취소', sentSms.length === 1, sentSms.length);
  // 밤 11시 반 실패 → 아침 9시에 마지막 안내 한 통만
  db = fakeDb();
  ref = await L.applyEvent(db, Object.assign({}, failEv, { eventId: 'evt_f3', date: '2026-11-21T23:30:00.000+09:00' }), KST('2026-11-21T23:30:00'));
  d = (await ref.get()).data();
  t('밤 11시 반 실패 → 다음 날 9시 첫 안내 + 그날 저녁 8시 마지막 안내', d.reminders.length === 2
    && d.reminders[0].kind === 'failNow' && d.reminders[0].dueAt === new Date(KST('2026-11-22T09:00:00')).toISOString()
    && d.reminders[1].kind === 'failFinal' && d.reminders[1].dueAt === new Date(KST('2026-11-22T20:00:00')).toISOString(), d.reminders);

  console.log('■ 순서가 뒤바뀐 알림·다른 멤버십');
  db = fakeDb();
  ref = await L.applyEvent(db, ev('SUBSCRIPTION_RESUMED', '2026-11-12T10:00:00.000+09:00', { status: 'PROGRESS' }), KST('2026-11-12T10:00:00'));
  await L.applyEvent(db, ev('SUBSCRIPTION_CANCELED', '2026-11-11T10:00:00.000+09:00'), KST('2026-11-12T10:01:00'));
  d = (await ref.get()).data();
  t('늦게 도착한 옛 해지 알림은 무시', d.status === 'PROGRESS' && d.reminders.length === 0, d);
  const cfgOnly = Object.assign({}, L.CFG, { membershipIds: ['other'] });
  t('설정한 멤버십이 아니면 무시', (await L.applyEvent(fakeDb(), ev('SUBSCRIPTION_CANCELED', '2026-11-10T13:00:00.000+09:00'), KST('2026-11-10T13:00:00'), cfgOnly)) === null);

  console.log('■ 웹훅 함수 전체(가짜 DB·문자)');
  const db2 = fakeDb(); sentSms.length = 0;
  const orig = Module._load;
  Module._load = function (req) {
    if (req.endsWith('firebaseAdmin')) return { getDb: () => db2 };
    if (req.endsWith('solapi')) return { sendSms: fakeSend, normalizePhone: (s) => String(s).replace(/\D/g, '') };
    return orig.apply(this, arguments);
  };
  const { handler } = require(path.join(__dirname, '../netlify/functions/latpeed-webhook'));
  const { handler: hourly } = require(path.join(__dirname, '../netlify/functions/latpeed-reminders'));
  Module._load = orig;
  const realNow = Date.now;
  Date.now = () => KST('2026-11-21T15:00:05');
  const payload = JSON.stringify(failEv);
  const tsNow = String(Date.now());
  process.env.LATPEED_WEBHOOK_SECRET = 'whsec_live';
  const sigNow = 'sha256=' + crypto.createHmac('sha256', 'whsec_live').update(`${tsNow}.${payload}`).digest('hex');
  const call = (headers, q) => handler({ httpMethod: 'POST', headers, queryStringParameters: q || {}, body: payload });
  let r = await call({});
  t('검증 없는 요청은 401', r.statusCode === 401);
  r = await call({ 'X-Latpeed-Timestamp': tsNow, 'X-Latpeed-Signature': sigNow, 'X-Latpeed-Event-Id': failEv.eventId });
  t('서명이 맞으면 200 + 즉시 문자', r.statusCode === 200 && sentSms.length === 1, [r, sentSms.length]);
  r = await call({ 'X-Latpeed-Timestamp': tsNow, 'X-Latpeed-Signature': sigNow });
  t('같은 eventId 다시 와도 한 번만', r.statusCode === 200 && /duplicate/.test(r.body) && sentSms.length === 1, r.body);
  Date.now = () => KST('2026-11-22T10:00:10');
  r = await hourly();
  t('매시 함수가 다음 날 10시 마지막 안내 발송', r.statusCode === 200 && sentSms.length === 2 && JSON.parse(r.body).sent === 1, r.body);
  r = await hourly();
  t('다시 돌아도 추가 발송 없음', sentSms.length === 2 && JSON.parse(r.body).subs === 0, r.body);
  Date.now = realNow;

  console.log(`\n결과: ${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
