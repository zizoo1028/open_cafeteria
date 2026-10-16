/* 파트너 대시보드: 식수 예측, 실적, 사전판매, 식단 등록 */
(function () {
  const esc = OC.esc;
  const select = document.getElementById('ridSelect');
  const gate = document.getElementById('gate');
  const dash = document.getElementById('dash');
  const menuForm = document.getElementById('menuForm');
  const countForm = document.getElementById('countForm');
  const charts = {};
  const COLORS = { internal: '#D6CFC7', walkin: '#FDBA74', presold: '#F97316', line: '#3B2A20' };
  let places = [];
  let r = null;

  const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
  // 내일부터 운영일 n개
  function nextDays(n) {
    const out = [];
    for (let i = 1; out.length < n && i < 30; i++) {
      const d = OC.addDays(new Date(), i);
      if (OC.mealsOn(r, d).length) out.push(OC.ymd(d));
    }
    return out;
  }

  /* ---------- 예측 ---------- */
  // 요일이 같은 최근 4주 실적 평균 + 확정된 이용권
  function forecast(date, history, presold) {
    const w = OC.parseYmd(date).getDay();
    const same = history.filter((h) => OC.parseYmd(h.date).getDay() === w).slice(-4);
    const internal = Math.round(avg(same.map((h) => h.internal || 0)));
    const walkin = Math.round(avg(same.map((h) => h.walkin || 0)));
    const total = internal + walkin + presold;
    return { date, internal, walkin, presold, total, prepare: Math.ceil(total * 1.03), hasHistory: same.length > 0 };
  }

  function renderKpis(fc, history, monthSales) {
    const recent = history.filter((h) => h.waste_kg != null).slice(-10);
    const waste = recent.length ? avg(recent.map((h) => Number(h.waste_kg))) : null;
    const kpi = (label, value, sub, accent) => `
      <div class="card p-5 ${accent ? 'bg-brand-50 border-brand-200' : ''}">
        <dt class="text-sm text-stone-500 font-semibold">${label}</dt>
        <dd class="mt-1 text-3xl font-extrabold ${accent ? 'text-brand-700' : ''}">${value}</dd>
        <dd class="mt-1 text-sm text-stone-500">${sub}</dd>
      </div>`;
    document.getElementById('kpis').innerHTML =
      kpi(`${fc ? OC.fmtDate(fc.date) : '다음 운영일'} 예상 식수`, fc ? `${fc.total}식` : '-',
        fc && fc.hasHistory ? `권장 준비량 <b>${fc.prepare}인분</b> (+3%)` : '실적을 입력하면 예측해요', true) +
      kpi('이용권 확정', fc ? `${fc.presold}식` : '-', r.ticketOnSale ? '외부인 사전판매' : '이용권 미판매 식당', false) +
      kpi('최근 평균 잔반', waste == null ? '-' : `${waste.toFixed(1)}kg`, waste == null ? '잔반을 입력하면 표시돼요' : `최근 ${recent.length}일 기준`, false) +
      kpi('이번 달 이용권 판매', `${monthSales.qty}식`, `매출 ${OC.won(monthSales.qty * r.price)}`, false);
  }

  /* ---------- 차트 ---------- */
  function drawChart(id, config) {
    if (charts[id]) charts[id].destroy();
    if (!window.Chart) return;
    charts[id] = new Chart(document.getElementById(id), config);
  }
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { family: 'Pretendard Variable', size: 13 } } }, tooltip: { mode: 'index', intersect: false } },
    scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, grid: { color: '#F1E4D6' } } },
  };
  function renderCharts(fcs, history) {
    drawChart('forecastChart', {
      type: 'bar',
      data: {
        labels: fcs.map((f) => OC.fmtDate(f.date)),
        datasets: [
          { label: '임직원 (예상)', data: fcs.map((f) => f.internal), backgroundColor: COLORS.internal, borderRadius: 4 },
          { label: '외부 현장 (예상)', data: fcs.map((f) => f.walkin), backgroundColor: COLORS.walkin, borderRadius: 4 },
          { label: '이용권 (확정)', data: fcs.map((f) => f.presold), backgroundColor: COLORS.presold, borderRadius: 4 },
        ],
      },
      options: baseOptions,
    });
    const recent = history.slice(-14);
    document.getElementById('historyEmpty').classList.toggle('hidden', recent.length > 0);
    drawChart('historyChart', {
      type: 'bar',
      data: {
        labels: recent.map((h) => OC.fmtDate(h.date)),
        datasets: [
          { type: 'line', label: '준비량', data: recent.map((h) => h.prepared), borderColor: COLORS.line, backgroundColor: COLORS.line, pointRadius: 2, tension: 0.3, stack: 'line' },
          { label: '임직원', data: recent.map((h) => h.internal), backgroundColor: COLORS.internal, stack: 'served' },
          { label: '외부 현장', data: recent.map((h) => h.walkin), backgroundColor: COLORS.walkin, stack: 'served' },
        ],
      },
      options: { ...baseOptions, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: false, beginAtZero: true, grid: { color: '#F1E4D6' } } } },
    });
  }

  /* ---------- 사전판매 표 ---------- */
  function renderPresale(days, presales) {
    const el = document.getElementById('presaleTable');
    if (!r.ticketOnSale) {
      el.innerHTML = `<div class="rounded-2xl bg-stone-50 p-6 text-center"><p class="font-bold">이용권 판매가 꺼져 있어요</p>
        <p class="mt-1 text-sm text-stone-500">이용권을 열면 외부인 식수를 하루 전에 확정할 수 있어요. 판매 시작은 관리자에게 요청해 주세요.</p></div>`;
      return;
    }
    const qty = (d, meal) => (presales.find((p) => p.date === d && p.meal === meal) || {}).qty || 0;
    const hasDinner = !!r.hours.dinner;
    el.innerHTML = `
      <table class="w-full text-[15px]">
        <thead><tr class="text-stone-500 text-sm border-b border-stone-100"><th class="text-left py-2">날짜</th><th class="text-right">중식</th>${hasDinner ? '<th class="text-right">석식</th>' : ''}<th class="text-right">합계</th><th class="text-right">매출</th></tr></thead>
        <tbody>
          ${days.map((d) => {
            const meals = OC.mealsOn(r, OC.parseYmd(d));
            const l = qty(d, 'lunch');
            const dn = qty(d, 'dinner');
            return `<tr class="border-b border-stone-100 last:border-0">
              <td class="py-3 font-semibold">${OC.fmtDate(d)}</td><td class="text-right">${l}</td>${hasDinner ? `<td class="text-right">${meals.includes('dinner') ? dn : '-'}</td>` : ''}
              <td class="text-right font-bold text-brand-700">${l + dn}</td><td class="text-right text-stone-500">${OC.won((l + dn) * r.price)}</td></tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  /* ---------- 식단 목록 ---------- */
  async function renderMyMenus() {
    const box = document.getElementById('myMenus');
    try {
      const list = await OC.upcomingMenus(r.id);
      box.innerHTML = list.length ? `
        <h3 class="font-bold">등록된 식단 ${list.length}개</h3>
        <ul class="mt-2 space-y-2">
          ${list.map((m) => `
            <li class="rounded-xl border border-stone-100 p-3 flex items-start gap-3">
              <div class="flex-1 min-w-0"><p class="font-semibold">${OC.fmtDate(m.date)} ${OC.MEAL[m.meal]}</p><p class="text-sm text-stone-600 truncate">${m.items.map((i) => esc(i.n)).join(' · ')}</p></div>
              <button data-del="${m.date}|${m.meal}" class="link-btn text-red-600">삭제</button>
            </li>`).join('')}
        </ul>
        ${r.status === 'verified' ? `<a href="restaurant.html?id=${r.id}#menu" class="link-btn -ml-2 mt-2 inline-block">식단표에서 확인 →</a>` : ''}` : '<p class="text-stone-400">앞으로 등록된 식단이 없어요.</p>';
    } catch (err) {
      box.innerHTML = `<p class="text-red-600 text-sm">${esc(err.message)}</p>`;
    }
  }

  /* ---------- 전체 렌더 ---------- */
  async function render() {
    r = places.find((p) => p.id === Number(select.value));
    menuForm.elements.namedItem('meal').querySelector('[value=dinner]').disabled = !r.hours.dinner;
    if (!r.hours.dinner) menuForm.elements.namedItem('meal').value = 'lunch';
    try {
      const days = nextDays(5);
      const monthStart = OC.today().slice(0, 8) + '01';
      const [history, presales, monthPresales] = await Promise.all([
        OC.dailyCounts(r.id, OC.daysFromToday(-28), OC.today()),
        days.length ? OC.partnerPresales(r.id, days[0], days[days.length - 1]) : [],
        OC.partnerPresales(r.id, monthStart, OC.daysFromToday(31)).then((rows) => rows.filter((x) => x.date.slice(0, 7) === monthStart.slice(0, 7))),
      ]);
      const presoldOn = (d) => presales.filter((p) => p.date === d).reduce((s, p) => s + p.qty, 0);
      const fcs = days.map((d) => forecast(d, history, presoldOn(d)));
      renderKpis(fcs[0], history, { qty: monthPresales.reduce((s, x) => s + x.qty, 0) });
      renderCharts(fcs, history);
      renderPresale(days, presales);
    } catch (err) {
      OC.toast('대시보드를 불러오지 못했어요: ' + err.message);
    }
    renderMyMenus();
  }

  /* ---------- 폼 ---------- */
  function parseItems(text) {
    return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const m = line.match(/^(.*?)\s+(\d{2,4})\s*(kcal)?$/i);
      const n = (m ? m[1] : line).trim();
      if (!m) return { n };
      const k = Number(m[2]);
      // 열량만 입력받으므로 탄 55 / 단 20 / 지 25% 로 추정
      return { n, k, c: Math.round((k * 0.55) / 4), p: Math.round((k * 0.2) / 4), f: Math.round((k * 0.25) / 9) };
    });
  }
  const formError = (id) => (msg) => {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.classList.toggle('hidden', !msg);
  };

  menuForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = menuForm.elements;
    const fail = formError('menuError');
    fail('');
    const date = f.namedItem('date').value;
    const meal = f.namedItem('meal').value;
    const items = parseItems(f.namedItem('items').value);
    if (!date) return fail('날짜를 골라 주세요.');
    if (!OC.mealsOn(r, OC.parseYmd(date)).includes(meal)) return fail(`${OC.fmtDate(date)}에는 ${OC.MEAL[meal]}을 운영하지 않아요.`);
    if (items.length < 2) return fail('메뉴를 2개 이상 입력해 주세요.');
    if (items.length > 15) return fail('메뉴는 15개까지 입력할 수 있어요.');
    try {
      await OC.saveMenu({ restaurantId: r.id, date, meal, items });
      f.namedItem('items').value = '';
      renderMyMenus();
      OC.toast(`${OC.fmtDate(date)} ${OC.MEAL[meal]} 식단을 등록했어요`);
    } catch (err) {
      fail('등록하지 못했어요: ' + err.message);
    }
  });
  document.getElementById('myMenus').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    const [date, meal] = btn.dataset.del.split('|');
    try {
      await OC.deleteMenu(r.id, date, meal);
      renderMyMenus();
    } catch (err) {
      OC.toast('삭제하지 못했어요: ' + err.message);
    }
  });

  countForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = countForm.elements;
    const fail = formError('countError');
    fail('');
    const num = (name) => (f.namedItem(name).value === '' ? null : Number(f.namedItem(name).value));
    const row = { place_id: r.id, date: f.namedItem('date').value, internal: num('internal'), walkin: num('walkin'), prepared: num('prepared'), waste_kg: num('waste_kg') };
    if (!row.date) return fail('날짜를 골라 주세요.');
    if (row.date > OC.today()) return fail('오늘 이후 날짜는 입력할 수 없어요.');
    if (row.internal == null && row.walkin == null) return fail('식수를 하나 이상 입력해 주세요.');
    try {
      await OC.saveDailyCount(row);
      ['internal', 'walkin', 'prepared', 'waste_kg'].forEach((n) => (f.namedItem(n).value = ''));
      OC.toast(`${OC.fmtDate(row.date)} 실적을 저장했어요`);
      render();
    } catch (err) {
      fail('저장하지 못했어요: ' + err.message);
    }
  });

  select.addEventListener('change', () => {
    history.replaceState(null, '', `partner.html?id=${select.value}`);
    render();
  });

  /* ---------- 시작 ---------- */
  OC.ready
    .then(async () => {
      if (!OC.user()) {
        gate.innerHTML = `
          <div class="card p-10 text-center max-w-xl mx-auto">
            <p class="text-4xl">📊</p>
            <p class="mt-3 font-bold">파트너 로그인이 필요해요</p>
            <p class="mt-1 text-stone-500">식당을 운영하는 위탁업체·기관 담당자용 화면이에요.</p>
            <button id="loginBtn" class="btn mt-5 bg-[#FEE500] text-[#191919]">카카오로 시작하기</button>
          </div>`;
        document.getElementById('loginBtn').addEventListener('click', OC.signIn);
        return;
      }
      places = await OC.myManagedPlaces();
      if (!places.length) {
        gate.innerHTML = `
          <div class="card p-10 text-center max-w-xl mx-auto">
            <p class="text-4xl">🏢</p>
            <p class="mt-3 font-bold">관리하는 식당이 아직 없어요</p>
            <p class="mt-1 text-stone-500">식당 운영자라면 관리자에게 파트너 등록을 요청해 주세요.</p>
            <a href="b2g.html" class="btn btn-outline mt-5">협력 문의하기</a>
          </div>`;
        return;
      }
      gate.classList.add('hidden');
      dash.classList.remove('hidden');
      document.getElementById('ridWrap').classList.remove('hidden');
      select.innerHTML = places.map((p) => `<option value="${p.id}">${esc(p.name)}${p.status !== 'verified' ? ' (미승인)' : ''}</option>`).join('');
      const preset = Number(OC.qs('id'));
      if (places.some((p) => p.id === preset)) select.value = preset;
      countForm.elements.namedItem('date').value = OC.today();
      countForm.elements.namedItem('date').max = OC.today();
      menuForm.elements.namedItem('date').value = OC.daysFromToday(1);
      menuForm.elements.namedItem('date').min = OC.today();
      render();
    })
    .catch((err) => OC.loadError(gate, err));
})();
