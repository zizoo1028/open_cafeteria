/* 체험 모드 (전시·시연용)
 * 켜기: 주소 끝에 ?demo=1   끄기: ?demo=0
 * - 로그인·가입·개인정보 없이 모든 메뉴를 써 볼 수 있음
 * - 후기·식권·나눔·파트너 입력은 이 기기(브라우저)에만 저장되고 서버(DB)에는 아무것도 쓰지 않음
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

  // 체험 모드의 첫 화면은 소개 페이지가 아니라 지도 검색. 처음 화면(index)으로 오면 지도 검색으로 보냄
  const HOME = 'map.html';
  if (/(^|\/)(index\.html)?$/.test(location.pathname)) {
    try {
      if (justEntered) localStorage.setItem('oc_attract', '1'); // 막 들어온 경우 지도 화면에서 대기 화면부터
    } catch (e) {}
    location.replace(HOME);
    return;
  }

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
  // 관람객이 직접 입력한 것이 없으면 처음 상태 (미리 넣어 둔 예시 식권은 제외)
  const fresh = () => !(S.tickets.some((t) => !t.seed) || S.reviews.length || S.donations.length || S.counts.length);

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
      { n: '잡곡밥', k: 310, c: 68, p: 7, f: 1 }, { n: '흰쌀밥', k: 300, c: 67, p: 5, f: 1 }, { n: '현미밥', k: 305, c: 66, p: 6, f: 2 },
      { n: '보리밥', k: 295, c: 65, p: 6, f: 1 }, { n: '흑미밥', k: 308, c: 67, p: 6, f: 2 },
    ],
    // 국·찌개 (한 끼에 하나만)
    soup: [
      { n: '소고기미역국', k: 80, c: 5, p: 7, f: 4 }, { n: '된장찌개', k: 70, c: 6, p: 5, f: 3 }, { n: '콩나물국', k: 40, c: 4, p: 4, f: 1 },
      { n: '북어국', k: 60, c: 3, p: 9, f: 2 }, { n: '김치콩나물국', k: 45, c: 5, p: 4, f: 1 }, { n: '어묵국', k: 65, c: 7, p: 5, f: 2 },
      { n: '순두부찌개', k: 130, c: 7, p: 11, f: 7 }, { n: '시금치된장국', k: 50, c: 5, p: 4, f: 2 }, { n: '떡국', k: 150, c: 26, p: 6, f: 3 },
      { n: '육개장', k: 160, c: 8, p: 14, f: 8 }, { n: '매운어묵탕', k: 90, c: 9, p: 7, f: 3 },
    ],
    main: [
      { n: '제육볶음', k: 260, c: 14, p: 20, f: 14 }, { n: '닭갈비', k: 240, c: 13, p: 22, f: 11 }, { n: '고등어구이', k: 220, c: 2, p: 24, f: 13 },
      { n: '불고기', k: 250, c: 15, p: 21, f: 12 }, { n: '함박스테이크', k: 280, c: 16, p: 19, f: 16 }, { n: '돈가스', k: 330, c: 24, p: 18, f: 18 },
      { n: '오징어볶음', k: 190, c: 14, p: 18, f: 6 }, { n: '닭강정', k: 300, c: 26, p: 17, f: 14 }, { n: '삼치구이', k: 210, c: 2, p: 22, f: 12 },
      { n: '두루치기', k: 240, c: 16, p: 18, f: 11 }, { n: '떡갈비', k: 270, c: 15, p: 18, f: 15 }, { n: 'LA갈비', k: 310, c: 12, p: 22, f: 18 },
      { n: '찜닭', k: 260, c: 20, p: 20, f: 10 }, { n: '생선까스', k: 290, c: 22, p: 16, f: 15 },
    ],
    side: [
      { n: '계란말이', k: 120, c: 3, p: 8, f: 8 }, { n: '시금치나물', k: 35, c: 4, p: 3, f: 1 }, { n: '어묵볶음', k: 90, c: 10, p: 6, f: 3 },
      { n: '감자조림', k: 100, c: 18, p: 2, f: 3 }, { n: '콩나물무침', k: 40, c: 4, p: 4, f: 1 }, { n: '두부조림', k: 110, c: 5, p: 9, f: 6 },
      { n: '멸치볶음', k: 85, c: 8, p: 9, f: 2 }, { n: '도라지무침', k: 55, c: 8, p: 2, f: 2 }, { n: '깻잎무침', k: 45, c: 6, p: 2, f: 2 },
      { n: '숙주나물', k: 35, c: 4, p: 3, f: 1 }, { n: '고구마맛탕', k: 140, c: 28, p: 1, f: 4 }, { n: '잡채', k: 150, c: 24, p: 4, f: 5 },
      { n: '파래무침', k: 30, c: 4, p: 2, f: 1 }, { n: '애호박볶음', k: 60, c: 6, p: 2, f: 3 },
    ],
    kimchi: [{ n: '배추김치', k: 20, c: 3, p: 1, f: 0 }, { n: '깍두기', k: 25, c: 5, p: 1, f: 0 }, { n: '열무김치', k: 18, c: 3, p: 1, f: 0 }],
    // 후식·샐러드
    extra: [
      { n: '과일샐러드', k: 70, c: 15, p: 1, f: 1 }, { n: '요구르트', k: 60, c: 11, p: 2, f: 1 }, { n: '양상추샐러드', k: 45, c: 6, p: 1, f: 2 },
      { n: '방울토마토', k: 30, c: 6, p: 1, f: 0 }, { n: '식혜', k: 80, c: 19, p: 0, f: 0 }, { n: '귤', k: 40, c: 10, p: 1, f: 0 },
    ],
  };
  // 날짜가 바뀔 때마다 목록을 돌아가며 골라서 어제와 같은 메뉴가 나오지 않게 함 (식당마다 시작 위치가 다름)
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const stepFor = (len) => [7, 5, 3, 11, 13, 1].find((x) => gcd(x, len) === 1);
  function genMenu(placeId, date, meal) {
    const day = Math.floor(OC.parseYmd(date).getTime() / 86400000);
    const r = OC.restaurant(placeId);
    const isBuffet = r && r.type === 'buffet';
    const base = (cat, k = 0) => hash(`${placeId}|${meal}|${cat}`) + k * 5;
    const pick = (cat, k = 0) => D[cat][(base(cat, k) + day * stepFor(D[cat].length)) % D[cat].length];
    // 밥·국·메인·반찬 2개·김치 = 6가지. 한식뷔페는 반찬 1개와 후식을 더하고, 일반 식당도 격일로 후식이 붙음 (항상 5가지 이상)
    const items = [pick('rice'), pick('soup'), pick('main'), pick('side', 0), pick('side', 1), pick('kimchi')];
    if (isBuffet) items.splice(5, 0, pick('side', 2));
    if (isBuffet || (hash(`${placeId}|${date}`) & 1) === 0) items.push(pick('extra'));
    return { restaurantId: placeId, date, meal, items };
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
    { place: 407, nickname: '시청역출근러', rating: 5, text: '시청역에서 가까워서 좋아요. 오늘은 국이 특히 맛있었어요.', ago: 8 },
    { place: 332, nickname: '도서관이웃', rating: 5, text: '책 보다가 간단히 먹기 좋아요. 국이 따뜻해서 만족.', ago: 2 },
    { place: 332, nickname: '공부하는중', rating: 4, text: '도서관 다녀오는 길에 먹었는데 가격이 착해요. 점심시간엔 사람이 꽤 많아요.', ago: 7 },
    { place: 292, nickname: '국회구경', rating: 4, text: '메뉴가 매일 바뀌어서 지루하지 않아요.', ago: 5 },
    { place: 300, nickname: '판교러', rating: 4, text: '점심 가성비 괜찮아요. 식단표를 미리 볼 수 있어서 편해요.', ago: 4 },
    { place: 300, nickname: '야근탈출', rating: 5, text: '배불리 먹고 6천 원대, 이 동네에서 보기 힘든 가격이에요.', ago: 9 },
    { place: 338, nickname: '성수동주민', rating: 5, text: '샐러드바까지 있어서 든든했어요.', ago: 6 },
    { place: 338, nickname: '맛집탐방러', rating: 5, text: '메뉴가 매일 달라서 자주 오게 돼요. 후식도 있어요.', ago: 10 },
    { place: 336, nickname: '성수점심', rating: 4, text: '이름처럼 반찬이 정갈해요. 국물이 깔끔했어요.', ago: 11 },
    { place: 320, nickname: '양재직장인', rating: 4, text: '양재역에서 걸어서 5분이에요. 점심시간에는 대기가 조금 있어요.', ago: 5 },
    { place: 294, nickname: '어르신아드님', rating: 4, text: '어르신들이 많이 오세요. 간이 슴슴해서 부모님이 좋아하셨어요.', ago: 12 },
    { place: 384, nickname: '용산주민', rating: 4, text: '조용한 분위기에서 천천히 먹을 수 있어요.', ago: 13 },
    { place: 341, nickname: '런치탐험가', rating: 3, text: '메인 반찬이 푸짐해요. 다만 12시 전후에는 대기가 길어요.', ago: 14 },
    { place: 348, nickname: '동네주민', rating: 5, text: '구청 식당인데 외부인도 이용할 수 있어요. 5천 원대라 부담이 없어요.', ago: 3 },
    { place: 420, nickname: '수험생엄마', rating: 5, text: '가격이 저렴해서 놀랐어요. 아이랑 같이 먹었어요.', ago: 6 },
    { place: 328, nickname: '강남출근길', rating: 4, text: '식단표를 미리 볼 수 있어서 좋아요.', ago: 8 },
  ];
  // 모든 식당에 후기가 있도록, 직접 쓴 예시 후기가 3건 미만인 식당은 자동으로 채움 (같은 식당이면 늘 같은 후기)
  const NICKS = ['점심러', '맛집탐방러', '근처직장인', '동네주민', '퇴근길이웃', '공부하는중', '든든한한끼', '이웃주민', '점심메이트', '야근러', '뚜벅이', '주말산책', '수험생엄마', '어르신아드님', '자취생', '대학원생', '회사원', '단골손님', '첫방문', '지나가던행인', '출근길', '배고픈직장인', '밥심', '알뜰살뜰'];
  const REVIEW_LINES = {
    good: ['반찬이 깔끔하고 간이 적당해요.', '국이 따뜻하고 맛있었어요.', '밥이 질지 않고 딱 좋아요.', '양이 넉넉해서 든든하게 먹었어요.', '메뉴가 매일 달라서 질리지 않아요.', '김치가 맛있어서 밥 한 공기 더 먹었어요.', '식단표를 미리 확인하고 가니 편했어요.', '직원분들이 친절하세요.', '외부인도 눈치 안 보고 이용할 수 있어요.', '혼자 와서 먹기에도 부담 없어요.', '샐러드랑 후식도 있어서 좋았어요.', '자리가 넓어서 편하게 먹었어요.'],
    ok: ['무난해요. 특별하진 않지만 한 끼 해결하기엔 충분해요.', '맛은 평범한데 가격을 생각하면 괜찮아요.', '점심시간엔 줄이 길어요. 조금 일찍 가는 걸 추천해요.', '자리가 조금 좁은 편이에요.'],
    tip: ['점심시간엔 사람이 많으니 조금 일찍 가세요.', '12시 넘으면 대기가 있어요.', '식권을 미리 사 두면 편해요.'],
  };
  function genReview(r, k) {
    const g = rng(hash(`rv|${r.id}|${k}`));
    const pick = (list) => list[Math.floor(g() * list.length)];
    const roll = g();
    const rating = roll < 0.4 ? 5 : roll < 0.82 ? 4 : 3;
    const place = [];
    if (/도서관/.test(r.name)) place.push('책 보다가 먹기 좋아요.');
    else if (/구청|세무서|우체국|보건소|지검|경찰서|조달청/.test(r.name)) place.push('공공기관인데 외부인도 편하게 이용할 수 있었어요.');
    else if (/병원/.test(r.name)) place.push('병원 다녀오는 길에 먹기 편해요.');
    else if (/대학|학생|캠퍼스/.test(r.name)) place.push('학생들 사이에서 먹는 분위기가 좋아요.');
    else if (r.type === 'buffet') place.push('반찬 종류가 많아서 골라 먹는 재미가 있어요.');
    const price = r.price ? [`${OC.won(r.price)}에 이 정도면 만족스러워요.`, `${OC.won(r.price)}이라 부담 없이 먹었어요.`] : [];
    const first = rating === 3 ? pick(REVIEW_LINES.ok) : pick([...REVIEW_LINES.good, ...price, ...place]);
    let second = '';
    if (rating === 4 && g() < 0.6) second = pick(REVIEW_LINES.tip);
    else if (rating === 5 && g() < 0.5) second = pick([...REVIEW_LINES.good, ...place]);
    const text = second && second !== first ? `${first} ${second}` : first;
    return { id: `gen-${r.id}-${k}`, restaurantId: r.id, nickname: pick(NICKS), rating, text, date: OC.daysFromToday(-Math.floor(g() * 28)), mine: false };
  }
  let GEN_REVIEWS = [];
  function buildGenReviews() {
    const seeded = new Map();
    SEED_REVIEWS.forEach((v) => seeded.set(v.place, (seeded.get(v.place) || 0) + 1));
    GEN_REVIEWS = [];
    OC.restaurants().forEach((r) => {
      for (let k = 0; k < Math.max(0, 3 - (seeded.get(r.id) || 0)); k += 1) GEN_REVIEWS.push(genReview(r, k));
    });
  }
  const mkReview = (v, i) => ({ id: `seed-${i}`, restaurantId: v.place, nickname: v.nickname, rating: v.rating, text: v.text, date: OC.daysFromToday(-v.ago), mine: false });
  const origFetchReviews = OC.fetchReviews;
  OC.fetchReviews = async ({ placeId, limit = 100 } = {}) => {
    let real = [];
    try {
      real = await origFetchReviews({ placeId, limit });
    } catch (e) {}
    const mine = S.reviews.map((v) => ({ id: v.id, restaurantId: v.place, nickname: v.nickname, rating: v.rating, text: v.text, date: v.date, mine: true }));
    const seeds = [...SEED_REVIEWS.map(mkReview), ...GEN_REVIEWS];
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

  /* ---------- 식권·나눔 ---------- */
  const code = () => 'DEMO-' + Math.random().toString(36).slice(2, 6).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const stat = (pid) => cache.stats.get(Number(pid)) || { place_id: Number(pid), rating_count: 0, rating_avg: 0, share_remaining: 0 };
  // 관람객이 처음 들어오면 보여 줄 예시 식권 4장 (사용 가능 2장, 사용 완료 1장, 기간 지남 1장)
  function seedTickets() {
    const price = (id, qty) => ((OC.restaurant(id) || {}).price || 6000) * qty;
    const mk = (n, id, ago, meal, qty, source, status) => ({
      id: `seed-t${n}`, code: `DEMO-${n}K${n + 3}M-${n * 7}QXA`.slice(0, 15), restaurantId: id, date: OC.daysFromToday(ago), meal, qty,
      price: source === 'share' ? 0 : price(id, qty), source, status, seed: true,
    });
    return [mk(1, 407, 1, 'lunch', 2, 'buy', 'valid'), mk(2, 332, 0, 'lunch', 1, 'share', 'valid'), mk(3, 338, -1, 'lunch', 1, 'buy', 'used'), mk(4, 300, -4, 'lunch', 1, 'buy', 'valid')];
  }
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
    if (!t) throw new Error('식권을 찾지 못했어요');
    t.status = 'used';
    persist();
    return { ...t };
  };
  const SEED_DONATIONS = [
    { place: 407, name: '따뜻한이웃', qty: 3, msg: '든든하게 드세요', ago: 0 },
    { place: 332, name: '익명', qty: 2, msg: '', ago: 1 },
    { place: 292, name: '동네주민', qty: 5, msg: '힘내세요!', ago: 2 },
    { place: 338, name: '퇴근길이웃', qty: 2, msg: '따뜻한 밥 한 끼 드시고 힘내세요', ago: 3 },
    { place: 300, name: '판교러', qty: 4, msg: '야근하는 분들께', ago: 4 },
    { place: 420, name: '익명', qty: 3, msg: '어르신들 점심 드세요', ago: 5 },
    { place: 348, name: '한마음 모임', qty: 6, msg: '이웃과 나누는 한 끼', ago: 6 },
    { place: 407, name: '수험생 부모', qty: 2, msg: '시험 보는 친구들 응원합니다', ago: 8 },
  ];
  // 나눔 식권이 남아 있는 식당 (받기 화면에서 고를 수 있도록)
  const SEED_SHARE_REMAINING = { 407: 10, 332: 6, 292: 5, 338: 4, 300: 4, 420: 3, 348: 6, 320: 3, 341: 2, 336: 2 };
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
  const PARTNER_IDS = [407, 338, 320, 341]; // 부영그룹 식당 · 밥플러스 성수역점 · 캠코양재타워 식당 · 런치투데이
  OC.myManagedPlaces = async () => {
    const list = PARTNER_IDS.map((id) => OC.restaurant(id)).filter(Boolean);
    return list.length ? list : OC.restaurants().slice(0, 1);
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
    if (goHome) location.href = HOME;
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
    // 나눔 식권 잔여 (서버 값보다 적으면 예시 값으로)
    Object.entries(SEED_SHARE_REMAINING).forEach(([id, n]) => {
      const s = stat(id);
      if (s.share_remaining < n) s.share_remaining = n;
      cache.stats.set(Number(id), s);
    });
    // 내 식권 예시 (처음 한 번만 넣음. 처음 화면으로 초기화되면 다시 들어옴)
    if (!S.seeded) {
      S.tickets = [...seedTickets(), ...S.tickets];
      S.seeded = true;
      persist();
    }
    // 예시 후기·내가 쓴 후기를 별점 통계에 반영 (통계는 서버에서 불러온 뒤 만들어지므로 여기서)
    buildGenReviews();
    GEN_REVIEWS.forEach((v) => bumpRating(v.restaurantId, v.rating));
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
    .demo-attract .da-line { font-size:clamp(1.5rem,4.4vw,2.6rem); font-weight:500; line-height:1.7; letter-spacing:.02em; word-break:keep-all; }
    .demo-attract .da-rule { width:3rem; height:1px; background:rgba(255,255,255,.55); margin:2.6rem 0; }
    .demo-attract .da-title { font-size:clamp(2.4rem,8vw,4.6rem); font-weight:800; letter-spacing:.04em; }
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
      if (p && !p.dataset.demo) { p.dataset.demo = '1'; p.textContent = '※ 체험 모드입니다. 식단·후기·식권 등은 예시이며 결제나 개인정보 수집이 없습니다.'; }
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
    if (attractEl) return;
    // 지도 검색 첫 화면 그대로(선택한 식당·검색어 없음)이고 입력 내용도 없으면 바로 대기 화면
    const search = document.getElementById('search');
    const clean = /(^|\/)map\.html$/.test(location.pathname) && !location.search && !(search && search.value);
    if (clean && fresh()) return showAttract();
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
    attractEl = document.createElement('div');
    attractEl.className = 'demo-attract';
    attractEl.setAttribute('role', 'button');
    attractEl.setAttribute('aria-label', '화면을 터치하면 시작합니다');
    attractEl.innerHTML = `
      <div class="da-line">회사 안에만 있던 구내식당이,<br>이제 모두의 열린식당이 됩니다.</div>
      <div class="da-rule"></div>
      <div class="da-title">우리동네 열린식당</div>
      <div class="da-touch">지금 화면을 터치해주세요</div>`;
    document.body.appendChild(attractEl);
    attractEl.addEventListener('click', () => {
      attractEl.remove();
      attractEl = null;
      if (!/(^|\/)map\.html$/.test(location.pathname) || location.search) location.href = HOME;
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
