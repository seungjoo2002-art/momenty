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
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable
  as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema public, auth, storage to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant select, insert, delete on storage.objects to anon, authenticated;
-- Supabase 기본 권한: public 스키마의 새 테이블·view는 anon/authenticated에게 열려 있고 RLS가 막는다
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
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
  insert into public.moments (id, creator_id, type, content, media_url, visibility) values
    ('10000000-0000-0000-0000-000000000001', 'c1', 'text', '전체 공개', null, 'public'),
    ('10000000-0000-0000-0000-000000000002', 'c1', 'photo', '구독자 공개', 'c1/sub.jpg', 'subscriber'),
    ('10000000-0000-0000-0000-000000000003', 'c1', 'photo', 'Premium 공개', 'c1/premium.jpg', 'premium');
  insert into storage.objects (bucket_id, name) values ('moment-media', 'c1/sub.jpg'), ('moment-media', 'c1/premium.jpg');
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

console.log("\nCascade");
await as(U.premium, react, [M.prem, U.premium]);
await as(U.creatorA, `delete from public.moments where id = $1`, [M.prem]);
check("Moment 삭제 시 반응도 삭제", (await db.query(`select 1 from public.moment_reactions where moment_id = $1`, [M.prem])).rows.length === 0);

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
