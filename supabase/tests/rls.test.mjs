/**
 * RLS / 스키마 테스트 — 실제 migration SQL을 PGlite(WASM Postgres)에서 실행한다.
 * Supabase의 auth · storage 스키마와 anon/authenticated 역할은 최소한으로 흉내 낸다.
 *
 *   npm run test:db   (tsx로 실행 — seed용 Mock 데이터(TypeScript)도 스키마 제약에 맞는지 확인한다)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, created_at timestamptz not null default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable
  as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema public, auth, storage to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
-- 새 Supabase 프로젝트처럼: public의 새 테이블은 자동으로 열리지 않는다 → migration의 GRANT만으로 동작해야 한다
revoke execute on all functions in schema public from public;
alter default privileges in schema public revoke execute on functions from public;
`;

const db = new PGlite();
let passed = 0;
let failed = 0;

function check(name, ok, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok || !detail ? "" : `  → ${detail}`}`);
}

/** 사용자로 쿼리 (uid 없으면 anon) */
async function as(uid, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  await db.exec(`set role ${uid ? "authenticated" : "anon"}`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}

async function fails(uid, sql, params = []) {
  try {
    await as(uid, sql, params);
    return false;
  } catch {
    return true;
  }
}

const count = async (uid, sql, params) => (await as(uid, sql, params)).rows.length;

/** 거부되었고, 그 이유(오류 메시지)가 기대한 것인지 — 다른 이유로 우연히 실패한 것을 통과로 치지 않는다 */
async function failsWith(uid, sql, params, pattern) {
  try {
    await as(uid, sql, params);
    return false;
  } catch (e) {
    return pattern.test(String(e.message));
  }
}

await db.exec(SUPABASE_STUB);
for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
  await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  console.log(`migration applied: ${f}`);
}

// ---------- fixture (superuser = service role) ----------
const U = {
  creatorA: "00000000-0000-0000-0000-00000000000a",
  creatorB: "00000000-0000-0000-0000-00000000000b",
  premium: "00000000-0000-0000-0000-000000000001",
  subscriber: "00000000-0000-0000-0000-000000000002",
  follower: "00000000-0000-0000-0000-000000000003",
};
for (const [name, id] of Object.entries(U)) {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    id,
    `${name}@test.dev`,
    { nickname: name },
  ]);
}
await db.exec(`
  insert into public.creators (id, profile_id, name, handle, category) values
    ('c1', '${U.creatorA}', '한하린', 'harin.film', 'photo'),
    ('c2', '${U.creatorB}', '이도윤', 'doyun.sings', 'music');
  insert into public.subscriptions (fan_id, creator_id, tier) values
    ('${U.premium}', 'c1', 'premium'),
    ('${U.subscriber}', 'c1', 'subscriber'),
    ('${U.follower}', 'c1', 'follow');
  -- 파일이 먼저 있어야 Moment가 참조할 수 있다 (v0.4 미디어 검증)
  insert into storage.objects (bucket_id, name) values ('moment-media', 'c1/sub.jpg'), ('moment-media', 'c1/premium.jpg');
  insert into public.moments (id, creator_id, type, content, media_url, visibility) values
    ('10000000-0000-0000-0000-000000000001', 'c1', 'text', '전체 공개', null, 'public'),
    ('10000000-0000-0000-0000-000000000002', 'c1', 'photo', '구독자 공개', 'c1/sub.jpg', 'subscriber'),
    ('10000000-0000-0000-0000-000000000003', 'c1', 'photo', 'Premium 공개', 'c1/premium.jpg', 'premium');
`);
const M = {
  pub: "10000000-0000-0000-0000-000000000001",
  sub: "10000000-0000-0000-0000-000000000002",
  prem: "10000000-0000-0000-0000-000000000003",
};

console.log("\n가입 → profile");
check("auth.users 가입 시 profile 자동 생성", (await db.query(`select nickname from public.profiles where id = $1`, [U.premium])).rows[0]?.nickname === "premium");

console.log("\nmoments 조회 (테이블 직접 접근)");
check("비로그인: public만 (1)", (await count(null, `select id from public.moments`)) === 1);
check("팔로우(무료): public만 (1)", (await count(U.follower, `select id from public.moments`)) === 1);
check("구독자: public + subscriber (2)", (await count(U.subscriber, `select id from public.moments`)) === 2);
check("Premium: 전부 (3)", (await count(U.premium, `select id from public.moments`)) === 3);
check("크리에이터 본인: 전부 (3)", (await count(U.creatorA, `select id from public.moments`)) === 3);
check("다른 크리에이터: public만 (1)", (await count(U.creatorB, `select id from public.moments`)) === 1);

console.log("\nmoment_feed (잠긴 Moment는 행만, 내용은 null)");
{
  const rows = (await as(U.follower, `select id, viewable, content, media_url from public.moment_feed order by id`)).rows;
  check("무료 팬도 3개의 Moment 존재는 안다 (Locked State)", rows.length === 3);
  const prem = rows.find((r) => r.id === M.prem);
  check("잠긴 Premium Moment의 content · media_url은 null", prem && !prem.viewable && prem.content === null && prem.media_url === null);
  const premRow = (await as(U.premium, `select content, media_url from public.moment_feed where id = $1`, [M.prem])).rows[0];
  check("Premium 팬에게는 내용이 보인다", premRow?.content === "Premium 공개" && premRow?.media_url === "c1/premium.jpg");
  const anonSub = (await as(null, `select content from public.moment_feed where id = $1`, [M.sub])).rows[0];
  check("비로그인: subscriber Moment 내용 null", anonSub && anonSub.content === null);
}

console.log("\nmoments 생성 · 수정 · 삭제");
const insertSql = `insert into public.moments (creator_id, type, content, visibility) values ($1, 'text', '새 순간', 'public') returning id`;
check("다른 크리에이터가 c1에 생성 → 거부", await fails(U.creatorB, insertSql, ["c1"]));
check("팬이 생성 → 거부", await fails(U.premium, insertSql, ["c1"]));
check("비로그인이 생성 → 거부", await fails(null, insertSql, ["c1"]));
const created = await as(U.creatorA, insertSql, ["c1"]);
check("크리에이터 본인 생성 → 성공 (returning 포함)", created.rows.length === 1);
const newId = created.rows[0]?.id;
check(
  "creator_id를 남의 것으로 바꾸는 수정 → 거부",
  await fails(U.creatorA, `update public.moments set creator_id = 'c2' where id = $1`, [newId]),
);
check("다른 크리에이터 수정 → 0행", (await as(U.creatorB, `update public.moments set content = 'x' where id = $1 returning id`, [newId])).rows.length === 0);
check("Premium 팬 수정 → 0행", (await as(U.premium, `update public.moments set content = 'x' where id = $1 returning id`, [M.pub])).rows.length === 0);
check("본인 수정 → 1행", (await as(U.creatorA, `update public.moments set content = '고친 순간' where id = $1 returning id`, [newId])).rows.length === 1);
{
  const r = (await db.query(`select updated_at > created_at as bumped from public.moments where id = $1`, [newId])).rows[0];
  check("updated_at 자동 갱신", r?.bumped === true);
}
check("팬 삭제 → 0행", (await as(U.premium, `delete from public.moments where id = $1 returning id`, [newId])).rows.length === 0);
check("본인 삭제 → 1행", (await as(U.creatorA, `delete from public.moments where id = $1 returning id`, [newId])).rows.length === 1);

console.log("\n제약 조건");
check("잘못된 visibility 값 → 거부", await fails(U.creatorA, `insert into public.moments (creator_id, type, content, visibility) values ('c1', 'text', 'a', 'subscribers')`));
check("잘못된 type 값 → 거부", await fails(U.creatorA, `insert into public.moments (creator_id, type, content) values ('c1', 'gif', 'a')`));
check("미디어 없는 사진 → 거부", await fails(U.creatorA, `insert into public.moments (creator_id, type, content) values ('c1', 'photo', 'a')`));
check("빈 텍스트 Moment → 거부", await fails(U.creatorA, `insert into public.moments (creator_id, type, content) values ('c1', 'text', '   ')`));

console.log("\nmoment_reactions");
const react = `insert into public.moment_reactions (moment_id, user_id, kind) values ($1, $2, 'love')`;
check("구독자: subscriber Moment에 ♥ → 성공", !(await fails(U.subscriber, react, [M.sub, U.subscriber])));
check("같은 반응 중복 → 거부 (PK)", await fails(U.subscriber, react, [M.sub, U.subscriber]));
check("남의 user_id로 반응 → 거부", await fails(U.subscriber, react, [M.pub, U.premium]));
check("볼 수 없는 Premium Moment에 반응 → 거부", await fails(U.subscriber, react, [M.prem, U.subscriber]));
check("비로그인 반응 → 거부", await fails(null, react, [M.pub, U.premium]));
await as(U.premium, react, [M.sub, U.premium]);
check("반응 조회는 본인 것만", (await count(U.subscriber, `select * from public.moment_reactions`)) === 1);
check("남의 반응 삭제 → 0행", (await as(U.premium, `delete from public.moment_reactions where user_id = $1 returning 1`, [U.subscriber])).rows.length === 0);
{
  const r = (await as(U.subscriber, `select love_count, liked_by_me from public.moment_feed where id = $1`, [M.sub])).rows[0];
  check("feed: 전체 ♥ 개수 2 · liked_by_me", r?.love_count === 2 && r?.liked_by_me === true);
  const r2 = (await as(U.follower, `select love_count, liked_by_me from public.moment_feed where id = $1`, [M.sub])).rows[0];
  check("feed: 다른 사람 기준 liked_by_me = false", r2?.love_count === 2 && r2?.liked_by_me === false);
}
check("본인 반응 삭제 → 1행", (await as(U.subscriber, `delete from public.moment_reactions where moment_id = $1 and user_id = $2 returning 1`, [M.sub, U.subscriber])).rows.length === 1);

console.log("\nsubscriptions");
check("무료 팬이 스스로 Premium으로 변경 → 거부", await fails(U.follower, `update public.subscriptions set tier = 'premium' where fan_id = $1`, [U.follower]));
check("스스로 구독 생성 → 거부", await fails(U.follower, `insert into public.subscriptions (fan_id, creator_id, tier) values ($1, 'c2', 'premium')`, [U.follower]));
check("팬은 자기 구독만 조회 (1)", (await count(U.follower, `select * from public.subscriptions`)) === 1);
check("크리에이터는 자기 구독자 조회 (3)", (await count(U.creatorA, `select * from public.subscriptions`)) === 3);
check("다른 크리에이터는 조회 불가 (0)", (await count(U.creatorB, `select * from public.subscriptions`)) === 0);

console.log("\nStorage (moment-media)");
check("무료 팬: 잠긴 사진 파일 읽기 불가", (await count(U.follower, `select name from storage.objects`)) === 0);
check("구독자: subscriber 사진만 (1)", (await count(U.subscriber, `select name from storage.objects`)) === 1);
check("Premium: 둘 다 (2)", (await count(U.premium, `select name from storage.objects`)) === 2);
check("다른 크리에이터가 c1 폴더에 업로드 → 거부", await fails(U.creatorB, `insert into storage.objects (bucket_id, name) values ('moment-media', 'c1/evil.jpg')`));
check("본인 폴더 업로드 → 성공", !(await fails(U.creatorA, `insert into storage.objects (bucket_id, name) values ('moment-media', 'c1/new.jpg')`)));

/* ======================= v0.4 ======================= */
const U2 = {
  newCreator: "00000000-0000-0000-0000-0000000000c9",
  newFan: "00000000-0000-0000-0000-0000000000f9",
};
for (const [name, id] of Object.entries(U2)) {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${name}@test.dev`, { nickname: name }]);
}

console.log("\nv0.4 · Creator 가입 (creators 생성)");
check(
  "남의 profile로 creator 생성 → 거부",
  await fails(U2.newFan, `insert into public.creators (profile_id, name, handle, category) values ($1, '가짜', 'fake.one', 'art')`, [U2.newCreator]),
);
check(
  "verified · follower_count를 직접 넣어 생성 → 거부 (컬럼 권한)",
  await fails(
    U2.newCreator,
    `insert into public.creators (profile_id, name, handle, category, verified, follower_count) values ($1, '새 크리에이터', 'new.creator', 'art', true, 99999)`,
    [U2.newCreator],
  ),
);
const newCreatorRow = await as(
  U2.newCreator,
  `insert into public.creators (profile_id, name, handle, category, bio) values ($1, '새 크리에이터', 'new.creator', 'art', '안녕하세요') returning id, verified, follower_count`,
  [U2.newCreator],
);
const C9 = newCreatorRow.rows[0]?.id;
check("본인 profile로 creator 생성 → 성공 (id 자동, verified=false)", !!C9 && newCreatorRow.rows[0].verified === false && newCreatorRow.rows[0].follower_count === 0);
check(
  "같은 profile로 두 번째 creator → 거부 (1:1)",
  await fails(U2.newCreator, `insert into public.creators (profile_id, name, handle, category) values ($1, '둘째', 'second.one', 'art')`, [U2.newCreator]),
);
check("본인 creator 프로필 수정 → 1행", (await as(U2.newCreator, `update public.creators set bio = '수정', name = '이름' where id = $1 returning id`, [C9])).rows.length === 1);
check("본인이라도 verified 수정 → 거부", await fails(U2.newCreator, `update public.creators set verified = true where id = $1`, [C9]));
check("본인이라도 follower_count 수정 → 거부", await fails(U2.newCreator, `update public.creators set follower_count = 1000000 where id = $1`, [C9]));
check("다른 사용자가 creator 프로필 수정 → 0행", (await as(U2.newFan, `update public.creators set bio = 'x' where id = $1 returning id`, [C9])).rows.length === 0);
check(
  "다른 사용자 profile 수정 → 0행",
  (await as(U2.newFan, `update public.profiles set nickname = 'x' where id = $1 returning id`, [U2.newCreator])).rows.length === 0,
);

console.log("\nv0.4 · 팔로우 (무료) · 집계");
const follow = `insert into public.subscriptions (fan_id, creator_id, tier) values ($1, $2, $3)`;
check("팬 본인 무료 팔로우 → 성공", !(await fails(U2.newFan, follow, [U2.newFan, C9, "follow"])));
check("팔로워 수 +1 (트리거)", (await db.query(`select follower_count from public.creators where id = $1`, [C9])).rows[0].follower_count === 1);
check("결제 없이 subscriber 생성 → 거부", await fails(U2.newFan, follow, [U2.newFan, "c2", "subscriber"]));
check("결제 없이 premium 생성 → 거부", await fails(U2.newFan, follow, [U2.newFan, "c2", "premium"]));
check("남의 이름으로 팔로우 → 거부", await fails(U2.newFan, follow, [U2.premium, "c2", "follow"]));
check("크리에이터가 자기 채널 팔로우 → 거부", await fails(U2.newCreator, follow, [U2.newCreator, C9, "follow"]));
check("팔로우를 premium으로 올리기 → 거부", await fails(U2.newFan, `update public.subscriptions set tier = 'premium' where fan_id = $1`, [U2.newFan]));
check(
  "유료 구독은 팬이 지울 수 없음 → 0행",
  (await as(U.premium, `delete from public.subscriptions where fan_id = $1 and creator_id = 'c1' returning id`, [U.premium])).rows.length === 0,
);
check(
  "팔로우 취소 → 1행 · 팔로워 수 -1",
  (await as(U2.newFan, `delete from public.subscriptions where fan_id = $1 and creator_id = $2 returning id`, [U2.newFan, C9])).rows.length === 1 &&
    (await db.query(`select follower_count from public.creators where id = $1`, [C9])).rows[0].follower_count === 0,
);
await db.query(follow, [U2.newFan, C9, "follow"]);
await db.query(`update public.subscriptions set tier = 'premium' where fan_id = $1 and creator_id = $2`, [U2.newFan, C9]); // 결제 서버(service role) 역할
check("결제 서버가 premium으로 올리면 구독자 수 +1", (await db.query(`select subscriber_count from public.creators where id = $1`, [C9])).rows[0].subscriber_count === 1);

console.log("\nv0.4 · Moment 쓰기 컬럼 · 미디어 경로");
check(
  "created_at 직접 지정해 생성 → 거부 (컬럼 권한)",
  await fails(U.creatorA, `insert into public.moments (creator_id, type, content, created_at) values ('c1', 'text', 'x', '2020-01-01')`),
);
check("created_at 수정 → 거부", await fails(U.creatorA, `update public.moments set created_at = '2020-01-01' where id = $1`, [M.pub]));
check(
  "공격: 다른 크리에이터의 잠긴 파일(c1/premium.jpg)을 내 공개 Moment에 연결 → 거부",
  await fails(U.creatorB, `insert into public.moments (creator_id, type, content, media_url, visibility) values ('c2', 'photo', 'x', 'c1/premium.jpg', 'public')`),
);
check(
  "공격 후에도 비구독자는 c1/premium.jpg를 읽을 수 없음",
  (await count(U.follower, `select name from storage.objects where name = 'c1/premium.jpg'`)) === 0,
);
check(
  "업로드되지 않은 파일 경로로 생성 → 거부 (파일 없는 행 방지)",
  await fails(U.creatorA, `insert into public.moments (creator_id, type, content, media_url, visibility) values ('c1', 'photo', 'x', 'c1/missing.jpg', 'public')`),
);
check(
  "경로 조작(..) → 거부",
  await fails(U.creatorA, `insert into public.moments (creator_id, type, content, media_url, visibility) values ('c1', 'photo', 'x', 'c1/../c2/a.jpg', 'public')`),
);
await db.exec(`insert into storage.objects (bucket_id, name) values ('moment-media', 'c1/v.mp4'), ('moment-media', 'c1/v.jpg'), ('moment-media', 'c1/voice.webm')`);
const vid = await as(
  U.creatorA,
  `insert into public.moments (creator_id, type, content, media_url, poster_url, duration_sec, visibility) values ('c1', 'video', '영상', 'c1/v.mp4', 'c1/v.jpg', 12, 'premium') returning id`,
);
check("영상 + 포스터 (본인 폴더, 업로드된 파일) → 성공", vid.rows.length === 1);
check(
  "음성 파일 Moment → 성공",
  !(await fails(U.creatorA, `insert into public.moments (creator_id, type, content, media_url, duration_sec, visibility) values ('c1', 'voice', '목소리', 'c1/voice.webm', 7, 'public')`)),
);
{
  const r = (await as(U.subscriber, `select viewable, media_url, poster_url from public.moment_feed where id = $1`, [vid.rows[0].id])).rows[0];
  check("잠긴 영상: feed에서 media_url · poster_url 모두 null", r && !r.viewable && r.media_url === null && r.poster_url === null);
  check("잠긴 영상의 포스터 파일도 읽기 불가", (await count(U.subscriber, `select 1 from storage.objects where name = 'c1/v.jpg'`)) === 0);
  check("Premium 팬은 포스터 파일 읽기 가능", (await count(U.premium, `select 1 from storage.objects where name = 'c1/v.jpg'`)) === 1);
}
check(
  "미디어를 다른 크리에이터 폴더로 수정 → 거부",
  await fails(U.creatorA, `update public.moments set media_url = 'c2/x.jpg' where id = $1`, [vid.rows[0].id]),
);

console.log("\nv0.4 · 프로필 이미지 (avatars)");
const avatar = (uid, path) => as(uid, `insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [path]);
check("본인 폴더에 업로드 → 성공", !(await fails(U2.newFan, `insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${U2.newFan}/a.png`])));
check("다른 사용자 폴더에 업로드 → 거부", await fails(U2.newFan, `insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${U2.newCreator}/a.png`]));
check("비로그인 업로드 → 거부", await fails(null, `insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${U2.newFan}/b.png`]));
await avatar(U2.newCreator, `${U2.newCreator}/me.png`);
check(
  "다른 사용자 프로필 이미지 삭제 → 0행",
  (await as(U2.newFan, `delete from storage.objects where bucket_id = 'avatars' and name = $1 returning name`, [`${U2.newCreator}/me.png`])).rows.length === 0,
);
check(
  "다른 사용자 프로필 이미지 덮어쓰기 → 0행",
  (await as(U2.newFan, `update storage.objects set name = name where bucket_id = 'avatars' and name = $1 returning name`, [`${U2.newCreator}/me.png`])).rows.length === 0,
);
check("프로필 이미지는 누구나 읽기", (await count(null, `select 1 from storage.objects where bucket_id = 'avatars'`)) === 2);
{
  const b = (await db.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'avatars'`)).rows[0];
  check("avatars bucket: 공개 · 2MB · jpeg/png/webp", b?.public === true && Number(b.file_size_limit) === 2097152 && b.allowed_mime_types.length === 3);
  const mm = (await db.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'moment-media'`)).rows[0];
  check("moment-media bucket: 비공개 · 50MB · 사진/영상/음성 형식", mm?.public === false && Number(mm.file_size_limit) === 52428800 && mm.allowed_mime_types.includes("audio/webm"));
}

console.log("\nv0.4 · 보관함");
const bm = `insert into public.moment_bookmarks (user_id, moment_id) values ($1, $2)`;
check("볼 수 있는 Moment 보관 → 성공", !(await fails(U.subscriber, bm, [U.subscriber, M.sub])));
check("볼 수 없는 Moment 보관 → 거부", await fails(U.follower, bm, [U.follower, M.sub]));
check("남의 이름으로 보관 → 거부", await fails(U.follower, bm, [U.subscriber, M.pub]));
check("보관함은 본인 것만 조회", (await count(U.premium, `select * from public.moment_bookmarks`)) === 0);

console.log("\nv0.4 · orphan 파일 정리 함수");
await db.exec(`insert into storage.objects (bucket_id, name, created_at) values ('moment-media', 'c1/orphan.jpg', now() - interval '2 days')`);
check("일반 사용자는 호출 불가", await fails(U.creatorA, `select * from public.orphan_moment_media()`));
check("비로그인 호출 불가", await fails(null, `select * from public.orphan_moment_media()`));
{
  await db.exec("set role service_role");
  const rows = (await db.query(`select name from public.orphan_moment_media(interval '1 day')`)).rows.map((r) => r.name);
  await db.exec("reset role");
  check("service role: 참조 없는 오래된 파일만 (c1/orphan.jpg)", rows.length === 1 && rows[0] === "c1/orphan.jpg", rows);
}

/* ======================= v0.5-2 Persona · AI 대화 · rate limit ======================= */
const KEY = "server-key-for-tests-0123456789abcdef-XYZ";
await db.query(`insert into private.server_keys (id, key_hash) values ('ai', encode(sha256(convert_to($1, 'UTF8')), 'hex'))`, [KEY]);
const aiOffId = "10000000-0000-0000-0000-0000000000a0";
const c2MomentId = "10000000-0000-0000-0000-0000000000c2";
await db.exec(`
  insert into public.moments (id, creator_id, type, content, visibility, ai_context_enabled) values
    ('${aiOffId}', 'c1', 'text', 'AI 참고 꺼짐', 'public', false),
    ('${c2MomentId}', 'c2', 'text', '다른 크리에이터', 'public', true);
`);

console.log("\nv0.5 · Persona 설정 테이블 (크리에이터 본인만)");
const personaSql = `insert into public.creator_personas (creator_id, formality, reply_length, laugh_kk, emoji_level, phrases, mood, example_messages, traits)
  values ($1, 'casual', 'short', true, 2, '{"오늘도 화이팅"}', '따뜻한', '{"안녕 ㅋㅋ 오늘 날씨 좋다"}', '{"warm","playful"}')`;
check("다른 크리에이터가 c1 Persona 생성 → RLS 거부", await failsWith(U.creatorB, personaSql, ["c1"], /row-level security/));
check("팬이 c1 Persona 생성 → RLS 거부", await failsWith(U.premium, personaSql, ["c1"], /row-level security/));
check("크리에이터 본인 Persona 생성 → 성공", !(await fails(U.creatorA, personaSql, ["c1"])));
check("팬(Premium)은 Persona 원본을 읽을 수 없음 (0행)", (await count(U.premium, `select * from public.creator_personas`)) === 0);
check("다른 크리에이터도 읽을 수 없음 (0행)", (await count(U.creatorB, `select * from public.creator_personas`)) === 0);
check("비로그인 읽기 → 거부", await fails(null, `select * from public.creator_personas`));
check("본인은 읽기 · 수정 가능", (await as(U.creatorA, `update public.creator_personas set mood = '차분한' where creator_id = 'c1' returning 1`)).rows.length === 1);
check("다른 크리에이터 수정 → 0행", (await as(U.creatorB, `update public.creator_personas set mood = 'x' where creator_id = 'c1' returning 1`)).rows.length === 0);
check("허용되지 않은 성향 값 → 거부", await fails(U.creatorA, `update public.creator_personas set traits = '{"evil"}' where creator_id = 'c1'`));
check("자주 쓰는 표현 11개 → 거부", await fails(U.creatorA, `update public.creator_personas set phrases = array_fill('ㅋ'::text, array[11]) where creator_id = 'c1'`));
check("표현 한 개가 41자 → 거부", await fails(U.creatorA, `update public.creator_personas set phrases = array[repeat('가', 41)] where creator_id = 'c1'`));
check("존댓말/반말 외 값 → 거부", await fails(U.creatorA, `update public.creator_personas set formality = 'rude' where creator_id = 'c1'`));
check("created_at 수정 → 거부 (컬럼 권한)", await fails(U.creatorA, `update public.creator_personas set created_at = '2020-01-01' where creator_id = 'c1'`));

console.log("\nv0.5 · Verified Facts");
const factSql = `insert into public.creator_facts (creator_id, category, content) values ($1, 'food', $2) returning id, last_verified_at`;
check("다른 크리에이터가 c1 사실 추가 → RLS 거부", await failsWith(U.creatorB, factSql, ["c1", "가짜 사실"], /row-level security/));
check("팬이 c1 사실 추가 → RLS 거부", await failsWith(U.premium, factSql, ["c1", "가짜 사실"], /row-level security/));
const fact = (await as(U.creatorA, factSql, ["c1", "좋아하는 음식은 초밥"])).rows[0];
check("본인 사실 추가 → 성공 (last_verified_at 자동)", !!fact?.id && !!fact.last_verified_at);
const inactive = (await as(U.creatorA, factSql, ["c1", "예전에 좋아하던 것 (비활성)"])).rows[0];
await as(U.creatorA, `update public.creator_facts set active = false where id = $1`, [inactive.id]);
check("팬은 사실 원본을 읽을 수 없음 (0행)", (await count(U.premium, `select * from public.creator_facts`)) === 0);
check("source 지정 → 거부 (컬럼 권한)", await fails(U.creatorA, `insert into public.creator_facts (creator_id, content, source) values ('c1', 'x', 'creator_studio')`));
check("created_at 지정 → 거부", await fails(U.creatorA, `insert into public.creator_facts (creator_id, content, created_at) values ('c1', 'x', '2020-01-01')`));
{
  await as(U.creatorA, `update public.creator_facts set last_verified_at = '2000-01-01' where id = $1`, [fact.id]);
  const r = (await db.query(`select last_verified_at > now() - interval '1 minute' as fresh from public.creator_facts where id = $1`, [fact.id])).rows[0];
  check("last_verified_at을 과거로 조작 → 서버 시각(now)으로 저장", r?.fresh === true);
}
check("빈 내용 → 거부", await fails(U.creatorA, factSql, ["c1", "   "]));
check("다른 크리에이터가 c1 사실 삭제 → 0행", (await as(U.creatorB, `delete from public.creator_facts where creator_id = 'c1' returning 1`)).rows.length === 0);

console.log("\nv0.5 · Boundaries · Persona ON/OFF");
check("본인 Boundary 설정 → 성공", !(await fails(U.creatorA, `insert into public.creator_boundaries (creator_id, topic, allowed) values ('c1', 'jokes', false)`)));
check("정의 밖 topic → 거부", await fails(U.creatorA, `insert into public.creator_boundaries (creator_id, topic, allowed) values ('c1', 'anything', true)`));
check("다른 크리에이터가 c1 Boundary 설정 → RLS 거부", await failsWith(U.creatorB, `insert into public.creator_boundaries (creator_id, topic, allowed) values ('c1', 'sexual', true)`, [], /row-level security/));
check("팬은 Boundary 원본을 읽을 수 없음", (await count(U.premium, `select * from public.creator_boundaries`)) === 0);
check("다른 크리에이터가 c1 persona_enabled 끄기 → 0행", (await as(U.creatorB, `update public.creators set persona_enabled = false where id = 'c1' returning 1`)).rows.length === 0);
check("본인이 persona_enabled 끄기/켜기 → 성공",
  (await as(U.creatorA, `update public.creators set persona_enabled = false where id = 'c1' returning 1`)).rows.length === 1 &&
  (await as(U.creatorA, `update public.creators set persona_enabled = true where id = 'c1' returning 1`)).rows.length === 1);

console.log("\nv0.5 · ai_persona_context (서버 키 + 팬 권한)");
const ctxSql = `select public.ai_persona_context($1, $2) as ctx`;
check("비로그인 → 거부", await fails(null, ctxSql, [KEY, "c1"]));
check("서버 키 없이 (구독자 JWT만) → server_key_required", await failsWith(U.subscriber, ctxSql, [null, "c1"], /server_key_required/));
check("틀린 서버 키 → server_key_required", await failsWith(U.subscriber, ctxSql, ["wrong-key-wrong-key-wrong-key-wrong-key", "c1"], /server_key_required/));
check("무료 팔로워 → subscription_required", await failsWith(U.follower, ctxSql, [KEY, "c1"], /subscription_required/));
check("크리에이터 본인 → own_channel", await failsWith(U.creatorA, ctxSql, [KEY, "c1"], /own_channel/));
check("Persona 미설정 크리에이터(c2) → persona_not_configured", await failsWith(U.subscriber, ctxSql, [KEY, "c2"], /persona_not_configured/));
check("없는 크리에이터 → creator_not_found", await failsWith(U.subscriber, ctxSql, [KEY, "nobody"], /creator_not_found/));
{
  const ctx = (await as(U.subscriber, ctxSql, [KEY, "c1"])).rows[0]?.ctx;
  check("구독자 + 서버 키 → Persona Context", ctx?.style?.formality === "casual" && ctx.personality.traits.includes("warm"));
  check("활성 사실만 (비활성 제외)", ctx?.facts.length === 1 && ctx.facts[0].content === "좋아하는 음식은 초밥");
  check("사실에는 분류 · 내용만 (출처 · 시각 없음)", ctx && Object.keys(ctx.facts[0]).sort().join() === "category,content");
  check("Boundary 기본값 + 크리에이터 설정 (jokes 금지, current_location 금지, everyday 허용)",
    ctx?.boundaries.jokes === false && ctx.boundaries.current_location === false && ctx.boundaries.everyday === true && Object.keys(ctx.boundaries).length === 10);
}
await as(U.creatorA, `update public.creators set persona_enabled = false where id = 'c1'`);
check("Persona OFF → 구독자도 persona_disabled", await failsWith(U.subscriber, ctxSql, [KEY, "c1"], /persona_disabled/));
await as(U.creatorA, `update public.creators set persona_enabled = true where id = 'c1'`);

console.log("\nv0.5 · 회귀 A — 활성 Fact 50개 제한 우회");
{
  const add = (content, active = true) =>
    as(U.creatorA, `insert into public.creator_facts (creator_id, content, active) values ('c1', $1, $2) returning id`, [content, active]);
  // 지금 활성 1개(초밥) → 49개 더 → 50개
  for (let i = 0; i < 49; i++) await add(`활성 사실 ${i}`);
  const activeCount = async () => Number((await db.query(`select count(*)::int as n from public.creator_facts where creator_id = 'c1' and active`)).rows[0].n);
  check("활성 50개까지는 허용", (await activeCount()) === 50);
  check("51번째 활성 insert → 거부", await failsWith(U.creatorA, `insert into public.creator_facts (creator_id, content) values ('c1', '51번째')`, [], /too many active facts/));
  const parked = [];
  for (let i = 0; i < 5; i++) parked.push((await add(`비활성 ${i}`, false)).rows[0].id);
  check("비활성 사실은 50개 한도와 무관하게 추가 가능", parked.length === 5);
  check("공격: 비활성 → active=true 전환 (1개) → 거부",
    await failsWith(U.creatorA, `update public.creator_facts set active = true where id = $1`, [parked[0]], /too many active facts/));
  check("공격: 비활성 전부 한 번에 active=true → 거부 · 하나도 활성화되지 않음",
    (await failsWith(U.creatorA, `update public.creator_facts set active = true where creator_id = 'c1' and not active`, [], /too many active facts/)) &&
      (await activeCount()) === 50);
  check("이미 활성인 사실의 내용 수정은 허용 (개수가 늘지 않음)",
    (await as(U.creatorA, `update public.creator_facts set content = '좋아하는 음식은 초밥' where creator_id = 'c1' and content = '좋아하는 음식은 초밥' returning 1`)).rows.length === 1);
  const one = (await db.query(`select id from public.creator_facts where creator_id = 'c1' and active and content = '활성 사실 0'`)).rows[0].id;
  await as(U.creatorA, `update public.creator_facts set active = false where id = $1`, [one]);
  check("하나를 끄면 다른 하나를 켤 수 있음 (교체)", (await as(U.creatorA, `update public.creator_facts set active = true where id = $1 returning 1`, [parked[0]])).rows.length === 1);
  check("교체 후에도 활성 50개", (await activeCount()) === 50);
  // 정리: 원래 상태(활성 1 · 비활성 1)로
  await db.exec(`delete from public.creator_facts where creator_id = 'c1' and (content like '활성 사실 %' or content like '비활성 %')`);
}

console.log("\nv0.5 · AI 대화 저장 (record_ai_exchange만)");
check("팬이 ai_conversations 직접 생성 → permission denied", await failsWith(U.subscriber, `insert into public.ai_conversations (fan_id, creator_id) values ($1, 'c1')`, [U.subscriber], /permission denied/));
const rec = `select public.record_ai_exchange($1, 'c1', '오늘 뭐 했어?', 'AI 답', $2::uuid[], '{"today"}', 'anthropic', 'm') as r`;
check("서버 키 없이 기록 → server_key_required", await failsWith(U.subscriber, rec, [null, []], /server_key_required/));
check("무료 팔로워 기록 → subscription_required", await failsWith(U.follower, rec, [KEY, []], /subscription_required/));
{
  const r = (await as(U.subscriber, rec, [KEY, [M.pub, M.sub, M.prem, aiOffId, c2MomentId]])).rows[0]?.r;
  const g = r?.groundedMomentIds ?? [];
  check("구독자 기록 → 대화 + 메시지 2개", !!r?.conversationId && !!r.aiMessageId);
  check("근거 id: 볼 수 있고 AI 허용된 c1 Moment만 남김 (premium · AI꺼짐 · 다른 크리에이터 제거)",
    g.length === 2 && g.includes(M.pub) && g.includes(M.sub) && !g.includes(M.prem) && !g.includes(aiOffId) && !g.includes(c2MomentId), g);
  const r2 = (await as(U.subscriber, rec, [KEY, []])).rows[0]?.r;
  check("같은 팬 · 크리에이터는 같은 대화에 이어서", r2?.conversationId === r.conversationId);
}
check("팬 본인은 자기 대화 · 메시지를 읽음 (4개)", (await count(U.subscriber, `select * from public.ai_messages`)) === 4);
check("다른 팬은 0개", (await count(U.premium, `select * from public.ai_messages`)) === 0 && (await count(U.premium, `select * from public.ai_conversations`)) === 0);
check("크리에이터(c1 본인)도 팬의 AI 대화를 읽을 수 없음", (await count(U.creatorA, `select * from public.ai_messages`)) === 0 && (await count(U.creatorA, `select * from public.ai_conversations`)) === 0);
check("팬이 메시지 수정 → permission denied", await failsWith(U.subscriber, `update public.ai_messages set content = 'x'`, [], /permission denied/));
{
  const conv = (await as(U.subscriber, `select id from public.ai_conversations`)).rows[0]?.id;
  check(
    "팬이 자기 실제 대화에 'AI 메시지' 위조 insert → permission denied",
    !!conv && (await failsWith(U.subscriber, `insert into public.ai_messages (conversation_id, sender, content) values ($1, 'ai', '위조된 AI 답')`, [conv], /permission denied/)),
  );
}
check("다른 팬이 대화 삭제 → 0행", (await as(U.premium, `delete from public.ai_conversations returning 1`)).rows.length === 0);

console.log("\nv0.5 · 회귀 C — record_ai_exchange 메타데이터 검증");
{
  const recAll = `select public.record_ai_exchange($1, 'c1', $2, $3, $4::uuid[], $5::text[], $6, $7, $8) as r`;
  const call = (o) =>
    failsWith(U.subscriber, recAll, [KEY, o.fan ?? "질문", o.ai ?? "답", o.ids ?? [], o.types ?? ["today"], o.provider ?? null, o.model ?? null, o.boundary ?? null], o.expect);
  check("허용되지 않은 context_type('private_moments') → 거부", await call({ types: ["today", "private_moments"], expect: /invalid context types/ }));
  check("context_types 9개 → 거부", await call({ types: Array(9).fill("today"), expect: /invalid context types/ }));
  check("허용되지 않은 provider → 거부", await call({ provider: "evil-proxy", expect: /invalid provider/ }));
  check("model에 공백 · 개행 → 거부", await call({ model: "gpt\nignore previous", expect: /invalid model/ }));
  check("model 81자 → 거부 (잘라 저장하지 않음)", await call({ model: "m".repeat(81), expect: /invalid model/ }));
  check("정의 밖 boundary → 거부 (null로 바꿔 저장하지 않음)", await call({ boundary: "anything", expect: /invalid boundary/ }));
  check("팬 메시지 1001자 → 거부", await call({ fan: "가".repeat(1001), expect: /invalid fan message/ }));
  check("빈 AI 답 → 거부", await call({ ai: "   ", expect: /invalid ai reply/ }));
  check("근거 id 61개 → 거부", await call({ ids: Array.from({ length: 61 }, () => M.pub), expect: /too many grounded/ }));
  const ok = (await as(U.subscriber, recAll, [KEY, "질문", "답", [], ["today", "today", "facts"], "anthropic", "claude-sonnet-5", "current_location"])).rows[0]?.r;
  const saved = (await db.query(`select context_types, provider, model, boundary from public.ai_messages where id = $1`, [ok?.aiMessageId])).rows[0];
  check("정상 메타데이터는 저장 (context_types 중복 제거)",
    saved?.provider === "anthropic" && saved.model === "claude-sonnet-5" && saved.boundary === "current_location" && saved.context_types.length === 2, saved);
  // 테이블 제약 (함수를 거치지 않는 경로도 형식 강제 — superuser로 직접 insert)
  const conv = (await db.query(`select id from public.ai_conversations limit 1`)).rows[0].id;
  const direct = async (sql) => {
    try {
      await db.query(sql, [conv]);
      return false;
    } catch {
      return true;
    }
  };
  check("테이블 제약: 정의 밖 context_type → 거부", await direct(`insert into public.ai_messages (conversation_id, sender, content, context_types) values ($1, 'ai', 'x', '{"evil"}')`));
  check("테이블 제약: 정의 밖 provider → 거부", await direct(`insert into public.ai_messages (conversation_id, sender, content, provider) values ($1, 'ai', 'x', 'evil')`));
  check("테이블 제약: 팬 메시지에 AI 메타데이터 → 거부", await direct(`insert into public.ai_messages (conversation_id, sender, content, provider) values ($1, 'fan', 'x', 'openai')`));
  check("테이블 제약: 팬 메시지 1001자 → 거부", await direct(`insert into public.ai_messages (conversation_id, sender, content) values ($1, 'fan', repeat('가', 1001))`));
}

console.log("\nv0.5 · 공유 rate limit (Postgres)");
// 정책 값은 서버 관리자만 (테스트 준비: superuser로 한도를 3 / 5 / 600으로)
await db.exec(`update private.ai_settings set rate_per_creator = 3, rate_per_user = 5, rate_window_sec = 600`);
const rl = `select public.consume_ai_rate_limit($1, $2) as r`;
check("서버 키 없이 → server_key_required", await failsWith(U.subscriber, rl, [null, "c1"], /server_key_required/));
check("비로그인 → 실행 권한 없음", await failsWith(null, rl, [KEY, "c1"], /permission denied/));
check("private 테이블 직접 조회 → permission denied", await failsWith(U.subscriber, `select * from private.ai_rate_limits`, [], /permission denied/));
check("server_keys 해시 직접 조회 → permission denied", await failsWith(U.subscriber, `select * from private.server_keys`, [], /permission denied/));
check("private 함수 직접 호출 → permission denied", await failsWith(U.subscriber, `select private.hit_bucket('x', interval '1 hour')`, [], /permission denied/));
{
  const seq = [];
  for (let i = 0; i < 4; i++) seq.push((await as(U.subscriber, rl, [KEY, "c1"])).rows[0].r);
  check("user × creator 3회 허용 → 4번째 거부 (per_creator)", seq.slice(0, 3).every((r) => r.allowed) && seq[3].allowed === false && seq[3].rule === "per_creator", seq.map((r) => r.allowed));
  const other = [];
  for (let i = 0; i < 2; i++) other.push((await as(U.subscriber, rl, [KEY, "c2"])).rows[0].r);
  check("user 전체 5회: 다른 크리에이터 2회 중 2번째에서 거부 (per_user)", other[0].allowed === true && other[1].allowed === false && other[1].rule === "per_user", other);
  const mine = (await as(U.premium, rl, [KEY, "c1"])).rows[0].r;
  check("다른 사용자는 별도 한도", mine.allowed === true);
  const counted = (await db.query(`select count from private.ai_rate_limits where bucket = $1`, [`ai_chat:${U.subscriber}:c1`])).rows[0]?.count;
  check("거부된 시도도 세어 순서대로 누적 (잃어버린 업데이트 없음)", counted === 4, counted);
  await db.query(`update private.ai_rate_limits set window_start = now() - interval '11 minutes' where bucket like $1`, [`ai_chat:${U.subscriber}%`]);
  const after = (await as(U.subscriber, rl, [KEY, "c1"])).rows[0].r;
  check("시간 창이 지나면 다시 허용", after.allowed === true && after.remaining === 2, after);
  check("잘못된 creatorId 형식 → 거부", await failsWith(U.subscriber, rl, [KEY, "../x"], /invalid creator id/));
}

console.log("\nv0.5 · 회귀 B — 호출자가 rate limit 값을 정하려는 공격");
{
  check("한도 · 창을 인자로 넘기는 호출(예전 5인자) → 함수 없음",
    await failsWith(U.subscriber, `select public.consume_ai_rate_limit($1, 'c1', 100000, 100000, 86400)`, [KEY], /does not exist/));
  check("named 인자로 한도 지정 → 함수 없음",
    await failsWith(U.subscriber, `select public.consume_ai_rate_limit(p_server_key => $1, p_creator_id => 'c1', p_per_creator => 999)`, [KEY], /does not exist/));
  check("정책 테이블 읽기 → permission denied", await failsWith(U.subscriber, `select * from private.ai_settings`, [], /permission denied/));
  check("정책 테이블 수정(한도 올리기) → permission denied",
    await failsWith(U.subscriber, `update private.ai_settings set rate_per_creator = 100000`, [], /permission denied/));
  check("한도 카운터 초기화(삭제) → permission denied", await failsWith(U.subscriber, `delete from private.ai_rate_limits`, [], /permission denied/));
  const r = (await as(U.follower, rl, [KEY, "c9"])).rows[0].r;
  check("공격 후에도 한도는 서버 설정값 그대로 (3 / 5)", r.allowed === true && r.remaining === 2, r);
  const cfg = (await db.query(`select rate_per_creator, rate_per_user, rate_window_sec from private.ai_settings`)).rows[0];
  check("정책 값 변경 없음", cfg.rate_per_creator === 3 && cfg.rate_per_user === 5 && cfg.rate_window_sec === 600, cfg);
  const defaults = Object.fromEntries(
    (await db.query(`select column_name, column_default from information_schema.columns where table_schema = 'private' and table_name = 'ai_settings'`)).rows.map((r) => [r.column_name, r.column_default]),
  );
  check("migration 기본 정책: 20 / 60 / 600초", defaults.rate_per_creator === "20" && defaults.rate_per_user === "60" && defaults.rate_window_sec === "600", defaults);
  await db.exec(`update private.ai_settings set rate_per_creator = 20, rate_per_user = 60, rate_window_sec = 600`);
}

/* ======================= v0.6 Fan Memory ======================= */
console.log("\nv0.6 · Fan Memory 설정 (팬 본인만)");
{
  const setSql = `insert into public.fan_ai_settings (fan_id, memory_enabled) values ($1, $2)`;
  check("다른 팬의 설정 행 생성 → RLS 거부", await failsWith(U.premium, setSql, [U.subscriber, true], /row-level security/));
  check("비로그인 설정 조회 → 거부", await fails(null, `select * from public.fan_ai_settings`));
  check("본인 설정 생성 (OFF로 시작)", !(await fails(U.subscriber, setSql, [U.subscriber, false])));
  check("다른 팬은 내 설정을 읽을 수 없음", (await count(U.premium, `select * from public.fan_ai_settings`)) === 0);
  check("크리에이터도 팬 설정을 읽을 수 없음", (await count(U.creatorA, `select * from public.fan_ai_settings`)) === 0);
  check("다른 팬이 내 설정 켜기 → 0행", (await as(U.premium, `update public.fan_ai_settings set memory_enabled = true where fan_id = $1 returning 1`, [U.subscriber])).rows.length === 0);
  check("fan_id 바꾸기 → 거부 (컬럼 권한)", await fails(U.subscriber, `update public.fan_ai_settings set fan_id = $1`, [U.premium]));
  const d = (await db.query(`select column_default from information_schema.columns where table_schema = 'public' and table_name = 'fan_ai_settings' and column_name = 'memory_enabled'`)).rows[0];
  check("기본값 OFF (팬이 켜야 기억)", d?.column_default === "false", JSON.stringify(d));
}

console.log("\nv0.6 · Fan Memory 저장 (record_fan_memories만)");
const recMem = `select public.record_fan_memories($1, $2, $3::jsonb, $4::uuid) as r`;
const ctxMem = `select public.ai_fan_memory_context($1, $2, $3::text[], $4) as r`;
const memItems = (...xs) => JSON.stringify(xs.map(([category, content]) => ({ category, content })));
{
  check("팬이 fan_memories 직접 insert → permission denied",
    await failsWith(U.subscriber, `insert into public.fan_memories (fan_id, creator_id, category, content) values ($1, 'c1', 'favorite', '초밥')`, [U.subscriber], /permission denied/));
  check("서버 키 없이 저장 → server_key_required", await failsWith(U.subscriber, recMem, [null, "c1", memItems(["favorite", "초밥"]), null], /server_key_required/));
  check("무료 팔로워 저장 → subscription_required", await failsWith(U.follower, recMem, [KEY, "c1", memItems(["favorite", "초밥"]), null], /subscription_required/));
  check("크리에이터 본인 채널 → own_channel", await failsWith(U.creatorA, recMem, [KEY, "c1", memItems(["favorite", "초밥"]), null], /own_channel/));
  check("비로그인 → 실행 권한 없음", await failsWith(null, recMem, [KEY, "c1", memItems(["favorite", "초밥"]), null], /permission denied/));

  // F(저장). Memory OFF → 새로 기억하지 않음
  const off = (await as(U.subscriber, recMem, [KEY, "c1", memItems(["favorite", "초밥 좋아함"]), null])).rows[0].r;
  check("F. Memory OFF → 저장하지 않음 (saved 0)", off.enabled === false && off.saved === 0 && (await db.query(`select 1 from public.fan_memories`)).rows.length === 0, JSON.stringify(off));

  await as(U.subscriber, `update public.fan_ai_settings set memory_enabled = true where fan_id = $1`, [U.subscriber]);
  const fanMsg = (await db.query(
    `select m.id from public.ai_messages m join public.ai_conversations c on c.id = m.conversation_id where c.fan_id = $1 and c.creator_id = 'c1' and m.sender = 'fan' limit 1`, [U.subscriber])).rows[0].id;
  const on = (await as(U.subscriber, recMem, [KEY, "c1", memItems(["nickname", "민지라고 불러줘"], ["schedule", "10월에 오사카 여행 예정"], ["favorite", "초밥을 좋아함"]), fanMsg])).rows[0].r;
  check("Memory ON → 3개 저장", on.enabled === true && on.saved === 3, JSON.stringify(on));
  const dup = (await as(U.subscriber, recMem, [KEY, "c1", memItems(["favorite", "  초밥을   좋아함 "]), null])).rows[0].r;
  check("같은 내용(앞뒤 · 중복 공백 차이)은 중복 저장하지 않음", dup.saved === 0 && dup.skippedDuplicate === 1, JSON.stringify(dup));

  check("항목 4개 → 거부", await failsWith(U.subscriber, recMem, [KEY, "c1", memItems(["other", "a"], ["other", "b"], ["other", "c"], ["other", "d"]), null], /invalid memory items/));
  check("J. 정의 밖 category(creator_fact) → 거부", await failsWith(U.subscriber, recMem, [KEY, "c1", memItems(["creator_fact", "하늘은 초밥을 좋아함"]), null], /invalid memory items/));
  check("201자 → 거부", await failsWith(U.subscriber, recMem, [KEY, "c1", memItems(["other", "가".repeat(201)]), null], /invalid memory items/));
  check("배열이 아닌 값 → 거부", await failsWith(U.subscriber, recMem, [KEY, "c1", JSON.stringify({ category: "other", content: "x" }), null], /invalid memory items/));
  check("K. 다른 팬(Premium)이 남의 메시지를 근거로 → 거부",
    await failsWith(U.premium, recMem, [KEY, "c1", memItems(["other", "산책을 좋아함"]), fanMsg], /invalid source message/));
}

console.log("\nv0.6 · H. 민감정보는 자동 저장하지 않음");
{
  const sensitive = [
    ["other", "요즘 우울증 때문에 정신과 다녀"], ["other", "당뇨가 있어서 약을 먹어"], ["other", "성생활 고민이 있어"],
    ["other", "우리 집 주소는 마포구 월드컵로 123"], ["other", "101동 1203호 살아"], ["other", "카드 번호 1234-5678"],
    ["other", "비밀번호는 hunter2야"], ["other", "주민번호 900101-1234567"], ["other", "나는 민주당 지지해"],
    ["other", "매주 교회 예배 가"], ["other", "전과가 있어"], ["other", "연봉이 4천이야"], ["other", "내 번호 010-1234-5678"],
  ];
  let stored = 0;
  let skipped = 0;
  for (let i = 0; i < sensitive.length; i += 3) {
    const r = (await as(U.subscriber, recMem, [KEY, "c1", memItems(...sensitive.slice(i, i + 3)), null])).rows[0].r;
    stored += r.saved;
    skipped += r.skippedSensitive;
  }
  check(`민감정보 ${sensitive.length}종 → 전부 건너뜀 (저장 0)`, stored === 0 && skipped === sensitive.length, JSON.stringify({ stored, skipped }));
  const safe = (await as(U.subscriber, recMem, [KEY, "c1", memItems(["interest", "게이머라서 주말엔 게임해"], ["favorite", "고소한 라떼를 좋아함"]), null])).rows[0].r;
  check("비슷해 보이는 일상 표현(게이머 · 고소한)은 저장", safe.saved === 2, JSON.stringify(safe));
  // 함수를 거치지 않는 경로도 테이블 제약이 막는다 (superuser 직접 insert)
  let blocked = false;
  try {
    await db.query(`insert into public.fan_memories (fan_id, creator_id, category, content) values ($1, 'c1', 'other', '공황장애가 있어')`, [U.subscriber]);
  } catch {
    blocked = true;
  }
  check("테이블 제약: 민감정보 직접 insert → 거부", blocked);
}

console.log("\nv0.6 · Fan Memory 조회 · 격리");
{
  check("팬 본인은 자기 Memory를 읽음 (5개)", (await count(U.subscriber, `select * from public.fan_memories`)) === 5);
  check("A. 다른 팬은 0개", (await count(U.premium, `select * from public.fan_memories`)) === 0);
  check("D. 크리에이터(c1 본인)도 팬 Memory 원문을 읽을 수 없음", (await count(U.creatorA, `select * from public.fan_memories`)) === 0);
  check("비로그인 조회 → 거부", await fails(null, `select * from public.fan_memories`));
  const one = (await db.query(`select id from public.fan_memories where content = '초밥을 좋아함'`)).rows[0].id;
  check("B. 다른 팬이 수정 → permission denied", await failsWith(U.premium, `update public.fan_memories set content = 'x' where id = $1`, [one], /permission denied/));
  check("B. 본인도 직접 수정 불가 (저장은 서버 함수만)", await failsWith(U.subscriber, `update public.fan_memories set content = '크리에이터는 초밥을 좋아함' where id = $1`, [one], /permission denied/));
  check("C. 다른 팬이 삭제 → 0행", (await as(U.premium, `delete from public.fan_memories where id = $1 returning 1`, [one])).rows.length === 0);
  check("C. 크리에이터가 삭제 → 0행", (await as(U.creatorA, `delete from public.fan_memories returning 1`)).rows.length === 0);
  check("D. 크리에이터는 Memory Context 함수도 못 씀 (own_channel)", await failsWith(U.creatorA, ctxMem, [KEY, "c1", [], 6], /own_channel/));
  check("다른 팬(Premium)의 Context에는 내 Memory 없음", ((await as(U.premium, ctxMem, [KEY, "c1", ["초밥"], 8])).rows[0].r.items ?? []).length === 0);
}

console.log("\nv0.6 · ai_fan_memory_context");
{
  check("서버 키 없이 → server_key_required", await failsWith(U.subscriber, ctxMem, [null, "c1", [], 6], /server_key_required/));
  check("무료 팔로워 → subscription_required", await failsWith(U.follower, ctxMem, [KEY, "c1", [], 6], /subscription_required/));
  const r = (await as(U.subscriber, ctxMem, [KEY, "c1", ["오사카", "여행"], 2])).rows[0].r;
  check("관련 Memory(오사카)가 먼저 · 요청한 개수만", r.enabled && r.items.length === 2 && r.items[0].content === "10월에 오사카 여행 예정", JSON.stringify(r));
  check("항목에는 category · content만 (id · 시각 · 근거 메시지 없음)", Object.keys(r.items[0]).sort().join() === "category,content");
  const all = (await as(U.subscriber, ctxMem, [KEY, "c1", [], 1000])).rows[0].r;
  check("I. p_limit 1000 → 최대 8개로 제한 (현재 5개 전부)", all.items.length === 5, String(all.items.length));
  const many = [];
  for (let i = 0; i < 12; i++) many.push(["other", `취미 메모 ${i}`]);
  for (let i = 0; i < many.length; i += 3) await as(U.subscriber, recMem, [KEY, "c1", memItems(...many.slice(i, i + 3)), null]);
  const capped = (await as(U.subscriber, ctxMem, [KEY, "c1", [], 1000])).rows[0].r;
  check("I. Memory 17개여도 Context는 최대 8개 (전체 dump 불가)", capped.items.length === 8, String(capped.items.length));
  const pinned = (await as(U.subscriber, ctxMem, [KEY, "c1", [], 3])).rows[0].r;
  check("관련 검색어가 없으면 호칭이 먼저", pinned.items[0].category === "nickname", JSON.stringify(pinned.items));
  const junk = (await as(U.subscriber, ctxMem, [KEY, "c1", Array(500).fill("x".repeat(500)), 6])).rows[0].r;
  check("I. 검색어 500개 · 긴 검색어 → 무시하고 정상 동작", junk.enabled && junk.items.length === 6);
  await db.exec(`delete from public.fan_memories where content like '취미 메모 %'`);

  // E. 다른 크리에이터 AI
  await db.exec(`insert into public.creator_personas (creator_id) values ('c2')`);
  await db.query(`insert into public.subscriptions (fan_id, creator_id, tier) values ($1, 'c2', 'subscriber') on conflict (fan_id, creator_id) do update set tier = 'subscriber'`, [U.subscriber]);
  const c2 = (await as(U.subscriber, ctxMem, [KEY, "c2", ["오사카", "초밥"], 8])).rows[0].r;
  check("E. 다른 크리에이터(c2) AI Context에는 c1 Memory 없음", c2.enabled === true && c2.items.length === 0, JSON.stringify(c2));
  await as(U.subscriber, recMem, [KEY, "c2", memItems(["favorite", "c2 전용 메모"]), null]);
  const c1 = (await as(U.subscriber, ctxMem, [KEY, "c1", ["c2"], 8])).rows[0].r;
  check("E. c2에서 생긴 Memory는 c1 AI Context에 없음", !c1.items.some((i) => i.content === "c2 전용 메모"), JSON.stringify(c1.items));

  // G. 삭제된 Memory
  check("팬 본인 개별 삭제 → 1행", (await as(U.subscriber, `delete from public.fan_memories where content = '10월에 오사카 여행 예정' returning 1`)).rows.length === 1);
  const afterDel = (await as(U.subscriber, ctxMem, [KEY, "c1", ["오사카"], 8])).rows[0].r;
  check("G. 삭제한 Memory는 Context에 다시 나오지 않음", !afterDel.items.some((i) => i.content.includes("오사카")), JSON.stringify(afterDel.items));

  // F. OFF → Context에 쓰지 않음 · 기존 Memory는 남아 있음
  await as(U.subscriber, `update public.fan_ai_settings set memory_enabled = false where fan_id = $1`, [U.subscriber]);
  const offCtx = (await as(U.subscriber, ctxMem, [KEY, "c1", ["초밥"], 8])).rows[0].r;
  check("F. Memory OFF → Context 비어 있음", offCtx.enabled === false && offCtx.items.length === 0, JSON.stringify(offCtx));
  check("F. OFF여도 기존 Memory는 자동 삭제되지 않음 (팬이 볼 수 있음)", (await count(U.subscriber, `select * from public.fan_memories`)) > 0);
  await as(U.subscriber, `update public.fan_ai_settings set memory_enabled = true where fan_id = $1`, [U.subscriber]);

  // K. Conversation과 Memory는 서로 다른 권한 · 수명
  check("K. 크리에이터 본인은 여전히 팬 AI 대화 원문을 읽을 수 없음", (await count(U.creatorA, `select * from public.ai_messages`)) === 0);
  const before = Number((await db.query(`select count(*)::int as n from public.fan_memories where fan_id = $1 and creator_id = 'c1'`, [U.subscriber])).rows[0].n);
  const convDel = (await as(U.subscriber, `delete from public.ai_conversations where creator_id = 'c1' returning 1`)).rows.length;
  const after = Number((await db.query(`select count(*)::int as n from public.fan_memories where fan_id = $1 and creator_id = 'c1'`, [U.subscriber])).rows[0].n);
  const srcNull = (await db.query(`select bool_and(source_message_id is null) as ok from public.fan_memories where fan_id = $1`, [U.subscriber])).rows[0].ok;
  check("K. 대화를 지워도 Memory는 따로 남음 (근거 메시지 링크만 끊김)", convDel === 1 && before === after && after > 0 && srcNull === true, JSON.stringify({ convDel, before, after }));

  // 크리에이터별 · 전체 삭제
  check("크리에이터별 삭제 (c2)", (await as(U.subscriber, `delete from public.fan_memories where creator_id = 'c2' returning 1`)).rows.length === 1);
  check("전체 삭제", (await as(U.subscriber, `delete from public.fan_memories returning 1`)).rows.length === after && (await count(U.subscriber, `select * from public.fan_memories`)) === 0);

  // 50개 한도
  await db.exec(`insert into public.fan_memories (fan_id, creator_id, category, content) select '${U.subscriber}', 'c1', 'other', '메모 ' || g from generate_series(1, 49) g`);
  const lim = (await as(U.subscriber, recMem, [KEY, "c1", memItems(["other", "50번째"], ["other", "51번째"]), null])).rows[0].r;
  check("fan × creator 50개까지 (51번째 건너뜀)", lim.saved === 1 && lim.skippedLimit === 1, JSON.stringify(lim));
  await db.exec(`delete from public.fan_memories`);

  // L. 모든 경로가 authenticated 역할(팬 JWT) + 서버 키로 동작 — service role 불필요
  const grants = (await db.query(
    `select routine_name, grantee from information_schema.routine_privileges where routine_name in ('ai_fan_memory_context', 'record_fan_memories', 'fan_memory_sensitive') and grantee in ('anon', 'authenticated', 'PUBLIC')`)).rows;
  check("L. 함수 실행 권한: authenticated만 (anon · PUBLIC 없음 · 민감정보 판정 함수는 비공개)",
    grants.length === 2 && grants.every((g) => g.grantee === "authenticated" && g.routine_name !== "fan_memory_sensitive"), JSON.stringify(grants));
  check("L. 팬이 민감정보 판정 함수를 직접 호출 → permission denied", await failsWith(U.subscriber, `select public.fan_memory_sensitive('x')`, [], /permission denied/));
}

console.log("\nCascade");
await as(U.premium, react, [M.prem, U.premium]);
await as(U.creatorA, `delete from public.moments where id = $1`, [M.prem]);
check("Moment 삭제 시 반응도 삭제", (await db.query(`select 1 from public.moment_reactions where moment_id = $1`, [M.prem])).rows.length === 0);

console.log("\nservice_role (seed · 서버 전용)");
{
  const asService = async (sql) => {
    await db.exec("reset role; set role service_role");
    try {
      return await db.query(sql);
    } finally {
      await db.exec("reset role");
    }
  };
  let ok = true;
  try {
    await asService(`update public.profiles set nickname = nickname`);
    await asService(
      `insert into public.subscriptions (fan_id, creator_id, tier) values ('${U.follower}', 'c2', 'follow') on conflict (fan_id, creator_id) do nothing`,
    );
  } catch (e) {
    ok = false;
    console.log("   ", e.message);
  }
  check("service_role: profiles 수정 · subscriptions 생성 가능 (RLS 우회 + GRANT)", ok);
  let all = 0;
  try {
    all = (await asService(`select id from public.moments`)).rows.length;
  } catch (e) {
    console.log("   ", e.message);
  }
  check("service_role: 모든 Moment 조회", all >= 2);
}

console.log("\nseed 데이터 (Mock → 스키마 제약)");
{
  const { creators } = await import("../../src/lib/mock/creators.ts");
  const { buildPastMoments, buildMockDay } = await import("../../src/lib/mock/moments.ts");
  const { kstDate } = await import("../../src/lib/utils/format.ts");
  let ok = true;
  let n = 0;
  try {
    await db.exec("begin");
    await db.exec("delete from public.creators");
    for (const [i, c] of creators.entries()) {
      const uid = `20000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
      await db.query(`insert into auth.users (id) values ($1)`, [uid]);
      await db.query(
        `insert into public.creators (id, profile_id, name, handle, job, category, bio, tags, price_subscriber, price_premium)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [c.id, uid, c.name, c.handle, c.job, c.category, c.bio, c.tags, c.pricing.subscriber, c.pricing.premium],
      );
    }
    for (const m of [...buildPastMoments(), ...buildMockDay(kstDate(), "", Infinity)]) {
      await db.query(
        `insert into public.moments (creator_id, type, content, media_url, duration_sec, visibility, location, safe_share, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          m.creatorId,
          m.type,
          m.content,
          m.mediaUrl ?? null,
          m.durationSec ?? null,
          m.visibility === "subscribers" ? "subscriber" : m.visibility,
          m.location ?? null,
          m.safeShare ?? [],
          m.createdAt,
        ],
      );
      n++;
    }
  } catch (e) {
    ok = false;
    console.log("   ", e.message);
  } finally {
    await db.exec("rollback");
  }
  check(`크리에이터 ${creators.length}명 · Moment ${n}개가 제약 조건을 통과`, ok);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
