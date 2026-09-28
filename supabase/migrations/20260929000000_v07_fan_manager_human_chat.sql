-- ============================================================================
-- MOMENTY v0.7 · Fan Manager + Human Creator
--
-- 원칙
--   · AI 대화(ai_conversations · ai_messages)와 Fan Memory(fan_memories)의 권한은 그대로다.
--     크리에이터는 여전히 읽을 수 없고, 이 migration의 어떤 함수도 그 테이블을 읽지 않는다
--     (예외: persona_chat_denial이 차단 여부를 보기 위해 user_blocks를 읽는다).
--   · Human Chat(팬 ↔ 실제 크리에이터)은 별도 테이블. 두 참여자만 읽는다.
--     쓰기는 send_message_to_creator / send_message_to_fan 뿐 — 보내는 사람 · 대화방은 JWT(auth.uid())에서 정한다.
--     인자에 sender · conversation_id가 없다 → 위조할 값 자체가 없다. trigger가 한 번 더 확인한다.
--   · Human Chat에는 AI_SERVER_KEY가 필요 없다 (사람이 직접 보내는 메시지). 서버의 AI 경로(팬 JWT)는
--     크리에이터 이름으로 메시지를 보낼 수 없다 → AI가 크리에이터인 척하는 Human 메시지는 만들 수 없다.
--   · Fan Manager는 점수 · 순위가 아니다. 설명 가능한 서비스 이벤트(구독 · 반응 수 · 직접 대화 시점 ·
--     팬이 명시적으로 공유한 정보 · 크리에이터 메모)만 fan_manager_* 함수가 명시적으로 투영한다.
--   · 차단은 한 쌍 사이의 모든 대화(Human + Creator AI)를 멈춘다.
--
--  1. human_conversations · human_messages · human_conversation_reads(읽음은 본인만 — 상대에게 읽음 표시 없음)
--  2. user_blocks        차단 (본인이 만든 차단만 보임)
--  3. message_reports    신고 (신고한 사람만 자기 신고를 봄 — 상대방은 볼 수 없음)
--  4. creator_fan_notes  크리에이터 개인 메모 (크리에이터만. 팬 · Persona AI · Fan Memory와 무관)
--  5. fan_creator_shares 팬이 명시적으로 크리에이터에게 공유한 Memory (공유 전 0 visibility · 취소 = 삭제)
--  6. fan_manager_list · fan_manager_fan  크리에이터용 safe projection
--  7. persona_chat_denial 교체 — 차단 관계면 'blocked'
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 2. user_blocks (함수들이 참조하므로 먼저)
-- ---------------------------------------------------------------------------
create table public.user_blocks (
  blocker_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index user_blocks_blocked_idx on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;
-- 본인이 만든 차단만 보고 · 만들고 · 푼다 (차단당한 쪽은 볼 수 없다)
create policy "user_blocks: 본인 차단 조회" on public.user_blocks
  for select to authenticated using (blocker_id = (select auth.uid()));
create policy "user_blocks: 본인 차단 생성" on public.user_blocks
  for insert to authenticated with check (blocker_id = (select auth.uid()) and blocked_id <> (select auth.uid()));
create policy "user_blocks: 본인 차단 해제" on public.user_blocks
  for delete to authenticated using (blocker_id = (select auth.uid()));
grant select, delete on public.user_blocks to authenticated;
grant insert (blocker_id, blocked_id) on public.user_blocks to authenticated;

-- 두 사람 사이에 (어느 쪽이든) 차단이 있는지
create function private.blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b) or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;

-- ---------------------------------------------------------------------------
-- 1. Human Chat
-- ---------------------------------------------------------------------------
create table public.human_conversations (
  id uuid primary key default gen_random_uuid(),
  fan_id uuid not null references public.profiles (id) on delete cascade,
  creator_id text not null references public.creators (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  last_fan_message_at timestamptz,
  last_creator_message_at timestamptz,
  unique (fan_id, creator_id)
);
create index human_conversations_creator_idx on public.human_conversations (creator_id, last_message_at desc);

create table public.human_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.human_conversations (id) on delete cascade,
  -- fan: 팬 · creator: 실제 크리에이터 본인. (AI는 이 테이블에 쓰지 않는다)
  sender_type text not null check (sender_type in ('fan', 'creator')),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (char_length(btrim(content)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index human_messages_conversation_idx on public.human_messages (conversation_id, created_at);

-- 읽음 표시는 본인만 본다 (팬에게 "크리에이터가 읽음"을 보여주지 않는다 — 크리에이터에게 답장 압박을 주지 않기 위해)
create table public.human_conversation_reads (
  conversation_id uuid not null references public.human_conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- 메시지 저장 직전: 보낸 사람이 대화방 참여자와 맞는지 · 시각은 서버 시각 · 대화방 시각 갱신
-- (정상 경로는 send_* 함수뿐이지만, 어떤 경로로 들어와도 형식을 강제한다)
create function private.human_messages_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv public.human_conversations;
  creator_profile uuid;
begin
  select * into conv from public.human_conversations where id = new.conversation_id;
  if not found then
    raise exception 'conversation not found' using errcode = '23503';
  end if;
  select profile_id into creator_profile from public.creators where id = conv.creator_id;
  if (new.sender_type = 'fan' and new.sender_id is distinct from conv.fan_id)
     or (new.sender_type = 'creator' and new.sender_id is distinct from creator_profile) then
    raise exception 'sender mismatch' using errcode = '42501';
  end if;
  new.created_at := clock_timestamp();
  update public.human_conversations
  set last_message_at = new.created_at,
      last_fan_message_at = case when new.sender_type = 'fan' then new.created_at else last_fan_message_at end,
      last_creator_message_at = case when new.sender_type = 'creator' then new.created_at else last_creator_message_at end
  where id = new.conversation_id;
  return new;
end;
$$;

create trigger human_messages_guard before insert on public.human_messages
  for each row execute function private.human_messages_guard();

alter table public.human_conversations enable row level security;
alter table public.human_messages enable row level security;
alter table public.human_conversation_reads enable row level security;

create policy "human_conversations: 참여자만 조회" on public.human_conversations
  for select to authenticated
  using (fan_id = (select auth.uid()) or public.is_creator_owner(creator_id));
create policy "human_messages: 참여자만 조회" on public.human_messages
  for select to authenticated
  using (exists (
    select 1 from public.human_conversations h
    where h.id = conversation_id and (h.fan_id = (select auth.uid()) or public.is_creator_owner(h.creator_id))
  ));
create policy "human_conversation_reads: 본인만 조회" on public.human_conversation_reads
  for select to authenticated using (user_id = (select auth.uid()));

grant select on public.human_conversations, public.human_messages, public.human_conversation_reads to authenticated;
-- insert · update · delete 권한은 주지 않는다 → send_* · mark_* 함수만

-- 호출한 사용자가 이 크리에이터의 주인이고, 그 팬과 관계(구독 행 · Human 대화)가 있는지.
-- 주인일 때만 true가 될 수 있다 → 다른 사람의 구독 관계를 알아내는 데 쓸 수 없다.
create function public.creator_has_fan(p_creator_id text, p_fan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_creator_owner(p_creator_id)
    and (
      exists (select 1 from public.subscriptions s where s.creator_id = p_creator_id and s.fan_id = p_fan_id)
      or exists (select 1 from public.human_conversations h where h.creator_id = p_creator_id and h.fan_id = p_fan_id)
    );
$$;

-- 보내기 공통 검사: 내용 · 횟수 제한 (한 대화에서 보낸 사람당 1분에 10개)
create function private.human_message_body(p_content text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  body text := btrim(coalesce(p_content, ''));
begin
  if char_length(body) = 0 or char_length(body) > 1000 then
    raise exception 'invalid content' using errcode = '22023';
  end if;
  return body;
end;
$$;

create function private.human_rate_limit(p_conversation_id uuid, p_sender uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('momenty:human:' || p_conversation_id || ':' || p_sender, 0));
  if (select count(*) from public.human_messages m
      where m.conversation_id = p_conversation_id and m.sender_id = p_sender and m.created_at > clock_timestamp() - interval '1 minute') >= 10 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
end;
$$;

-- 팬 → 크리에이터 (보내는 사람 = auth.uid(), 대화방 = (auth.uid(), p_creator_id))
create function public.send_message_to_creator(p_creator_id text, p_content text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  body text;
  c record;
  t public.subscription_tier;
  conv uuid;
  msg public.human_messages;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  body := private.human_message_body(p_content);
  select id, profile_id into c from public.creators where id = p_creator_id;
  if not found then raise exception 'creator_not_found' using errcode = 'P0002'; end if;
  if c.profile_id = uid then raise exception 'own_channel' using errcode = '42501'; end if;
  select tier into t from public.subscriptions where fan_id = uid and creator_id = p_creator_id;
  if t is null or t not in ('subscriber', 'premium') then raise exception 'subscription_required' using errcode = '42501'; end if;
  -- 차단: 어느 쪽이 차단했는지는 알려주지 않는다
  if private.blocked_between(uid, c.profile_id) then raise exception 'messaging_unavailable' using errcode = '42501'; end if;

  insert into public.human_conversations (fan_id, creator_id) values (uid, p_creator_id)
  on conflict (fan_id, creator_id) do update set fan_id = excluded.fan_id
  returning id into conv;
  perform private.human_rate_limit(conv, uid);
  insert into public.human_messages (conversation_id, sender_type, sender_id, content)
  values (conv, 'fan', uid, body)
  returning * into msg;
  insert into public.human_conversation_reads (conversation_id, user_id, read_at) values (conv, uid, msg.created_at)
  on conflict (conversation_id, user_id) do update set read_at = excluded.read_at;
  return jsonb_build_object('conversationId', conv, 'messageId', msg.id, 'createdAt', msg.created_at);
end;
$$;

-- 크리에이터 → 팬 (보내는 사람 = auth.uid()의 크리에이터 채널. 지금 subscriber · premium인 팬에게만)
create function public.send_message_to_fan(p_fan_id uuid, p_content text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  body text;
  cid text;
  t public.subscription_tier;
  conv uuid;
  msg public.human_messages;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  body := private.human_message_body(p_content);
  select id into cid from public.creators where profile_id = uid;
  if cid is null then raise exception 'not_a_creator' using errcode = '42501'; end if;
  if p_fan_id is null or p_fan_id = uid then raise exception 'own_channel' using errcode = '42501'; end if;
  select tier into t from public.subscriptions where fan_id = p_fan_id and creator_id = cid;
  if t is null or t not in ('subscriber', 'premium') then raise exception 'fan_not_subscribed' using errcode = '42501'; end if;
  if private.blocked_between(uid, p_fan_id) then raise exception 'messaging_unavailable' using errcode = '42501'; end if;

  insert into public.human_conversations (fan_id, creator_id) values (p_fan_id, cid)
  on conflict (fan_id, creator_id) do update set fan_id = excluded.fan_id
  returning id into conv;
  perform private.human_rate_limit(conv, uid);
  insert into public.human_messages (conversation_id, sender_type, sender_id, content)
  values (conv, 'creator', uid, body)
  returning * into msg;
  insert into public.human_conversation_reads (conversation_id, user_id, read_at) values (conv, uid, msg.created_at)
  on conflict (conversation_id, user_id) do update set read_at = excluded.read_at;
  return jsonb_build_object('conversationId', conv, 'messageId', msg.id, 'createdAt', msg.created_at);
end;
$$;

-- 읽음 — 참여자 본인의 읽음 시각만 (상대는 볼 수 없다)
create function public.mark_human_conversation_read(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.human_conversations h
    where h.id = p_conversation_id and (h.fan_id = uid or public.is_creator_owner(h.creator_id))
  ) then
    return false;
  end if;
  insert into public.human_conversation_reads (conversation_id, user_id, read_at) values (p_conversation_id, uid, now())
  on conflict (conversation_id, user_id) do update set read_at = excluded.read_at;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. message_reports — Human 메시지 신고 (받은 메시지만 · 상대방은 볼 수 없음)
-- ---------------------------------------------------------------------------
create table public.message_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reported_user_id uuid references public.profiles (id) on delete set null,
  message_id uuid references public.human_messages (id) on delete set null,
  -- 신고 시점의 메시지 원문 (운영 검토용 — 신고자 본인 외 일반 사용자는 읽을 수 없다)
  message_snapshot text not null check (char_length(message_snapshot) <= 1000),
  reason text not null check (reason in ('harassment', 'spam', 'sexual', 'hate', 'privacy', 'other')),
  detail text not null default '' check (char_length(detail) <= 500),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (reporter_id, message_id)
);
create index message_reports_status_idx on public.message_reports (status, created_at);

alter table public.message_reports enable row level security;
create policy "message_reports: 신고자 본인만 조회" on public.message_reports
  for select to authenticated using (reporter_id = (select auth.uid()));
grant select (id, message_id, reason, detail, status, created_at) on public.message_reports to authenticated;
-- 쓰기는 report_human_message()만

create function public.report_human_message(p_message_id uuid, p_reason text, p_detail text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  m record;
  rid uuid;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  if p_reason is null or p_reason not in ('harassment', 'spam', 'sexual', 'hate', 'privacy', 'other') then
    raise exception 'invalid reason' using errcode = '22023';
  end if;
  if char_length(coalesce(p_detail, '')) > 500 then raise exception 'invalid detail' using errcode = '22023'; end if;
  select hm.id, hm.sender_id, hm.content into m
  from public.human_messages hm
  join public.human_conversations h on h.id = hm.conversation_id
  where hm.id = p_message_id and (h.fan_id = uid or public.is_creator_owner(h.creator_id));
  if not found then raise exception 'message_not_found' using errcode = 'P0002'; end if;
  if m.sender_id = uid then raise exception 'cannot_report_own_message' using errcode = '22023'; end if;
  insert into public.message_reports (reporter_id, reported_user_id, message_id, message_snapshot, reason, detail)
  values (uid, m.sender_id, m.id, m.content, p_reason, coalesce(p_detail, ''))
  on conflict (reporter_id, message_id) do update set reason = excluded.reason, detail = excluded.detail
  returning id into rid;
  return jsonb_build_object('reportId', rid);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. creator_fan_notes — 크리에이터 개인 메모 (팬당 1개)
--    크리에이터 본인만. 팬 · 다른 크리에이터는 읽을 수 없다. Persona AI · Fan Memory는 이 테이블을 읽지 않는다.
-- ---------------------------------------------------------------------------
create table public.creator_fan_notes (
  creator_id text not null references public.creators (id) on delete cascade,
  fan_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (char_length(content) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (creator_id, fan_id)
);
create trigger creator_fan_notes_updated_at before update on public.creator_fan_notes
  for each row execute function public.set_updated_at();

alter table public.creator_fan_notes enable row level security;
create policy "creator_fan_notes: 크리에이터 본인만 조회" on public.creator_fan_notes
  for select to authenticated using (public.is_creator_owner(creator_id));
create policy "creator_fan_notes: 내 팬에게만 작성" on public.creator_fan_notes
  for insert to authenticated with check (public.creator_has_fan(creator_id, fan_id));
create policy "creator_fan_notes: 크리에이터 본인만 수정" on public.creator_fan_notes
  for update to authenticated using (public.is_creator_owner(creator_id)) with check (public.is_creator_owner(creator_id));
create policy "creator_fan_notes: 크리에이터 본인만 삭제" on public.creator_fan_notes
  for delete to authenticated using (public.is_creator_owner(creator_id));
grant select, delete on public.creator_fan_notes to authenticated;
grant insert (creator_id, fan_id, content) on public.creator_fan_notes to authenticated;
grant update (content) on public.creator_fan_notes to authenticated;

-- ---------------------------------------------------------------------------
-- 5. fan_creator_shares — 팬이 명시적으로 크리에이터에게 공유한 정보
--    fan_memories의 크리에이터 권한은 열지 않는다. 팬이 [공유]를 누르면 그 항목의 사본이 여기에 생기고,
--    크리에이터는 이 테이블만 본다. 공유 취소 = 행 삭제 (즉시 0 visibility). 원본 Memory를 지우면 공유도 같이 사라진다.
-- ---------------------------------------------------------------------------
create table public.fan_creator_shares (
  id uuid primary key default gen_random_uuid(),
  fan_id uuid not null references public.profiles (id) on delete cascade,
  creator_id text not null references public.creators (id) on delete cascade,
  source_memory_id uuid not null unique references public.fan_memories (id) on delete cascade,
  category text not null check (category in ('nickname', 'interest', 'favorite', 'schedule', 'other')),
  content text not null check (char_length(btrim(content)) between 1 and 200),
  -- 팬이 공유할 때 직접 지정한 날짜 (생일 · 기념일 등). IMPORTANT_DATE 신호는 이 값만 쓴다
  event_date date check (event_date is null or event_date between date '1900-01-01' and date '2100-12-31'),
  shared_at timestamptz not null default now()
);
create index fan_creator_shares_creator_idx on public.fan_creator_shares (creator_id, fan_id);

alter table public.fan_creator_shares enable row level security;
create policy "fan_creator_shares: 팬 본인 · 공유받은 크리에이터만 조회" on public.fan_creator_shares
  for select to authenticated using (fan_id = (select auth.uid()) or public.is_creator_owner(creator_id));
create policy "fan_creator_shares: 팬 본인만 취소" on public.fan_creator_shares
  for delete to authenticated using (fan_id = (select auth.uid()));
grant select, delete on public.fan_creator_shares to authenticated;
-- 만들기는 share_memory_with_creator()만 (항목 · 크리에이터가 원본 Memory와 반드시 같게)

create function public.share_memory_with_creator(p_memory_id uuid, p_event_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  m public.fan_memories;
  sid uuid;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  select * into m from public.fan_memories where id = p_memory_id and fan_id = uid;
  if not found then raise exception 'memory_not_found' using errcode = 'P0002'; end if;
  if p_event_date is not null and p_event_date not between date '1900-01-01' and date '2100-12-31' then
    raise exception 'invalid date' using errcode = '22023';
  end if;
  insert into public.fan_creator_shares (fan_id, creator_id, source_memory_id, category, content, event_date)
  values (uid, m.creator_id, m.id, m.category, m.content, p_event_date)
  on conflict (source_memory_id) do update set event_date = excluded.event_date
  returning id into sid;
  return jsonb_build_object('shareId', sid, 'creatorId', m.creator_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Fan Manager — 크리에이터용 safe projection
--    읽는 것: subscriptions · profiles(공개 닉네임 · 아바타) · moment_reactions(이 크리에이터 Moment의 "개수"만) ·
--             human_conversations(시각만) · fan_creator_shares · creator_fan_notes(존재 여부 · 상세에서만 내용) · user_blocks(내 차단)
--    읽지 않는 것: ai_conversations · ai_messages · fan_memories · fan_ai_settings (절대)
--    점수 · 순위 없음. signals는 규칙 이름 그대로이고, 화면은 그 이유를 문장으로 보여준다.
-- ---------------------------------------------------------------------------
create function private.fan_manager_rows(p_creator_id text, p_viewer uuid, p_fan_ids uuid[])
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  today as (select (now() at time zone 'Asia/Seoul')::date as d),
  fans as (
    select s.fan_id, s.tier, s.started_at
    from public.subscriptions s
    where s.creator_id = p_creator_id and s.fan_id = any (p_fan_ids)
  ),
  recent5 as (
    select m.id from public.moments m where m.creator_id = p_creator_id order by m.created_at desc limit 5
  ),
  r5 as (
    select r.user_id, count(distinct r.moment_id)::int as n
    from public.moment_reactions r
    where r.moment_id in (select id from recent5) and r.user_id = any (p_fan_ids)
    group by r.user_id
  ),
  r30 as (
    select r.user_id, count(*)::int as n, max(r.created_at) as last_at
    from public.moment_reactions r
    join public.moments m on m.id = r.moment_id
    where m.creator_id = p_creator_id and r.created_at > now() - interval '30 days' and r.user_id = any (p_fan_ids)
    group by r.user_id
  ),
  conv as (
    select h.fan_id, h.id, h.last_fan_message_at, h.last_creator_message_at
    from public.human_conversations h
    where h.creator_id = p_creator_id and h.fan_id = any (p_fan_ids)
  ),
  shares as (
    select sh.fan_id, count(*)::int as n,
      (array_agg(jsonb_build_object('content', sh.content, 'date', sh.next_date, 'daysUntil', sh.next_date - (select d from today))
                 order by sh.next_date) filter (where sh.next_date is not null and sh.next_date - (select d from today) between 0 and 7))[1] as upcoming
    from (
      select x.fan_id, x.content,
        case when x.event_date is null then null else (
          select case when y.nd < (select d from today) then (y.nd + interval '1 year')::date else y.nd end
          from (select (x.event_date + make_interval(years => (extract(year from (select d from today)) - extract(year from x.event_date))::int))::date as nd) y
        ) end as next_date
      from public.fan_creator_shares x
      where x.creator_id = p_creator_id and x.fan_id = any (p_fan_ids)
    ) sh
    group by sh.fan_id
  ),
  notes as (
    select n.fan_id from public.creator_fan_notes n where n.creator_id = p_creator_id and n.fan_id = any (p_fan_ids)
  ),
  blocked as (
    select b.blocked_id from public.user_blocks b where b.blocker_id = p_viewer and b.blocked_id = any (p_fan_ids)
  ),
  ids as (
    select unnest(p_fan_ids) as fan_id
  ),
  base as (
    select i.fan_id, f.tier, f.started_at, p.nickname, p.avatar_url,
      coalesce(r5.n, 0) as recent_reacted, (select count(*)::int from recent5) as recent_total,
      coalesce(r30.n, 0) as reactions30, r30.last_at as last_reaction_at,
      conv.id as conversation_id, conv.last_fan_message_at, conv.last_creator_message_at,
      coalesce(shares.n, 0) as shared_count, shares.upcoming,
      exists (select 1 from notes where notes.fan_id = i.fan_id) as has_note,
      exists (select 1 from blocked where blocked.blocked_id = i.fan_id) as is_blocked
    from ids i
    join public.profiles p on p.id = i.fan_id
    left join fans f on f.fan_id = i.fan_id
    left join r5 on r5.user_id = i.fan_id
    left join r30 on r30.user_id = i.fan_id
    left join conv on conv.fan_id = i.fan_id
    left join shares on shares.fan_id = i.fan_id
  )
  select jsonb_build_object(
    'fanId', b.fan_id,
    'nickname', coalesce(nullif(b.nickname, ''), 'MOMENTY 팬'),
    'avatarUrl', b.avatar_url,
    'tier', b.tier,
    'subscribedAt', b.started_at,
    'subscribedDays', case when b.started_at is null then null else ((select d from today) - (b.started_at at time zone 'Asia/Seoul')::date) end,
    'recentMoments', b.recent_total,
    'recentReacted', b.recent_reacted,
    'reactions30d', b.reactions30,
    'lastReactionAt', b.last_reaction_at,
    'conversationId', b.conversation_id,
    'lastFanMessageAt', b.last_fan_message_at,
    'lastCreatorMessageAt', b.last_creator_message_at,
    'sharedCount', b.shared_count,
    'importantDate', b.upcoming,
    'hasNote', b.has_note,
    'blocked', b.is_blocked,
    -- 규칙 순서 = 화면에서 먼저 보여줄 이유 순서 (팬의 가치가 아니라 "할 일"의 종류)
    'signals', to_jsonb(array_remove(array[
      case when b.last_fan_message_at is not null and (b.last_creator_message_at is null or b.last_fan_message_at > b.last_creator_message_at) then 'UNREPLIED_FAN_MESSAGE' end,
      case when b.upcoming is not null then 'IMPORTANT_DATE' end,
      case when b.started_at > now() - interval '7 days' and b.tier in ('subscriber', 'premium') then 'NEW_SUBSCRIBER' end,
      case when b.recent_total >= 3 and b.recent_reacted >= 3 then 'RECENT_REACTIONS' end,
      case when b.last_creator_message_at is not null and b.last_creator_message_at < now() - interval '14 days' then 'LONG_TIME_SINCE_HUMAN' end,
      case when b.last_creator_message_at is null and b.tier in ('subscriber', 'premium') then 'NO_HUMAN_REPLY' end
    ]::text[], null))
  )
  from base b;
$$;

-- 목록: view = 'attention'(오늘 확인할 팬, 최대 p_limit) | 'all'(구독 시작 최신순, 커서)
create function public.fan_manager_list(p_view text default 'attention', p_limit integer default 20, p_cursor_started_at timestamptz default null, p_cursor_fan_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  cid text;
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  ids uuid[];
  items jsonb;
  last_row record;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  select id into cid from public.creators where profile_id = uid;
  if cid is null then raise exception 'not_a_creator' using errcode = '42501'; end if;
  if p_view is null or p_view not in ('attention', 'all') then raise exception 'invalid view' using errcode = '22023'; end if;
  if (p_cursor_started_at is null) <> (p_cursor_fan_id is null) then raise exception 'invalid cursor' using errcode = '22023'; end if;

  if p_view = 'all' then
    select coalesce(array_agg(s.fan_id order by s.started_at desc, s.fan_id desc), '{}') into ids
    from (
      select s.fan_id, s.started_at from public.subscriptions s
      where s.creator_id = cid and s.tier in ('subscriber', 'premium')
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
  end if;

  -- attention: 지금 구독 중인 팬 전체에서 규칙에 걸린 팬만 (차단한 팬 제외). DB 안에서 계산하고 p_limit개만 돌려준다
  select coalesce(array_agg(s.fan_id), '{}') into ids
  from public.subscriptions s where s.creator_id = cid and s.tier in ('subscriber', 'premium');
  select coalesce(jsonb_agg(x.r order by x.prio, x.at desc nulls last, x.r ->> 'fanId'), '[]') into items
  from (
    select r,
      array_position(array['UNREPLIED_FAN_MESSAGE', 'IMPORTANT_DATE', 'NEW_SUBSCRIBER', 'RECENT_REACTIONS', 'LONG_TIME_SINCE_HUMAN', 'NO_HUMAN_REPLY'], r -> 'signals' ->> 0) as prio,
      coalesce((r ->> 'lastFanMessageAt')::timestamptz, (r ->> 'lastReactionAt')::timestamptz, (r ->> 'subscribedAt')::timestamptz) as at
    from private.fan_manager_rows(cid, uid, ids) r
    where jsonb_array_length(r -> 'signals') > 0 and not (r ->> 'blocked')::boolean
    order by 2, 3 desc nulls last, r ->> 'fanId'
    limit lim
  ) x;
  return jsonb_build_object('items', items, 'nextCursor', null);
end;
$$;

-- 상세: 이 크리에이터와 관계(구독 행 · Human 대화)가 있는 팬만. 공유 정보 · 내 메모 포함 (AI 대화 · Fan Memory 없음)
create function public.fan_manager_fan(p_fan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  cid text;
  v_row jsonb;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  select id into cid from public.creators where profile_id = uid;
  if cid is null then raise exception 'not_a_creator' using errcode = '42501'; end if;
  if p_fan_id is null or not public.creator_has_fan(cid, p_fan_id) then raise exception 'fan_not_found' using errcode = 'P0002'; end if;
  select r into v_row from private.fan_manager_rows(cid, uid, array[p_fan_id]) r;
  return v_row || jsonb_build_object(
    'shares', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'category', s.category, 'content', s.content, 'eventDate', s.event_date, 'sharedAt', s.shared_at) order by s.shared_at desc)
      from public.fan_creator_shares s where s.creator_id = cid and s.fan_id = p_fan_id
    ), '[]'::jsonb),
    'note', (select jsonb_build_object('content', n.content, 'updatedAt', n.updated_at) from public.creator_fan_notes n where n.creator_id = cid and n.fan_id = p_fan_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Creator AI도 차단 관계에서는 멈춘다 (v0.5 함수 교체 — 시그니처 · 나머지 규칙 동일, 'blocked' 추가)
--    ai_persona_context · record_ai_exchange · ai_fan_memory_context · record_fan_memories가 모두 이 함수를 쓴다
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
  if not exists (select 1 from public.creator_personas p where p.creator_id = p_creator_id) then return 'persona_not_configured'; end if;
  select tier into t from public.subscriptions where fan_id = p_uid and creator_id = p_creator_id;
  if t is null or t not in ('subscriber', 'premium') then return 'subscription_required'; end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 인덱스 · 권한
-- ---------------------------------------------------------------------------
-- 'all' 목록 커서 (크리에이터별 구독 시작 최신순)
create index subscriptions_creator_started_idx on public.subscriptions (creator_id, started_at desc, fan_id desc);

revoke all on function private.blocked_between(uuid, uuid) from public, anon, authenticated;
revoke all on function private.human_messages_guard() from public, anon, authenticated;
revoke all on function private.human_message_body(text) from public, anon, authenticated;
revoke all on function private.human_rate_limit(uuid, uuid) from public, anon, authenticated;
revoke all on function private.fan_manager_rows(text, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.creator_has_fan(text, uuid) from public, anon;
revoke all on function public.send_message_to_creator(text, text) from public, anon;
revoke all on function public.send_message_to_fan(uuid, text) from public, anon;
revoke all on function public.mark_human_conversation_read(uuid) from public, anon;
revoke all on function public.report_human_message(uuid, text, text) from public, anon;
revoke all on function public.share_memory_with_creator(uuid, date) from public, anon;
revoke all on function public.fan_manager_list(text, integer, timestamptz, uuid) from public, anon;
revoke all on function public.fan_manager_fan(uuid) from public, anon;
grant execute on function public.creator_has_fan(text, uuid) to authenticated;
grant execute on function public.send_message_to_creator(text, text) to authenticated;
grant execute on function public.send_message_to_fan(uuid, text) to authenticated;
grant execute on function public.mark_human_conversation_read(uuid) to authenticated;
grant execute on function public.report_human_message(uuid, text, text) to authenticated;
grant execute on function public.share_memory_with_creator(uuid, date) to authenticated;
grant execute on function public.fan_manager_list(text, integer, timestamptz, uuid) to authenticated;
grant execute on function public.fan_manager_fan(uuid) to authenticated;

-- service_role (정리 스크립트 · 계정 삭제): 새 테이블 권한 (앱 경로는 쓰지 않는다)
grant all on public.human_conversations, public.human_messages, public.human_conversation_reads,
  public.user_blocks, public.message_reports, public.creator_fan_notes, public.fan_creator_shares to service_role;

-- Realtime (Supabase에만 있는 publication): 새 Human 메시지를 참여자에게 — Realtime은 위 SELECT 정책(RLS)을 그대로 적용한다
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.human_messages;
  end if;
end;
$$;
