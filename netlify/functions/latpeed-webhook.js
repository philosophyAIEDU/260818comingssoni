/* 래피드(Latpeed) 웹훅 수신 — 래피드 [멤버십 관리 → 외부 툴 연동 → 웹훅]에 이 함수 주소(?token=…)를 넣는다.
 *
 * 멤버십 구독 해지·결제 실패가 오면 안내 문자를 잡아 두고(바로 보낼 것은 지금 보낸다),
 * 해지 철회·실패 복구·갱신·종료가 오면 남은 안내를 취소한다. 자세한 규칙은 _lib/latpeed.js·latpeedConfig.js.
 *
 * 래피드 규칙: 5초 안에 2xx로 답해야 하고, 같은 알림이 다시 올 수 있다(eventId로 한 번만 처리).
 * 요청 검증: 주소의 ?token= (SHA-256을 latpeedConfig.webhookTokenSha256과 비교) 또는
 *           래피드 웹훅 시크릿 서명(X-Latpeed-Signature, 환경 변수 LATPEED_WEBHOOK_SECRET). */
const { getDb } = require('./_lib/firebaseAdmin');
const { sendSms } = require('./_lib/solapi');
const L = require('./_lib/latpeed');

const reply = (statusCode, body) => ({ statusCode, body: typeof body === 'string' ? body : JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, 'Method Not Allowed');
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  const h = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const ok = L.verifyRequest({
    token: (event.queryStringParameters || {}).token,
    rawBody: raw, timestamp: h['x-latpeed-timestamp'], signature: h['x-latpeed-signature'],
    secret: process.env.LATPEED_WEBHOOK_SECRET,
  });
  if (!ok) return reply(401, 'invalid token or signature');

  let ev;
  try { ev = JSON.parse(raw); } catch { return reply(400, 'invalid json'); }
  const eventId = ev.eventId || h['x-latpeed-event-id'];
  if (!eventId) return reply(400, 'missing eventId');
  ev.eventId = eventId;

  const db = getDb();
  const now = Date.now();
  // 같은 알림은 한 번만 — 문서를 create로 만들고, 이미 있으면 이미 처리한 것
  try {
    await db.collection(L.EVENTS).doc(eventId).create({
      type: ev.type || '', subtype: ev.subtype || '', date: ev.date || '', receivedAt: new Date(now).toISOString(),
      subscriptionId: (ev.subscription && ev.subscription.subscriptionId) || '', body: raw.slice(0, 20000),
    });
  } catch (err) {
    if (String(err.code) === '6' || /already exists/i.test(err.message)) return reply(200, { duplicate: true });
    throw err;
  }

  const ref = await L.applyEvent(db, ev, now);
  let sent = [];
  if (ref) {
    // 바로 보낼 문자(결제 실패 즉시 안내 등)는 지금 — 실패해도 매시 함수가 다시 시도하므로 웹훅은 성공으로 답한다
    try { sent = await L.sendDue(db, ref, now, sendSms); } catch (err) { console.error('[latpeed-webhook] 즉시 발송 실패', err); }
  }
  console.log(`[latpeed-webhook] ${ev.type}/${ev.subtype} ${eventId} → 처리${ref ? '' : '(대상 아님)'} · 즉시 ${sent.filter((r) => r.status === 'sent').length}통`);
  return reply(200, { ok: true });
};
