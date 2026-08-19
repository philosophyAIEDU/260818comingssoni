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
for (const f of ['js/config.js', 'js/utils.js', 'js/store.js'].map((x) => require('path').join(root, x))) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f });
}
const { CS } = sandbox;
const { U, Store, CONFIG } = CS;

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

  let dupErr = null;
  try { await Store.addParticipant('커밍쏜'); } catch (e) { dupErr = e.message; }
  t('중복 닉네임 거부', !!dupErr, dupErr);

  // 제출 데이터 심기: 소니는 8/24~8/26 인증, 8/27~9/1 미인증
  for (const d of ['2026-08-24','2026-08-25','2026-08-26']) {
    await Store.saveSubmission({ participantId: sony.id, nickname: '소니', date: d,
      sentence: '문장', reflection: '느낀 점' });
  }
  t('제출 3건', (await Store.listSubmissions({ participantId: sony.id })).length === 3);

  // 같은 날 재제출 → 덮어쓰기
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
  t('킥아웃 대상(>=5)', st.atRisk === true);
  t('인증률 33%', st.rate === 33, st.rate);
  t('오늘 셀은 미확정', st.cells.find(c => c.date === '2026-09-02').status === '-');
  t('미래 셀은 미확정', st.cells.find(c => c.date === '2026-09-10').status === '-');

  // 면제 등록 → 미인증 감소
  await Store.updateParticipant(sony.id, { exemptDates: ['2026-08-27', '2026-08-28'] });
  all = await Store.listParticipants();
  st = U.buildStats(all, await Store.listSubmissions(), T).find(s => s.participant.id === sony.id);
  t('면제 2일 반영', st.exempt === 2, st.exempt);
  t('면제 후 미인증 4', st.missed === 4, st.missed);
  t('면제 후 킥아웃 해제', st.atRisk === false);
  t('면제는 인증률 계산에서 제외', st.rate === Math.round(3/7*100), st.rate);

  // 연속 인증: 8/31, 9/1 인증 추가 → streak 2 (9/2는 아직 미제출이지만 마감 전이라 연속 유지)
  for (const d of ['2026-08-31','2026-09-01']) {
    await Store.saveSubmission({ participantId: whale.id, nickname: '책읽는고래', date: d,
      sentence: 's', reflection: 'r' });
  }
  st = U.buildStats(await Store.listParticipants(), await Store.listSubmissions(), T)
    .find(s => s.participant.id === whale.id);
  t('연속 인증 2', st.streak === 2, st.streak);

  // 닉네임 변경 시 제출 기록의 표시 닉네임도 갱신
  await Store.updateParticipant(whale.id, { nickname: '고래' });
  const wsubs = await Store.listSubmissions({ participantId: whale.id });
  t('닉네임 변경 전파', wsubs.every(s => s.nickname === '고래'), wsubs.map(s=>s.nickname));

  console.log('— 엄지척 추천/취소 —');
  const firstSub = (await Store.listSubmissions({ participantId: whale.id }))[0];
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
  await Store.addNotifyEmail('Reader@Example.com');
  let mailDupErr = null;
  try { await Store.addNotifyEmail('reader@example.com'); } catch (e) { mailDupErr = e.message; }
  t('메일 소문자 정규화 + 중복 거부', !!mailDupErr, mailDupErr);
  let mailFormatErr = null;
  try { await Store.addNotifyEmail('not-an-email'); } catch (e) { mailFormatErr = e.message; }
  t('메일 형식 검증', !!mailFormatErr, mailFormatErr);
  let mails = await Store.listNotifyEmails();
  t('메일 목록 1건', mails.length === 1 && mails[0].email === 'reader@example.com', mails);
  await Store.removeNotifyEmail(mails[0].id);
  mails = await Store.listNotifyEmails();
  t('메일 삭제', mails.length === 0);

  // 아웃 처리 후 이후 날짜는 '·'
  await Store.updateParticipant(whale.id, { status: 'out', outDate: '2026-09-01' });
  st = U.buildStats(await Store.listParticipants(), await Store.listSubmissions(), T)
    .find(s => s.participant.id === whale.id);
  t('아웃 당일까지는 집계', st.cells.find(c => c.date === '2026-09-01').status === 'O');
  t('아웃 이후 날짜 제외', st.cells.find(c => c.date === '2026-09-02').status === '·'
    && st.cells.find(c => c.date === '2026-09-03').status === '·',
    st.cells.slice(9,12).map(c=>c.status));
  // 8/24~8/30 7일 미인증, 8/31·9/1 인증, 9/2 이후는 아웃이라 집계 제외
  t('아웃 이후는 미인증으로 안 쌓임', st.missed === 7, st.missed);


  // 백업 / 복원 / 삭제
  const dump = await Store.exportAll();
  t('백업에 참가자 포함', dump.participants.length === 3, dump.participants.length);
  await Store.clearAll();
  t('전체 삭제', (await Store.listParticipants()).length === 0);
  await Store.importAll(dump);
  t('복원', (await Store.listParticipants()).length === 3
    && (await Store.listSubmissions()).length === dump.submissions.length);

  await Store.removeParticipant(sony.id);
  t('참가자 삭제 시 제출도 삭제',
    (await Store.listSubmissions({ participantId: sony.id })).length === 0);

  console.log(`\n결과: ${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
