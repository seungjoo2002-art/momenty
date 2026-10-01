/**
 * v0.8.5b hotfix — 구독 환영 메시지 출처(creator · default_ai · system) · QA 전용 임시 구독 (PGlite)
 *
 *   npm run test:db   (rls.test.mjs · v07 · v08 · v085 다음)
 *
 * 0. 백필 없음 — v0.8.5까지 적용 + 유료 구독자가 있는 상태에서 hotfix를 적용해도 환영 메시지가 새로 생기지 않는다
 * A. 우선순위: 크리에이터 문구 > 기본 AI(AI ON) > MOMENTY 안내(AI OFF · 끔) — 모두 정확히 1개
 * B. 중복 없음: 같은 등급 · 유료 ↔ 유료 · 해지 후 재구독 · 행 삭제 후 재생성 · 반복 update
 * C. 차단 · 무료 팔로우 · 위조 · 다른 팬 / 다른 크리에이터 읽기
 * D. set_welcome_mode
 * E. QA 임시 구독: QA 키 · 본인 JWT만 · 실제 subscriptions 행 · RLS 그대로 · 해제는 등급만
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { avatarReadySql } from "./support/avatarFixture.mjs";

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");
const HOTFIX = "20261002000000_v085b_welcome_source_qa_subscription.sql";
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
revoke execute on all functions in schema public from public;
alter default privileges in schema public revoke execute on functions from public;
`;

const db = new PGlite();
let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok || !detail ? "" : `  → ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}
async function as(uid, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  await db.exec(`set role ${uid ? "authenticated" : "anon"}`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}
async function failsWith(uid, sql, params, pattern) {
  try {
    await as(uid, sql, params);
    return false;
  } catch (e) {
    return pattern.test(String(e.message));
  }
}
const n = async (sql, params) => Number((await db.query(sql, params)).rows[0].n);
const welcomes = async (fan, cid) => (await db.query(`select source, message, tier from public.subscription_welcomes where fan_id = $1 and creator_id = $2`, [fan, cid])).rows;

const U = {
  ownerOn: "00000000-0000-0000-0000-00000000000a", // c_on: AI ON · 문구 없음
  ownerCustom: "00000000-0000-0000-0000-00000000000b", // c_custom: AI ON · 문구 있음
  ownerOff: "00000000-0000-0000-0000-00000000000c", // c_off: AI OFF · 문구 없음
  ownerOffCustom: "00000000-0000-0000-0000-00000000000d", // c_offc: AI OFF · 문구 있음
  ownerMuted: "00000000-0000-0000-0000-00000000000e", // c_mute: AI ON · 문구 있음 · welcome_mode off
  legacyPaid: "00000000-0000-0000-0000-000000000001", // hotfix 전부터 유료
  legacyPaid2: "00000000-0000-0000-0000-000000000002", // hotfix 전부터 유료 (환영 메시지 없이)
  fanA: "00000000-0000-0000-0000-0000000000a1",
  fanB: "00000000-0000-0000-0000-0000000000b1",
  fanC: "00000000-0000-0000-0000-0000000000c1",
  fanD: "00000000-0000-0000-0000-0000000000d1",
  fanE: "00000000-0000-0000-0000-0000000000e1",
  blocked1: "00000000-0000-0000-0000-0000000000f1",
  blocked2: "00000000-0000-0000-0000-0000000000f2",
  qa: "00000000-0000-0000-0000-0000000000f3",
  other: "00000000-0000-0000-0000-0000000000f4",
};
const CUSTOM = "레바 구독 고마워!! 자주 놀러 와 :)";
const DEFAULT_AI = "구독해 줘서 고마워! 앞으로 여기서 자주 이야기하자 😊";
const SYSTEM = "구독이 시작되었어요.";
const AI_KEY = "server-key-for-tests-0123456789abcdef-XYZ";
const QA_KEY = "qa-key-for-tests-0123456789abcdef-QQQQQQ";

/* ---------- v0.8.5까지 적용 + 기존 데이터 (hotfix 전) ---------- */
await db.exec(SUPABASE_STUB);
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
check("hotfix migration이 가장 마지막 파일", files[files.length - 1] === HOTFIX, files.slice(-2));
for (const f of files.filter((f) => f !== HOTFIX)) await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
for (const [name, id] of Object.entries(U)) await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${name}@test.dev`, { nickname: name }]);
await db.query(`insert into private.server_keys (id, key_hash) values ('ai', encode(sha256(convert_to($1, 'UTF8')), 'hex'))`, [AI_KEY]);
await db.exec(`
  insert into public.creators (id, profile_id, name, handle, category) values
    ('c_on', '${U.ownerOn}', '온', 'c.on', 'art'),
    ('c_custom', '${U.ownerCustom}', '레바', 'c.custom', 'art'),
    ('c_off', '${U.ownerOff}', '오프', 'c.off', 'art'),
    ('c_offc', '${U.ownerOffCustom}', '오프문구', 'c.offc', 'art'),
    ('c_mute', '${U.ownerMuted}', '뮤트', 'c.mute', 'art');
`);
for (const c of ["c_on", "c_custom", "c_mute"]) await db.exec(avatarReadySql(c));
await as(U.ownerCustom, `select public.save_welcome_message($1)`, [CUSTOM]);
await as(U.ownerOffCustom, `select public.save_welcome_message($1)`, ["오프 채널 환영!"]);
await as(U.ownerMuted, `select public.save_welcome_message($1)`, ["뮤트 문구"]);
// hotfix 전부터 유료 구독자: c_custom은 예전 trigger로 환영 메시지 1개, c_on은 (예전엔 문구가 없어) 0개
await db.query(`insert into public.subscriptions (fan_id, creator_id, tier) values ($1, 'c_custom', 'subscriber'), ($2, 'c_on', 'premium')`, [U.legacyPaid, U.legacyPaid2]);
const beforeRows = await n(`select count(*)::int as n from public.subscription_welcomes`);

/* ======================= 0. 백필 없음 ======================= */
console.log("\n0. hotfix 적용 — 백필 없음");
await db.exec(readFileSync(join(MIGRATIONS, HOTFIX), "utf8"));
await db.query(`insert into private.server_keys (id, key_hash) values ('qa', encode(sha256(convert_to($1, 'UTF8')), 'hex'))`, [QA_KEY]);
{
  const afterRows = await n(`select count(*)::int as n from public.subscription_welcomes`);
  check("적용 전 환영 메시지 1개 (예전 trigger · 크리에이터 문구)", beforeRows === 1, beforeRows);
  check("적용만으로 새 환영 메시지 없음 (기존 유료 구독자 백필 없음)", afterRows === beforeRows, { beforeRows, afterRows });
  check("기존 행의 source = 'creator'", (await welcomes(U.legacyPaid, "c_custom"))[0]?.source === "creator");
  check("문구 없이 유료였던 구독자 → 여전히 0개", (await welcomes(U.legacyPaid2, "c_on")).length === 0);
  await db.query(`update public.subscriptions set tier = 'subscriber' where fan_id = $1 and creator_id = 'c_on'`, [U.legacyPaid2]);
  check("기존 유료 구독자의 등급 변경(premium → subscriber) → 생성 없음", (await welcomes(U.legacyPaid2, "c_on")).length === 0);
  const mode = (await db.query(`select welcome_mode from public.creator_avatar_settings where creator_id = 'c_custom'`)).rows[0]?.welcome_mode;
  check("기존 설정 행의 welcome_mode 기본값 'auto' (크리에이터 문구 그대로 우선)", mode === "auto", mode);
}

/* ======================= A. 우선순위 ======================= */
console.log("\nA. 우선순위 (각각 정확히 1개)");
{
  await as(U.fanA, `insert into public.subscriptions (fan_id, creator_id, tier) values ($1, 'c_custom', 'follow')`, [U.fanA]);
  check("4) 무료 팔로우 → 환영 메시지 없음", (await welcomes(U.fanA, "c_custom")).length === 0);
  await db.query(`update public.subscriptions set tier = 'subscriber' where fan_id = $1 and creator_id = 'c_custom'`, [U.fanA]);
  let w = await welcomes(U.fanA, "c_custom");
  check("1) 문구 있음 + AI ON: follow → subscriber → 크리에이터 문구 1개 (기본 AI보다 우선)", w.length === 1 && w[0].source === "creator" && w[0].message === CUSTOM, w);

  await as(U.fanA, `insert into public.subscriptions (fan_id, creator_id, tier) values ($1, 'c_on', 'follow')`, [U.fanA]);
  await db.query(`update public.subscriptions set tier = 'subscriber' where fan_id = $1 and creator_id = 'c_on'`, [U.fanA]);
  w = await welcomes(U.fanA, "c_on");
  check("2) 문구 없음 + AI ON → 기본 AI 1개", w.length === 1 && w[0].source === "default_ai" && w[0].message === DEFAULT_AI, w);

  await as(U.fanA, `insert into public.subscriptions (fan_id, creator_id, tier) values ($1, 'c_off', 'follow')`, [U.fanA]);
  await db.query(`update public.subscriptions set tier = 'subscriber' where fan_id = $1 and creator_id = 'c_off'`, [U.fanA]);
  w = await welcomes(U.fanA, "c_off");
  check("3) 문구 없음 + AI OFF → MOMENTY 안내 1개 (AI · 크리에이터 아님)", w.length === 1 && w[0].source === "system" && w[0].message === SYSTEM, w);

  await db.query(`insert into public.subscriptions (fan_id, creator_id, tier) values ($1, 'c_offc', 'premium')`, [U.fanA]);
  w = await welcomes(U.fanA, "c_offc");
  check("문구 있음 + AI OFF → 크리에이터 문구 (AI 상태와 무관하게 최우선) · 처음부터 유료 insert도 1개", w.length === 1 && w[0].source === "creator" && w[0].tier === "premium", w);

  await as(U.ownerMuted, `select public.set_welcome_mode('off')`);
  await db.query(`insert into public.subscriptions (fan_id, creator_id, tier) values ($1, 'c_mute', 'subscriber')`, [U.fanA]);
  w = await welcomes(U.fanA, "c_mute");
  check("welcome_mode 'off' (문구 있음 · AI ON) → MOMENTY 안내만", w.length === 1 && w[0].source === "system", w);

  // AI 준비가 깨져 자동 OFF가 된 채널 (persona_enabled false) → system
  await db.query(`update public.creators set persona_enabled = false where id = 'c_on'`);
  await db.query(`insert into public.subscriptions (fan_id, creator_id, tier) values ($1, 'c_on', 'subscriber')`, [U.fanE]);
  w = await welcomes(U.fanE, "c_on");
  check("AI를 끈 뒤 새 구독 → 기본 AI가 아닌 MOMENTY 안내", w.length === 1 && w[0].source === "system", w);
  await db.query(`update public.creators set persona_enabled = true where id = 'c_on'`);
}

/* ======================= B. 중복 없음 ======================= */
console.log("\nB. 중복 없음");
{
  const cnt = () => n(`select count(*)::int as n from public.subscription_welcomes where fan_id = $1 and creator_id = 'c_custom'`, [U.fanA]);
  for (let i = 0; i < 3; i++) await db.query(`update public.subscriptions set tier = 'subscriber', renews_at = now() + make_interval(days => $2) where fan_id = $1 and creator_id = 'c_custom'`, [U.fanA, i + 1]);
  check("5 · 8) 같은 등급 update ×3 (갱신 · 새로고침에 해당) → 1개", (await cnt()) === 1);
  await db.query(`update public.subscriptions set tier = 'premium' where fan_id = $1 and creator_id = 'c_custom'`, [U.fanA]);
  check("6) subscriber → premium → 1개", (await cnt()) === 1);
  await db.query(`update public.subscriptions set tier = 'subscriber' where fan_id = $1 and creator_id = 'c_custom'`, [U.fanA]);
  check("7) premium → subscriber → 1개", (await cnt()) === 1);
  await db.query(`update public.subscriptions set tier = 'follow' where fan_id = $1 and creator_id = 'c_custom'`, [U.fanA]);
  await db.query(`update public.subscriptions set tier = 'premium' where fan_id = $1 and creator_id = 'c_custom'`, [U.fanA]);
  check("9) 해지(→ follow) 후 재구독 → 1개 (팬 × 크리에이터 평생 1회)", (await cnt()) === 1);
  await db.query(`delete from public.subscriptions where fan_id = $1 and creator_id = 'c_custom'`, [U.fanA]);
  await db.query(`insert into public.subscriptions (fan_id, creator_id, tier) values ($1, 'c_custom', 'subscriber')`, [U.fanA]);
  check("9) 행 삭제 후 다시 유료 insert → 1개", (await cnt()) === 1);
  check("처음 출처 · 문구 유지 (나중에 크리에이터가 문구를 바꿔도 다시 만들지 않음)", (await welcomes(U.fanA, "c_custom"))[0].source === "creator");
  check("unique (fan_id, creator_id) 유지", (await n(`select count(*)::int as n from pg_constraint where conrelid = 'public.subscription_welcomes'::regclass and contype = 'u'`)) === 1);
}

/* ======================= C. 차단 · 위조 · 읽기 ======================= */
console.log("\nC. 차단 · 위조 · 읽기");
{
  await as(U.blocked1, `insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [U.blocked1, U.ownerOn]);
  await db.query(`insert into public.subscriptions (fan_id, creator_id, tier) values ($1, 'c_on', 'subscriber')`, [U.blocked1]);
  check("10) 팬이 크리에이터 차단 → 없음 (기본 AI도)", (await welcomes(U.blocked1, "c_on")).length === 0);
  await as(U.ownerOff, `insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [U.ownerOff, U.blocked2]);
  await db.query(`insert into public.subscriptions (fan_id, creator_id, tier) values ($1, 'c_off', 'premium')`, [U.blocked2]);
  check("10) 크리에이터가 팬 차단 → 없음 (MOMENTY 안내도)", (await welcomes(U.blocked2, "c_off")).length === 0);
  check("12) 팬이 환영 메시지 위조 insert → permission denied",
    await failsWith(U.fanB, `insert into public.subscription_welcomes (fan_id, creator_id, tier, message, source) values ($1, 'c_on', 'premium', '가짜', 'creator')`, [U.fanB], /permission denied/));
  check("12) 팬이 자기 환영 메시지 source/내용 update → 거부",
    await failsWith(U.fanA, `update public.subscription_welcomes set source = 'creator', message = '조작' where fan_id = $1`, [U.fanA], /permission denied/));
  check("12) 크리에이터도 환영 메시지 직접 insert 불가",
    await failsWith(U.ownerOn, `insert into public.subscription_welcomes (fan_id, creator_id, tier, message) values ($1, 'c_on', 'subscriber', '본인')`, [U.fanB], /permission denied/));
  check("13) 다른 팬의 환영 메시지 0행", (await as(U.fanB, `select 1 from public.subscription_welcomes where fan_id = $1`, [U.fanA])).rows.length === 0);
  const ownRows = (await as(U.fanA, `select creator_id, source from public.subscription_welcomes`)).rows;
  check("팬 본인은 자기 것 전부 (출처 포함)", ownRows.length === 5 && ownRows.every((r) => r.source), ownRows);
  const cOn = (await as(U.ownerOn, `select creator_id from public.subscription_welcomes`)).rows;
  check("14) 크리에이터는 자기 채널 것만", cOn.length > 0 && cOn.every((r) => r.creator_id === "c_on"), cOn);
  check("14) 다른 크리에이터의 채널 환영 메시지 0행", (await as(U.ownerOn, `select 1 from public.subscription_welcomes where creator_id = 'c_custom'`)).rows.length === 0);
  let bad = false;
  try {
    await db.query(`insert into public.subscription_welcomes (fan_id, creator_id, tier, message, source) values ($1, 'c_custom', 'subscriber', 'x', 'creator_live')`, [U.fanE]);
  } catch (e) {
    bad = /subscription_welcomes_source_check/.test(String(e.message));
  }
  check("source에 정해진 값 외 → check 제약으로 거부 (superuser도)", bad);
}

/* ======================= D. set_welcome_mode ======================= */
console.log("\nD. set_welcome_mode");
{
  check("크리에이터가 아니면 거부", await failsWith(U.fanB, `select public.set_welcome_mode('off')`, [], /not_a_creator/));
  check("잘못된 값 거부", await failsWith(U.ownerOn, `select public.set_welcome_mode('loud')`, [], /invalid mode/));
  check("anon 실행 불가", await failsWith(null, `select public.set_welcome_mode('off')`, [], /permission denied/));
  check("welcome_mode 직접 update 불가 (함수로만)", await failsWith(U.ownerOn, `update public.creator_avatar_settings set welcome_mode = 'off' where creator_id = 'c_on'`, [], /permission denied/));
  await as(U.ownerOn, `select public.set_welcome_mode('off')`);
  await db.query(`insert into public.subscriptions (fan_id, creator_id, tier) values ($1, 'c_on', 'subscriber')`, [U.fanC]);
  check("끈 뒤 새 구독 → MOMENTY 안내", (await welcomes(U.fanC, "c_on"))[0]?.source === "system");
  await as(U.ownerOn, `select public.set_welcome_mode('auto')`);
  await db.query(`insert into public.subscriptions (fan_id, creator_id, tier) values ($1, 'c_on', 'subscriber')`, [U.fanD]);
  check("다시 켠 뒤 새 구독 → 기본 AI", (await welcomes(U.fanD, "c_on"))[0]?.source === "default_ai");
  check("모드는 본인 채널에만 (다른 채널 설정 그대로)", (await db.query(`select welcome_mode from public.creator_avatar_settings where creator_id = 'c_custom'`)).rows[0].welcome_mode === "auto");
}

/* ======================= E. QA 임시 구독 ======================= */
console.log("\nE. QA 전용 임시 구독");
{
  const qa = (uid, key, cid, tier) => as(uid, `select public.qa_set_my_subscription($1, $2, $3) as r`, [key, cid, tier]);
  const tierOf = async (fan, cid) => (await db.query(`select tier from public.subscriptions where fan_id = $1 and creator_id = $2`, [fan, cid])).rows[0]?.tier ?? null;
  check("QA 키 없음 → qa_disabled", await failsWith(U.qa, `select public.qa_set_my_subscription(null, 'c_custom', 'subscriber')`, [], /qa_disabled/));
  check("AI 서버 키로는 불가 → qa_disabled", await failsWith(U.qa, `select public.qa_set_my_subscription($1, 'c_custom', 'subscriber')`, [AI_KEY], /qa_disabled/));
  check("QA 키로 AI 서버 함수 불가 → server_key_required", await failsWith(U.qa, `select public.consume_ai_rate_limit($1, 'c_custom')`, [QA_KEY], /server_key_required/));
  check("anon → 실행 권한 없음", await failsWith(null, `select public.qa_set_my_subscription($1, 'c_custom', 'subscriber')`, [QA_KEY], /permission denied/));
  check("잘못된 등급 → invalid_tier", await failsWith(U.qa, `select public.qa_set_my_subscription($1, 'c_custom', 'vip')`, [QA_KEY], /invalid_tier/));
  check("없는 크리에이터 → creator_not_found", await failsWith(U.qa, `select public.qa_set_my_subscription($1, 'nope', 'subscriber')`, [QA_KEY], /creator_not_found/));
  check("자기 채널 → own_channel", await failsWith(U.ownerCustom, `select public.qa_set_my_subscription($1, 'c_custom', 'subscriber')`, [QA_KEY], /own_channel/));
  check("차단 관계 → blocked", await failsWith(U.blocked1, `select public.qa_set_my_subscription($1, 'c_on', 'premium')`, [QA_KEY], /blocked/));

  // 브라우저 경로(팬 JWT로 테이블 직접)는 여전히 막혀 있다
  await as(U.qa, `insert into public.subscriptions (fan_id, creator_id, tier) values ($1, 'c_custom', 'follow')`, [U.qa]);
  check("팬이 자기 행을 직접 update → 거부 (RLS · 권한 그대로)", await failsWith(U.qa, `update public.subscriptions set tier = 'premium' where fan_id = $1`, [U.qa], /permission denied/));
  check("팬이 유료 등급 직접 insert → 거부", await failsWith(U.qa, `insert into public.subscriptions (fan_id, creator_id, tier) values ($1, 'c_on', 'premium')`, [U.qa], /row-level security|permission denied/));

  const r = (await qa(U.qa, QA_KEY, "c_custom", "subscriber")).rows[0].r;
  check("QA 구독: follow → subscriber (실제 subscriptions 행)", r.tier === "subscriber" && (await tierOf(U.qa, "c_custom")) === "subscriber", r);
  let w = await welcomes(U.qa, "c_custom");
  check("QA 구독 → 운영 trigger 그대로 크리에이터 문구 환영 1개", w.length === 1 && w[0].source === "creator" && w[0].message === CUSTOM, w);
  check("다른 팬 행은 그대로 (본인 JWT만)", (await tierOf(U.other, "c_custom")) === null && (await tierOf(U.fanA, "c_custom")) === "subscriber");
  const subCount = (await db.query(`select subscriber_count from public.creators where id = 'c_custom'`)).rows[0].subscriber_count;
  check("구독자 수 캐시도 운영 trigger로 반영", subCount >= 2, subCount);
  check("QA 구독 후 Persona AI 권한: subscription_required 아님 (안내 확인만 남음)",
    await failsWith(U.qa, `select public.ai_persona_context($1, 'c_custom')`, [AI_KEY], /ai_notice_required/));
  await as(U.qa, `select public.acknowledge_ai_notice('c_custom')`);
  check("안내 확인 후 → ai_persona_context 통과 (운영 함수 그대로)", (await as(U.qa, `select public.ai_persona_context($1, 'c_custom') is not null as r`, [AI_KEY])).rows[0].r === true);
  await db.query(`insert into public.moments (creator_id, type, content, visibility) values ('c_custom', 'text', 'premium 비밀', 'premium')`);
  check("subscriber는 Premium Moment 못 봄", (await as(U.qa, `select 1 from public.moments where creator_id = 'c_custom' and visibility = 'premium'`)).rows.length === 0);

  await qa(U.qa, QA_KEY, "c_custom", "premium");
  check("QA Premium: subscriber → premium", (await tierOf(U.qa, "c_custom")) === "premium");
  check("Premium → Premium Moment 보임 (운영 RLS 그대로)", (await as(U.qa, `select 1 from public.moments where creator_id = 'c_custom' and visibility = 'premium'`)).rows.length === 1);
  check("subscriber → premium → 환영 메시지 추가 없음", (await welcomes(U.qa, "c_custom")).length === 1);
  await qa(U.qa, QA_KEY, "c_custom", "premium");
  check("같은 등급 다시 요청 → 변화 없음 · 추가 없음", (await welcomes(U.qa, "c_custom")).length === 1);

  await as(U.qa, `select public.record_ai_exchange($1, 'c_custom', '안녕', '안녕! 반가워', '{}', '{}', null, null, null)`, [AI_KEY]);
  await qa(U.qa, QA_KEY, "c_custom", "follow");
  check("QA 해제: premium → follow (행은 남음 · 삭제 아님)", (await tierOf(U.qa, "c_custom")) === "follow");
  check("해제해도 대화 · 환영 메시지 · 안내 확인 그대로",
    (await n(`select count(*)::int as n from public.ai_messages m join public.ai_conversations c on c.id = m.conversation_id where c.fan_id = $1`, [U.qa])) === 2 &&
      (await welcomes(U.qa, "c_custom")).length === 1 &&
      (await n(`select count(*)::int as n from public.ai_creator_view_consents where fan_id = $1`, [U.qa])) === 1);
  check("해제 후 AI 권한 → subscription_required (운영 함수 그대로)", await failsWith(U.qa, `select public.ai_persona_context($1, 'c_custom')`, [AI_KEY], /subscription_required/));
  check("해제 후 Premium Moment 안 보임", (await as(U.qa, `select 1 from public.moments where creator_id = 'c_custom' and visibility = 'premium'`)).rows.length === 0);
  await qa(U.qa, QA_KEY, "c_custom", "subscriber");
  check("다시 QA 구독 → 환영 메시지 중복 없음", (await welcomes(U.qa, "c_custom")).length === 1);
  await qa(U.other, QA_KEY, "c_off", "premium");
  w = await welcomes(U.other, "c_off");
  check("팔로우 없이 바로 QA Premium → 행 생성 + MOMENTY 안내 1개 (AI OFF 채널)", (await tierOf(U.other, "c_off")) === "premium" && w.length === 1 && w[0].source === "system", w);
  check("QA 함수 시그니처에 fan id 입력 없음", (await db.query(`select pg_get_function_identity_arguments('public.qa_set_my_subscription(text,text,text)'::regprocedure) as a`)).rows[0].a === "p_server_key text, p_creator_id text, p_tier text");
}

/* ======================= 권한 요약 ======================= */
console.log("\n권한");
{
  const ex = (await db.query(`
    select routine_name, grantee from information_schema.routine_privileges
    where routine_schema in ('public', 'private') and routine_name in ('set_welcome_mode', 'qa_set_my_subscription', 'qa_key_ok', 'subscriptions_welcome') and grantee in ('anon', 'authenticated', 'PUBLIC')`)).rows;
  const g = (r, who) => ex.some((x) => x.routine_name === r && x.grantee === who);
  check("anon · PUBLIC에 실행 권한 없음", !ex.some((x) => x.grantee === "anon" || x.grantee === "PUBLIC"), ex);
  check("private 함수(qa_key_ok · subscriptions_welcome)는 authenticated도 없음", !g("qa_key_ok", "authenticated") && !g("subscriptions_welcome", "authenticated"));
  const tp = (await db.query(`
    select table_name, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated' and table_name in ('subscription_welcomes', 'creator_avatar_settings', 'subscriptions')`)).rows;
  const has = (t, p) => tp.some((x) => x.table_name === t && x.privilege_type === p);
  check("subscription_welcomes · creator_avatar_settings: authenticated는 select만", !has("subscription_welcomes", "INSERT") && !has("subscription_welcomes", "UPDATE") && !has("creator_avatar_settings", "UPDATE") && !has("creator_avatar_settings", "INSERT"), tp);
  check("subscriptions: authenticated에 UPDATE 권한 없음 (컬럼 포함)", !has("subscriptions", "UPDATE") && (await n(`select count(*)::int as n from information_schema.column_privileges where table_schema = 'public' and table_name = 'subscriptions' and grantee = 'authenticated' and privilege_type = 'UPDATE'`)) === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
