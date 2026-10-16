-- 열린식당 기본 스키마: 식당·식단·후기·제보·이용권·나눔

-- 사용자 프로필 (auth.users 1:1)
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text check (char_length(nickname) between 1 and 20),
  role text not null default 'user' check (role in ('user', 'partner', 'admin')),
  created_at timestamptz not null default now()
);

-- 구내식당·한식뷔페
create table public.places (
  id bigint generated always as identity primary key,
  kakao_place_id text unique,                 -- 카카오 장소 ID (등록 안 된 구내식당은 null)
  type text not null check (type in ('cafeteria', 'buffet')),
  name text not null,
  short_name text,                            -- 지도 말풍선용 짧은 이름
  building text,                              -- 층·위치
  address text not null,
  lat double precision not null check (lat between 33 and 39),
  lng double precision not null check (lng between 124 and 132),
  phone text,
  price integer check (price >= 0),
  lunch_start time,
  lunch_end time,
  dinner_start time,
  dinner_end time,
  saturday boolean not null default false,    -- 토요일 중식 운영
  public_note text,                           -- 외부인 입장 조건
  operator text,                              -- 위탁업체·운영기관
  capacity integer check (capacity > 0),
  ticket_on_sale boolean not null default false,
  tags text[] not null default '{}',
  description text,
  status text not null default 'candidate' check (status in ('candidate', 'verified', 'hidden')),
  source text not null default 'manual' check (source in ('search', 'report', 'partner', 'manual')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((lunch_start is null) = (lunch_end is null)),
  check ((dinner_start is null) = (dinner_end is null))
);
create index places_status_lat_lng_idx on public.places (status, lat, lng);

-- 파트너(위탁업체·기관)가 관리하는 식당
create table public.place_managers (
  place_id bigint not null references public.places (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (place_id, user_id)
);
create index place_managers_user_idx on public.place_managers (user_id);

-- 식단 (items: [{n: 메뉴명, k: kcal, c: 탄수화물g, p: 단백질g, f: 지방g}])
create table public.menus (
  id bigint generated always as identity primary key,
  place_id bigint not null references public.places (id) on delete cascade,
  date date not null,
  meal text not null check (meal in ('lunch', 'dinner')),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 15),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (place_id, date, meal)
);
create index menus_created_by_idx on public.menus (created_by);

-- 후기
create table public.reviews (
  id bigint generated always as identity primary key,
  place_id bigint not null references public.places (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 20),
  rating smallint not null check (rating between 1 and 5),
  body text not null check (char_length(body) between 5 and 300),
  created_at timestamptz not null default now()
);
create index reviews_place_idx on public.reviews (place_id, created_at desc);
create index reviews_user_idx on public.reviews (user_id);

-- 사용자 제보 (새 식당, 정보 오류, 폐업 등)
create table public.reports (
  id bigint generated always as identity primary key,
  place_id bigint references public.places (id) on delete set null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('new_place', 'wrong_info', 'closed', 'other')),
  place_name text,
  address text,
  content text not null check (char_length(content) between 2 and 1000),
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  created_at timestamptz not null default now()
);
create index reports_place_idx on public.reports (place_id);
create index reports_user_idx on public.reports (user_id);

-- 이용권 (구매·나눔 모두). 생성은 RPC(buy_ticket, claim_share)로만
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  place_id bigint not null references public.places (id) on delete restrict,
  date date not null,
  meal text not null check (meal in ('lunch', 'dinner')),
  qty smallint not null check (qty between 1 and 10),
  price integer not null check (price >= 0),
  source text not null check (source in ('buy', 'share')),
  pay_method text,
  status text not null default 'paid' check (status in ('paid', 'used', 'refunded')),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index tickets_user_idx on public.tickets (user_id, date);
create index tickets_place_date_idx on public.tickets (place_id, date);

-- 나눔 식권 기부
create table public.donations (
  id bigint generated always as identity primary key,
  place_id bigint not null references public.places (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  donor_name text not null default '익명' check (char_length(donor_name) between 1 and 20),
  qty smallint not null check (qty between 1 and 50),
  message text check (char_length(message) <= 40),
  created_at timestamptz not null default now()
);
create index donations_place_idx on public.donations (place_id);
create index donations_user_idx on public.donations (user_id);

-- 나눔 식권 수령 (취약계층 정보라 본인·관리자만 조회)
create table public.share_claims (
  id bigint generated always as identity primary key,
  place_id bigint not null references public.places (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  claimant_name text not null check (char_length(claimant_name) between 1 and 20),
  category text not null,
  ticket_id uuid references public.tickets (id) on delete set null,
  created_at timestamptz not null default now()
);
create index share_claims_place_idx on public.share_claims (place_id);
create index share_claims_user_idx on public.share_claims (user_id, created_at);
create index share_claims_ticket_idx on public.share_claims (ticket_id);

-- 파트너가 입력하는 일별 실적 (식수 예측용)
create table public.daily_counts (
  place_id bigint not null references public.places (id) on delete cascade,
  date date not null,
  internal integer check (internal >= 0),     -- 임직원
  walkin integer check (walkin >= 0),         -- 외부 현장
  prepared integer check (prepared >= 0),     -- 준비량
  waste_kg numeric(6, 1) check (waste_kg >= 0),
  primary key (place_id, date)
);
