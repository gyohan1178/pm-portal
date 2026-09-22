-- =====================================================================
--  견적 L/T 정리 — 2026-09-22 (v4.8.4)
--
--  견적 화면이 L/T 를 기존 칸 items.lt_weeks(주) 에서 읽도록 바뀌었다.
--  v4.8.0 에서 따로 만든 items.lt_days(일) 는 중복이라 치운다.
--  items.moq 는 원래 있던 칸이라 그대로 쓴다.
--
--   ① 현황       어디에 값이 얼마나 들어 있는지 (아무것도 안 바뀜)
--   ② 옮기기     lt_days 에 적힌 게 있으면 lt_weeks 로 (주로 올림, 비어 있는 칸만)
--   ③ 칸 지우기  lt_days 삭제
--
--  ⚠ ①을 먼저 돌려 결과를 붙여 주세요. ②③은 그다음에.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- ① 현황
-- ─────────────────────────────────────────────────────────────────────
select 'items.lt_weeks'   as 칸, count(*) filter (where lt_weeks is not null) as 값있음, count(*) as 전체 from public.items
union all
select 'items.moq',          count(*) filter (where moq is not null),         count(*) from public.items
union all
select 'items.lt_days (삭제 예정)', count(*) filter (where lt_days is not null), count(*) from public.items
union all
select 'ax_db_items.MOQ',    count(*) filter (where "MOQ" is not null),       count(*) from public.ax_db_items
union all
select 'ax_db_items.납기',   count(*) filter (where "납기" is not null),       count(*) from public.ax_db_items
union all
select 'ax_db_items.lt',     count(*) filter (where nullif(trim(lt), '') is not null), count(*) from public.ax_db_items;

-- ①-2 ax_db_items 의 lt·납기 가 어떤 모양인지 (단위 확인용)
select "품번", lt, "납기", "MOQ"
  from public.ax_db_items
 where nullif(trim(lt), '') is not null or "납기" is not null or "MOQ" is not null
 limit 15;


-- ─────────────────────────────────────────────────────────────────────
-- ② 옮기기 — lt_days 에 적힌 값을 lt_weeks 로 (lt_weeks 가 비어 있을 때만)
-- ─────────────────────────────────────────────────────────────────────
update public.items
   set lt_weeks = ceil(lt_days / 7.0)::int
 where lt_days is not null
   and lt_weeks is null;


-- ─────────────────────────────────────────────────────────────────────
-- ③ 칸 지우기 — ②를 돌린 뒤에
-- ─────────────────────────────────────────────────────────────────────
alter table public.items drop column if exists lt_days;
