/* 식당 상세: #info 정보 / #menu 식단표 / #reviews 후기 */
(function () {
  const esc = OC.esc;
  const app = document.getElementById('app');
  const TABS = [['info', '정보'], ['menu', '식단표'], ['reviews', '후기']];
  let r = null;
  let weekOffset = 0;
  let formRating = 0;
  let reviews = null; // 후기 탭을 처음 열 때 불러옴
  let menusLoaded = null; // 이번 주~다음 주 식단을 한 번만 불러옴
  let content;

  /* ---------- 뼈대 ---------- */
  function renderShell() {
    app.innerHTML = `
      <section class="bg-white border-b border-orange-100">
        <div class="max-w-6xl mx-auto px-4 pt-5 pb-0">
          <a href="map.html?id=${r.id}" class="link-btn -ml-2">← 지도로</a>
          <div id="hero" class="mt-2"></div>
          <nav class="mt-5 flex gap-1" role="tablist" aria-label="식당 정보 탭">
            ${TABS.map(([id, label]) => `<a href="#${id}" role="tab" data-tab="${id}" class="px-5 py-3 font-bold border-b-[3px] border-transparent text-stone-500">${label}</a>`).join('')}
          </nav>
        </div>
      </section>
      <div id="content" class="max-w-6xl mx-auto px-4 py-8"></div>
      <div class="md:hidden fixed bottom-0 inset-x-0 z-[1000] bg-white border-t border-orange-100 p-3 flex gap-2">
        ${r.ticketOnSale
          ? `<a href="checkout.html?id=${r.id}" class="btn btn-primary flex-1">🎫 이용권 사기 · ${OC.won(r.price)}</a>`
          : `<a href="share.html?tab=give&id=${r.id}" class="btn btn-green flex-1">🤝 나눔 식권 기부하기</a>`}
      </div>`;
    content = document.getElementById('content');
    bindEvents();
  }

  function renderHero() {
    const rt = OC.rating(r.id);
    const share = OC.shareRemaining(r.id);
    document.getElementById('hero').innerHTML = `
      <div class="flex flex-col md:flex-row md:items-end gap-4 md:justify-between">
        <div>
          <div class="flex flex-wrap gap-1.5">
            <span class="badge ${r.type === 'buffet' ? 'badge-purple' : 'badge-blue'}">${OC.TYPE[r.type]}</span>
            ${OC.statusBadge(r)}
            ${r.ticketOnSale ? '<span class="badge badge-brand">🎫 이용권 판매 중</span>' : ''}
            ${share > 0 ? `<span class="badge badge-green">🤝 나눔 식권 ${share}장</span>` : ''}
            ${r.tags.map((t) => `<span class="badge">#${esc(t)}</span>`).join('')}
          </div>
          <h1 class="mt-3 text-3xl font-extrabold">${esc(r.name)}</h1>
          <p class="mt-1 text-stone-500">${esc(r.building || r.address)}${r.operator ? ` · ${esc(r.operator)} 운영` : ''}</p>
          <p class="mt-2">${rt.count ? `${OC.stars(rt.avg)} <b>${rt.avg.toFixed(1)}</b> <a href="#reviews" class="text-stone-500 underline underline-offset-2">후기 ${rt.count}개</a>` : '<span class="text-stone-500">아직 후기가 없어요</span>'}</p>
        </div>
        <div class="hidden md:flex items-center gap-3">
          <p class="text-right"><span class="text-sm text-stone-500 block">1식 가격</span><span class="text-2xl font-extrabold text-brand-600">${r.price ? OC.won(r.price) : '미등록'}</span></p>
          ${r.ticketOnSale ? `<a href="checkout.html?id=${r.id}" class="btn btn-primary px-6">🎫 이용권 사기</a>` : '<span class="btn btn-disabled">이용권 준비 중</span>'}
        </div>
      </div>`;
  }

  /* ---------- 정보 탭 ---------- */
  function infoHtml() {
    const share = OC.shareRemaining(r.id);
    const row = (k, v) => (v ? `<div class="grid grid-cols-[7rem_1fr] gap-3 py-3 border-b border-stone-100 last:border-0"><dt class="text-stone-500 font-semibold">${k}</dt><dd>${v}</dd></div>` : '');
    const placeUrl = OC.kakaoPlaceUrl(r);
    return `
      <div class="grid md:grid-cols-[1fr_340px] gap-6">
        <div class="space-y-6">
          <section class="card p-6">
            <h2 class="text-xl font-extrabold">식당 소개</h2>
            ${r.desc ? `<p class="mt-2 text-stone-700 leading-relaxed">${esc(r.desc)}</p>` : ''}
            <dl class="mt-4">
              ${row('1식 가격', r.price ? `<b class="text-brand-600">${OC.won(r.price)}</b>` : '')}
              ${row('운영 시간', esc(OC.hoursText(r)))}
              ${row('외부인 입장', esc(r.publicNote))}
              ${row('위치', `${r.building ? `${esc(r.building)}<br>` : ''}<span class="text-stone-500">${esc(r.address)}</span> <button data-act="copy" class="link-btn">주소 복사</button>`)}
              ${row('전화', r.phone ? `<a href="tel:${esc(r.phone)}" class="underline underline-offset-2">${esc(r.phone)}</a>` : '')}
              ${row('운영 업체', esc(r.operator))}
              ${row('규모', r.capacity ? `하루 약 ${r.capacity}식` : '')}
            </dl>
          </section>
          <section class="card p-6">
            <h2 class="text-xl font-extrabold">이용 방법</h2>
            <ol class="mt-3 space-y-2 text-stone-700">
              <li>1. ${r.ticketOnSale ? '열린식당에서 이용권을 미리 사요.' : '현장에서 결제해요. (이용권 판매 준비 중)'}</li>
              <li>2. ${r.publicNote ? `입장 조건(${esc(r.publicNote)})을 확인하고 방문해요.` : '운영 시간에 맞춰 방문해요.'}</li>
              <li>3. ${r.ticketOnSale ? '입구에서 내 이용권 QR을 보여주면 끝!' : '맛있게 드세요.'}</li>
            </ol>
          </section>
        </div>
        <aside class="space-y-4">
          <div class="card overflow-hidden">
            <div id="miniMap" class="h-56 relative"></div>
            <div class="p-3 grid grid-cols-2 gap-2">
              <a href="map.html?id=${r.id}" class="btn btn-outline">🗺️ 지도에서 보기</a>
              <a href="${OC.kakaoDirections(r)}" target="_blank" rel="noopener" class="btn btn-dark">🧭 길 찾기</a>
              ${placeUrl ? `<a href="${placeUrl}" target="_blank" rel="noopener" class="btn btn-outline col-span-2">카카오맵 장소 정보 보기</a>` : ''}
            </div>
          </div>
          <div class="card p-5 bg-green-50 border-green-100">
            <p class="font-extrabold text-lg">🤝 나눔 식권 <span class="text-green-700">${share}장</span> 남음</p>
            <p class="mt-1 text-sm text-stone-600">이웃이 기부한 식권으로 어르신·청소년이 이 식당에서 식사할 수 있어요.</p>
            <div class="mt-3 grid grid-cols-2 gap-2">
              <a href="share.html?tab=give&id=${r.id}" class="btn btn-green">기부하기</a>
              <a href="share.html?tab=get&id=${r.id}" class="btn btn-outline">받기 신청</a>
            </div>
          </div>
          <button data-act="share" class="btn btn-outline w-full">🔗 이 식당 공유하기</button>
          <button data-act="report" class="link-btn w-full text-stone-500">정보가 실제와 다른가요? 제보하기</button>
        </aside>
      </div>`;
  }
  // 카카오 이미지 지도 (조작 없이 위치만 보여줌)
  function initMiniMap() {
    const el = document.getElementById('miniMap');
    OC.kakaoReady()
      .then(() => {
        if (!el.isConnected) return; // 로딩 중 다른 탭으로 이동한 경우
        const pos = new kakao.maps.LatLng(r.lat, r.lng);
        new kakao.maps.StaticMap(el, { center: pos, level: 3, marker: { position: pos, text: r.short } });
      })
      .catch(() => OC.kakaoError(el));
  }

  /* ---------- 식단표 탭 ---------- */
  function mealHtml(date, meal) {
    const [s, e] = r.hours[meal];
    const m = OC.menu(r.id, date, meal);
    const head = `<span class="badge ${meal === 'lunch' ? 'badge-brand' : 'badge-purple'}">${OC.MEAL[meal]} ${s}~${e}</span>`;
    if (!m) return `<div class="rounded-2xl border border-dashed border-stone-200 p-4"><div class="flex justify-between">${head}</div><p class="mt-2 text-sm text-stone-400">식단 미등록</p></div>`;
    const n = OC.nutrition(m);
    return `
      <div class="rounded-2xl border border-stone-100 p-4">
        <div class="flex items-center justify-between gap-2">
          ${head}
          ${n.kcal ? `<span class="font-extrabold">${n.kcal}<span class="text-sm font-semibold text-stone-500">kcal</span></span>` : ''}
        </div>
        <ul class="mt-3 space-y-1">
          ${m.items.map((i) => `<li class="flex justify-between gap-2"><span>${esc(i.n)}</span>${i.k ? `<span class="text-sm text-stone-400 shrink-0">${i.k}kcal</span>` : ''}</li>`).join('')}
        </ul>
        ${n.kcal ? `${OC.macroBar(n, 'mt-3')}
        <div class="mt-2 flex flex-wrap items-center justify-between gap-1 text-xs text-stone-500">
          <span>탄 ${n.pct.c}% · 단 ${n.pct.p}% · 지 ${n.pct.f}%</span>
          ${n.balanced ? '<span class="badge badge-green">균형식단</span>' : ''}
        </div>` : ''}
      </div>`;
  }
  function menuHtml() {
    const dates = OC.weekDates(weekOffset).filter((d) => OC.mealsOn(r, OC.parseYmd(d)).length);
    const t = OC.today();
    const any = dates.some((d) => OC.mealsOn(r, OC.parseYmd(d)).some((meal) => OC.menu(r.id, d, meal)));
    const range = dates.length ? `${OC.fmtDate(dates[0])} ~ ${OC.fmtDate(dates[dates.length - 1])}` : '';
    return `
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 class="text-2xl font-extrabold">${weekOffset === 0 ? '이번 주' : '다음 주'} 식단표</h2>
          <p class="text-stone-500">${range}</p>
        </div>
        <div class="flex gap-2">
          <button data-week="0" class="chip ${weekOffset === 0 ? 'on' : ''}">이번 주</button>
          <button data-week="1" class="chip ${weekOffset === 1 ? 'on' : ''}">다음 주</button>
        </div>
      </div>
      ${any ? `
      <div class="mt-4 flex flex-wrap gap-4 text-sm text-stone-600">
        <span><span class="dot macro-c"></span> 탄수화물</span><span><span class="dot macro-p"></span> 단백질</span><span><span class="dot macro-f"></span> 지방</span>
        <span>· 영양 정보는 1인분 기준 추정치예요.</span>
      </div>
      <div class="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        ${dates.map((d) => {
          const isToday = d === t;
          return `
            <section class="card p-4 ${isToday ? 'ring-2 ring-brand-500' : ''} ${d < t ? 'opacity-60' : ''}">
              <h3 class="font-extrabold text-lg flex items-center gap-2">${OC.fmtDate(d)} ${isToday ? '<span class="badge badge-brand">오늘</span>' : ''}</h3>
              <div class="mt-3 space-y-3">${OC.mealsOn(r, OC.parseYmd(d)).map((meal) => mealHtml(d, meal)).join('')}</div>
            </section>`;
        }).join('')}
      </div>` : `
      <div class="mt-6 card p-10 text-center">
        <p class="text-4xl">📅</p>
        <p class="mt-3 font-bold">아직 등록된 식단이 없어요</p>
        <p class="mt-1 text-stone-500">${r.type === 'buffet' ? '한식뷔페는 매일 반찬이 바뀌어 식단을 미리 올리지 않는 경우가 많아요.' : '식당이 식단을 등록하면 여기에 표시돼요.'}</p>
      </div>`}`;
  }

  /* ---------- 후기 탭 ---------- */
  function reviewFormHtml() {
    if (!OC.user()) {
      return `
        <div class="card p-6 text-center">
          <p class="font-extrabold text-lg">후기 남기기</p>
          <p class="mt-1 text-stone-500">로그인하면 후기를 쓸 수 있어요.</p>
          <button data-act="login" class="btn w-full mt-4 bg-[#FEE500] text-[#191919]">카카오로 시작하기</button>
        </div>`;
    }
    return `
      <form id="reviewForm" class="card p-6 space-y-4" novalidate>
        <h2 class="text-lg font-extrabold">후기 남기기</h2>
        <div>
          <span class="label">별점</span>
          <div class="flex" role="radiogroup" aria-label="별점 선택">
            ${[1, 2, 3, 4, 5].map((s) => `<button type="button" class="star-btn ${s <= formRating ? 'on' : ''}" data-star="${s}" role="radio" aria-checked="${s === formRating}" aria-label="${s}점">★</button>`).join('')}
          </div>
        </div>
        <label class="block"><span class="label">닉네임</span><input name="nickname" class="input" maxlength="20" value="${esc(OC.nickname())}" placeholder="예: 장전동주민"></label>
        <label class="block"><span class="label">내용</span><textarea name="body" class="input min-h-[110px]" maxlength="300" placeholder="맛, 양, 대기 시간, 분위기 등을 알려주세요"></textarea></label>
        <p id="formError" class="text-sm font-semibold text-red-600 hidden"></p>
        <button class="btn btn-primary w-full">후기 등록</button>
      </form>`;
  }
  function reviewsHtml() {
    if (!reviews) return '<p class="text-stone-400">후기를 불러오는 중…</p>';
    const dist = [5, 4, 3, 2, 1].map((s) => reviews.filter((v) => v.rating === s).length);
    const avg = reviews.length ? reviews.reduce((s, v) => s + v.rating, 0) / reviews.length : 0;
    const max = Math.max(1, ...dist);
    return `
      <div class="grid md:grid-cols-[320px_1fr] gap-6 items-start">
        <div class="space-y-4 md:sticky md:top-24">
          <section class="card p-6 text-center">
            <p class="text-5xl font-extrabold">${reviews.length ? avg.toFixed(1) : '-'}</p>
            <p class="mt-1 text-2xl">${OC.stars(avg)}</p>
            <p class="text-stone-500 mt-1">후기 ${reviews.length}개</p>
            <div class="mt-4 space-y-1.5">
              ${dist.map((c, i) => `
                <div class="flex items-center gap-2 text-sm">
                  <span class="w-6 text-stone-500">${5 - i}점</span>
                  <span class="flex-1 h-2 rounded-full bg-stone-100 overflow-hidden"><span class="block h-full bg-amber-400" style="width:${(c / max) * 100}%"></span></span>
                  <span class="w-5 text-right text-stone-500">${c}</span>
                </div>`).join('')}
            </div>
          </section>
          ${reviewFormHtml()}
        </div>
        <section>
          <h2 class="text-xl font-extrabold mb-3">전체 후기 ${reviews.length}개</h2>
          <div class="space-y-3">
            ${reviews.length ? reviews.map((v) => `
              <article class="card p-5 ${v.mine ? 'border-brand-300' : ''}">
                <div class="flex items-center justify-between gap-2">
                  <p class="font-bold">${esc(v.nickname)} ${v.mine ? '<span class="badge badge-brand ml-1">내 후기</span>' : ''}</p>
                  <span class="text-sm text-stone-400">${OC.fmtDate(v.date)}</span>
                </div>
                <p class="mt-1">${OC.stars(v.rating)}</p>
                <p class="mt-2 text-stone-700 leading-relaxed whitespace-pre-line">${esc(v.text)}</p>
              </article>`).join('') : '<div class="card p-10 text-center text-stone-500">첫 번째 후기를 남겨보세요!</div>'}
          </div>
        </section>
      </div>`;
  }
  function loadReviews() {
    return OC.fetchReviews({ placeId: r.id })
      .then((list) => {
        reviews = list;
      })
      .catch((err) => {
        reviews = [];
        OC.toast('후기를 불러오지 못했어요: ' + err.message);
      });
  }

  /* ---------- 렌더 ---------- */
  function currentTab() {
    const tab = location.hash.slice(1);
    return TABS.some(([id]) => id === tab) ? tab : 'info';
  }
  function render() {
    const tab = currentTab();
    document.querySelectorAll('[data-tab]').forEach((a) => {
      const on = a.dataset.tab === tab;
      a.classList.toggle('text-brand-700', on);
      a.classList.toggle('border-brand-500', on);
      a.classList.toggle('text-stone-500', !on);
      a.setAttribute('aria-selected', on);
    });
    renderHero();
    if (tab === 'info') {
      content.innerHTML = infoHtml();
      initMiniMap();
    } else if (tab === 'menu') {
      content.innerHTML = '<p class="text-stone-400">식단을 불러오는 중…</p>';
      menusLoaded
        .then(() => {
          if (currentTab() === 'menu') content.innerHTML = menuHtml();
        })
        .catch((err) => OC.loadError(content, err));
    } else {
      content.innerHTML = reviewsHtml();
      if (!reviews) loadReviews().then(() => currentTab() === 'reviews' && (content.innerHTML = reviewsHtml()));
    }
  }

  /* ---------- 이벤트 ---------- */
  function bindEvents() {
    content.addEventListener('click', (e) => {
      const star = e.target.closest('[data-star]');
      if (star) {
        formRating = Number(star.dataset.star);
        content.querySelectorAll('[data-star]').forEach((b) => {
          const s = Number(b.dataset.star);
          b.classList.toggle('on', s <= formRating);
          b.setAttribute('aria-checked', s === formRating);
        });
        return;
      }
      const week = e.target.closest('[data-week]');
      if (week) {
        weekOffset = Number(week.dataset.week);
        content.innerHTML = menuHtml();
        return;
      }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'copy') OC.copy(r.address, '주소를 복사했어요');
      if (act.dataset.act === 'share') OC.copy(location.href.split('#')[0], '식당 링크를 복사했어요');
      if (act.dataset.act === 'login') OC.signIn();
      if (act.dataset.act === 'report') OC.openReport(r);
    });
    content.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      const btn = e.target.querySelector('button:not([type])');
      const nickname = f.namedItem('nickname').value.trim();
      const body = f.namedItem('body').value.trim();
      const err = document.getElementById('formError');
      const fail = (msg) => {
        err.textContent = msg;
        err.classList.remove('hidden');
      };
      if (!formRating) return fail('별점을 선택해 주세요.');
      if (!nickname) return fail('닉네임을 입력해 주세요.');
      if (body.length < 5) return fail('후기를 5자 이상 적어 주세요.');
      btn.disabled = true;
      try {
        await OC.addReview({ restaurantId: r.id, nickname, rating: formRating, text: body });
        formRating = 0;
        await loadReviews();
        render();
        OC.toast('후기를 등록했어요. 고마워요!');
      } catch (ex) {
        btn.disabled = false;
        fail('등록하지 못했어요: ' + ex.message);
      }
    });
    window.addEventListener('hashchange', render);
  }

  /* ---------- 시작 ---------- */
  app.innerHTML = '<p class="max-w-6xl mx-auto px-4 py-16 text-stone-400">불러오는 중…</p>';
  OC.ready
    .then(() => {
      r = OC.restaurant(OC.qs('id'));
      if (!r) {
        app.innerHTML = `
          <div class="max-w-xl mx-auto px-4 py-24 text-center">
            <p class="text-5xl">🍽️</p>
            <h1 class="mt-4 text-2xl font-extrabold">식당을 찾을 수 없어요</h1>
            <a href="map.html" class="btn btn-primary mt-6">지도에서 찾기</a>
          </div>`;
        return;
      }
      document.title = `${r.name} · 열린식당`;
      menusLoaded = OC.loadMenus([r.id], OC.weekDates(0)[0], OC.weekDates(1)[5]);
      renderShell();
      render();
    })
    .catch((err) => OC.loadError(app, err));
})();
