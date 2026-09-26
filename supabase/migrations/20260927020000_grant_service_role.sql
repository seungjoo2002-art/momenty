-- ============================================================================
-- MOMENTY · service_role 권한
--
-- service_role은 RLS를 우회하지만(bypassrls) 테이블 권한(GRANT)은 따로 필요하다.
-- 새 Supabase 프로젝트는 이것도 자동으로 주지 않으므로 명시한다.
-- 사용처: 서버 전용 작업 (seed 스크립트, 이후 결제 웹훅의 subscriptions 갱신 등).
-- service role key는 절대 브라우저에 노출하지 않는다.
-- ============================================================================

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- 이후 migration에서 만드는 객체도 service_role이 쓸 수 있도록
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
