-- ============================================================
-- 수주대장 빠르게 열기 되돌리기 — 보기 2개 · 합계 함수 1개만 지운다 (데이터는 그대로)
--   지우면 수주대장은 예전처럼 전부 받아서 그대로 동작한다
-- ============================================================
begin;
drop function if exists public.pm_order_money(text);
drop view if exists public.pm_order_line_hist_v;
drop view if exists public.pm_order_line_live_v;
commit;
