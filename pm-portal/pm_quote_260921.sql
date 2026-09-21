-- =====================================================================
--  PM Portal v4.8.0 — 견적 임시저장 · 마진구간 설정 · 품목 L/T·MOQ
--  2026-09-21
--
--   ① pm_quote_drafts            견적 임시저장(보관함)
--   ② pm_settings                마진 구간·작업비 마진 (모든 PC 공통)
--   ③ items.lt_days · items.moq  품목별 납기·최소주문수량
--   ④ 확인 조회
--
--  ⚠ 전부 「새로 만들기」와 「칸 더하기」뿐입니다. 기존 데이터는 바뀌지 않습니다.
--  ⚠ 한 번에 실행해도 되고 ①②③ 블록을 따로 실행해도 됩니다.
--  ⚠ 이 SQL 을 돌리기 전에 배포해도 화면은 뜹니다(기본 마진구간으로 돌고,
--     보관함은 비어 보입니다). 다만 임시저장 버튼은 오류가 납니다.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- ① 견적 임시저장 (보관함)
--    견적번호를 따지 않고 화면 상태를 통째로 담아 둔다.
--    pm_quotes 는 손대지 않는다 — 채번·이력·집계가 그대로 유지된다.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.pm_quote_drafts (
  id          uuid primary key default gen_random_uuid(),
  title       text,                                   -- 목록에 보일 이름(프로젝트명 또는 품번)
  quote_kind  text not null default 'sales',          -- sales | purchase
  customer_id uuid,
  payload     jsonb not null,                         -- 견적 화면 상태 전체
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists pm_quote_drafts_updated_idx
  on public.pm_quote_drafts (updated_at desc);

alter table public.pm_quote_drafts enable row level security;

drop policy if exists pm_select on public.pm_quote_drafts;
create policy pm_select on public.pm_quote_drafts
  for select to authenticated using (true);

drop policy if exists pm_write on public.pm_quote_drafts;
create policy pm_write on public.pm_quote_drafts
  for all to authenticated using (pm_can_edit()) with check (pm_can_edit());


-- ─────────────────────────────────────────────────────────────────────
-- ② 공용 설정 — 마진 구간 · 작업비 마진
--    키-값 한 칸짜리 표. 앞으로 다른 공용 설정도 여기에 담으면 된다.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.pm_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.pm_settings enable row level security;

drop policy if exists pm_select on public.pm_settings;
create policy pm_select on public.pm_settings
  for select to authenticated using (true);

drop policy if exists pm_write on public.pm_settings;
create policy pm_write on public.pm_settings
  for all to authenticated using (pm_can_edit()) with check (pm_can_edit());

-- 지금 쓰고 있던 값 그대로 심는다. 이미 있으면 건드리지 않는다.
insert into public.pm_settings (key, value)
values (
  'quote_margin',
  '{
     "tiers": [
       {"min": 1000000, "pct": 0.20},
       {"min": 100000,  "pct": 0.25},
       {"min": 10000,   "pct": 0.35},
       {"min": 0,       "pct": 0.45}
     ],
     "laborMarg": 0.25
   }'::jsonb
)
on conflict (key) do nothing;


-- ─────────────────────────────────────────────────────────────────────
-- ③ 품목별 납기 · 최소주문수량
--    견적 화면 세부견적 표에서 바로 적어 넣으면 여기에 쌓인다.
-- ─────────────────────────────────────────────────────────────────────
alter table public.items add column if not exists lt_days integer;
alter table public.items add column if not exists moq     numeric;

comment on column public.items.lt_days is '표준 납기(일) — 발주 후 입고까지';
comment on column public.items.moq     is '최소 주문수량(MOQ)';


-- ─────────────────────────────────────────────────────────────────────
-- ④ 확인 조회 — 아래 결과를 붙여 주세요
-- ─────────────────────────────────────────────────────────────────────
select '① 보관함' as 항목,
       (select count(*) from information_schema.tables
         where table_schema='public' and table_name='pm_quote_drafts') as 생성,
       (select count(*) from pg_policies
         where schemaname='public' and tablename='pm_quote_drafts') as 정책수
union all
select '② 설정',
       (select count(*) from information_schema.tables
         where table_schema='public' and table_name='pm_settings'),
       (select count(*) from public.pm_settings where key='quote_margin')
union all
select '③ 품목칸',
       (select count(*) from information_schema.columns
         where table_schema='public' and table_name='items' and column_name='lt_days'),
       (select count(*) from information_schema.columns
         where table_schema='public' and table_name='items' and column_name='moq');
