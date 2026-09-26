-- ============================================================================
-- MOMENTY · 초기 스키마
--   profiles ─┬─< creators ─< moments ─< moment_reactions >─ profiles
--             └─< subscriptions >─ creators
--
-- 원칙
--   · Today / Daily는 테이블로 만들지 않는다. moments.created_at(KST 날짜)로 묶어서 계산한다.
--   · 공개범위는 DB에서 보호한다 (RLS + 마스킹 view). 프론트엔드 판단은 표시용일 뿐이다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------
create type public.moment_type as enum ('text', 'photo', 'video', 'voice');
create type public.moment_visibility as enum ('public', 'subscriber', 'premium');
create type public.subscription_tier as enum ('follow', 'subscriber', 'premium');
create type public.reaction_kind as enum ('love', 'cheer', 'touched', 'smile');
create type public.creator_category as enum ('photo', 'music', 'dance', 'food', 'art', 'sports', 'books', 'coffee');

-- ---------------------------------------------------------------------------
-- 공통: updated_at 자동 갱신
-- ---------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — 로그인한 모든 사용자 (팬이자, 크리에이터가 될 수 있는 사람)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null default '',
  handle text unique check (handle ~ '^[a-z0-9._]{2,30}$'),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- 가입하면 profile을 만든다
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nickname)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nickname', ''));
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- creators — profile 하나가 크리에이터 하나가 될 수 있다 (1:0..1)
--   id는 URL에 쓰이는 짧은 문자열 (/creators/c1)
-- ---------------------------------------------------------------------------
create table public.creators (
  id text primary key default replace(gen_random_uuid()::text, '-', '') check (id ~ '^[a-z0-9_-]{1,40}$'),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  handle text not null unique check (handle ~ '^[a-z0-9._]{2,30}$'),
  job text not null default '',
  category public.creator_category not null,
  bio text not null default '',
  avatar_url text,
  cover_url text,
  price_subscriber integer not null default 0 check (price_subscriber >= 0),
  price_premium integer not null default 0 check (price_premium >= 0),
  verified boolean not null default false,
  tags text[] not null default '{}',
  persona_enabled boolean not null default true,
  -- 화면 표시용 집계 캐시 (정확한 값은 subscriptions에서 계산)
  follower_count integer not null default 0 check (follower_count >= 0),
  subscriber_count integer not null default 0 check (subscriber_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger creators_updated_at before update on public.creators
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- subscriptions — 팬 1명이 여러 크리에이터를 구독 (크리에이터당 1행)
--   결제 연동 전까지는 service role(seed / 서버)만 쓴다
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  fan_id uuid not null references public.profiles (id) on delete cascade,
  creator_id text not null references public.creators (id) on delete cascade,
  tier public.subscription_tier not null,
  started_at timestamptz not null default now(),
  renews_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fan_id, creator_id)
);

create index subscriptions_creator_idx on public.subscriptions (creator_id);

create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- moments — 크리에이터가 원하는 순간 남긴 기록
--   media_url: Storage 경로("{creator_id}/{file}") 또는 외부 URL(seed)
-- ---------------------------------------------------------------------------
create table public.moments (
  id uuid primary key default gen_random_uuid(),
  creator_id text not null references public.creators (id) on delete cascade,
  type public.moment_type not null,
  content text not null default '' check (char_length(content) <= 2000),
  media_url text,
  duration_sec integer check (duration_sec is null or duration_sec between 0 and 3600),
  visibility public.moment_visibility not null default 'subscriber',
  ai_context_enabled boolean not null default true,
  location text,
  safe_share text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 사진·영상에는 미디어가, 글에는 본문이 있어야 한다
  constraint moments_media_required check (type not in ('photo', 'video') or media_url is not null),
  constraint moments_text_required check (type <> 'text' or char_length(btrim(content)) > 0)
);

-- Today / Archive: 크리에이터별 시간순 조회, 전체 최신순 조회
create index moments_creator_created_idx on public.moments (creator_id, created_at);
create index moments_created_idx on public.moments (created_at desc);

create trigger moments_updated_at before update on public.moments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- moment_reactions — 한 사람이 같은 Moment에 같은 반응은 한 번만
-- ---------------------------------------------------------------------------
create table public.moment_reactions (
  moment_id uuid not null references public.moments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.reaction_kind not null,
  created_at timestamptz not null default now(),
  primary key (moment_id, user_id, kind)
);

create index moment_reactions_user_idx on public.moment_reactions (user_id);

-- ============================================================================
-- 권한 판단 함수 — RLS · view · Storage 정책이 모두 이 함수만 쓴다
--   security definer: 정책 안에서 다른 테이블의 RLS에 막히지 않도록 (재귀 방지)
-- ============================================================================
create function public.is_creator_owner(p_creator_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.creators c
    where c.id = p_creator_id and c.profile_id = (select auth.uid())
  );
$$;

create function public.can_view_moment(p_creator_id text, p_visibility public.moment_visibility)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_visibility = 'public' then true
    when (select auth.uid()) is null then false
    when public.is_creator_owner(p_creator_id) then true
    else exists (
      select 1 from public.subscriptions s
      where s.fan_id = (select auth.uid())
        and s.creator_id = p_creator_id
        and (
          (p_visibility = 'subscriber' and s.tier in ('subscriber', 'premium'))
          or (p_visibility = 'premium' and s.tier = 'premium')
        )
    )
  end;
$$;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.profiles enable row level security;
alter table public.creators enable row level security;
alter table public.subscriptions enable row level security;
alter table public.moments enable row level security;
alter table public.moment_reactions enable row level security;

-- profiles: 닉네임·아바타는 공개, 수정은 본인만
create policy "profiles: 누구나 조회" on public.profiles
  for select to anon, authenticated using (true);
create policy "profiles: 본인만 수정" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- creators: 공개 프로필. 로그인한 사용자는 자기 profile로 크리에이터가 될 수 있다
create policy "creators: 누구나 조회" on public.creators
  for select to anon, authenticated using (true);
create policy "creators: 본인 profile로 생성" on public.creators
  for insert to authenticated with check (profile_id = (select auth.uid()));
create policy "creators: 본인만 수정" on public.creators
  for update to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

-- subscriptions: 팬 본인 / 해당 크리에이터만 조회. 쓰기는 결제 서버(service role)만
create policy "subscriptions: 본인 또는 크리에이터 조회" on public.subscriptions
  for select to authenticated
  using (fan_id = (select auth.uid()) or public.is_creator_owner(creator_id));

-- moments: 볼 수 있는 Moment만 조회, 쓰기는 크리에이터 본인만
create policy "moments: 공개범위에 따라 조회" on public.moments
  for select to anon, authenticated
  using (public.can_view_moment(creator_id, visibility));
create policy "moments: 크리에이터 본인만 생성" on public.moments
  for insert to authenticated
  with check (public.is_creator_owner(creator_id));
create policy "moments: 크리에이터 본인만 수정" on public.moments
  for update to authenticated
  using (public.is_creator_owner(creator_id))
  with check (public.is_creator_owner(creator_id));
create policy "moments: 크리에이터 본인만 삭제" on public.moments
  for delete to authenticated
  using (public.is_creator_owner(creator_id));

-- moment_reactions: 본인 반응만 조회·생성·삭제. 볼 수 없는 Moment에는 반응할 수 없다
create policy "reactions: 본인 것만 조회" on public.moment_reactions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "reactions: 본인만 생성" on public.moment_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.moments m
      where m.id = moment_id and public.can_view_moment(m.creator_id, m.visibility)
    )
  );
create policy "reactions: 본인만 삭제" on public.moment_reactions
  for delete to authenticated using (user_id = (select auth.uid()));

-- ============================================================================
-- moment_feed — Today / Timeline / Detail이 읽는 view
--   잠긴 Moment도 "몇 시에 어떤 유형이 있었는지"는 보여야 한다 (Locked State, 개수 dot).
--   그래서 행은 모두 돌려주되, 볼 수 없는 Moment의 본문·미디어·위치는 DB에서 null로 가린다.
--   view 소유자 권한으로 moments를 읽고(security_invoker = false),
--   권한 판단은 호출한 사용자(auth.uid()) 기준으로 can_view_moment가 한다.
-- ============================================================================
create view public.moment_feed
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
  ) as liked_by_me
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
) rc on true;

-- 권한: 클라이언트는 view로 읽고, 테이블에는 RLS가 허락하는 만큼만 쓴다
revoke all on public.moment_feed from anon, authenticated;
grant select on public.moment_feed to anon, authenticated;
revoke insert, update, delete on public.subscriptions from anon, authenticated;

-- ============================================================================
-- Storage — 사진 원본 (비공개 bucket, signed URL로만 읽는다)
--   경로: {creator_id}/{파일명}
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('moment-media', 'moment-media', false)
on conflict (id) do nothing;

create policy "moment-media: 볼 수 있는 Moment의 미디어만 읽기" on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'moment-media'
    and (
      public.is_creator_owner((storage.foldername(name))[1])
      or exists (
        select 1 from public.moments m
        where m.media_url = name and public.can_view_moment(m.creator_id, m.visibility)
      )
    )
  );
create policy "moment-media: 크리에이터 본인 폴더에만 업로드" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'moment-media' and public.is_creator_owner((storage.foldername(name))[1]));
create policy "moment-media: 크리에이터 본인 폴더에서만 삭제" on storage.objects
  for delete to authenticated
  using (bucket_id = 'moment-media' and public.is_creator_owner((storage.foldername(name))[1]));
