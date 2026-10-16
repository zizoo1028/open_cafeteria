-- 열린식당 권한 함수·트리거·RLS 정책

/* ---------- 권한 확인 함수 ---------- */
create function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;

-- 해당 식당의 파트너이거나 관리자
create function public.can_manage_place(p_place_id bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_admin()
      or exists (select 1 from public.place_managers where place_id = p_place_id and user_id = (select auth.uid()));
$$;

/* ---------- 트리거 ---------- */
-- 가입 시 프로필 자동 생성 (카카오 닉네임 사용)
create function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, nickname)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'nickname', new.raw_user_meta_data ->> 'full_name', '이웃'), 20)
  );
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 일반 사용자는 자기 역할(role)을 바꿀 수 없음 (대시보드·서비스 키는 허용)
create function public.guard_profile_role()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and current_user in ('anon', 'authenticated')
     and not public.is_admin() then
    new.role := old.role;
  end if;
  return new;
end;
$$;
create trigger guard_profile_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- 파트너는 식당 정보를 고칠 수 있지만 승인 상태·카카오 ID는 관리자만
create function public.guard_place_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    new.status := old.status;
    new.verified_at := old.verified_at;
    new.kakao_place_id := old.kakao_place_id;
    new.source := old.source;
  end if;
  if new.status = 'verified' and old.status is distinct from 'verified' then
    new.verified_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger guard_place_update
  before update on public.places
  for each row execute function public.guard_place_update();

-- 트리거 함수는 API로 직접 호출할 수 없게
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.guard_profile_role() from public, anon, authenticated;
revoke execute on function public.guard_place_update() from public, anon, authenticated;

/* ---------- RLS ---------- */
alter table public.profiles enable row level security;
alter table public.places enable row level security;
alter table public.place_managers enable row level security;
alter table public.menus enable row level security;
alter table public.reviews enable row level security;
alter table public.reports enable row level security;
alter table public.tickets enable row level security;
alter table public.donations enable row level security;
alter table public.share_claims enable row level security;
alter table public.daily_counts enable row level security;

-- profiles: 본인만
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or public.is_admin());
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- places: 승인된 식당은 누구나, 후보·숨김은 파트너·관리자만
create policy "places_select" on public.places
  for select to anon, authenticated using (status = 'verified' or public.can_manage_place(id));
create policy "places_insert_admin" on public.places
  for insert to authenticated with check (public.is_admin());
create policy "places_update_manager" on public.places
  for update to authenticated using (public.can_manage_place(id)) with check (public.can_manage_place(id));
create policy "places_delete_admin" on public.places
  for delete to authenticated using (public.is_admin());

-- place_managers: 본인 연결만 보기, 관리자만 지정
create policy "place_managers_select" on public.place_managers
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
create policy "place_managers_insert_admin" on public.place_managers
  for insert to authenticated with check (public.is_admin());
create policy "place_managers_delete_admin" on public.place_managers
  for delete to authenticated using (public.is_admin());

-- menus: 보이는 식당의 식단은 누구나, 등록은 파트너
create policy "menus_select" on public.menus
  for select to anon, authenticated using (exists (select 1 from public.places p where p.id = place_id));
create policy "menus_insert_manager" on public.menus
  for insert to authenticated with check (public.can_manage_place(place_id));
create policy "menus_update_manager" on public.menus
  for update to authenticated using (public.can_manage_place(place_id)) with check (public.can_manage_place(place_id));
create policy "menus_delete_manager" on public.menus
  for delete to authenticated using (public.can_manage_place(place_id));

-- reviews: 누구나 읽기, 로그인 사용자가 본인 이름으로 작성
create policy "reviews_select" on public.reviews
  for select to anon, authenticated using (true);
create policy "reviews_insert_own" on public.reviews
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "reviews_update_own" on public.reviews
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "reviews_delete_own" on public.reviews
  for delete to authenticated using (user_id = (select auth.uid()) or public.is_admin());

-- reports: 본인 제보만 보기, 처리는 관리자
create policy "reports_select" on public.reports
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
create policy "reports_insert_own" on public.reports
  for insert to authenticated with check (user_id = (select auth.uid()) and status = 'open');
create policy "reports_update_admin" on public.reports
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- tickets: 본인 또는 해당 식당 파트너만 조회. 생성·사용은 RPC로만
create policy "tickets_select" on public.tickets
  for select to authenticated using (user_id = (select auth.uid()) or public.can_manage_place(place_id));

-- donations: 본인 기부만 조회(공개 목록은 recent_donations 함수), 본인 이름으로 기부
create policy "donations_select_own" on public.donations
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
create policy "donations_insert_own" on public.donations
  for insert to authenticated with check (user_id = (select auth.uid()));

-- share_claims: 본인·관리자만 조회. 생성은 claim_share RPC로만
create policy "share_claims_select" on public.share_claims
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());

-- daily_counts: 파트너·관리자
create policy "daily_counts_all_manager" on public.daily_counts
  for all to authenticated using (public.can_manage_place(place_id)) with check (public.can_manage_place(place_id));
