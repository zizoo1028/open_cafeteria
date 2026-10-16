/* 관리자: 식당 목록·편집·승인, CSV 일괄 등록, 카카오 검색 추가, 제보 처리
 * 좌표 변환·장소 검색은 카카오 JavaScript SDK(services)로 브라우저에서 처리 (REST 키 불필요)
 */
(function () {
  const esc = OC.esc;
  const sb = OC.sb;
  const unwrap = OC.unwrap;
  const gate = document.getElementById('gate');
  const appEl = document.getElementById('adminApp');
  const content = document.getElementById('tabContent');

  const CENTER = { lat: 35.2312, lng: 129.0846, label: '부산대 정문' };
  const TYPE_FROM = { 구내식당: 'cafeteria', 직원식당: 'cafeteria', 한식뷔페: 'buffet', 뷔페: 'buffet' };
  const STATUS = { candidate: ['후보', 'badge-brand'], verified: ['승인', 'badge-open'], hidden: ['숨김', ''] };
  const REPORT_KIND = { new_place: '새 식당', wrong_info: '정보 오류', closed: '폐업·미개방', other: '기타' };
  const REPORT_STATUS = { open: ['미처리', 'badge-brand'], accepted: ['반영', 'badge-open'], rejected: ['거절', ''] };

  const state = {
    tab: 'places',
    places: [],
    users: null,
    reports: [],
    filter: { status: 'all', q: '' },
    selected: new Set(), // 식당 목록에서 체크한 id
    csv: { rows: null, progress: null, autoApprove: false },
    search: { q: '', radius: 2000, results: null, loading: false },
    kakaoOk: false,
  };

  /* ================= 공통 ================= */
  const hhmm = (t) => (t ? t.slice(0, 5) : '');
  const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
  const kakaoIds = () => new Set(state.places.map((p) => p.kakao_place_id).filter(Boolean));
  const placeLabel = (p) => `${p.price ? OC.won(p.price) : '가격 없음'} · ${p.lunch_start ? `중식 ${hhmm(p.lunch_start)}~${hhmm(p.lunch_end)}` : '시간 없음'}`;

  async function loadPlaces() {
    state.places = unwrap(await sb.from('places').select('*').order('created_at', { ascending: false }));
  }
  async function loadReports() {
    state.reports = unwrap(await sb.from('reports').select('*').order('created_at', { ascending: false }).limit(200));
    const open = state.reports.filter((r) => r.status === 'open').length;
    document.getElementById('reportCount').innerHTML = open ? `<span class="ml-1 badge badge-brand">${open}</span>` : '';
  }
  async function loadUsers() {
    if (!state.users) state.users = unwrap(await sb.from('profiles').select('id, nickname, role, created_at').order('created_at'));
    return state.users;
  }

  /* ---------- 카카오 SDK 래퍼 ---------- */
  function geocode(address) {
    return new Promise((resolve) => {
      new kakao.maps.services.Geocoder().addressSearch(address, (result, status) => {
        resolve(status === kakao.maps.services.Status.OK ? result[0] : null);
      });
    });
  }
  // pages: 최대 몇 페이지(페이지당 15개)까지 모을지
  function keywordSearch(query, { location, radius = 1000, pages = 1 } = {}) {
    return new Promise((resolve) => {
      const out = [];
      const opts = location
        ? { location: new kakao.maps.LatLng(location.lat, location.lng), radius, sort: kakao.maps.services.SortBy.DISTANCE }
        : {};
      new kakao.maps.services.Places().keywordSearch(
        query,
        (data, status, pg) => {
          if (status === kakao.maps.services.Status.OK) {
            out.push(...data);
            if (pg && pg.hasNextPage && pg.current < pages) return pg.nextPage();
          }
          resolve(out);
        },
        opts
      );
    });
  }
  // 이름으로 카카오 장소 고르기: 정확히 같으면 확정, 비슷하면 가장 가까운 곳 + 확인 필요
  // "식당/구내식당" 등을 뺀 이름이 같고 음식점 카테고리면 같은 식당으로 봄 (예: 국회도서관 식당 = 국회도서관 구내식당)
  function pickPlace(name, list) {
    const n = norm(name);
    const exact = list.find((p) => norm(p.place_name) === n);
    if (exact) return { place: exact, loose: false };
    const isFood = (p) => /^음식점/.test(p.category_name || '');
    const base = norm(String(name).replace(SUFFIX_RE, ''));
    const sameBase = base.length >= 2 && list.find((p) => isFood(p) && norm(p.place_name.replace(SUFFIX_RE, '')) === base);
    if (sameBase) return { place: sameBase, loose: false };
    const similarTo = (p) => norm(p.place_name).includes(n) || n.includes(norm(p.place_name));
    const similar = list.find((p) => isFood(p) && similarTo(p)) || list.find(similarTo);
    return similar ? { place: similar, loose: true } : null;
  }

  /* ---------- 같은 주소 안에서 건물 찾기 ----------
   * 대학 캠퍼스·관공서 단지처럼 한 주소(번지)에 건물이 여러 개면 주소 검색 좌표는 단지 중심이 된다.
   * 그래서 ① 주소로 번지를 찾고 ② 그 번지와 "주소가 같은" 카카오 장소 중 건물명이 맞는 곳을 골라
   * ③ 그 건물 좌표에 핀을 꽂는다. (식당 자체가 카카오에 있으면 식당 위치를 우선 사용)
   */
  const FLOOR_RE = /(지하|지상)\s*\d*\s*층?|\d+\s*층|B\s*\d+|\d+\s*F|옥상/gi;
  const SUFFIX_RE = /\s*(교직원|학생|직원|구내)?\s*(식당|한식뷔페|뷔페|구내식당|카페테리아)$/;
  const tokens = (s) => String(s || '').split(/[\s·,()/]+/).map(norm).filter((t) => t.length >= 2);
  const dist = (a, p) => OC.distance(a, { lat: +p.y, lng: +p.x });

  // 주소 검색 결과와 카카오 장소의 주소(지번 또는 도로명)가 같은지
  function sameAddress(geo, p) {
    if (!geo) return false;
    const jibun = geo.address && geo.address.address_name;
    const road = geo.road_address && geo.road_address.address_name;
    return (!!jibun && norm(p.address_name) === norm(jibun)) || (!!road && !!p.road_address_name && norm(p.road_address_name) === norm(road));
  }
  // 건물명 후보가 장소 이름에 얼마나 들어 있는지 (마지막 단어는 꼭 포함돼야 함)
  function buildingScore(placeName, hint) {
    const pn = norm(placeName);
    const ts = tokens(hint);
    if (!ts.length || !pn.includes(ts[ts.length - 1])) return 0;
    return ts.filter((t) => pn.includes(t)).length / ts.length + (pn === norm(hint) ? 1 : 0);
  }
  // CSV·편집 창의 값으로 건물명 후보 만들기: 건물명 칸 > 층·위치에서 층 제거 > 식당 이름에서 "식당" 제거
  function buildingHints({ name, building, floor }) {
    const fromFloor = String(floor || '').replace(FLOOR_RE, ' ').replace(/\s+/g, ' ').trim();
    const fromName = String(name || '').replace(SUFFIX_RE, '').trim();
    const hints = [building, fromFloor, fromName, fromName && fromFloor && `${fromName} ${fromFloor}`];
    return [...new Set(hints.map((h) => String(h || '').trim()).filter((h) => tokens(h).length))];
  }

  // 주소 + 건물명 + 식당 이름으로 위치와 카카오 장소를 함께 결정
  async function resolveLocation({ name, address, building, floor }) {
    const notes = [];
    const geo = await geocode(address);
    const base = geo ? { lat: +geo.y, lng: +geo.x } : null;

    // ① 같은 주소 안에서 건물 찾기
    let bld = null;
    if (base) {
      // 단지 이름의 일부일 뿐인 후보(예: 부산대학교 단지의 "부산대")는 건물을 구분하지 못하므로 건너뜀
      // ("국회" 단지의 "국회도서관"처럼 단지 이름보다 구체적인 후보는 사용)
      const complex = norm(geo.road_address && geo.road_address.building_name);
      const hints = buildingHints({ name, building, floor }).filter((h) => !complex || !complex.includes(norm(h)));
      for (const hint of hints) {
        const list = (await keywordSearch(hint, { location: base, radius: 2000, pages: 2 })).filter((p) => sameAddress(geo, p));
        const best = list.map((p) => ({ p, s: buildingScore(p.place_name, hint) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0];
        if (best) {
          bld = best.p;
          break;
        }
      }
    }
    const anchor = bld ? { lat: +bld.y, lng: +bld.x } : base;

    // ② 식당 자체의 카카오 장소: 같은 주소이거나 찾은 건물 120m 안에 있는 것만 인정
    let place = null;
    let loose = false;
    const near = await keywordSearch(name, anchor ? { location: anchor, radius: 500 } : {});
    const allowed = near.filter((p) => !geo || sameAddress(geo, p) || (bld && dist(anchor, p) <= 120));
    const picked = pickPlace(name, allowed);
    if (picked) {
      place = picked.place;
      loose = picked.loose;
    } else {
      const elsewhere = pickPlace(name, near);
      if (elsewhere && geo) notes.push({ level: 'warn', msg: `이름이 비슷한 "${elsewhere.place.place_name}"은(는) 주소가 달라서 연결하지 않았어요` });
    }

    // ③ 핀 위치: 식당 장소 > 건물 > 주소 대표 위치
    let coord = null;
    let via = null;
    if (place && (!bld || dist(anchor, place) <= 120)) {
      coord = { lat: +place.y, lng: +place.x };
      via = 'place';
    } else if (bld) {
      coord = anchor;
      via = 'building';
    } else if (base) {
      coord = base;
      via = 'address';
      if (!place) notes.push({ level: 'warn', msg: '같은 주소에서 건물을 특정하지 못해 주소 대표 위치를 사용했어요 — "건물명"을 적거나 지도에서 위치를 확인해 주세요' });
    } else if (place) {
      coord = { lat: +place.y, lng: +place.x };
      via = 'place';
      notes.push({ level: 'warn', msg: '주소로 위치를 못 찾아 카카오 장소 위치를 사용했어요' });
    }
    if (loose && place) notes.push({ level: 'warn', msg: `카카오 장소 이름이 달라요: "${place.place_name}" — 맞는지 확인` });
    return { coord, via, building: bld, place, notes, roadAddress: geo && geo.road_address ? geo.road_address.address_name : null };
  }
  const VIA_LABEL = { place: '식당 위치', building: '건물 위치', address: '주소 대표 위치' };

  /* ================= 탭 ================= */
  function render() {
    document.querySelectorAll('[data-tab]').forEach((c) => c.classList.toggle('on', c.dataset.tab === state.tab));
    content.innerHTML = { places: placesHtml, csv: csvHtml, search: searchHtml, reports: reportsHtml }[state.tab]();
    if (state.tab === 'places') renderPlaceRows();
  }
  document.querySelectorAll('[data-tab]').forEach((chip) =>
    chip.addEventListener('click', () => {
      state.tab = chip.dataset.tab;
      render();
    })
  );

  /* ================= 1. 식당 목록 ================= */
  // 같은 식당 판단 키: 이름+주소 (공백·대소문자 무시)
  const placeKey = (p) => norm(p.name) + '|' + norm(p.address);
  // 중복 그룹에서 남길 것: 승인 > 숨김 > 후보, 같으면 먼저 등록된 것
  const STATUS_RANK = { verified: 0, hidden: 1, candidate: 2 };
  function duplicatesToRemove() {
    // 이름+주소가 같거나 카카오 장소가 같으면 한 그룹으로 묶기 (union-find)
    const parent = new Map();
    const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
    const firstByKey = new Map();
    state.places.forEach((p) => {
      parent.set(p.id, p.id);
      [placeKey(p), p.kakao_place_id && 'k:' + p.kakao_place_id].filter(Boolean).forEach((k) => {
        if (firstByKey.has(k)) parent.set(find(p.id), find(firstByKey.get(k)));
        else firstByKey.set(k, p.id);
      });
    });
    const groups = new Map();
    state.places.forEach((p) => {
      const root = find(p.id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(p);
    });
    const remove = [];
    groups.forEach((list) => {
      if (list.length < 2) return;
      const keep = list.slice().sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.id - b.id)[0];
      list.forEach((p) => p !== keep && remove.push(p.id));
    });
    return remove;
  }
  function filteredPlaces() {
    const q = norm(state.filter.q);
    return state.places.filter((p) => (state.filter.status === 'all' || p.status === state.filter.status) && (!q || norm(p.name + p.address).includes(q)));
  }

  function placesHtml() {
    const count = (s) => (s === 'all' ? state.places.length : state.places.filter((p) => p.status === s).length);
    const chip = (s, label) => `<button data-status="${s}" class="chip ${state.filter.status === s ? 'on' : ''}">${label} ${count(s)}</button>`;
    const dups = duplicatesToRemove().length;
    return `
      <div class="flex flex-col md:flex-row gap-3 md:items-center">
        <div class="flex gap-2 overflow-x-auto scrollbar-none">
          ${chip('all', '전체')}${chip('candidate', '후보')}${chip('verified', '승인')}${chip('hidden', '숨김')}
        </div>
        <div class="flex gap-2 md:ml-auto">
          <input id="placeSearch" class="input md:w-64" placeholder="이름·주소 검색" value="${esc(state.filter.q)}">
          <button data-act="new" class="btn btn-outline shrink-0">＋ 직접 추가</button>
        </div>
      </div>
      ${dups ? `
      <div class="mt-4 rounded-2xl bg-red-50 border border-red-100 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <p class="flex-1 text-red-800"><b>중복 ${dups}개</b>가 있어요. 이름·주소(또는 카카오 장소)가 같은 식당 중 <b>승인된 것(없으면 먼저 등록된 것) 하나만 남기고</b> 나머지를 지웁니다.</p>
        <button data-act="dedupe" class="btn bg-red-600 text-white hover:bg-red-700 shrink-0">중복 ${dups}개 정리</button>
      </div>` : ''}
      <div id="bulkBar" class="mt-4 sticky top-16 z-10 card p-3 flex flex-wrap items-center gap-2 shadow-sm"></div>
      <div id="placeRows" class="mt-2 space-y-2"></div>`;
  }
  // 선택 상태 표시줄: 전체 선택 체크박스 + 일괄 작업 버튼
  function renderBulkBar() {
    const bar = document.getElementById('bulkBar');
    if (!bar) return;
    const visible = filteredPlaces();
    const picked = visible.filter((p) => state.selected.has(p.id)).length;
    bar.innerHTML = `
      <label class="flex items-center gap-2 font-semibold cursor-pointer px-2 min-h-[40px]">
        <input type="checkbox" id="checkAll" class="w-5 h-5 accent-orange-600" ${visible.length && picked === visible.length ? 'checked' : ''} ${visible.length ? '' : 'disabled'}>
        전체 선택 <span class="text-stone-500 font-normal">(${picked} / ${visible.length})</span>
      </label>
      <div class="flex flex-wrap gap-2 ml-auto">
        <button data-bulk="verified" class="btn btn-green min-h-[40px] py-1" ${picked ? '' : 'disabled'}>선택 승인</button>
        <button data-bulk="candidate" class="btn btn-outline min-h-[40px] py-1" ${picked ? '' : 'disabled'}>후보로</button>
        <button data-bulk="hidden" class="btn btn-outline min-h-[40px] py-1" ${picked ? '' : 'disabled'}>숨김</button>
        <button data-bulk="delete" class="btn btn-ghost text-red-600 min-h-[40px]" ${picked ? '' : 'disabled'}>삭제</button>
      </div>`;
    const all = document.getElementById('checkAll');
    all.indeterminate = picked > 0 && picked < visible.length;
  }
  function renderPlaceRows() {
    const list = filteredPlaces();
    document.getElementById('placeRows').innerHTML = list.length
      ? list.map((p) => {
          const [sl, sc] = STATUS[p.status];
          const warn = [!p.price && '가격 없음', !p.lunch_start && '시간 없음', p.type === 'cafeteria' && !p.public_note && '입장 조건 없음'].filter(Boolean);
          return `
            <div class="card p-4 flex flex-col md:flex-row md:items-center gap-3 ${state.selected.has(p.id) ? 'ring-2 ring-brand-400' : ''}">
              <label class="flex items-center self-start md:self-center cursor-pointer p-1" aria-label="${esc(p.name)} 선택">
                <input type="checkbox" data-check="${p.id}" class="w-5 h-5 accent-orange-600" ${state.selected.has(p.id) ? 'checked' : ''}>
              </label>
              <div class="flex-1 min-w-0">
                <div class="flex flex-wrap gap-1.5 items-center">
                  <span class="badge ${sc}">${sl}</span>
                  <span class="badge ${p.type === 'buffet' ? 'badge-purple' : 'badge-blue'}">${OC.TYPE[p.type]}</span>
                  ${p.kakao_place_id ? '<span class="badge badge-green">카카오 연결</span>' : '<span class="badge">카카오 미연결</span>'}
                  ${warn.map((w) => `<span class="badge bg-red-50 text-red-700">${w}</span>`).join('')}
                </div>
                <p class="mt-1 font-extrabold text-lg truncate">${esc(p.name)}</p>
                <p class="text-sm text-stone-500 truncate">${esc(p.address)} · ${placeLabel(p)}</p>
              </div>
              <div class="flex gap-2 shrink-0">
                <button data-edit="${p.id}" class="btn btn-outline">편집</button>
                ${p.status === 'verified'
                  ? `<button data-set-status="hidden" data-id="${p.id}" class="btn btn-outline">숨김</button>`
                  : `<button data-set-status="verified" data-id="${p.id}" class="btn btn-green">승인</button>`}
              </div>
            </div>`;
        }).join('')
      : `<div class="card p-10 text-center text-stone-500">${state.places.length ? '조건에 맞는 식당이 없어요.' : '아직 등록된 식당이 없어요. CSV 업로드나 카카오 검색으로 추가해 보세요.'}</div>`;
    renderBulkBar();
  }

  /* ---------- 일괄 작업 ---------- */
  const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  // 화면에 보이는 식당 중 선택된 것만 대상으로 (필터로 가려진 선택은 제외)
  const selectedIds = () => filteredPlaces().filter((p) => state.selected.has(p.id)).map((p) => p.id);

  async function bulkStatus(status) {
    const ids = selectedIds();
    if (!ids.length) return;
    const LABEL = { verified: '승인', candidate: '후보로 변경', hidden: '숨김' };
    if (status === 'verified') {
      const missing = state.places.filter((p) => ids.includes(p.id) && (!p.price || !p.lunch_start)).length;
      if (!confirm(`${ids.length}개를 승인할까요?${missing ? `
(그중 ${missing}개는 가격 또는 운영 시간이 비어 있어요)` : ''}
승인하면 바로 지도에 표시돼요.`)) return;
    } else if (!confirm(`${ids.length}개를 ${LABEL[status]} 처리할까요?`)) return;
    try {
      for (const part of chunk(ids, 100)) {
        unwrap(await sb.from('places').update({ status }).in('id', part).select('id, status, verified_at, updated_at')).forEach((row) =>
          Object.assign(state.places.find((p) => p.id === row.id), row)
        );
      }
      state.selected.clear();
      render();
      OC.toast(`${ids.length}개를 ${LABEL[status]}했어요`);
    } catch (err) {
      await loadPlaces();
      render();
      OC.toast('일부만 처리됐을 수 있어요: ' + err.message);
    }
  }
  async function deletePlaces(ids, message) {
    if (!ids.length || !confirm(message)) return;
    let done = 0;
    const failed = [];
    for (const part of chunk(ids, 100)) {
      const { error } = await sb.from('places').delete().in('id', part);
      if (!error) {
        done += part.length;
        continue;
      }
      // 묶음 삭제가 막히면(이용권 기록 등) 하나씩 다시 시도해 막힌 것만 남김
      for (const id of part) {
        const res = await sb.from('places').delete().eq('id', id);
        if (res.error) failed.push(id);
        else done++;
      }
    }
    await loadPlaces();
    state.selected.clear();
    render();
    OC.toast(`${done}개 삭제했어요${failed.length ? ` · ${failed.length}개는 이용권 기록이 있어 삭제하지 못했어요(숨김 처리 권장)` : ''}`);
  }

  async function setStatus(id, status) {
    const p = state.places.find((x) => x.id === id);
    if (status === 'verified' && (!p.price || !p.lunch_start)) {
      if (!confirm(`${p.name}: 가격 또는 운영 시간이 비어 있어요. 그래도 승인할까요?`)) return;
    }
    try {
      const row = unwrap(await sb.from('places').update({ status }).eq('id', id).select().single());
      Object.assign(p, row);
      render();
      OC.toast(status === 'verified' ? `${p.name}을(를) 승인했어요. 지도에 표시돼요.` : `${p.name}을(를) 숨겼어요.`);
    } catch (err) {
      OC.toast('변경하지 못했어요: ' + err.message);
    }
  }

  /* ---------- 편집 창 ---------- */
  function openEditor(place) {
    const p = place || { type: 'cafeteria', status: 'candidate', saturday: false, ticket_on_sale: false, tags: [], lat: CENTER.lat, lng: CENTER.lng };
    const isNew = !place;
    const ov = document.createElement('div');
    ov.className = 'overlay items-start overflow-y-auto py-6';
    const field = (label, html, cls = '') => `<label class="block ${cls}"><span class="label text-sm">${label}</span>${html}</label>`;
    const input = (name, value, attrs = '') => `<input name="${name}" class="input" value="${esc(value ?? '')}" ${attrs}>`;
    ov.innerHTML = `
      <form class="bg-white rounded-3xl p-6 w-[min(96vw,820px)] shadow-xl space-y-5" novalidate>
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-xl font-extrabold">${isNew ? '식당 직접 추가' : `${esc(p.name)} 편집`}</h2>
          <button type="button" data-close class="icon-btn" aria-label="닫기">✕</button>
        </div>

        <div class="grid sm:grid-cols-2 gap-4">
          ${field('이름 *', input('name', p.name, 'maxlength="60"'))}
          ${field('지도 표시 이름', input('short_name', p.short_name, 'maxlength="12" placeholder="비우면 자동"'))}
          ${field('유형 *', `<select name="type" class="input"><option value="cafeteria" ${p.type === 'cafeteria' ? 'selected' : ''}>구내식당</option><option value="buffet" ${p.type === 'buffet' ? 'selected' : ''}>한식뷔페</option></select>`)}
          ${field('상태', `<select name="status" class="input">${Object.entries(STATUS).map(([v, [l]]) => `<option value="${v}" ${p.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
          ${field('주소 *', `<div class="flex gap-2">${input('address', p.address)}<button type="button" data-act="geocode" class="btn btn-outline shrink-0">위치 찾기</button></div>`, 'sm:col-span-2')}
          ${field('건물명·층', input('building', p.building, 'placeholder="예: 학생회관 2층 — 위치 찾기에 쓰여요"'))}
          ${field('전화', input('phone', p.phone))}
        </div>

        <div>
          <div id="editMap" class="h-56 rounded-2xl overflow-hidden bg-stone-100 relative"></div>
          <p class="mt-1 text-xs text-stone-500">마커를 끌어서 위치를 바로잡을 수 있어요. 좌표: <span id="coordText">${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)}</span></p>
          <input type="hidden" name="lat" value="${p.lat}"><input type="hidden" name="lng" value="${p.lng}">
        </div>

        <div class="rounded-2xl bg-stone-50 p-4">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-bold">카카오 장소</span>
            <span id="kakaoLink" class="text-sm">${p.kakao_place_id ? `<a class="underline" target="_blank" rel="noopener" href="https://place.map.kakao.com/${esc(p.kakao_place_id)}">연결됨 (${esc(p.kakao_place_id)})</a>` : '<span class="text-stone-500">미연결</span>'}</span>
            <button type="button" data-act="kakao-find" class="btn-ghost text-sm text-brand-700 font-bold ml-auto">이름으로 다시 찾기</button>
            ${p.kakao_place_id ? '<button type="button" data-act="kakao-clear" class="btn-ghost text-sm text-red-600">연결 해제</button>' : ''}
          </div>
          <input type="hidden" name="kakao_place_id" value="${esc(p.kakao_place_id || '')}">
          <div id="kakaoResults" class="mt-2 space-y-1"></div>
        </div>

        <div class="grid sm:grid-cols-3 gap-4">
          ${field('1식 가격 (원)', input('price', p.price, 'type="number" min="0" step="100" inputmode="numeric"'))}
          ${field('하루 식수', input('capacity', p.capacity, 'type="number" min="1" inputmode="numeric"'))}
          ${field('운영 업체', input('operator', p.operator))}
          ${field('중식 시작', input('lunch_start', hhmm(p.lunch_start), 'type="time"'))}
          ${field('중식 종료', input('lunch_end', hhmm(p.lunch_end), 'type="time"'))}
          <div></div>
          ${field('석식 시작', input('dinner_start', hhmm(p.dinner_start), 'type="time"'))}
          ${field('석식 종료', input('dinner_end', hhmm(p.dinner_end), 'type="time"'))}
        </div>
        <div class="flex flex-wrap gap-2">
          <label class="option"><input type="checkbox" name="saturday" ${p.saturday ? 'checked' : ''}> 토요일 중식 운영</label>
          <label class="option"><input type="checkbox" name="ticket_on_sale" ${p.ticket_on_sale ? 'checked' : ''}> 이용권 판매</label>
        </div>
        ${field('외부인 입장 조건', input('public_note', p.public_note, 'placeholder="예: 외부인 12:10 이후 입장"'))}
        ${field('태그 (쉼표로 구분)', input('tags', (p.tags || []).join(', '), 'placeholder="예: 균형식단, 직장인 추천"'))}
        ${field('소개', `<textarea name="description" class="input min-h-[80px]">${esc(p.description || '')}</textarea>`)}

        ${isNew ? '' : `
        <div class="rounded-2xl border border-stone-100 p-4">
          <p class="font-bold">담당 파트너</p>
          <p class="text-sm text-stone-500">파트너로 지정된 계정은 이 식당의 식단·실적을 관리할 수 있어요. 지정하려면 상대가 먼저 한 번 로그인해야 해요.</p>
          <div id="managerBox" class="mt-3 text-sm text-stone-400">불러오는 중…</div>
        </div>`}

        <p data-error class="text-sm font-semibold text-red-600 hidden"></p>
        <div class="flex flex-col-reverse sm:flex-row gap-2 sm:justify-between">
          ${isNew ? '<span></span>' : '<button type="button" data-act="delete" class="btn btn-ghost text-red-600 justify-center">식당 삭제</button>'}
          <div class="flex gap-2">
            <button type="button" data-close class="btn btn-outline flex-1 sm:flex-none">취소</button>
            <button class="btn btn-primary flex-1 sm:flex-none px-8">저장</button>
          </div>
        </div>
      </form>`;
    document.body.appendChild(ov);
    const form = ov.querySelector('form');
    const f = form.elements;
    const val = (n) => f.namedItem(n).value.trim();
    const err = form.querySelector('[data-error]');
    const fail = (msg) => {
      err.textContent = msg;
      err.classList.toggle('hidden', !msg);
    };

    // 지도 + 드래그 가능한 마커
    let marker = null;
    let map = null;
    function setCoord(lat, lng, pan) {
      f.namedItem('lat').value = lat;
      f.namedItem('lng').value = lng;
      document.getElementById('coordText').textContent = `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
      if (marker) {
        const pos = new kakao.maps.LatLng(lat, lng);
        marker.setPosition(pos);
        if (pan) map.panTo(pos);
      }
    }
    if (state.kakaoOk) {
      const pos = new kakao.maps.LatLng(p.lat, p.lng);
      map = new kakao.maps.Map(document.getElementById('editMap'), { center: pos, level: 3 });
      marker = new kakao.maps.Marker({ position: pos, draggable: true, map });
      kakao.maps.event.addListener(marker, 'dragend', () => {
        const ll = marker.getPosition();
        setCoord(ll.getLat(), ll.getLng(), false);
      });
    } else {
      OC.kakaoError(document.getElementById('editMap'));
    }

    // 담당 파트너
    async function renderManagers() {
      const box = document.getElementById('managerBox');
      if (!box) return;
      try {
        const [rows, users] = await Promise.all([
          sb.from('place_managers').select('user_id').eq('place_id', p.id).then(unwrap),
          loadUsers(),
        ]);
        const ids = new Set(rows.map((r) => r.user_id));
        const name = (u) => `${esc(u.nickname || '(이름 없음)')} · ${u.id.slice(0, 8)}`;
        const others = users.filter((u) => !ids.has(u.id));
        box.innerHTML = `
          <ul class="space-y-1">
            ${rows.length ? users.filter((u) => ids.has(u.id)).map((u) => `
              <li class="flex items-center justify-between gap-2 text-ink"><span>👤 ${name(u)}</span><button type="button" data-unassign="${u.id}" class="link-btn text-red-600">해제</button></li>`).join('') : '<li class="text-stone-500">지정된 파트너가 없어요.</li>'}
          </ul>
          ${others.length ? `
          <div class="mt-3 flex gap-2">
            <select data-assign-select class="input">${others.map((u) => `<option value="${u.id}">${name(u)}${u.role === 'admin' ? ' (관리자)' : ''}</option>`).join('')}</select>
            <button type="button" data-act="assign" class="btn btn-outline shrink-0">지정</button>
          </div>` : ''}`;
      } catch (e) {
        box.textContent = '불러오지 못했어요: ' + e.message;
      }
    }
    if (!isNew) renderManagers();

    ov.addEventListener('click', async (e) => {
      if (e.target === ov || e.target.closest('[data-close]')) return ov.remove();
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        const k = JSON.parse(pick.dataset.pick);
        f.namedItem('kakao_place_id').value = k.id;
        document.getElementById('kakaoLink').innerHTML = `<a class="underline" target="_blank" rel="noopener" href="https://place.map.kakao.com/${esc(k.id)}">연결됨 (${esc(k.id)})</a>`;
        if (!val('phone') && k.phone) f.namedItem('phone').value = k.phone;
        setCoord(k.lat, k.lng, true);
        document.getElementById('kakaoResults').innerHTML = '';
        return;
      }
      const unassign = e.target.closest('[data-unassign]');
      if (unassign) {
        try {
          unwrap(await sb.from('place_managers').delete().eq('place_id', p.id).eq('user_id', unassign.dataset.unassign));
          renderManagers();
        } catch (ex) {
          OC.toast('해제하지 못했어요: ' + ex.message);
        }
        return;
      }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'geocode') {
        if (!state.kakaoOk) return fail('카카오맵을 불러오지 못해 위치를 찾을 수 없어요.');
        act.disabled = true;
        const loc = await resolveLocation({ name: val('name'), address: val('address'), floor: val('building') });
        act.disabled = false;
        if (!loc.coord) return fail('주소로 위치를 찾지 못했어요. 도로명 주소로 다시 입력해 보세요.');
        fail('');
        setCoord(loc.coord.lat, loc.coord.lng, true);
        if (loc.place && !f.namedItem('kakao_place_id').value) {
          f.namedItem('kakao_place_id').value = loc.place.id;
          document.getElementById('kakaoLink').innerHTML = `<a class="underline" target="_blank" rel="noopener" href="https://place.map.kakao.com/${esc(loc.place.id)}">연결됨 (${esc(loc.place.id)})</a>`;
        }
        OC.toast(`📍 ${VIA_LABEL[loc.via]}${loc.building ? ` (${loc.building.place_name})` : ''}로 옮겼어요${loc.via === 'address' ? ' — 마커를 끌어 정확히 맞춰 주세요' : ''}`);
      }
      if (act.dataset.act === 'kakao-find') {
        if (!state.kakaoOk) return fail('카카오맵을 불러오지 못했어요.');
        const box = document.getElementById('kakaoResults');
        box.innerHTML = '<p class="text-sm text-stone-400">찾는 중…</p>';
        const list = await keywordSearch(val('name'), { location: { lat: +f.namedItem('lat').value, lng: +f.namedItem('lng').value }, radius: 2000 });
        box.innerHTML = list.length
          ? list.slice(0, 6).map((k) => `
              <button type="button" data-pick='${esc(JSON.stringify({ id: k.id, phone: k.phone, lat: +k.y, lng: +k.x }))}' class="w-full text-left rounded-xl bg-white border border-stone-200 px-3 py-2 hover:border-brand-400">
                <b>${esc(k.place_name)}</b> <span class="text-xs text-stone-500">${esc(k.category_name)}</span><br>
                <span class="text-sm text-stone-500">${esc(k.road_address_name || k.address_name)} · ${k.distance}m</span>
              </button>`).join('')
          : '<p class="text-sm text-stone-500">근처 2km 안에서 찾지 못했어요.</p>';
      }
      if (act.dataset.act === 'kakao-clear') {
        f.namedItem('kakao_place_id').value = '';
        document.getElementById('kakaoLink').innerHTML = '<span class="text-stone-500">미연결</span>';
      }
      if (act.dataset.act === 'assign') {
        const userId = ov.querySelector('[data-assign-select]').value;
        try {
          unwrap(await sb.from('place_managers').insert({ place_id: p.id, user_id: userId }));
          const u = state.users.find((x) => x.id === userId);
          if (u && u.role === 'user') {
            unwrap(await sb.from('profiles').update({ role: 'partner' }).eq('id', userId));
            u.role = 'partner';
          }
          renderManagers();
          OC.toast('파트너로 지정했어요');
        } catch (ex) {
          OC.toast('지정하지 못했어요: ' + ex.message);
        }
      }
      if (act.dataset.act === 'delete') {
        if (!confirm(`${p.name}을(를) 삭제할까요? 식단·후기·나눔 기록도 함께 지워져요.`)) return;
        try {
          unwrap(await sb.from('places').delete().eq('id', p.id));
          state.places = state.places.filter((x) => x.id !== p.id);
          ov.remove();
          render();
          OC.toast('삭제했어요');
        } catch (ex) {
          fail(/foreign key|violates/.test(ex.message) ? '이용권 기록이 있어 삭제할 수 없어요. 상태를 "숨김"으로 바꿔 주세요.' : '삭제하지 못했어요: ' + ex.message);
        }
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      fail('');
      const num = (n) => (val(n) === '' ? null : Number(val(n)));
      const time = (n) => val(n) || null;
      const payload = {
        name: val('name'),
        short_name: val('short_name') || null,
        type: val('type'),
        status: val('status'),
        address: val('address'),
        building: val('building') || null,
        phone: val('phone') || null,
        lat: Number(f.namedItem('lat').value),
        lng: Number(f.namedItem('lng').value),
        kakao_place_id: f.namedItem('kakao_place_id').value || null,
        price: num('price'),
        capacity: num('capacity'),
        operator: val('operator') || null,
        lunch_start: time('lunch_start'),
        lunch_end: time('lunch_end'),
        dinner_start: time('dinner_start'),
        dinner_end: time('dinner_end'),
        saturday: f.namedItem('saturday').checked,
        ticket_on_sale: f.namedItem('ticket_on_sale').checked,
        public_note: val('public_note') || null,
        tags: val('tags').split(/[,;]/).map((t) => t.trim()).filter(Boolean),
        description: val('description') || null,
      };
      if (!payload.name || !payload.address) return fail('이름과 주소는 꼭 입력해 주세요.');
      if (!payload.lunch_start !== !payload.lunch_end) return fail('중식 시작·종료 시간을 둘 다 입력하거나 둘 다 비워 주세요.');
      if (!payload.dinner_start !== !payload.dinner_end) return fail('석식 시작·종료 시간을 둘 다 입력하거나 둘 다 비워 주세요.');
      if (payload.status === 'verified' && (!payload.price || !payload.lunch_start) && !confirm('가격 또는 중식 시간이 비어 있어요. 그래도 승인 상태로 저장할까요?')) return;
      const btn = form.querySelector('button:not([type])');
      btn.disabled = true;
      try {
        if (isNew) {
          const row = unwrap(await sb.from('places').insert({ ...payload, source: 'manual' }).select().single());
          state.places.unshift(row);
        } else {
          const row = unwrap(await sb.from('places').update(payload).eq('id', p.id).select().single());
          Object.assign(state.places.find((x) => x.id === p.id), row);
        }
        ov.remove();
        render();
        OC.toast('저장했어요');
      } catch (ex) {
        btn.disabled = false;
        fail(/duplicate|unique/.test(ex.message) ? '이미 다른 식당에 연결된 카카오 장소예요.' : '저장하지 못했어요: ' + ex.message);
      }
    });
  }

  /* ================= 2. CSV 업로드 ================= */
  function csvHtml() {
    const c = state.csv;
    const rows = c.rows;
    const okRows = rows ? rows.filter((r) => r.include) : [];
    return `
      <section class="card p-6">
        <h2 class="text-xl font-extrabold">CSV로 한 번에 등록</h2>
        <p class="mt-1 text-stone-600">템플릿에 맞춰 작성한 CSV를 올리면 주소로 좌표를 찾고 카카오 장소를 연결한 뒤 <b>후보</b>로 등록해요.</p>
        <div class="mt-4 flex flex-col sm:flex-row gap-3 sm:items-center">
          <label class="btn btn-primary cursor-pointer">📄 CSV 파일 선택<input id="csvFile" type="file" accept=".csv,text/csv" class="hidden"></label>
          <a href="data/places_template.csv" download class="link-btn">템플릿 내려받기</a>
          <label class="sm:ml-auto flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" id="autoApprove" ${c.autoApprove ? 'checked' : ''}> 메모에 "미확인"이 없고 가격·시간이 있는 행은 바로 승인
          </label>
        </div>
        ${c.progress ? `<p class="mt-4 font-semibold text-brand-700">${esc(c.progress)}</p>` : ''}
      </section>
      ${rows ? `
      <section class="mt-6 card p-0 overflow-hidden">
        <div class="p-4 flex flex-wrap items-center gap-3 border-b border-stone-100">
          <b>검토 결과 ${rows.length}행</b>
          <span class="badge badge-open">정상 ${rows.filter((r) => r.level === 'ok').length}</span>
          <span class="badge badge-brand">확인 필요 ${rows.filter((r) => r.level === 'warn').length}</span>
          <span class="badge">중복 제외 ${rows.filter((r) => r.level === 'dup').length}</span>
          <span class="badge bg-red-50 text-red-700">오류 ${rows.filter((r) => r.level === 'error').length}</span>
          <button data-act="csv-import" class="btn btn-green ml-auto" ${okRows.length && !c.progress ? '' : 'disabled'}>선택한 ${okRows.length}개 등록</button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm min-w-[760px]">
            <thead class="bg-stone-50 text-stone-500"><tr>
              <th class="p-3 w-10">등록</th><th class="p-3 text-left">행</th><th class="p-3 text-left">이름 · 유형</th><th class="p-3 text-left">주소 → 위치</th><th class="p-3 text-left">카카오 장소</th><th class="p-3 text-left">검토</th>
            </tr></thead>
            <tbody>
              ${rows.map((r, i) => `
                <tr class="border-t border-stone-100 align-top ${r.level === 'error' ? 'bg-red-50/40' : r.level === 'dup' ? 'bg-stone-50 text-stone-400' : ''}">
                  <td class="p-3 text-center"><input type="checkbox" data-include="${i}" ${r.include ? 'checked' : ''} ${r.level === 'error' || r.level === 'dup' ? 'disabled' : ''}></td>
                  <td class="p-3 text-stone-400">${r.line}</td>
                  <td class="p-3"><b>${esc(r.name || '-')}</b>${r.level === 'dup' ? ' <span class="badge">중복</span>' : ''}<br><span class="text-stone-500">${r.payload ? OC.TYPE[r.payload.type] : esc(r.typeRaw || '-')}</span></td>
                  <td class="p-3">${esc(r.address || '-')}${r.loc && r.loc.coord ? `<br><span class="text-xs ${r.loc.via === 'address' ? 'text-brand-700' : 'text-green-700'}">📍 ${VIA_LABEL[r.loc.via]}${r.loc.building ? ` · ${esc(r.loc.building.place_name)}` : ''}</span>
                    <a class="text-xs underline text-stone-500 ml-1" target="_blank" rel="noopener" href="https://map.kakao.com/link/map/${encodeURIComponent(r.name)},${r.loc.coord.lat},${r.loc.coord.lng}">지도 확인</a>` : ''}</td>
                  <td class="p-3">${r.kakao ? `<a class="underline" target="_blank" rel="noopener" href="${esc(r.kakao.place_url)}">${esc(r.kakao.place_name)}</a>` : '<span class="text-stone-400">미연결</span>'}</td>
                  <td class="p-3">${r.pending ? '<span class="text-stone-400">확인 중…</span>' : r.issues.length ? r.issues.map((x) => `<p class="${x.level === 'error' ? 'text-red-700' : x.level === 'dup' ? 'text-stone-500' : 'text-brand-700'}">${{ error: '❌', dup: '⏭️' }[x.level] || '⚠️'} ${esc(x.msg)}</p>`).join('') : '<span class="text-green-700">✅ 정상</span>'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>` : ''}`;
  }

  // 따옴표·줄바꿈을 처리하는 CSV 파서
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') {
          field += '"';
          i++;
        } else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else field += c;
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }
  // UTF-8로 읽고, 깨지면 엑셀 기본(EUC-KR)으로 다시 읽기
  async function readText(file) {
    const buf = await file.arrayBuffer();
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
      return new TextDecoder('euc-kr').decode(buf);
    }
  }
  // "11:00", "11:00:00", "오전 11:00", "11:00 AM", 엑셀 소수(0.4583) 모두 HH:MM으로
  function parseTime(v) {
    v = String(v || '').trim();
    if (!v) return { value: null };
    if (/^0?\.\d+$/.test(v)) {
      const mins = Math.round(Number(v) * 24 * 60);
      return { value: `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}` };
    }
    const m = v.match(/^(오전|오후)?\s*(\d{1,2})[:시]\s*(\d{2})?(?::\d{2})?\s*(분)?\s*(AM|PM)?$/i);
    if (!m) return { error: true };
    let h = Number(m[2]);
    const min = Number(m[3] || 0);
    const pm = m[1] === '오후' || /pm/i.test(m[5] || '');
    const am = m[1] === '오전' || /am/i.test(m[5] || '');
    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;
    if (h > 23 || min > 59) return { error: true };
    return { value: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` };
  }
  const yes = (v) => /^(o|y|yes|예|네|true|1|운영|판매)$/i.test(String(v || '').trim());

  async function handleCSV(file) {
    const c = state.csv;
    if (!state.kakaoOk) return OC.toast('카카오맵을 불러오지 못해 좌표를 찾을 수 없어요.');
    const table = parseCSV(await readText(file)).filter((r) => r.some((v) => v.trim() !== ''));
    if (table.length < 2) return OC.toast('내용이 있는 행이 없어요.');
    const header = table[0].map((h) => h.trim());
    const idx = Object.fromEntries(header.map((h, i) => [h, i]));
    const required = ['이름', '유형', '주소'];
    const missing = required.filter((h) => !(h in idx));
    if (missing.length) return OC.toast(`템플릿 칼럼이 없어요: ${missing.join(', ')}`);

    c.rows = table.slice(1).map((cells, i) => {
      const get = (h) => (h in idx ? String(cells[idx[h]] || '').trim() : '');
      return { line: i + 2, get, name: get('이름'), typeRaw: get('유형'), address: get('주소'), issues: [], level: 'ok', include: false, pending: true, kakao: null, payload: null };
    });
    render();

    // 이미 DB에 있는 식당(카카오 ID 또는 이름+주소가 같음)과 CSV 안의 반복 행은 업로드에서 제외
    const existing = {
      byKakao: new Map(state.places.filter((p) => p.kakao_place_id).map((p) => [p.kakao_place_id, p])),
      byNameAddr: new Map(state.places.map((p) => [placeKey(p), p])),
    };
    const seenIds = new Set(); // CSV 안에서 이미 나온 카카오 ID와 이름+주소
    for (let i = 0; i < c.rows.length; i++) {
      const r = c.rows[i];
      c.progress = `확인 중… ${i + 1} / ${c.rows.length}`;
      if (state.tab === 'csv') render();
      await checkRow(r, existing, seenIds);
      r.pending = false;
    }
    c.progress = null;
    render();
  }

  async function checkRow(r, existing, seenIds) {
    const err = (msg) => r.issues.push({ level: 'error', msg });
    const warn = (msg) => r.issues.push({ level: 'warn', msg });
    const g = r.get;
    const type = TYPE_FROM[r.typeRaw.replace(/\s/g, '')];

    if (/^\(?예시\)?/.test(r.name)) err('템플릿 예시 행이에요');
    if (!r.name) err('이름이 비어 있어요');
    if (!type) err('유형은 "구내식당" 또는 "한식뷔페"로 적어 주세요');
    if (!r.address) err('주소가 비어 있어요');

    const price = g('가격').replace(/[^\d]/g, '');
    const times = ['중식시작', '중식종료', '석식시작', '석식종료'].map((h) => {
      const t = parseTime(g(h));
      if (t.error) err(`${h} "${g(h)}"을(를) 시간으로 읽지 못했어요`);
      return t.value || null;
    });
    if (!times[0] !== !times[1]) err('중식 시작·종료를 둘 다 적어 주세요');
    if (!times[2] !== !times[3]) err('석식 시작·종료를 둘 다 적어 주세요');
    if (!times[0]) warn('중식 시간이 없어요');
    if (!price) warn('가격이 없어요');
    if (type === 'cafeteria' && !g('외부인입장조건')) warn('구내식당인데 외부인 입장 조건이 없어요');
    const unverified = /미확인/.test(g('메모'));
    if (unverified) warn('메모에 "미확인" → 후보로만 등록');

    // 오류가 있으면 카카오 조회 생략
    if (r.issues.some((x) => x.level === 'error')) {
      r.level = 'error';
      return;
    }
    // 중복이면 카카오 조회 없이 바로 제외
    const key = norm(r.name) + '|' + norm(r.address);
    const dup = (msg) => {
      r.issues = [{ level: 'dup', msg }];
      r.level = 'dup';
    };
    if (existing.byNameAddr.has(key)) return dup('이미 등록된 식당 → 업로드에서 제외');
    if (seenIds.has(key)) return dup('CSV 안에 같은 식당이 또 있어요 → 제외');
    seenIds.add(key);

    // 주소 → 같은 주소 안의 건물 → 식당 카카오 장소 순서로 위치 결정
    const loc = await resolveLocation({ name: r.name, address: r.address, building: g('건물명'), floor: g('층·위치') });
    loc.notes.forEach((n) => r.issues.push(n));
    r.loc = loc;
    if (loc.place) {
      r.kakao = loc.place;
      if (existing.byKakao.has(loc.place.id)) return dup(`이미 등록된 식당(${existing.byKakao.get(loc.place.id).name})과 같은 카카오 장소 → 제외`);
      if (seenIds.has('k:' + loc.place.id)) return dup('CSV 안에 같은 카카오 장소가 또 있어요 → 제외');
      seenIds.add('k:' + loc.place.id);
    }
    if (!loc.coord) err('주소로 위치를 찾지 못했어요. 도로명 주소로 고쳐 주세요');
    const lat = loc.coord ? loc.coord.lat : null;
    const lng = loc.coord ? loc.coord.lng : null;

    r.level = r.issues.some((x) => x.level === 'error') ? 'error' : r.issues.length ? 'warn' : 'ok';
    if (r.level === 'error') return;

    r.payload = {
      type,
      name: r.name,
      // 템플릿 예시 값(OO뷔페 등)이 남아 있으면 무시하고 식당 이름 그대로 표시
      short_name: /OO|예시/i.test(g('지도표시이름')) ? null : g('지도표시이름') || null,
      // 건물명 + 층·위치 (층·위치에 이미 건물명이 있으면 그대로)
      building: (g('건물명') && g('층·위치') && !g('층·위치').includes(g('건물명')) ? `${g('건물명')} ${g('층·위치')}` : g('층·위치') || g('건물명')) || null,
      address: r.address,
      lat,
      lng,
      kakao_place_id: r.kakao ? r.kakao.id : null,
      phone: g('전화번호') || (r.kakao && r.kakao.phone) || null,
      price: price ? Number(price) : null,
      lunch_start: times[0],
      lunch_end: times[1],
      dinner_start: times[2],
      dinner_end: times[3],
      saturday: yes(g('토요일운영')),
      public_note: g('외부인입장조건') || null,
      operator: g('운영업체') || null,
      capacity: Number(g('하루식수').replace(/[^\d]/g, '')) || null,
      ticket_on_sale: yes(g('이용권판매')),
      tags: g('태그').split(/[;,]/).map((t) => t.trim()).filter(Boolean),
      description: g('소개') || null,
      source: 'manual',
      status: 'candidate',
    };
    r.canApprove = !unverified && r.payload.price && r.payload.lunch_start;
    r.include = true;
  }

  async function importCSV() {
    const c = state.csv;
    const rows = c.rows.filter((r) => r.include && r.payload);
    const skipped = c.rows.filter((r) => r.level === 'dup').length;
    const payloads = rows.map((r) => ({ ...r.payload, status: c.autoApprove && r.canApprove ? 'verified' : 'candidate' }));
    c.progress = `${payloads.length}개 등록 중…`;
    render();
    try {
      const inserted = unwrap(await sb.from('places').insert(payloads).select());
      const approved = inserted.filter((p) => p.status === 'verified').length;
      state.places = [...inserted, ...state.places];
      c.rows = null;
      c.progress = null;
      state.tab = 'places';
      state.filter.status = 'all';
      render();
      OC.toast(`${inserted.length}개 등록했어요 (승인 ${approved}, 후보 ${inserted.length - approved})${skipped ? ` · 중복 ${skipped}개 제외` : ''}`);
    } catch (err) {
      c.progress = null;
      render();
      OC.toast('등록하지 못했어요: ' + err.message);
    }
  }

  /* ================= 3. 카카오 검색 추가 ================= */
  function searchHtml() {
    const s = state.search;
    const ids = kakaoIds();
    const guessType = (k) => (/뷔페/.test(k.category_name) ? 'buffet' : 'cafeteria');
    return `
      <section class="card p-6">
        <h2 class="text-xl font-extrabold">카카오에서 찾아 후보로 추가</h2>
        <p class="mt-1 text-stone-600">${CENTER.label} 기준으로 검색해요. 추가한 뒤 "식당 목록"에서 가격·시간을 채우고 승인하세요.</p>
        <form id="searchForm" class="mt-4 flex flex-col sm:flex-row gap-2">
          <input name="q" class="input" placeholder="예: 구내식당, 한식뷔페, 식당 이름" value="${esc(s.q)}">
          <select name="radius" class="input sm:w-36">${[[1000, '1km'], [2000, '2km'], [5000, '5km'], [20000, '20km']].map(([v, l]) => `<option value="${v}" ${s.radius === v ? 'selected' : ''}>반경 ${l}</option>`).join('')}</select>
          <button class="btn btn-primary shrink-0 px-6">검색</button>
        </form>
        <div class="mt-3 flex flex-wrap gap-2">
          ${['구내식당', '직원식당', '한식뷔페', '기사식당', '학생식당'].map((k) => `<button data-quick="${k}" class="chip">${k}</button>`).join('')}
        </div>
      </section>
      <div class="mt-6 space-y-2">
        ${s.loading ? '<p class="text-stone-400">찾는 중…</p>' : !s.results ? '' : s.results.length ? `
          <p class="text-sm text-stone-500">${s.results.length}곳 (최대 45곳까지 보여요)</p>
          ${s.results.map((k) => `
            <div class="card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div class="flex-1 min-w-0">
                <p class="font-extrabold">${esc(k.place_name)} <span class="text-xs font-normal text-stone-500">${esc(k.category_name)}</span></p>
                <p class="text-sm text-stone-500">${esc(k.road_address_name || k.address_name)}${k.phone ? ` · ${esc(k.phone)}` : ''} · ${k.distance}m</p>
                <a class="text-xs underline text-stone-500" target="_blank" rel="noopener" href="${esc(k.place_url)}">카카오맵에서 보기</a>
              </div>
              ${ids.has(k.id) ? '<span class="badge badge-open shrink-0">등록됨</span>' : `
              <div class="flex gap-2 shrink-0">
                <select data-type-for="${k.id}" class="input w-32"><option value="cafeteria" ${guessType(k) === 'cafeteria' ? 'selected' : ''}>구내식당</option><option value="buffet" ${guessType(k) === 'buffet' ? 'selected' : ''}>한식뷔페</option></select>
                <button data-add="${k.id}" class="btn btn-green">후보로 추가</button>
              </div>`}
            </div>`).join('')}` : '<div class="card p-10 text-center text-stone-500">검색 결과가 없어요.</div>'}
      </div>`;
  }
  async function runSearch() {
    const s = state.search;
    if (!s.q.trim()) return;
    if (!state.kakaoOk) return OC.toast('카카오맵을 불러오지 못했어요.');
    s.loading = true;
    render();
    s.results = await keywordSearch(s.q.trim(), { location: CENTER, radius: s.radius, pages: 3 });
    s.loading = false;
    render();
  }
  async function addFromSearch(id, btn) {
    const k = state.search.results.find((x) => x.id === id);
    const type = content.querySelector(`[data-type-for="${id}"]`).value;
    btn.disabled = true;
    try {
      const row = unwrap(await sb.from('places').insert({
        type,
        name: k.place_name,
        address: k.road_address_name || k.address_name,
        lat: +k.y,
        lng: +k.x,
        phone: k.phone || null,
        kakao_place_id: k.id,
        source: 'search',
        status: 'candidate',
      }).select().single());
      state.places.unshift(row);
      render();
      OC.toast(`${k.place_name}을(를) 후보로 추가했어요`);
    } catch (err) {
      btn.disabled = false;
      OC.toast('추가하지 못했어요: ' + err.message);
    }
  }

  /* ================= 4. 제보 ================= */
  function reportsHtml() {
    if (!state.reports.length) return '<div class="card p-10 text-center text-stone-500">아직 들어온 제보가 없어요.</div>';
    return `<div class="space-y-3">${state.reports.map((r) => {
      const [sl, sc] = REPORT_STATUS[r.status];
      const place = r.place_id && state.places.find((p) => p.id === r.place_id);
      return `
        <article class="card p-5">
          <div class="flex flex-wrap items-center gap-2">
            <span class="badge ${sc}">${sl}</span><span class="badge">${REPORT_KIND[r.kind]}</span>
            <b>${esc(place ? place.name : r.place_name || '(이름 없음)')}</b>
            <span class="text-sm text-stone-400 ml-auto">${OC.fmtDate(OC.ymd(new Date(r.created_at)))}</span>
          </div>
          ${r.address ? `<p class="mt-1 text-sm text-stone-500">📍 ${esc(r.address)}</p>` : ''}
          <p class="mt-2 whitespace-pre-line">${esc(r.content)}</p>
          <div class="mt-3 flex flex-wrap gap-2">
            ${place ? `<button data-edit="${place.id}" class="btn btn-outline">식당 편집</button>` : ''}
            ${r.kind === 'new_place' ? `<button data-search-for="${esc(r.place_name || '')}" class="btn btn-outline">카카오에서 찾기</button>` : ''}
            ${r.status === 'open' ? `
              <button data-report="${r.id}" data-to="accepted" class="btn btn-green">반영 완료</button>
              <button data-report="${r.id}" data-to="rejected" class="btn btn-ghost">거절</button>` : ''}
          </div>
        </article>`;
    }).join('')}</div>`;
  }
  async function setReportStatus(id, status) {
    try {
      unwrap(await sb.from('reports').update({ status }).eq('id', id));
      await loadReports();
      render();
    } catch (err) {
      OC.toast('변경하지 못했어요: ' + err.message);
    }
  }

  /* ================= 이벤트 ================= */
  content.addEventListener('click', (e) => {
    const t = e.target;
    const status = t.closest('[data-status]');
    if (status) {
      state.filter.status = status.dataset.status;
      state.selected.clear();
      return render();
    }
    const bulk = t.closest('[data-bulk]');
    if (bulk && !bulk.disabled) {
      if (bulk.dataset.bulk === 'delete') {
        const ids = selectedIds();
        return deletePlaces(ids, `선택한 ${ids.length}개 식당을 삭제할까요?
식단·후기·나눔 기록도 함께 지워지고 되돌릴 수 없어요.`);
      }
      return bulkStatus(bulk.dataset.bulk);
    }
    if (t.closest('[data-act="dedupe"]')) {
      const ids = duplicatesToRemove();
      return deletePlaces(ids, `중복 ${ids.length}개를 삭제할까요?
같은 식당 중 승인된 것(없으면 먼저 등록된 것) 하나씩만 남아요. 되돌릴 수 없어요.`);
    }
    const edit = t.closest('[data-edit]');
    if (edit) return openEditor(state.places.find((p) => p.id === Number(edit.dataset.edit)));
    const set = t.closest('[data-set-status]');
    if (set) return setStatus(Number(set.dataset.id), set.dataset.setStatus);
    if (t.closest('[data-act="new"]')) return openEditor(null);
    if (t.closest('[data-act="csv-import"]')) return importCSV();
    const quick = t.closest('[data-quick]');
    if (quick) {
      state.search.q = quick.dataset.quick;
      return runSearch();
    }
    const add = t.closest('[data-add]');
    if (add) return addFromSearch(add.dataset.add, add);
    const rep = t.closest('[data-report]');
    if (rep) return setReportStatus(Number(rep.dataset.report), rep.dataset.to);
    const sf = t.closest('[data-search-for]');
    if (sf) {
      state.tab = 'search';
      state.search.q = sf.dataset.searchFor;
      return runSearch();
    }
  });
  content.addEventListener('input', (e) => {
    if (e.target.id === 'placeSearch') {
      state.filter.q = e.target.value;
      state.selected.clear();
      renderPlaceRows();
    }
  });
  content.addEventListener('change', (e) => {
    if (e.target.id === 'csvFile' && e.target.files[0]) handleCSV(e.target.files[0]);
    if (e.target.dataset.check !== undefined) {
      const id = Number(e.target.dataset.check);
      if (e.target.checked) state.selected.add(id);
      else state.selected.delete(id);
      e.target.closest('.card').classList.toggle('ring-2', e.target.checked);
      e.target.closest('.card').classList.toggle('ring-brand-400', e.target.checked);
      renderBulkBar();
    }
    if (e.target.id === 'checkAll') {
      filteredPlaces().forEach((p) => (e.target.checked ? state.selected.add(p.id) : state.selected.delete(p.id)));
      renderPlaceRows();
    }
    if (e.target.id === 'autoApprove') state.csv.autoApprove = e.target.checked;
    if (e.target.dataset.include !== undefined) {
      state.csv.rows[Number(e.target.dataset.include)].include = e.target.checked;
      render();
    }
  });
  content.addEventListener('submit', (e) => {
    if (e.target.id !== 'searchForm') return;
    e.preventDefault();
    state.search.q = e.target.elements.namedItem('q').value;
    state.search.radius = Number(e.target.elements.namedItem('radius').value);
    runSearch();
  });

  /* ================= 시작 ================= */
  OC.ready
    .then(async () => {
      if (!OC.user()) {
        gate.innerHTML = `
          <div class="card p-10 text-center max-w-xl mx-auto">
            <p class="text-4xl">🔐</p><p class="mt-3 font-bold">관리자 로그인이 필요해요</p>
            <button id="loginBtn" class="btn mt-5 bg-[#FEE500] text-[#191919]">카카오로 시작하기</button>
          </div>`;
        document.getElementById('loginBtn').addEventListener('click', OC.signIn);
        return;
      }
      if (!OC.isAdmin()) {
        gate.innerHTML = '<div class="card p-10 text-center max-w-xl mx-auto"><p class="text-4xl">🚫</p><p class="mt-3 font-bold">관리자만 볼 수 있는 화면이에요</p></div>';
        return;
      }
      await Promise.all([
        loadPlaces(),
        loadReports(),
        OC.kakaoReady().then(() => (state.kakaoOk = true), () => (state.kakaoOk = false)),
      ]);
      gate.classList.add('hidden');
      appEl.classList.remove('hidden');
      render();
    })
    .catch((err) => OC.loadError(gate, err));
})();
