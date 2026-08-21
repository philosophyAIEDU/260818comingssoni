/* 인증 피드 전체 보기 (feed-all.html 전용) — 지금까지 제출된 모든 인증글을 최신순으로 보여준다.
 * index.html의 "전체 보기" 링크가 새 창으로 이 페이지를 연다. */
(function () {
  const { U, Store } = CS;
  const $ = (id) => document.getElementById(id);

  const FEED_PAGE_SIZE = 30;
  const CLIENT_KEY = `${CS.CONFIG.storagePrefix}.clientId`;
  let visibleCount = FEED_PAGE_SIZE;

  // 중복 추천 방지를 위해 로컬 고유 식별자 생성 (index.html과 동일한 키를 써서 기기별로 통일)
  let clientId = localStorage.getItem(CLIENT_KEY);
  if (!clientId) {
    clientId = U.uid('cli');
    localStorage.setItem(CLIENT_KEY, clientId);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function renderItem(s) {
    const late = U.isLate(s.date, s.createdAt);
    const hasUpvoted = (s.upvotedBy || []).includes(clientId);
    const btnClass = ['upvote-btn', hasUpvoted ? 'voted' : ''].filter(Boolean).join(' ');
    return `<article class="feed-item">
      <div class="feed-top">
        <span class="feed-nick">${esc(s.nickname)}</span>
        ${late ? '<span class="tag bad">지각</span>' : ''}
        <span class="feed-time">${esc(U.shortLabel(s.date))} · ${esc(U.stampLabel(s.updatedAt || s.createdAt))}</span>
        <button type="button" class="share-btn" data-share
          data-nickname="${esc(s.nickname)}" data-date="${esc(s.date)}"
          data-sentence="${esc(s.sentence)}" data-reflection="${esc(s.reflection)}"
          aria-label="텍스트 복사" title="텍스트 복사">📋 텍스트 복사</button>
        <button type="button" class="${btnClass}" data-id="${esc(s.id)}"
          aria-label="엄지척 ${s.upvotes || 0}개, ${hasUpvoted ? '눌러서 취소' : '눌러서 추천'}">👍 ${s.upvotes || 0}</button>
      </div>
      <p class="feed-quote">“${esc(s.sentence)}”</p>
      <details class="feed-more">
        <summary>느낀 점 보기</summary>
        <dl class="body">
          <dt>느낀 점</dt><dd>${esc(s.reflection)}</dd>
        </dl>
      </details>
    </article>`;
  }

  function bindUpvoteButtons(container) {
    container.querySelectorAll('.upvote-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          if (btn.classList.contains('voted')) {
            await Store.unvoteSubmission(btn.dataset.id, clientId);
          } else {
            await Store.upvoteSubmission(btn.dataset.id, clientId);
          }
          await refreshAllFeed();
        } catch (err) {
          btn.disabled = false;
          alert(err.message);
        }
      });
    });
  }

  async function refreshAllFeed() {
    const all = (await Store.listSubmissions()).slice()
      .sort((a, b) => (b.date === a.date
        ? String(b.createdAt).localeCompare(String(a.createdAt))
        : b.date.localeCompare(a.date)));

    $('feedCount').textContent = `${all.length}건`;

    const list = $('allFeedList');
    const moreWrap = $('allFeedLoadMoreWrap');
    if (!all.length) {
      list.innerHTML = '<div class="empty">제출된 인증글이 없습니다.</div>';
      moreWrap.hidden = true;
      return;
    }

    const visible = all.slice(0, visibleCount);
    list.innerHTML = visible.map(renderItem).join('');
    bindUpvoteButtons(list);
    CS.ShareCard.bindButtons(list, { title: CS.CONFIG.title });

    const remaining = all.length - visible.length;
    if (remaining > 0) {
      moreWrap.hidden = false;
      $('allFeedLoadMoreBtn').textContent = `더 보기 (${remaining}건 더 남음)`;
    } else {
      moreWrap.hidden = true;
    }
  }

  async function boot() {
    await Store.init();
    await refreshAllFeed();

    $('allFeedLoadMoreBtn').addEventListener('click', () => {
      visibleCount += FEED_PAGE_SIZE;
      refreshAllFeed();
    });
    $('feedRefresh').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try { await refreshAllFeed(); } finally { btn.disabled = false; }
    });

    // 실시간 동기화(로컬 저장 백엔드일 때 다른 탭에서 바뀐 내용 반영)
    window.addEventListener('storage', (e) => {
      if (e.key && e.key.startsWith(CS.CONFIG.storagePrefix)) refreshAllFeed().catch(console.error);
    });
  }

  boot().catch((err) => {
    console.error(err);
    $('allFeedList').innerHTML = `<div class="empty">불러오기 실패: ${esc(err.message)}</div>`;
  });
})();
