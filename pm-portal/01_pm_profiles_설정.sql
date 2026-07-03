-- ═══════════════════════════════════════════════════════════
-- PM-Portal 인증·권한 시스템 — pm_profiles (분리 버전)
--
-- ⚠️ 기존 public.profiles 는 [하네스 공정관리] 사이트가 사용 중!
--    절대 건드리지 않습니다. PM-Portal은 별도 테이블 pm_profiles 사용.
--
-- 같은 Supabase 프로젝트를 두 사이트가 공유하므로,
-- auth.users(로그인 계정)는 공통이지만 권한 테이블은 분리합니다.
-- ═══════════════════════════════════════════════════════════

-- 1) PM-Portal 전용 프로필 테이블
create table if not exists public.pm_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  role text not null default 'viewer'
    check (role in ('admin','manager','staff','viewer')),
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  customer_scope text,                -- ax / ed / vm / csk
  memo text,
  created_at timestamptz default now(),
  approved_at timestamptz,
  approved_by uuid
);

-- 2) 회원가입 시 pm_profiles 자동 생성 (pending)
--    함수 이름도 PM 전용으로 분리 (하네스 트리거와 충돌 방지)
create or replace function public.handle_new_pm_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.pm_profiles (id, email, name, status, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    'pending',
    'viewer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 기존 하네스용 트리거(on_auth_user_created)는 그대로 두고,
-- PM 전용 트리거를 별도로 추가
drop trigger if exists on_auth_user_created_pm on auth.users;
create trigger on_auth_user_created_pm
  after insert on auth.users
  for each row execute function public.handle_new_pm_user();

-- 3) PM-Portal 관리자 판별 헬퍼
create or replace function public.is_pm_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.pm_profiles
    where id = auth.uid() and role = 'admin' and status = 'approved'
  );
$$;

-- 4) RLS + 정책
alter table public.pm_profiles enable row level security;

drop policy if exists "pm read own" on public.pm_profiles;
create policy "pm read own" on public.pm_profiles
  for select using (auth.uid() = id);

drop policy if exists "pm admin read all" on public.pm_profiles;
create policy "pm admin read all" on public.pm_profiles
  for select using (public.is_pm_admin());

drop policy if exists "pm admin update all" on public.pm_profiles;
create policy "pm admin update all" on public.pm_profiles
  for update using (public.is_pm_admin());

drop policy if exists "pm update own name" on public.pm_profiles;
create policy "pm update own name" on public.pm_profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

-- 5) 김교한 계정을 PM-Portal 관리자로 등록
--    (하네스에서 쓰던 그 계정 id를 그대로 사용 — auth.users 공통)
insert into public.pm_profiles (id, email, name, role, status, approved_at)
select id, email, '김교한', 'admin', 'approved', now()
from auth.users
where id = '9a5621f1-442c-4f5d-a6e6-3c9363f327a9'
on conflict (id) do update
  set role = 'admin', status = 'approved', approved_at = now();

-- 확인
select email, name, role, status from public.pm_profiles order by role;
