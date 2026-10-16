-- 식당별 외부 식단표 페이지 링크 (구청 홈페이지 식단 게시판, 인스타그램 등)
-- 웹 주소만 허용 (javascript: 같은 위험한 링크 차단)
alter table public.places
  add column menu_url text check (menu_url is null or menu_url ~* '^https?://[^\s]+$');
