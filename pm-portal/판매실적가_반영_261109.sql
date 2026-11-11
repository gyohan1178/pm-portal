-- 판매 실적가 (v4.162.0) — 반영
--   고객사에 낸 판매단가를 품목 · ASSY 하위 부품별로 남긴다 (매출견적 저장 때 화면이 기록)
--   다음 견적에서 같은 고객사 · 같은 통화의 직전 값을 불러와 그대로 쓴다 → 세부견적 하위 부품 단가가 견적마다 바뀌지 않게
--   · 새 표 pm_sale_price_hist · 조회 함수 pm_last_sale_price 만 만든다 (기존 표 · 함수는 안 건드림)
--   · 견적을 지우면(pm_delete_quote) 그 견적의 실적가도 같이 지워진다
--   · 예전 이력 가져오기용 칸(source = 'import', quote_id 없음)도 같이 둔다
do $$
declare t text;
begin
  select format_type(a.atttypid, a.atttypmod) into t
    from pg_attribute a where a.attrelid = 'public.pm_quotes'::regclass and a.attname = 'id' and not a.attisdropped;
  if t is null then raise exception 'pm_quotes.id 를 찾지 못했습니다 — 멈춥니다'; end if;
  if to_regclass('public.pm_sale_price_hist') is null then
    execute format($f$
      create table public.pm_sale_price_hist (
        id            bigserial primary key,
        cust_key      text not null,              -- 고객사 id, 고객사 없는 견적은 ETC:이름
        customer_id   uuid,
        customer_name text,
        code_key      text not null,              -- 기준코드(대문자), 코드 없는 부품은 MPN:제조사품번
        std_code      text,
        mpn           text,
        item_name     text,
        kind          text not null check (kind in ('item', 'part', 'assy')),
        parent_code   text,                       -- 부품이면 그 ASSY 코드
        currency      text not null,
        unit_price    numeric not null check (unit_price > 0),
        qty           numeric,
        cost_krw      numeric,                    -- 그때 매입가(부품) · 원가(줄)
        detail_sent   boolean not null default false,  -- 세부견적으로 실제 나간 값
        quote_id      %s references public.pm_quotes(id) on delete cascade,
        quote_no      text,
        quote_date    date,
        source        text not null default 'quote',   -- quote · import
        created_by    text,
        created_at    timestamptz not null default now()
      )$f$, t);
  end if;
end $$;

create index if not exists pm_sale_price_hist_lookup on public.pm_sale_price_hist (cust_key, currency, code_key, quote_date desc);
create index if not exists pm_sale_price_hist_quote on public.pm_sale_price_hist (quote_id);

alter table public.pm_sale_price_hist enable row level security;
drop policy if exists pm_select on public.pm_sale_price_hist;
create policy pm_select on public.pm_sale_price_hist
  for select to authenticated using (true);
drop policy if exists pm_write on public.pm_sale_price_hist;
create policy pm_write on public.pm_sale_price_hist
  for all to authenticated using (pm_can_edit()) with check (pm_can_edit());
grant select, insert, update, delete on public.pm_sale_price_hist to authenticated;
grant usage, select on sequence public.pm_sale_price_hist_id_seq to authenticated;

-- 직전 실적가 — 품목 · 부품마다 가장 최근 하나
--   단품 줄 단가 + 세부견적으로 실제 나간 부품 단가만 (세부견적 안 낸 견적의 부품 계산값은 기록만 · ASSY 줄 자체 값은 안 씀 — ASSY 는 하위 합계로)
create or replace function public.pm_last_sale_price(p_cust_key text, p_currency text, p_keys text[])
returns table(code_key text, unit_price numeric, currency text, quote_no text, quote_date date,
              detail_sent boolean, parent_code text, kind text)
language sql stable
set search_path = public
as $$
  select distinct on (h.code_key) h.code_key, h.unit_price, h.currency, h.quote_no, h.quote_date,
         h.detail_sent, h.parent_code, h.kind
    from pm_sale_price_hist h
   where h.cust_key = p_cust_key and h.currency = p_currency
     and h.code_key = any (p_keys)
     and (h.kind = 'item' or (h.kind = 'part' and h.detail_sent))
   order by h.code_key, h.quote_date desc nulls last, h.created_at desc, h.id desc
$$;
revoke all on function public.pm_last_sale_price(text, text, text[]) from public, anon;
grant execute on function public.pm_last_sale_price(text, text, text[]) to authenticated;

select '판매 실적가 표 · 함수 준비됨' as 결과,
       (select count(*) from public.pm_sale_price_hist) as 기록_줄;
