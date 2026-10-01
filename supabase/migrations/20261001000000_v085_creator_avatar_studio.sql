-- ============================================================================
-- MOMENTY v0.8.5 · Creator AI Avatar + Creator Studio
--
-- 원칙
--   · Avatar = 기존 Creator Persona(creator_personas · creator_facts · creator_boundaries · ai_persona_context)를 그대로 쓴다.
--     새 "가짜" AI 시스템을 만들지 않는다.
--   · Fact와 Style은 다른 테이블이다.
--       기본정보(좋아하는 음식 · 취미 …) → creator_facts (basic_key) = VERIFIED FACTS. 크리에이터가 언제든 고친다.
--       말투 학습 답변 → creator_style_samples = STYLE. 사실의 근거가 아니다 ("파스타 먹었어"라는 답변 ≠ 파스타를 좋아한다는 사실).
--       말투는 쌓이는 학습 데이터다: 행을 고칠 수 없고(update 권한 없음), 다시 답하거나 초기화하면 이전 행은 보관(archived_at)된다.
--   · AI 문답 ON(creators.persona_enabled)은 DB가 확인한다: 기본정보 · 필수 말투 문답 · Persona · Boundary 확인이 모두 끝나야 켤 수 있다.
--     준비가 깨지면(초기화 · 기본정보 삭제 등) 자동으로 꺼진다. 대화 권한(persona_chat_denial)도 한 번 더 확인한다.
--   · 크리에이터의 AI 대화 열람: 팬이 고지를 확인(ai_creator_view_consents)한 뒤의 메시지만, 전용 함수로만.
--     ai_conversations · ai_messages · fan_memories의 RLS는 그대로다 (크리에이터 정책을 추가하지 않는다). Fan Memory는 여전히 열람 불가.
--   · 구독 환영 메시지: 유료 구독이 활성화되는 순간 subscriptions trigger가 한 번만 만든다 (크리에이터가 실시간으로 보낸 메시지가 아니다).
--     결제(v0.9)가 tier를 어떤 경로로 바꾸든 같은 trigger가 동작한다 — subscriptions 스키마는 바꾸지 않는다.
--   · 통계: 크리에이터 본인 채널의 실제 행을 날짜별로 세기만 한다 (내용 없음 · 팬별 분해 없음 · 조회수 없음).
--
--  0. creators.job 길이 · persona_enabled 기본값 OFF
--  1. avatar_training_prompts   말투 학습 질문 (40개 · 필수 9개)
--  2. creator_style_samples     말투 학습 답변 (onboarding · avatar_training · creator_correction)
--  3. creator_facts 확장        basic_key · undisclosed · source 'avatar_basics'
--  4. creator_avatar_settings   Boundary 확인 시각 · 구독 환영 메시지
--  5. 준비 상태 · ON 가드 · 자동 OFF
--  6. 저장 함수                  save_avatar_basics · save_style_answers · add_style_training · reset_style_training ·
--                               confirm_avatar_boundaries · save_welcome_message · avatar_readiness
--  7. AI 대화 열람 고지           ai_creator_view_consents · acknowledge_ai_notice · creator_fan_ai_messages
--  8. persona_chat_denial · ai_persona_context 교체
--  9. subscription_welcomes
-- 10. Fans 플랜별               fan_manager_tier_counts · fan_manager_by_tier
-- 11. 통계                      creator_analytics
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. creators
-- ---------------------------------------------------------------------------
-- 직업/활동 분야 (공개 프로필). 기존 값은 ''이라 그대로 통과한다
alter table public.creators add constraint creators_job_length check (char_length(job) <= 40);
-- 새 크리에이터는 AI 문답 OFF로 시작한다 (준비를 마친 뒤 본인이 켠다)
alter table public.creators alter column persona_enabled set default false;

-- ---------------------------------------------------------------------------
-- 1. 말투 학습 질문 — 팬이 실제로 보낼 법한 메시지. 필수(required)는 안전과 관련된 상황 (위치 · 연애 · 민감 · 무례 · 거절)
-- ---------------------------------------------------------------------------
create table public.avatar_training_prompts (
  key text primary key check (key ~ '^[a-z0-9_]{1,40}$'),
  category text not null check (category in (
    'greeting', 'daily', 'today', 'praise', 'thanks', 'playful', 'fan_tease', 'comfort', 'fan_struggling', 'fan_good_news',
    'affection', 'jealousy', 'fan_hurt', 'about_me', 'taste', 'past', 'unknown_fact', 'sensitive', 'location', 'romance',
    'rude', 'decline', 'short', 'long', 'ask_back'
  )),
  fan_message text not null check (char_length(fan_message) between 1 and 300),
  sort integer not null unique,
  required boolean not null default false
);

alter table public.avatar_training_prompts enable row level security;
create policy "avatar_training_prompts: 로그인 사용자 조회" on public.avatar_training_prompts
  for select to authenticated using (true);
grant select on public.avatar_training_prompts to authenticated;

insert into public.avatar_training_prompts (key, category, fan_message, sort, required) values
  ('greeting_1', 'greeting', '안녕! 오늘 처음 와 봤어', 1, false),
  ('today_1', 'today', '오늘 뭐했어?', 2, false),
  ('praise_1', 'praise', '오늘 방송 진짜 재밌었어ㅋㅋ', 3, false),
  ('comfort_1', 'comfort', '나 오늘 시험 망했어 ㅠㅠ', 4, false),
  ('fan_hurt_1', 'fan_hurt', '요즘 왜 이렇게 바빠?', 5, false),
  ('daily_1', 'daily', '요즘 날씨 너무 좋지 않아?', 6, false),
  ('thanks_1', 'thanks', '항상 좋은 기록 남겨 줘서 고마워', 7, false),
  ('fan_tease_1', 'fan_tease', '솔직히 나보다 요리 못하지?ㅋㅋ', 8, false),
  ('fan_good_news_1', 'fan_good_news', '나 드디어 합격했어!!', 9, false),
  ('affection_1', 'affection', '진짜 너무 좋아해', 10, false),
  ('location_1', 'location', '지금 어디야?', 11, true),
  ('taste_1', 'taste', '제일 좋아하는 음식 뭐야?', 12, false),
  ('short_1', 'short', 'ㅋㅋㅋㅋ', 13, false),
  ('fan_struggling_1', 'fan_struggling', '요즘 너무 지치고 아무것도 하기 싫어', 14, false),
  ('playful_1', 'playful', '오늘은 몇 시에 잘 거야? 설마 또 밤새?', 15, false),
  ('romance_1', 'romance', '애인 있어?', 16, true),
  ('greeting_2', 'greeting', '좋은 아침~ 잘 잤어?', 17, false),
  ('praise_2', 'praise', '오늘 사진 진짜 분위기 좋다', 18, false),
  ('jealousy_1', 'jealousy', '다른 팬이랑 더 친한 거 아니야?', 19, false),
  ('unknown_fact_1', 'unknown_fact', '어제 편의점에서 너 본 것 같은데 맞지?', 20, true),
  ('about_me_1', 'about_me', '요즘 제일 빠져 있는 거 뭐야?', 21, false),
  ('sensitive_1', 'sensitive', '혹시 어디 아픈 데 있어?', 22, true),
  ('ask_back_1', 'ask_back', '나 오늘 새로운 취미 시작했어', 23, false),
  ('rude_1', 'rude', '솔직히 요즘 좀 별로던데', 24, true),
  ('today_2', 'today', '오늘 하루 어땠어?', 25, false),
  ('fan_good_news_2', 'fan_good_news', '오늘 내 생일이야 🎂', 26, false),
  ('decline_1', 'decline', '번호 알려 주면 안 돼?', 27, true),
  ('fan_hurt_2', 'fan_hurt', '요즘 답이 좀 늦어서 서운했어', 28, false),
  ('taste_2', 'taste', '요즘 듣는 노래 추천해 줘', 29, false),
  ('past_1', 'past', '처음 이 일 시작했을 때 기억나?', 30, false),
  ('location_2', 'location', '집이 어느 동네야?', 31, true),
  ('fan_tease_2', 'fan_tease', '오늘 셀카 좀 흔들렸던데ㅋㅋ', 32, false),
  ('affection_2', 'affection', '보고 싶었어', 33, false),
  ('sensitive_2', 'sensitive', '정치 얘기 좀 해 줘. 누구 지지해?', 34, true),
  ('daily_2', 'daily', '점심 뭐 먹을지 고민 중이야', 35, false),
  ('decline_2', 'decline', '우리 따로 만나면 안 돼?', 36, true),
  ('fan_struggling_2', 'fan_struggling', '회사에서 혼나서 기분이 별로야', 37, false),
  ('unknown_fact_2', 'unknown_fact', '다음 달에 뭐 할 거야?', 38, false),
  ('short_2', 'short', '굿나잇!', 39, false),
  ('long_1', 'long', '요즘 진로 때문에 고민이 많아. 좋아하는 걸 할지 안정적인 걸 할지 모르겠어. 너라면 어떻게 할 것 같아?', 40, false);

-- ---------------------------------------------------------------------------
-- 2. 말투 학습 답변 — 크리에이터 본인만 읽는다. 쓰기는 함수만 (insert · update · delete 권한 없음 → 직접 덮어쓸 수 없다)
-- ---------------------------------------------------------------------------
create table public.creator_style_samples (
  id uuid primary key default gen_random_uuid(),
  creator_id text not null references public.creators (id) on delete cascade,
  -- onboarding: 처음 학습 · avatar_training: 추가 학습 · creator_correction: AI 예상 답변을 크리에이터가 고친 것
  source text not null check (source in ('onboarding', 'avatar_training', 'creator_correction')),
  prompt_key text references public.avatar_training_prompts (key),
  -- 팬 메시지 (학습 질문의 문장 사본 — 질문 문구가 바뀌어도 답한 당시 그대로)
  fan_message text not null check (char_length(btrim(fan_message)) between 1 and 300),
  -- creator_correction: 고치기 전 AI 예상 답변 원문
  ai_draft text check (ai_draft is null or char_length(ai_draft) <= 1000),
  reply text not null check (char_length(btrim(reply)) between 1 and 500),
  created_at timestamptz not null default now(),
  -- 다시 답하거나 초기화하면 지우지 않고 보관한다 (원본 보존)
  archived_at timestamptz,
  constraint creator_style_samples_onboarding_key check (source <> 'onboarding' or prompt_key is not null),
  constraint creator_style_samples_correction_draft check (source <> 'creator_correction' or ai_draft is not null)
);
create index creator_style_samples_active_idx on public.creator_style_samples (creator_id, created_at desc) where archived_at is null;
-- 처음 학습은 질문당 활성 답변 1개
create unique index creator_style_samples_onboarding_idx on public.creator_style_samples (creator_id, prompt_key)
  where source = 'onboarding' and archived_at is null;

alter table public.creator_style_samples enable row level security;
create policy "creator_style_samples: 본인만 조회" on public.creator_style_samples
  for select to authenticated using (public.is_creator_owner(creator_id));
grant select on public.creator_style_samples to authenticated;

-- ---------------------------------------------------------------------------
-- 3. 기본정보 = Verified Facts (creator_facts 재사용)
-- ---------------------------------------------------------------------------
alter table public.creator_facts add column basic_key text check (
  basic_key is null or basic_key in ('favorite_food', 'disliked_food', 'hobby', 'interest', 'likes', 'dislikes')
);
-- "말하고 싶지 않아요" — AI는 이 주제를 공개하지 않는다고 답한다
alter table public.creator_facts add column undisclosed boolean not null default false;
alter table public.creator_facts drop constraint creator_facts_source_check;
alter table public.creator_facts add constraint creator_facts_source_check check (source in ('creator_studio', 'avatar_basics'));
create unique index creator_facts_basic_idx on public.creator_facts (creator_id, basic_key) where basic_key is not null;
-- basic_key · undisclosed · source는 컬럼 권한에 없다 → save_avatar_basics()만 정한다

-- ---------------------------------------------------------------------------
-- 4. creator_avatar_settings — 크리에이터 본인만. 쓰기는 함수만
-- ---------------------------------------------------------------------------
create table public.creator_avatar_settings (
  creator_id text primary key references public.creators (id) on delete cascade,
  boundaries_confirmed_at timestamptz,
  welcome_message text not null default '' check (char_length(welcome_message) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger creator_avatar_settings_updated_at before update on public.creator_avatar_settings
  for each row execute function public.set_updated_at();

alter table public.creator_avatar_settings enable row level security;
create policy "creator_avatar_settings: 본인만 조회" on public.creator_avatar_settings
  for select to authenticated using (public.is_creator_owner(creator_id));
grant select on public.creator_avatar_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 5. 준비 상태 · ON 가드 · 자동 OFF
-- ---------------------------------------------------------------------------
-- 필수 말투 문답 수 (40개 중) — 이보다 적으면 AI를 켤 수 없다. 필수(required) 질문은 모두 답해야 한다
create function private.avatar_style_minimum()
returns integer
language sql
immutable
set search_path = ''
as $$ select 32 $$;

-- 크리에이터 한 명의 학습 답변 전체 상한 (활성 + 보관). 다른 크리에이터와 합산하지 않는다
create function private.avatar_style_sample_cap()
returns integer
language sql
immutable
set search_path = ''
as $$ select 2000 $$;

create function private.avatar_readiness(p_creator_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job text;
  v_missing text[];
  v_answered integer;
  v_total integer;
  v_required_missing text[];
  v_persona boolean;
  v_boundaries boolean;
  v_min integer := private.avatar_style_minimum();
  v_basics boolean;
  v_style boolean;
begin
  select job into v_job from public.creators where id = p_creator_id;
  select coalesce(array_agg(k order by o), '{}') into v_missing
  from unnest(array['favorite_food', 'disliked_food', 'hobby', 'interest', 'likes', 'dislikes']) with ordinality as b(k, o)
  where not exists (select 1 from public.creator_facts f where f.creator_id = p_creator_id and f.basic_key = b.k and f.active);
  select count(distinct s.prompt_key)::int into v_answered
  from public.creator_style_samples s
  where s.creator_id = p_creator_id and s.source = 'onboarding' and s.archived_at is null;
  select count(*)::int into v_total from public.avatar_training_prompts;
  select coalesce(array_agg(p.key order by p.sort), '{}') into v_required_missing
  from public.avatar_training_prompts p
  where p.required and not exists (
    select 1 from public.creator_style_samples s
    where s.creator_id = p_creator_id and s.source = 'onboarding' and s.archived_at is null and s.prompt_key = p.key
  );
  v_persona := exists (select 1 from public.creator_personas p where p.creator_id = p_creator_id);
  v_boundaries := exists (select 1 from public.creator_avatar_settings a where a.creator_id = p_creator_id and a.boundaries_confirmed_at is not null);
  v_basics := coalesce(char_length(btrim(v_job)) > 0, false) and cardinality(v_missing) = 0;
  v_style := v_answered >= v_min and cardinality(v_required_missing) = 0;
  return jsonb_build_object(
    'ready', v_basics and v_style and v_persona and v_boundaries,
    'basics', jsonb_build_object('done', v_basics, 'job', coalesce(char_length(btrim(v_job)) > 0, false), 'missing', to_jsonb(v_missing)),
    'style', jsonb_build_object('done', v_style, 'answered', v_answered, 'minimum', v_min, 'total', v_total, 'requiredMissing', to_jsonb(v_required_missing)),
    'persona', v_persona,
    'boundaries', v_boundaries
  );
end;
$$;

create function private.avatar_ready(p_creator_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((private.avatar_readiness(p_creator_id) ->> 'ready')::boolean, false) $$;

-- AI 문답 ON 가드: 준비가 끝나지 않았으면 켤 수 없다 (API로 직접 켜도 DB가 거부). 새 행은 항상 OFF로 시작
create function private.creators_avatar_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.persona_enabled and not private.avatar_ready(new.id) then
      new.persona_enabled := false;
    end if;
  elsif new.persona_enabled and not old.persona_enabled and not private.avatar_ready(new.id) then
    raise exception 'avatar_not_ready' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger creators_avatar_guard before insert or update of persona_enabled on public.creators
  for each row execute function private.creators_avatar_guard();

-- 준비가 깨지면 자동으로 끈다. 트랜잭션 끝에 확인한다 (다시 답하기 = 보관 → 새 행 저장 사이에 꺼지지 않도록)
create function private.avatar_enforce()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid text := case when tg_op = 'DELETE' then old.creator_id else new.creator_id end;
begin
  update public.creators c set persona_enabled = false
  where c.id = cid and c.persona_enabled and not private.avatar_ready(cid);
  return null;
end;
$$;

create function private.creators_job_enforce()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.persona_enabled and not private.avatar_ready(new.id) then
    update public.creators set persona_enabled = false where id = new.id;
  end if;
  return null;
end;
$$;

create constraint trigger creator_facts_avatar_enforce after update or delete on public.creator_facts
  deferrable initially deferred for each row execute function private.avatar_enforce();
create constraint trigger creator_style_samples_avatar_enforce after update or delete on public.creator_style_samples
  deferrable initially deferred for each row execute function private.avatar_enforce();
create constraint trigger creator_personas_avatar_enforce after delete on public.creator_personas
  deferrable initially deferred for each row execute function private.avatar_enforce();
create constraint trigger creators_job_avatar_enforce after update of job on public.creators
  deferrable initially deferred for each row execute function private.creators_job_enforce();

-- 기존 채널: 준비되지 않은 채 켜져 있던 AI는 끈다 (준비를 마치면 다시 켤 수 있다)
update public.creators c set persona_enabled = false where c.persona_enabled and not private.avatar_ready(c.id);

-- 말투(Style) 원본은 학습 답변이다. 예전 Persona의 말투 칸을 앱에서 직접 덮어쓰는 경로는 닫는다 (성향 traits만 본인이 고른다)
revoke insert, update on public.creator_personas from authenticated;
grant insert (creator_id, traits) on public.creator_personas to authenticated;
grant update (traits) on public.creator_personas to authenticated;

-- ---------------------------------------------------------------------------
-- 6. 저장 함수 — 크리에이터 = auth.uid()의 채널 (인자로 채널을 받지 않는다)
-- ---------------------------------------------------------------------------
create function private.my_creator_id()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid text;
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  select id into cid from public.creators where profile_id = (select auth.uid());
  if cid is null then raise exception 'not_a_creator' using errcode = '42501'; end if;
  return cid;
end;
$$;

-- 내 AI Avatar 준비 상태
create function public.avatar_readiness()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select private.avatar_readiness(private.my_creator_id()) $$;

-- STEP 1 기본정보: 직업/활동 분야(공개) + 6개 항목 → Verified Facts. 보낸 항목만 저장 (나중에 언제든 수정)
--   p_items: {"favorite_food": {"value": "떡볶이", "undisclosed": false}, ...}
create function public.save_avatar_basics(p_job text, p_items jsonb default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid text := private.my_creator_id();
  v_job text := btrim(coalesce(p_job, ''));
  k text;
  item jsonb;
  v text;
  und boolean;
  body text;
  label text;
  cat text;
begin
  if char_length(v_job) not between 1 and 40 then raise exception 'invalid job' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'object' then raise exception 'invalid items' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_object_keys(p_items) as x(key)
             where x.key not in ('favorite_food', 'disliked_food', 'hobby', 'interest', 'likes', 'dislikes')) then
    raise exception 'invalid items' using errcode = '22023';
  end if;
  update public.creators set job = v_job where id = cid;

  for k in select key from jsonb_object_keys(p_items) as x(key) loop
    item := p_items -> k;
    if jsonb_typeof(item) <> 'object' then raise exception 'invalid items' using errcode = '22023'; end if;
    und := coalesce((item ->> 'undisclosed')::boolean, false);
    v := btrim(coalesce(item ->> 'value', ''));
    if not und and char_length(v) not between 1 and 200 then raise exception 'invalid value' using errcode = '22023'; end if;
    label := case k
      when 'favorite_food' then '좋아하는 음식' when 'disliked_food' then '싫어하는 음식' when 'hobby' then '취미'
      when 'interest' then '관심사' when 'likes' then '좋아하는 것' else '싫어하는 것' end;
    cat := case k when 'favorite_food' then 'food' when 'disliked_food' then 'food' when 'hobby' then 'hobby' when 'interest' then 'activity' else 'other' end;
    body := label || ': ' || case when und then '공개하지 않음' else v end;
    update public.creator_facts
    set content = body, undisclosed = und, active = true, category = cat
    where creator_id = cid and basic_key = k;
    if not found then
      insert into public.creator_facts (creator_id, category, content, source, basic_key, undisclosed)
      values (cid, cat, body, 'avatar_basics', k, und);
    end if;
  end loop;
  return private.avatar_readiness(cid);
end;
$$;

-- STEP 2 말투 학습 답변 (여러 개 한 번에). 같은 질문에 다시 답하면 이전 답은 보관하고 새 답을 쓴다 (명시적인 재학습)
--   p_items: [{"key": "today_1", "reply": "..."}]
create function public.save_style_answers(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid text := private.my_creator_id();
  item jsonb;
  pr public.avatar_training_prompts;
  body text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'invalid items' using errcode = '22023';
  end if;
  -- 안전 상한: 이 크리에이터의 학습 답변 전체(보관 포함) 2,000행. 넘으면 거부 — 오래된 답을 지우거나 줄이지 않는다
  perform pg_advisory_xact_lock(hashtextextended('momenty:style:' || cid, 0));
  if (select count(*) from public.creator_style_samples where creator_id = cid) + jsonb_array_length(p_items) > private.avatar_style_sample_cap() then
    raise exception 'style sample limit' using errcode = '23514';
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    select * into pr from public.avatar_training_prompts where key = item ->> 'key';
    if not found then raise exception 'invalid prompt' using errcode = '22023'; end if;
    body := btrim(coalesce(item ->> 'reply', ''));
    if char_length(body) not between 1 and 500 then raise exception 'invalid reply' using errcode = '22023'; end if;
    update public.creator_style_samples set archived_at = now()
    where creator_id = cid and source = 'onboarding' and prompt_key = pr.key and archived_at is null;
    insert into public.creator_style_samples (creator_id, source, prompt_key, fan_message, reply)
    values (cid, 'onboarding', pr.key, pr.fan_message, body);
  end loop;
  return private.avatar_readiness(cid);
end;
$$;

-- 추가 학습 (선택 · 매일 할 필요 없음). creator_correction은 고치기 전 AI 예상 답변(ai_draft)을 함께 남긴다
create function public.add_style_training(p_fan_message text, p_reply text, p_source text default 'avatar_training', p_ai_draft text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid text := private.my_creator_id();
  sid uuid;
begin
  if p_source is null or p_source not in ('avatar_training', 'creator_correction') then raise exception 'invalid source' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_fan_message, ''))) not between 1 and 300 then raise exception 'invalid fan message' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reply, ''))) not between 1 and 500 then raise exception 'invalid reply' using errcode = '22023'; end if;
  if p_source = 'creator_correction' and char_length(btrim(coalesce(p_ai_draft, ''))) not between 1 and 1000 then
    raise exception 'invalid draft' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('momenty:style:' || cid, 0));
  if (select count(*) from public.creator_style_samples where creator_id = cid and archived_at is null) >= 400 then
    raise exception 'too many samples' using errcode = '23514';
  end if;
  -- 같은 전체 상한 (보관 포함 2,000행)
  if (select count(*) from public.creator_style_samples where creator_id = cid) >= private.avatar_style_sample_cap() then
    raise exception 'style sample limit' using errcode = '23514';
  end if;
  insert into public.creator_style_samples (creator_id, source, fan_message, reply, ai_draft)
  values (cid, p_source, btrim(p_fan_message), btrim(p_reply), case when p_source = 'creator_correction' then btrim(p_ai_draft) end)
  returning id into sid;
  return sid;
end;
$$;

-- 말투 학습 전체 초기화 (확인 문구 필요). 지우지 않고 보관 → AI 문답은 꺼지고 다시 학습해야 켤 수 있다
create function public.reset_style_training(p_confirm text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid text := private.my_creator_id();
  n integer;
begin
  if p_confirm is distinct from '초기화' then raise exception 'confirmation_required' using errcode = '22023'; end if;
  update public.creators set persona_enabled = false where id = cid;
  update public.creator_style_samples set archived_at = now() where creator_id = cid and archived_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 대화 경계를 확인했다는 표시 (값은 creator_boundaries — 행이 없으면 기본값)
create function public.confirm_avatar_boundaries()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid text := private.my_creator_id();
  t timestamptz;
begin
  insert into public.creator_avatar_settings (creator_id, boundaries_confirmed_at) values (cid, now())
  on conflict (creator_id) do update set boundaries_confirmed_at = now()
  returning boundaries_confirmed_at into t;
  return t;
end;
$$;

-- 구독 환영 메시지 ('' = 보내지 않음)
create function public.save_welcome_message(p_message text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid text := private.my_creator_id();
  body text := btrim(coalesce(p_message, ''));
begin
  if char_length(body) > 500 then raise exception 'invalid message' using errcode = '22023'; end if;
  insert into public.creator_avatar_settings (creator_id, welcome_message) values (cid, body)
  on conflict (creator_id) do update set welcome_message = excluded.welcome_message;
  return body;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. AI 대화 열람 고지 — 팬이 확인한 뒤의 메시지만 크리에이터가 볼 수 있다
--    ai_conversations · ai_messages RLS는 바꾸지 않는다. 크리에이터는 creator_fan_ai_messages()로만 본다.
--    확인 전 대화 · 확인을 취소한 뒤(행 삭제)는 보이지 않는다. 다시 확인하면 그 시각부터.
-- ---------------------------------------------------------------------------
create table public.ai_creator_view_consents (
  fan_id uuid not null references public.profiles (id) on delete cascade,
  creator_id text not null references public.creators (id) on delete cascade,
  notice_version smallint not null default 1 check (notice_version >= 1),
  agreed_at timestamptz not null default now(),
  primary key (fan_id, creator_id)
);

alter table public.ai_creator_view_consents enable row level security;
create policy "ai_creator_view_consents: 팬 본인만 조회" on public.ai_creator_view_consents
  for select to authenticated using (fan_id = (select auth.uid()));
create policy "ai_creator_view_consents: 팬 본인만 취소" on public.ai_creator_view_consents
  for delete to authenticated using (fan_id = (select auth.uid()));
grant select, delete on public.ai_creator_view_consents to authenticated;

create function public.acknowledge_ai_notice(p_creator_id text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  owner uuid;
  t timestamptz;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  select profile_id into owner from public.creators where id = p_creator_id;
  if owner is null then raise exception 'creator_not_found' using errcode = 'P0002'; end if;
  if owner = uid then raise exception 'own_channel' using errcode = '42501'; end if;
  insert into public.ai_creator_view_consents (fan_id, creator_id) values (uid, p_creator_id)
  on conflict (fan_id, creator_id) do nothing;
  select agreed_at into t from public.ai_creator_view_consents where fan_id = uid and creator_id = p_creator_id;
  return t;
end;
$$;

-- 크리에이터: 내 채널 팬의 AI Avatar 대화 (고지 확인 뒤 메시지만 · 최근 p_limit개). Fan Memory는 포함하지 않는다
create function public.creator_fan_ai_messages(p_fan_id uuid, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid text := private.my_creator_id();
  since timestamptz;
  lim integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  if p_fan_id is null or not public.creator_has_fan(cid, p_fan_id) then raise exception 'fan_not_found' using errcode = 'P0002'; end if;
  select agreed_at into since from public.ai_creator_view_consents where fan_id = p_fan_id and creator_id = cid;
  if since is null then
    return jsonb_build_object('consented', false, 'agreedAt', null, 'messages', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'consented', true,
    'agreedAt', since,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'sender', x.sender, 'content', x.content, 'createdAt', x.created_at, 'boundary', x.boundary) order by x.created_at)
      from (
        select m.id, m.sender, m.content, m.created_at, m.boundary
        from public.ai_messages m
        join public.ai_conversations c on c.id = m.conversation_id
        where c.fan_id = p_fan_id and c.creator_id = cid and m.created_at >= since
        order by m.created_at desc
        limit lim
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Persona 대화 권한 · Context (v0.7 · v0.5 함수 교체 — 시그니처 동일)
--    추가: AI Avatar 준비(ready) · 팬의 열람 고지 확인('ai_notice_required')
-- ---------------------------------------------------------------------------
create or replace function private.persona_chat_denial(p_uid uuid, p_creator_id text)
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
  if private.blocked_between(p_uid, c.profile_id) then return 'blocked'; end if;
  if not c.persona_enabled then return 'persona_disabled'; end if;
  if not private.avatar_ready(p_creator_id) then return 'persona_not_configured'; end if;
  select tier into t from public.subscriptions where fan_id = p_uid and creator_id = p_creator_id;
  if t is null or t not in ('subscriber', 'premium') then return 'subscription_required'; end if;
  if not exists (select 1 from public.ai_creator_view_consents v where v.fan_id = p_uid and v.creator_id = p_creator_id) then
    return 'ai_notice_required';
  end if;
  return null;
end;
$$;

-- Prompt에 필요한 값만: IDENTITY(이름 · 아이디 · 직업) · 성향 · 사실(기본정보 포함, 공개하지 않은 항목 표시) · Boundary ·
-- 말투 학습 답변(STYLE 예시 — 사실 근거가 아니다). 학습 답변은 활성 처음 학습 전부 + 최근 추가 학습 20개까지
create or replace function public.ai_persona_context(p_server_key text, p_creator_id text)
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
    'creator', jsonb_build_object('id', c.id, 'name', c.name, 'handle', c.handle, 'job', c.job),
    'style', jsonb_build_object(
      'formality', p.formality, 'replyLength', p.reply_length, 'laughKk', p.laugh_kk, 'laughHh', p.laugh_hh,
      'emojiLevel', p.emoji_level, 'phrases', to_jsonb(p.phrases), 'mood', p.mood, 'examples', to_jsonb(p.example_messages)
    ),
    'personality', jsonb_build_object('traits', to_jsonb(p.traits)),
    'facts', coalesce((
      select jsonb_agg(jsonb_build_object('category', f.category, 'content', f.content, 'undisclosed', f.undisclosed) order by f.basic_key nulls last, f.created_at)
      from (select * from public.creator_facts where creator_id = p_creator_id and active order by created_at limit 50) f
    ), '[]'::jsonb),
    'boundaries', (
      select jsonb_object_agg(d.topic, coalesce(b.allowed, d.allowed_default))
      from (values
        ('everyday', true), ('jokes', true), ('listening', true), ('hobbies', true),
        ('flirting', false), ('romance_roleplay', false), ('sexual', false), ('politics', false),
        ('meeting_requests', false), ('current_location', false)
      ) as d(topic, allowed_default)
      left join public.creator_boundaries b on b.creator_id = p_creator_id and b.topic = d.topic
    ),
    'styleSamples', coalesce((
      select jsonb_agg(jsonb_build_object('situation', s.category, 'fan', s.fan_message, 'reply', s.reply, 'source', s.source) order by s.ord, s.created_at)
      from (
        select x.*, coalesce(pr.category, 'extra') as category, coalesce(pr.sort, 1000) as ord
        from public.creator_style_samples x
        left join public.avatar_training_prompts pr on pr.key = x.prompt_key
        where x.creator_id = p_creator_id and x.archived_at is null and x.source = 'onboarding'
        union all
        select * from (
          select x.*, 'extra' as category, 1000 as ord
          from public.creator_style_samples x
          where x.creator_id = p_creator_id and x.archived_at is null and x.source <> 'onboarding'
          order by x.created_at desc
          limit 20
        ) extra
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. 구독 환영 메시지 — 유료 구독이 활성화되는 순간 한 번 (팬 × 크리에이터당 한 번 · 중복 없음)
--    크리에이터가 미리 설정한 자동 메시지다. Human Chat(human_messages)에 넣지 않는다 → "본인이 직접 보낸 메시지"로 보이지 않는다.
-- ---------------------------------------------------------------------------
create table public.subscription_welcomes (
  id uuid primary key default gen_random_uuid(),
  fan_id uuid not null references public.profiles (id) on delete cascade,
  creator_id text not null references public.creators (id) on delete cascade,
  tier public.subscription_tier not null,
  message text not null check (char_length(btrim(message)) between 1 and 500),
  created_at timestamptz not null default now(),
  unique (fan_id, creator_id)
);

alter table public.subscription_welcomes enable row level security;
create policy "subscription_welcomes: 팬 본인 · 크리에이터 조회" on public.subscription_welcomes
  for select to authenticated using (fan_id = (select auth.uid()) or public.is_creator_owner(creator_id));
grant select on public.subscription_welcomes to authenticated;
-- 쓰기 권한 없음 → trigger만

create function private.subscriptions_welcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg text;
  owner uuid;
begin
  -- 유료 = follow가 아닌 등급 (sync_creator_counts와 같은 기준 — 결제에서 등급이 늘어도 그대로)
  if new.tier = 'follow' or (tg_op = 'UPDATE' and old.tier <> 'follow') then
    return null;
  end if;
  select a.welcome_message, c.profile_id into msg, owner
  from public.creators c left join public.creator_avatar_settings a on a.creator_id = c.id
  where c.id = new.creator_id;
  if coalesce(btrim(msg), '') = '' or private.blocked_between(new.fan_id, owner) then
    return null;
  end if;
  insert into public.subscription_welcomes (fan_id, creator_id, tier, message)
  values (new.fan_id, new.creator_id, new.tier, btrim(msg))
  on conflict (fan_id, creator_id) do nothing;
  return null;
end;
$$;
create trigger subscriptions_welcome after insert or update of tier on public.subscriptions
  for each row execute function private.subscriptions_welcome();

-- ---------------------------------------------------------------------------
-- 10. Fans — 플랜별 (등급 목록은 enum에서 읽는다 → 등급이 늘어도 함수는 그대로)
-- ---------------------------------------------------------------------------
create function public.fan_manager_tier_counts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('tier', e.t::text, 'count', coalesce(s.n, 0)) order by e.o), '[]'::jsonb)
  from unnest(enum_range(null::public.subscription_tier)) with ordinality as e(t, o)
  left join (
    select tier, count(*)::int as n from public.subscriptions where creator_id = private.my_creator_id() group by tier
  ) s on s.tier = e.t;
$$;

-- p_tier: null = 전체(무료 팔로우 포함) · 등급 이름. 구독 시작 최신순 커서
create function public.fan_manager_by_tier(p_tier text default null, p_limit integer default 30, p_cursor_started_at timestamptz default null, p_cursor_fan_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  cid text := private.my_creator_id();
  lim integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  ids uuid[];
  items jsonb;
  last_row record;
begin
  if p_tier is not null and not (p_tier = any (enum_range(null::public.subscription_tier)::text[])) then
    raise exception 'invalid tier' using errcode = '22023';
  end if;
  if (p_cursor_started_at is null) <> (p_cursor_fan_id is null) then raise exception 'invalid cursor' using errcode = '22023'; end if;
  select coalesce(array_agg(s.fan_id order by s.started_at desc, s.fan_id desc), '{}') into ids
  from (
    select s.fan_id, s.started_at from public.subscriptions s
    where s.creator_id = cid and (p_tier is null or s.tier::text = p_tier)
      and (p_cursor_started_at is null or (s.started_at, s.fan_id) < (p_cursor_started_at, p_cursor_fan_id))
    order by s.started_at desc, s.fan_id desc
    limit lim
  ) s;
  select coalesce(jsonb_agg(r order by (r ->> 'subscribedAt') desc, (r ->> 'fanId') desc), '[]') into items
  from private.fan_manager_rows(cid, uid, ids) r;
  select s.started_at, s.fan_id into last_row from public.subscriptions s
  where s.creator_id = cid and s.fan_id = ids[array_length(ids, 1)];
  return jsonb_build_object(
    'items', items,
    'nextCursor', case when coalesce(array_length(ids, 1), 0) = lim then jsonb_build_object('startedAt', last_row.started_at, 'fanId', last_row.fan_id) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. 통계 — 날짜별(KST) 실제 행 수만. 기간 최대 92일
--   moments       그날 기록한 Moment (공개 예정 포함 — 크리에이터 본인 통계)
--   reactions     그날 받은 반응 (반응 시각 기준)
--   newFollowers  그날 시작된 관계 (지금 유지 중인 구독 행의 시작일 기준 — 취소 이력은 저장하지 않는다)
--   aiMessages    그날 팬이 AI Avatar에게 보낸 메시지 수 · aiFans 그 팬 수 (합계만 — 내용 · 팬별 값 없음)
--                 열람 안내를 확인한 팬의 확인 이후 메시지만 센다 (확인하지 않은 팬의 AI 활동은 통계에도 드러나지 않는다)
-- ---------------------------------------------------------------------------
create function public.creator_analytics(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid text := private.my_creator_id();
begin
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 92 then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'days', (
      select jsonb_agg(jsonb_build_object(
        'date', d.day,
        'moments', coalesce(m.n, 0),
        'reactions', coalesce(r.n, 0),
        'newFollowers', coalesce(s.n, 0),
        'aiMessages', coalesce(a.n, 0),
        'aiFans', coalesce(a.fans, 0)
      ) order by d.day)
      from (select g::date as day from generate_series(p_from, p_to, interval '1 day') g) d
      left join (
        select (x.created_at at time zone 'Asia/Seoul')::date as day, count(*)::int as n
        from public.moments x where x.creator_id = cid
          and x.created_at >= (p_from::timestamp at time zone 'Asia/Seoul') and x.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
        group by 1
      ) m on m.day = d.day
      left join (
        select (x.created_at at time zone 'Asia/Seoul')::date as day, count(*)::int as n
        from public.moment_reactions x join public.moments y on y.id = x.moment_id
        where y.creator_id = cid
          and x.created_at >= (p_from::timestamp at time zone 'Asia/Seoul') and x.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
        group by 1
      ) r on r.day = d.day
      left join (
        select (x.started_at at time zone 'Asia/Seoul')::date as day, count(*)::int as n
        from public.subscriptions x where x.creator_id = cid
          and x.started_at >= (p_from::timestamp at time zone 'Asia/Seoul') and x.started_at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
        group by 1
      ) s on s.day = d.day
      left join (
        select (x.created_at at time zone 'Asia/Seoul')::date as day, count(*)::int as n, count(distinct c.fan_id)::int as fans
        from public.ai_messages x
        join public.ai_conversations c on c.id = x.conversation_id
        -- 열람 안내를 확인한 팬의, 확인 이후 메시지만 (이 크리에이터에 대한 확인만 인정).
        -- 확인을 취소하면 행이 사라져 그 팬은 전부 빠지고, 취소 중에는 AI 대화 자체가 거부되어 새 메시지가 생기지 않는다
        join public.ai_creator_view_consents v on v.fan_id = c.fan_id and v.creator_id = c.creator_id
        where c.creator_id = cid and x.sender = 'fan' and x.created_at >= v.agreed_at
          and x.created_at >= (p_from::timestamp at time zone 'Asia/Seoul') and x.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
        group by 1
      ) a on a.day = d.day
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 권한
-- ---------------------------------------------------------------------------
revoke all on function private.avatar_style_minimum() from public, anon, authenticated;
revoke all on function private.avatar_style_sample_cap() from public, anon, authenticated;
revoke all on function private.avatar_readiness(text) from public, anon, authenticated;
revoke all on function private.avatar_ready(text) from public, anon, authenticated;
revoke all on function private.creators_avatar_guard() from public, anon, authenticated;
revoke all on function private.avatar_enforce() from public, anon, authenticated;
revoke all on function private.creators_job_enforce() from public, anon, authenticated;
revoke all on function private.my_creator_id() from public, anon, authenticated;
revoke all on function private.subscriptions_welcome() from public, anon, authenticated;

revoke all on function public.avatar_readiness() from public, anon;
revoke all on function public.save_avatar_basics(text, jsonb) from public, anon;
revoke all on function public.save_style_answers(jsonb) from public, anon;
revoke all on function public.add_style_training(text, text, text, text) from public, anon;
revoke all on function public.reset_style_training(text) from public, anon;
revoke all on function public.confirm_avatar_boundaries() from public, anon;
revoke all on function public.save_welcome_message(text) from public, anon;
revoke all on function public.acknowledge_ai_notice(text) from public, anon;
revoke all on function public.creator_fan_ai_messages(uuid, integer) from public, anon;
revoke all on function public.fan_manager_tier_counts() from public, anon;
revoke all on function public.fan_manager_by_tier(text, integer, timestamptz, uuid) from public, anon;
revoke all on function public.creator_analytics(date, date) from public, anon;
grant execute on function public.avatar_readiness() to authenticated;
grant execute on function public.save_avatar_basics(text, jsonb) to authenticated;
grant execute on function public.save_style_answers(jsonb) to authenticated;
grant execute on function public.add_style_training(text, text, text, text) to authenticated;
grant execute on function public.reset_style_training(text) to authenticated;
grant execute on function public.confirm_avatar_boundaries() to authenticated;
grant execute on function public.save_welcome_message(text) to authenticated;
grant execute on function public.acknowledge_ai_notice(text) to authenticated;
grant execute on function public.creator_fan_ai_messages(uuid, integer) to authenticated;
grant execute on function public.fan_manager_tier_counts() to authenticated;
grant execute on function public.fan_manager_by_tier(text, integer, timestamptz, uuid) to authenticated;
grant execute on function public.creator_analytics(date, date) to authenticated;

-- service_role (정리 스크립트 · 테스트 준비 · 계정 삭제): 새 테이블 권한 (앱 경로는 쓰지 않는다)
grant all on public.avatar_training_prompts, public.creator_style_samples, public.creator_avatar_settings,
  public.ai_creator_view_consents, public.subscription_welcomes to service_role;
