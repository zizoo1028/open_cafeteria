-- 권한 확인 함수(is_admin, can_manage_place)를 API로 노출되지 않는 private 스키마로 이동
-- RLS 정책은 함수 OID로 연결돼 있어 그대로 동작하고, 함수 본문에서 이름으로 부르는 곳만 다시 정의한다.

create schema if not exists private;
grant usage on schema private to anon, authenticated;

alter function public.is_admin() set schema private;
alter function public.can_manage_place(bigint) set schema private;

create or replace function private.can_manage_place(p_place_id bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_admin()
      or exists (select 1 from public.place_managers where place_id = p_place_id and user_id = (select auth.uid()));
$$;

create or replace function public.guard_profile_role()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and current_user in ('anon', 'authenticated')
     and not private.is_admin() then
    new.role := old.role;
  end if;
  return new;
end;
$$;

create or replace function public.guard_place_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') and not private.is_admin() then
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

create or replace function public.use_ticket(p_ticket_id uuid)
returns public.tickets
language plpgsql security definer set search_path = ''
as $$
declare
  v_ticket public.tickets;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found or not (v_ticket.user_id = auth.uid() or private.can_manage_place(v_ticket.place_id)) then
    raise exception '이용권을 찾을 수 없어요';
  end if;
  if v_ticket.status <> 'paid' then
    raise exception '이미 사용했거나 환불된 이용권이에요';
  end if;
  if v_ticket.date < v_today then
    raise exception '기간이 지난 이용권이에요';
  end if;
  update public.tickets set status = 'used', used_at = now() where id = p_ticket_id returning * into v_ticket;
  return v_ticket;
end;
$$;

create or replace function public.partner_presales(p_place_id bigint, p_from date, p_to date)
returns table (date date, meal text, qty integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.can_manage_place(p_place_id) then
    raise exception '권한이 없어요' using errcode = '42501';
  end if;
  return query
    select t.date, t.meal, sum(t.qty)::integer
    from public.tickets t
    where t.place_id = p_place_id and t.source = 'buy' and t.status <> 'refunded'
      and t.date between p_from and p_to
    group by t.date, t.meal
    order by t.date, t.meal;
end;
$$;
