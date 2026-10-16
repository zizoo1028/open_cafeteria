/* 내 이용권: QR 표시, 사용 처리 */
(function () {
  const esc = OC.esc;
  const newId = OC.qs('new');
  const listEl = document.getElementById('list');
  let tab = 'active';
  let tickets = [];

  const SOURCE = { buy: ['구매', 'badge-brand'], share: ['나눔 식권', 'badge-green'] };
  const STATE = { active: ['사용 가능', 'badge-open'], used: ['사용 완료', ''], expired: ['기간 만료', ''], refunded: ['환불됨', ''] };
  // 이용권의 식당이 숨김 처리돼 목록에 없을 수도 있음
  const placeOf = (t) => OC.restaurant(t.restaurantId) || { id: t.restaurantId, name: '(운영 중단된 식당)', building: '', hours: {} };

  function renderBanner() {
    const t = tickets.find((x) => x.id === newId);
    if (!t) return;
    document.getElementById('banner').innerHTML = `
      <div class="mt-6 card p-5 bg-green-50 border-green-200">
        <p class="font-extrabold text-lg">🎉 ${t.source === 'share' ? '나눔 식권을 받았어요!' : '이용권이 발급됐어요!'}</p>
        <p class="mt-1 text-stone-700">${esc(placeOf(t).name)} · ${OC.fmtDate(t.date)} ${OC.MEAL[t.meal]} · ${t.qty}장. 식당 입구에서 아래 QR을 보여주세요.</p>
      </div>`;
  }

  function render() {
    const list = tickets
      .filter((t) => (tab === 'active' ? OC.ticketState(t) === 'active' : OC.ticketState(t) !== 'active'))
      .sort((a, b) => (tab === 'active' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));

    if (!list.length) {
      listEl.innerHTML = `
        <div class="card p-10 text-center">
          <p class="text-4xl">🍽️</p>
          <p class="mt-3 font-bold">${tab === 'active' ? '사용할 수 있는 이용권이 없어요' : '지난 이용권이 없어요'}</p>
          ${tab === 'active' ? '<a href="map.html" class="btn btn-primary mt-5">식당 찾으러 가기</a>' : ''}
        </div>`;
      return;
    }

    listEl.innerHTML = list.map((t) => {
      const r = placeOf(t);
      const st = OC.ticketState(t);
      const [srcLabel, srcCls] = SOURCE[t.source] || SOURCE.buy;
      const [stLabel, stCls] = STATE[st];
      const hours = r.hours[t.meal];
      return `
        <article class="card overflow-hidden ${t.id === newId ? 'ring-2 ring-brand-500' : ''} ${st !== 'active' ? 'opacity-70' : ''}">
          <div class="flex flex-col sm:flex-row">
            <div class="flex-1 p-5">
              <div class="flex flex-wrap gap-1.5"><span class="badge ${stCls}">${stLabel}</span><span class="badge ${srcCls}">${srcLabel}</span></div>
              <h2 class="mt-3 text-xl font-extrabold">${esc(r.name)}</h2>
              <p class="text-stone-500">${esc(r.building)}</p>
              <dl class="mt-4 grid grid-cols-2 gap-y-2 text-[15px]">
                <dt class="text-stone-500">이용일</dt><dd class="font-bold">${t.date === OC.today() ? '오늘 ' : ''}${OC.fmtDate(t.date)} ${OC.MEAL[t.meal]}</dd>
                <dt class="text-stone-500">입장 시간</dt><dd class="font-semibold">${hours ? `${hours[0]}~${hours[1]}` : '-'}</dd>
                <dt class="text-stone-500">수량</dt><dd class="font-semibold">${t.qty}장</dd>
                <dt class="text-stone-500">금액</dt><dd class="font-semibold">${t.price ? OC.won(t.price) : '무료 (나눔)'}</dd>
              </dl>
              ${st === 'active' ? `
                <div class="mt-4 flex flex-wrap gap-2">
                  <a href="restaurant.html?id=${r.id}#menu" class="btn btn-outline">📅 식단 보기</a>
                  <button data-use="${t.id}" class="btn btn-dark">✔ 사용 처리 (식당 확인)</button>
                </div>` : ''}
              ${st === 'used' ? `<a href="restaurant.html?id=${r.id}#reviews" class="btn btn-outline mt-4">💬 후기 남기기</a>` : ''}
            </div>
            <div class="sm:w-56 p-5 bg-cream border-t sm:border-t-0 sm:border-l border-dashed border-orange-200 flex flex-col items-center justify-center">
              <div class="qr bg-white p-2 rounded-xl" data-code="${esc(t.code)}"></div>
              <p class="mt-2 font-mono font-bold tracking-wider">${esc(t.code)}</p>
            </div>
          </div>
        </article>`;
    }).join('');

    listEl.querySelectorAll('.qr').forEach((box) => {
      if (window.QRCode) {
        new QRCode(box, { text: `OPENCAFETERIA:${box.dataset.code}`, width: 128, height: 128, correctLevel: QRCode.CorrectLevel.M });
      } else {
        box.innerHTML = '<div class="w-32 h-32 grid place-items-center text-stone-400 text-sm">QR 로딩 실패</div>';
      }
    });
  }

  async function reload() {
    tickets = await OC.fetchMyTickets();
    render();
  }

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-use]');
    if (!btn || !confirm('식당 직원이 확인한 뒤 사용 처리할까요?')) return;
    btn.disabled = true;
    try {
      await OC.useTicket(btn.dataset.use);
      OC.toast('사용 처리했어요. 맛있게 드세요!');
      await reload();
    } catch (err) {
      btn.disabled = false;
      OC.toast('처리하지 못했어요: ' + err.message);
    }
  });
  document.querySelectorAll('[data-tab]').forEach((chip) =>
    chip.addEventListener('click', () => {
      tab = chip.dataset.tab;
      document.querySelectorAll('[data-tab]').forEach((c) => c.classList.toggle('on', c === chip));
      render();
    })
  );

  listEl.innerHTML = '<p class="text-stone-400">불러오는 중…</p>';
  OC.ready
    .then(async () => {
      if (!OC.user()) {
        listEl.innerHTML = `
          <div class="card p-10 text-center">
            <p class="text-4xl">🎫</p>
            <p class="mt-3 font-bold">로그인하면 내 이용권을 볼 수 있어요</p>
            <button id="loginBtn" class="btn mt-5 bg-[#FEE500] text-[#191919]">카카오로 시작하기</button>
          </div>`;
        document.getElementById('loginBtn').addEventListener('click', OC.signIn);
        return;
      }
      await reload();
      renderBanner();
    })
    .catch((err) => OC.loadError(listEl, err));
})();
