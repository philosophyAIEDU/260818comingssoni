/* 래피드(Latpeed) 웹훅 → 멤버십 안내 문자 — 날짜 계산·문구·저장·발송 공통 코드.
 * 웹훅 수신(latpeed-webhook.js)과 매시 발송(latpeed-reminders.js)이 함께 쓴다. 설정·문구는 latpeedConfig.js.
 *
 * 저장(Firestore, 시즌과 무관한 공용 컬렉션)
 *   latpeed_events/{eventId}               받은 웹훅 원본(같은 알림이 여러 번 와도 한 번만 처리)
 *   latpeed_subscriptions/{subscriptionId}  구독자별 최신 상태 + 보낼/보낸 문자 목록(reminders)
 */
const crypto = require('crypto');
const CFG = require('./latpeedConfig');

const DAY = 86400000;
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

/* ── KST 날짜 ── */
function kstDate(ms) { return new Date(ms + 9 * 3600000).toISOString().slice(0, 10); }
function kstHour(ms) { return new Date(ms + 9 * 3600000).getUTCHours(); }
function kstAt(dateISO, hour) { return Date.parse(`${dateISO}T${String(hour).padStart(2, '0')}:00:00+09:00`); }
function addDays(dateISO, n) { return new Date(Date.parse(dateISO + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10); }
function dateLabel(dateISO) {
  const d = new Date(dateISO + 'T00:00:00Z');
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${WEEKDAY[d.getUTCDay()]})`;
}

/** 밤사이(quietStart~quietEnd)면 그날/다음 날 아침 quietEnd 시로 미룬다 */
function deferQuiet(ms, cfg = CFG) {
  const h = kstHour(ms);
  if (h >= cfg.quietStartHour) return kstAt(addDays(kstDate(ms), 1), cfg.quietEndHour);
  if (h < cfg.quietEndHour) return kstAt(kstDate(ms), cfg.quietEndHour);
  return ms;
}

/* ── 보낼 문자 계획 ── */
/**
 * 이벤트 하나로 새로 잡을 문자 목록을 만든다. [{ kind, dueAt(ms), meta }]
 *  - 해지: 결제일(=이용기간 종료일 finishedAt의 KST 날짜) D-2·D-1 sendHour 시.
 *          해지가 늦게 들어와 시각이 이미 지났으면 지난 것 중 마지막 하나를 바로(밤이면 아침) 보낸다.
 *  - 결제 실패: 바로(밤이면 아침) + 다음 날 sendHour 시 마지막 안내. 재결제 기한은 실패 다음 날 자정.
 *          밤늦게 실패해 첫 안내가 기한 당일 아침이면 마지막 안내는 그날 저녁 lateFinalHour 시.
 */
function planReminders(ev, nowMs, cfg = CFG) {
  const sub = ev.subscription || {};
  if (ev.subtype === 'SUBSCRIPTION_CANCELED' && sub.status === 'CANCEL' && sub.finishedAt) {
    const endMs = Date.parse(sub.finishedAt);
    if (!(endMs > nowMs)) return [];
    const billDate = kstDate(endMs);
    const meta = { billDate, finishedAt: sub.finishedAt };
    const plan = [
      { kind: 'cancelD2', dueAt: kstAt(addDays(billDate, -2), cfg.sendHour), meta },
      { kind: 'cancelD1', dueAt: kstAt(addDays(billDate, -1), cfg.sendHour), meta },
    ];
    const future = plan.filter((r) => r.dueAt > nowMs);
    const passed = plan.filter((r) => r.dueAt <= nowMs);
    if (passed.length) {
      const now = deferQuiet(nowMs, cfg);
      if (now < endMs) future.unshift(Object.assign({}, passed[passed.length - 1], { dueAt: now }));
    }
    // 같은 시각에 두 통이 겹치면 뒤엣것(D-1)만
    return future.filter((r, i) => !future.slice(i + 1).some((x) => x.dueAt === r.dueAt));
  }
  if (ev.subtype === 'SUBSCRIPTION_RENEWAL_FAILED') {
    const failMs = Date.parse(ev.date) || nowMs;
    const deadlineDate = addDays(kstDate(failMs), 1);
    const deadlineMs = kstAt(addDays(deadlineDate, 1), 0); // 다음 날 자정(24:00)
    const meta = { deadlineDate, failedReason: (ev.payment && ev.payment.failedReason) || '' };
    const now = deferQuiet(Math.max(nowMs, failMs), cfg);
    if (now >= deadlineMs) return [];
    // 보통은 실패 다음 날 sendHour 시에 마지막 안내. 밤늦게 실패해 첫 안내가 이미 기한 당일 아침이면,
    // 마지막 안내는 그날 저녁 lateFinalHour 시로(자정 기한 전에 한 번 더)
    let finalAt = kstAt(deadlineDate, cfg.sendHour);
    if (kstDate(now) === deadlineDate) finalAt = kstAt(deadlineDate, cfg.lateFinalHour || 20);
    if (finalAt - now < 3 * 3600000) return [{ kind: 'failNow', dueAt: now, meta }];
    return [{ kind: 'failNow', dueAt: now, meta }, { kind: 'failFinal', dueAt: finalAt, meta }];
  }
  return [];
}

/** 이 문자를 지금도 보내야 하는지 — 그 사이 철회·복구·종료됐으면 보내지 않는다 */
function stillRelevant(kind, sub) {
  if (kind.startsWith('cancel')) return sub.status === 'CANCEL';
  if (kind.startsWith('fail')) return sub.status === 'FAILED';
  return false;
}

/* ── 문구 ── */
function fill(tpl, vars) { return String(tpl).replace(/\{\{([^}]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m)); }

function render(kind, sub, meta, cfg = CFG) {
  const t = cfg.templates[kind];
  const vars = {
    brand: cfg.brand,
    이름: sub.name || '회원',
    멤버십: sub.membershipName || '',
    링크: cfg.manageUrl,
    결제일: meta.billDate ? dateLabel(meta.billDate) : '',
    퇴장기한: meta.billDate ? dateLabel(addDays(meta.billDate, cfg.leaveByOffsetDays || 0)) : '',
    재결제기한: meta.deadlineDate ? `${dateLabel(meta.deadlineDate)} 밤 12시` : '',
    실패사유: meta.failedReason ? `\n(사유: ${meta.failedReason})` : '',
  };
  return { subject: fill(t.subject, vars), text: fill(t.text, vars) };
}

/* ── 요청 검증 ── */
function sha256hex(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
/** 주소의 ?token= 이 맞거나, 래피드 웹훅 시크릿(HMAC) 서명이 맞으면 통과 */
function verifyRequest({ token, rawBody, timestamp, signature, secret, nowMs }, cfg = CFG) {
  if (token && cfg.webhookTokenSha256 && safeEqual(sha256hex(token), cfg.webhookTokenSha256)) return true;
  if (secret && timestamp && signature) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs((nowMs || Date.now()) - ts) > 5 * 60000) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    return safeEqual(expected, signature);
  }
  return false;
}

/* ── 저장·발송 ── */
const SUBS = 'latpeed_subscriptions';
const EVENTS = 'latpeed_events';
const iso = (ms) => new Date(ms).toISOString();

/** 웹훅 이벤트를 구독 상태에 반영하고 문자 계획을 갱신한다. 반환: 구독 문서 ref (없으면 null) */
async function applyEvent(db, ev, nowMs, cfg = CFG) {
  const sub = ev.subscription;
  if (ev.type !== 'MEMBERSHIP_PAYMENT' || !sub || !sub.subscriptionId) return null;
  const mid = ev.membership && ev.membership.membershipId;
  if (cfg.membershipIds && cfg.membershipIds.length && !cfg.membershipIds.includes(mid)) return null;
  const ref = db.collection(SUBS).doc(sub.subscriptionId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? snap.data() : { reminders: [] };
    // 늦게 도착한 옛 이벤트는 상태를 되돌리지 않는다
    if (cur.lastEventDate && Date.parse(cur.lastEventDate) > Date.parse(ev.date)) {
      tx.set(ref, { staleEvents: (cur.staleEvents || 0) + 1 }, { merge: true });
      return;
    }
    const person = ev.subscriber || ev.payment || {};
    const reminders = (cur.reminders || []).map((r) => (
      r.status === 'pending' ? Object.assign({}, r, { status: 'cancelled', cancelledBy: ev.subtype, cancelledAt: iso(nowMs) }) : r
    ));
    // 새 계획(해지·실패)만 추가. 다른 이벤트(철회·복구·갱신·종료)는 남은 문자를 취소하는 것으로 끝
    planReminders(ev, nowMs, cfg).forEach((r) => reminders.push({
      id: `${ev.eventId}:${r.kind}`, kind: r.kind, dueAt: iso(r.dueAt), status: 'pending', attempts: 0,
      eventId: ev.eventId, meta: r.meta,
    }));
    tx.set(ref, {
      subscriptionId: sub.subscriptionId,
      name: person.name || cur.name || '', phone: person.phoneNumber || cur.phone || '', email: person.email || cur.email || '',
      membershipId: mid || cur.membershipId || '', membershipName: (ev.membership && ev.membership.name) || cur.membershipName || '',
      status: sub.status, finishedAt: sub.finishedAt || null, canceledAt: sub.canceledAt || null,
      lastEvent: ev.subtype, lastEventDate: ev.date, updatedAt: iso(nowMs),
      reminders, hasPending: reminders.some((r) => r.status === 'pending'),
    }, { merge: true });
  });
  return ref;
}

/** 이 구독에서 때가 된 문자를 보낸다. sendSms는 주입(테스트에서 가짜로 바꾸기 위해) */
async function sendDue(db, ref, nowMs, sendSms, cfg = CFG) {
  const results = [];
  // 한 통씩 트랜잭션으로 'sending'을 잡고 보낸다 — 웹훅과 매시 함수가 겹쳐도 두 번 안 간다
  for (;;) {
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const d = snap.data();
      const list = (d.reminders || []).slice();
      const i = list.findIndex((r) => (r.status === 'pending' || (r.status === 'sending' && nowMs - Date.parse(r.claimedAt) > 30 * 60000))
        && Date.parse(r.dueAt) <= nowMs);
      if (i < 0) return null;
      const r = list[i];
      if (!stillRelevant(r.kind, d)) {
        list[i] = Object.assign({}, r, { status: 'cancelled', cancelledBy: `상태 ${d.status}`, cancelledAt: iso(nowMs) });
      } else if (!d.phone) {
        list[i] = Object.assign({}, r, { status: 'failed', error: '전화번호 없음' });
      } else {
        list[i] = Object.assign({}, r, { status: 'sending', claimedAt: iso(nowMs), attempts: (r.attempts || 0) + 1 });
      }
      tx.set(ref, { reminders: list, hasPending: list.some((x) => x.status === 'pending' || x.status === 'sending') }, { merge: true });
      return { r: list[i], sub: d };
    });
    if (!claimed) break;
    if (claimed.r.status !== 'sending') { results.push(claimed.r); continue; }
    const { r, sub } = claimed;
    let patch;
    try {
      const msg = render(r.kind, sub, r.meta || {}, cfg);
      await sendSms({ to: sub.phone, subject: msg.subject, text: msg.text });
      patch = { status: 'sent', sentAt: iso(nowMs) };
    } catch (err) {
      patch = r.attempts >= 3 ? { status: 'failed', error: err.message } : { status: 'pending', error: err.message };
    }
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const list = (snap.data().reminders || []).map((x) => (x.id === r.id ? Object.assign({}, x, patch) : x));
      tx.set(ref, { reminders: list, hasPending: list.some((x) => x.status === 'pending' || x.status === 'sending') }, { merge: true });
    });
    results.push(Object.assign({}, r, patch));
    if (patch.status === 'pending') break; // 실패한 건 다음 시간에 다시
  }
  return results;
}

module.exports = {
  CFG, SUBS, EVENTS,
  kstDate, kstAt, addDays, dateLabel, deferQuiet, planReminders, stillRelevant, render, fill,
  sha256hex, verifyRequest, applyEvent, sendDue,
};
