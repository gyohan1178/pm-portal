-- =====================================================================
--  초도품 자재 매칭 — DB 준비 (1/2)  2026-09-22
--
--   ① items          + mfr_class · mfr_class_src       (Generic/Limited/Sole)
--   ② purchase_orders + mfr · mfr_code                 (발주마다 실제 제조사)
--   ③ 새 발주에 기준코드 DB 제조사를 자동으로 채우는 트리거
--   ④ pm_item_avl     Part Report 등록 제조사 목록(AVL)
--   ⑤ pm_fai_review   판정 수정 · 승인이력 · 비고
--   ⑥ 확인 — purchase_orders 에 걸린 트리거 목록 포함
--
--  ⚠ 전부 「칸 더하기·새로 만들기」다. 기존 값은 하나도 바뀌지 않는다. 통째로 실행해도 된다.
--  ⚠ 과거 발주에 제조사를 채우는 대량 작업은 2/2 파일로 따로 뺐다.
--     ⑥ 결과(트리거 목록)를 보고 나서 돌린다.
-- =====================================================================


-- ① 품목 구분 (Part Report 의 Mfr Classification)
alter table public.items add column if not exists mfr_class     text;   -- Generic / Limited / Sole (비면 미분류)
alter table public.items add column if not exists mfr_class_src text;   -- 기준 리포트 (모델 품번 Rev · 올린 날)
comment on column public.items.mfr_class     is 'Axcelis Mfr Classification — Generic/Limited/Sole';
comment on column public.items.mfr_class_src is 'mfr_class 를 가져온 Part Report (모델 품번 Rev · 일자)';


-- ② 발주 줄의 실제 제조사 — 발주할 때 기준코드 DB 값이 기본으로 들어가고, 고칠 수 있다
alter table public.purchase_orders add column if not exists mfr      text;
alter table public.purchase_orders add column if not exists mfr_code text;
comment on column public.purchase_orders.mfr      is '이 발주로 실제 산 제조사 (기본값: items.manufacturer)';
comment on column public.purchase_orders.mfr_code is '이 발주로 실제 산 제조사품번 (기본값: items.manufacturer_code)';


-- ③ 새 발주에 자동으로 채운다 — 발주 화면·요청BOM·부족자재·자재요청 발주(pm_request_to_po) 어디서 만들든
--    화면에서 값을 넣었으면 그대로 둔다. 고객사 PO(파는 쪽)에는 채우지 않는다.
create or replace function public.pm_po_fill_mfr()
returns trigger
language plpgsql
as $$
begin
  if new.item_id is not null
     and new.mfr is null and new.mfr_code is null
     and coalesce(new.order_type, '') <> 'customer_po' then
    select i.manufacturer, i.manufacturer_code
      into new.mfr, new.mfr_code
      from public.items i
     where i.id = new.item_id;
  end if;
  return new;
end;
$$;

drop trigger if exists pm_po_fill_mfr on public.purchase_orders;
create trigger pm_po_fill_mfr
  before insert on public.purchase_orders
  for each row execute function public.pm_po_fill_mfr();


-- ④ 등록 제조사 목록 (AVL) — Part Report 를 올릴 때 화면이 채운다
create table if not exists public.pm_item_avl (
  id          bigint generated always as identity primary key,
  item_id     uuid not null references public.items(id) on delete cascade,
  mfr         text not null default '',
  mfr_code    text not null default '',
  status      text,            -- Approved / Preferred / Approved - OBS by Mfr / Do Not Use
  rohs        text,
  cert        text,
  src_report  text,            -- 기준 Part Report (모델 품번 Rev)
  updated_at  timestamptz not null default now(),
  unique (item_id, mfr, mfr_code)
);
create index if not exists pm_item_avl_item_idx on public.pm_item_avl (item_id);

alter table public.pm_item_avl enable row level security;
drop policy if exists pm_select on public.pm_item_avl;
create policy pm_select on public.pm_item_avl for select to authenticated using (true);
drop policy if exists pm_write on public.pm_item_avl;
create policy pm_write on public.pm_item_avl for all to authenticated using (pm_can_edit()) with check (pm_can_edit());


-- ⑤ 판정 수정 · 승인이력 — 품번 단위 (원본 툴과 같게, 어느 모델에서 봐도 같은 값)
--    마지막으로 고친 모델은 model_pn·model_rev 에 남긴다.
create table if not exists public.pm_fai_review (
  id               bigint generated always as identity primary key,
  part_pn          text not null unique,   -- Axcelis 품번 (AX- 없이)
  verdict_override text,                   -- OK_M / GEN_M / APR_M / NG_M  (비면 자동 판정)
  reason           text,                   -- 판정 사유
  approval         text,                   -- 승인이력 (ECN·승인 문서 번호 등)
  note             text,
  model_pn         text,
  model_rev        text,
  updated_by       text,
  updated_at       timestamptz not null default now()
);

alter table public.pm_fai_review enable row level security;
drop policy if exists pm_select on public.pm_fai_review;
create policy pm_select on public.pm_fai_review for select to authenticated using (true);
drop policy if exists pm_write on public.pm_fai_review;
create policy pm_write on public.pm_fai_review for all to authenticated using (pm_can_edit()) with check (pm_can_edit());


-- ⑥ 확인 — 결과를 붙여 주세요
--    「PO 트리거」 줄은 2/2(과거 발주 채우기)를 돌리기 전에 봐야 한다.
--    수정할 때 도는 트리거가 있으면 대량 수정 때 같이 돈다.
select '① items 칸' as 항목,
       (select count(*)::text from information_schema.columns
         where table_schema='public' and table_name='items' and column_name in ('mfr_class','mfr_class_src')) as 값
union all select '② purchase_orders 칸',
       (select count(*)::text from information_schema.columns
         where table_schema='public' and table_name='purchase_orders' and column_name in ('mfr','mfr_code'))
union all select '④⑤ 새 표 · 정책',
       (select count(*)::text from information_schema.tables where table_schema='public' and table_name in ('pm_item_avl','pm_fai_review'))
       || ' · ' ||
       (select count(*)::text from pg_policies where schemaname='public' and tablename in ('pm_item_avl','pm_fai_review'))
union all select 'PO 트리거',
       (select string_agg(t.tgname || ' (' ||
                 case when t.tgtype & 2 = 2 then 'before' else 'after' end || ' ' ||
                 concat_ws('/', case when t.tgtype & 4 = 4 then 'insert' end,
                                 case when t.tgtype & 16 = 16 then 'update' end,
                                 case when t.tgtype & 8 = 8 then 'delete' end) || ')', ', ')
          from pg_trigger t
         where t.tgrelid = 'public.purchase_orders'::regclass and not t.tgisinternal)
union all select '채울 과거 발주 (제조사 비어 있는 구매발주)',
       (select count(*)::text from public.purchase_orders
         where mfr is null and mfr_code is null and coalesce(order_type,'') <> 'customer_po');
