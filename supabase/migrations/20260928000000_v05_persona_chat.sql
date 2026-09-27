-- ============================================================================
-- MOMENTY v0.5-2 · Creator Persona AI
--
--  1. private 스키마 + 서버 키 — Data API에 노출되지 않는 저장소.
--     AI Route는 service role을 쓰지 않는다. 대신 "로그인한 팬의 JWT(권한 판단) + 서버만 아는 키(서버가 부른 것인지)"
--     둘 다 있어야 아래 함수들이 동작한다. DB에는 키의 SHA-256 해시만 둔다 (키 값은 migration에 없다).
--  2. creators.persona_enabled — 크리에이터 본인이 켜고 끌 수 있게 (컬럼 권한)
--  3. creator_personas   말투(Style) + 성향(Personality) — 크리에이터 본인만
--  4. creator_facts      크리에이터가 직접 확인한 사실 — 크리에이터 본인만, last_verified_at은 서버 시각
--  5. creator_boundaries 주제별 허용/금지 — 크리에이터 본인만
--  6. ai_conversations · ai_messages — 팬은 자기 대화만 읽기/삭제. 크리에이터는 팬의 AI 대화를 읽을 수 없다.
--     쓰기는 record_ai_exchange()만 (팬이 "AI 메시지"를 직접 만들 수 없다)
--  7. ai_persona_context() — 서버가 Persona Prompt에 필요한 값만 가져가는 함수 (원본 테이블은 팬에게 닫혀 있다)
--  8. consume_ai_rate_limit() — 공유 rate limit (Postgres 행 잠금으로 원자적, 서버 여러 대 · 재시작에도 유지)
--     한도 · 시간 창은 호출자가 정하지 않는다 — private.ai_settings(서버 관리자만 수정)에서 읽는다
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. private 스키마 · 서버 키
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.server_keys (
  id text primary key,
  -- encode(sha256(key), 'hex')
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create function private.server_key_ok(p_key text)
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
      where k.id = 'ai' and k.key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
    );
$$;

create function private.require_server_key(p_key text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.server_key_ok(p_key) then
    raise exception 'server_key_required' using errcode = '42501';
  end if;
end;
$$;

-- 배열 원소 길이 검사 (check 제약용 — 제약은 쓰는 사용자 권한으로 평가되므로 public에 두고 실행 권한을 준다)
create function public.text_items_ok(p_items text[], p_max int)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(char_length(x) between 1 and p_max), true) from unnest(p_items) as x;
$$;

-- ---------------------------------------------------------------------------
-- 2. Persona ON/OFF — 크리에이터 본인만 (RLS "creators: 본인만 수정")
-- ---------------------------------------------------------------------------
grant update (persona_enabled) on public.creators to authenticated;

-- ---------------------------------------------------------------------------
-- 3. creator_personas — Style + Personality (크리에이터당 1행)
-- ---------------------------------------------------------------------------
create table public.creator_personas (
  creator_id text primary key references public.creators (id) on delete cascade,
  -- A. Style
  formality text not null default 'polite' check (formality in ('polite', 'casual')),          -- 존댓말 / 반말
  reply_length text not null default 'medium' check (reply_length in ('short', 'medium', 'long')),
  laugh_kk boolean not null default false,                                                      -- ㅋㅋ
  laugh_hh boolean not null default false,                                                      -- ㅎㅎ
  emoji_level smallint not null default 1 check (emoji_level between 0 and 3),                  -- 0 없음 … 3 많이
  phrases text[] not null default '{}' check (cardinality(phrases) <= 10 and public.text_items_ok(phrases, 40)),
  mood text not null default '' check (char_length(mood) <= 80),
  example_messages text[] not null default '{}' check (cardinality(example_messages) <= 10 and public.text_items_ok(example_messages, 200)),
  -- B. Personality
  traits text[] not null default '{}' check (
    cardinality(traits) <= 5
    and traits <@ array['playful', 'warm', 'calm', 'direct', 'serious', 'curious', 'bright', 'shy']::text[]
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger creator_personas_updated_at before update on public.creator_personas
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. creator_facts — 크리에이터가 직접 확인한 사실
-- ---------------------------------------------------------------------------
create table public.creator_facts (
  id uuid primary key default gen_random_uuid(),
  creator_id text not null references public.creators (id) on delete cascade,
  category text not null default 'other' check (category in ('food', 'hobby', 'activity', 'profile', 'other')),
  content text not null check (char_length(btrim(content)) between 1 and 300),
  -- 어디에서 왔는지 (지금은 Studio에서 크리에이터가 직접 입력한 것뿐 — 앱에서 바꿀 수 없다)
  source text not null default 'creator_studio' check (source in ('creator_studio')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now()
);

create index creator_facts_creator_idx on public.creator_facts (creator_id) where active;

-- 확인 시각은 서버 시각만: 내용이 바뀌거나 "다시 확인"하면 now(), 임의 시각은 무시
create function public.creator_facts_verify()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.last_verified_at := now();
  elsif new.content is distinct from old.content or new.last_verified_at is distinct from old.last_verified_at then
    new.last_verified_at := now();
  end if;
  return new;
end;
$$;

create trigger creator_facts_verify before insert or update on public.creator_facts
  for each row execute function public.creator_facts_verify();
create trigger creator_facts_updated_at before update on public.creator_facts
  for each row execute function public.set_updated_at();

-- 크리에이터당 활성 사실 50개까지.
-- 활성 사실이 늘어나는 모든 경우를 검사한다: active로 insert · inactive → active로 update.
-- 동시 요청: 크리에이터별 트랜잭션 advisory lock으로 "세고 → 넣기"를 한 번에 하나씩 → 동시에 보내도 50을 넘지 않는다.
create function public.creator_facts_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.active then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.active then
    return new; -- 이미 활성 — 개수가 늘지 않는다
  end if;
  perform pg_advisory_xact_lock(hashtextextended('momenty:creator_facts:' || new.creator_id, 0));
  if (select count(*) from public.creator_facts f where f.creator_id = new.creator_id and f.active and f.id <> new.id) >= 50 then
    raise exception 'too many active facts' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger creator_facts_limit before insert or update of active on public.creator_facts
  for each row execute function public.creator_facts_limit();

-- ---------------------------------------------------------------------------
-- 5. creator_boundaries — 주제별 허용/금지 (행이 없으면 기본값: 아래 ai_persona_context 참고)
-- ---------------------------------------------------------------------------
create table public.creator_boundaries (
  creator_id text not null references public.creators (id) on delete cascade,
  topic text not null check (topic in (
    'everyday', 'jokes', 'listening', 'hobbies',
    'flirting', 'romance_roleplay', 'sexual', 'politics', 'meeting_requests', 'current_location'
  )),
  allowed boolean not null,
  updated_at timestamptz not null default now(),
  primary key (creator_id, topic)
);

create trigger creator_boundaries_updated_at before update on public.creator_boundaries
  for each row execute function public.set_updated_at();

-- RLS: 3~5는 크리에이터 본인만 (팬 · 다른 크리에이터 · 비로그인은 읽을 수도 없다)
alter table public.creator_personas enable row level security;
alter table public.creator_facts enable row level security;
alter table public.creator_boundaries enable row level security;

create policy "personas: 본인만" on public.creator_personas
  for all to authenticated
  using (public.is_creator_owner(creator_id)) with check (public.is_creator_owner(creator_id));
create policy "facts: 본인만" on public.creator_facts
  for all to authenticated
  using (public.is_creator_owner(creator_id)) with check (public.is_creator_owner(creator_id));
create policy "boundaries: 본인만" on public.creator_boundaries
  for all to authenticated
  using (public.is_creator_owner(creator_id)) with check (public.is_creator_owner(creator_id));

grant select, delete on public.creator_personas to authenticated;
grant insert (creator_id, formality, reply_length, laugh_kk, laugh_hh, emoji_level, phrases, mood, example_messages, traits)
  on public.creator_personas to authenticated;
grant update (formality, reply_length, laugh_kk, laugh_hh, emoji_level, phrases, mood, example_messages, traits)
  on public.creator_personas to authenticated;

grant select, delete on public.creator_facts to authenticated;
grant insert (creator_id, category, content, active) on public.creator_facts to authenticated;
grant update (category, content, active, last_verified_at) on public.creator_facts to authenticated;

grant select, delete on public.creator_boundaries to authenticated;
grant insert (creator_id, topic, allowed) on public.creator_boundaries to authenticated;
grant update (allowed) on public.creator_boundaries to authenticated;

-- ---------------------------------------------------------------------------
-- 6. AI 대화
-- ---------------------------------------------------------------------------
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  fan_id uuid not null references public.profiles (id) on delete cascade,
  creator_id text not null references public.creators (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (fan_id, creator_id)
);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  -- fan: 팬 · ai: Creator AI. ('creator' = 실제 크리에이터 본인 답장은 Human takeover 단계에서 추가)
  sender text not null check (sender in ('fan', 'ai')),
  content text not null check (char_length(content) between 1 and 4000),
  -- AI 답의 근거가 된 Moment (record_ai_exchange가 팬이 볼 수 있고 AI 참고 허용된 것만 남긴다)
  grounded_moment_ids uuid[] not null default '{}' check (cardinality(grounded_moment_ids) <= 60),
  -- 아래 메타데이터는 어떤 경로로 쓰이든 테이블이 형식을 강제한다 (record_ai_exchange 검사와 이중)
  context_types text[] not null default '{}' check (
    cardinality(context_types) <= 8
    and context_types <@ array['style', 'personality', 'facts', 'boundaries', 'today', 'focus', 'conversation', 'fan_memory']::text[]
  ),
  provider text check (provider is null or provider in ('anthropic', 'openai')),
  model text check (model is null or model ~ '^[A-Za-z0-9._:/-]{1,80}$'),
  -- 걸린 Boundary (예: current_location) — 없으면 null
  boundary text check (boundary is null or boundary in (
    'flirting', 'romance_roleplay', 'sexual', 'politics', 'meeting_requests', 'current_location', 'platform_safety'
  )),
  created_at timestamptz not null default now(),
  -- 팬 메시지는 API 입력 한도(1000자)를 넘을 수 없다 · 메타데이터는 AI 메시지에만
  constraint ai_messages_fan_shape check (
    sender <> 'fan'
    or (char_length(content) <= 1000 and grounded_moment_ids = '{}' and context_types = '{}' and provider is null and model is null and boundary is null)
  )
);

create index ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

-- 팬 본인만 읽기 · 삭제. 크리에이터용 정책은 없다 (팬의 AI 대화 원문을 크리에이터가 읽을 수 없다)
create policy "ai_conversations: 팬 본인만 조회" on public.ai_conversations
  for select to authenticated using (fan_id = (select auth.uid()));
create policy "ai_conversations: 팬 본인만 삭제" on public.ai_conversations
  for delete to authenticated using (fan_id = (select auth.uid()));
create policy "ai_messages: 자기 대화만 조회" on public.ai_messages
  for select to authenticated
  using (exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.fan_id = (select auth.uid())));

grant select, delete on public.ai_conversations to authenticated;
grant select on public.ai_messages to authenticated;
-- insert · update 권한은 주지 않는다 → record_ai_exchange()만 쓸 수 있다

-- ---------------------------------------------------------------------------
-- 7. Persona 대화 권한 · Context
-- ---------------------------------------------------------------------------
-- 이 사용자가 이 크리에이터의 Persona와 대화할 수 있는지. 되면 null, 안 되면 이유
create function private.persona_chat_denial(p_uid uuid, p_creator_id text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c record;
  t public.subscription_tier;
begin
  if p_uid is null then return 'unauthenticated'; end if;
  select id, profile_id, persona_enabled into c from public.creators where id = p_creator_id;
  if not found then return 'creator_not_found'; end if;
  if c.profile_id = p_uid then return 'own_channel'; end if;
  if not c.persona_enabled then return 'persona_disabled'; end if;
  if not exists (select 1 from public.creator_personas p where p.creator_id = p_creator_id) then return 'persona_not_configured'; end if;
  select tier into t from public.subscriptions where fan_id = p_uid and creator_id = p_creator_id;
  if t is null or t not in ('subscriber', 'premium') then return 'subscription_required'; end if;
  return null;
end;
$$;

-- 서버(키) + 권한 있는 팬(JWT)에게만, Persona Prompt에 필요한 값만 돌려준다.
-- 사실은 활성화된 것의 분류 · 내용만 (출처 · 시각 · 비활성 사실은 내보내지 않는다)
create function public.ai_persona_context(p_server_key text, p_creator_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  denial text;
  p public.creator_personas;
  c public.creators;
begin
  perform private.require_server_key(p_server_key);
  denial := private.persona_chat_denial((select auth.uid()), p_creator_id);
  if denial is not null then
    raise exception '%', denial using errcode = case when denial = 'creator_not_found' then 'P0002' else '42501' end;
  end if;
  select * into p from public.creator_personas where creator_id = p_creator_id;
  select * into c from public.creators where id = p_creator_id;
  return jsonb_build_object(
    'creator', jsonb_build_object('id', c.id, 'name', c.name, 'handle', c.handle),
    'style', jsonb_build_object(
      'formality', p.formality, 'replyLength', p.reply_length, 'laughKk', p.laugh_kk, 'laughHh', p.laugh_hh,
      'emojiLevel', p.emoji_level, 'phrases', to_jsonb(p.phrases), 'mood', p.mood, 'examples', to_jsonb(p.example_messages)
    ),
    'personality', jsonb_build_object('traits', to_jsonb(p.traits)),
    'facts', coalesce((
      select jsonb_agg(jsonb_build_object('category', f.category, 'content', f.content) order by f.created_at)
      from (select * from public.creator_facts where creator_id = p_creator_id and active order by created_at limit 50) f
    ), '[]'::jsonb),
    -- 기본값: 일상 · 농담 · 들어주기 · 취미는 허용, 나머지는 금지 (크리에이터가 바꾼 것만 덮어쓴다)
    'boundaries', (
      select jsonb_object_agg(d.topic, coalesce(b.allowed, d.allowed_default))
      from (values
        ('everyday', true), ('jokes', true), ('listening', true), ('hobbies', true),
        ('flirting', false), ('romance_roleplay', false), ('sexual', false), ('politics', false),
        ('meeting_requests', false), ('current_location', false)
      ) as d(topic, allowed_default)
      left join public.creator_boundaries b on b.creator_id = p_creator_id and b.topic = d.topic
    )
  );
end;
$$;

-- 팬 메시지 + AI 답을 한 번에 저장 (서버만). 근거 Moment는 이 팬이 볼 수 있고 AI 참고 허용된 이 크리에이터의 것만 남긴다
create function public.record_ai_exchange(
  p_server_key text,
  p_creator_id text,
  p_fan_message text,
  p_ai_reply text,
  p_grounded_moment_ids uuid[] default '{}',
  p_context_types text[] default '{}',
  p_provider text default null,
  p_model text default null,
  p_boundary text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  denial text;
  conv uuid;
  grounded uuid[];
  fan_msg uuid;
  ai_msg uuid;
begin
  perform private.require_server_key(p_server_key);
  denial := private.persona_chat_denial(uid, p_creator_id);
  if denial is not null then
    raise exception '%', denial using errcode = case when denial = 'creator_not_found' then 'P0002' else '42501' end;
  end if;

  -- 입력 검증: 잘못된 값은 조용히 고쳐 저장하지 않고 거부한다
  if p_fan_message is null or char_length(btrim(p_fan_message)) = 0 or char_length(p_fan_message) > 1000 then
    raise exception 'invalid fan message' using errcode = '22023';
  end if;
  if p_ai_reply is null or char_length(btrim(p_ai_reply)) = 0 or char_length(p_ai_reply) > 4000 then
    raise exception 'invalid ai reply' using errcode = '22023';
  end if;
  if cardinality(coalesce(p_grounded_moment_ids, '{}')) > 60 then
    raise exception 'too many grounded moments' using errcode = '22023';
  end if;
  if cardinality(coalesce(p_context_types, '{}')) > 8
     or not (coalesce(p_context_types, '{}') <@ array['style', 'personality', 'facts', 'boundaries', 'today', 'focus', 'conversation', 'fan_memory']::text[]) then
    raise exception 'invalid context types' using errcode = '22023';
  end if;
  if p_provider is not null and p_provider not in ('anthropic', 'openai') then
    raise exception 'invalid provider' using errcode = '22023';
  end if;
  if p_model is not null and p_model !~ '^[A-Za-z0-9._:/-]{1,80}$' then
    raise exception 'invalid model' using errcode = '22023';
  end if;
  if p_boundary is not null and p_boundary not in ('flirting', 'romance_roleplay', 'sexual', 'politics', 'meeting_requests', 'current_location', 'platform_safety') then
    raise exception 'invalid boundary' using errcode = '22023';
  end if;

  select coalesce(array_agg(m.id), '{}') into grounded
  from public.moments m
  where m.id = any (coalesce(p_grounded_moment_ids, '{}'))
    and m.creator_id = p_creator_id
    and m.ai_context_enabled
    and public.can_view_moment(m.creator_id, m.visibility);

  insert into public.ai_conversations (fan_id, creator_id) values (uid, p_creator_id)
  on conflict (fan_id, creator_id) do update set last_message_at = now(), updated_at = now()
  returning id into conv;

  insert into public.ai_messages (conversation_id, sender, content, created_at)
  values (conv, 'fan', p_fan_message, clock_timestamp())
  returning id into fan_msg;

  insert into public.ai_messages (conversation_id, sender, content, grounded_moment_ids, context_types, provider, model, boundary, created_at)
  values (
    conv, 'ai', p_ai_reply, grounded,
    (select coalesce(array_agg(distinct t), '{}') from unnest(coalesce(p_context_types, '{}')) as t),
    p_provider, p_model, p_boundary,
    clock_timestamp()
  )
  returning id into ai_msg;

  return jsonb_build_object('conversationId', conv, 'fanMessageId', fan_msg, 'aiMessageId', ai_msg, 'groundedMomentIds', to_jsonb(grounded));
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. 공유 rate limit — 고정 창 카운터. upsert 한 문장이 행을 잠그므로 동시에 와도 횟수가 새지 않는다
--    사용자는 항상 auth.uid() (다른 사람의 한도를 쓰거나 볼 수 없다)
-- ---------------------------------------------------------------------------
create table private.ai_rate_limits (
  bucket text primary key,
  window_start timestamptz not null,
  count integer not null check (count >= 0)
);

-- 정책 값 — 한 행뿐. private 스키마라 앱 · 사용자는 읽거나 바꿀 수 없다 (SQL Editor에서 관리자만 수정)
create table private.ai_settings (
  id boolean primary key default true check (id),
  rate_per_creator integer not null default 20 check (rate_per_creator between 1 and 10000),
  rate_per_user integer not null default 60 check (rate_per_user between 1 and 10000),
  rate_window_sec integer not null default 600 check (rate_window_sec between 10 and 86400),
  updated_at timestamptz not null default now()
);
insert into private.ai_settings (id) values (true);

create function private.hit_bucket(p_bucket text, p_window interval)
returns table (hits integer, reset_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  insert into private.ai_rate_limits as r (bucket, window_start, count)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update set
    window_start = case when r.window_start <= now() - p_window then now() else r.window_start end,
    count = case when r.window_start <= now() - p_window then 1 else r.count + 1 end
  returning r.count, r.window_start + p_window;
$$;

-- 호출자는 크리에이터만 알려준다. 한도 · 시간 창은 private.ai_settings에서, 사용자는 auth.uid()에서.
create function public.consume_ai_rate_limit(p_server_key text, p_creator_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  cfg private.ai_settings;
  w interval;
  c record;
  u record;
begin
  perform private.require_server_key(p_server_key);
  if uid is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  if p_creator_id is null or p_creator_id !~ '^[a-z0-9_-]{1,40}$' then
    raise exception 'invalid creator id' using errcode = '22023';
  end if;
  select * into cfg from private.ai_settings where id;
  if not found then raise exception 'ai settings missing' using errcode = '55000'; end if;
  w := make_interval(secs => cfg.rate_window_sec);
  select * into c from private.hit_bucket('ai_chat:' || uid || ':' || p_creator_id, w);
  select * into u from private.hit_bucket('ai_chat:' || uid, w);
  return jsonb_build_object(
    'allowed', c.hits <= cfg.rate_per_creator and u.hits <= cfg.rate_per_user,
    'remaining', greatest(0, least(cfg.rate_per_creator - c.hits, cfg.rate_per_user - u.hits)),
    'resetAt', least(c.reset_at, u.reset_at),
    'rule', case when c.hits > cfg.rate_per_creator then 'per_creator' when u.hits > cfg.rate_per_user then 'per_user' end
  );
end;
$$;

-- 권한: 서버 키가 있어야 의미가 있지만, 함수 자체도 로그인 사용자에게만
revoke all on function private.server_key_ok(text) from public, anon, authenticated;
revoke all on function private.require_server_key(text) from public, anon, authenticated;
revoke all on function private.persona_chat_denial(uuid, text) from public, anon, authenticated;
revoke all on function private.hit_bucket(text, interval) from public, anon, authenticated;
revoke all on function public.ai_persona_context(text, text) from public, anon;
revoke all on function public.record_ai_exchange(text, text, text, text, uuid[], text[], text, text, text) from public, anon;
revoke all on function public.consume_ai_rate_limit(text, text) from public, anon;
grant execute on function public.ai_persona_context(text, text) to authenticated;
grant execute on function public.record_ai_exchange(text, text, text, text, uuid[], text[], text, text, text) to authenticated;
grant execute on function public.consume_ai_rate_limit(text, text) to authenticated;
grant execute on function public.text_items_ok(text[], int) to authenticated;
revoke all on function public.creator_facts_verify() from public, anon, authenticated;
revoke all on function public.creator_facts_limit() from public, anon, authenticated;

-- service_role (seed · 정리 스크립트): 새 테이블 권한
grant all on public.creator_personas, public.creator_facts, public.creator_boundaries, public.ai_conversations, public.ai_messages to service_role;
