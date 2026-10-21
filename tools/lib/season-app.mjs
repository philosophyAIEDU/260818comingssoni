/* 앱(js/config.js)에 들어가는 시즌 객체를 시즌 설명서(seasons/<id>.json)로 만든다.
 *
 * 앱 화면의 상수(규칙 문구·자리 이름·마감·킥아웃 없음·정리본 메일 틀)는 여기 한 곳에 있고,
 * 책마다 바뀌는 값만 시즌 설명서에서 온다. new-season.mjs(새 시즌을 config에 넣을 때)와
 * season-check.mjs(지금 config의 시즌이 이 틀과 같은지 대조할 때)가 함께 쓴다.
 * 그래서 config.js에서 시즌 문구를 손으로 고치면 check:season이 빨간불을 켠다 —
 * 고친 문구는 이 파일(공통)이나 시즌 설명서(책마다)에 옮겨야 다음 달에도 살아남는다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seasonVars, josaEulReul, addDays, md } from './season-vars.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** config.js의 CS.SEASONS 끝에 덧붙일 소스(", {"로 시작해 "}];"로 끝난다). */
export function seasonObjectSrc(spec, S = seasonVars(spec)) {
  const { startDate, endDate, days, switchAt, retroUntil, nextStart, monthLabel, liveTime, plan, liveDates, liveWd } = S;
  const need = (k) => { if (spec[k] == null) throw new Error(`시즌 설명서에 "${k}"가 없습니다.`); return spec[k]; };
  // 정리본 메일 문구는 상수(tools/templates/정리본메일.txt — 첫 줄이 제목). {{이름}}·{{정리본링크}}는 발송 때 사람마다 채운다.
  const [giftSubject, ...giftBody] = readFileSync(join(root, 'tools/templates/정리본메일.txt'), 'utf8')
    .replace(/\n+$/, '').replaceAll('{{책이름}}', spec.book.name).replaceAll('{{을를}}', josaEulReul(spec.book.name))
    .replace('{{다음책안내}}', spec.nextBookNote || '다음 책은 4주차 마지막 라이브에서 공개합니다.')
    .split('\n');
  // 줄바꿈은 \n 이스케이프로 남긴다 — 책 소개(desc)의 줄바꿈은 넓은 화면에서만 줄을 바꾸는 자리다
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  const q = (v) => (v == null ? 'null' : `'${esc(v)}'`);
  const planSrc = plan.map((day) => {
    const groups = day.map((g) =>
      `{ ch: '${esc(g.ch || '')}', s: [${(g.s || []).map((x) => `'${esc(x)}'`).join(', ')}] }`);
    return `    [${groups.join(',\n      ')}],`;
  }).join('\n');
  const promptsSrc = (spec.weeklyPrompts || []).map((w) =>
    `    { day: ${w.day}, questions: [\n${(w.questions || []).map((x) => `      '${esc(x)}'`).join(',\n')}\n    ] }`).join(',\n');

  return `, {
  id: ${q(need('id'))},
  label: ${q(need('label'))},
  // 끝난 뒤에도 참여자가 책 표지 옆 화살표로 넘겨 볼 수 있는 시즌(읽기 전용 · 기록 내려받기 닫힘)
  browsable: true,
  startsAt: ${q(switchAt)},   // 이 시각(KST)이 지나면 저절로 이 시즌이 켜진다
  title: '퍼스널메이커스 독서 멤버십',
  subtitle: '${esc(spec.book.name)} 인증 시스템',
  periodLabel: '멤버십 기간',
  book: {
    name: ${q(spec.book.name)},
    tagline: ${q(spec.book.tagline || '')},
    byline: ${q(spec.book.byline)},
    cover: ${q(spec.book.cover)},
    // \\n = 넓은 화면에서만 줄을 바꾸는 자리(휴대폰에서는 띄어쓰기로 이어진다)
    desc: ${q(String(spec.book.desc || '').replace(/<[^>]+>/g, ''))}
  },
  live: {
    label: '매주 ${liveWd}요일 ${esc(liveTime)} (${liveDates.map(md).join(' · ')})',
    note: '* 다시보기는 제공되지 않으니 꼭 시간내어 참여해주세요.'
  },
  rulesHeading: '안내 · 멤버십 규칙',
  headLinks: [
    { label: '독서 멤버십 OT 보기', icon: 'play', url: ${q(spec.otUrl)} },
    { label: '${esc(monthLabel)} 퍼메스 독서 멤버십 설명서', icon: 'book', url: ${q(spec.guideUrl)} }
  ],
  extraRules: [
    '<strong>${liveWd}요일은 새로 읽을 분량이 없습니다.</strong> 그날 오전 단톡방에 올라오는 <strong>발제문</strong>을 '
      + '보고 생각을 정리해 <strong>[읽고 느낀 점]</strong>에 남기면 그날 인증이 완료됩니다. '
      + '밀린 분량이 있다면 이날 따라잡아 주세요.',
    '인증을 놓쳐도 <strong>킥아웃되지 않습니다</strong>. 다만 ${days}일 동안 <strong>누락이 ${spec.giftMissLimit || 6}회 미만(${(spec.giftMissLimit || 6) - 1}회 이하)</strong>이면 '
      + '커밍쏜이 직접 정리한 『${esc(spec.book.name)}』 <strong>인사이트 정리본</strong>을 드립니다.',
    ${q(spec.bookEditionRule || '')} ,
    '지난달에 이어 함께하시는 분은 이름 옆에 <strong>🔥2 🔥3 …</strong> 연속 시즌 표시가 붙습니다. 한 달 더 할 때마다 올라갑니다.',
    '${days}일간 기록한 내용은 <strong>한 번에 내려받을 수</strong> 있습니다. 화면 맨 아래 <strong>[나의 진행 현황]</strong>에서 '
      + '지금까지 몇 번 인증했고 몇 번 놓쳤는지도 확인할 수 있습니다.'
  ].filter(Boolean),
  sentencePlaceholder: '예) 오늘 범위에서 가장 와닿은 한 문장을 그대로 옮겨 적고, '
    + '끝에 쪽수를 붙여 주세요. (… - 47쪽)',
  reflectionPlaceholder: '짧아도 좋습니다. 오늘 읽은 내용을 내 브랜드·일에 어떻게 적용할지 적어주세요.',
  startDate: ${q(startDate)},
  endDate: ${q(endDate)},
  // 1일차는 단톡방 입장 당일이라 누락으로 세지 않는다.
  gradeFrom: ${q(addDays(startDate, 1))},
  // 종료 다음 날부터 이 날까지는 회고 세션 — 앱이 안내를 띄운다(인증은 닫힌 채로).
  retroUntil: ${q(retroUntil)},
  dataPrefix: ${q(spec.id)},
  storagePrefix: ${q('comingsoon.reading.' + spec.id)},
  lockAt: null,
  kickoutEnabled: false,
  kickoutThreshold: Infinity,
  riskThreshold: Infinity,
  autoWarnThreshold: Infinity,
  // 🎁 정리본 선물 기준 — 누락이 이 횟수 미만이면 대상. 운영진 [알림 메일 › 선물 대상자]가 쓴다.
  giftMissLimit: ${spec.giftMissLimit || 6},
  // 🎁 정리본 메일 자동 발송 — link를 채워 배포하면 sendAt(KST)에 이 시즌 대상자 전원에게 한 번 보낸다.
  // 다음 시즌이 켜진 뒤여도 이 시즌 명단으로 계산한다. link가 비어 있으면 아무것도 안 보낸다.
  // 다음 책이 정해지면(4주차 라이브) 아래 "다음 책은 …" 줄을 다음 책 소개로 바꾼다 — 시즌 설명서 nextBookNote에도 같이.
  giftMail: {
    sendAt: ${q(nextStart + 'T09:00')},
    link: '',
    subject: ${q(giftSubject)},
    body: [
${giftBody.map((l) => `      ${q(l)},`).join('\n')}
    ].join('\\n'),
  },
  // 📝 주간 발제문 — 라이브 날 앱 [오늘의 범위]와 운영진 [공지문 › 발제문]에 쓰인다.
  weeklyPrompts: [
${promptsSrc}
  ],
  readingPlan: [
${planSrc}
  ]
}];`;
}
