-- 열린식당 RPC: 이용권 구매·사용, 나눔 식권 수령, 공개 통계, 파트너 사전판매
-- 날짜·시간은 모두 한국 시간(Asia/Seoul) 기준

/* ---------- 내부 헬퍼 ---------- */
-- 그 날짜에 해당 식사를 운영하는지 (일요일 휴무, 토요일은 saturday=true일 때 중식만)
create function public.place_serves(p public.places, d date, m text)
returns boolean
language sql immutable set search_path = ''
as $$
  select case
    when extract(isodow from d) = 7 then false
    when extract(isodow from d) = 6 then p.saturday and m = 'lunch' and p.lunch_start is not null
    when m = 'lunch' then p.lunch_start is not null
    when m = 'dinner' then p.dinner_start is not null
    else false
  end;
$$;
revoke execute on function public.place_serves(public.places, date, text) from public, anon, authenticated;

/* ---------- 이용권 구매 (가격은 서버에서 계산) ---------- */
create function public.buy_ticket(p_place_id bigint, p_date date, p_meal text, p_qty integer, p_pay_method text default null)
returns public.tickets
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_place public.places;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_now time := (now() at time zone 'Asia/Seoul')::time;
  v_end time;
  v_ticket public.tickets;
begin
  if v_uid is null then
    raise exception '로그인이 필요해요' using errcode = '42501';
  end if;
  select * into v_place from public.places where id = p_place_id and status = 'verified';
  if not found then
    raise exception '식당을 찾을 수 없어요';
  end if;
  if not v_place.ticket_on_sale then
    raise exception '이용권을 판매하지 않는 식당이에요';
  end if;
  if p_qty is null or p_qty not between 1 and 10 then
    raise exception '수량은 1~10장까지 살 수 있어요';
  end if;
  if p_date is null or p_date < v_today or p_date > v_today + 14 then
    raise exception '오늘부터 2주 안의 날짜만 살 수 있어요';
  end if;
  if not public.place_serves(v_place, p_date, p_meal) then
    raise exception '그날은 해당 식사를 운영하지 않아요';
  end if;
  v_end := case p_meal when 'lunch' then v_place.lunch_end else v_place.dinner_end end;
  if p_date = v_today and v_now >= v_end then
    raise exception '오늘 해당 식사는 이미 마감됐어요';
  end if;

  insert into public.tickets (code, user_id, place_id, date, meal, qty, price, source, pay_method)
  values (
    'OC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
    v_uid, v_place.id, p_date, p_meal, p_qty, coalesce(v_place.price, 0) * p_qty, 'buy', p_pay_method
  )
  returning * into v_ticket;
  return v_ticket;
end;
$$;

/* ---------- 이용권 사용 처리 (본인 또는 식당 파트너) ---------- */
create function public.use_ticket(p_ticket_id uuid)
returns public.tickets
language plpgsql security definer set search_path = ''
as $$
declare
  v_ticket public.tickets;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found or not (v_ticket.user_id = auth.uid() or public.can_manage_place(v_ticket.place_id)) then
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

/* ---------- 나눔 식권 받기 (하루 1장, 다음 운영일 중식) ---------- */
create function public.claim_share(p_place_id bigint, p_name text, p_category text)
returns public.tickets
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_place public.places;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_now time := (now() at time zone 'Asia/Seoul')::time;
  v_remaining integer;
  v_date date;
  v_ticket public.tickets;
begin
  if v_uid is null then
    raise exception '로그인이 필요해요' using errcode = '42501';
  end if;
  if p_category not in ('65세 이상 어르신', '결식 우려 아동·청소년', '기초생활수급자·차상위', '기관 추천 (주민센터·복지관 등)') then
    raise exception '대상 구분을 선택해 주세요';
  end if;
  -- 같은 식당 동시 신청을 직렬화
  select * into v_place from public.places where id = p_place_id and status = 'verified' for update;
  if not found then
    raise exception '식당을 찾을 수 없어요';
  end if;
  if exists (
    select 1 from public.share_claims
    where user_id = v_uid and (created_at at time zone 'Asia/Seoul')::date = v_today
  ) then
    raise exception '나눔 식권은 하루 1장까지 받을 수 있어요';
  end if;

  select coalesce((select sum(qty) from public.donations where place_id = p_place_id), 0)
       - (select count(*) from public.share_claims where place_id = p_place_id)
    into v_remaining;
  if v_remaining <= 0 then
    raise exception '이 식당의 나눔 식권이 모두 소진됐어요';
  end if;

  for i in 0..7 loop
    if public.place_serves(v_place, v_today + i, 'lunch') and (i > 0 or v_now < v_place.lunch_end) then
      v_date := v_today + i;
      exit;
    end if;
  end loop;
  if v_date is null then
    raise exception '가까운 운영일이 없어요';
  end if;

  insert into public.tickets (code, user_id, place_id, date, meal, qty, price, source)
  values ('OC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)), v_uid, p_place_id, v_date, 'lunch', 1, 0, 'share')
  returning * into v_ticket;
  insert into public.share_claims (place_id, user_id, claimant_name, category, ticket_id)
  values (p_place_id, v_uid, p_name, p_category, v_ticket.id);
  return v_ticket;
end;
$$;

/* ---------- 공개 통계 (개인정보 없이 집계만) ---------- */
create function public.place_stats()
returns table (place_id bigint, rating_avg numeric, rating_count integer, share_remaining integer)
language sql stable security definer set search_path = ''
as $$
  select p.id,
         round(r.avg_rating, 2),
         coalesce(r.cnt, 0)::integer,
         greatest(coalesce(d.qty, 0) - coalesce(c.cnt, 0), 0)::integer
  from public.places p
  left join (select place_id, avg(rating) as avg_rating, count(*) as cnt from public.reviews group by place_id) r on r.place_id = p.id
  left join (select place_id, sum(qty) as qty from public.donations group by place_id) d on d.place_id = p.id
  left join (select place_id, count(*) as cnt from public.share_claims group by place_id) c on c.place_id = p.id
  where p.status = 'verified';
$$;

-- 나눔 현황 화면의 최근 기부 메시지 (기부자 user_id는 노출하지 않음)
create function public.recent_donations(p_limit integer default 10)
returns table (place_id bigint, place_name text, donor_name text, qty smallint, message text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select d.place_id, p.name, d.donor_name, d.qty, d.message, d.created_at
  from public.donations d
  join public.places p on p.id = d.place_id and p.status = 'verified'
  order by d.created_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

-- 이번 달 나눔 합계
create function public.share_summary()
returns table (month_donated integer, month_claimed integer)
language sql stable security definer set search_path = ''
as $$
  select
    coalesce((select sum(qty) from public.donations
              where date_trunc('month', created_at at time zone 'Asia/Seoul') = date_trunc('month', now() at time zone 'Asia/Seoul')), 0)::integer,
    (select count(*) from public.share_claims
     where date_trunc('month', created_at at time zone 'Asia/Seoul') = date_trunc('month', now() at time zone 'Asia/Seoul'))::integer;
$$;

/* ---------- 파트너: 날짜·식사별 사전판매 수량 ---------- */
create function public.partner_presales(p_place_id bigint, p_from date, p_to date)
returns table (date date, meal text, qty integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_manage_place(p_place_id) then
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

/* ---------- 실행 권한 ---------- */
revoke execute on function public.buy_ticket(bigint, date, text, integer, text) from public, anon;
revoke execute on function public.use_ticket(uuid) from public, anon;
revoke execute on function public.claim_share(bigint, text, text) from public, anon;
revoke execute on function public.partner_presales(bigint, date, date) from public, anon;
grant execute on function public.buy_ticket(bigint, date, text, integer, text) to authenticated;
grant execute on function public.use_ticket(uuid) to authenticated;
grant execute on function public.claim_share(bigint, text, text) to authenticated;
grant execute on function public.partner_presales(bigint, date, date) to authenticated;
grant execute on function public.place_stats() to anon, authenticated;
grant execute on function public.recent_donations(integer) to anon, authenticated;
grant execute on function public.share_summary() to anon, authenticated;
