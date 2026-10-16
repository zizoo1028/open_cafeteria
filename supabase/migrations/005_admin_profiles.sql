-- 관리자가 다른 사용자의 역할(user → partner)을 바꿀 수 있도록
create policy "profiles_update_admin" on public.profiles
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
