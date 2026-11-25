/* 🎁 정리본 메일 변수 검사 — 운영진 화면 [🎁 정리본 오픈] 버튼과 서버 발송 함수(send-gift-mail, strict)가 같이 쓴다.
 *
 * 메일 문안은 tools/templates/정리본메일*.txt 고정 틀 + 책마다 바뀌는 변수 몇 개다(2026-11-25 커밍쏜 결정).
 * 보내기 전에 그 변수가 이 시즌·다음 시즌 설정과 맞는지 본다. 하나라도 틀리면 버튼을 막고 이유를 보여 준다.
 *   ① 정리본 링크 — 노션 주소(https://…notion.so/… 또는 …notion.site/…)
 *   ② 남은 {{…}} — 보낼 때 사람마다 채우는 칸({{이름}} 등) 말고는 남아 있으면 안 된다
 *   ③ 책 이름 — 제목·본문의 『』가 이 시즌 책
 *   ④ 을/를 — 『책』 뒤 조사가 받침에 맞는지
 *   ⑤ 다음 달·다음 책 — 다음 시즌이 있으면 "N월 새롭게 함께 읽을 책은 『다음 책』입니다." + 그 아래 소개 줄,
 *      없으면 다음 책 문장이 없어야 한다
 * 브라우저에서는 <script>, Node 에서는 appLogic.js 가 require 한다(config.js 와 같은 방식).
 */
window.CS = window.CS || {};

CS.GiftCheck = (function () {
  // 보낼 때 사람마다 채워지는 칸(_lib/giftMail.js 의 vars) — 문안에 남아 있어도 된다
  const RUNTIME_VARS = ['이름', '정리본링크', '누락횟수', '책이름', '일수', '라이브횟수', '앱주소'];
  const NOTION_URL = /^https:\/\/([\w-]+\.)?notion\.(so|site)\/\S+$/;

  function josaEulReul(word) {
    const c = String(word || '').trim().slice(-1).charCodeAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 ? '을' : '를';
    return '';
  }

  /** 시즌 설정 cfg 다음 시즌(없으면 null) */
  function nextSeasonOf(cfg) {
    const list = (CS.SEASONS || []);
    const at = list.findIndex((s) => s.id === (cfg.seasonId || cfg.id));
    return at >= 0 && at + 1 < list.length ? list[at + 1] : null;
  }

  /**
   * @param o { cfg, next?, link, subject, body }  next를 주지 않으면 CS.SEASONS 에서 찾는다
   * @returns { ok, problems:[문장], vars:{ 책이름, 을를, 다음월, 다음책, 다음책소개 } }
   */
  function check(o) {
    const cfg = o.cfg || {};
    const next = o.next !== undefined ? o.next : nextSeasonOf(cfg);
    const link = String(o.link || '').trim();
    const subject = String(o.subject || '');
    const body = String(o.body || '');
    const book = (cfg.book && cfg.book.name) || '';
    const problems = [];

    if (!link) problems.push('정리본 링크가 비어 있습니다.');
    else if (!NOTION_URL.test(link)) problems.push(`정리본 링크가 노션 주소가 아닙니다: ${link}`);

    const left = ((subject + '\n' + body).match(/\{\{[^}]*\}\}/g) || [])
      .filter((m) => !RUNTIME_VARS.includes(m.slice(2, -2).trim()));
    if (left.length) problems.push(`채워지지 않은 칸이 남아 있습니다: ${Array.from(new Set(left)).join(', ')}`);

    if (!book) problems.push('이 시즌 책 이름(book.name)이 설정에 없습니다.');
    else {
      if (!subject.includes(`『${book}』`)) problems.push(`제목에 이 시즌 책 『${book}』이 없습니다.`);
      if (!body.includes(`『${book}』`)) problems.push(`본문에 이 시즌 책 『${book}』이 없습니다.`);
      const allowed = new Set([book].concat(next && next.book ? [next.book.name] : []));
      const others = Array.from(new Set((subject + '\n' + body).match(/『[^』]+』/g) || []))
        .map((m) => m.slice(1, -1)).filter((n) => !allowed.has(n));
      if (others.length) problems.push(`다른 책 이름이 들어 있습니다: ${others.map((n) => `『${n}』`).join(', ')}`);
      const josa = josaEulReul(book);
      if (josa) {
        const wrong = josa === '을' ? '를' : '을';
        if (body.includes(`『${book}』${wrong} `)) problems.push(`조사가 틀렸습니다: 『${book}』${wrong} → 『${book}』${josa}`);
      }
    }

    const NEXT_LINE = /(\d{1,2}월) 새롭게 함께 읽을 책은 『([^』]+)』입니다\./;
    const lines = body.split('\n');
    const at = lines.findIndex((l) => NEXT_LINE.test(l));
    let vars = { 책이름: book, 을를: josaEulReul(book), 다음월: '', 다음책: '', 다음책소개: '' };
    if (next && next.book) {
      const month = `${Number(String(next.startDate || '').slice(5, 7))}월`;
      if (at < 0) problems.push(`다음 책 안내 줄이 없습니다 — "${month} 새롭게 함께 읽을 책은 『${next.book.name}』입니다."가 있어야 합니다.`);
      else {
        const m = lines[at].match(NEXT_LINE);
        vars.다음월 = m[1]; vars.다음책 = m[2];
        if (m[1] !== month) problems.push(`다음 달이 틀렸습니다: ${m[1]} → ${month} (다음 시즌 시작 ${next.startDate})`);
        if (m[2] !== next.book.name) problems.push(`다음 책이 틀렸습니다: 『${m[2]}』 → 『${next.book.name}』`);
        // 소개 = 안내 줄 아래부터 고정 문장("여러분의 브랜딩과 콘텐츠에…") 앞까지
        const end = lines.findIndex((l, i) => i > at && /^여러분의 브랜딩과 콘텐츠에/.test(l));
        const pitch = lines.slice(at + 1, end < 0 ? at + 1 : end).filter((l) => l.trim());
        vars.다음책소개 = pitch.join('\n');
        if (!pitch.length) problems.push(`다음 책 『${next.book.name}』 소개 줄(2~3줄)이 비어 있습니다.`);
        else if (pitch.length > 4) problems.push(`다음 책 소개가 ${pitch.length}줄입니다 — 2~3줄로 줄여 주세요.`);
      }
    } else if (at >= 0) {
      problems.push('다음 시즌이 아직 설정에 없는데 본문에 다음 책 안내 줄이 있습니다.');
    }
    return { ok: !problems.length, problems, vars };
  }

  /** 한 사람 예시 미리보기(제목·본문) */
  function preview(o, person) {
    const cfg = o.cfg || {};
    const v = Object.assign({
      이름: person && person.name ? person.name : '○○', 누락횟수: person && person.missed != null ? person.missed : '',
      책이름: (cfg.book && cfg.book.name) || '', 일수: o.days || '', 라이브횟수: o.liveCount || '',
      정리본링크: o.link || '', 앱주소: cfg.appUrl || ''
    });
    return { subject: CS.MailTemplates.fill(String(o.subject || ''), v), body: CS.MailTemplates.fill(String(o.body || ''), v) };
  }

  return { check, preview, josaEulReul, nextSeasonOf, NOTION_URL, RUNTIME_VARS };
})();
