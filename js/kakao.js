/* 카카오맵 SDK 로더 (키는 js/config.js)
 * JavaScript 키는 카카오 콘솔의 [JavaScript SDK 도메인]에 등록된 주소에서만 동작합니다.
 * (현재 등록: http://localhost:8123)
 */
(function () {
  let loading = null;

  // SDK를 한 번만 불러오고, 준비되면 resolve
  OC.kakaoReady = function () {
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      if (window.kakao && kakao.maps && kakao.maps.LatLng) return resolve();
      const s = document.createElement('script');
      s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${OC_CONFIG.kakaoJsKey}&libraries=services,clusterer&autoload=false`;
      s.onload = () => kakao.maps.load(resolve);
      s.onerror = () => reject(new Error('Kakao SDK load failed'));
      document.head.appendChild(s);
    });
    return loading;
  };

  // 지도 영역에 오류 안내 표시
  OC.kakaoError = function (el) {
    el.innerHTML = `
      <div class="absolute inset-0 grid place-items-center bg-stone-50 p-6 text-center">
        <div>
          <p class="text-4xl">🗺️</p>
          <p class="mt-3 font-bold">카카오맵을 불러오지 못했어요</p>
          <p class="mt-1 text-sm text-stone-500">카카오 콘솔의 JavaScript SDK 도메인에 등록된 주소<br>(http://localhost:8123)로 열었는지 확인해 주세요.</p>
        </div>
      </div>`;
  };

  // Leaflet 시절 CSS(.pin, .me-dot)를 그대로 쓰기 위해 크기 0짜리 기준점으로 감싼 오버레이 요소
  OC.overlayEl = function (html) {
    const el = document.createElement('div');
    el.className = 'pin-anchor';
    el.innerHTML = html;
    return el;
  };
})();
