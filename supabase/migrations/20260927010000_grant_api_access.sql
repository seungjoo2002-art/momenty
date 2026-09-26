-- ============================================================================
-- MOMENTY · Data API 권한 (GRANT)
--
-- 새 Supabase 프로젝트는 public 스키마의 새 테이블을 anon / authenticated 역할에 자동으로 열어 주지 않는다.
-- GRANT가 없으면 RLS를 평가하기도 전에 "permission denied for table"(42501)로 막힌다.
-- 여기서는 필요한 권한만 명시적으로 준다. 어떤 행을 볼 수 있는지는 여전히 RLS가 정한다.
-- ============================================================================

grant usage on schema public to anon, authenticated;

-- profiles: 누구나 조회, 로그인 사용자는 본인 행만 수정 (RLS)
grant select on public.profiles to anon, authenticated;
grant update (nickname, handle, avatar_url) on public.profiles to authenticated;

-- creators: 누구나 조회, 로그인 사용자는 자기 profile로 생성 · 본인만 수정 (RLS)
grant select on public.creators to anon, authenticated;
grant insert, update on public.creators to authenticated;

-- subscriptions: 로그인한 팬 · 크리에이터만 조회 (쓰기는 service role만)
grant select on public.subscriptions to authenticated;

-- moments: 공개범위에 따라 조회 (RLS), 쓰기는 크리에이터 본인만 (RLS)
grant select on public.moments to anon, authenticated;
grant insert, update, delete on public.moments to authenticated;

-- moment_reactions: 본인 것만 조회 · 생성 · 삭제 (RLS)
grant select, insert, delete on public.moment_reactions to authenticated;

-- moment_feed view는 첫 migration에서 이미 select를 주었다

-- RLS 정책 · Storage 정책이 호출하는 권한 판단 함수
grant execute on function public.is_creator_owner(text) to anon, authenticated;
grant execute on function public.can_view_moment(text, public.moment_visibility) to anon, authenticated;
