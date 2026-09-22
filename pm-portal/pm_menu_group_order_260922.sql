-- =====================================================================
--  사이드바 그룹 순서 — 계정별 저장 (v4.11.0)  2026-09-22
--
--  pm_profiles 에 칸 하나를 더하고, 본인 줄만 고치는 함수를 만든다.
--  즐겨찾기·숨김(pm_save_menu_prefs)과 같은 곳에 저장된다.
--  ⚠ 새로 만들기뿐이다. 기존 값은 바뀌지 않는다. 통째로 실행해도 된다.
-- =====================================================================

alter table public.pm_profiles add column if not exists menu_group_order text[];
comment on column public.pm_profiles.menu_group_order is '사이드바 그룹 순서 (mat·buy·sales·floor·quality·report·master·etc)';

drop function if exists public.pm_save_menu_group_order(text[]);
create function public.pm_save_menu_group_order(p_order text[])
returns void
language sql
security definer
set search_path = public
as $$
  -- 로그인한 본인 줄만 고친다
  update public.pm_profiles set menu_group_order = p_order where id = auth.uid();
$$;
grant execute on function public.pm_save_menu_group_order(text[]) to authenticated;

-- 확인
select (select count(*) from information_schema.columns
         where table_schema='public' and table_name='pm_profiles' and column_name='menu_group_order') as 칸,
       (select count(*) from pg_proc where proname = 'pm_save_menu_group_order')              as 함수;
