const fs = require('fs');
const vm = require('vm');

// 가짜 localStorage
const mem = new Map();
const localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k)
};

const sandbox = { window: {}, localStorage, console, Intl, Date, Math, JSON, Promise, setTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
const root = require('path').join(__dirname, '..');
for (const f of ['js/config.js', 'js/utils.js', 'js/mailTemplates.js', 'js/store.js'].map((x) => require('path').join(root, x))) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f });
}
const { CS } = sandbox;
const { U, Store, CONFIG, MailTemplates } = CS;

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

(async () => {
  console.log('— 날짜 유틸 —');
  t('챌린지 기간 28일', U.challengeDates().length === 28, U.challengeDates().length);
  t('시작일 요일 = 월', U.weekday('2026-08-24') === '월', U.weekday('2026-08-24'));
  t('종료일 요일 = 일', U.weekday('2026-09-20') === '일', U.weekday('2026-09-20'));
  t('shortLabel', U.shortLabel('2026-08-24') === '8/24(월)', U.shortLabel('2026-08-24'));
  t('longLabel', U.longLabel('2026-09-20') === '2026년 9월 20일(일)', U.longLabel('2026-09-20'));
  t('dayIndex 시작=1', U.dayIndex('2026-08-24') === 1);
  t('dayIndex 종료=28', U.dayIndex('2026-09-20') === 28, U.dayIndex('2026-09-20'));
  t('dayIndex 범위밖=null', U.dayIndex('2026-09-21') === null);
  t('addDays 월경계', U.addDays('2026-08-31', 1) === '2026-09-01');
  t('dateRange 양끝포함', U.dateRange('2026-08-24','2026-08-26').join()==='2026-08-24,2026-08-25,2026-08-26');
  t('오늘(KST) 형식', /^\d{4}-\d{2}-\d{2}$/.test(U.today()), U.today());
  const sec = U.secondsToMidnight();
  t('자정까지 0<초<=86400', sec > 0 && sec <= 86400, sec);

  console.log('— 저장소 —');
  await Store.init();
  const r = await Store.addParticipants(['소니', '커밍쏜', ' 책읽는고래 ', '소니', '']);
  t('일괄 등록 3명', r.added.length === 3, r.added.map(x=>x.nickname));
  t('중복 1건 skip', r.skipped.length === 1 && r.skipped[0] === '소니');
  t('공백 트리밍', (await Store.listParticipants()).some(p => p.nickname === '책읽는고래'));

  let list = await Store.listParticipants();
  const sony = list.find(p => p.nickname === '소니');
  const whale = list.find(p => p.nickname === '책읽는고래');

  t('카톡방 참여 여부 기본값은 미정("")', sony.kakaoJoined === '', sony.kakaoJoined);
  await Store.updateParticipant(sony.id, { kakaoJoined: 'O' });
  t('카톡방 참여 여부 저장(O)',
    (await Store.listParticipants()).find(p => p.id === sony.id).kakaoJoined === 'O');

  t('전화번호 기본값은 빈 문자열', sony.phone === '', sony.phone);
  await Store.updateParticipant(sony.id, { phone: '010-1234-5678' });
  t('전화번호 저장',
    (await Store.listParticipants()).find(p => p.id === sony.id).phone === '010-1234-5678');

  let dupErr = null;
  try { await Store.addParticipant('커밍쏜'); } catch (e) { dupErr = e.message; }
  t('중복 닉네임 거부', !!dupErr, dupErr);

  // 제출 데이터 심기: 소니는 8/24~8/26 인증, 8/27~9/1 미인증
  // (createdAt을 명시적으로 그 날짜 마감 전으로 고정 — 실제 실행 시각과 무관하게 항상 정상 인증으로 판정되도록)
  for (const d of ['2026-08-24','2026-08-25','2026-08-26']) {
    await Store.saveSubmission({ participantId: sony.id, nickname: '소니', date: d,
      sentence: '문장', reflection: '느낀 점', createdAt: `${d}T10:00:00.000Z` });
  }
  t('제출 3건', (await Store.listSubmissions({ participantId: sony.id })).length === 3);

  // 같은 날 재제출 → 덮어쓰기 (createdAt은 그대로, updatedAt만 갱신)
  await Store.saveSubmission({ participantId: sony.id, nickname: '소니', date: '2026-08-24',
    sentence: '문장 수정', reflection: 'ㄷ' });
  const subs = await Store.listSubmissions({ participantId: sony.id });
  t('중복 제출 시 덮어쓰기(건수 유지)', subs.length === 3, subs.length);
  t('덮어쓴 내용 반영', (await Store.getSubmission(sony.id, '2026-08-24')).sentence === '문장 수정');

  console.log('— 집계 (오늘=2026-09-02 가정) —');
  const T = '2026-09-02';
  let all = await Store.listParticipants();
  let allSubs = await Store.listSubmissions();
  let st = U.buildStats(all, allSubs, T).find(s => s.participant.id === sony.id);
  t('인증 3', st.verified === 3, st.verified);
  // 8/24~9/1 = 9일, 그중 3일 인증 → 미인증 6, 오늘(9/2)은 미확정
  t('미인증 6', st.missed === 6, st.missed);
  t('위험군(riskThreshold=4 이상)', st.atRisk === true);
  t('킥아웃 대상(kickoutThreshold=6 이상)', st.kickoutEligible === true);
  t('riskTag: 킥아웃 대상(아직 아웃 처리 전)', U.riskTag(st).label === '킥아웃 대상', U.riskTag(st));
  t('인증률 33%', st.rate === 33, st.rate);
  // 6회째 미인증(9/1)에 킥아웃이 확정되므로, 그 뒤 날짜는 집계에서 빠진다
  t('킥아웃 확정일이 6회째 미인증한 날', st.kickoutDate === '2026-09-01', st.kickoutDate);
  t('킥아웃 다음 날부터는 집계 제외', st.cells.find(c => c.date === '2026-09-02').status === '·');
  t('그 뒤 날짜도 계속 집계 제외', st.cells.find(c => c.date === '2026-09-10').status === '·');
  t('미인증이 킥아웃 기준에서 멈춤', st.missed === 6, st.missed);

  // 면제 등록 → 미인증 감소
  await Store.updateParticipant(sony.id, { exemptDates: ['2026-08-27', '2026-08-28'] });
  all = await Store.listParticipants();
  st = U.buildStats(all, await Store.listSubmissions(), T).find(s => s.participant.id === sony.id);
  t('면제 2일 반영', st.exempt === 2, st.exempt);
  t('면제 후 미인증 4', st.missed === 4, st.missed);
  t('면제 후에도 위험군은 유지(4회 = riskThreshold)', st.atRisk === true);
  t('면제 후 킥아웃 대상에서는 해제(4 < kickoutThreshold=6)', st.kickoutEligible === false);
  t('면제는 인증률 계산에서 제외', st.rate === Math.round(3/7*100), st.rate);
  // 인증 / 미인증 / 면제 3가지로 나뉘고, 킥아웃은 '미인증'만 센다
  t('면제일 셀은 P로 표시', st.cells.find(c => c.date === '2026-08-27').status === 'P');
  t('면제는 미인증에 포함되지 않음',
    st.cells.filter(c => c.status === 'X').length === st.missed
    && st.cells.filter(c => c.status === 'P').length === st.exempt, { missed: st.missed, exempt: st.exempt });
  t('셀 개수 = 인증 + 미인증 + 면제 + 나머지(미확정·해당없음)',
    st.verified + st.missed + st.exempt
      === st.cells.filter(c => ['O','X','P'].includes(c.status)).length,
    { v: st.verified, m: st.missed, e: st.exempt });
  // 면제를 더 걸어도 미인증만 줄어들 뿐, 면제 자체는 킥아웃 기준을 올리지 않는다
  await Store.updateParticipant(sony.id, { exemptDates: ['2026-08-27','2026-08-28','2026-08-29','2026-08-30','2026-08-31','2026-09-01'] });
  st = U.buildStats(await Store.listParticipants(), await Store.listSubmissions(), T)
    .find(s => s.participant.id === sony.id);
  t('면제 6일이어도 미인증 0이면 킥아웃 대상 아님',
    st.exempt === 6 && st.missed === 0 && st.kickoutEligible === false && st.atRisk === false,
    { exempt: st.exempt, missed: st.missed });
  t('면제만 있는 사람은 킥아웃 확정일도 없음', st.kickoutDate === null, st.kickoutDate);
  // 원래 상태로 되돌려 뒤 테스트에 영향이 없게 한다
  await Store.updateParticipant(sony.id, { exemptDates: ['2026-08-27', '2026-08-28'] });
  st = U.buildStats(await Store.listParticipants(), await Store.listSubmissions(), T)
    .find(s => s.participant.id === sony.id);

  // 연속 인증: 8/31, 9/1 인증 → streak 2 (9/2는 아직 미제출이지만 마감 전이라 연속 유지)
  // 합류일을 8/31로 둬서 그 전 날짜는 집계 대상이 아니게 한다(킥아웃 동결과 무관하게 검증).
  const streaker = await Store.addParticipant('연속이');
  await Store.updateParticipant(streaker.id, { joinDate: '2026-08-31' });
  for (const d of ['2026-08-31','2026-09-01']) {
    await Store.saveSubmission({ participantId: streaker.id, nickname: '연속이', date: d,
      sentence: 's', reflection: 'r', createdAt: `${d}T10:00:00.000Z` });
  }
  st = U.buildStats(await Store.listParticipants(), await Store.listSubmissions(), T)
    .find(s => s.participant.id === streaker.id);
  t('연속 인증 2', st.streak === 2, st.streak);
  t('연속 인증자는 킥아웃 확정 없음', st.kickoutDate === null, st.kickoutDate);

  // 닉네임 변경 시 제출 기록의 표시 닉네임도 갱신
  await Store.updateParticipant(whale.id, { nickname: '고래' });
  const wsubs = await Store.listSubmissions({ participantId: whale.id });
  t('닉네임 변경 전파', wsubs.every(s => s.nickname === '고래'), wsubs.map(s=>s.nickname));

  console.log('— 지각 제출 판정 (참여자가 날짜를 골라도 마감을 넘기면 계속 X) —');
  const ggomi = list.find(p => p.nickname === '커밍쏜');
  // 8/24 마감(24:00 KST = 8/24 15:00 UTC) 전에 제출 → 정상 인증
  await Store.saveSubmission({ participantId: ggomi.id, nickname: '커밍쏜', date: '2026-08-24',
    sentence: '제때 냄', reflection: 'r', createdAt: '2026-08-24T10:00:00.000Z' });
  // 8/25 마감을 넘겨(8/25 새벽, 즉 8/25 15:01 UTC) 8/25치를 제출 → 기록은 남지만 지각이라 X 유지
  await Store.saveSubmission({ participantId: ggomi.id, nickname: '커밍쏜', date: '2026-08-25',
    sentence: '늦게 냄', reflection: 'r', createdAt: '2026-08-25T15:01:00.000Z' });
  // 참여자가 드롭다운으로 지난 날짜(8/26)를 골라 한참 뒤(8/28)에 뒤늦게 기록만 남긴 경우
  await Store.saveSubmission({ participantId: ggomi.id, nickname: '커밍쏜', date: '2026-08-26',
    sentence: '한참 뒤에 기록', reflection: 'r', createdAt: '2026-08-28T09:00:00.000Z' });

  let lateSt = U.buildStats(await Store.listParticipants(), await Store.listSubmissions(), T)
    .find(s => s.participant.id === ggomi.id);
  t('마감 전 제출은 인증(O)', lateSt.cells.find(c => c.date === '2026-08-24').status === 'O');
  t('마감 넘긴 제출은 기록은 남아도 미인증(X)', lateSt.cells.find(c => c.date === '2026-08-25').status === 'X');
  t('며칠 뒤 지난 날짜로 남긴 기록도 미인증(X) 유지', lateSt.cells.find(c => c.date === '2026-08-26').status === 'X');

  // 제때 낸 인증을 나중에 오탈자만 고쳐도(같은 날짜 재제출) createdAt은 그대로라 여전히 O
  await Store.saveSubmission({ participantId: ggomi.id, nickname: '커밍쏜', date: '2026-08-24',
    sentence: '제때 냈고 나중에 오탈자만 고침', reflection: 'r' });
  lateSt = U.buildStats(await Store.listParticipants(), await Store.listSubmissions(), T)
    .find(s => s.participant.id === ggomi.id);
  t('제때 낸 인증을 나중에 수정해도 여전히 O (createdAt 유지)',
    lateSt.cells.find(c => c.date === '2026-08-24').status === 'O');
  t('수정된 내용 반영', (await Store.getSubmission(ggomi.id, '2026-08-24')).sentence.includes('오탈자만 고침'));

  // 지각 제출이라도 그 날짜가 면제일로 등록되면 P로 처리
  await Store.updateParticipant(ggomi.id, { exemptDates: ['2026-08-25'] });
  lateSt = U.buildStats(await Store.listParticipants(), await Store.listSubmissions(), T)
    .find(s => s.participant.id === ggomi.id);
  t('지각 제출이라도 면제일로 등록되면 P', lateSt.cells.find(c => c.date === '2026-08-25').status === 'P');

  t('isLate: 마감 전이면 정상', U.isLate('2026-08-24', '2026-08-24T14:59:59.999Z') === false);
  t('isLate: 마감 정각(24:00)까지는 정상', U.isLate('2026-08-24', '2026-08-24T15:00:00.000Z') === false);
  t('isLate: 마감 1ms만 넘어도 지각', U.isLate('2026-08-24', '2026-08-24T15:00:00.001Z') === true);

  console.log('— 엄지척 추천/취소 —');
  const firstSub = (await Store.listSubmissions({ participantId: streaker.id }))[0];
  const up = await Store.upvoteSubmission(firstSub.id, 'cli_test');
  t('추천 반영', up.upvotes === 1 && up.upvotedBy.includes('cli_test'), up);
  let dupVoteErr = null;
  try { await Store.upvoteSubmission(firstSub.id, 'cli_test'); } catch (e) { dupVoteErr = e.message; }
  t('중복 추천 거부', !!dupVoteErr, dupVoteErr);
  const down = await Store.unvoteSubmission(firstSub.id, 'cli_test');
  t('추천 취소 반영', down.upvotes === 0 && !down.upvotedBy.includes('cli_test'), down);
  let unvoteErr = null;
  try { await Store.unvoteSubmission(firstSub.id, 'cli_test'); } catch (e) { unvoteErr = e.message; }
  t('추천한 적 없는 취소 거부', !!unvoteErr, unvoteErr);

  console.log('— 인증 알림 메일 목록 —');
  await Store.addNotifyEmail('소니', 'Reader@Example.com');
  let mailDupErr = null;
  try { await Store.addNotifyEmail('소니', 'reader@example.com'); } catch (e) { mailDupErr = e.message; }
  t('메일 소문자 정규화 + 중복 거부', !!mailDupErr, mailDupErr);
  let mailFormatErr = null;
  try { await Store.addNotifyEmail('소니', 'not-an-email'); } catch (e) { mailFormatErr = e.message; }
  t('메일 형식 검증', !!mailFormatErr, mailFormatErr);
  let mails = await Store.listNotifyEmails();
  t('메일 목록 1건 (이름 포함)', mails.length === 1 && mails[0].email === 'reader@example.com'
    && mails[0].name === '소니', mails);
  await Store.removeNotifyEmail(mails[0].id);
  mails = await Store.listNotifyEmails();
  t('메일 삭제', mails.length === 0);

  const bulk = await Store.addNotifyEmails([
    { name: '커밍쏜', email: 'a@example.com' },
    { name: '책읽는고래', email: 'B@Example.com' },
    { name: '중복', email: 'a@example.com' },
    { name: '', email: '이상한값' },
    { name: '', email: '' }
  ]);
  t('일괄 등록: 등록 2건', bulk.added.length === 2, bulk.added.map(m => m.email));
  t('일괄 등록: 이름도 함께 저장됨', bulk.added.every(m => m.name), bulk.added.map(m => m.name));
  t('일괄 등록: 중복 1건', bulk.skipped.length === 1 && bulk.skipped[0] === 'a@example.com', bulk.skipped);
  t('일괄 등록: 형식 오류 1건', bulk.invalid.length === 1, bulk.invalid);
  mails = await Store.listNotifyEmails();
  t('일괄 등록 후 목록 2건', mails.length === 2, mails.map(m => m.email));
  for (const m of mails) await Store.removeNotifyEmail(m.id);

  console.log('— meta(킥아웃 통보 메일 문구 저장) —');
  t('저장 전에는 kickoutMailTemplate 없음', !(await Store.getMeta()).kickoutMailTemplate);
  await Store.setMeta({ kickoutMailTemplate: { subject: '제목 테스트', body: '본문 {{이름}}', updatedAt: '2026-08-30T00:00:00.000Z' } });
  const savedTpl = (await Store.getMeta()).kickoutMailTemplate;
  t('저장한 제목·본문을 그대로 불러옴',
    savedTpl && savedTpl.subject === '제목 테스트' && savedTpl.body === '본문 {{이름}}', savedTpl);
  await Store.setMeta({ kickoutMailTemplate: null }); // 기본값으로 되돌리기
  t('null로 저장하면 기본값 사용 상태로 되돌아감', !(await Store.getMeta()).kickoutMailTemplate);

  t('저장 전에는 missed5MailTemplate 없음', !(await Store.getMeta()).missed5MailTemplate);
  await Store.setMeta({ missed5MailTemplate: { subject: '경고 제목', body: '{{이름}} 경고 본문', updatedAt: '2026-08-30T00:00:00.000Z' } });
  const savedMissed5Tpl = (await Store.getMeta()).missed5MailTemplate;
  t('저장한 미인증 5회 경고 문구를 그대로 불러옴',
    savedMissed5Tpl && savedMissed5Tpl.subject === '경고 제목' && savedMissed5Tpl.body === '{{이름}} 경고 본문', savedMissed5Tpl);
  await Store.setMeta({ missed5MailTemplate: null });
  t('missed5MailTemplate도 null로 저장하면 기본값 사용 상태로 되돌아감', !(await Store.getMeta()).missed5MailTemplate);

  console.log('— 메일 문구 기본값·자리표시자 치환(CS.MailTemplates) —');
  t('자동 경고 기준(5회)이 설정에 있음', CONFIG.autoWarnThreshold === 5, CONFIG.autoWarnThreshold);
  t('킥아웃 기준(6회)보다 자동 경고 기준이 낮음(1회만 더 미인증되면 킥아웃)',
    CONFIG.autoWarnThreshold < CONFIG.kickoutThreshold);
  t('fill: {{키}} 자리표시자를 값으로 치환',
    MailTemplates.fill('안녕 {{이름}}, 기준은 {{N}}회', { 이름: '테스터', N: 5 }) === '안녕 테스터, 기준은 5회');
  t('킥아웃 메일 기본 제목에 챌린지 이름 포함', MailTemplates.defaultKickoutSubject().includes(CONFIG.title));
  t('킥아웃 메일 기본 본문에 {{이름}}·{{킥아웃기준}} 자리표시자 포함',
    MailTemplates.defaultKickoutBody().includes('{{이름}}') && MailTemplates.defaultKickoutBody().includes('{{킥아웃기준}}'));
  t('미인증 5회 경고 메일 기본 본문에 {{이름}}·{{자동경고기준}}·{{킥아웃기준}}·{{앱주소}} 자리표시자 포함',
    ['{{이름}}', '{{자동경고기준}}', '{{킥아웃기준}}', '{{앱주소}}'].every((ph) => MailTemplates.defaultMissed5Body().includes(ph)));
  const filledMissed5 = MailTemplates.fill(MailTemplates.defaultMissed5Body(),
    { 이름: '김철수', 자동경고기준: CONFIG.autoWarnThreshold, 킥아웃기준: CONFIG.kickoutThreshold, 앱주소: CONFIG.appUrl });
  t('미인증 5회 경고 메일 치환 결과에 자리표시자가 남지 않음', !filledMissed5.includes('{{'), filledMissed5);
  t('미인증 5회 경고 메일 치환 결과에 실제 이름·기준 횟수 반영',
    filledMissed5.includes('김철수') && filledMissed5.includes('5회') && filledMissed5.includes('6회'), filledMissed5);

  console.log('— 공지문 (날짜별 미리 작성) —');
  t('저장 전에는 null', (await Store.getNotice('2026-08-24')) === null);
  await Store.setNotice('2026-08-24', '  8/24 공지 초안입니다  ');
  const notice1 = await Store.getNotice('2026-08-24');
  t('저장한 내용을 그대로 불러옴(앞뒤 공백은 정리)',
    notice1 && notice1.text === '8/24 공지 초안입니다', notice1);
  await Store.setNotice('2026-08-25', '8/25 공지');
  const noticeList = await Store.listNotices();
  t('날짜순으로 2건', noticeList.length === 2
    && noticeList[0].date === '2026-08-24' && noticeList[1].date === '2026-08-25', noticeList);
  await Store.setNotice('2026-08-24', ''); // 빈 값으로 저장 = 삭제(자동 생성 문구로 되돌림)
  t('빈 값으로 저장하면 삭제됨', (await Store.getNotice('2026-08-24')) === null);
  t('삭제 후 목록 1건', (await Store.listNotices()).length === 1);
  await Store.setNotice('2026-08-25', '');

  // 아웃 처리 후 이후 날짜는 '·' (8/29 합류 → 8/29·8/30 미인증 2회, 8/31·9/1 인증)
  const outer = await Store.addParticipant('아웃이');
  await Store.updateParticipant(outer.id, { joinDate: '2026-08-29' });
  for (const d of ['2026-08-31','2026-09-01']) {
    await Store.saveSubmission({ participantId: outer.id, nickname: '아웃이', date: d,
      sentence: 's', reflection: 'r', createdAt: `${d}T10:00:00.000Z` });
  }
  await Store.updateParticipant(outer.id, { status: 'out', outDate: '2026-09-01' });
  st = U.buildStats(await Store.listParticipants(), await Store.listSubmissions(), T)
    .find(s => s.participant.id === outer.id);
  t('아웃 당일까지는 집계', st.cells.find(c => c.date === '2026-09-01').status === 'O');
  t('아웃 이후 날짜 제외', st.cells.find(c => c.date === '2026-09-02').status === '·'
    && st.cells.find(c => c.date === '2026-09-03').status === '·',
    st.cells.slice(9,12).map(c=>c.status));
  t('아웃 이후는 미인증으로 안 쌓임', st.missed === 2, st.missed);
  t('riskTag: 일반 아웃 처리는 "아웃" 라벨', U.riskTag(st).label === '아웃', U.riskTag(st));

  // 미인증 누적으로 킥아웃 처리(kickReason:'kickout')하면 "아웃"과 구분되는 "킥아웃" 라벨을 단다
  await Store.updateParticipant(outer.id, { kickReason: 'kickout' });
  st = U.buildStats(await Store.listParticipants(), await Store.listSubmissions(), T)
    .find(s => s.participant.id === outer.id);
  t('riskTag: 킥아웃 처리는 "킥아웃" 라벨로 구분', U.riskTag(st).label === '킥아웃', U.riskTag(st));

  // 복귀시키면(status/kickReason 초기화) 다시 정상 참여중으로 돌아온다
  await Store.updateParticipant(outer.id, { status: 'active', outDate: null, kickReason: null });
  st = U.buildStats(await Store.listParticipants(), await Store.listSubmissions(), T)
    .find(s => s.participant.id === outer.id);
  t('복귀 후에는 아웃·킥아웃 라벨 모두 사라짐',
    U.riskTag(st).label !== '킥아웃' && U.riskTag(st).label !== '아웃', U.riskTag(st));


  // 백업 / 복원 / 삭제
  const dump = await Store.exportAll();
  t('백업에 참가자 포함', dump.participants.length === 5, dump.participants.length);
  await Store.clearAll();
  t('전체 삭제', (await Store.listParticipants()).length === 0);
  await Store.importAll(dump);
  t('복원', (await Store.listParticipants()).length === 5
    && (await Store.listSubmissions()).length === dump.submissions.length);

  await Store.removeParticipant(sony.id);
  t('참가자 삭제 시 제출도 삭제',
    (await Store.listSubmissions({ participantId: sony.id })).length === 0);

  console.log(`\n결과: ${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
