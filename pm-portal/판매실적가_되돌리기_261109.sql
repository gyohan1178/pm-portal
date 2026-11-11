-- 판매 실적가 (v4.162.0) — 되돌리기
--   ⚠ 표를 지우면 그동안 쌓인 판매 실적가 기록도 같이 사라집니다. 견적(pm_quotes · pm_quote_items)은 그대로입니다.
--   화면(v4.162.0)은 표가 없으면 「표가 아직 없습니다」 안내만 띄우고 예전처럼 계산합니다.
drop function if exists public.pm_last_sale_price(text, text, text[]);
drop table if exists public.pm_sale_price_hist;
select '판매 실적가 표 · 함수 지움' as 결과;
