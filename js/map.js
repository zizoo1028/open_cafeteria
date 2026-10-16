/* 지도 검색 (카카오맵): 마커, 필터, 목록, 식당 카드(데스크톱 패널 / 모바일 바텀시트) */
(function () {
  const esc = OC.esc;
  const desktop = window.matchMedia('(min-width: 768px)');
  const state = { q: '', type: 'all', tier: 'all', openNow: false, ticket: false, share: false, selected: null, me: null, sheet: null };

  const panel = document.getElementById('panel');
  const sheet = document.getElementById('sheet');
  const sheetBody = document.getElementById('sheetBody');
  const mapEl = document.getElementById('map');

  let map = null;
  let clusterer = null;
  let meOverlay = null;
  const overlays = new Map(); // id → { overlay, el }

  const latLng = (p) => new kakao.maps.LatLng(p.lat, p.lng);

  /* ---------- 마커 ---------- */
  function pinHtml(r, active) {
    const icons = (r.ticketOnSale ? '🎫' : '') + (OC.shareRemaining(r.id) > 0 ? '🤝' : '');
    return `<div class="pin pin-${OC.priceTier(r)}${active ? ' pin-active' : ''}" role="button" tabindex="0" aria-label="${esc(r.name)}" title="${esc(r.name)}"><span class="pin-label">${esc(r.short)}</span>${icons ? `<span class="pin-icons">${icons}</span>` : ''}</div>`;
  }
  function createOverlays() {
    OC.restaurants().forEach((r) => {
      const el = OC.overlayEl(pinHtml(r, false));
      el.addEventListener('click', () => select(r.id));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') select(r.id);
      });
      const overlay = new kakao.maps.CustomOverlay({ position: latLng(r), content: el, xAnchor: 0, yAnchor: 0, clickable: true });
      overlays.set(r.id, { overlay, el });
    });
  }
  function setActivePin(id) {
    overlays.forEach(({ overlay, el }, rid) => {
      const on = rid === id;
      el.innerHTML = pinHtml(OC.restaurant(rid), on);
      el.classList.toggle('is-active', on);
      overlay.setZIndex(on ? 10 : 0);
    });
  }

  /* ---------- 필터 ---------- */
  function matches(r) {
    const q = state.q.trim().toLowerCase();
    if (q && ![r.name, r.building, r.address, ...r.tags].join(' ').toLowerCase().includes(q)) return false;
    if (state.type !== 'all' && r.type !== state.type) return false;
    if (state.tier !== 'all' && OC.priceTier(r) !== state.tier) return false;
    if (state.openNow && !OC.status(r).open) return false;
    if (state.ticket && !r.ticketOnSale) return false;
    if (state.share && OC.shareRemaining(r.id) <= 0) return false;
    return true;
  }
  const dist = (r) => OC.distance(state.me, r);
  function visible() {
    const list = OC.restaurants().filter(matches);
    return state.me ? list.sort((a, b) => dist(a) - dist(b)) : list;
  }

  function refresh() {
    const list = visible();
    if (map) {
      const shown = list.map((r) => overlays.get(r.id).overlay);
      if (clusterer) {
        clusterer.clear();
        clusterer.addMarkers(shown);
      } else {
        const ids = new Set(list.map((r) => r.id));
        overlays.forEach(({ overlay }, id) => overlay.setMap(ids.has(id) ? map : null));
      }
    }
    document.getElementById('count').textContent = `${list.length}곳`;
    if (desktop.matches) {
      if (!state.selected) renderPanelList(list);
    } else if (state.sheet === 'list') {
      sheetBody.innerHTML = listHtml(list);
    }
  }

  /* ---------- 목록 ---------- */
  function listItemHtml(r) {
    const tm = OC.todayMenu(r);
    const main = tm.menu ? tm.menu.items.slice(0, 3).map((i) => i.n).join(' · ') : '식단 미등록';
    const rt = OC.rating(r.id);
    const share = OC.shareRemaining(r.id);
    return `
      <button data-act="select" data-id="${r.id}" class="w-full text-left card p-4 hover:border-brand-300 transition">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="font-extrabold text-lg truncate">${esc(r.name)}</p>
            <p class="text-sm text-stone-500 truncate">${esc(OC.subtitle(r))}${state.me ? ` · ${OC.fmtDist(dist(r))}` : ''}</p>
          </div>
          <p class="font-extrabold text-brand-600 shrink-0">${OC.won(r.price)}</p>
        </div>
        <div class="mt-2 flex flex-wrap gap-1.5">
          ${OC.statusBadge(r)}
          ${r.ticketOnSale ? '<span class="badge badge-brand">🎫 이용권</span>' : ''}
          ${share > 0 ? `<span class="badge badge-green">🤝 ${share}장</span>` : ''}
        </div>
        <p class="mt-2 text-sm text-stone-600">🍱 ${esc(tm.label)}: <b>${esc(main)}</b>
          ${rt.count ? ` · <span class="stars">★</span> ${rt.avg.toFixed(1)} (${rt.count})` : ''}</p>
      </button>`;
  }
  function listHtml(list) {
    return `
      <div class="p-4 space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="font-extrabold text-lg">주변 식당 ${list.length}곳</h2>
          <span class="text-sm text-stone-500">${state.me ? '가까운 순' : '기본 순'}</span>
        </div>
        <button data-act="report-new" class="w-full text-left rounded-xl border border-dashed border-brand-300 bg-white px-4 py-3 text-sm font-semibold text-brand-700 hover:bg-brand-50">📮 여기 없는 식당을 알고 있나요? 제보하기</button>
        ${list.length ? list.map(listItemHtml).join('') : `<div class="card p-8 text-center text-stone-500">${OC.restaurants().length ? '조건에 맞는 식당이 없어요.<br>필터를 바꿔 보세요.' : '아직 등록된 식당이 없어요.'}</div>`}
      </div>`;
  }
  function renderPanelList(list = visible()) {
    panel.innerHTML = listHtml(list);
  }

  /* ---------- 식당 카드 ---------- */
  function detailHtml(r) {
    const tm = OC.todayMenu(r);
    const nut = tm.menu ? OC.nutrition(tm.menu) : null;
    const rt = OC.rating(r.id);
    const share = OC.shareRemaining(r.id);
    const base = `restaurant.html?id=${r.id}`;
    return `
      <div class="p-5 space-y-4">
        ${desktop.matches ? '<button data-act="back" class="link-btn -ml-2">← 목록으로</button>' : ''}
        <div class="flex items-start gap-3">
          <div class="flex-1 min-w-0">
            <h2 class="text-xl font-extrabold leading-snug">${esc(r.name)} <span class="text-brand-600 whitespace-nowrap">${OC.won(r.price)}</span></h2>
            <p class="text-sm text-stone-500 mt-0.5">${esc(OC.subtitle(r))}${r.operator ? ` · ${esc(r.operator)} 운영` : ''}</p>
          </div>
          <button data-act="close" class="icon-btn" aria-label="닫기">✕</button>
        </div>
        <div class="flex flex-wrap gap-1.5">
          ${OC.statusBadge(r)}
          ${r.ticketOnSale ? '<span class="badge badge-brand">🎫 이용권 판매 중</span>' : ''}
          ${share > 0 ? `<span class="badge badge-green">🤝 나눔 식권 ${share}장</span>` : ''}
        </div>
        <ul class="info-list text-[15px]">
          <li><span class="ico">📍</span><span class="flex-1">${esc(r.address)}</span><button data-act="copy" class="link-btn">복사</button></li>
          <li><span class="ico">🕒</span><span class="flex-1">${esc(OC.hoursText(r))}</span></li>
          <li><span class="ico">🚶</span><span class="flex-1">${state.me ? `현재 위치에서 <b>${OC.fmtDist(dist(r))}</b>` : '<span class="text-stone-400">내 위치를 확인하면 거리가 보여요</span>'}</span>
            ${state.me ? '' : '<button data-act="locate" class="link-btn">내 위치 확인</button>'}</li>
          ${r.publicNote ? `<li><span class="ico">ℹ️</span><span class="flex-1">${esc(r.publicNote)}</span></li>` : ''}
          ${r.phone ? `<li><span class="ico">📞</span><a class="flex-1 underline underline-offset-2" href="tel:${esc(r.phone)}">${esc(r.phone)}</a></li>` : ''}
        </ul>
        <div class="rounded-2xl bg-brand-50 p-4">
          <div class="flex flex-wrap justify-between items-center gap-1 mb-2">
            <b>🍱 ${esc(tm.label)} 메뉴</b>
            ${nut ? `<span class="text-sm text-stone-600">${nut.kcal}kcal${nut.balanced ? ' · <b class="text-green-700">균형식단</b>' : ''}</span>` : ''}
          </div>
          ${tm.menu ? `<p class="leading-relaxed">${tm.menu.items.map((i) => esc(i.n)).join(' · ')}</p>${OC.macroBar(nut, 'mt-3')}` : '<p class="text-stone-500">등록된 식단이 없어요.</p>'}
        </div>
        <div>
          <div class="flex items-center justify-between mb-2">
            <b>💬 후기</b>
            ${rt.count ? `<span>${OC.stars(rt.avg)} <b>${rt.avg.toFixed(1)}</b> <span class="text-stone-500 text-sm">(${rt.count})</span></span>` : '<span class="text-sm text-stone-500">아직 후기가 없어요</span>'}
          </div>
          <div data-recent-reviews="${r.id}" class="space-y-2">${rt.count ? '<p class="text-sm text-stone-400">후기를 불러오는 중…</p>' : ''}</div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <a class="btn btn-outline" href="${base}#menu">📅 식단표 보기</a>
          <a class="btn btn-outline" href="${base}#reviews">💬 후기 전체보기</a>
          <a class="btn btn-outline" href="${base}#info">ℹ️ 상세 정보</a>
          ${r.ticketOnSale ? `<a class="btn btn-primary" href="checkout.html?id=${r.id}">🎫 이용권 사기</a>` : '<span class="btn btn-disabled">이용권 준비 중</span>'}
        </div>
        <div class="grid ${OC.kakaoPlaceUrl(r) ? 'grid-cols-[1fr_auto_auto]' : 'grid-cols-[1fr_auto]'} gap-2">
          <a class="btn btn-dark" href="${OC.kakaoDirections(r)}" target="_blank" rel="noopener">🧭 길 찾기</a>
          ${OC.kakaoPlaceUrl(r) ? `<a class="btn btn-outline px-4" href="${OC.kakaoPlaceUrl(r)}" target="_blank" rel="noopener">카카오맵</a>` : ''}
          <button data-act="share" class="btn btn-outline px-5">🔗 공유</button>
        </div>
        <button data-act="report" class="link-btn -ml-2 text-stone-500">정보가 실제와 다른가요? 제보하기</button>
      </div>`;
  }

  // 카드의 최근 후기 2개는 따로 불러와 채움
  function fillRecentReviews(r) {
    if (!OC.rating(r.id).count) return;
    OC.fetchReviews({ placeId: r.id, limit: 2 })
      .then((list) => {
        document.querySelectorAll(`[data-recent-reviews="${r.id}"]`).forEach((box) => {
          box.innerHTML = list.map((v) => `
            <div class="rounded-xl border border-stone-100 p-3">
              <div class="flex justify-between text-sm"><span class="font-semibold">${esc(v.nickname)}</span>${OC.stars(v.rating, 'text-sm')}</div>
              <p class="text-stone-700 mt-1 line-clamp-2">${esc(v.text)}</p>
            </div>`).join('');
        });
      })
      .catch(() => {});
  }
  function showDetail(r) {
    if (desktop.matches) {
      panel.innerHTML = detailHtml(r);
      panel.scrollTop = 0;
    } else {
      openSheet('detail', detailHtml(r));
    }
    fillRecentReviews(r);
  }

  /* ---------- 선택 / 해제 ---------- */
  function panToRestaurant(r) {
    if (!map) return;
    if (desktop.matches) return map.panTo(latLng(r));
    // 모바일: 바텀시트에 가리지 않도록 마커를 화면 위쪽으로
    const proj = map.getProjection();
    const pt = proj.containerPointFromCoords(latLng(r));
    const shifted = new kakao.maps.Point(pt.x, pt.y + mapEl.clientHeight * 0.28);
    const target = proj.coordsFromContainerPoint(shifted);
    map.panTo(target);
  }
  function select(id) {
    const r = OC.restaurant(id);
    if (!r) return;
    state.selected = r.id;
    setActivePin(r.id);
    showDetail(r);
    panToRestaurant(r);
    history.replaceState(null, '', `map.html?id=${r.id}`);
  }
  function deselect() {
    state.selected = null;
    setActivePin(null);
    closeSheet();
    if (desktop.matches) renderPanelList();
    history.replaceState(null, '', 'map.html');
  }
  function openSheet(mode, html) {
    state.sheet = mode;
    sheetBody.innerHTML = html;
    sheetBody.scrollTop = 0;
    sheet.classList.add('open');
  }
  function closeSheet() {
    state.sheet = null;
    sheet.classList.remove('open');
  }

  /* ---------- 내 위치 ---------- */
  function setMe(loc) {
    state.me = loc;
    if (map) {
      if (meOverlay) meOverlay.setMap(null);
      meOverlay = new kakao.maps.CustomOverlay({ position: latLng(loc), content: OC.overlayEl('<div class="me-dot"></div>'), xAnchor: 0, yAnchor: 0, zIndex: 5 });
      meOverlay.setMap(map);
      map.setLevel(4);
      map.panTo(latLng(loc));
    }
    OC.toast('내 위치 기준으로 가까운 순 정렬했어요');
    refresh();
    if (state.selected) showDetail(OC.restaurant(state.selected));
  }

  // 위치를 못 가져왔을 때 원인별로 허용 방법 안내 (사이트가 권한을 대신 켤 수는 없음)
  function locationHelp(code) {
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    const steps = {
      1: {
        title: '위치 권한이 꺼져 있어요',
        body: isMobile
          ? ['주소창의 <b>자물쇠(또는 ⓘ) 아이콘</b> → <b>권한</b> → <b>위치 → 허용</b>', '휴대폰 <b>설정 → 위치(위치 서비스)</b>가 켜져 있는지 확인', '설정 후 이 페이지를 새로고침']
          : ['주소창 왼쪽의 <b>자물쇠(사이트 정보) 아이콘</b>을 누르세요', '<b>위치</b>를 <b>허용</b>으로 바꾸세요 (없으면 <b>사이트 설정 → 위치 → 허용</b>)', '페이지를 새로고침한 뒤 다시 ◎ 버튼을 누르세요'],
      },
      2: {
        title: '기기에서 위치를 찾지 못했어요',
        body: isMobile
          ? ['휴대폰 <b>설정 → 위치</b>를 켜 주세요', 'Wi-Fi를 켜 두면 실내에서도 위치가 더 잘 잡혀요']
          : ['Windows <b>설정 → 개인 정보 및 보안 → 위치</b>에서 <b>위치 서비스</b>와 <b>앱의 위치 액세스</b>를 켜 주세요', 'PC는 Wi-Fi로 위치를 추정해서 수백 m 정도 차이가 날 수 있어요'],
      },
      3: { title: '위치를 찾는 데 시간이 너무 걸려요', body: ['잠시 후 ◎ 버튼을 다시 눌러 주세요', '실내라면 창가나 Wi-Fi가 켜진 곳에서 시도해 보세요'] },
      0: { title: '이 브라우저는 위치 기능을 지원하지 않아요', body: ['크롬·엣지·사파리 최신 버전에서 열어 주세요', '주소가 <b>https://</b>로 시작하는지 확인해 주세요'] },
    }[code] || { title: '위치를 가져오지 못했어요', body: ['잠시 후 다시 시도해 주세요'] };
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `
      <div class="bg-white rounded-3xl p-6 w-[min(92vw,420px)] shadow-xl" role="dialog" aria-modal="true" aria-label="위치 권한 안내">
        <p class="text-3xl">📍</p>
        <p class="mt-2 text-lg font-extrabold">${steps.title}</p>
        <ol class="mt-3 space-y-2 text-stone-700 list-decimal pl-5">${steps.body.map((s) => `<li>${s}</li>`).join('')}</ol>
        <button data-close class="btn btn-primary w-full mt-5">확인</button>
      </div>`;
    ov.addEventListener('click', (e) => {
      if (e.target === ov || e.target.closest('[data-close]')) ov.remove();
    });
    document.body.appendChild(ov);
  }

  function locate() {
    if (!navigator.geolocation || !window.isSecureContext) return locationHelp(0);
    const btn = document.getElementById('locateBtn');
    btn.classList.add('animate-pulse');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btn.classList.remove('animate-pulse');
        setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        btn.classList.remove('animate-pulse');
        locationHelp(err.code); // 1: 권한 거부, 2: 위치 못 찾음, 3: 시간 초과
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  /* ---------- 이벤트 ---------- */
  function onAction(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const r = OC.restaurant(state.selected);
    switch (el.dataset.act) {
      case 'select': return select(Number(el.dataset.id));
      case 'close':
      case 'back': return deselect();
      case 'copy': return OC.copy(r.address, '주소를 복사했어요');
      case 'locate': return locate();
      case 'report': return OC.openReport(r);
      case 'report-new': return OC.openReport();
      case 'share': {
        const url = new URL(`restaurant.html?id=${r.id}`, location.href).href;
        if (navigator.share) return navigator.share({ title: r.name, text: `${r.name} ${OC.won(r.price)} · 열린식당`, url }).catch(() => {});
        return OC.copy(url, '링크를 복사했어요');
      }
    }
  }
  panel.addEventListener('click', onAction);
  sheetBody.addEventListener('click', onAction);

  document.getElementById('search').addEventListener('input', (e) => {
    state.q = e.target.value;
    refresh();
  });
  document.getElementById('chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    if (chip.dataset.type) {
      state.type = chip.dataset.type;
      document.querySelectorAll('[data-type]').forEach((c) => c.classList.toggle('on', c === chip));
    } else if (chip.dataset.tier) {
      state.tier = chip.dataset.tier;
      document.querySelectorAll('[data-tier]').forEach((c) => c.classList.toggle('on', c === chip));
    } else {
      const key = chip.dataset.toggle;
      state[key] = !state[key];
      chip.classList.toggle('on', state[key]);
      chip.setAttribute('aria-pressed', state[key]);
    }
    refresh();
  });
  document.getElementById('locateBtn').addEventListener('click', locate);
  document.getElementById('listBtn').addEventListener('click', () => {
    if (state.selected) {
      state.selected = null;
      setActivePin(null);
    }
    openSheet('list', listHtml(visible()));
  });
  desktop.addEventListener('change', () => {
    closeSheet();
    if (map) map.relayout();
    if (state.selected) select(state.selected);
    else refresh();
  });
  window.addEventListener('resize', () => map && map.relayout());

  /* ---------- 시작 ---------- */
  panel.innerHTML = '<p class="p-6 text-stone-400">식당을 불러오는 중…</p>';
  function initMap() {
    map = new kakao.maps.Map(mapEl, { center: new kakao.maps.LatLng(35.2385, 129.0875), level: 5 });
    map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
    kakao.maps.event.addListener(map, 'click', () => {
      if (state.selected || state.sheet) deselect();
    });
    createOverlays();
    // 식당이 많아지면 확대 레벨 6 이상에서 묶어서 표시
    clusterer = new kakao.maps.MarkerClusterer({ map, averageCenter: true, minLevel: 6, gridSize: 60 });
    refresh();

    const initial = Number(OC.qs('id'));
    if (initial && OC.restaurant(initial)) {
      map.setLevel(3);
      map.setCenter(latLng(OC.restaurant(initial)));
      select(initial);
    }
  }
  OC.ready
    .then(() => {
      refresh(); // 지도 로딩 전에도 목록은 먼저 표시
      return OC.kakaoReady().then(initMap, () => OC.kakaoError(mapEl));
    })
    .catch((err) => OC.loadError(panel, err));
})();
