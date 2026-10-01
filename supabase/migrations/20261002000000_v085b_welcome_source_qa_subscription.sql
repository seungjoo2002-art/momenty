-- ============================================================================
-- MOMENTY v0.8.5b hotfix · 구독 환영 메시지 출처 · QA 전용 임시 구독
--
-- 원칙
--   · 기존 migration은 고치지 않는다. 바꾸는 것은 컬럼 2개 추가 · trigger 함수 1개 교체 · 함수 3개 추가뿐.
--   · 구독 환영 메시지는 여전히 "팬 × 크리에이터 최초 유료 활성화"에 정확히 한 번 (unique (fan_id, creator_id) 그대로).
--     어떤 메시지를 쓸지만 정한다 (우선순위):
--       1. 크리에이터가 직접 쓴 환영 메시지가 있음        → source 'creator'    "Creator가 설정한 자동 환영 메시지"
--       2. 없음 + AI Avatar ON(준비 완료)                 → source 'default_ai' "{이름}의 AI Avatar · 자동 메시지"
--       3. 없음 + AI Avatar OFF (또는 welcome_mode 'off') → source 'system'     "MOMENTY · 구독 안내"
--     크리에이터가 환영 메시지를 끄면(welcome_mode 'off') 크리에이터 문구 · AI 문구 모두 쓰지 않고 MOMENTY 안내만 남긴다.
--   · 백필 없음: 컬럼 추가는 subscriptions trigger를 부르지 않는다. 이미 유료인 구독자에게 새로 만들어지는 행은 없다.
--     기존 subscription_welcomes 행은 예전 trigger(크리에이터 문구만)가 만든 것이므로 source 기본값 'creator'가 맞다.
--   · 차단 관계면 어떤 환영 메시지도 만들지 않는다 (기존과 같음).
--   · RLS · 권한은 바꾸지 않는다. subscription_welcomes는 여전히 trigger만 쓴다 (팬 · 크리에이터 쓰기 권한 없음).
--
--   · QA 전용 임시 구독 (v0.9 결제 전까지): 로그인한 팬 "본인"의 구독 등급만 실제 subscriptions 행에서 바꾼다.
--     - subscriptions의 RLS · 권한은 그대로 (팬은 여전히 follow만 insert/delete). 브라우저에서 직접 등급을 바꿀 수 없다.
--     - 함수는 QA 서버 키(private.server_keys id 'qa')가 있어야만 동작한다. 키는 QA 서버의 서버 전용 환경변수에만 있고,
--       운영 DB에는 'qa' 키를 등록하지 않는다 → 운영에서는 키가 있어도 'qa_disabled'.
--     - 팬은 JWT(auth.uid())로만 정한다 (fan id 입력 없음). 자기 채널 · 차단 관계 · 없는 크리에이터 · 잘못된 등급은 거부.
--     - 해제는 등급만 follow로 되돌린다. 대화 · 환영 메시지 · Memory · 반응은 지우지 않는다 (다시 구독해도 환영 메시지는 1개 그대로).
--
--  1. creator_avatar_settings.welcome_mode     'auto' | 'off'
--  2. subscription_welcomes.source             'creator' | 'default_ai' | 'system'
--  3. private.subscriptions_welcome() 교체
--  4. public.set_welcome_mode(text)
--  5. QA: private.qa_key_ok(text) · public.qa_set_my_subscription(text, text, text)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · 2. 컬럼
-- ---------------------------------------------------------------------------
alter table public.creator_avatar_settings
  add column welcome_mode text not null default 'auto' check (welcome_mode in ('auto', 'off'));

alter table public.subscription_welcomes
  add column source text not null default 'creator' check (source in ('creator', 'default_ai', 'system'));

-- ---------------------------------------------------------------------------
-- 3. 구독 환영 메시지 trigger 함수 교체 (trigger subscriptions_welcome은 그대로 이 함수를 부른다)
-- ---------------------------------------------------------------------------
create or replace function private.subscriptions_welcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  custom text;
  src text;
  body text;
begin
  -- 유료 = follow가 아닌 등급. follow → 유료(또는 처음부터 유료 insert)일 때만. 유료 → 유료(등급 변경 · 갱신)는 대상 아님
  if new.tier = 'follow' or (tg_op = 'UPDATE' and old.tier <> 'follow') then
    return null;
  end if;
  select cr.profile_id, cr.persona_enabled, coalesce(a.welcome_message, '') as welcome_message, coalesce(a.welcome_mode, 'auto') as welcome_mode
  into c
  from public.creators cr left join public.creator_avatar_settings a on a.creator_id = cr.id
  where cr.id = new.creator_id;
  if not found or private.blocked_between(new.fan_id, c.profile_id) then
    return null;
  end if;
  custom := btrim(c.welcome_message);
  if c.welcome_mode = 'auto' and custom <> '' then
    src := 'creator';
    body := custom;
  elsif c.welcome_mode = 'auto' and c.persona_enabled and private.avatar_ready(new.creator_id) then
    src := 'default_ai';
    body := '구독해 줘서 고마워! 앞으로 여기서 자주 이야기하자 😊';
  else
    src := 'system';
    body := '구독이 시작되었어요.';
  end if;
  insert into public.subscription_welcomes (fan_id, creator_id, tier, message, source)
  values (new.fan_id, new.creator_id, new.tier, body, src)
  on conflict (fan_id, creator_id) do nothing;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. 크리에이터: 환영 메시지 켜기/끄기 ('off'면 MOMENTY 구독 안내만)
-- ---------------------------------------------------------------------------
create function public.set_welcome_mode(p_mode text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid text := private.my_creator_id();
begin
  if p_mode is null or p_mode not in ('auto', 'off') then raise exception 'invalid mode' using errcode = '22023'; end if;
  insert into public.creator_avatar_settings (creator_id, welcome_mode) values (cid, p_mode)
  on conflict (creator_id) do update set welcome_mode = excluded.welcome_mode;
  return p_mode;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. QA 전용 임시 구독 — QA 서버 키(id 'qa') + 팬 본인 JWT
--    운영 DB에는 'qa' 키를 등록하지 않는다. AI 서버 키(id 'ai')와 섞이지 않는다 (서로의 함수에서 쓸 수 없다).
-- ---------------------------------------------------------------------------
create function private.qa_key_ok(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_key is not null
    and char_length(p_key) >= 32
    and exists (
      select 1 from private.server_keys k
      where k.id = 'qa' and k.key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
    );
$$;

create function public.qa_set_my_subscription(p_server_key text, p_creator_id text, p_tier text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  owner uuid;
  t public.subscription_tier;
begin
  if not private.qa_key_ok(p_server_key) then raise exception 'qa_disabled' using errcode = '42501'; end if;
  if uid is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  if p_tier is null or not (p_tier = any (enum_range(null::public.subscription_tier)::text[])) then
    raise exception 'invalid_tier' using errcode = '22023';
  end if;
  select profile_id into owner from public.creators where id = p_creator_id;
  if owner is null then raise exception 'creator_not_found' using errcode = 'P0002'; end if;
  if owner = uid then raise exception 'own_channel' using errcode = '42501'; end if;
  if private.blocked_between(uid, owner) then raise exception 'blocked' using errcode = '42501'; end if;
  t := p_tier::public.subscription_tier;
  -- 실제 subscriptions 행을 바꾼다 → 환영 메시지 · 구독자 수 · Premium Moment · AI 권한이 운영 로직 그대로 동작한다
  insert into public.subscriptions (fan_id, creator_id, tier) values (uid, p_creator_id, t)
  on conflict (fan_id, creator_id) do update set tier = excluded.tier
  where public.subscriptions.tier is distinct from excluded.tier;
  return jsonb_build_object('creatorId', p_creator_id, 'tier', p_tier);
end;
$$;

-- ---------------------------------------------------------------------------
-- 권한
-- ---------------------------------------------------------------------------
revoke all on function private.subscriptions_welcome() from public, anon, authenticated;
revoke all on function private.qa_key_ok(text) from public, anon, authenticated;
revoke all on function public.set_welcome_mode(text) from public, anon;
revoke all on function public.qa_set_my_subscription(text, text, text) from public, anon;
grant execute on function public.set_welcome_mode(text) to authenticated;
-- QA 키 없이는 'qa_disabled' — 실행 권한만으로는 아무것도 바꿀 수 없다
grant execute on function public.qa_set_my_subscription(text, text, text) to authenticated;
