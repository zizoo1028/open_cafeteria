/* 이용권 구매 (결제는 시연용, 이용권 발급은 Supabase buy_ticket RPC) */
(function () {
  const esc = OC.esc;
  const app = document.getElementById('app');
  const PAY = [['kakao', '카카오페이'], ['toss', '토스페이'], ['card', '신용·체크카드']];
  let r = null;
  let dates = [];
  let state = null;

  // 식당이 없거나 판매하지 않을 때: 판매 중인 식당 목록
  function renderPicker() {
    const list = OC.restaurants().filter((x) => x.ticketOnSale);
    app.innerHTML = `
      ${r ? `<div class="card p-5 mb-6 bg-stone-50">ℹ️ <b>${esc(r.name)}</b>은(는) 아직 이용권을 판매하지 않아요. 현장 결제로 이용해 주세요.</div>` : ''}
      <h1 class="text-3xl font-extrabold">🎫 이용권을 살 식당을 골라 주세요</h1>
      <div class="mt-6 grid sm:grid-cols-2 gap-3">
        ${list.length ? list.map((x) => `
          <a href="checkout.html?id=${x.id}" class="card p-5 flex justify-between items-center hover:border-brand-300">
            <span><b class="text-lg">${esc(x.name)}</b><br><span class="text-sm text-stone-500">${esc(OC.subtitle(x))}</span></span>
            <b class="text-brand-600">${OC.won(x.price)}</b>
          </a>`).join('') : '<div class="card p-8 text-center text-stone-500 sm:col-span-2">아직 이용권을 판매하는 식당이 없어요.</div>'}
      </div>`;
  }

  function render() {
    const meals = OC.bookableMeals(r, state.date);
    if (!meals.includes(state.meal)) state.meal = meals[0];
    const m = OC.menu(r.id, state.date, state.meal);
    const n = m ? OC.nutrition(m) : null;
    const total = r.price * state.qty;
    const label = state.date === OC.today() ? '오늘' : OC.fmtDate(state.date);

    app.innerHTML = `
      <a href="restaurant.html?id=${r.id}" class="link-btn -ml-2">← ${esc(r.name)}</a>
      <h1 class="mt-2 text-3xl font-extrabold">이용권 구매</h1>
      <p class="mt-1 text-stone-500">미리 사두면 현장 결제 없이 QR만 보여주고 입장해요.</p>

      <div class="mt-8 grid md:grid-cols-[1fr_340px] gap-6 items-start">
        <div class="space-y-6">
          <section class="card p-6">
            <h2 class="font-extrabold text-lg">1. 날짜</h2>
            <div class="mt-3 flex flex-wrap gap-2">
              ${dates.map((d) => `<button data-date="${d}" class="option ${d === state.date ? 'on' : ''}">${d === OC.today() ? '오늘 ' : ''}${OC.fmtDate(d)}</button>`).join('')}
            </div>
          </section>
          <section class="card p-6">
            <h2 class="font-extrabold text-lg">2. 식사</h2>
            <div class="mt-3 grid grid-cols-2 gap-2">
              ${['lunch', 'dinner'].map((meal) => {
                const ok = meals.includes(meal);
                const hours = r.hours[meal];
                return `<button data-meal="${meal}" class="option justify-center flex-col !items-center ${meal === state.meal ? 'on' : ''}" ${ok ? '' : 'disabled style="opacity:.4;cursor:not-allowed"'}>
                  <span>${OC.MEAL[meal]}</span><span class="text-xs font-normal text-stone-500">${hours ? `${hours[0]}~${hours[1]}` : '운영 안 함'}${hours && !ok ? ' · 마감' : ''}</span></button>`;
              }).join('')}
            </div>
          </section>
          <section class="card p-6">
            <h2 class="font-extrabold text-lg">3. 수량</h2>
            <div class="mt-3 flex items-center gap-4">
              <div class="stepper">
                <button data-qty="-1" ${state.qty <= 1 ? 'disabled' : ''} aria-label="한 장 빼기">−</button>
                <output aria-live="polite">${state.qty}</output>
                <button data-qty="1" ${state.qty >= 10 ? 'disabled' : ''} aria-label="한 장 더하기">+</button>
              </div>
              <span class="text-stone-500">최대 10장 · 가족·동료와 함께 써도 돼요</span>
            </div>
          </section>
          <section class="card p-6 bg-brand-50 border-brand-100">
            <h2 class="font-extrabold text-lg">🍱 ${label} ${OC.MEAL[state.meal]} 메뉴</h2>
            ${m ? `<p class="mt-2 leading-relaxed">${m.items.map((i) => esc(i.n)).join(' · ')}</p>
              ${n.kcal ? `${OC.macroBar(n, 'mt-3')}
              <p class="mt-2 text-sm text-stone-600">${n.kcal}kcal · 탄 ${n.pct.c}% · 단 ${n.pct.p}% · 지 ${n.pct.f}% ${n.balanced ? '<span class="badge badge-green ml-1">균형식단</span>' : ''}</p>` : ''}` : '<p class="mt-2 text-stone-500">아직 식단이 등록되지 않았어요.</p>'}
          </section>
        </div>

        <aside class="card p-6 md:sticky md:top-24 space-y-4">
          <h2 class="font-extrabold text-lg">주문 내역</h2>
          <dl class="space-y-2">
            <div class="flex justify-between gap-3"><dt class="text-stone-500">식당</dt><dd class="font-semibold text-right">${esc(r.name)}</dd></div>
            <div class="flex justify-between"><dt class="text-stone-500">이용일</dt><dd class="font-semibold">${label} ${OC.MEAL[state.meal]}</dd></div>
            <div class="flex justify-between"><dt class="text-stone-500">금액</dt><dd class="font-semibold">${OC.won(r.price)} × ${state.qty}</dd></div>
          </dl>
          <div class="flex justify-between items-end border-t border-stone-100 pt-4">
            <span class="font-bold">총 결제 금액</span><span class="text-2xl font-extrabold text-brand-600">${OC.won(total)}</span>
          </div>
          <fieldset>
            <legend class="label">결제 수단</legend>
            <div class="grid gap-2">
              ${PAY.map(([id, name]) => `<button data-pay="${id}" class="option ${id === state.pay ? 'on' : ''}">${id === state.pay ? '◉' : '○'} ${name}</button>`).join('')}
            </div>
          </fieldset>
          <p class="text-xs text-stone-500 leading-relaxed">※ 시연용 프로토타입이라 실제 결제는 이뤄지지 않아요. 결제 정보도 입력받지 않습니다.<br>※ 최종 금액은 서버에서 다시 계산돼요.</p>
          <button id="payBtn" class="btn btn-primary w-full text-lg">${OC.won(total)} 결제하기</button>
        </aside>
      </div>`;
  }

  app.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled || !state) return;
    if (t.dataset.date) state.date = t.dataset.date;
    else if (t.dataset.meal) state.meal = t.dataset.meal;
    else if (t.dataset.qty) state.qty = Math.min(10, Math.max(1, state.qty + Number(t.dataset.qty)));
    else if (t.dataset.pay) state.pay = t.dataset.pay;
    else if (t.id === 'payBtn') return pay();
    else return;
    render();
  });

  function pay() {
    if (!OC.requireLogin('이용권은 로그인 후 살 수 있어요.')) return;
    OC.fakePay(() => OC.buyTicket({ restaurantId: r.id, date: state.date, meal: state.meal, qty: state.qty, payMethod: state.pay }))
      .then((ticket) => {
        location.href = `tickets.html?new=${ticket.id}`;
      })
      .catch((err) => OC.toast('구매하지 못했어요: ' + err.message));
  }

  app.innerHTML = '<p class="text-stone-400">불러오는 중…</p>';
  OC.ready
    .then(async () => {
      r = OC.restaurant(OC.qs('id'));
      if (!r || !r.ticketOnSale) return renderPicker();
      // 오늘부터 2주 안에서 예약 가능한 날짜 6개 (서버 규칙과 같음)
      for (let i = 0; i <= 14 && dates.length < 6; i++) {
        const d = OC.daysFromToday(i);
        if (OC.bookableMeals(r, d).length) dates.push(d);
      }
      if (!dates.length) {
        app.innerHTML = '<div class="card p-10 text-center text-stone-500">2주 안에 예약할 수 있는 날짜가 없어요.</div>';
        return;
      }
      await OC.loadMenus([r.id], dates[0], dates[dates.length - 1]);
      state = { date: dates[0], meal: OC.bookableMeals(r, dates[0])[0], qty: 1, pay: 'kakao' };
      render();
    })
    .catch((err) => OC.loadError(app, err));
})();
