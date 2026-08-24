/* 인증 피드 전체 보기 (feed-all.html 전용) — 지금까지 제출된 모든 인증글을 날짜별로 묶어 보여준다.
 * index.html의 "전체 보기" 링크가 새 창으로 이 페이지를 연다. */
(function () {
  const { U, Store } = CS;
  const $ = (id) => document.getElementById(id);

  const FEED_PAGE_SIZE = 30;
  const CLIENT_KEY = `${CS.CONFIG.storagePrefix}.clientId`;
  let visibleCount = FEED_PAGE_SIZE;
  let feedSort = 'recent'; // 'recent' 최신순 | 'likes' 추천(👍) 많은순
  let feedPerson = ''; // 선택한 참가자 id. 빈 값이면 전체.
  let feedDate = '';   // 선택한 날짜(YYYY-MM-DD). 빈 값이면 전체 날짜.
  let participants = [];

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
    // index.html의 피드와 동일한 구조: 왼쪽 글 / 오른쪽 버튼
    return `<article class="feed-item">
      <div class="feed-main">
        <div class="feed-top">
          <span class="feed-nick">${esc(s.nickname)}</span>
          ${late ? '<span class="tag bad">지각</span>' : ''}
          <span class="feed-time">${esc(U.shortLabel(s.date))} · ${esc(U.stampLabel(s.updatedAt || s.createdAt))}</span>
        </div>
        <div class="feed-body">
          <div class="feed-label">인상 깊은 내용</div>
          <p class="feed-quote">“${esc(s.sentence)}”</p>
          <details class="feed-more">
            <summary>느낀 점 보기</summary>
            <div class="body reflect"><p>${esc(s.reflection)}</p></div>
          </details>
        </div>
      </div>
      <div class="feed-acts">
        <button type="button" class="share-btn" data-share
          data-nickname="${esc(s.nickname)}" data-date="${esc(s.date)}"
          data-sentence="${esc(s.sentence)}" data-reflection="${esc(s.reflection)}"
          aria-label="텍스트 복사" title="텍스트 복사">${U.icon('copy')}<span class="lbl">텍스트 복사</span></button>
        <button type="button" class="${btnClass}" data-id="${esc(s.id)}"
          aria-label="엄지척 ${s.upvotes || 0}개, ${hasUpvoted ? '눌러서 취소' : '눌러서 추천'}">${U.icon('thumb')}${s.upvotes || 0}</button>
      </div>
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

  /** mode: 'recent'(최신순, 기본) | 'likes'(추천 많은순) */
  function sortByMode(list, mode) {
    if (mode === 'likes') {
      return list.slice().sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0)
        || String(b.createdAt).localeCompare(String(a.createdAt)));
    }
    return list.slice().sort((a, b) => (b.date === a.date
      ? String(b.createdAt).localeCompare(String(a.createdAt))
      : b.date.localeCompare(a.date)));
  }

  /** 정렬된 목록을 날짜별로 묶는다. 그룹 자체는 항상 최신 날짜가 먼저 오고,
   *  그룹 안의 순서는 넘겨받은 정렬(최신순/추천순)을 그대로 유지한다. */
  function groupByDate(list) {
    const groups = new Map();
    for (const s of list) {
      if (!groups.has(s.date)) groups.set(s.date, []);
      groups.get(s.date).push(s);
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }

  function download(filename, text) {
    const blob = new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /** 선택한 참가자의 인증 기록 전체(현재 화면의 정렬·더 보기 범위와 무관하게)를
   *  1일차부터 마지막 날까지 날짜순으로 모아 텍스트 파일로 내려받는다. 28일차까지
   *  인증을 끝내고 나면 한 번에 전체 기록을 받아 보고 싶다는 요청에 따른 기능 —
   *  진행 중에 받아도 그때까지의 기록이 똑같이 모두 담긴다. */
  async function downloadPersonTxt() {
    if (!feedPerson) return;
    const btn = $('allFeedDownloadBtn');
    const person = participants.find((p) => p.id === feedPerson);
    const name = (person && person.nickname) || '참여자';
    const total = U.challengeDates().length;
    btn.disabled = true;
    try {
      const mine = (await Store.listSubmissions({ participantId: feedPerson }))
        .slice().sort((a, b) => a.date.localeCompare(b.date));
      if (!mine.length) {
        alert('다운로드할 인증 기록이 없습니다.');
        return;
      }
      const lines = [
        `📖 ${CS.CONFIG.title || '독서 챌린지'} · ${name}님의 인증 기록 (${mine.length}/${total}일)`,
        `내려받은 시각 : ${U.stampLabel(U.nowStamp())}`
      ];
      if (mine.length >= total) lines.push('🎉 1일차부터 마지막 날까지 전체 완주하셨습니다!');
      lines.push('');
      mine.forEach((s) => {
        const day = U.dayIndex(s.date);
        lines.push('─'.repeat(30));
        lines.push(`${day ? `${day}일차 · ` : ''}${U.longLabel(s.date)}${U.isLate(s.date, s.createdAt) ? ' · 지각' : ''}`
          + ` (제출 ${U.stampLabel(s.updatedAt || s.createdAt)})`);
        lines.push('');
        lines.push(`인상 깊었던 내용 : ${s.sentence}`);
        lines.push('');
        lines.push(`책을 읽고 느낀 점 : ${s.reflection}`);
        lines.push('');
      });
      download(`${name}_인증기록_${U.today()}.txt`, lines.join('\n'));
    } finally {
      btn.disabled = !feedPerson;
    }
  }

  /** 인증글이 하루라도 올라온 날짜만 최신순으로 드롭다운에 채운다. */
  async function populateDateOptions() {
    const sel = $('allFeedDate');
    const keep = sel.value;
    const counts = new Map();
    for (const s of await Store.listSubmissions()) {
      counts.set(s.date, (counts.get(s.date) || 0) + 1);
    }
    const dates = [...counts.keys()].sort((a, b) => b.localeCompare(a));
    sel.innerHTML = '<option value="">전체 날짜</option>' +
      dates.map((d) => `<option value="${esc(d)}">${esc(U.shortLabel(d))} · ${counts.get(d)}건</option>`).join('');
    // 고르고 있던 날짜가 사라졌으면 전체로 되돌린다.
    sel.value = dates.includes(keep) ? keep : '';
    feedDate = sel.value;
  }

  async function refreshAllFeed() {
    const filter = {};
    if (feedPerson) filter.participantId = feedPerson;
    if (feedDate) filter.date = feedDate;
    const all = sortByMode(await Store.listSubmissions(filter), feedSort);

    $('feedCount').textContent = `${all.length}건`;
    $('allFeedDownloadBtn').disabled = !feedPerson || !all.length;

    const list = $('allFeedList');
    const moreWrap = $('allFeedLoadMoreWrap');
    if (!all.length) {
      const what = feedDate ? `${U.shortLabel(feedDate)}에 ` : '';
      list.innerHTML = feedPerson
        ? `<div class="empty">이 사람이 ${what}제출한 인증글이 없습니다.</div>`
        : `<div class="empty">${what}제출된 인증글이 없습니다.</div>`;
      moreWrap.hidden = true;
      return;
    }

    const visible = all.slice(0, visibleCount);
    list.innerHTML = groupByDate(visible).map(([date, items]) => `
      <div class="all-feed-date-group">
        <h3 class="all-feed-date-heading">${esc(U.longLabel(date))} <span class="tag">${items.length}건</span></h3>
        <div class="all-feed-grid full">${items.map(renderItem).join('')}</div>
      </div>`).join('');
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
    participants = await Store.listParticipants();
    $('allFeedPerson').insertAdjacentHTML('beforeend',
      participants.map((p) => `<option value="${esc(p.id)}">${esc(p.nickname)}</option>`).join(''));
    await populateDateOptions();
    await refreshAllFeed();

    $('allFeedLoadMoreBtn').addEventListener('click', () => {
      visibleCount += FEED_PAGE_SIZE;
      refreshAllFeed();
    });
    $('allFeedSort').addEventListener('change', (e) => {
      feedSort = e.target.value;
      visibleCount = FEED_PAGE_SIZE; // 정렬 기준이 바뀌면 페이지도 처음부터 다시 본다
      refreshAllFeed();
    });
    $('allFeedPerson').addEventListener('change', (e) => {
      feedPerson = e.target.value;
      visibleCount = FEED_PAGE_SIZE;
      refreshAllFeed();
    });
    $('allFeedDate').addEventListener('change', (e) => {
      feedDate = e.target.value;
      visibleCount = FEED_PAGE_SIZE; // 날짜가 바뀌면 페이지도 처음부터
      refreshAllFeed();
    });
    $('allFeedDownloadBtn').addEventListener('click', downloadPersonTxt);
    $('feedRefresh').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try { await populateDateOptions(); await refreshAllFeed(); } finally { btn.disabled = false; }
    });

    // 실시간 동기화(로컬 저장 백엔드일 때 다른 탭에서 바뀐 내용 반영)
    window.addEventListener('storage', (e) => {
      if (!e.key || !e.key.startsWith(CS.CONFIG.storagePrefix)) return;
      // 새 날짜의 인증이 올라올 수 있으니 날짜 목록도 함께 다시 채운다
      populateDateOptions().then(refreshAllFeed).catch(console.error);
    });
  }

  boot().catch((err) => {
    console.error(err);
    $('allFeedList').innerHTML = `<div class="empty">불러오기 실패: ${esc(err.message)}</div>`;
  });
})();
