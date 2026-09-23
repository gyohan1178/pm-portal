-- =====================================================================
--  자재요청 → 발주 담기함 (장바구니)  2026-09-23
--
--  자재요청에서 「발주 담기」를 누르면 바로 발주가 생기지 않고 여기에 담긴다.
--  담아 둔 뒤 납기·구매처·단가를 채워서 한꺼번에 발주로 등록한다.
--
--  ⚠ 담아 둔 것은 담은 사람에게만 보인다 (각자 장바구니).
--  ⚠ 새로 만들기만 한다. 기존 표·데이터는 건드리지 않는다.
-- =====================================================================

create table if not exists public.pm_po_cart (
  id           uuid primary key default gen_random_uuid(),
  request_id   bigint,                     -- 어느 자재요청에서 담았는지 (없을 수도 있다)
  item_id      uuid not null,
  customer_id  uuid,
  vendor_id    uuid,                       -- 담을 때 품목 기본 구매처, 나중에 바꿀 수 있다
  qty          numeric not null,
  promise_date date,                       -- 납기
  unit_price   numeric,
  memo         text,
  created_by   uuid not null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists pm_po_cart_owner_idx on public.pm_po_cart (created_by, created_at);

alter table public.pm_po_cart enable row level security;

-- 내가 담은 것만 보이고, 내가 담은 것만 고치거나 지울 수 있다
drop policy if exists pm_select on public.pm_po_cart;
create policy pm_select on public.pm_po_cart
  for select to authenticated using (created_by = auth.uid());

drop policy if exists pm_write on public.pm_po_cart;
create policy pm_write on public.pm_po_cart
  for all to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());


-- ─────────────────────────────────────────────────────────────────────
-- 확인 — 결과를 붙여 주세요
-- ─────────────────────────────────────────────────────────────────────
select '표' as 항목,
       (select count(*) from information_schema.tables
         where table_schema = 'public' and table_name = 'pm_po_cart') as 값
union all
select '정책',
       (select count(*) from pg_policies
         where schemaname = 'public' and tablename = 'pm_po_cart')
union all
select '담긴 줄',
       (select count(*) from public.pm_po_cart);
