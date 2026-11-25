/* 🎁 정리본 메일 변수 검사(js/giftCheck.js) — 실제 시즌 설정(js/config.js)의 giftMail 문안으로 시험한다. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const sandbox = { window: {}, console, Intl, Date, Math, JSON, Promise, setTimeout, process: { env: {} } };
sandbox.window = sandbox;
vm.createContext(sandbox);
const root = path.join(__dirname, '..');
for (const f of ['js/config.js', 'js/utils.js', 'js/mailTemplates.js', 'js/giftCheck.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { CS } = sandbox;
const G = CS.GiftCheck;

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const LINK = 'https://www.notion.so/abc-3c2f15a6c51c80108cb1c88b5212be7d';
const s2 = CS.configFor('s2'), s3 = CS.configFor('s3'), s4 = CS.configFor('s4');
const ok = (cfg, over) => G.check(Object.assign({ cfg, link: LINK, subject: cfg.giftMail.subject, body: cfg.giftMail.body }, over || {}));

console.log('— 지금 설정 문안은 통과한다 —');
let r = ok(s3);
t('혁명의 팡파르(s3) 문안 통과', r.ok, r.problems);
t('s3 변수: 를 · 11월 · 지적자본론 · 소개 있음', r.vars.을를 === '를' && r.vars.다음월 === '11월' && r.vars.다음책 === '지적자본론' && !!r.vars.다음책소개, r.vars);
r = ok(s2);
t('꿈과 돈(s2) 문안 통과', r.ok, r.problems);
t('s2 변수: 을 · 10월 · 혁명의 팡파르', r.vars.을를 === '을' && r.vars.다음월 === '10월' && r.vars.다음책 === '혁명의 팡파르', r.vars);
r = ok(s4);
t('지적자본론(s4, 다음 시즌 없음) 문안 통과', r.ok, r.problems);

console.log('— 틀리면 막는다 —');
r = ok(s3, { link: '' });
t('링크 비면 막음', !r.ok && /비어/.test(r.problems.join()));
r = ok(s3, { link: 'https://bit.ly/abc' });
t('노션이 아닌 링크 막음', !r.ok && /노션/.test(r.problems.join()));
t('notion.site 주소는 통과', ok(s3, { link: 'https://capable-hook-3dd.notion.site/abc-123' }).ok);
t('app.notion.com 주소도 통과', ok(s3, { link: 'https://app.notion.com/p/423f15a6c51c819f9a50f3c86b2e7599' }).ok);
r = ok(s3, { body: s3.giftMail.body + '\n{{다음책}}' });
t('남은 {{다음책}} 막음', !r.ok && /\{\{다음책\}\}/.test(r.problems.join()));
t('{{이름}}·{{정리본링크}}는 남아도 됨', s3.giftMail.body.includes('{{이름}}') && ok(s3).ok);
r = ok(s3, { body: s3.giftMail.body.replace('『혁명의 팡파르』를 함께', '『혁명의 팡파르』을 함께') });
t('을/를 틀리면 막음', !r.ok && /조사/.test(r.problems.join()), r.problems);
r = ok(s3, { subject: s3.giftMail.subject.replace('혁명의 팡파르', '꿈과 돈') });
t('제목 책 이름 틀리면 막음', !r.ok && /제목/.test(r.problems.join()), r.problems);
r = ok(s3, { body: s3.giftMail.body.replace('11월 새롭게', '12월 새롭게') });
t('다음 달 틀리면 막음', !r.ok && /다음 달/.test(r.problems.join()), r.problems);
r = ok(s3, { body: s3.giftMail.body.replace('『지적자본론』입니다', '『프로세스 이코노미』입니다') });
t('다음 책 틀리면 막음', !r.ok && /다음 책/.test(r.problems.join()), r.problems);
const lines = s3.giftMail.body.split('\n');
const at = lines.findIndex((l) => /새롭게 함께 읽을 책은/.test(l));
const end = lines.findIndex((l, i) => i > at && /^여러분의 브랜딩과 콘텐츠에/.test(l));
r = ok(s3, { body: lines.slice(0, at + 1).concat(lines.slice(end)).join('\n') });
t('다음 책 소개 줄 비면 막음', !r.ok && /소개/.test(r.problems.join()), r.problems);
r = ok(s3, { body: lines.filter((l, i) => i !== at).join('\n') });
t('다음 책 안내 줄 없으면 막음', !r.ok && /안내 줄/.test(r.problems.join()), r.problems);
r = G.check({ cfg: s4, next: null, link: LINK, subject: s4.giftMail.subject, body: s3.giftMail.body.split('혁명의 팡파르').join('지적자본론') });
t('다음 시즌 없는데 다음 책 줄 있으면 막음', !r.ok && /다음 시즌이 아직/.test(r.problems.join()), r.problems);

console.log('— 미리보기 —');
const pv = G.preview({ cfg: s3, link: LINK, subject: s3.giftMail.subject, body: s3.giftMail.body }, { name: '가나다', missed: 2 });
t('이름·링크가 채워진다', pv.body.includes('가나다님') && pv.body.includes(LINK) && !/\{\{/.test(pv.body + pv.subject));

console.log(`\n${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
