-- ============================================================================
-- MOMENTY v0.4 · 실제 가입 사용자 · 프로필 · 팔로우 · 미디어
--
--  1. 영상 포스터(poster_url) 컬럼 + moment_feed 반영 (잠기면 null)
--  2. creators / moments 쓰기 권한을 컬럼 단위로 좁힌다
--     (본인 행이라도 verified · follower_count · created_at 등은 바꿀 수 없다)
--  3. Moment 미디어 경로 검증 — 자기 폴더 + 실제 업로드된 파일만
--     (다른 크리에이터의 파일을 자기 공개 Moment에 걸어 잠긴 파일을 열람하는 것 차단,
--      파일 없는 DB 행 방지)
--  4. 무료 팔로우는 팬이 직접 생성·취소 (유료 등급은 여전히 결제 서버 / service role만)
--  5. 팔로우/구독 수 집계 캐시 자동 갱신
--  6. 프로필 이미지 bucket(avatars) · moment-media 파일 크기/형식 제한
--  7. 보관함(moment_bookmarks)
--  8. 업로드 후 DB 저장에 실패해 남은 파일(orphan) 찾기 — service role 전용
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. poster_url + moment_feed
-- ---------------------------------------------------------------------------
alter table public.moments add column poster_url text;

-- 기존 컬럼 순서를 유지하고 poster_url을 끝에 붙인다 (create or replace view 규칙)
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
  case when v.viewable then m.poster_url end as poster_url
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

-- ---------------------------------------------------------------------------
-- 2. 컬럼 단위 쓰기 권한
-- ---------------------------------------------------------------------------
revoke insert, update on public.creators from authenticated;
grant insert (profile_id, name, handle, job, category, bio, avatar_url, cover_url, tags) on public.creators to authenticated;
grant update (name, handle, job, category, bio, avatar_url, cover_url, tags) on public.creators to authenticated;

revoke insert, update on public.moments from authenticated;
grant insert (creator_id, type, content, media_url, poster_url, duration_sec, visibility, ai_context_enabled, location, safe_share)
  on public.moments to authenticated;
grant update (content, media_url, poster_url, duration_sec, visibility, ai_context_enabled, location, safe_share)
  on public.moments to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Moment 미디어 경로 검증
--    Storage 경로(외부 URL이 아닌 값)는 "{creator_id}/..." 이어야 하고 실제로 업로드되어 있어야 한다.
--    외부 URL(https://)은 seed 데이터용으로 허용한다 — Storage 권한과 무관하다.
-- ---------------------------------------------------------------------------
create function public.check_moment_media()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p text;
begin
  foreach p in array array[new.media_url, new.poster_url] loop
    continue when p is null or p ~ '^https?://';
    if split_part(p, '/', 1) <> new.creator_id or p like '%..%' then
      raise exception 'media path must be inside the creator folder: %', p using errcode = '42501';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'moment-media' and o.name = p) then
      raise exception 'media file is not uploaded: %', p using errcode = '23503';
    end if;
  end loop;
  return new;
end;
$$;

create trigger moments_media_check
  before insert or update of media_url, poster_url, creator_id on public.moments
  for each row execute function public.check_moment_media();

-- ---------------------------------------------------------------------------
-- 4. 무료 팔로우 — 팬 본인이 직접 (유료 등급은 만들거나 올리거나 지울 수 없다)
-- ---------------------------------------------------------------------------
grant insert (fan_id, creator_id, tier) on public.subscriptions to authenticated;
grant delete on public.subscriptions to authenticated;

create policy "subscriptions: 본인 무료 팔로우 생성" on public.subscriptions
  for insert to authenticated
  with check (fan_id = (select auth.uid()) and tier = 'follow' and not public.is_creator_owner(creator_id));
create policy "subscriptions: 본인 무료 팔로우 취소" on public.subscriptions
  for delete to authenticated
  using (fan_id = (select auth.uid()) and tier = 'follow');

-- ---------------------------------------------------------------------------
-- 5. 팔로워 / 구독자 수 캐시 (모든 관계 = 팔로워, subscriber · premium = 구독자)
-- ---------------------------------------------------------------------------
create function public.sync_creator_counts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  paid_old int := case when tg_op <> 'INSERT' and old.tier <> 'follow' then 1 else 0 end;
  paid_new int := case when tg_op <> 'DELETE' and new.tier <> 'follow' then 1 else 0 end;
begin
  if tg_op = 'INSERT' then
    update public.creators set follower_count = follower_count + 1, subscriber_count = subscriber_count + paid_new
    where id = new.creator_id;
  elsif tg_op = 'DELETE' then
    update public.creators
    set follower_count = greatest(follower_count - 1, 0), subscriber_count = greatest(subscriber_count - paid_old, 0)
    where id = old.creator_id;
  elsif new.tier is distinct from old.tier then
    update public.creators set subscriber_count = greatest(subscriber_count + paid_new - paid_old, 0)
    where id = new.creator_id;
  end if;
  return null;
end;
$$;

create trigger subscriptions_sync_counts
  after insert or delete or update of tier on public.subscriptions
  for each row execute function public.sync_creator_counts();

-- ---------------------------------------------------------------------------
-- 6. Storage
--    avatars: 공개 bucket (프로필 사진은 공개 정보). 경로 {auth.uid}/{파일} — 본인 폴더만 쓰기
--    moment-media: 형식·크기 제한 추가 (정책은 poster_url까지 포함하도록 다시 만든다)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp',
      'video/mp4', 'video/quicktime', 'video/webm',
      'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/x-m4a'
    ]
where id = 'moment-media';

create policy "avatars: 누구나 읽기" on storage.objects
  for select to anon, authenticated using (bucket_id = 'avatars');
create policy "avatars: 본인 폴더에만 업로드" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "avatars: 본인 폴더만 수정" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "avatars: 본인 폴더만 삭제" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));

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
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 7. 보관함 — 본인 것만, 볼 수 있는 Moment만
-- ---------------------------------------------------------------------------
create table public.moment_bookmarks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  moment_id uuid not null references public.moments (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, moment_id)
);

alter table public.moment_bookmarks enable row level security;

create policy "bookmarks: 본인 것만 조회" on public.moment_bookmarks
  for select to authenticated using (user_id = (select auth.uid()));
create policy "bookmarks: 본인만 생성" on public.moment_bookmarks
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.moments m
      where m.id = moment_id and public.can_view_moment(m.creator_id, m.visibility)
    )
  );
create policy "bookmarks: 본인만 삭제" on public.moment_bookmarks
  for delete to authenticated using (user_id = (select auth.uid()));

grant select, delete on public.moment_bookmarks to authenticated;
grant insert (user_id, moment_id) on public.moment_bookmarks to authenticated;
grant all on public.moment_bookmarks to service_role;

-- ---------------------------------------------------------------------------
-- 8. orphan 파일 — 어떤 Moment도 가리키지 않는 업로드 (저장 실패 · 창 닫힘 등)
--    service role 정리 스크립트(npm run db:cleanup-media)만 호출할 수 있다.
--    Storage 파일은 SQL이 아니라 Storage API로 지운다.
-- ---------------------------------------------------------------------------
create function public.orphan_moment_media(p_older_than interval default interval '1 day')
returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'moment-media'
    and o.created_at < now() - p_older_than
    and not exists (
      select 1 from public.moments m where m.media_url = o.name or m.poster_url = o.name
    );
$$;

revoke all on function public.orphan_moment_media(interval) from public, anon, authenticated;
grant execute on function public.orphan_moment_media(interval) to service_role;
revoke all on function public.check_moment_media() from public, anon, authenticated;
revoke all on function public.sync_creator_counts() from public, anon, authenticated;
