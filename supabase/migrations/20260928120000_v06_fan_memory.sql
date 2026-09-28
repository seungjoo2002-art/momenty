-- ============================================================================
-- MOMENTY v0.6 · Fan Memory
--
-- Fan Memory = "지금 대화하는 팬에 관한 관계 맥락" (호칭 · 관심사 · 좋아하는 것 · 중요한 일정 …).
-- 크리에이터에 관한 사실(creator_facts)과는 다른 테이블 · 다른 함수 · Prompt의 다른 칸이다. 절대 섞지 않는다.
--
--  1. fan_ai_settings   팬별 Memory ON/OFF (기본 OFF — 팬이 직접 켜야 기억한다)
--  2. fan_memory_sensitive()  민감정보(건강 · 정신건강 · 성 · 주소 · 금융 · 인증정보 · 식별번호 · 정치 · 종교 · 범죄 …)
--                       는 자동 저장하지 않는다 — 서버 코드와 별개로 DB가 한 번 더 막는다 (테이블 제약)
--  3. fan_memories      fan × creator 단위. 팬 본인만 조회 · 삭제. 크리에이터 · 다른 팬은 읽을 수 없다.
--                       insert · update 권한은 아무에게도 주지 않는다 → record_fan_memories()만 쓴다
--  4. ai_fan_memory_context()  서버(키) + 권한 있는 팬(JWT)에게, 이 크리에이터 AI에 대한 이 팬의 Memory 중
--                       관련 있는 것 · 최근 것만 최대 8개. Memory OFF면 아무것도 주지 않는다.
--  5. record_fan_memories()    서버(키) + 팬(JWT). Memory OFF면 저장하지 않는다. 한 번에 3개 · fan×creator당 50개까지.
--
-- service role은 쓰지 않는다 (v0.5와 같은 구조: 팬 JWT로 권한 판단 + 서버 키로 "서버가 부른 것" 확인).
-- 기존 Memory는 OFF로 바꿔도 자동 삭제하지 않는다 — 팬이 직접 지운다 (개별 · 크리에이터별 · 전체).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 팬별 Memory ON/OFF
-- ---------------------------------------------------------------------------
create table public.fan_ai_settings (
  fan_id uuid primary key references public.profiles (id) on delete cascade,
  memory_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger fan_ai_settings_updated_at before update on public.fan_ai_settings
  for each row execute function public.set_updated_at();

alter table public.fan_ai_settings enable row level security;

create policy "fan_ai_settings: 본인만" on public.fan_ai_settings
  for all to authenticated
  using (fan_id = (select auth.uid())) with check (fan_id = (select auth.uid()));

grant select on public.fan_ai_settings to authenticated;
grant insert (fan_id, memory_enabled) on public.fan_ai_settings to authenticated;
grant update (memory_enabled) on public.fan_ai_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 2. 민감정보 판정 (테이블 제약 · 저장 함수가 함께 쓴다)
--    키워드 기반 — 놓치는 표현보다 "안전한 쪽으로 저장하지 않음"을 택한다 (오탐 = 기억하지 않을 뿐)
-- ---------------------------------------------------------------------------
create function public.fan_memory_sensitive(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is null or (
    -- 건강 · 질병
    p ~* '(병원|질병|질환|진단|투병|수술|입원|통원|처방|복용|약을?\s*먹|당뇨|고혈압|천식|아토피|알레르기|암\s*(진단|환자|수술|투병|치료)|장애|임신|유산|난임|디스크|건강\s*검진|검사\s*결과)'
    -- 정신건강
    or p ~* '(우울|공황|불안\s*장애|정신과|정신\s*건강|심리\s*상담|상담\s*치료|자살|자해|트라우마|adhd|조울|강박|섭식|거식|폭식|수면제|항우울)'
    -- 성생활 · 성적 지향
    or p ~* '(성관계|섹스|성생활|성적\s*(취향|지향)|성\s*정체성|동성애|양성애|게이(?!머|밍|트)|레즈|트랜스젠더|\msex\M)'
    -- 정확한 주소 · 연락처
    or p ~* '(주소|번지|우편\s*번호|\d+\s*동\s*\d+\s*호|[가-힣]+(로|길)\s*\d+|아파트\s*\d|전화\s*번호|휴대폰\s*번호|핸드폰\s*번호|010[-\s.]?\d|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})'
    -- 금융 · 인증정보
    or p ~* '(계좌|카드\s*번호|신용\s*카드|체크\s*카드|비밀\s*번호|비번|패스워드|password|인증\s*번호|otp|공인\s*인증|대출|빚|채무|연봉|월급|급여|신용\s*(등급|점수)|재산)'
    -- 식별번호
    or p ~* '(주민\s*(등록)?\s*번호|여권\s*번호|면허\s*번호|외국인\s*등록|사업자\s*번호|\d{6}\s*-\s*\d{7}|\d{6,})'
    -- 정치 성향
    or p ~* '(정치|정당|민주당|국민의\s*힘|진보|보수|좌파|우파|대통령|선거|투표|지지하는\s*(당|후보))'
    -- 종교
    or p ~* '(종교|교회|성당|(^|[^가-힣])절에|사찰|기독교|천주교|개신교|불교|이슬람|무슬림|신앙|예배|미사|기도\s*모임)'
    -- 범죄
    or p ~* '(범죄|전과|체포|구속|수감|교도소|마약|징역|벌금형|폭행|경찰\s*조사|소송|고소(를|했|당|장))'
    -- 기타 고위험 (가정사 · 폭력 등)
    or p ~* '(이혼|가정\s*폭력|학대|성폭력|성추행|스토킹)'
  );
$$;

revoke all on function public.fan_memory_sensitive(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. fan_memories
-- ---------------------------------------------------------------------------
create table public.fan_memories (
  id uuid primary key default gen_random_uuid(),
  fan_id uuid not null references public.profiles (id) on delete cascade,
  creator_id text not null references public.creators (id) on delete cascade,
  -- nickname 호칭 · interest 관심사/취미 · favorite 좋아하는 것 · schedule 중요한 일정 · other 기타
  category text not null check (category in ('nickname', 'interest', 'favorite', 'schedule', 'other')),
  content text not null check (char_length(btrim(content)) between 1 and 200 and not public.fan_memory_sensitive(content)),
  -- 지금은 AI 대화에서 추출한 것뿐 (앱에서 바꿀 수 없다)
  source text not null default 'ai_chat' check (source in ('ai_chat')),
  -- 근거가 된 팬 메시지 (팬이 대화를 지워도 Memory는 남는다 — Memory는 따로 지운다)
  source_message_id uuid references public.ai_messages (id) on delete set null,
  created_at timestamptz not null default now()
);

-- 같은 팬 · 크리에이터에 같은 내용은 한 번만
create unique index fan_memories_dedupe_idx on public.fan_memories (fan_id, creator_id, lower(btrim(content)));
create index fan_memories_fan_creator_idx on public.fan_memories (fan_id, creator_id, created_at desc);

alter table public.fan_memories enable row level security;

-- 팬 본인만 조회 · 삭제. 크리에이터용 정책은 없다 (크리에이터는 팬의 Memory 원문을 읽을 수 없다)
create policy "fan_memories: 팬 본인만 조회" on public.fan_memories
  for select to authenticated using (fan_id = (select auth.uid()));
create policy "fan_memories: 팬 본인만 삭제" on public.fan_memories
  for delete to authenticated using (fan_id = (select auth.uid()));

grant select, delete on public.fan_memories to authenticated;
-- insert · update 권한은 주지 않는다 → record_fan_memories()만 쓸 수 있다

-- ---------------------------------------------------------------------------
-- 4. ai_fan_memory_context — Persona Prompt의 FAN CONTEXT 칸
--    p_terms: 서버가 팬 메시지에서 뽑은 검색어 (관련 Memory를 앞으로). 권한 · 범위에는 영향이 없다:
--             항상 auth.uid() × p_creator_id 안에서만, 최대 8개.
-- ---------------------------------------------------------------------------
create function public.ai_fan_memory_context(p_server_key text, p_creator_id text, p_terms text[] default '{}', p_limit integer default 6)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  denial text;
  terms text[];
  lim integer := least(greatest(coalesce(p_limit, 6), 0), 8);
begin
  perform private.require_server_key(p_server_key);
  denial := private.persona_chat_denial(uid, p_creator_id);
  if denial is not null then
    raise exception '%', denial using errcode = case when denial = 'creator_not_found' then 'P0002' else '42501' end;
  end if;

  if not coalesce((select s.memory_enabled from public.fan_ai_settings s where s.fan_id = uid), false) then
    return jsonb_build_object('enabled', false, 'items', '[]'::jsonb);
  end if;

  select coalesce(array_agg(t), '{}') into terms
  from (
    select distinct lower(btrim(x)) as t
    from unnest(coalesce(p_terms, '{}')) with ordinality as u(x, n)
    where char_length(btrim(x)) between 2 and 20 and n <= 12
  ) q;

  return jsonb_build_object(
    'enabled', true,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('category', r.category, 'content', r.content) order by r.score desc, r.pin desc, r.created_at desc)
      from (
        select m.category, m.content, m.created_at,
          (select count(*) from unnest(terms) t where position(t in lower(m.content)) > 0) as score,
          (m.category = 'nickname') as pin
        from public.fan_memories m
        where m.fan_id = uid and m.creator_id = p_creator_id
        order by 4 desc, 5 desc, m.created_at desc
        limit lim
      ) r
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. record_fan_memories — 대화에서 뽑은 팬 Memory 저장 (서버만)
--    p_items: [{"category": "...", "content": "..."}] 최대 3개. 형식이 틀리면 거부, 민감정보 · 중복 · 한도 초과는 건너뛴다.
-- ---------------------------------------------------------------------------
create function public.record_fan_memories(p_server_key text, p_creator_id text, p_items jsonb, p_source_message_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  denial text;
  item jsonb;
  cat text;
  body text;
  existing integer;
  saved integer := 0;
  sensitive integer := 0;
  duplicate integer := 0;
  over_limit integer := 0;
  n integer;
begin
  perform private.require_server_key(p_server_key);
  denial := private.persona_chat_denial(uid, p_creator_id);
  if denial is not null then
    raise exception '%', denial using errcode = case when denial = 'creator_not_found' then 'P0002' else '42501' end;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 3 then
    raise exception 'invalid memory items' using errcode = '22023';
  end if;
  for item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) <> 'object'
       or jsonb_typeof(item -> 'category') is distinct from 'string'
       or jsonb_typeof(item -> 'content') is distinct from 'string'
       or (item ->> 'category') not in ('nickname', 'interest', 'favorite', 'schedule', 'other')
       or char_length(btrim(item ->> 'content')) not between 1 and 200 then
      raise exception 'invalid memory items' using errcode = '22023';
    end if;
  end loop;

  -- 근거 메시지는 이 팬 · 이 크리에이터 대화의 팬 메시지여야 한다
  if p_source_message_id is not null and not exists (
    select 1 from public.ai_messages m
    join public.ai_conversations c on c.id = m.conversation_id
    where m.id = p_source_message_id and m.sender = 'fan' and c.fan_id = uid and c.creator_id = p_creator_id
  ) then
    raise exception 'invalid source message' using errcode = '22023';
  end if;

  -- Memory OFF: 새로 기억하지 않는다 (기존 Memory는 그대로)
  if not coalesce((select s.memory_enabled from public.fan_ai_settings s where s.fan_id = uid), false) then
    return jsonb_build_object('enabled', false, 'saved', 0);
  end if;

  -- fan × creator 50개 한도 — 동시 요청도 "세고 → 넣기"를 한 번에 하나씩
  perform pg_advisory_xact_lock(hashtextextended('momenty:fan_memories:' || uid || ':' || p_creator_id, 0));
  select count(*) into existing from public.fan_memories where fan_id = uid and creator_id = p_creator_id;

  for item in select * from jsonb_array_elements(p_items) loop
    cat := item ->> 'category';
    body := btrim(regexp_replace(item ->> 'content', '\s+', ' ', 'g'));
    if public.fan_memory_sensitive(body) then
      sensitive := sensitive + 1;
      continue;
    end if;
    if existing + saved >= 50 then
      over_limit := over_limit + 1;
      continue;
    end if;
    insert into public.fan_memories (fan_id, creator_id, category, content, source_message_id)
    values (uid, p_creator_id, cat, body, p_source_message_id)
    on conflict (fan_id, creator_id, lower(btrim(content))) do nothing;
    get diagnostics n = row_count;
    if n = 1 then saved := saved + 1; else duplicate := duplicate + 1; end if;
  end loop;

  return jsonb_build_object('enabled', true, 'saved', saved, 'skippedSensitive', sensitive, 'skippedDuplicate', duplicate, 'skippedLimit', over_limit);
end;
$$;

revoke all on function public.ai_fan_memory_context(text, text, text[], integer) from public, anon;
revoke all on function public.record_fan_memories(text, text, jsonb, uuid) from public, anon;
grant execute on function public.ai_fan_memory_context(text, text, text[], integer) to authenticated;
grant execute on function public.record_fan_memories(text, text, jsonb, uuid) to authenticated;

-- service_role (정리 스크립트 · 계정 삭제): 새 테이블 권한 (앱 경로는 쓰지 않는다)
grant all on public.fan_ai_settings, public.fan_memories to service_role;
