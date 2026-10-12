# STATUS — 『혁명의 팡파르』 원문 수집

시도 시각: 2026-10-12T18:48:42Z (UTC)

## 결과: 실패 — 모든 출처 접근 차단 (네트워크 정책)

이 세션은 외부 사이트에 나갈 수 없다. curl은 프록시가 CONNECT를 거부(HTTP 403)했고, WebFetch는 DNS 조회에 실패(`getaddrinfo ENOTFOUND`)했다.
그래서 책 소개·목차·표지는 **한 글자도 가져오지 못했다.** 추측으로 채운 내용은 없다.
`raw-2025.md`, `raw-2021.md`, `cover.jpg`는 만들지 않았다.

## 시도한 URL과 오류

| 출처 | URL | 방법 | 결과 |
|---|---|---|---|
| 교보 2025 개정판 (1순위) | https://product.kyobobook.co.kr/detail/S000217919053 | curl (브라우저 UA) | 실패 — `CONNECT tunnel failed, response 403` (HTTP 000) |
| 교보 2025 개정판 (1순위) | 같은 URL | WebFetch | 실패 — `getaddrinfo ENOTFOUND product.kyobobook.co.kr` |
| 교보 2021 초판 (비교용) | https://product.kyobobook.co.kr/detail/S000001823507 | curl | 실패 — `CONNECT tunnel failed, response 403` |
| 교보 2021 초판 (비교용) | 같은 URL | WebFetch | 실패 — `getaddrinfo ENOTFOUND product.kyobobook.co.kr` |
| 교보 검색 | https://search.kyobobook.co.kr/search?keyword=혁명의 팡파르 | curl | 실패 — CONNECT 403 |
| 교보 이미지 CDN (표지) | https://contents.kyobobook.co.kr/ | curl | 실패 — CONNECT 403 |
| 알라딘 | https://www.aladin.co.kr/search/wsearchresult.aspx?SearchWord=혁명의 팡파르 | curl / WebFetch | 실패 — CONNECT 403 / ENOTFOUND |
| 예스24 | https://www.yes24.com/Product/Search?query=혁명의 팡파르 | curl / WebFetch | 실패 — CONNECT 403 / ENOTFOUND |
| 인터파크 도서 | https://book.interpark.com/ | curl | 실패 — CONNECT 403 |
| 국립중앙도서관 | https://www.nl.go.kr/ | curl | 실패 — CONNECT 403 |
| (대조용) Google | https://www.google.com/ | curl | 실패 — CONNECT 403 → 특정 사이트가 아니라 외부망 전체가 막힘 |

## 목차 출처

없음 — 어느 출처에서도 목차를 얻지 못함.

## 해결 방법

클라우드 환경 설정 → Network access에서 접근 수준을 넓히거나, Allowed domains에
`product.kyobobook.co.kr`, `contents.kyobobook.co.kr`(필요하면 `www.aladin.co.kr`, `www.yes24.com`)를 추가한 뒤 다시 돌리면 된다.
안내: https://code.claude.com/docs/en/cloud-environments#network-access
