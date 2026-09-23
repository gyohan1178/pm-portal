-- =====================================================================
--  자재요청 → 발주 생성 오류 고치기 (2/2)  2026-09-23
--
--  증상: null value in column "type" of relation "purchase_orders"
--  원인: 발주 표의 type(자재·가공) 은 반드시 있어야 하는데 함수가 안 넣었다.
--        화면에서 발주할 때는 품목의 type 을 가져다 넣고, 없으면 '자재' 로 둔다.
--
--  고친 곳
--    · 품목 마스터에서 vendor_id 와 함께 type 도 가져와 넣는다 (없으면 '자재')
--    · 앞서 고친 memo·qty_remaining·한국 날짜는 그대로
--
--  ⚠ 함수만 바꾼다. 데이터는 안 바뀐다.
--  ⚠ 맨 아래 ②번 조회 결과를 붙여 주세요 — 아직 안 채운 「반드시 필요한 칸」이
--     더 있으면 거기서 한 번에 보입니다.
-- =====================================================================

-- ① 함수 고치기
create or replace function public.pm_request_to_po(p_ids bigint[])
 returns table(done integer, failed integer, note text)
 language plpgsql
as $function$
DECLARE
  r record; v_done integer := 0; v_fail integer := 0;
  v_notes text[] := '{}'; v_po uuid; v_cs uuid; v_vendor uuid; v_type text;
BEGIN
  FOR r IN SELECT * FROM pm_material_request
            WHERE id = ANY(p_ids) AND status NOT IN ('완료','반려')
  LOOP
    IF r.item_id IS NULL THEN
      v_fail := v_fail + 1;
      v_notes := v_notes || format('%s 미등록 품목', COALESCE(r.std_code, r.item_name));
      CONTINUE;
    END IF;

    -- 고객사: 요청에 있으면 그것, 없으면 품목이 속한 BOM 기준
    v_cs := r.customer_id;
    IF v_cs IS NULL THEN
      SELECT b.customer_id INTO v_cs FROM bom b WHERE b.item_id = r.item_id LIMIT 1;
    END IF;
    IF v_cs IS NULL THEN
      v_fail := v_fail + 1;
      v_notes := v_notes || format('%s 고객사 불명', r.std_code);
      CONTINUE;
    END IF;

    -- 기본 구매처 · 구분(자재·가공) — 품목 마스터에서
    SELECT vendor_id, COALESCE(NULLIF(TRIM(type), ''), '자재')
      INTO v_vendor, v_type
      FROM items WHERE id = r.item_id;
    v_type := COALESCE(v_type, '자재');

    INSERT INTO purchase_orders (
      customer_id, item_id, vendor_id, order_type, type, status,
      qty_ordered, qty_received,
      order_date, promise_date, memo
    ) VALUES (
      v_cs, r.item_id, v_vendor, 'purchase', v_type, '진행중',
      r.qty, 0,
      (now() at time zone 'Asia/Seoul')::date,
      r.need_date,
      format('자재요청 %s · %s', r.req_no, COALESCE(r.purpose,''))
    ) RETURNING id INTO v_po;

    -- 남은 수량은 DB 가 계산하는 칸이라 손대지 않는다

    UPDATE pm_material_request
       SET status = '처리중', handle_type = '발주', po_id = v_po,
           handler_id = auth.uid(), handled_at = now()
     WHERE id = r.id;

    v_done := v_done + 1;
  END LOOP;

  BEGIN
    PERFORM pm_log('create', 'purchase_orders', NULL,
                   format('자재요청에서 발주 %s건 생성%s', v_done,
                          CASE WHEN v_fail > 0 THEN format(' · %s건 실패', v_fail) ELSE '' END));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN QUERY SELECT v_done, v_fail,
    CASE WHEN v_fail > 0 THEN array_to_string(v_notes, ' · ') END;
END $function$;


-- ─────────────────────────────────────────────────────────────────────
-- ② 확인 — 발주 표에서 「반드시 채워야 하고 기본값도 없는 칸」
--    이 목록에 함수가 안 넣는 칸이 또 있으면 같은 오류가 납니다.
--    결과를 붙여 주세요.
-- ─────────────────────────────────────────────────────────────────────
select column_name as 칸, data_type as 자료형, is_generated as 계산칸
  from information_schema.columns
 where table_schema = 'public' and table_name = 'purchase_orders'
   and is_nullable = 'NO'
   and column_default is null
   and is_generated = 'NEVER'
 order by ordinal_position;
