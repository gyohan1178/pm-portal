-- =====================================================================
--  원가절감 실적 대장  2026-09-23
--
--  「무엇을 해서 얼마를 아꼈는지」를 한 줄씩 남기는 표.
--  포털이 입고 단가 변화를 보고 후보를 띄워 주면, 유형·사유만 골라 등록한다.
--
--  절감액 = (기준단가 − 적용단가) × 수량
--    기준단가 : 직전 12개월 가중평균 매입가 (확정 규칙)
--    수량     : 실제 입고수량 (확정 규칙)
--
--  ⚠ 새 표 두 개만 만든다. 기존 표·데이터는 건드리지 않는다.
-- =====================================================================

-- ① 실적 대장
create table if not exists public.pm_cost_saving (
  id          uuid primary key default gen_random_uuid(),
  ym          text not null,               -- 인정 월 'YYYY-MM'
  kind        text not null,               -- 단가인하 · 업체변경 · 대체품 · 사양변경 · 발주통합 · 물류 · 클레임 · 기타
  item_id     uuid,
  std_code    text,                        -- 품목이 지워져도 보고서가 남도록 코드·품명을 같이 적어 둔다
  item_name   text,
  vendor_id   uuid,
  vendor_name text,
  po_number   text,                        -- 근거 발주번호
  base_price  numeric,                     -- 기준단가 (직전 12개월 가중평균)
  new_price   numeric,                     -- 적용단가
  qty         numeric,                     -- 인정 수량 (실제 입고수량)
  amount      numeric not null,            -- 절감액 (원). 등록 시점에 계산해 박아 둔다
  note        text,                        -- 사유·비고
  source      text not null default 'auto',-- auto(자동 후보에서 등록) · manual(직접 입력)
  status      text not null default '등록',-- 등록 · 승인 · 반려
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  updated_at  timestamptz not null default now()
);

create index if not exists pm_cost_saving_ym_idx on public.pm_cost_saving (ym);
create index if not exists pm_cost_saving_item_idx on public.pm_cost_saving (item_id);

alter table public.pm_cost_saving enable row level security;

-- 실적은 팀 전체가 본다. 쓰기는 편집 권한이 있는 사람만 (다른 표와 같은 규칙)
drop policy if exists pm_select on public.pm_cost_saving;
create policy pm_select on public.pm_cost_saving
  for select to authenticated using (true);

drop policy if exists pm_write on public.pm_cost_saving;
create policy pm_write on public.pm_cost_saving
  for all to authenticated using (pm_can_edit()) with check (pm_can_edit());


-- ② 자동 후보에서 「관심 없음」으로 치운 것 (다시 안 뜨게)
create table if not exists public.pm_cost_saving_skip (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,          -- 후보 식별자 (품목|입고일|단가)
  reason     text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.pm_cost_saving_skip enable row level security;

drop policy if exists pm_select on public.pm_cost_saving_skip;
create policy pm_select on public.pm_cost_saving_skip
  for select to authenticated using (true);

drop policy if exists pm_write on public.pm_cost_saving_skip;
create policy pm_write on public.pm_cost_saving_skip
  for all to authenticated using (pm_can_edit()) with check (pm_can_edit());


-- ③ 연간 목표 — 이미 쓰고 있는 공용 설정표에 한 줄 넣는다 (없으면 0)
insert into public.pm_settings (key, value)
values ('cost_saving_target', '{"year": 2026, "amount": 0}'::jsonb)
on conflict (key) do nothing;


-- ─────────────────────────────────────────────────────────────────────
-- 확인 — 결과를 붙여 주세요
-- ─────────────────────────────────────────────────────────────────────
select '실적 대장' as 항목,
       (select count(*) from information_schema.tables
         where table_schema='public' and table_name='pm_cost_saving') as 표,
       (select count(*) from pg_policies
         where schemaname='public' and tablename='pm_cost_saving') as 정책
union all
select '후보 숨김',
       (select count(*) from information_schema.tables
         where table_schema='public' and table_name='pm_cost_saving_skip'),
       (select count(*) from pg_policies
         where schemaname='public' and tablename='pm_cost_saving_skip')
union all
select '연간 목표 설정',
       (select count(*) from public.pm_settings where key='cost_saving_target'), 0;
