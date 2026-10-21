/* 🎁 정리본 메일 문안 = 상수(tools/templates/정리본메일*.txt) + 변수(이 책 · 다음 책).
 *
 * 메일은 시즌이 끝난 뒤 다음 시즌 시작일에 나가므로 끝에 "다음 책" 소개가 붙는다.
 * 다음 책이 정해지면(다음 시즌을 new-season으로 만들 때) 앞 시즌 메일을 다시 만들어 끼운다.
 *   - 이 책 이름 → 제목·본문 『』, 조사(을/를)
 *   - 다음 책 → 다음월 · 다음책 이름 · 다음 시즌 설명서의 book.mailPitch(2~3줄)
 * {{이름}}·{{정리본링크}}는 발송 때 사람마다 채워지도록 그대로 남긴다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { josaEulReul } from './season-vars.mjs';

const TPL = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

// 다음 책을 아직 모를 때 — 책 이름 없이도 자연스럽게 이어지는 마무리
const NO_NEXT = '다음 달에도 여러분의 브랜딩과 콘텐츠에 바로 적용하실 수 있도록,\n저의 실제 경험과 노하우를 아낌없이 나눠 드리겠습니다.';

/** @param book 이 시즌 책 이름  @param next { month:'11월', name, pitch } | null */
export function giftMailText(book, next) {
  const read = (f) => readFileSync(join(TPL, f), 'utf8').replace(/\n+$/, '');
  const nextBlock = next && next.name
    ? read('정리본메일_다음책.txt')
      .replace('{{다음월}}', next.month).replace('{{다음책}}', next.name)
      .replace('{{다음책소개}}\n', next.pitch ? `${String(next.pitch).replace(/\n+$/, '')}\n` : '')
    : NO_NEXT;
  const [subject, ...body] = read('정리본메일.txt')
    .replaceAll('{{책이름}}', book).replaceAll('{{을를}}', josaEulReul(book))
    .replace('{{다음책안내}}', nextBlock)
    .split('\n');
  return { subject, body: body.map((l) => l.replace(/\s+$/, '')) };
}

const q = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** config.js에 넣을 giftMail 블록(앞 두 칸 들여쓰기) */
export function giftMailBlock({ sendAt, link = '', subject, body }) {
  return [
    '  // 🎁 정리본 메일 자동 발송 — link를 채워 배포하면 sendAt(KST)에 이 시즌 대상자(+운영진이 추가한 사람) 전원에게 한 번 보낸다.',
    '  // 다음 시즌이 켜진 뒤여도 이 시즌 명단으로 계산한다. link가 비어 있으면 아무것도 안 보낸다.',
    '  // 문안은 tools/templates/정리본메일*.txt(상수) + 이 책·다음 책(변수) — 다음 시즌을 만들면 다음 책 소개로 다시 채워진다.',
    '  giftMail: {',
    `    sendAt: ${q(sendAt)},`,
    `    link: ${q(link)},`,
    `    subject: ${q(subject)},`,
    '    body: [',
    ...body.map((l) => `      ${q(l)},`),
    "    ].join('\\n'),",
    '  },'
  ].join('\n');
}

/** config 소스에서 마지막(또는 before 위치 앞의 마지막) giftMail 블록을 새 문안으로 바꾼다. sendAt·link는 유지. */
export function replaceLastGiftMail(src, book, next) {
  const start = src.lastIndexOf('\n  giftMail: {');
  if (start < 0) return { src, replaced: false };
  const end = src.indexOf('\n  },', start + 1);
  const old = src.slice(start, end + '\n  },'.length);
  const sendAt = (old.match(/sendAt: '([^']*)'/) || [])[1] || '';
  const link = (old.match(/link: '([^']*)'/) || [])[1] || '';
  // 블록 바로 앞의 정리본 메일 주석 줄도 새 주석으로 바꾼다
  let from = start;
  for (;;) {
    const prev = src.lastIndexOf('\n', from - 1);
    const line = src.slice(prev + 1, from);
    if (!/^\s*\/\/.*(정리본|다음 시즌|다음 책|문안|link가)/.test(line)) break;
    from = prev;
  }
  const { subject, body } = giftMailText(book, next);
  return { src: src.slice(0, from) + '\n' + giftMailBlock({ sendAt, link, subject, body }) + src.slice(end + '\n  },'.length), replaced: true };
}
