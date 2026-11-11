-- 판매 실적가 (v4.162.0) — 미리보기 (바꾸는 것 없음 · 조회만)
select '① 견적 표 id 형식' as 항목, format_type(a.atttypid, a.atttypmod) as 값
  from pg_attribute a where a.attrelid = 'public.pm_quotes'::regclass and a.attname = 'id'
union all
select '② 수정 권한 함수 pm_can_edit', case when to_regprocedure('public.pm_can_edit()') is not null then '있음' else '없음 ⚠ — 알려 주세요' end
union all
select '③ 같은 이름 표 (있으면 안 만듦)', case when to_regclass('public.pm_sale_price_hist') is not null then '이미 있음' else '없음 → 새로 만듦' end
union all
select '④ 같은 이름 함수', case when to_regprocedure('public.pm_last_sale_price(text,text,text[])') is not null then '이미 있음 → 바꿈' else '없음 → 새로 만듦' end
union all
select '⑤ 매출견적 수 (참고)', (select count(*)::text from pm_quotes where quote_kind = 'sales');
