-- =====================================================================
--  초도품 자재 매칭 — 과거 발주에 제조사 채우기 (2/2)  2026-09-22
--
--  ⚠ 1/2 를 먼저 돌리고, ⑥ 의 「PO 트리거」 결과를 확인한 뒤에 돌린다.
--  ⚠ 구매발주 수천 줄을 한 번에 고친다. 다만 1/2 에서 새로 만든 「빈 칸」(mfr·mfr_code)에만 쓴다 —
--     기존 값(수량·상태·단가 등)은 건드리지 않는다.
--  두 번 돌려도 이미 채운 줄은 다시 안 바뀐다 (비어 있는 줄만).
--
--  되돌리기: 새로 만든 칸이라 비우기만 하면 원래대로다.
--    update public.purchase_orders set mfr = null, mfr_code = null
--     where coalesce(order_type, '') <> 'customer_po';
--  ⚠ 단, 채운 뒤에 새로 만든 발주의 제조사까지 같이 지워진다. 필요하면 말해 주세요.
-- =====================================================================

-- ① 미리보기 — 몇 줄이 채워지고, 몇 줄은 기준코드 DB 에도 제조사가 없어 비는지
select count(*)                                                                  as 채울_발주,
       count(*) filter (where coalesce(i.manufacturer_code,'') <> '')            as 제조사품번_있음,
       count(*) filter (where coalesce(i.manufacturer_code,'') =  '')            as 제조사품번_없음
  from public.purchase_orders po
  join public.items i on i.id = po.item_id
 where po.mfr is null and po.mfr_code is null
   and coalesce(po.order_type, '') <> 'customer_po';

-- ② 채우기
update public.purchase_orders po
   set mfr = i.manufacturer, mfr_code = i.manufacturer_code
  from public.items i
 where i.id = po.item_id
   and po.mfr is null and po.mfr_code is null
   and coalesce(po.order_type, '') <> 'customer_po';

-- ③ 확인
select count(*) filter (where mfr is not null or mfr_code is not null) as 채워짐,
       count(*) filter (where mfr is null and mfr_code is null)        as 빈칸
  from public.purchase_orders
 where coalesce(order_type, '') <> 'customer_po';
