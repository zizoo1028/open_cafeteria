/* 후기 피드: 모든 식당의 최근 후기 */
(function () {
  const esc = OC.esc;
  const state = { rid: 0, sort: 'new', list: [] };
  const filter = document.getElementById('filter');
  const listEl = document.getElementById('list');

  function render() {
    let list = state.list;
    if (state.sort === 'high') list = list.slice().sort((a, b) => b.rating - a.rating || b.date.localeCompare(a.date));
    if (state.sort === 'low') list = list.slice().sort((a, b) => a.rating - b.rating || b.date.localeCompare(a.date));

    const avg = list.length ? list.reduce((s, x) => s + x.rating, 0) / list.length : 0;
    document.getElementById('summary').innerHTML = `최근 후기 ${list.length}개${list.length ? ` · 평균 <span class="stars">★</span> ${avg.toFixed(1)}` : ''}`;

    listEl.innerHTML = list.length
      ? list.map((v) => {
          const r = OC.restaurant(v.restaurantId);
          if (!r) return ''; // 숨김 처리된 식당의 후기
          return `
            <article class="card p-5 ${v.mine ? 'border-brand-300' : ''}">
              <a href="restaurant.html?id=${r.id}#reviews" class="inline-flex items-center gap-2 font-extrabold hover:text-brand-600">
                🍚 ${esc(r.name)} ${r.price ? `<span class="text-brand-600 font-bold text-sm">${OC.won(r.price)}</span>` : ''}
              </a>
              <div class="mt-2 flex items-center justify-between gap-2">
                <p>${OC.stars(v.rating)} <span class="font-semibold ml-1">${esc(v.nickname)}</span> ${v.mine ? '<span class="badge badge-brand ml-1">내 후기</span>' : ''}</p>
                <span class="text-sm text-stone-400">${OC.fmtDate(v.date)}</span>
              </div>
              <p class="mt-2 text-stone-700 leading-relaxed whitespace-pre-line">${esc(v.text)}</p>
              <div class="mt-3 flex gap-3 text-sm">
                <a href="restaurant.html?id=${r.id}#menu" class="link-btn -ml-2">📅 식단표</a>
                <a href="map.html?id=${r.id}" class="link-btn">🗺️ 지도에서 보기</a>
              </div>
            </article>`;
        }).join('')
      : '<div class="card p-10 text-center text-stone-500">아직 후기가 없어요.</div>';
  }

  async function load() {
    listEl.innerHTML = '<p class="text-stone-400">불러오는 중…</p>';
    try {
      state.list = await OC.fetchReviews({ placeId: state.rid || undefined, limit: 100 });
      render();
    } catch (err) {
      OC.loadError(listEl, err);
    }
  }

  filter.addEventListener('change', () => {
    state.rid = Number(filter.value);
    load();
  });
  document.querySelectorAll('[data-sort]').forEach((chip) =>
    chip.addEventListener('click', () => {
      state.sort = chip.dataset.sort;
      document.querySelectorAll('[data-sort]').forEach((c) => c.classList.toggle('on', c === chip));
      render();
    })
  );

  OC.ready
    .then(() => {
      filter.innerHTML = '<option value="0">전체 식당</option>' + OC.restaurants().map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
      load();
    })
    .catch((err) => OC.loadError(listEl, err));
})();
