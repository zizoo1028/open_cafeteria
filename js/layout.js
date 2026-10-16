/* 공통 헤더·푸터·큰 글씨 모드·로그인 버튼 */
(function () {
  const NAV = [
    ['map.html', '지도 검색'],
    ['feed.html', '후기'],
    ['share.html', '나눔 식권'],
    ['tickets.html', '내 이용권'],
    ['partner.html', '파트너'],
    ['b2g.html', '공공 협력'],
  ];
  const page = location.pathname.split('/').pop() || 'index.html';
  const html = document.documentElement;
  if (OC.load(OC.KEY.bigText, false)) html.classList.add('big-text');

  const header = document.getElementById('site-header');
  if (header) {
    const link = ([href, label], mobile) => {
      const on = page === href || (href === 'map.html' && page === 'restaurant.html');
      const badge = href === 'tickets.html' ? '<span data-ticket-badge class="hidden ml-1 min-w-[1.25rem] h-5 px-1 rounded-full bg-brand-500 text-white text-xs place-items-center"></span>' : '';
      return mobile
        ? `<a href="${href}" class="flex items-center px-4 py-3 rounded-xl font-semibold ${on ? 'bg-brand-50 text-brand-700' : 'hover:bg-stone-50'}">${label}${badge}</a>`
        : `<a href="${href}" class="inline-flex items-center px-3 py-2 rounded-xl font-semibold ${on ? 'text-brand-700 bg-brand-50' : 'text-stone-600 hover:text-ink hover:bg-stone-50'}">${label}${badge}</a>`;
    };
    header.innerHTML = `
      <div class="h-16 bg-white/95 backdrop-blur border-b border-orange-100">
        <div class="max-w-6xl mx-auto h-full px-4 flex items-center gap-2">
          <a href="index.html" class="flex items-center gap-2 font-extrabold text-xl shrink-0">
            <span class="grid place-items-center w-9 h-9 rounded-xl bg-brand-500 text-white text-lg">🍚</span>열린식당
          </a>
          <nav class="hidden lg:flex items-center gap-1 ml-6" aria-label="주요 메뉴">${NAV.map((n) => link(n)).join('')}</nav>
          <div class="ml-auto flex items-center gap-1">
            <button id="bigTextBtn" class="btn-ghost" aria-pressed="${html.classList.contains('big-text')}" title="글씨 크게 보기">
              <span class="font-extrabold">가<sup>+</sup></span><span class="hidden sm:inline">큰 글씨</span>
            </button>
            <span id="authArea" class="flex items-center"></span>
            <button id="menuBtn" class="btn-ghost lg:hidden" aria-label="메뉴 열기" aria-expanded="false">☰</button>
          </div>
        </div>
      </div>
      <nav id="mobileNav" class="hidden lg:hidden absolute left-0 right-0 bg-white border-b border-orange-100 shadow-lg p-2" aria-label="모바일 메뉴">
        ${NAV.map((n) => link(n, true)).join('')}
      </nav>`;

    document.getElementById('bigTextBtn').addEventListener('click', (e) => {
      const on = html.classList.toggle('big-text');
      OC.save(OC.KEY.bigText, on);
      e.currentTarget.setAttribute('aria-pressed', on);
      window.dispatchEvent(new Event('resize')); // 지도 크기 재계산
    });
    const menuBtn = document.getElementById('menuBtn');
    const mobileNav = document.getElementById('mobileNav');
    menuBtn.addEventListener('click', () => {
      const open = mobileNav.classList.toggle('hidden') === false;
      menuBtn.setAttribute('aria-expanded', open);
    });

    // 로그인 상태가 확인되면 버튼·이용권 개수 표시
    OC.ready
      .then(async () => {
        const area = document.getElementById('authArea');
        if (OC.user()) {
          area.innerHTML = `
            <span class="hidden md:inline text-sm font-semibold text-stone-600 mr-1">${OC.esc(OC.nickname() || '이웃')}님${OC.isAdmin() ? ' <span class="badge badge-blue">관리자</span>' : ''}</span>
            <button id="signOutBtn" class="btn-ghost text-sm">로그아웃</button>`;
          document.getElementById('signOutBtn').addEventListener('click', OC.signOut);
          if (OC.isAdmin()) {
            const on = page === 'admin.html';
            header.querySelector('nav[aria-label="주요 메뉴"]').insertAdjacentHTML('beforeend',
              `<a href="admin.html" class="inline-flex items-center px-3 py-2 rounded-xl font-semibold ${on ? 'text-blue-700 bg-blue-50' : 'text-blue-700 hover:bg-blue-50'}">⚙️ 관리</a>`);
            document.getElementById('mobileNav').insertAdjacentHTML('beforeend',
              '<a href="admin.html" class="flex items-center px-4 py-3 rounded-xl font-semibold text-blue-700 hover:bg-blue-50">⚙️ 관리자</a>');
          }
          const active = (await OC.fetchMyTickets()).filter((t) => OC.ticketState(t) === 'active').length;
          if (active) {
            document.querySelectorAll('[data-ticket-badge]').forEach((b) => {
              b.textContent = active;
              b.classList.remove('hidden');
              b.classList.add('inline-grid');
            });
          }
        } else {
          area.innerHTML = '<button id="signInBtn" class="btn-ghost text-sm font-bold text-brand-700">로그인</button>';
          document.getElementById('signInBtn').addEventListener('click', () => OC.requireLogin('후기 작성, 이용권 구매, 나눔은 로그인 후 이용할 수 있어요.'));
        }
      })
      .catch(() => {});
  }

  const footer = document.getElementById('site-footer');
  if (footer) {
    footer.innerHTML = `
      <div class="border-t border-orange-100 bg-white mt-16">
        <div class="max-w-6xl mx-auto px-4 py-8 text-sm text-stone-500">
          <p class="font-bold text-ink">🍚 열린식당 · 우리동네 거래형 구내식당 플랫폼</p>
          <p class="mt-1">창업 과제 프로토타입 · 문기주</p>
          <p class="mt-1">※ 결제는 시연용으로 실제 결제가 이뤄지지 않습니다. 식당 정보는 방문 전 한 번 더 확인해 주세요.</p>
        </div>
      </div>`;
  }
})();
