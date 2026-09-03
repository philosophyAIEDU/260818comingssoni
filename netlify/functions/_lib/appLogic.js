/* js/config.js·js/utils.js를 Node(Netlify Functions)에서 그대로 재사용하기 위한 로더.
 *
 * 두 파일은 브라우저용이라 최상단에 window.CS = window.CS || {} 로 시작하고, 그 뒤로는
 * (window가 아니라) 전역 식별자 CS로 프로퍼티를 채운다. 브라우저에서는 window가 곧 전역
 * 객체라 이게 자연스럽게 동작하는데, Node에서는 window가 없어 그대로 require하면 즉시
 * ReferenceError가 난다. 그래서 require하기 전에 global.window = global 로 살짝 흉내를
 * 낸다 — global.CS에 쓴 값이 이후 두 파일의 "맨 CS" 참조에서도 그대로 보이게 된다
 * (test/logic.test.js가 vm으로 하는 것과 원리는 같고, 여기서는 require만으로 더 간단하게
 * 해결한다). 이렇게 하면 "미인증 몇 회인지" 계산 로직이 앱 화면과 서버 함수에서
 * 완전히 같은 코드로 돌아가서, 둘이 서로 다른 답을 낼 걱정이 없다.
 *
 * 상대경로 require들은 정적으로 분석 가능해서 Netlify의 esbuild 번들러가 자동으로 함께
 * 묶어 배포한다(별도 included_files 설정 불필요).
 */
if (!global.window) global.window = global;

require('../../../js/config.js');
require('../../../js/utils.js');
require('../../../js/mailTemplates.js');

const { CONFIG, U, MailTemplates } = global.CS;

module.exports = { CONFIG, U, MailTemplates };
