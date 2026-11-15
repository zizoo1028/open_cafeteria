/* 체험 모드 (전시·시연용)
 * 켜기: 주소 끝에 ?demo=1   끄기: ?demo=0
 * - 로그인·가입·개인정보 없이 모든 메뉴를 써 볼 수 있음
 * - 후기·이용권·나눔·파트너 입력은 이 기기(브라우저)에만 저장되고 서버(DB)에는 아무것도 쓰지 않음
 * - 식단·파트너 실적은 체험용 예시 데이터를 자동으로 만들어 보여 줌
 * - 일정 시간 조작이 없으면 처음 화면으로 자동 복귀 (다음 관람객을 위해 입력 내용 초기화)
 * store.js 다음, layout.js 앞에서 불러와야 함.
 */
(function () {
  const FLAG = 'oc_demo';
  const STATE_KEY = 'oc_demo_state';
  const IDLE_MS = 60000; // 이 시간 동안 조작이 없으면 처음으로 돌아가 대기 화면을 보여 줌
  const WARN_MS = 10000; // 복귀 전 안내 시간

  /* ---------- 켜고 끄기 ---------- */
  const params = new URLSearchParams(location.search);
  const justEntered = params.get('demo') === '1'; // ?demo=1 로 막 들어온 경우 (대기 화면부터 보여 줌)
  try {
    if (params.get('demo') === '1') localStorage.setItem(FLAG, '1');
    if (params.get('demo') === '0') {
      localStorage.removeItem(FLAG);
      localStorage.removeItem(STATE_KEY);
    }
    if (params.has('demo')) {
      params.delete('demo');
      const q = params.toString();
      history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
    }
  } catch (e) {}
  let on = false;
  try {
    on = localStorage.getItem(FLAG) === '1';
  } catch (e) {}
  if (!on || !window.OC) return;

  window.OC_DEMO = true;
  // 전시장 위치: 체험 모드의 지도 검색은 이 주소를 중심으로 열리고, 목록은 여기서 가까운 순으로 정렬됨
  window.OC_DEMO_VENUE = { name: '전시장', address: '서울특별시 서초구 강남대로 27' };
  document.documentElement.classList.add('demo-mode');
  // 태블릿에서 보기 편하도록 처음에는 큰 글씨로 (사용자가 끄면 존중)
  try {
    if (localStorage.getItem(OC.KEY.bigText) === null) localStorage.setItem(OC.KEY.bigText, 'true');
  } catch (e) {}

  const cache = OC._cache;

  /* ---------- 이 기기에만 저장하는 체험 데이터 ---------- */
  const blank = () => ({ tickets: [], reviews: [], donations: [], counts: [], seq: 0 });
  let S;
  try {
    S = Object.assign(blank(), JSON.parse(localStorage.getItem(STATE_KEY) || '{}'));
  } catch (e) {
    S = blank();
  }
  const persist = () => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(S));
    } catch (e) {}
  };
  const fresh = () => !(S.tickets.length || S.reviews.length || S.donations.length || S.counts.length);

  /* ---------- 예시 식단 만들기 (같은 식당·날짜면 늘 같은 메뉴) ---------- */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = (s) => [...String(s)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
  // n 이름, k 열량(kcal), c 탄수화물, p 단백질, f 지방(g)
  const D = {
    rice: [
      { n: '잡곡밥', k: 310, c: 68, p: 7, f: 1 }, { n: '흰쌀밥', k: 300, c: 67, p: 5, f: 1 }, { n: '현미밥', k: 305, c: 66, p: 6, f: 2 }, { n: '보리밥', k: 295, c: 65, p: 6, f: 1 },
    ],
    soup: [
      { n: '소고기미역국', k: 80, c: 5, p: 7, f: 4 }, { n: '된장찌개', k: 70, c: 6, p: 5, f: 3 }, { n: '콩나물국', k: 40, c: 4, p: 4, f: 1 }, { n: '북어국', k: 60, c: 3, p: 9, f: 2 },
      { n: '김치콩나물국', k: 45, c: 5, p: 4, f: 1 }, { n: '어묵국', k: 65, c: 7, p: 5, f: 2 },
    ],
    main: [
      { n: '제육볶음', k: 260, c: 14, p: 20, f: 14 }, { n: '닭갈비', k: 240, c: 13, p: 22, f: 11 }, { n: '고등어구이', k: 220, c: 2, p: 24, f: 13 }, { n: '불고기', k: 250, c: 15, p: 21, f: 12 },
      { n: '함박스테이크', k: 280, c: 16, p: 19, f: 16 }, { n: '돈가스', k: 330, c: 24, p: 18, f: 18 }, { n: '오징어볶음', k: 190, c: 14, p: 18, f: 6 }, { n: '순두부찌개', k: 160, c: 8, p: 12, f: 9 },
    ],
    side: [
      { n: '계란말이', k: 120, c: 3, p: 8, f: 8 }, { n: '시금치나물', k: 35, c: 4, p: 3, f: 1 }, { n: '어묵볶음', k: 90, c: 10, p: 6, f: 3 }, { n: '감자조림', k: 100, c: 18, p: 2, f: 3 },
      { n: '콩나물무침', k: 40, c: 4, p: 4, f: 1 }, { n: '두부조림', k: 110, c: 5, p: 9, f: 6 }, { n: '멸치볶음', k: 85, c: 8, p: 9, f: 2 }, { n: '도라지무침', k: 55, c: 8, p: 2, f: 2 },
    ],
    kimchi: [{ n: '배추김치', k: 20, c: 3, p: 1, f: 0 }, { n: '깍두기', k: 25, c: 5, p: 1, f: 0 }],
  };
  function genMenu(placeId, date, meal) {
    const r = rng(hash(`${placeId}|${date}|${meal}`));
    const pick = (list) => list[Math.floor(r() * list.length)];
    const side1 = pick(D.side);
    let side2 = pick(D.side);
    if (side2 === side1) side2 = D.side[(D.side.indexOf(side1) + 3) % D.side.length];
    return { restaurantId: placeId, date, meal, items: [pick(D.rice), pick(D.soup), pick(D.main), side1, side2, pick(D.kimchi)] };
  }
  function fillMenus(placeIds, from, to) {
    const ids = placeIds ? new Set(placeIds.map(Number)) : null;
    for (let d = OC.parseYmd(from); OC.ymd(d) <= to; d = OC.addDays(d, 1)) {
      const date = OC.ymd(d);
      OC.restaurants().forEach((r) => {
        if (ids && !ids.has(r.id)) return;
        OC.mealsOn(r, d).forEach((meal) => {
          const key = `${r.id}|${date}|${meal}`;
          if (!cache.menus.has(key)) cache.menus.set(key, genMenu(r.id, date, meal));
        });
      });
    }
  }
  const origLoadMenus = OC.loadMenus;
  OC.loadMenus = async (placeIds, from, to) => {
    try {
      await origLoadMenus(placeIds, from, to);
    } catch (e) {} // 서버 식단이 없거나 실패해도 예시로 채움
    fillMenus(placeIds, from, to);
  };

  /* ---------- 후기 ---------- */
  const SEED_REVIEWS = [
    { place: 407, nickname: '점심러', rating: 5, text: '반찬이 다양하고 깔끔해요. 외부인도 눈치 안 보고 먹을 수 있어서 좋았어요.', ago: 1 },
    { place: 407, nickname: '근처직장인', rating: 4, text: '가격 대비 구성이 좋아요. 12시 넘어가면 줄이 길어요.', ago: 3 },
    { place: 332, nickname: '도서관이웃', rating: 5, text: '책 보다가 간단히 먹기 좋아요. 국이 따뜻해서 만족.', ago: 2 },
    { place: 292, nickname: '국회구경', rating: 4, text: '메뉴가 매일 바뀌어서 지루하지 않아요.', ago: 5 },
    { place: 300, nickname: '판교러', rating: 4, text: '점심 가성비 괜찮아요. 식단표를 미리 볼 수 있어서 편해요.', ago: 4 },
    { place: 338, nickname: '성수동주민', rating: 5, text: '샐러드바까지 있어서 든든했어요.', ago: 6 },
  ];
  const mkReview = (v, i) => ({ id: `seed-${i}`, restaurantId: v.place, nickname: v.nickname, rating: v.rating, text: v.text, date: OC.daysFromToday(-v.ago), mine: false });
  const origFetchReviews = OC.fetchReviews;
  OC.fetchReviews = async ({ placeId, limit = 100 } = {}) => {
    let real = [];
    try {
      real = await origFetchReviews({ placeId, limit });
    } catch (e) {}
    const mine = S.reviews.map((v) => ({ id: v.id, restaurantId: v.place, nickname: v.nickname, rating: v.rating, text: v.text, date: v.date, mine: true }));
    const seeds = SEED_REVIEWS.map(mkReview);
    const all = [...mine, ...real, ...seeds].filter((v) => !placeId || v.restaurantId === Number(placeId));
    return all.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  };
  function bumpRating(placeId, rating) {
    const s = cache.stats.get(placeId) || { place_id: placeId, rating_count: 0, rating_avg: 0, share_remaining: 0 };
    const total = Number(s.rating_avg) * s.rating_count + rating;
    s.rating_count += 1;
    s.rating_avg = total / s.rating_count;
    cache.stats.set(placeId, s);
  }
  OC.addReview = async ({ restaurantId, nickname, rating, text }) => {
    S.reviews.push({ id: `demo-r${++S.seq}`, place: Number(restaurantId), nickname: nickname || '체험 이웃', rating, text, date: OC.today() });
    bumpRating(Number(restaurantId), rating);
    persist();
  };

  /* ---------- 이용권·나눔 ---------- */
  const code = () => 'DEMO-' + Math.random().toString(36).slice(2, 6).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const stat = (pid) => cache.stats.get(Number(pid)) || { place_id: Number(pid), rating_count: 0, rating_avg: 0, share_remaining: 0 };
  OC.fetchMyTickets = async () => S.tickets.map((t) => ({ ...t }));
  OC.buyTicket = async ({ restaurantId, date, meal, qty }) => {
    const r = OC.restaurant(restaurantId);
    const t = { id: `demo-t${++S.seq}`, code: code(), restaurantId: Number(restaurantId), date, meal, qty, price: (r ? r.price : 0) * qty, source: 'buy', status: 'valid' };
    S.tickets.push(t);
    persist();
    return { ...t };
  };
  OC.useTicket = async (id) => {
    const t = S.tickets.find((x) => x.id === id);
    if (!t) throw new Error('이용권을 찾지 못했어요');
    t.status = 'used';
    persist();
    return { ...t };
  };
  const SEED_DONATIONS = [
    { place: 407, name: '따뜻한이웃', qty: 3, msg: '든든하게 드세요', ago: 0 },
    { place: 332, name: '익명', qty: 2, msg: '', ago: 1 },
    { place: 292, name: '동네주민', qty: 5, msg: '힘내세요!', ago: 2 },
  ];
  OC.donate = async ({ restaurantId, qty, name, msg }) => {
    S.donations.push({ place: Number(restaurantId), name: name || '익명', qty, msg: msg || '', date: OC.today() });
    stat(restaurantId).share_remaining += qty;
    cache.stats.set(Number(restaurantId), stat(restaurantId));
    persist();
  };
  OC.recentDonations = async (limit = 10) => {
    const row = (d, i) => ({ restaurantId: d.place, placeName: (OC.restaurant(d.place) || {}).name || '식당', name: d.name, qty: d.qty, msg: d.msg, date: d.date || OC.daysFromToday(-d.ago), _i: i });
    return [...S.donations.map(row).reverse(), ...SEED_DONATIONS.map(row)].slice(0, limit);
  };
  OC.shareSummary = async () => ({
    month_donated: [...S.donations, ...SEED_DONATIONS].reduce((s, d) => s + d.qty, 0),
    month_claimed: S.tickets.filter((t) => t.source === 'share').length + 4,
  });
  OC.claimShare = async ({ restaurantId }) => {
    const s = stat(restaurantId);
    if (s.share_remaining <= 0) throw new Error('지금은 받을 수 있는 나눔 식권이 없어요');
    s.share_remaining -= 1;
    cache.stats.set(Number(restaurantId), s);
    const r = OC.restaurant(restaurantId);
    const meal = r && r.hours.lunch ? 'lunch' : 'dinner';
    const t = { id: `demo-t${++S.seq}`, code: code(), restaurantId: Number(restaurantId), date: OC.today(), meal, qty: 1, price: 0, source: 'share', status: 'valid' };
    S.tickets.push(t);
    persist();
    return { ...t };
  };

  /* ---------- 파트너(식당 사장님) 화면: 예시 식당 하나로 체험 ---------- */
  const PARTNER_ID = 407; // 부영그룹 식당
  OC.myManagedPlaces = async () => {
    const r = OC.restaurant(PARTNER_ID) || OC.restaurants()[0];
    return r ? [r] : [];
  };
  const isWeekday = (d) => d.getDay() >= 1 && d.getDay() <= 5;
  OC.dailyCounts = async (placeId, from, to) => {
    const rows = [];
    for (let d = OC.parseYmd(from); OC.ymd(d) <= to; d = OC.addDays(d, 1)) {
      if (!isWeekday(d)) continue;
      const date = OC.ymd(d);
      const r = rng(hash(`${placeId}|count|${date}`));
      const internal = Math.round(170 + r() * 80);
      const walkin = Math.round(25 + r() * 45);
      rows.push({ place_id: Number(placeId), date, internal, walkin, prepared: internal + walkin + Math.round(r() * 20), waste_kg: Math.round((5 + r() * 6) * 10) / 10 });
    }
    S.counts.filter((c) => c.place_id === Number(placeId) && c.date >= from && c.date <= to).forEach((c) => {
      const i = rows.findIndex((x) => x.date === c.date);
      if (i >= 0) rows[i] = { ...rows[i], ...c };
      else rows.push(c);
    });
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  };
  OC.saveDailyCount = async (row) => {
    S.counts = S.counts.filter((c) => !(c.place_id === row.place_id && c.date === row.date));
    S.counts.push({ ...row });
    persist();
  };
  OC.partnerPresales = async (placeId, from, to) => {
    const rows = [];
    for (let d = OC.parseYmd(from); OC.ymd(d) <= to; d = OC.addDays(d, 1)) {
      if (!isWeekday(d)) continue;
      const date = OC.ymd(d);
      const r = rng(hash(`${placeId}|presale|${date}`));
      const mine = S.tickets.filter((t) => t.restaurantId === Number(placeId) && t.date === date && t.meal === 'lunch' && t.source === 'buy').reduce((s, t) => s + t.qty, 0);
      rows.push({ date, meal: 'lunch', qty: Math.round(8 + r() * 30) + mine });
    }
    return rows;
  };
  OC.saveMenu = async ({ restaurantId, date, meal, items }) => cache.menus.set(`${restaurantId}|${date}|${meal}`, { restaurantId, date, meal, items });
  OC.upcomingMenus = async (placeId) =>
    [...cache.menus.values()].filter((m) => m.restaurantId === Number(placeId) && m.date >= OC.today()).sort((a, b) => a.date.localeCompare(b.date) || a.meal.localeCompare(b.meal));
  OC.deleteMenu = async (placeId, date, meal) => {
    cache.menus.delete(`${placeId}|${date}|${meal}`);
  };

  /* ---------- 제보·로그인·로그아웃 ---------- */
  OC.openReport = () => OC.toast('체험 모드에서는 제보가 전송되지 않아요. 실제 서비스에서 이용해 주세요');
  OC.signIn = () => OC.toast('체험 모드에서는 로그인 없이 모두 이용할 수 있어요');
  function resetDemo(goHome = true, attract = false) {
    S = blank();
    try {
      localStorage.removeItem(STATE_KEY);
      if (attract) localStorage.setItem('oc_attract', '1'); // 처음 화면으로 돌아간 뒤 대기 화면을 켬
    } catch (e) {}
    if (goHome) location.href = 'index.html';
  }
  OC.signOut = () => resetDemo(true);

  /* ---------- 시작: 가짜 로그인 상태 + 예시 식단 ---------- */
  const origReady = OC.ready;
  OC.ready = origReady.then(() => {
    cache.user = { id: 'demo-user' };
    cache.profile = { nickname: '체험 이웃', role: 'user' };
    // 가격·운영시간이 비어 있는 식당은 체험용 예시 값으로 채움 (같은 식당이면 늘 같은 값). 서버 데이터는 바뀌지 않음
    OC.restaurants().forEach((r) => {
      const g = rng(hash(`fill|${r.id}`));
      if (!r.price) r.price = 5000 + Math.floor(g() * 7) * 500; // 5,000~8,000원
      if (!r.hours.lunch && !r.hours.dinner) {
        const start = g() < 0.5 ? '11:00' : '11:30';
        const end = g() < 0.5 ? '13:30' : '14:00';
        r.hours.lunch = [start, end];
      }
    });
    fillMenus(null, OC.today(), OC.daysFromToday(7));
    // 예시 후기·내가 쓴 후기를 별점 통계에 반영 (통계는 서버에서 불러온 뒤 만들어지므로 여기서)
    SEED_REVIEWS.forEach((v) => bumpRating(v.place, v.rating));
    S.reviews.forEach((v) => bumpRating(v.place, v.rating));
    // 내가 이미 나눔한 식권 수도 반영
    S.donations.forEach((d) => {
      const s = stat(d.place);
      s.share_remaining += d.qty;
      cache.stats.set(Number(d.place), s);
    });
  });

  /* ---------- 화면 꾸미기: 헤더에 체험 모드 표시 ---------- */
  const style = document.createElement('style');
  style.textContent = `
    html.demo-mode { -webkit-tap-highlight-color: transparent; overscroll-behavior: none; }
    html.demo-mode body { -webkit-user-select: none; user-select: none; }
    html.demo-mode input, html.demo-mode textarea { -webkit-user-select: text; user-select: text; }
    .demo-badge { display:inline-flex; align-items:center; gap:.25rem; padding:.25rem .6rem; border-radius:999px; background:#fff7ed; color:#c2410c; font-weight:800; font-size:.85rem; border:1px solid #fed7aa; }
    .demo-attract { position:fixed; inset:0; z-index:5000; background:#000; color:#fff; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:2rem; cursor:pointer; -webkit-user-select:none; user-select:none; }
    .demo-attract .da-title { font-size:clamp(2.4rem,8vw,4.6rem); font-weight:800; letter-spacing:.04em; }
    .demo-attract .da-rule { width:3rem; height:1px; background:rgba(255,255,255,.55); margin:2.2rem 0; }
    .demo-attract .da-line { min-height:4.2rem; font-size:clamp(1.25rem,3.6vw,2rem); font-weight:400; line-height:1.7; letter-spacing:.02em; max-width:22em; word-break:keep-all; opacity:0; transition:opacity .9s ease; }
    .demo-attract .da-line.on { opacity:1; }
    .demo-attract .da-touch { position:absolute; bottom:max(3rem,8vh); font-size:clamp(1rem,2.6vw,1.35rem); font-weight:400; letter-spacing:.15em; color:#fff; animation:daBlink 2.6s ease-in-out infinite; }
    @keyframes daBlink { 0%,100% { opacity:.25; } 50% { opacity:.8; } }
    .demo-toast { position:fixed; left:50%; bottom:1.5rem; transform:translateX(-50%); z-index:3000; background:#3b2a20; color:#fff; padding:.9rem 1.4rem; border-radius:1rem; font-weight:700; box-shadow:0 8px 24px rgba(0,0,0,.3); }`;
  document.head.appendChild(style);

  function decorateHeader() {
    const area = document.getElementById('authArea');
    if (!area) return;
    const draw = () => {
      if (area.querySelector('#demoExit')) return;
      obs.disconnect();
      area.innerHTML = '<span class="demo-badge">🧪 체험 모드</span><button id="demoExit" class="btn-ghost text-sm">처음으로</button>';
      area.querySelector('#demoExit').addEventListener('click', () => resetDemo(true));
      obs.observe(area, { childList: true });
    };
    const obs = new MutationObserver(draw);
    obs.observe(area, { childList: true });
    draw();
  }
  document.addEventListener('DOMContentLoaded', () => {
    decorateHeader();
    const foot = document.getElementById('site-footer');
    if (foot) new MutationObserver(() => {
      const p = foot.querySelector('p.mt-1:last-child');
      if (p && !p.dataset.demo) { p.dataset.demo = '1'; p.textContent = '※ 체험 모드입니다. 식단·후기·이용권 등은 예시이며 결제나 개인정보 수집이 없습니다.'; }
    }).observe(foot, { childList: true, subtree: true });
  });

  // 전시장에 인터넷이 연결돼 있으므로 식단표·길 찾기 같은 바깥 링크(네이버·카카오·인스타그램 등)는 그대로 새 탭에서 열림.
  // (인터넷이 없는 환경에서 QR로 보여 주려면 이 자리에 링크 가로채기를 다시 넣으면 됨)

  /* ---------- 일정 시간 조작이 없으면 처음 화면으로 ---------- */
  let idleTimer = null;
  let warnTimer = null;
  let warnEl = null;
  function clearWarn() {
    if (warnEl) warnEl.remove();
    warnEl = null;
    clearInterval(warnTimer);
  }
  function toIdle() {
    const onHome = /(^|\/)(index\.html)?$/.test(location.pathname);
    if (attractEl) return;
    if (onHome && fresh()) return showAttract(); // 이미 처음 화면이고 입력 내용도 없으면 바로 대기 화면
    let left = Math.round(WARN_MS / 1000);
    warnEl = document.createElement('div');
    warnEl.className = 'demo-toast';
    const paint = () => (warnEl.textContent = `${left}초 뒤 처음 화면으로 돌아가요 · 화면을 누르면 계속 볼 수 있어요`);
    paint();
    document.body.appendChild(warnEl);
    warnTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearWarn();
        resetDemo(true, true);
      } else paint();
    }, 1000);
  }
  /* ---------- 대기 화면 (검은 화면 + 호기심 문구, 터치하면 서비스 시작) ---------- */
  let attractEl = null;
  function showAttract() {
    if (attractEl) return;
    clearWarn();
    // 식당 수는 문구를 바꿀 때마다 그때의 DB 값으로 계산 (대기 화면이 먼저 뜨고 데이터가 나중에 올 수 있음)
    const lines = () => {
      const count = (OC.restaurants && OC.restaurants().length) || 0;
      return [
        '회사 안에만 있던 구내식당이, 이제 동네의 식탁이 됩니다',
        '문 닫힌 식당이 아니라, 문 열린 식당입니다',
        '비싼 점심이 아니어도, 영양은 빠지지 않습니다',
        count ? `오늘, 우리 동네 ${count}곳의 구내식당이 문을 열고 있습니다` : '오늘, 우리 동네의 구내식당이 문을 열고 있습니다',
        '점심값이 부담스러운 날, 가장 가까운 구내식당으로 오세요',
        '어르신의 한 끼도, 수험생의 한 끼도 똑같이 든든하게',
        '당신이 나눈 한 끼는, 누군가의 하루를 버티는 힘이 됩니다',
      ];
    };
    attractEl = document.createElement('div');
    attractEl.className = 'demo-attract';
    attractEl.setAttribute('role', 'button');
    attractEl.setAttribute('aria-label', '화면을 터치하면 시작합니다');
    attractEl.innerHTML = `
      <div class="da-title">우리동네 열린식당</div>
      <div class="da-rule"></div>
      <div class="da-line" id="daLine"></div>
      <div class="da-touch">화면을 터치해 주세요</div>`;
    document.body.appendChild(attractEl);
    const line = attractEl.querySelector('#daLine');
    let i = 0; // 늘 첫 문구로 시작
    const next = () => {
      line.classList.remove('on');
      setTimeout(() => {
        const all = lines();
        line.textContent = all[i % all.length];
        i += 1;
        line.classList.add('on');
      }, 900);
    };
    next();
    const rot = setInterval(next, 6000);
    attractEl.addEventListener('click', () => {
      clearInterval(rot);
      attractEl.remove();
      attractEl = null;
      if (!/(^|\/)(index\.html)?$/.test(location.pathname)) location.href = 'index.html';
      arm();
    });
  }
  document.addEventListener('DOMContentLoaded', () => {
    let flagged = false;
    try {
      flagged = localStorage.getItem('oc_attract') === '1';
      localStorage.removeItem('oc_attract');
    } catch (e) {}
    if (justEntered || flagged) showAttract();
  });

  function arm() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(toIdle, IDLE_MS);
  }
  ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach((ev) =>
    window.addEventListener(
      ev,
      () => {
        if (warnEl) clearWarn();
        arm();
      },
      { passive: true, capture: true }
    )
  );
  arm();
})();
