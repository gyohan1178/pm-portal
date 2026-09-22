-- =====================================================================
--  출고일을 한국 날짜로 — 2026-09-22 (A안: 이 함수만)
--
--  DB 시간대가 UTC 라 current_date 는 「세계표준시 날짜」다.
--  한국 오전 9시 전에 출고하면 출고일이 전날로 찍혔다.
--
--  바꾼 곳은 딱 한 줄:
--    movement_date  current_date  →  (now() at time zone 'Asia/Seoul')::date
--  나머지(부족 검사·strict/skip·반환값)는 원문 그대로다. 인자·반환 타입이 같아 DROP 이 필요 없다.
--
--  ⚠ DB 전체 시간대는 바꾸지 않는다 — 하네스·AXCELIS 와 같이 쓰는 DB 라서.
--  ⚠ 마지막 조회 결과를 붙여 주세요. 같은 문제가 있을 수 있는 다른 함수 목록이다.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.pm_process_outbound(p_lines jsonb, p_po_id uuid, p_note text, p_mode text DEFAULT 'strict'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  ln     jsonb;
  v_item uuid;
  v_qty  numeric;
  v_cur  numeric;
  v_name text;
  v_warn jsonb := '[]'::jsonb;
  v_cnt  int := 0;
  v_short int := 0;
begin
  -- 1차 스캔: 부족 집계
  for ln in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    v_qty := coalesce((ln->>'qty')::numeric,0);
    if v_qty <= 0 then continue; end if;
    v_item := (ln->>'item_id')::uuid;
    v_name := coalesce(ln->>'name','');
    select qty into v_cur from inventory where item_id = v_item limit 1;
    if coalesce(v_cur,0) < v_qty then
      v_short := v_short + 1;
      v_warn := v_warn || to_jsonb(v_name||': 재고 부족 (현재 '||coalesce(v_cur,0)::text||', 출고 '||v_qty::text||')');
    end if;
  end loop;

  -- strict인데 부족 있으면 아무것도 안 하고 경고만 반환
  if p_mode = 'strict' and v_short > 0 then
    return jsonb_build_object('warnings', v_warn, 'processed', 0, 'aborted', true);
  end if;

  -- 실제 출고 (트리거가 재고 차감)
  for ln in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    v_qty := coalesce((ln->>'qty')::numeric,0);
    if v_qty <= 0 then continue; end if;
    v_item := (ln->>'item_id')::uuid;
    if p_mode = 'skip' then
      select qty into v_cur from inventory where item_id = v_item limit 1;
      if coalesce(v_cur,0) < v_qty then continue; end if;
    end if;
    insert into stock_movements (item_id, movement_type, qty, po_id, memo, movement_date)
    values (v_item, '출고', v_qty, p_po_id, nullif(p_note,''),
            (now() at time zone 'Asia/Seoul')::date);   -- ← 한국 날짜 (전: current_date = UTC)
    v_cnt := v_cnt + 1;
  end loop;

  return jsonb_build_object('warnings', v_warn, 'processed', v_cnt, 'aborted', false);
end;
$function$;


-- ─────────────────────────────────────────────────────────────────────
-- 확인 — 바뀌었는지 + 같은 문제가 있을 수 있는 다른 함수
--   (pm_ 함수 중 current_date 를 쓰는 것. 하네스·AXCELIS 함수는 보지 않는다)
-- ─────────────────────────────────────────────────────────────────────
select p.proname                                        as 함수,
       (p.prosrc ~* 'Asia/Seoul')                       as 한국날짜_사용,
       (p.prosrc ~* 'current_date')                     as current_date_사용
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and (p.proname = 'pm_process_outbound'
        or (p.proname like 'pm\_%' and p.prosrc ~* 'current_date'))
 order by (p.proname = 'pm_process_outbound') desc, p.proname;
