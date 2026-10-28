-- ============================================================
-- 수주대장 빠르게 열기 — v4.103.0
--   예전: 열 때마다 수주 줄 13,527줄 전부(약 11.5MB) — 진행 중은 1,916줄뿐
--   이제: ① 진행 중 줄만 전체 칸으로 (1,916줄 · 1.4MB)  ② 지난 줄은 「특이사항(바로 앞 PO 비교) · PO 단계」에 꼭 필요한 줄 · 칸만 (876줄 · 0.2MB)
--         ③ 예상 매출 · 단가 없는 품목 수는 DB 가 합계만 계산 (검색어도 화면과 같이 반영)
--   「납품 완료 · 취소 · 전체」 보기 · 이번 달 접수 · 단가 없는 품목 목록 · 이카운트 대조 · 코드 정리 탭은 예전처럼 전부 받는다
--   보기 2개 · 합계 함수 1개만 만든다 (표 · 데이터는 안 바뀜). 두 번 실행해도 안전
--   ⚠ 진행 중 줄 보기는 만들 때의 칸을 기억한다 — 나중에 pm_order_line 에 칸을 더하면 이 파일을 다시 실행 (그대로 다시 실행해도 됨)
--   되돌리기: 수주대장_빠르게_되돌리기_261026.sql (되돌려도 화면은 예전처럼 전부 받아서 그대로 동작)
-- ============================================================
begin;
-- 진행 중 = 취소 아님(줄 · PO) + (수량 0 이거나 납품 < 수량) — 화면 lineState 와 같은 기준
--   품목 코드 · 품명도 같이 (따로 받으면 왕복이 3번 더 생김). 품목 칸을 앞에 둬야 나중에 이 파일을 다시 실행해도 된다
create or replace view public.pm_order_line_live_v with (security_invoker = true) as
select i.std_code as item_std_code, i.name as item_name, i.js_code as item_js_code, l.*
  from public.pm_order_line l
  join public.pm_order o on o.id = l.order_id
  left join public.items i on i.id = l.item_id
 where not coalesce(l.cancelled, false) and not coalesce(o.cancelled, false)
   and not (coalesce(l.qty, 0) > 0 and coalesce(l.delivered_qty, 0) >= l.qty);

-- 지난 줄 (진행 중 아님) 중 화면 계산에 필요한 것만 — 2.4MB → 0.2MB
--   ① 진행 중 줄이 있는 PO 의 나머지 줄 (PO 단계 · 부분 납품 표시)
--   ② 특이사항 「바로 앞 PO」 후보 — 진행 중 줄마다 같은 품목(고객사 · 품목, 없으면 고객사 품번)에서
--      다른 PO 이면서 날짜(발주일 → 납기 → 접수일)가 더 이른 줄 중 가장 늦은 날짜의 줄 전부 (같은 통화 기준도 따로)
--      → 화면의 특이사항 계산(oddsOf)이 고르는 줄이 반드시 들어 있어 결과가 예전과 똑같다
create or replace view public.pm_order_line_hist_v with (security_invoker = true) as
with base as materialized (
  select l.id, l.order_id, l.line_no, l.del_line, l.item_id, l.raw_pn, l.rev, l.qty, l.unit_price, l.due_date,
         l.delivered_qty, l.cancelled, l.reply,
         coalesce(o.currency = 'USD' or o.ccn = 'B', false) as usd,
         (not coalesce(l.cancelled, false) and not coalesce(o.cancelled, false)
          and not (coalesce(l.qty, 0) > 0 and coalesce(l.delivered_qty, 0) >= l.qty)) as live,
         (not coalesce(l.cancelled, false) and not coalesce(o.cancelled, false) and not coalesce(o.planned, false)) as grp_ok,
         coalesce(o.customer_code, '') || '|' || case when l.item_id is not null then l.item_id::text
              else 'pn:' || regexp_replace(upper(coalesce(l.raw_pn, '')), '[^0-9A-Z가-힣]', '', 'g') end as gk,
         left(coalesce(o.order_date::text, l.due_date::text, (o.registered_at at time zone 'UTC')::date::text, ''), 10) as od
    from public.pm_order_line l join public.pm_order o on o.id = l.order_id),
g as materialized (select * from base where grp_ok and gk not like '%|pn:'),
lv as materialized (select * from g where live),
pm as (select lv.id, lv.gk, lv.order_id, max(x.od) as md
         from lv join g x on x.gk = lv.gk and x.order_id <> lv.order_id and x.od < lv.od group by 1, 2, 3),
pu as (select lv.id, lv.gk, lv.order_id, lv.usd, max(x.od) as md
         from lv join g x on x.gk = lv.gk and x.order_id <> lv.order_id and x.od < lv.od and x.usd = lv.usd group by 1, 2, 3, 4),
cand as (select c.id from pm join g c on c.gk = pm.gk and c.od = pm.md and c.order_id <> pm.order_id
         union
         select c.id from pu join g c on c.gk = pu.gk and c.od = pu.md and c.order_id <> pu.order_id and c.usd = pu.usd)
select b.id, b.order_id, b.line_no, b.del_line, b.item_id, b.raw_pn, b.rev, b.qty, b.unit_price, b.due_date, b.delivered_qty, b.cancelled, b.reply
  from base b
 where not b.live
   and (b.order_id in (select order_id from base where live) or b.id in (select id from cand));

-- 예상 매출 · 단가 없는 품목 — 고객사 · 달러 여부 · 납기 연도별 합계 (취소 줄 · 취소 PO 뺌, 납품 완료 포함)
--   p_q = 화면 검색어 — 화면과 같은 칸(PO번호 · 파일 · 납품처 · 품번 · 품명 · 고객사 품번 · 품명 · 비고 · Plnd · Prod)에 들어 있으면 (대소문자 무시)
create or replace function public.pm_order_money(p_q text default null)
returns table(customer_code text, usd boolean, y int, amt numeric, done numeric, no_price bigint, n bigint)
language sql stable as $$
  select o.customer_code,
         coalesce(o.currency = 'USD' or o.ccn = 'B', false),
         extract(year from l.due_date)::int,
         sum(coalesce(l.qty, 0) * coalesce(l.unit_price, 0)),
         sum(least(coalesce(l.delivered_qty, 0), coalesce(l.qty, 0)) * coalesce(l.unit_price, 0)),
         count(*) filter (where not (coalesce(l.unit_price, 0) > 0)),
         count(*)
    from public.pm_order_line l
    join public.pm_order o on o.id = l.order_id
    left join public.items i on i.id = l.item_id
   where not coalesce(l.cancelled, false) and not coalesce(o.cancelled, false)
     and (coalesce(btrim(p_q), '') = ''
          or strpos(upper(concat_ws(chr(1), o.po_no, o.file_name, o.ship_to, i.std_code, i.name, l.raw_pn, l.raw_desc, l.note, l.plnd_no, l.prod_no)),
                    upper(btrim(p_q))) > 0)
   group by 1, 2, 3
$$;
grant execute on function public.pm_order_money(text) to authenticated;
comment on view public.pm_order_line_live_v is '수주대장 진행 중 줄 (v4.103.0)';
comment on view public.pm_order_line_hist_v is '수주대장 지난 줄 중 특이사항 · PO 단계 계산에 필요한 것만 (v4.103.0)';
grant select on public.pm_order_line_live_v, public.pm_order_line_hist_v to authenticated;
commit;
