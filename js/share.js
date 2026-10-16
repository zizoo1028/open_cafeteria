/* 나눔 식권: 기부하기 / 받기 / 현황 */
(function () {
  const esc = OC.esc;
  const content = document.getElementById('content');
  const CATEGORIES = ['65세 이상 어르신', '결식 우려 아동·청소년', '기초생활수급자·차상위', '기관 추천 (주민센터·복지관 등)'];
  const preset = Number(OC.qs('id')) || 0;
  const state = {
    tab: ['give', 'get', 'status'].includes(OC.qs('tab')) ? OC.qs('tab') : 'give',
    giveRid: 0,
    qty: 5,
    name: '',
    msg: '',
    done: null,
    summary: { month_donated: 0, month_claimed: 0 },
    recent: null,
  };

  function renderStats() {
    const remaining = OC.restaurants().reduce((s, r) => s + OC.shareRemaining(r.id), 0);
    const stat = (label, value, sub) => `<div class="card p-4"><dt class="text-sm text-stone-500">${label}</dt><dd class="text-2xl md:text-3xl font-extrabold mt-1">${value}</dd><dd class="text-xs text-stone-400 mt-0.5">${sub}</dd></div>`;
    document.getElementById('stats').innerHTML =
      stat('지금 남은 식권', `${remaining}장`, '바로 사용 가능') +
      stat('이번 달 나눔', `${state.summary.month_donated}장`, '기부된 식권') +
      stat('나눔으로 먹은 끼니', `${state.summary.month_claimed}끼`, '이번 달');
  }
  const loginCard = (msg) => `
    <div class="card p-10 text-center max-w-xl mx-auto">
      <p class="text-4xl">🤝</p>
      <p class="mt-3 font-bold">${msg}</p>
      <button data-login class="btn mt-5 bg-[#FEE500] text-[#191919]">카카오로 시작하기</button>
    </div>`;
  const noPlaces = '<div class="card p-10 text-center text-stone-500">아직 등록된 식당이 없어요.</div>';

  /* ---------- 기부하기 ---------- */
  function giveHtml() {
    if (!OC.restaurants().length) return noPlaces;
    if (state.done) {
      const r = OC.restaurant(state.done.restaurantId);
      return `
        <div class="card p-8 text-center max-w-xl mx-auto">
          <p class="text-5xl">💚</p>
          <h2 class="mt-4 text-2xl font-extrabold">${state.done.qty}장 나눔 완료!</h2>
          <p class="mt-2 text-stone-600">${esc(r.name)}의 나눔 식권이 <b class="text-green-700">${OC.shareRemaining(r.id)}장</b>이 되었어요.<br>따뜻한 마음 고맙습니다.</p>
          <div class="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
            <button data-again class="btn btn-green">한 번 더 나누기</button>
            <a href="restaurant.html?id=${r.id}" class="btn btn-outline">식당 보기</a>
          </div>
        </div>`;
    }
    const r = OC.restaurant(state.giveRid);
    return `
      <div class="grid md:grid-cols-[1fr_320px] gap-6 items-start">
        <form id="giveForm" class="card p-6 space-y-5" novalidate>
          <h2 class="text-xl font-extrabold">어느 식당에 나눌까요?</h2>
          <label class="block">
            <span class="label">식당</span>
            <select name="rid" class="input">
              ${OC.restaurants().map((x) => `<option value="${x.id}" ${x.id === r.id ? 'selected' : ''}>${esc(x.name)} · ${OC.won(x.price)} (남은 ${OC.shareRemaining(x.id)}장)</option>`).join('')}
            </select>
          </label>
          <div>
            <span class="label">수량</span>
            <div class="flex flex-wrap items-center gap-3">
              <div class="stepper">
                <button type="button" data-qty="-1" ${state.qty <= 1 ? 'disabled' : ''} aria-label="한 장 빼기">−</button>
                <output>${state.qty}</output>
                <button type="button" data-qty="1" ${state.qty >= 50 ? 'disabled' : ''} aria-label="한 장 더하기">+</button>
              </div>
              ${[1, 5, 10, 20].map((n) => `<button type="button" data-set="${n}" class="chip ${state.qty === n ? 'on' : ''}">${n}장</button>`).join('')}
            </div>
          </div>
          <label class="block"><span class="label">기부자 이름 <span class="text-stone-400 font-normal">(선택, 비우면 익명)</span></span><input name="name" class="input" maxlength="20" placeholder="익명" value="${esc(state.name)}"></label>
          <label class="block"><span class="label">응원 메시지 <span class="text-stone-400 font-normal">(선택)</span></span><input name="msg" class="input" maxlength="40" placeholder="예: 따뜻한 한 끼 드세요!" value="${esc(state.msg)}"></label>
        </form>
        <aside class="card p-6 md:sticky md:top-24 space-y-4">
          <h2 class="font-extrabold text-lg">기부 금액</h2>
          <p class="flex justify-between gap-3"><span class="text-stone-500">${esc(r.name)}</span><span class="shrink-0">${OC.won(r.price)} × ${state.qty}</span></p>
          <p class="flex justify-between items-end border-t border-stone-100 pt-4"><span class="font-bold">합계</span><span class="text-2xl font-extrabold text-green-700">${OC.won(r.price * state.qty)}</span></p>
          <p class="text-xs text-stone-500 leading-relaxed">※ 시연용으로 실제 결제되지 않아요.<br>※ 실제 서비스에서는 기부금 영수증 발급을 지원할 예정이에요.</p>
          <button id="giveBtn" class="btn btn-green w-full text-lg">💚 ${state.qty}장 나누기</button>
        </aside>
      </div>`;
  }

  /* ---------- 받기 ---------- */
  function getHtml() {
    if (!OC.user()) return loginCard('나눔 식권은 로그인 후 받을 수 있어요');
    const available = OC.restaurants().filter((x) => OC.shareRemaining(x.id) > 0);
    if (!available.length) return '<div class="card p-10 text-center text-stone-500">지금 남은 나눔 식권이 없어요.</div>';
    const defaultRid = available.some((x) => x.id === preset) ? preset : available[0].id;
    return `
      <div class="grid md:grid-cols-[1fr_320px] gap-6 items-start">
        <form id="getForm" class="card p-6 space-y-5" novalidate>
          <h2 class="text-xl font-extrabold">나눔 식권 받기 신청</h2>
          <label class="block"><span class="label">이름 또는 별칭</span><input name="name" class="input" maxlength="20" placeholder="예: 장전동 김OO"></label>
          <label class="block">
            <span class="label">대상 구분</span>
            <select name="category" class="input">${CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select>
          </label>
          <label class="block">
            <span class="label">이용할 식당</span>
            <select name="rid" class="input">
              ${available.map((x) => `<option value="${x.id}" ${x.id === defaultRid ? 'selected' : ''}>${esc(x.name)} (남은 ${OC.shareRemaining(x.id)}장)</option>`).join('')}
            </select>
          </label>
          <p id="getError" class="text-sm font-semibold text-red-600 hidden"></p>
          <button class="btn btn-primary w-full text-lg">🍚 식권 1장 받기</button>
        </form>
        <aside class="card p-6 bg-stone-50 space-y-3 text-stone-700">
          <h2 class="font-extrabold text-lg text-ink">안내</h2>
          <p>• 하루 1장, 가장 가까운 운영일 중식에 쓸 수 있어요.</p>
          <p>• 받은 식권은 <a href="tickets.html" class="underline font-semibold">내 이용권</a>에 QR로 들어가요. 일반 이용권과 똑같이 생겨서 누구도 알아볼 수 없어요.</p>
          <p class="text-sm text-stone-500">※ 실제 서비스에서는 주민센터·학교·복지관 등 연계 기관 확인 후 지급돼요. 프로토타입에서는 바로 발급됩니다.</p>
        </aside>
      </div>`;
  }

  /* ---------- 현황 ---------- */
  function statusHtml() {
    if (!OC.restaurants().length) return noPlaces;
    const rows = OC.restaurants().map((r) => ({ r, n: OC.shareRemaining(r.id) })).sort((a, b) => b.n - a.n);
    const max = Math.max(1, ...rows.map((x) => x.n));
    const recent = state.recent;
    return `
      <div class="grid md:grid-cols-2 gap-6 items-start">
        <section class="card p-6">
          <h2 class="text-xl font-extrabold">식당별 남은 식권</h2>
          <ul class="mt-4 space-y-3">
            ${rows.map(({ r, n }) => `
              <li>
                <div class="flex justify-between text-[15px]"><a href="restaurant.html?id=${r.id}" class="font-semibold hover:text-brand-600">${esc(r.name)}</a><b class="${n ? 'text-green-700' : 'text-stone-400'}">${n}장</b></div>
                <div class="mt-1 h-2 rounded-full bg-stone-100 overflow-hidden"><div class="h-full bg-green-500 rounded-full" style="width:${(n / max) * 100}%"></div></div>
              </li>`).join('')}
          </ul>
        </section>
        <section class="card p-6">
          <h2 class="text-xl font-extrabold">최근 나눔 메시지</h2>
          <ul class="mt-4 space-y-3">
            ${!recent ? '<li class="text-stone-400">불러오는 중…</li>' : recent.length ? recent.map((d) => `
              <li class="rounded-xl bg-green-50 p-4">
                <div class="flex justify-between gap-2 text-sm"><b>${esc(d.name || '익명')}</b><span class="text-stone-500">${OC.fmtDate(d.date)}</span></div>
                <p class="mt-1">${esc(d.placeName)}에 <b class="text-green-700">${d.qty}장</b> 나눔</p>
                ${d.msg ? `<p class="mt-1 text-stone-600">“${esc(d.msg)}”</p>` : ''}
              </li>`).join('') : '<li class="text-stone-500">아직 나눔 기록이 없어요. 첫 나눔을 해 주세요!</li>'}
          </ul>
        </section>
      </div>`;
  }

  /* ---------- 렌더·이벤트 ---------- */
  function render() {
    renderStats();
    document.querySelectorAll('[data-tab]').forEach((c) => {
      c.classList.toggle('on', c.dataset.tab === state.tab);
      c.setAttribute('aria-selected', c.dataset.tab === state.tab);
    });
    content.innerHTML = state.tab === 'give' ? giveHtml() : state.tab === 'get' ? getHtml() : statusHtml();
    if (state.tab === 'status' && !state.recent) {
      OC.recentDonations(10)
        .then((list) => {
          state.recent = list;
          if (state.tab === 'status') render();
        })
        .catch(() => {
          state.recent = [];
          if (state.tab === 'status') render();
        });
    }
  }
  async function refreshSummary() {
    try {
      state.summary = await OC.shareSummary();
    } catch (e) {}
    renderStats();
  }

  document.querySelectorAll('[data-tab]').forEach((chip) =>
    chip.addEventListener('click', () => {
      state.tab = chip.dataset.tab;
      state.done = null;
      history.replaceState(null, '', `share.html?tab=${state.tab}`);
      render();
    })
  );

  content.addEventListener('click', (e) => {
    if (e.target.closest('[data-login]')) return OC.signIn();
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    if (t.dataset.qty) state.qty = Math.min(50, Math.max(1, state.qty + Number(t.dataset.qty)));
    else if (t.dataset.set) state.qty = Number(t.dataset.set);
    else if (t.hasAttribute('data-again')) state.done = null;
    else if (t.id === 'giveBtn') return give();
    else return;
    render();
  });
  content.addEventListener('input', (e) => {
    if (e.target.closest('#giveForm') && (e.target.name === 'name' || e.target.name === 'msg')) state[e.target.name] = e.target.value;
  });
  content.addEventListener('change', (e) => {
    if (e.target.name === 'rid' && e.target.closest('#giveForm')) {
      state.giveRid = Number(e.target.value);
      render();
    }
  });

  function give() {
    if (!OC.requireLogin('나눔 식권 기부는 로그인 후 할 수 있어요.')) return;
    const data = { restaurantId: state.giveRid, qty: state.qty, name: state.name.trim() || '익명', msg: state.msg.trim() };
    OC.fakePay(() => OC.donate(data), '나눔 식권을 기부하고 있어요')
      .then(() => {
        state.done = data;
        state.name = '';
        state.msg = '';
        state.recent = null;
        render();
        refreshSummary();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      })
      .catch((err) => OC.toast('기부하지 못했어요: ' + err.message));
  }

  content.addEventListener('submit', async (e) => {
    if (e.target.id !== 'getForm') return;
    e.preventDefault();
    const f = e.target.elements;
    const btn = e.target.querySelector('button');
    const err = document.getElementById('getError');
    const fail = (msg) => {
      err.textContent = msg;
      err.classList.remove('hidden');
    };
    const name = f.namedItem('name').value.trim();
    if (!name) return fail('이름 또는 별칭을 입력해 주세요.');
    btn.disabled = true;
    try {
      const ticket = await OC.claimShare({ restaurantId: Number(f.namedItem('rid').value), name, category: f.namedItem('category').value });
      location.href = `tickets.html?new=${ticket.id}`;
    } catch (ex) {
      btn.disabled = false;
      fail(ex.message);
    }
  });

  content.innerHTML = '<p class="text-stone-400">불러오는 중…</p>';
  OC.ready
    .then(() => {
      const list = OC.restaurants();
      state.giveRid = OC.restaurant(preset) ? preset : list.length ? list[0].id : 0;
      render();
      refreshSummary();
    })
    .catch((err) => OC.loadError(content, err));
})();
