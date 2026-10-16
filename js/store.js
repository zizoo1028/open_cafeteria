/* 공통 유틸 + Supabase 데이터 계층
 * - OC.ready: 페이지 시작 시 로그인 상태·식당·통계·이번 주 식단을 한 번에 불러옴
 * - 화면용 조회 함수(restaurants, menu, rating 등)는 캐시를 읽는 동기 함수
 * - 쓰기·개인 데이터(후기, 이용권, 나눔, 파트너)는 async 함수
 */
window.OC = (function () {
  const CFG = window.OC_CONFIG;
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  const KEY = { bigText: 'oc_big_text' };
  const MEAL = { lunch: '중식', dinner: '석식' };
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const TYPE = { cafeteria: '구내식당', buffet: '한식뷔페' };

  const cache = { places: [], stats: new Map(), menus: new Map(), user: null, profile: null };

  /* ---------- 브라우저 저장소 (큰 글씨 설정 등 개인 편의용) ---------- */
  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }

  /* ---------- 날짜·형식 ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function parseYmd(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }
  const today = () => ymd(new Date());
  const daysFromToday = (n) => ymd(addDays(new Date(), n));
  function fmtDate(s) {
    const d = parseYmd(s);
    return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
  }
  const won = (n) => Number(n || 0).toLocaleString('ko-KR') + '원';
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  const qs = (name) => new URLSearchParams(location.search).get(name);
  const toMin = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const hhmm = (t) => (t ? t.slice(0, 5) : null);

  // Supabase 응답에서 오류면 throw (RPC의 한국어 오류 메시지를 그대로 사용)
  function unwrap({ data, error }) {
    if (error) throw new Error(error.message || '요청을 처리하지 못했어요');
    return data;
  }

  /* ---------- 식당 ---------- */
  function mapPlace(p) {
    return {
      id: p.id,
      type: p.type,
      kakaoPlaceId: p.kakao_place_id,
      name: p.name,
      short: p.short_name || p.name, // 지도 말풍선 이름: 따로 정하지 않으면 식당 이름 그대로
      building: p.building || '',
      address: p.address,
      lat: p.lat,
      lng: p.lng,
      phone: p.phone,
      price: p.price || 0,
      hours: {
        lunch: p.lunch_start ? [hhmm(p.lunch_start), hhmm(p.lunch_end)] : null,
        dinner: p.dinner_start ? [hhmm(p.dinner_start), hhmm(p.dinner_end)] : null,
      },
      saturday: p.saturday,
      publicNote: p.public_note || '',
      operator: p.operator || '',
      capacity: p.capacity,
      ticketOnSale: p.ticket_on_sale,
      tags: p.tags || [],
      desc: p.description || '',
      menuUrl: safeUrl(p.menu_url),
      status: p.status,
    };
  }
  const restaurants = () => cache.places;
  const restaurant = (id) => cache.places.find((r) => r.id === Number(id));
  const priceTier = (r) => (r.price <= 6000 ? 'low' : r.price <= 8000 ? 'mid' : 'high');
  const subtitle = (r) => [TYPE[r.type], r.building].filter(Boolean).join(' · ');

  function opensOn(r, d) {
    const w = d.getDay();
    if (w === 0) return false;
    if (w === 6) return !!r.saturday;
    return true;
  }
  function mealsOn(r, d) {
    if (!opensOn(r, d)) return [];
    const out = [];
    if (r.hours.lunch) out.push('lunch');
    if (r.hours.dinner && d.getDay() !== 6) out.push('dinner');
    return out;
  }
  // 오늘 날짜라면 이미 끝난 식사는 제외
  function bookableMeals(r, date) {
    const meals = mealsOn(r, parseYmd(date));
    if (date !== today()) return meals;
    const now = new Date();
    const m = now.getHours() * 60 + now.getMinutes();
    return meals.filter((meal) => m < toMin(r.hours[meal][1]));
  }
  function status(r, now = new Date()) {
    if (!opensOn(r, now)) return { open: false, label: '오늘 휴무' };
    const m = now.getHours() * 60 + now.getMinutes();
    const meals = mealsOn(r, now);
    for (const meal of meals) {
      const [s, e] = r.hours[meal];
      if (m >= toMin(s) && m < toMin(e)) return { open: true, label: `${MEAL[meal]} 운영 중 · ${e} 마감` };
    }
    for (const meal of meals) {
      const [s] = r.hours[meal];
      if (m < toMin(s)) return { open: false, label: `${MEAL[meal]} ${s} 시작` };
    }
    return { open: false, label: '오늘 운영 종료' };
  }
  function statusBadge(r) {
    const st = status(r);
    return `<span class="badge ${st.open ? 'badge-open' : ''}">${st.open ? '● ' : ''}${esc(st.label)}</span>`;
  }
  function hoursText(r) {
    const parts = [];
    if (r.hours.lunch) parts.push(`중식 ${r.hours.lunch[0]}~${r.hours.lunch[1]}`);
    if (r.hours.dinner) parts.push(`석식 ${r.hours.dinner[0]}~${r.hours.dinner[1]}`);
    return (parts.join(' · ') || '운영시간 미등록') + (r.saturday ? ' (토요일 중식 운영)' : ' (주말 휴무)');
  }
  function nextOpenDate(r, from = new Date(), skipToday = false) {
    for (let i = skipToday ? 1 : 0; i < 10; i++) {
      const d = addDays(from, i);
      if (mealsOn(r, d).length) return ymd(d);
    }
    return null;
  }
  const kakaoDirections = (r) =>
    r.kakaoPlaceId ? `https://map.kakao.com/link/to/${r.kakaoPlaceId}` : `https://map.kakao.com/link/to/${encodeURIComponent(r.name)},${r.lat},${r.lng}`;
  const kakaoPlaceUrl = (r) => (r.kakaoPlaceId ? `https://place.map.kakao.com/${r.kakaoPlaceId}` : null);
  // 카카오맵: 장소가 연결돼 있으면 장소 페이지, 아니면 좌표에 핀을 꽂은 지도
  const kakaoMapUrl = (r) => kakaoPlaceUrl(r) || `https://map.kakao.com/link/map/${encodeURIComponent(r.name)},${r.lat},${r.lng}`;
  // 네이버 지도: API 없이 검색 링크 (같은 이름이 많을 수 있어 시·구를 함께 검색)
  const naverMapUrl = (r) => `https://map.naver.com/p/search/${encodeURIComponent(`${r.name} ${r.address.split(' ').slice(0, 2).join(' ')}`)}`;
  // 외부 링크는 http(s)만 허용 (javascript: 등 차단)
  function safeUrl(u) {
    return typeof u === 'string' && /^https?:\/\/\S+$/i.test(u.trim()) ? u.trim() : null;
  }
  // 식당 카드·상세에 쓰는 "외부에서 보기" 링크 묶음
  function externalLinksHtml(r, cls = '') {
    const a = (href, label) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" class="link-btn">${label} ↗</a>`;
    return `<div class="flex flex-wrap items-center gap-1 text-sm ${cls}"><span class="text-stone-400 mr-1">외부에서 보기</span>${a(kakaoMapUrl(r), '카카오맵')}${a(naverMapUrl(r), '네이버 지도')}</div>`;
  }
  // "식단표 페이지로 이동" 큰 버튼 (링크가 있을 때만)
  const menuPageButton = (r, cls = '') =>
    r.menuUrl
      ? `<a href="${esc(r.menuUrl)}" target="_blank" rel="noopener noreferrer" class="btn w-full bg-green-50 text-green-800 border border-green-200 hover:bg-green-100 ${cls}">식단표 페이지로 이동 ↗</a>`
      : '';

  /* ---------- 식단 ---------- */
  async function loadMenus(placeIds, from, to) {
    let q = sb.from('menus').select('place_id, date, meal, items').gte('date', from).lte('date', to);
    if (placeIds) q = q.in('place_id', placeIds);
    unwrap(await q).forEach((m) => cache.menus.set(`${m.place_id}|${m.date}|${m.meal}`, { restaurantId: m.place_id, date: m.date, meal: m.meal, items: m.items }));
  }
  const menu = (rid, date, meal) => cache.menus.get(`${Number(rid)}|${date}|${meal}`) || null;
  function nutrition(m) {
    const sum = (key) => m.items.reduce((s, i) => s + (Number(i[key]) || 0), 0);
    const kcal = sum('k');
    const carb = sum('c');
    const protein = sum('p');
    const fat = sum('f');
    const total = carb * 4 + protein * 4 + fat * 9 || 1;
    const pct = { c: Math.round((carb * 400) / total), p: Math.round((protein * 400) / total), f: Math.round((fat * 900) / total) };
    // 한국인 영양섭취기준 에너지 적정 비율(탄 55~65, 단 7~20, 지 15~30)을 느슨하게 적용
    const balanced = carb + protein + fat > 0 && pct.c >= 50 && pct.c <= 65 && pct.p >= 14 && pct.f >= 15 && pct.f <= 30;
    return { kcal, carb, protein, fat, pct, balanced };
  }
  function macroBar(n, cls = '') {
    return `<div class="macro ${cls}" title="탄수화물 ${n.pct.c}% · 단백질 ${n.pct.p}% · 지방 ${n.pct.f}%">
      <span class="macro-c" style="width:${n.pct.c}%"></span><span class="macro-p" style="width:${n.pct.p}%"></span><span class="macro-f" style="width:${n.pct.f}%"></span>
    </div>`;
  }
  // 월~토 날짜 목록
  function weekDates(offsetWeeks = 0) {
    const d = addDays(new Date(), offsetWeeks * 7);
    const w = d.getDay();
    const mon = addDays(d, w === 0 ? -6 : 1 - w);
    return [0, 1, 2, 3, 4, 5].map((i) => ymd(addDays(mon, i)));
  }
  // 지도 카드에 보여줄 "오늘(또는 다음 운영일) 메뉴"
  function todayMenu(r) {
    const t = today();
    const meals = bookableMeals(r, t);
    if (meals.length) return { date: t, meal: meals[0], label: `오늘 ${MEAL[meals[0]]}`, menu: menu(r.id, t, meals[0]) };
    const next = nextOpenDate(r, new Date(), true);
    if (!next) return { date: null, meal: 'lunch', label: '다음 운영일', menu: null };
    const meal = mealsOn(r, parseYmd(next))[0];
    return { date: next, meal, label: `${fmtDate(next)} ${MEAL[meal]}`, menu: menu(r.id, next, meal) };
  }

  /* ---------- 통계 (별점·나눔 잔여) ---------- */
  async function loadStats() {
    cache.stats = new Map(unwrap(await sb.rpc('place_stats')).map((s) => [s.place_id, s]));
  }
  function rating(rid) {
    const s = cache.stats.get(Number(rid));
    return s && s.rating_count ? { avg: Number(s.rating_avg), count: s.rating_count } : { avg: 0, count: 0 };
  }
  const shareRemaining = (rid) => (cache.stats.get(Number(rid)) || {}).share_remaining || 0;
  function stars(value, cls = '') {
    const n = Math.round(value);
    return `<span class="stars ${cls}" aria-label="별점 ${Number(value).toFixed(1)}점">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`;
  }

  /* ---------- 후기 ---------- */
  const mapReview = (v) => ({
    id: v.id,
    restaurantId: v.place_id,
    nickname: v.nickname,
    rating: v.rating,
    text: v.body,
    date: ymd(new Date(v.created_at)),
    mine: !!cache.user && v.user_id === cache.user.id,
  });
  async function fetchReviews({ placeId, limit = 100 } = {}) {
    let q = sb.from('reviews').select('id, place_id, user_id, nickname, rating, body, created_at').order('created_at', { ascending: false }).limit(limit);
    if (placeId) q = q.eq('place_id', placeId);
    return unwrap(await q).map(mapReview);
  }
  async function addReview({ restaurantId, nickname, rating, text }) {
    unwrap(await sb.from('reviews').insert({ place_id: restaurantId, nickname, rating, body: text }));
    await loadStats();
  }

  /* ---------- 이용권 ---------- */
  const mapTicket = (t) => ({
    id: t.id,
    code: t.code,
    restaurantId: t.place_id,
    date: t.date,
    meal: t.meal,
    qty: t.qty,
    price: t.price,
    source: t.source,
    status: t.status,
  });
  async function fetchMyTickets() {
    if (!cache.user) return [];
    return unwrap(await sb.from('tickets').select('*').eq('user_id', cache.user.id).order('date')).map(mapTicket);
  }
  async function buyTicket({ restaurantId, date, meal, qty, payMethod }) {
    return mapTicket(unwrap(await sb.rpc('buy_ticket', { p_place_id: restaurantId, p_date: date, p_meal: meal, p_qty: qty, p_pay_method: payMethod })));
  }
  async function useTicket(id) {
    return mapTicket(unwrap(await sb.rpc('use_ticket', { p_ticket_id: id })));
  }
  function ticketState(t) {
    if (t.status === 'used') return 'used';
    if (t.status === 'refunded') return 'refunded';
    if (t.date < today()) return 'expired';
    return 'active';
  }

  /* ---------- 나눔 ---------- */
  async function donate({ restaurantId, qty, name, msg }) {
    unwrap(await sb.from('donations').insert({ place_id: restaurantId, qty, donor_name: name || '익명', message: msg || null }));
    await loadStats();
  }
  async function recentDonations(limit = 10) {
    return unwrap(await sb.rpc('recent_donations', { p_limit: limit })).map((d) => ({
      restaurantId: d.place_id,
      placeName: d.place_name,
      name: d.donor_name,
      qty: d.qty,
      msg: d.message,
      date: ymd(new Date(d.created_at)),
    }));
  }
  async function shareSummary() {
    const rows = unwrap(await sb.rpc('share_summary'));
    return rows[0] || { month_donated: 0, month_claimed: 0 };
  }
  async function claimShare({ restaurantId, name, category }) {
    const t = mapTicket(unwrap(await sb.rpc('claim_share', { p_place_id: restaurantId, p_name: name, p_category: category })));
    await loadStats();
    return t;
  }

  /* ---------- 파트너 ---------- */
  async function myManagedPlaces() {
    if (!cache.user) return [];
    let q = sb.from('places').select('*').order('name');
    if (!isAdmin()) {
      const ids = unwrap(await sb.from('place_managers').select('place_id').eq('user_id', cache.user.id)).map((x) => x.place_id);
      if (!ids.length) return [];
      q = q.in('id', ids);
    }
    return unwrap(await q).map(mapPlace);
  }
  async function partnerPresales(placeId, from, to) {
    return unwrap(await sb.rpc('partner_presales', { p_place_id: placeId, p_from: from, p_to: to }));
  }
  async function dailyCounts(placeId, from, to) {
    return unwrap(await sb.from('daily_counts').select('*').eq('place_id', placeId).gte('date', from).lte('date', to).order('date'));
  }
  async function saveDailyCount(row) {
    unwrap(await sb.from('daily_counts').upsert(row, { onConflict: 'place_id,date' }));
  }
  async function saveMenu({ restaurantId, date, meal, items }) {
    unwrap(await sb.from('menus').upsert({ place_id: restaurantId, date, meal, items }, { onConflict: 'place_id,date,meal' }));
    cache.menus.set(`${restaurantId}|${date}|${meal}`, { restaurantId, date, meal, items });
  }
  async function upcomingMenus(placeId) {
    return unwrap(await sb.from('menus').select('date, meal, items').eq('place_id', placeId).gte('date', today()).order('date'));
  }
  async function deleteMenu(placeId, date, meal) {
    unwrap(await sb.from('menus').delete().eq('place_id', placeId).eq('date', date).eq('meal', meal));
    cache.menus.delete(`${placeId}|${date}|${meal}`);
  }

  /* ---------- 로그인 ---------- */
  async function loadSession() {
    const { data } = await sb.auth.getSession();
    cache.user = data.session ? data.session.user : null;
    cache.profile = null;
    if (cache.user) {
      const { data: profile } = await sb.from('profiles').select('nickname, role').eq('id', cache.user.id).maybeSingle();
      cache.profile = profile;
    }
  }
  const user = () => cache.user;
  const profile = () => cache.profile;
  const isAdmin = () => !!cache.profile && cache.profile.role === 'admin';
  const nickname = () => (cache.profile && cache.profile.nickname) || '';

  async function signIn() {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'kakao', options: { redirectTo: location.href.split('#')[0] } });
    if (error) toast('로그인을 시작하지 못했어요: ' + error.message);
  }
  async function signOut() {
    await sb.auth.signOut();
    location.reload();
  }
  // 로그인 필요 기능 앞에서 호출. 로그인돼 있으면 true, 아니면 안내 창을 띄우고 false
  function requireLogin(reason = '이 기능은 로그인 후 쓸 수 있어요') {
    if (cache.user) return true;
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `
      <div class="bg-white rounded-3xl p-7 w-[min(92vw,380px)] text-center shadow-xl" role="dialog" aria-modal="true" aria-label="로그인">
        <p class="text-4xl">🍚</p>
        <p class="mt-3 text-lg font-extrabold">로그인이 필요해요</p>
        <p class="mt-1 text-stone-600">${esc(reason)}</p>
        <button data-login class="btn w-full mt-6 bg-[#FEE500] text-[#191919] hover:brightness-95">카카오로 시작하기</button>
        <button data-close class="btn btn-ghost w-full mt-2 justify-center">닫기</button>
      </div>`;
    ov.addEventListener('click', (e) => {
      if (e.target === ov || e.target.closest('[data-close]')) ov.remove();
      if (e.target.closest('[data-login]')) signIn();
    });
    document.body.appendChild(ov);
    return false;
  }

  /* ---------- 제보 ---------- */
  // place가 있으면 정보 수정 제보, 없으면 새 식당 제보
  function openReport(place) {
    if (!requireLogin('제보는 로그인 후 보낼 수 있어요.')) return;
    const KINDS = place
      ? [['wrong_info', '정보가 달라요 (가격·시간·입장 조건 등)'], ['closed', '문을 닫았거나 외부인을 받지 않아요'], ['other', '기타']]
      : [['new_place', '새 식당을 알려요']];
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `
      <form class="bg-white rounded-3xl p-6 w-[min(94vw,440px)] space-y-4 shadow-xl" role="dialog" aria-modal="true" aria-label="제보하기" novalidate>
        <div class="flex items-center justify-between">
          <p class="text-lg font-extrabold">📮 ${place ? `${esc(place.name)} 정보 제보` : '식당 제보하기'}</p>
          <button type="button" data-close class="icon-btn" aria-label="닫기">✕</button>
        </div>
        <label class="block"><span class="label">종류</span>
          <select name="kind" class="input">${KINDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
        ${place ? '' : `
          <label class="block"><span class="label">식당 이름</span><input name="place_name" class="input" maxlength="50" placeholder="예: 장전동 OO한식뷔페"></label>
          <label class="block"><span class="label">주소 또는 위치</span><input name="address" class="input" maxlength="100" placeholder="예: 부산대 정문 앞 OO빌딩 1층"></label>`}
        <label class="block"><span class="label">내용</span>
          <textarea name="content" class="input min-h-[100px]" maxlength="1000" placeholder="${place ? '어떤 정보가 다른지 알려 주세요' : '가격, 운영 시간, 외부인 이용 가능 여부 등 아는 만큼 적어 주세요'}"></textarea></label>
        <p data-error class="text-sm font-semibold text-red-600 hidden"></p>
        <button class="btn btn-primary w-full">제보 보내기</button>
      </form>`;
    const form = ov.querySelector('form');
    ov.addEventListener('click', (e) => {
      if (e.target === ov || e.target.closest('[data-close]')) ov.remove();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = form.elements;
      const val = (n) => (f.namedItem(n) ? f.namedItem(n).value.trim() : null);
      const err = form.querySelector('[data-error]');
      const fail = (msg) => {
        err.textContent = msg;
        err.classList.remove('hidden');
      };
      if (!place && !val('place_name')) return fail('식당 이름을 적어 주세요.');
      if (val('content').length < 2) return fail('내용을 적어 주세요.');
      form.querySelector('button:not([type])').disabled = true;
      const res = await sb.from('reports').insert({
        place_id: place ? place.id : null,
        kind: val('kind'),
        place_name: place ? place.name : val('place_name'),
        address: place ? place.address : val('address'),
        content: val('content'),
      });
      if (res.error) {
        form.querySelector('button:not([type])').disabled = false;
        return fail('보내지 못했어요: ' + res.error.message);
      }
      ov.remove();
      toast('제보 고마워요! 확인 후 반영할게요.');
    });
    document.body.appendChild(ov);
  }

  /* ---------- 거리 ---------- */
  function distance(a, b) {
    const R = 6371000;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const fmtDist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`);

  /* ---------- UI 헬퍼 ---------- */
  let toastTimer;
  function toast(msg) {
    let el = document.getElementById('oc-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'oc-toast';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }
  function copy(text, msg = '복사했어요') {
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        toast(msg);
      } catch (e) {
        toast('복사하지 못했어요');
      }
      ta.remove();
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => toast(msg), fallback);
    else fallback();
  }
  // 시연용 결제 연출과 실제 요청을 함께 실행 (실제 결제 없음). 요청 결과를 그대로 resolve/reject
  function fakePay(task, text = '결제를 진행하고 있어요') {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="bg-white rounded-3xl px-10 py-8 text-center shadow-xl">
      <div class="spinner mx-auto"></div>
      <p class="mt-4 font-bold">${esc(text)}</p>
      <p class="text-sm text-stone-500 mt-1">시연용이라 실제 결제되지 않아요</p></div>`;
    document.body.appendChild(ov);
    const wait = new Promise((r) => setTimeout(r, 1000));
    return Promise.all([task(), wait]).then(
      ([result]) =>
        new Promise((resolve) => {
          ov.firstElementChild.innerHTML = '<div class="text-5xl">✅</div><p class="mt-3 font-bold">완료됐어요</p>';
          setTimeout(() => {
            ov.remove();
            resolve(result);
          }, 600);
        }),
      (err) => {
        ov.remove();
        throw err;
      }
    );
  }
  // 데이터 로딩 실패 안내
  function loadError(el, err) {
    el.innerHTML = `<div class="max-w-xl mx-auto px-4 py-20 text-center">
      <p class="text-4xl">⚠️</p><p class="mt-3 font-bold">데이터를 불러오지 못했어요</p>
      <p class="mt-1 text-sm text-stone-500">${esc(err && err.message)}</p>
      <button class="btn btn-primary mt-5" onclick="location.reload()">다시 시도</button></div>`;
  }

  // 로그인 실패 후 돌아온 경우(?error=...&error_description=...) 안내하고 주소 정리
  function reportAuthError() {
    const params = new URLSearchParams(location.search + '&' + location.hash.replace(/^#/, ''));
    const desc = params.get('error_description');
    if (!desc) return;
    console.error('[로그인 실패]', params.get('error'), desc);
    const show = () => toast('로그인하지 못했어요: ' + desc);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
    else show();
    history.replaceState(null, '', location.pathname);
  }
  reportAuthError();

  /* ---------- 시작: 로그인 상태 + 공개 데이터 ---------- */
  const ready = (async () => {
    // OAuth 로그인 직후 주소에 남은 토큰·코드 정리는 supabase-js가 처리
    await Promise.all([
      loadSession(),
      (async () => {
        cache.places = unwrap(await sb.from('places').select('*').eq('status', 'verified').order('id')).map(mapPlace);
      })(),
      loadStats(),
      loadMenus(null, today(), daysFromToday(7)),
    ]);
  })();

  return {
    sb, unwrap, KEY, MEAL, WD, TYPE, ready, load, save, mapPlace, openReport,
    ymd, parseYmd, addDays, today, daysFromToday, fmtDate, won, esc, qs,
    restaurants, restaurant, priceTier, subtitle, opensOn, mealsOn, bookableMeals, status, statusBadge, hoursText, nextOpenDate,
    kakaoDirections, kakaoPlaceUrl, kakaoMapUrl, naverMapUrl, safeUrl, externalLinksHtml, menuPageButton,
    loadMenus, menu, nutrition, macroBar, weekDates, todayMenu,
    loadStats, rating, shareRemaining, stars,
    fetchReviews, addReview,
    fetchMyTickets, buyTicket, useTicket, ticketState,
    donate, recentDonations, shareSummary, claimShare,
    myManagedPlaces, partnerPresales, dailyCounts, saveDailyCount, saveMenu, upcomingMenus, deleteMenu,
    user, profile, isAdmin, nickname, signIn, signOut, requireLogin,
    distance, fmtDist, toast, copy, fakePay, loadError,
  };
})();
