-- ============================================================================
-- MOMENTY v0.8 · SafeShare + Safety / Privacy — "Share your day, not your location."
--
--  1. Safe Delay        moments.visible_at (서버가 정한다 — 클라이언트는 쓸 수 없다) + creator_safety_settings.
--                       visible_at 이전의 Moment는 크리에이터 본인 외 누구에게도 행 · 존재 · 본문 · 미디어가 보이지 않는다.
--                       적용 지점: moments RLS · moment_feed · Storage 읽기 · 반응 · 보관함 · AI 근거 저장 · Fan Manager 집계.
--                       (Persona AI Context는 팬 세션 + moments RLS로 읽으므로 자동으로 제외된다)
--  2. Moderation        private.admin_users(SQL로만 관리) · is_admin() · 신고 상태 open/reviewing/resolved/dismissed ·
--                       admin_list_reports / admin_update_report. 일반 사용자 · 크리에이터에게 권한 없음.
--  3. Mass-DM 방지      private.human_chat_settings(서버 관리자만) — 크리에이터 전체 · 팬 전체 · 먼저 보내는 새 대화 수 한도.
--  4. 계정 삭제         delete_my_account() — Storage에 내 파일이 남아 있으면 거부(먼저 Storage API로 지운다) →
--                       auth.users 삭제 → 모든 개인 데이터 cascade. 내가 한 신고는 신고자 익명화 후 보존.
--
-- SafeShare 검사 결과는 저장하지 않는다 (브라우저에서 검사 → 크리에이터 확인 → 편집본만 업로드 → 결과는 버린다).
-- 기존 migration 파일은 수정하지 않는다. 바뀌는 함수 · 정책 · view는 여기서 다시 만든다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Safe Delay
-- ---------------------------------------------------------------------------
create table public.creator_safety_settings (
  creator_id text primary key references public.creators (id) on delete cascade,
  -- off: 바로 공개 · fixed: 정한 시간 뒤 · variable: 정한 시간의 0.5~1.5배 사이에서 서버가 매번 다르게
  safe_delay_mode text not null default 'off' check (safe_delay_mode in ('off', 'fixed', 'variable')),
  safe_delay_minutes integer not null default 30 check (safe_delay_minutes in (15, 30, 60, 120)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger creator_safety_settings_updated_at before update on public.creator_safety_settings
  for each row execute function public.set_updated_at();

alter table public.creator_safety_settings enable row level security;
-- 크리에이터 본인만 (팬은 지연 설정을 알 수 없다)
create policy "creator_safety_settings: 본인만" on public.creator_safety_settings
  for all to authenticated
  using (public.is_creator_owner(creator_id)) with check (public.is_creator_owner(creator_id));
grant select, delete on public.creator_safety_settings to authenticated;
grant insert (creator_id, safe_delay_mode, safe_delay_minutes) on public.creator_safety_settings to authenticated;
grant update (safe_delay_mode, safe_delay_minutes) on public.creator_safety_settings to authenticated;

-- 공개 시각. 기존 Moment는 기록 시각 그대로 공개된 것으로 본다
alter table public.moments add column visible_at timestamptz;
update public.moments set visible_at = created_at where visible_at is null;
alter table public.moments alter column visible_at set not null;
alter table public.moments alter column visible_at set default now();
create index moments_creator_visible_idx on public.moments (creator_id, visible_at);
-- visible_at · created_at은 insert/update 컬럼 권한에 없다 (v0.4 컬럼 권한 그대로) → 클라이언트가 정할 수 없다

-- 저장 직전: 기록 시각(created_at) + 크리에이터 설정으로 공개 시각을 정한다 (visible_at에 어떤 값이 들어와도 덮어쓴다)
create function private.moments_set_visible_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.creator_safety_settings;
  minutes numeric := 0;
begin
  -- created_at은 클라이언트가 쓸 수 없다(컬럼 권한) → 앱에서는 항상 서버 now(). seed(service role)의 과거 기록은 그 시각 그대로
  select * into s from public.creator_safety_settings where creator_id = new.creator_id;
  if found and s.safe_delay_mode = 'fixed' then
    minutes := s.safe_delay_minutes;
  elsif found and s.safe_delay_mode = 'variable' then
    -- 고정 간격도 패턴이 될 수 있어 매번 다르게 (0.5~1.5배)
    minutes := s.safe_delay_minutes * (0.5 + random());
  end if;
  new.visible_at := new.created_at + make_interval(secs => round(minutes * 60));
  return new;
end;
$$;
create trigger moments_set_visible_at before insert on public.moments
  for each row execute function private.moments_set_visible_at();

-- 공개 여부 (지금 공개됐거나, 보는 사람이 크리에이터 본인). 모든 읽기 경로가 can_view_moment와 함께 쓴다
create function public.moment_is_live(p_creator_id text, p_visible_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_visible_at <= now() or public.is_creator_owner(p_creator_id);
$$;

-- 크리에이터 본인: 공개 예정 Moment를 지금 바로 공개 (늦출 수는 없다 — 늦추기는 새 Moment 저장 때 설정으로만)
create function public.publish_moment_now(p_moment_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v timestamptz;
begin
  update public.moments m set visible_at = now()
  where m.id = p_moment_id and public.is_creator_owner(m.creator_id) and m.visible_at > now()
  returning m.visible_at into v;
  if v is null then raise exception 'moment_not_scheduled' using errcode = 'P0002'; end if;
  return v;
end;
$$;

-- moments 조회: 공개 전 Moment는 본인만
drop policy "moments: 공개범위에 따라 조회" on public.moments;
create policy "moments: 공개범위에 따라 조회" on public.moments
  for select to anon, authenticated
  using (public.can_view_moment(creator_id, visibility) and public.moment_is_live(creator_id, visible_at));

-- 반응 · 보관함: 공개 전 Moment에는 불가
drop policy "reactions: 본인만 생성" on public.moment_reactions;
create policy "reactions: 본인만 생성" on public.moment_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.moments m
      where m.id = moment_id and public.can_view_moment(m.creator_id, m.visibility) and public.moment_is_live(m.creator_id, m.visible_at)
    )
  );
drop policy "bookmarks: 본인만 생성" on public.moment_bookmarks;
create policy "bookmarks: 본인만 생성" on public.moment_bookmarks
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.moments m
      where m.id = moment_id and public.can_view_moment(m.creator_id, m.visibility) and public.moment_is_live(m.creator_id, m.visible_at)
    )
  );

-- Storage: 공개 전 Moment의 파일은 signed URL도 만들 수 없다 (본인 폴더는 그대로 본인만)
drop policy "moment-media: 볼 수 있는 Moment의 미디어만 읽기" on storage.objects;
create policy "moment-media: 볼 수 있는 Moment의 미디어만 읽기" on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'moment-media'
    and (
      public.is_creator_owner((storage.foldername(name))[1])
      or exists (
        select 1 from public.moments m
        where (m.media_url = name or m.poster_url = name)
          and public.can_view_moment(m.creator_id, m.visibility)
          and m.visible_at <= now()
      )
    )
  );

-- moment_feed: 공개 전 Moment는 행 자체가 없다 (잠긴 Moment의 "존재"도 드러나지 않게).
-- visible_at은 크리에이터 본인에게만 (팬에게 지연 시간을 알려주지 않는다). 기존 컬럼 순서 유지 + 끝에 추가
create or replace view public.moment_feed
with (security_invoker = false)
as
select
  m.id,
  m.creator_id,
  m.type,
  m.visibility,
  m.duration_sec,
  m.created_at,
  m.updated_at,
  v.viewable,
  case when v.viewable then m.content end as content,
  case when v.viewable then m.media_url end as media_url,
  case when v.viewable then m.location end as location,
  case when v.viewable then m.safe_share end as safe_share,
  case when v.viewable then m.ai_context_enabled else false end as ai_context_enabled,
  coalesce(rc.love, 0) as love_count,
  coalesce(rc.cheer, 0) as cheer_count,
  coalesce(rc.touched, 0) as touched_count,
  coalesce(rc.smile, 0) as smile_count,
  exists (
    select 1 from public.moment_reactions r
    where r.moment_id = m.id and r.kind = 'love' and r.user_id = (select auth.uid())
  ) as liked_by_me,
  case when v.viewable then m.poster_url end as poster_url,
  case when public.is_creator_owner(m.creator_id) then m.visible_at end as visible_at
from public.moments m
cross join lateral (select public.can_view_moment(m.creator_id, m.visibility) as viewable) v
left join lateral (
  select
    count(*) filter (where r.kind = 'love')::int as love,
    count(*) filter (where r.kind = 'cheer')::int as cheer,
    count(*) filter (where r.kind = 'touched')::int as touched,
    count(*) filter (where r.kind = 'smile')::int as smile
  from public.moment_reactions r
  where r.moment_id = m.id
) rc on true
where public.moment_is_live(m.creator_id, m.visible_at);

revoke all on public.moment_feed from anon, authenticated;
grant select on public.moment_feed to anon, authenticated;

-- AI 근거 저장: 공개 전 Moment는 근거로 남기지 않는다 (v0.5 함수 교체 — 시그니처 · 나머지 규칙 동일)
create or replace function public.record_ai_exchange(
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
    and m.visible_at <= now()
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

-- Fan Manager 집계: "최근 Moment 5개"와 반응 수는 공개된 Moment만 (v0.7 함수 교체 — 나머지 동일)
create or replace function private.fan_manager_rows(p_creator_id text, p_viewer uuid, p_fan_ids uuid[])
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
    select m.id from public.moments m where m.creator_id = p_creator_id and m.visible_at <= now() order by m.visible_at desc limit 5
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
    where m.creator_id = p_creator_id and m.visible_at <= now() and r.created_at > now() - interval '30 days' and r.user_id = any (p_fan_ids)
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

-- ---------------------------------------------------------------------------
-- 2. Moderation — admin은 private.admin_users에 SQL Editor로만 추가한다 (앱 · 클라이언트로 바꿀 수 없다)
-- ---------------------------------------------------------------------------
create table private.admin_users (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 호출한 사람이 admin인지 (자기 자신에 대해서만 — 다른 사람 여부는 알 수 없다)
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.admin_users a where a.user_id = (select auth.uid()));
$$;

create function private.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from private.admin_users a where a.user_id = (select auth.uid())) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
end;
$$;

-- 신고 상태: open → reviewing → resolved / dismissed ('reviewed'는 resolved로)
alter table public.message_reports drop constraint message_reports_status_check;
update public.message_reports set status = 'resolved' where status = 'reviewed';
alter table public.message_reports add constraint message_reports_status_check check (status in ('open', 'reviewing', 'resolved', 'dismissed'));
alter table public.message_reports
  add column reviewed_by uuid references public.profiles (id) on delete set null,
  add column reviewed_at timestamptz,
  add column resolution_note text not null default '' check (char_length(resolution_note) <= 500);
-- 신고자가 계정을 지우면 신고는 익명으로 남긴다 (운영 검토 · 반복 신고 판단용). 신고 대상 연결은 v0.7대로 끊긴다
alter table public.message_reports alter column reporter_id drop not null;
alter table public.message_reports drop constraint message_reports_reporter_id_fkey;
alter table public.message_reports add constraint message_reports_reporter_id_fkey foreign key (reporter_id) references public.profiles (id) on delete set null;
create index message_reports_queue_idx on public.message_reports (status, created_at desc, id desc);

-- 신고 목록 (admin만). 최신순 · 커서
create function public.admin_list_reports(p_status text default 'open', p_limit integer default 30, p_cursor_created_at timestamptz default null, p_cursor_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lim integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  items jsonb;
begin
  perform private.require_admin();
  if p_status is null or p_status not in ('open', 'reviewing', 'resolved', 'dismissed', 'all') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then raise exception 'invalid cursor' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(x.j order by x.created_at desc, x.id desc), '[]') into items
  from (
    select r.created_at, r.id, jsonb_build_object(
      'id', r.id,
      'status', r.status,
      'reason', r.reason,
      'detail', r.detail,
      'messageSnapshot', r.message_snapshot,
      'messageId', r.message_id,
      'createdAt', r.created_at,
      'reporter', case when r.reporter_id is null then null else jsonb_build_object('id', r.reporter_id, 'nickname', rp.nickname) end,
      'reportedUser', case when r.reported_user_id is null then null else jsonb_build_object('id', r.reported_user_id, 'nickname', ru.nickname) end,
      'reviewedAt', r.reviewed_at,
      'resolutionNote', r.resolution_note
    ) as j
    from public.message_reports r
    left join public.profiles rp on rp.id = r.reporter_id
    left join public.profiles ru on ru.id = r.reported_user_id
    where (p_status = 'all' or r.status = p_status)
      and (p_cursor_created_at is null or (r.created_at, r.id) < (p_cursor_created_at, p_cursor_id))
    order by r.created_at desc, r.id desc
    limit lim
  ) x;
  return jsonb_build_object('items', items);
end;
$$;

create function public.admin_update_report(p_report_id uuid, p_status text, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.message_reports;
begin
  perform private.require_admin();
  if p_status is null or p_status not in ('open', 'reviewing', 'resolved', 'dismissed') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if char_length(coalesce(p_note, '')) > 500 then raise exception 'invalid note' using errcode = '22023'; end if;
  update public.message_reports
  set status = p_status, resolution_note = coalesce(p_note, ''), reviewed_by = (select auth.uid()), reviewed_at = now()
  where id = p_report_id
  returning * into v;
  if not found then raise exception 'report_not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', v.id, 'status', v.status, 'reviewedAt', v.reviewed_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Human Chat 한도 — 사람(보낸 사람) 전체 기준. 값은 private 테이블(서버 관리자만)에서만 읽는다
-- ---------------------------------------------------------------------------
create table private.human_chat_settings (
  id boolean primary key default true check (id),
  -- 크리에이터: 10분 · 하루 전체 메시지, 하루에 먼저 연락하는(팬이 한 번도 보내지 않은) 대화 수
  creator_per_10min integer not null default 60 check (creator_per_10min between 1 and 10000),
  creator_per_day integer not null default 400 check (creator_per_day between 1 and 100000),
  creator_cold_per_day integer not null default 30 check (creator_cold_per_day between 1 and 10000),
  -- 팬: 모든 크리에이터에게 보내는 10분 합계
  fan_per_10min integer not null default 40 check (fan_per_10min between 1 and 10000),
  updated_at timestamptz not null default now()
);
insert into private.human_chat_settings (id) values (true);
create index human_messages_sender_idx on public.human_messages (sender_id, created_at);

-- 보낸 사람 전체 한도 검사 (보내는 사람별 advisory lock — 동시에 보내도 한도를 넘지 않게)
create function private.human_sender_limit(p_sender uuid, p_is_creator boolean, p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg private.human_chat_settings;
  conv public.human_conversations;
begin
  select * into cfg from private.human_chat_settings where id;
  perform pg_advisory_xact_lock(hashtextextended('momenty:human-sender:' || p_sender, 0));
  if p_is_creator then
    if (select count(*) from public.human_messages m where m.sender_id = p_sender and m.created_at > clock_timestamp() - interval '10 minutes') >= cfg.creator_per_10min
       or (select count(*) from public.human_messages m where m.sender_id = p_sender and m.created_at > clock_timestamp() - interval '1 day') >= cfg.creator_per_day then
      raise exception 'rate_limited' using errcode = '54000';
    end if;
    -- 팬이 한 번도 보내지 않은 대화에 새로 먼저 보내는 경우만 "먼저 연락" 수로 센다
    select * into conv from public.human_conversations where id = p_conversation_id;
    if conv.last_fan_message_at is null
       and (conv.last_creator_message_at is null or conv.last_creator_message_at < clock_timestamp() - interval '1 day')
       and (select count(*) from public.human_conversations h
            where h.creator_id = conv.creator_id and h.last_fan_message_at is null
              and h.last_creator_message_at > clock_timestamp() - interval '1 day') >= cfg.creator_cold_per_day then
      raise exception 'rate_limited' using errcode = '54000';
    end if;
  else
    if (select count(*) from public.human_messages m where m.sender_id = p_sender and m.created_at > clock_timestamp() - interval '10 minutes') >= cfg.fan_per_10min then
      raise exception 'rate_limited' using errcode = '54000';
    end if;
  end if;
end;
$$;

-- 보내기 함수 교체 (v0.7과 같은 규칙 + 보낸 사람 전체 한도)
create or replace function public.send_message_to_creator(p_creator_id text, p_content text)
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
  if private.blocked_between(uid, c.profile_id) then raise exception 'messaging_unavailable' using errcode = '42501'; end if;

  insert into public.human_conversations (fan_id, creator_id) values (uid, p_creator_id)
  on conflict (fan_id, creator_id) do update set fan_id = excluded.fan_id
  returning id into conv;
  perform private.human_rate_limit(conv, uid);
  perform private.human_sender_limit(uid, false, conv);
  insert into public.human_messages (conversation_id, sender_type, sender_id, content)
  values (conv, 'fan', uid, body)
  returning * into msg;
  insert into public.human_conversation_reads (conversation_id, user_id, read_at) values (conv, uid, msg.created_at)
  on conflict (conversation_id, user_id) do update set read_at = excluded.read_at;
  return jsonb_build_object('conversationId', conv, 'messageId', msg.id, 'createdAt', msg.created_at);
end;
$$;

create or replace function public.send_message_to_fan(p_fan_id uuid, p_content text)
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
  perform private.human_sender_limit(uid, true, conv);
  insert into public.human_messages (conversation_id, sender_type, sender_id, content)
  values (conv, 'creator', uid, body)
  returning * into msg;
  insert into public.human_conversation_reads (conversation_id, user_id, read_at) values (conv, uid, msg.created_at)
  on conflict (conversation_id, user_id) do update set read_at = excluded.read_at;
  return jsonb_build_object('conversationId', conv, 'messageId', msg.id, 'createdAt', msg.created_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. 계정 삭제 — 본인만. Storage 파일은 SQL로 지우지 않는다(실제 파일이 남는다) → 먼저 Storage API로 지웠는지 확인만
-- ---------------------------------------------------------------------------
create function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  cid text;
  remaining integer;
begin
  if uid is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  select id into cid from public.creators where profile_id = uid;
  select count(*) into remaining
  from storage.objects o
  where (o.bucket_id = 'avatars' and (storage.foldername(o.name))[1] = uid::text)
     or (cid is not null and o.bucket_id = 'moment-media' and (storage.foldername(o.name))[1] = cid);
  if remaining > 0 then
    raise exception 'storage_not_empty' using errcode = '55000', detail = remaining::text;
  end if;
  -- private 저장소의 내 흔적 (rate limit 카운터 키에 사용자 id가 들어 있다)
  delete from private.ai_rate_limits where bucket like 'ai_chat:' || uid::text || '%';
  -- auth.users → profiles → creators · moments · 반응 · 보관함 · 구독 · Persona · AI 대화 · Fan Memory ·
  --   Human 대화 · 메모 · 공유 · 차단이 모두 cascade. 내가 한 신고는 신고자 null(익명)로 남는다
  delete from auth.users where id = uid;
  return jsonb_build_object('deleted', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 권한
-- ---------------------------------------------------------------------------
revoke all on function private.moments_set_visible_at() from public, anon, authenticated;
revoke all on function private.require_admin() from public, anon, authenticated;
revoke all on function private.human_sender_limit(uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.moment_is_live(text, timestamptz) from public;
revoke all on function public.publish_moment_now(uuid) from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.admin_list_reports(text, integer, timestamptz, uuid) from public, anon;
revoke all on function public.admin_update_report(uuid, text, text) from public, anon;
revoke all on function public.delete_my_account() from public, anon;
-- moment_is_live는 RLS · Storage 정책이 anon으로도 평가하므로 anon에도 실행 권한 (자기 판단만 — 정보 없음)
grant execute on function public.moment_is_live(text, timestamptz) to anon, authenticated;
grant execute on function public.publish_moment_now(uuid) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_list_reports(text, integer, timestamptz, uuid) to authenticated;
grant execute on function public.admin_update_report(uuid, text, text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;

grant all on public.creator_safety_settings to service_role;
