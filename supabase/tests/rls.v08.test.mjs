/**
 * v0.8 SafeShare · Safety / Privacy — RLS · Storage · 공격 테스트 (PGlite에 전체 migration 적용)
 *
 *   npm run test:db   (rls.test.mjs · rls.v07.test.mjs 다음)
 *
 * DB에서 강제되는 항목: Safe Delay(C~K · F) · Moderation(L~O) · Mass-DM(P · Q) · 계정 삭제(R · S · T) · 차단(U · V) ·
 * 기존 AI 대화 · Fan Memory · 크리에이터 메모 privacy(X · Y · Z).
 * A(EXIF) · B(파일 이름) · W(OCR 원문 로그)는 브라우저 쪽 — safeshare.unit.test.mts.
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
async function fails(uid, sql, params = []) {
  try {
    await as(uid, sql, params);
    return false;
  } catch {
    return true;
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
const count = async (uid, sql, params) => (await as(uid, sql, params)).rows.length;
const one = async (uid, sql, params) => (await as(uid, sql, params)).rows[0]?.r;
const n = async (sql, params) => Number((await db.query(sql, params)).rows[0].n);

await db.exec(SUPABASE_STUB);
for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
console.log("migrations applied (v0.1 ~ v0.8)");

const U = {
  creatorA: "00000000-0000-0000-0000-00000000000a",
  creatorB: "00000000-0000-0000-0000-00000000000b",
  sub: "00000000-0000-0000-0000-000000000001",
  premium: "00000000-0000-0000-0000-000000000002",
  follower: "00000000-0000-0000-0000-000000000003",
  admin: "00000000-0000-0000-0000-0000000000ad",
  fan4: "00000000-0000-0000-0000-000000000004",
  fan5: "00000000-0000-0000-0000-000000000005",
};
for (const [name, id] of Object.entries(U)) await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${name}@test.dev`, { nickname: name }]);
const KEY = "server-key-for-tests-0123456789abcdef-XYZ";
await db.query(`insert into private.server_keys (id, key_hash) values ('ai', encode(sha256(convert_to($1, 'UTF8')), 'hex'))`, [KEY]);
await db.exec(`
  insert into public.creators (id, profile_id, name, handle, category) values
    ('c1', '${U.creatorA}', '지훈', 'jihoon', 'sports'),
    ('c2', '${U.creatorB}', '도현', 'dohyun', 'music');
  insert into public.creator_personas (creator_id) values ('c1'), ('c2');
  insert into public.subscriptions (fan_id, creator_id, tier) values
    ('${U.sub}', 'c1', 'subscriber'), ('${U.premium}', 'c1', 'premium'), ('${U.follower}', 'c1', 'follow'),
    ('${U.fan4}', 'c1', 'subscriber'), ('${U.fan5}', 'c1', 'subscriber'),
    ('${U.sub}', 'c2', 'subscriber');
  insert into private.admin_users (user_id) values ('${U.admin}');
`);
const insMoment = `insert into public.moments (creator_id, type, content, visibility, media_url) values ($1, $2, $3, $4, $5) returning id, created_at, visible_at`;
const mediaObj = async (path) => db.query(`insert into storage.objects (bucket_id, name) values ('moment-media', $1)`, [path]);

console.log("\nSafe Delay — 기본 OFF");
{
  const r = (await as(U.creatorA, insMoment, ["c1", "text", "바로 공개", "public", null])).rows[0];
  check("설정 없음 → 바로 공개 (visible_at = created_at)", new Date(r.visible_at).getTime() === new Date(r.created_at).getTime(), r);
  check("팬에게 바로 보임", (await count(U.sub, `select id from public.moments where id = $1`, [r.id])) === 1);
}

console.log("\nSafe Delay — 설정은 크리에이터 본인만");
{
  const ins = `insert into public.creator_safety_settings (creator_id, safe_delay_mode, safe_delay_minutes) values ($1, $2, $3)`;
  check("다른 크리에이터가 c1 설정 → RLS 거부", await failsWith(U.creatorB, ins, ["c1", "fixed", 30], /row-level security/));
  check("팬이 c1 설정 → RLS 거부", await failsWith(U.sub, ins, ["c1", "off", 30], /row-level security/));
  check("정의 밖 지연 시간(7분) → 거부", await fails(U.creatorA, ins, ["c1", "fixed", 7]));
  check("본인 설정: fixed 30분", !(await fails(U.creatorA, ins, ["c1", "fixed", 30])));
  check("팬 · 다른 크리에이터는 설정을 읽을 수 없음 (지연 여부 · 시간 비공개)",
    (await count(U.sub, `select * from public.creator_safety_settings`)) === 0 && (await count(U.creatorB, `select * from public.creator_safety_settings`)) === 0);
}

console.log("\nC · D · E · I · J — 공개 예정 Moment");
let scheduled;
{
  await mediaObj("c1/scheduled.jpg");
  scheduled = (await as(U.creatorA, insMoment, ["c1", "photo", "공개 예정 사진", "public", "c1/scheduled.jpg"])).rows[0];
  const delay = (new Date(scheduled.visible_at) - new Date(scheduled.created_at)) / 60000;
  check("fixed 30분 → visible_at = created_at + 30분 (서버 계산)", Math.abs(delay - 30) < 0.02, delay);
  check("C. 구독자 · Premium · 비로그인: moments 행 0 (존재도 모름)",
    (await count(U.sub, `select id from public.moments where id = $1`, [scheduled.id])) === 0 &&
      (await count(U.premium, `select id from public.moments where id = $1`, [scheduled.id])) === 0 &&
      (await count(null, `select id from public.moments where id = $1`, [scheduled.id])) === 0);
  check("C. moment_feed에도 행 없음 (잠긴 Moment처럼 존재가 드러나지 않음)",
    (await count(U.sub, `select id from public.moment_feed where id = $1`, [scheduled.id])) === 0 &&
      (await count(null, `select id from public.moment_feed where creator_id = 'c1' and created_at >= $1`, [scheduled.created_at])) === 0);
  check("크리에이터 본인은 봄 (feed의 visible_at도 본인에게만)",
    (await count(U.creatorA, `select id from public.moments where id = $1`, [scheduled.id])) === 1 &&
      !!(await as(U.creatorA, `select visible_at from public.moment_feed where id = $1`, [scheduled.id])).rows[0]?.visible_at);
  check("D · E. 공개 예정 미디어: 팬 · 비로그인 Storage 조회(= signed URL 발급 권한) 0행",
    (await count(U.sub, `select name from storage.objects where name = 'c1/scheduled.jpg'`)) === 0 && (await count(null, `select name from storage.objects where name = 'c1/scheduled.jpg'`)) === 0);
  check("D. 크리에이터 본인은 자기 파일을 봄", (await count(U.creatorA, `select name from storage.objects where name = 'c1/scheduled.jpg'`)) === 1);
  check("반응 · 보관함: 공개 예정 Moment에는 불가",
    (await failsWith(U.sub, `insert into public.moment_reactions (moment_id, user_id, kind) values ($1, $2, 'love')`, [scheduled.id, U.sub], /row-level security/)) &&
      (await failsWith(U.sub, `insert into public.moment_bookmarks (user_id, moment_id) values ($1, $2)`, [U.sub, scheduled.id], /row-level security/)));
  check("I. 클라이언트가 visible_at 지정 → 거부 (컬럼 권한)", await failsWith(U.creatorA, `insert into public.moments (creator_id, type, content, visible_at) values ('c1', 'text', 'x', now())`, [], /permission denied/));
  check("I. visible_at 수정 → 거부", await failsWith(U.creatorA, `update public.moments set visible_at = now() where id = $1`, [scheduled.id], /permission denied/));
  check("J. created_at 지정 · 수정 → 거부",
    (await failsWith(U.creatorA, `insert into public.moments (creator_id, type, content, created_at) values ('c1', 'text', 'x', now() - interval '1 day')`, [], /permission denied/)) &&
      (await failsWith(U.creatorA, `update public.moments set created_at = now() - interval '1 day' where id = $1`, [scheduled.id], /permission denied/)));
}

console.log("\nF — Creator AI는 공개 전 Moment를 모른다");
{
  // Persona Context는 팬 세션으로 moments를 읽는다 (context.ts) — 같은 쿼리
  const ctx = (await as(U.sub, `select id from public.moments where creator_id = 'c1' and ai_context_enabled`)).rows.map((r) => r.id);
  check("F. 팬 세션의 AI Context 쿼리에 공개 예정 Moment 없음", !ctx.includes(scheduled.id));
  const rec = await one(U.sub, `select public.record_ai_exchange($1, 'c1', '질문', '답', $2::uuid[], '{"today"}') as r`, [KEY, [scheduled.id]]);
  check("F. 모델이 공개 예정 Moment id를 근거로 내도 저장 안 됨", rec.groundedMomentIds.length === 0, rec.groundedMomentIds);
  check("C(AI). 크리에이터는 자기 Creator AI와 대화 불가 (own_channel) → 본인이 보는 예정 Moment가 AI로 새지 않음",
    await failsWith(U.creatorA, `select public.ai_persona_context($1, 'c1')`, [KEY], /own_channel/));
}

console.log("\nK — Safe Delay 우회");
{
  check("K. 팬이 '지금 공개' 호출 → 거부", await failsWith(U.sub, `select public.publish_moment_now($1)`, [scheduled.id], /moment_not_scheduled/));
  check("K. 다른 크리에이터가 '지금 공개' → 거부", await failsWith(U.creatorB, `select public.publish_moment_now($1)`, [scheduled.id], /moment_not_scheduled/));
  check("K. 설정을 OFF로 바꿔도 이미 예약된 Moment는 그대로 예약",
    (await as(U.creatorA, `update public.creator_safety_settings set safe_delay_mode = 'off' where creator_id = 'c1' returning 1`)).rows.length === 1 &&
      (await count(U.sub, `select id from public.moments where id = $1`, [scheduled.id])) === 0);
  check("K. 공개 범위를 바꿔도 예약 유지", (await as(U.creatorA, `update public.moments set visibility = 'public' where id = $1 returning 1`, [scheduled.id])).rows.length === 1 && (await count(U.sub, `select id from public.moments where id = $1`, [scheduled.id])) === 0);
  const v = await one(U.creatorA, `select public.publish_moment_now($1) as r`, [scheduled.id]);
  check("크리에이터 본인 '지금 공개' → 바로 보임 · 미디어도 열림",
    !!v && (await count(U.sub, `select id from public.moment_feed where id = $1`, [scheduled.id])) === 1 && (await count(U.sub, `select name from storage.objects where name = 'c1/scheduled.jpg'`)) === 1);
  check("이미 공개된 Moment에 다시 → 거부 (늦추기 · 되돌리기 없음)", await failsWith(U.creatorA, `select public.publish_moment_now($1)`, [scheduled.id], /moment_not_scheduled/));
}

console.log("\n변동 지연 (variable)");
{
  await as(U.creatorA, `update public.creator_safety_settings set safe_delay_mode = 'variable', safe_delay_minutes = 30 where creator_id = 'c1'`);
  const deltas = [];
  for (let i = 0; i < 12; i++) {
    const r = (await as(U.creatorA, insMoment, ["c1", "text", `변동 ${i}`, "public", null])).rows[0];
    deltas.push((new Date(r.visible_at) - new Date(r.created_at)) / 60000);
  }
  check("30분 설정 → 15~45분 사이 · 매번 다름 (서버 random)", deltas.every((d) => d >= 14.99 && d <= 45.01) && new Set(deltas.map((d) => d.toFixed(1))).size > 3, deltas.map((d) => d.toFixed(1)));
  check("팬에게는 12개 모두 아직 안 보임", (await count(U.sub, `select id from public.moment_feed where content like '변동 %'`)) === 0);
  await as(U.creatorA, `update public.creator_safety_settings set safe_delay_mode = 'off' where creator_id = 'c1'`);
  await db.exec(`delete from public.moments where content like '변동 %'`);
}

console.log("\nG · H — 미디어 권한 (공개 범위 · 다른 크리에이터 · 경로 추측 · 삭제된 Moment)");
{
  await mediaObj("c1/premium.jpg");
  await as(U.creatorA, insMoment, ["c1", "photo", "Premium 사진", "premium", "c1/premium.jpg"]);
  await mediaObj("c2/b.jpg");
  const b = (await as(U.creatorB, insMoment, ["c2", "photo", "B 구독자 사진", "subscriber", "c2/b.jpg"])).rows[0];
  check("G. 구독자(subscriber)는 Premium 미디어 0행 · Premium은 봄",
    (await count(U.sub, `select 1 from storage.objects where name = 'c1/premium.jpg'`)) === 0 && (await count(U.premium, `select 1 from storage.objects where name = 'c1/premium.jpg'`)) === 1);
  check("H. 다른 크리에이터(B)는 c1 Premium 미디어 0행", (await count(U.creatorB, `select 1 from storage.objects where name = 'c1/premium.jpg'`)) === 0);
  check("H. c1 크리에이터는 c2 폴더(구독 안 함) 미디어 0행", (await count(U.creatorA, `select 1 from storage.objects where name = 'c2/b.jpg'`)) === 0);
  await mediaObj("c1/guess-orphan.jpg");
  check("경로 추측: Moment에 연결되지 않은 파일 → 팬 0행", (await count(U.premium, `select 1 from storage.objects where name = 'c1/guess-orphan.jpg'`)) === 0);
  check("다른 크리에이터 파일을 자기 공개 Moment에 걸기 → 거부 (v0.4 미디어 검증 유지)",
    await fails(U.creatorA, insMoment, ["c1", "photo", "훔친 파일", "public", "c2/b.jpg"]));
  await as(U.creatorB, `delete from public.moments where id = $1`, [b.id]);
  check("삭제된 Moment의 파일 → 구독자도 0행", (await count(U.sub, `select 1 from storage.objects where name = 'c2/b.jpg'`)) === 0);
}

console.log("\nL · M · N · O — 신고 · 운영");
let reportId;
{
  const conv = (await as(U.sub, `select public.send_message_to_creator('c1', '안녕하세요') as r`)).rows[0].r.conversationId;
  const cm = (await as(U.creatorA, `select public.send_message_to_fan($1, '불편한 메시지') as r`, [U.sub])).rows[0].r.messageId;
  reportId = (await one(U.sub, `select public.report_human_message($1, 'harassment', '불쾌해요') as r`, [cm])).reportId;
  check("신고 접수 (status open)", !!reportId && (await as(U.sub, `select status from public.message_reports`)).rows[0]?.status === "open");
  check("L. 일반 사용자 · 크리에이터의 신고 목록 → admin_required",
    (await failsWith(U.sub, `select public.admin_list_reports()`, [], /admin_required/)) && (await failsWith(U.creatorA, `select public.admin_list_reports()`, [], /admin_required/)));
  check("L. 비로그인 → 실행 권한 없음", await failsWith(null, `select public.admin_list_reports()`, [], /permission denied/));
  check("L. 일반 사용자 상태 변경 → admin_required", await failsWith(U.sub, `select public.admin_update_report($1, 'dismissed')`, [reportId], /admin_required/));
  check("M. admin 목록에 자기 추가 → permission denied", await failsWith(U.sub, `insert into private.admin_users (user_id) values ($1)`, [U.sub], /permission denied/));
  check("M. is_admin(): 일반 사용자 false · admin true", (await one(U.sub, `select public.is_admin() as r`)) === false && (await one(U.admin, `select public.is_admin() as r`)) === true);
  check("M. 신고 상태 직접 수정 → permission denied", await failsWith(U.sub, `update public.message_reports set status = 'resolved'`, [], /permission denied/));
  check("N. 신고 테이블: 크리에이터(신고 대상) 0행 · 다른 팬 0행", (await count(U.creatorA, `select id from public.message_reports`)) === 0 && (await count(U.premium, `select id from public.message_reports`)) === 0);
  check("O. 신고자 · 원문은 신고자 본인에게도 컬럼 거부, 대상에게는 행 자체 없음",
    await failsWith(U.sub, `select reporter_id, message_snapshot from public.message_reports`, [], /permission denied/));
  const list = await one(U.admin, `select public.admin_list_reports('open') as r`);
  const item = list.items.find((i) => i.id === reportId);
  check("admin: 신고 목록 (신고자 · 대상 · 원문 · 사유)", item?.reporter?.id === U.sub && item.reportedUser?.id === U.creatorA && item.messageSnapshot === "불편한 메시지" && item.reason === "harassment", item);
  const upd = await one(U.admin, `select public.admin_update_report($1, 'reviewing', '확인 중') as r`, [reportId]);
  check("admin: open → reviewing", upd.status === "reviewing");
  await as(U.admin, `select public.admin_update_report($1, 'resolved', '경고 조치')`, [reportId]);
  check("신고자는 자기 신고 상태만 봄 (resolved)", (await as(U.sub, `select status from public.message_reports where id = $1`, [reportId])).rows[0]?.status === "resolved");
  check("admin: 정의 밖 상태 · 없는 신고 → 거부",
    (await failsWith(U.admin, `select public.admin_update_report($1, 'deleted')`, [reportId], /invalid status/)) &&
      (await failsWith(U.admin, `select public.admin_update_report('11111111-1111-1111-1111-111111111111', 'resolved')`, [], /report_not_found/)));
  check("admin 목록 limit 상한 100", (await one(U.admin, `select public.admin_list_reports('all', 100000) as r`)).items.length <= 100);
  void conv;
}

console.log("\nP · Q — 대량 DM 한도 (보낸 사람 전체)");
{
  await db.exec(`delete from public.human_messages; update private.human_chat_settings set creator_per_10min = 4, creator_per_day = 100, creator_cold_per_day = 2, fan_per_10min = 3`);
  const toFan = `select public.send_message_to_fan($1, $2) as r`;
  // 먼저 연락(팬이 한 번도 보내지 않은 대화): premium, fan4는 허용, fan5는 세 번째라 거부
  check("Q. 먼저 연락 2명까지 허용", !(await fails(U.creatorA, toFan, [U.premium, "첫 인사"])) && !(await fails(U.creatorA, toFan, [U.fan4, "첫 인사"])));
  check("Q. 하루 먼저 연락 한도 초과(3번째 팬) → rate_limited", await failsWith(U.creatorA, toFan, [U.fan5, "첫 인사"], /rate_limited/));
  check("팬이 먼저 보낸 대화(sub)는 먼저 연락 한도와 무관", !(await fails(U.creatorA, toFan, [U.sub, "답장"])));
  check("이미 연락한 대화에 이어서 보내기는 가능", !(await fails(U.creatorA, toFan, [U.premium, "두 번째"])));
  check("P. 여러 대화에 나눠 보내도 크리에이터 전체 10분 한도(4) → rate_limited", await failsWith(U.creatorA, toFan, [U.fan4, "다섯 번째"], /rate_limited/));
  check("P. 한도 값을 인자로 넘기기 → 함수 없음", await failsWith(U.creatorA, `select public.send_message_to_fan($1, 'x', 1000)`, [U.sub], /does not exist/));
  check("P. 한도 설정 읽기 · 수정 → permission denied",
    (await failsWith(U.creatorA, `select * from private.human_chat_settings`, [], /permission denied/)) &&
      (await failsWith(U.creatorA, `update private.human_chat_settings set creator_per_10min = 100000`, [], /permission denied/)));
  await db.exec(`delete from public.human_messages where sender_id = '${U.sub}'`);
  const toCreator = `select public.send_message_to_creator($1, $2) as r`;
  check("팬 전체 한도: 두 크리에이터에게 나눠 3개 허용", !(await fails(U.sub, toCreator, ["c1", "1"])) && !(await fails(U.sub, toCreator, ["c2", "2"])) && !(await fails(U.sub, toCreator, ["c1", "3"])));
  check("팬 전체 한도 초과(4번째, 다른 크리에이터) → rate_limited", await failsWith(U.sub, toCreator, ["c2", "4"], /rate_limited/));
  await db.exec(`update private.human_chat_settings set creator_per_10min = 60, creator_per_day = 400, creator_cold_per_day = 30, fan_per_10min = 40`);
  const d = Object.fromEntries((await db.query(`select column_name, column_default from information_schema.columns where table_schema = 'private' and table_name = 'human_chat_settings'`)).rows.map((r) => [r.column_name, r.column_default]));
  check("기본 한도: 크리에이터 60/10분 · 400/일 · 먼저 연락 30/일 · 팬 40/10분", d.creator_per_10min === "60" && d.creator_per_day === "400" && d.creator_cold_per_day === "30" && d.fan_per_10min === "40", d);
}

console.log("\nU · V — 차단 해제 권한");
{
  await as(U.sub, `insert into public.user_blocks (blocked_id) values ($1)`, [U.creatorB]);
  check("V. 다른 사람이 내 차단 삭제 → 0행", (await as(U.creatorB, `delete from public.user_blocks returning 1`)).rows.length === 0 && (await as(U.premium, `delete from public.user_blocks returning 1`)).rows.length === 0);
  check("U. 차단한 본인만 해제", (await as(U.sub, `delete from public.user_blocks where blocked_id = $1 returning 1`, [U.creatorB])).rows.length === 1);
}

console.log("\nX · Y · Z — 기존 privacy 경계 (회귀)");
{
  await as(U.sub, `insert into public.fan_ai_settings (fan_id, memory_enabled) values ($1, true) on conflict (fan_id) do update set memory_enabled = true`, [U.sub]);
  await as(U.sub, `select public.record_fan_memories($1, 'c1', $2::jsonb, null)`, [KEY, JSON.stringify([{ category: "favorite", content: "초밥을 좋아함" }])]);
  await as(U.creatorA, `insert into public.creator_fan_notes (creator_id, fan_id, content) values ('c1', $1, '메모')`, [U.sub]);
  check("X. 크리에이터는 AI 대화 0행", (await count(U.creatorA, `select 1 from public.ai_messages`)) === 0 && (await count(U.creatorA, `select 1 from public.ai_conversations`)) === 0);
  check("Y. 크리에이터 · admin도 Fan Memory 0행", (await count(U.creatorA, `select 1 from public.fan_memories`)) === 0 && (await count(U.admin, `select 1 from public.fan_memories`)) === 0);
  check("Z. 팬 · 다른 크리에이터 · admin은 크리에이터 메모 0행",
    (await count(U.sub, `select 1 from public.creator_fan_notes`)) === 0 && (await count(U.creatorB, `select 1 from public.creator_fan_notes`)) === 0 && (await count(U.admin, `select 1 from public.creator_fan_notes`)) === 0);
  check("admin 권한은 신고 함수뿐 (AI 대화도 0행)", (await count(U.admin, `select 1 from public.ai_messages`)) === 0);
}

console.log("\nR · S · T — 계정 삭제");
{
  // 크리에이터 A 탈퇴: 파일이 남아 있으면 거부
  await db.query(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${U.creatorA}/me.jpg`]);
  check("S. Storage 파일이 남아 있으면 거부 (DB만 지우고 파일이 남는 일 없음)", await failsWith(U.creatorA, `select public.delete_my_account()`, [], /storage_not_empty/));
  check("삭제는 본인만 (인자 없음 · 다른 사람 id 지정 불가)", await failsWith(U.sub, `select public.delete_my_account($1)`, [U.creatorA], /does not exist/));
  check("비로그인 → 실행 권한 없음", await failsWith(null, `select public.delete_my_account()`, [], /permission denied/));
  // Storage API로 지운 것처럼 (본인 폴더 삭제 권한 확인)
  check("본인 moment-media 폴더 파일 삭제 가능 (Storage 정책)", (await as(U.creatorA, `delete from storage.objects where bucket_id = 'moment-media' and name like 'c1/%' returning 1`)).rows.length >= 3);
  await db.query(`delete from storage.objects where bucket_id = 'avatars' and name like $1`, [`${U.creatorA}/%`]);
  await db.query(`insert into private.ai_rate_limits (bucket, window_start, count) values ($1, now(), 1)`, [`ai_chat:${U.creatorA}:c2`]);
  const reportsBefore = await n(`select count(*)::int as n from public.message_reports`);
  const r = await one(U.creatorA, `select public.delete_my_account() as r`);
  check("R. 삭제 성공", r?.deleted === true);
  const residue = (await db.query(`select
      (select count(*)::int from auth.users where id = $1) as auth,
      (select count(*)::int from public.profiles where id = $1) as profile,
      (select count(*)::int from public.creators where profile_id = $1) as creators,
      (select count(*)::int from public.moments where creator_id = 'c1') as moments,
      (select count(*)::int from public.subscriptions where creator_id = 'c1') as subs,
      (select count(*)::int from public.creator_personas where creator_id = 'c1') as persona,
      (select count(*)::int from public.creator_safety_settings where creator_id = 'c1') as safety,
      (select count(*)::int from public.human_conversations where creator_id = 'c1') as human,
      (select count(*)::int from public.creator_fan_notes where creator_id = 'c1') as notes,
      (select count(*)::int from public.fan_memories where creator_id = 'c1') as memories,
      (select count(*)::int from public.ai_conversations where creator_id = 'c1') as ai,
      (select count(*)::int from public.user_blocks where blocker_id = $1 or blocked_id = $1) as blocks,
      (select count(*)::int from private.ai_rate_limits where bucket like 'ai_chat:' || $1 || '%') as ratelimits,
      (select count(*)::int from storage.objects where name like 'c1/%' or name like $1 || '/%') as storage`, [U.creatorA])).rows[0];
  check("R. 크리에이터 탈퇴 → auth · 프로필 · 채널 · Moment · 구독 · Persona · 설정 · 대화 · 메모 · 팬이 이 채널에 남긴 Memory · 차단 · 카운터 모두 0",
    Object.values(residue).every((v) => v === 0), residue);
  check("R. 이 크리에이터에 대한 신고는 운영용으로 남되 대상 연결은 끊김",
    (await n(`select count(*)::int as n from public.message_reports`)) === reportsBefore &&
      (await n(`select count(*)::int as n from public.message_reports where reported_user_id is null`)) >= 1);
  // T. 삭제된 사용자의 남은 JWT(만료 전)
  check("T. 삭제된 사용자의 옛 세션: 데이터 0행", (await count(U.creatorA, `select 1 from public.moments where creator_id = 'c1'`)) === 0 && (await count(U.creatorA, `select 1 from public.profiles where id = $1`, [U.creatorA])) === 0);
  check("T. 옛 세션으로 쓰기 → 거부 (Moment · 메시지 · 채널 만들기)",
    (await fails(U.creatorA, `insert into public.moments (creator_id, type, content) values ('c1', 'text', 'x')`)) &&
      (await fails(U.creatorA, `select public.send_message_to_fan($1, 'x')`, [U.sub])) &&
      (await fails(U.creatorA, `insert into public.creators (profile_id, name, handle, category) values ($1, '유령', 'ghost.x', 'art')`, [U.creatorA])));
  check("T. 옛 세션으로 Fan Manager → not_a_creator", await failsWith(U.creatorA, `select public.fan_manager_list()`, [], /not_a_creator/));

  // 팬 탈퇴 (신고자): 신고는 익명으로 남는다
  const subReports = await n(`select count(*)::int as n from public.message_reports where reporter_id = $1`, [U.sub]);
  const r2 = await one(U.sub, `select public.delete_my_account() as r`);
  const fanResidue = (await db.query(`select
      (select count(*)::int from public.profiles where id = $1) as profile,
      (select count(*)::int from public.subscriptions where fan_id = $1) as subs,
      (select count(*)::int from public.fan_memories where fan_id = $1) as memories,
      (select count(*)::int from public.fan_ai_settings where fan_id = $1) as memory_settings,
      (select count(*)::int from public.ai_conversations where fan_id = $1) as ai,
      (select count(*)::int from public.human_conversations where fan_id = $1) as human,
      (select count(*)::int from public.moment_reactions where user_id = $1) as reactions,
      (select count(*)::int from public.moment_bookmarks where user_id = $1) as bookmarks,
      (select count(*)::int from public.message_reports where reporter_id = $1) as reports_linked`, [U.sub])).rows[0];
  check("R. 팬 탈퇴 → 구독 · Memory · 설정 · AI 대화 · Human 대화 · 반응 · 보관함 0 · 신고 연결 끊김", r2?.deleted === true && Object.values(fanResidue).every((v) => v === 0), fanResidue);
  check("R. 팬이 했던 신고는 신고자 익명(null)으로 보존", subReports >= 1 && (await n(`select count(*)::int as n from public.message_reports where id = $1 and reporter_id is null`, [reportId])) === 1);
}

console.log("\n권한 목록");
{
  const grants = (await db.query(`
    select routine_name, grantee from information_schema.routine_privileges
    where routine_name in ('moments_set_visible_at', 'require_admin', 'human_sender_limit', 'publish_moment_now', 'is_admin', 'admin_list_reports', 'admin_update_report', 'delete_my_account', 'moment_is_live')
      and grantee in ('anon', 'authenticated', 'PUBLIC')`)).rows;
  const bad = grants.filter((g) => ["moments_set_visible_at", "require_admin", "human_sender_limit"].includes(g.routine_name) || (g.grantee !== "authenticated" && g.routine_name !== "moment_is_live"));
  check("private 헬퍼 권한 없음 · 공개 함수는 authenticated (moment_is_live만 anon 포함 — RLS 평가용)", bad.length === 0, grants);
  check("admin_users · human_chat_settings는 private (Data API 밖)", (await db.query(`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name in ('admin_users', 'human_chat_settings')`)).rows[0].n === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
