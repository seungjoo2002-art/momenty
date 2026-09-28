/**
 * v0.7 Fan Manager + Human Creator — RLS · 공격 테스트 (PGlite에 전체 migration 적용)
 *
 *   npm run test:db   (rls.test.mjs 다음에 실행)
 *
 * 공격 A~T (docs: v0.7 요구사항) + 신호 규칙 · 커서 · 차단 시 Creator AI.
 * 모든 사용자 동작은 authenticated 역할 + JWT(sub)로 — service role 없이 동작해야 한다(Q).
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
async function superFails(sql, params = []) {
  try {
    await db.query(sql, params);
    return false;
  } catch (e) {
    return String(e.message);
  }
}

await db.exec(SUPABASE_STUB);
for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
console.log("migrations applied (v0.1 ~ v0.7)");

// ---------- fixture ----------
const U = {
  creatorA: "00000000-0000-0000-0000-00000000000a",
  creatorB: "00000000-0000-0000-0000-00000000000b",
  fan1: "00000000-0000-0000-0000-000000000001",
  fan2: "00000000-0000-0000-0000-000000000002",
  follower: "00000000-0000-0000-0000-000000000003",
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
  insert into public.subscriptions (fan_id, creator_id, tier, started_at) values
    ('${U.fan1}', 'c1', 'subscriber', now() - interval '31 days'),
    ('${U.fan2}', 'c1', 'subscriber', now() - interval '2 days'),
    ('${U.follower}', 'c1', 'follow', now() - interval '10 days'),
    ('${U.fan4}', 'c1', 'premium', now() - interval '64 days'),
    ('${U.fan5}', 'c1', 'subscriber', now() - interval '40 days'),
    ('${U.fan1}', 'c2', 'subscriber', now() - interval '5 days');
`);
// c1 Moment 6개 (최근 5개 중 fan1이 4개에 반응)
const moments = [];
for (let i = 0; i < 6; i++) {
  const r = await db.query(`insert into public.moments (creator_id, type, content, visibility, created_at) values ('c1', 'text', $1, 'public', now() - make_interval(hours => $2)) returning id`, [`기록 ${i}`, 6 - i]);
  moments.push(r.rows[0].id);
}
const recent5 = moments.slice(1);
for (const m of recent5.slice(0, 4)) await as(U.fan1, `insert into public.moment_reactions (moment_id, user_id, kind) values ($1, $2, 'love')`, [m, U.fan1]);
await as(U.fan2, `insert into public.moment_reactions (moment_id, user_id, kind) values ($1, $2, 'cheer')`, [recent5[0], U.fan2]);

// fan1의 AI 대화 + Fan Memory (크리에이터가 절대 볼 수 없어야 하는 데이터)
const AI_SECRET = "AI대화비밀문장-7741";
const MEM_SECRET = "메모리비밀-오사카-8812";
await as(U.fan1, `select public.record_ai_exchange($1, 'c1', $2, 'AI 답 ${AI_SECRET}', '{}', '{}', 'anthropic', 'm')`, [KEY, `팬 질문 ${AI_SECRET}`]);
await as(U.fan1, `insert into public.fan_ai_settings (fan_id, memory_enabled) values ($1, true)`, [U.fan1]);
await as(U.fan1, `select public.record_fan_memories($1, 'c1', $2::jsonb, null)`, [KEY, JSON.stringify([{ category: "schedule", content: `10월에 ${MEM_SECRET} 여행` }, { category: "schedule", content: "10월 20일 생일" }])]);
const memRows = (await as(U.fan1, `select id, content from public.fan_memories order by content`)).rows;
const memTrip = memRows.find((m) => m.content.includes(MEM_SECRET)).id;
const memBirthday = memRows.find((m) => m.content === "10월 20일 생일").id;

const toCreator = `select public.send_message_to_creator($1, $2) as r`;
const toFan = `select public.send_message_to_fan($1, $2) as r`;

console.log("\nQ · 정상 Human Chat (authenticated 역할만 · service role 없음)");
const s1 = await one(U.fan1, toCreator, ["c1", "지훈님 안녕하세요! 오늘 러닝 봤어요"]);
check("팬 → 크리에이터 전송 · 대화방 생성", !!s1?.conversationId && !!s1.messageId);
const convA = s1.conversationId;
const s2 = await one(U.creatorA, toFan, [U.fan1, "고마워요 ㅎㅎ 오늘 좀 힘들긴 했어요"]);
check("크리에이터 → 팬 답장은 같은 대화방", s2?.conversationId === convA);
{
  const rows = (await as(U.fan1, `select sender_type, sender_id from public.human_messages where conversation_id = $1 order by created_at`, [convA])).rows;
  check("팬은 두 메시지를 읽음 · sender는 DB가 정함 (fan=fan1, creator=creatorA 프로필)",
    rows.length === 2 && rows[0].sender_type === "fan" && rows[0].sender_id === U.fan1 && rows[1].sender_type === "creator" && rows[1].sender_id === U.creatorA, rows);
  check("크리에이터도 두 메시지를 읽음", (await count(U.creatorA, `select 1 from public.human_messages where conversation_id = $1`, [convA])) === 2);
  const conv = (await as(U.fan1, `select last_fan_message_at, last_creator_message_at from public.human_conversations where id = $1`, [convA])).rows[0];
  check("대화방 시각(마지막 팬 · 크리에이터 메시지)은 trigger가 갱신", !!conv.last_fan_message_at && !!conv.last_creator_message_at && conv.last_creator_message_at > conv.last_fan_message_at);
}
const creatorMsgId = s2.messageId;
const fanMsgId = s1.messageId;

console.log("\nA · B · C — 대화방 격리");
check("A. 다른 팬(fan2)은 fan1 대화방 · 메시지 0행",
  (await count(U.fan2, `select 1 from public.human_conversations`)) === 0 && (await count(U.fan2, `select 1 from public.human_messages`)) === 0);
check("B. fan2가 fan1 대화방에 직접 insert → permission denied",
  await failsWith(U.fan2, `insert into public.human_messages (conversation_id, sender_type, sender_id, content) values ($1, 'fan', $2, '끼어들기')`, [convA, U.fan2], /permission denied/));
{
  const s = await one(U.fan2, toCreator, ["c1", "저도 안녕하세요"]);
  check("B. fan2가 보내면 자기 대화방에만 들어감 (fan1 대화방 불변)", s.conversationId !== convA && (await count(U.fan1, `select 1 from public.human_messages where conversation_id = $1`, [convA])) === 2);
}
check("C. 다른 크리에이터(creatorB)는 c1 대화방 · 메시지 0행",
  (await count(U.creatorB, `select 1 from public.human_conversations where creator_id = 'c1'`)) === 0 && (await count(U.creatorB, `select 1 from public.human_messages where conversation_id = $1`, [convA])) === 0);
check("비로그인 조회 → 거부", await fails(null, `select 1 from public.human_messages`));

console.log("\nD · E · F · R — 보낸 사람 · 대화방 · 시각 위조");
check("D. 팬이 creator sender로 직접 insert → permission denied",
  await failsWith(U.fan1, `insert into public.human_messages (conversation_id, sender_type, sender_id, content) values ($1, 'creator', $2, '크리에이터인 척')`, [convA, U.creatorA], /permission denied/));
check("D. 팬이 send_message_to_fan 호출 → not_a_creator", await failsWith(U.fan1, toFan, [U.fan2, "크리에이터인 척"], /not_a_creator/));
check("D. 팬 JWT + AI 서버 키로도 크리에이터 메시지를 만들 경로 없음 (send_message_to_fan에 키 인자 없음)",
  await failsWith(U.fan1, `select public.send_message_to_fan($1, $2, $3)`, [U.fan2, "x", KEY], /does not exist/));
check("E. 크리에이터가 fan sender로 직접 insert → permission denied",
  await failsWith(U.creatorA, `insert into public.human_messages (conversation_id, sender_type, sender_id, content) values ($1, 'fan', $2, '팬인 척')`, [convA, U.fan1], /permission denied/));
check("E. 크리에이터가 자기 채널에 팬으로 보내기 → own_channel", await failsWith(U.creatorA, toCreator, ["c1", "팬인 척"], /own_channel/));
check("F. conversation_id 인자로 보내기 → 함수 없음", await failsWith(U.fan2, `select public.send_message_to_creator(p_creator_id => 'c1', p_content => 'x', p_conversation_id => $1)`, [convA], /does not exist/));
{
  const m1 = await superFails(`insert into public.human_messages (conversation_id, sender_type, sender_id, content) values ($1, 'fan', $2, 'x')`, [convA, U.fan2]);
  check("F · R. 어떤 경로든(trigger) 다른 사람을 sender로 → sender mismatch", typeof m1 === "string" && /sender mismatch/.test(m1), m1);
  const m2 = await superFails(`insert into public.human_messages (conversation_id, sender_type, sender_id, content) values ($1, 'creator', $2, 'x')`, [convA, U.fan1]);
  check("R. sender_type=creator + 팬 id → sender mismatch", typeof m2 === "string" && /sender mismatch/.test(m2), m2);
  const m3 = await superFails(`insert into public.human_messages (conversation_id, sender_type, sender_id, content) values ($1, 'ai', $2, 'x')`, [convA, U.creatorA]);
  check("R. sender_type=ai → 거부 (Human 테이블에 AI 메시지 불가)", typeof m3 === "string", m3);
  const r = (await db.query(`insert into public.human_messages (conversation_id, sender_type, sender_id, content, created_at) values ($1, 'fan', $2, '시각 위조', '2000-01-01') returning created_at`, [convA, U.fan1])).rows[0];
  check("R. created_at 위조 → 서버 시각으로 저장", new Date(r.created_at).getFullYear() >= 2026, r);
  await db.query(`delete from public.human_messages where content = '시각 위조'`);
}
check("R. 팬이 메시지 수정 → permission denied", await failsWith(U.fan1, `update public.human_messages set content = 'x'`, [], /permission denied/));
check("R. 팬이 대화방 시각 수정 → permission denied", await failsWith(U.fan1, `update public.human_conversations set last_creator_message_at = now()`, [], /permission denied/));
check("R. 메시지 삭제 → permission denied", await failsWith(U.creatorA, `delete from public.human_messages`, [], /permission denied/));

console.log("\nG · H · K — AI 대화 · Fan Memory는 여전히 크리에이터에게 닫힘");
check("G. Human Chat 참여 후에도 크리에이터는 AI 대화 0행",
  (await count(U.creatorA, `select 1 from public.ai_conversations`)) === 0 && (await count(U.creatorA, `select 1 from public.ai_messages`)) === 0);
check("H. 크리에이터는 Fan Memory · 설정 0행",
  (await count(U.creatorA, `select 1 from public.fan_memories`)) === 0 && (await count(U.creatorA, `select 1 from public.fan_ai_settings`)) === 0);
check("K. 공유 전: 크리에이터가 볼 수 있는 공유 0행", (await count(U.creatorA, `select 1 from public.fan_creator_shares`)) === 0);
{
  const d = await one(U.creatorA, `select public.fan_manager_fan($1) as r`, [U.fan1]);
  check("K. 공유 전: Fan 상세의 shares 비어 있음", Array.isArray(d.shares) && d.shares.length === 0, d.shares);
}

console.log("\nL · M — 명시적 공유 · 취소");
{
  check("M. 팬이 공유 행 직접 insert → permission denied",
    await failsWith(U.fan1, `insert into public.fan_creator_shares (fan_id, creator_id, source_memory_id, category, content) values ($1, 'c1', $2, 'other', '직접')`, [U.fan1, memBirthday], /permission denied/));
  check("M. 다른 팬(fan2)이 fan1의 Memory를 공유 → memory_not_found",
    await failsWith(U.fan2, `select public.share_memory_with_creator($1)`, [memBirthday], /memory_not_found/));
  check("M. 크리에이터가 팬 Memory를 공유 처리 → memory_not_found",
    await failsWith(U.creatorA, `select public.share_memory_with_creator($1)`, [memBirthday], /memory_not_found/));
  const shared = await one(U.fan1, `select public.share_memory_with_creator($1, $2::date) as r`, [memBirthday, "2000-10-20"]);
  check("팬 본인이 [공유] → 성공 (크리에이터는 원본 Memory의 크리에이터로 고정)", shared?.creatorId === "c1");
  const seen = (await as(U.creatorA, `select content, event_date, category from public.fan_creator_shares`)).rows;
  check("공유 후: 크리에이터는 공유된 1개만 봄 (공유 안 한 여행 Memory는 안 보임)", seen.length === 1 && seen[0].content === "10월 20일 생일" && !JSON.stringify(seen).includes(MEM_SECRET), seen);
  check("공유 후에도 fan_memories 원문은 여전히 0행", (await count(U.creatorA, `select 1 from public.fan_memories`)) === 0);
  check("다른 크리에이터(creatorB)는 c1 공유 0행", (await count(U.creatorB, `select 1 from public.fan_creator_shares`)) === 0);
  check("M. 다른 팬이 공유 삭제 → 0행", (await as(U.fan2, `delete from public.fan_creator_shares returning 1`)).rows.length === 0);
  check("M. 크리에이터가 공유 삭제 · 수정 → 0행 / permission denied",
    (await as(U.creatorA, `delete from public.fan_creator_shares returning 1`)).rows.length === 0 &&
      (await failsWith(U.creatorA, `update public.fan_creator_shares set content = '바꿈'`, [], /permission denied/)));
  // 공유 취소 → 0 visibility, 다시 공유 → 보임, 원본 Memory 삭제 → 공유도 사라짐
  check("L. 팬이 공유 취소(삭제) → 1행", (await as(U.fan1, `delete from public.fan_creator_shares where source_memory_id = $1 returning 1`, [memBirthday])).rows.length === 1);
  check("L. 취소 후 크리에이터 0행", (await count(U.creatorA, `select 1 from public.fan_creator_shares`)) === 0);
  await as(U.fan1, `select public.share_memory_with_creator($1, $2::date)`, [memBirthday, "2000-10-20"]);
  await as(U.fan1, `select public.share_memory_with_creator($1)`, [memTrip]);
  await as(U.fan1, `delete from public.fan_memories where id = $1`, [memTrip]);
  const after = (await as(U.creatorA, `select content from public.fan_creator_shares`)).rows;
  check("L. 원본 Memory를 지우면 그 공유도 사라짐", after.length === 1 && after[0].content === "10월 20일 생일", after);
  check("T. 범위 밖 날짜 → 거부", await failsWith(U.fan1, `select public.share_memory_with_creator($1, '1800-01-01'::date)`, [memBirthday], /invalid date|check/));
}

console.log("\nI · J — 크리에이터 메모");
{
  const ins = `insert into public.creator_fan_notes (creator_id, fan_id, content) values ($1, $2, $3)`;
  check("크리에이터 본인: 자기 팬 메모 작성", !(await fails(U.creatorA, ins, ["c1", U.fan1, "지난 라이브에서 기타 이야기함"])));
  check("I. 팬은 메모 0행", (await count(U.fan1, `select 1 from public.creator_fan_notes`)) === 0);
  check("I. 팬이 메모 작성 → RLS 거부", await failsWith(U.fan1, ins, ["c1", U.fan1, "내가 쓴 메모"], /row-level security/));
  check("J. 다른 크리에이터는 메모 0행", (await count(U.creatorB, `select 1 from public.creator_fan_notes`)) === 0);
  check("J. 다른 크리에이터가 c1 이름으로 메모 → RLS 거부", await failsWith(U.creatorB, ins, ["c1", U.fan1, "x"], /row-level security/));
  check("J. 관계없는 사람에 대한 메모 → RLS 거부 (creatorB → fan2는 c2 팬 아님)", await failsWith(U.creatorB, ins, ["c2", U.fan2, "x"], /row-level security/));
  check("J. 다른 크리에이터가 수정 · 삭제 → 0행",
    (await as(U.creatorB, `update public.creator_fan_notes set content = 'x' returning 1`)).rows.length === 0 &&
      (await as(U.creatorB, `delete from public.creator_fan_notes returning 1`)).rows.length === 0);
  check("메모의 creator_id · fan_id 변경 → 거부 (컬럼 권한)", await fails(U.creatorA, `update public.creator_fan_notes set fan_id = $1`, [U.fan2]));
  check("creator_has_fan: 남의 채널 관계는 알 수 없음 (항상 false)",
    (await one(U.creatorB, `select public.creator_has_fan('c1', $1) as r`, [U.fan1])) === false && (await one(U.fan2, `select public.creator_has_fan('c1', $1) as r`, [U.fan1])) === false);
  const personaCtx = JSON.stringify(await one(U.fan1, `select public.ai_persona_context($1, 'c1') as r`, [KEY]));
  check("Persona AI Context에 크리에이터 메모 · 공유 정보 없음", !personaCtx.includes("기타 이야기") && !personaCtx.includes("10월 20일 생일"));
}

console.log("\nP — Fan Manager projection에 AI · Memory 데이터 없음");
const ALLOWED = ["avatarUrl", "blocked", "conversationId", "fanId", "hasNote", "importantDate", "lastCreatorMessageAt", "lastFanMessageAt", "lastReactionAt", "nickname", "reactions30d", "recentMoments", "recentReacted", "sharedCount", "signals", "subscribedAt", "subscribedDays", "tier"];
{
  const list = await one(U.creatorA, `select public.fan_manager_list('all', 50) as r`);
  const detail = await one(U.creatorA, `select public.fan_manager_fan($1) as r`, [U.fan1]);
  const text = JSON.stringify({ list, detail });
  check("P. AI 대화 · 비공유 Memory 원문이 어디에도 없음", !text.includes(AI_SECRET) && !text.includes(MEM_SECRET) && !/ai_messages|fan_memor|memory_enabled/i.test(text));
  check("P. 목록 항목 키 = 허용 목록뿐", list.items.every((i) => Object.keys(i).sort().join() === ALLOWED.join()), Object.keys(list.items[0] ?? {}));
  check("P. 상세 = 허용 목록 + shares · note", Object.keys(detail).sort().join() === [...ALLOWED, "note", "shares"].sort().join(), Object.keys(detail));
  check("P. 점수 · 순위 필드 없음", !/score|rank|loyal|risk|affection|vulnerab|churn|spend/i.test(text));
  check("목록: 유료 구독자만 (무료 팔로워 제외) · 4명", list.items.length === 4 && !list.items.some((i) => i.fanId === U.follower), list.items.map((i) => i.nickname));
  const f1 = list.items.find((i) => i.fanId === U.fan1);
  check("fan1: 구독 31일 · 최근 5개 중 4개 반응 · 대화 · 메모 · 공유 1", f1.subscribedDays === 31 && f1.recentMoments === 5 && f1.recentReacted === 4 && f1.hasNote && f1.sharedCount === 1 && !!f1.conversationId, f1);
}

console.log("\n신호 규칙 (설명 가능한 이벤트만)");
{
  // fan5: 크리에이터가 18일 전에 마지막으로 직접 답함
  await as(U.creatorA, toFan, [U.fan5, "오랜만이에요"]);
  await db.query(`update public.human_conversations set last_creator_message_at = now() - interval '18 days', last_message_at = now() - interval '18 days' where fan_id = $1`, [U.fan5]);
  // fan4: 공유한 날짜가 3일 뒤
  await as(U.fan4, `insert into public.fan_ai_settings (fan_id, memory_enabled) values ($1, true)`, [U.fan4]);
  await as(U.fan4, `select public.record_fan_memories($1, 'c1', $2::jsonb, null)`, [KEY, JSON.stringify([{ category: "schedule", content: "곧 기념일" }])]);
  const m4 = (await as(U.fan4, `select id from public.fan_memories`)).rows[0].id;
  await as(U.fan4, `select public.share_memory_with_creator($1, ((now() at time zone 'Asia/Seoul')::date + 3 - interval '20 years')::date)`, [m4]);

  const list = await one(U.creatorA, `select public.fan_manager_list('all', 50) as r`);
  const by = Object.fromEntries(list.items.map((i) => [i.fanId, i]));
  check("fan1: RECENT_REACTIONS (5개 중 4개) · 크리에이터가 답했으므로 NO_HUMAN_REPLY 아님", by[U.fan1].signals.includes("RECENT_REACTIONS") && !by[U.fan1].signals.includes("NO_HUMAN_REPLY"), by[U.fan1].signals);
  check("fan2: NEW_SUBSCRIBER · UNREPLIED_FAN_MESSAGE · NO_HUMAN_REPLY", ["NEW_SUBSCRIBER", "UNREPLIED_FAN_MESSAGE", "NO_HUMAN_REPLY"].every((s) => by[U.fan2].signals.includes(s)), by[U.fan2].signals);
  check("fan5: LONG_TIME_SINCE_HUMAN (18일)", by[U.fan5].signals.includes("LONG_TIME_SINCE_HUMAN"), by[U.fan5].signals);
  check("fan4: IMPORTANT_DATE — 팬이 공유한 날짜만 (3일 뒤, 해마다)", by[U.fan4].signals.includes("IMPORTANT_DATE") && by[U.fan4].importantDate?.daysUntil === 3 && by[U.fan4].importantDate.content === "곧 기념일", by[U.fan4]);
  check("fan1의 공유 생일(10월 20일)은 7일 밖이면 IMPORTANT_DATE 아님", !by[U.fan1].signals.includes("IMPORTANT_DATE") || by[U.fan1].importantDate?.daysUntil <= 7);

  const att = await one(U.creatorA, `select public.fan_manager_list('attention', 20) as r`);
  const ORDER = ["UNREPLIED_FAN_MESSAGE", "IMPORTANT_DATE", "NEW_SUBSCRIBER", "RECENT_REACTIONS", "LONG_TIME_SINCE_HUMAN", "NO_HUMAN_REPLY"];
  const prios = att.items.map((i) => ORDER.indexOf(i.signals[0]));
  check("오늘 확인할 팬: 이유 순서 = 규칙 순서 (답장 안 한 팬 메시지 → 공유한 날짜 → … ) · fan2는 답장 대기",
    prios.every((p, i) => i === 0 || prios[i - 1] <= p) && att.items[0].signals[0] === "UNREPLIED_FAN_MESSAGE" && att.items.find((i) => i.fanId === U.fan2)?.signals[0] === "UNREPLIED_FAN_MESSAGE",
    att.items.map((i) => [i.nickname, i.signals[0]]));
  check("오늘 확인할 팬: 무료 팔로워 없음", !att.items.some((i) => i.fanId === U.follower));
  const lim = await one(U.creatorA, `select public.fan_manager_list('attention', 2) as r`);
  check("attention p_limit 적용", lim.items.length === 2);
}

console.log("\nT — 인자 조작 · 커서");
{
  const p1 = await one(U.creatorA, `select public.fan_manager_list('all', 2) as r`);
  const p2 = await one(U.creatorA, `select public.fan_manager_list('all', 2, $1::timestamptz, $2::uuid) as r`, [p1.nextCursor.startedAt, p1.nextCursor.fanId]);
  const ids = [...p1.items, ...p2.items].map((i) => i.fanId);
  check("커서: 2개씩 두 페이지 = 4명 · 중복 없음 · 마지막 페이지 nextCursor", ids.length === 4 && new Set(ids).size === 4 && p2.nextCursor !== undefined, { ids, next: p2.nextCursor });
  const big = await one(U.creatorA, `select public.fan_manager_list('all', 100000) as r`);
  check("T. p_limit 100000 → 최대 50으로 제한 (여기선 4명)", big.items.length === 4);
  check("T. 정의 밖 view → 거부", await failsWith(U.creatorA, `select public.fan_manager_list('everything')`, [], /invalid view/));
  check("T. 커서 한쪽만 → 거부", await failsWith(U.creatorA, `select public.fan_manager_list('all', 10, now(), null)`, [], /invalid cursor/));
  check("T. 팬이 Fan Manager 호출 → not_a_creator", await failsWith(U.fan1, `select public.fan_manager_list()`, [], /not_a_creator/));
  check("T. 관계없는 사람 상세 → fan_not_found", await failsWith(U.creatorB, `select public.fan_manager_fan($1)`, [U.fan2], /fan_not_found/));
  check("T. 임의 uuid 상세 → fan_not_found", await failsWith(U.creatorA, `select public.fan_manager_fan($1)`, ["11111111-1111-1111-1111-111111111111"], /fan_not_found/));
  check("T. 1001자 → invalid content", await failsWith(U.fan1, toCreator, ["c1", "가".repeat(1001)], /invalid content/));
  check("T. 공백만 · null → invalid content", (await failsWith(U.fan1, toCreator, ["c1", "   "], /invalid content/)) && (await failsWith(U.fan1, toCreator, ["c1", null], /invalid content/)));
  const inj = "'); delete from public.human_messages; --";
  await as(U.fan1, toCreator, ["c1", inj]);
  check("T. SQL 문자열은 그대로 저장 (실행되지 않음)", (await count(U.fan1, `select 1 from public.human_messages where content = $1`, [inj])) === 1 && (await count(U.creatorA, `select 1 from public.human_messages`)) > 3);
  check("T. 없는 크리에이터 → creator_not_found", await failsWith(U.fan1, toCreator, ["nobody", "x"], /creator_not_found/));
  check("T. 남의 대화방 읽음 처리 → false", (await one(U.fan2, `select public.mark_human_conversation_read($1) as r`, [convA])) === false);
  check("읽음 처리는 본인 행만 · 상대는 볼 수 없음",
    (await one(U.fan1, `select public.mark_human_conversation_read($1) as r`, [convA])) === true &&
      (await count(U.creatorA, `select 1 from public.human_conversation_reads where user_id = $1`, [U.fan1])) === 0);
  const burst = [];
  for (let i = 0; i < 11; i++) burst.push(await fails(U.fan4, toCreator, ["c1", `연속 ${i}`]));
  check("T. 1분에 10개 넘게 → rate_limited", burst.slice(0, 10).every((x) => !x) && burst[10] === true);
}

console.log("\nN — 차단");
{
  check("팬(fan1)이 크리에이터 프로필 차단", !(await fails(U.fan1, `insert into public.user_blocks (blocked_id) values ($1)`, [U.creatorA])));
  check("N. 차단 후 팬 → 크리에이터 전송 거부 (차단 주체를 드러내지 않는 messaging_unavailable)", await failsWith(U.fan1, toCreator, ["c1", "x"], /messaging_unavailable/));
  check("N. 차단 후 크리에이터 → 팬 전송 거부", await failsWith(U.creatorA, toFan, [U.fan1, "x"], /messaging_unavailable/));
  check("N. 차단 관계면 Creator AI도 멈춤 (blocked)", await failsWith(U.fan1, `select public.ai_persona_context($1, 'c1')`, [KEY], /blocked/));
  check("N. 차단당한 크리에이터는 차단 행을 볼 수 없음", (await count(U.creatorA, `select 1 from public.user_blocks`)) === 0);
  check("N. 차단된 대화 기록은 두 사람 모두 계속 읽음", (await count(U.creatorA, `select 1 from public.human_messages where conversation_id = $1`, [convA])) >= 2);
  check("N. 다른 사람 이름으로 차단 행 만들기 → RLS 거부", await failsWith(U.fan2, `insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [U.fan1, U.creatorB], /row-level security/));
  check("N. 남의 차단 해제 → 0행", (await as(U.creatorA, `delete from public.user_blocks returning 1`)).rows.length === 0);
  check("자기 자신 차단 → 거부", await fails(U.fan2, `insert into public.user_blocks (blocked_id) values ($1)`, [U.fan2]));
  await as(U.fan1, `delete from public.user_blocks where blocked_id = $1`, [U.creatorA]);
  check("차단 해제 → 다시 전송 가능", !(await fails(U.fan1, toCreator, ["c1", "다시 안녕하세요"])));
  await as(U.creatorA, `insert into public.user_blocks (blocked_id) values ($1)`, [U.fan2]);
  check("N. 크리에이터가 팬 차단 → 팬 전송 · Creator AI 모두 거부",
    (await failsWith(U.fan2, toCreator, ["c1", "x"], /messaging_unavailable/)) && (await failsWith(U.fan2, `select public.ai_persona_context($1, 'c1')`, [KEY], /blocked/)));
  const att = await one(U.creatorA, `select public.fan_manager_list('attention', 20) as r`);
  const all = await one(U.creatorA, `select public.fan_manager_list('all', 50) as r`);
  check("차단한 팬은 '오늘 확인할 팬'에서 빠지고 전체 목록엔 blocked 표시", !att.items.some((i) => i.fanId === U.fan2) && all.items.find((i) => i.fanId === U.fan2)?.blocked === true);
}

console.log("\nO — 신고");
{
  const rep = `select public.report_human_message($1, $2, $3) as r`;
  check("팬이 크리에이터 메시지 신고", !!(await one(U.fan1, rep, [creatorMsgId, "harassment", "불편한 표현"]))?.reportId);
  check("O. 신고당한 크리에이터는 신고 0행", (await count(U.creatorA, `select id from public.message_reports`)) === 0);
  check("O. 다른 사용자도 0행", (await count(U.fan2, `select id from public.message_reports`)) === 0 && (await count(U.creatorB, `select id from public.message_reports`)) === 0);
  check("신고자 본인은 자기 신고 1행 (허용 컬럼만)", (await count(U.fan1, `select id, reason, status from public.message_reports`)) === 1);
  check("O. 신고 원문 스냅샷 · 신고당한 사용자 컬럼은 신고자도 못 읽음", await failsWith(U.fan1, `select message_snapshot, reported_user_id from public.message_reports`, [], /permission denied/));
  check("자기 메시지 신고 → 거부", await failsWith(U.fan1, rep, [fanMsgId, "spam", ""], /cannot_report_own_message/));
  check("남의 대화 메시지 신고 → message_not_found", await failsWith(U.fan2, rep, [creatorMsgId, "spam", ""], /message_not_found/));
  check("정의 밖 사유 → 거부", await failsWith(U.creatorA, rep, [fanMsgId, "because", ""], /invalid reason/));
  check("신고 직접 insert · 수정 · 삭제 → 거부",
    (await fails(U.fan1, `insert into public.message_reports (reporter_id, message_snapshot, reason) values ($1, 'x', 'spam')`, [U.fan1])) &&
      (await fails(U.fan1, `update public.message_reports set status = 'dismissed'`)) &&
      (await fails(U.fan1, `delete from public.message_reports`)));
  check("크리에이터도 팬 메시지 신고 가능", !!(await one(U.creatorA, rep, [fanMsgId, "spam", ""]))?.reportId);
}

console.log("\nS — 구독 종료 · 계정 삭제");
{
  await db.query(`update public.subscriptions set tier = 'follow' where fan_id = $1 and creator_id = 'c1'`, [U.fan5]);
  check("S. 구독이 끝난 팬 → 팬 전송 거부 (subscription_required)", await failsWith(U.fan5, toCreator, ["c1", "x"], /subscription_required/));
  check("S. 구독이 끝난 팬에게 크리에이터 전송 거부 (fan_not_subscribed)", await failsWith(U.creatorA, toFan, [U.fan5, "x"], /fan_not_subscribed/));
  check("S. 지난 대화 기록은 두 사람 모두 계속 읽음",
    (await count(U.fan5, `select 1 from public.human_messages`)) >= 1 && (await count(U.creatorA, `select 1 from public.human_messages m join public.human_conversations h on h.id = m.conversation_id where h.fan_id = $1`, [U.fan5])) >= 1);
  check("S. 구독이 끝난 팬도 상세는 볼 수 있음 (관계: 팔로우 행 · 대화)", !!(await one(U.creatorA, `select public.fan_manager_fan($1) as r`, [U.fan5]))?.fanId);
  // 계정 삭제 (auth.users → profiles cascade)
  const reportsBefore = Number((await db.query(`select count(*)::int as n from public.message_reports`)).rows[0].n);
  await db.query(`delete from auth.users where id = $1`, [U.fan1]);
  const left = (await db.query(`select
      (select count(*)::int from public.human_conversations where fan_id = $1) as conv,
      (select count(*)::int from public.creator_fan_notes where fan_id = $1) as notes,
      (select count(*)::int from public.fan_creator_shares where fan_id = $1) as shares,
      (select count(*)::int from public.user_blocks where blocker_id = $1 or blocked_id = $1) as blocks,
      (select count(*)::int from public.message_reports where reporter_id = $1) as own_reports,
      (select count(*)::int from public.message_reports) as reports`, [U.fan1])).rows[0];
  check("S. 팬 계정 삭제 → 대화 · 메시지 · 메모 · 공유 · 차단 · 본인 신고 모두 삭제", left.conv === 0 && left.notes === 0 && left.shares === 0 && left.blocks === 0 && left.own_reports === 0, left);
  // v0.8: 신고는 지우지 않는다 — 삭제한 사람이 한 신고는 신고자 익명(null)으로, 그 사람에 대한 신고는 연결만 끊긴 채 남는다
  const anon = Number((await db.query(`select count(*)::int as n from public.message_reports where reporter_id is null`)).rows[0].n);
  check("S. 신고는 운영 검토용으로 남음 (v0.8: 삭제한 사람의 신고는 신고자 익명화)", left.reports === reportsBefore && anon >= 1, { before: reportsBefore, after: left.reports, anon });
  await db.query(`delete from auth.users where id = $1`, [U.creatorB]);
  check("S. 크리에이터 계정 삭제 → 그 채널의 Human 대화 · 메모 · 공유 삭제",
    Number((await db.query(`select count(*)::int as n from public.human_conversations where creator_id = 'c2'`)).rows[0].n) === 0);
}

console.log("\n권한 목록 (L · Q)");
{
  const grants = (await db.query(`
    select routine_name, grantee from information_schema.routine_privileges
    where specific_schema in ('public', 'private')
      and routine_name in ('send_message_to_creator', 'send_message_to_fan', 'mark_human_conversation_read', 'report_human_message', 'share_memory_with_creator',
                           'fan_manager_list', 'fan_manager_fan', 'creator_has_fan', 'blocked_between', 'human_messages_guard', 'human_rate_limit', 'fan_manager_rows', 'human_message_body')
      and grantee in ('anon', 'authenticated', 'PUBLIC')`)).rows;
  const bad = grants.filter((g) => g.grantee !== "authenticated" || ["blocked_between", "human_messages_guard", "human_rate_limit", "fan_manager_rows", "human_message_body"].includes(g.routine_name));
  check("실행 권한: 공개 함수는 authenticated만 · private 헬퍼는 아무에게도 없음", bad.length === 0 && grants.length === 8, grants);
  check("private 헬퍼 직접 호출 → permission denied", await failsWith(U.fan2, `select private.fan_manager_rows('c1', $1, array[$1]::uuid[])`, [U.fan2], /permission denied/));
  const tablePriv = (await db.query(`
    select table_name, privilege_type from information_schema.role_table_grants
    where grantee = 'authenticated' and table_name in ('human_conversations', 'human_messages', 'human_conversation_reads', 'message_reports', 'fan_creator_shares')
      and privilege_type in ('INSERT', 'UPDATE')`)).rows;
  check("Human Chat · 신고 · 공유 테이블에 authenticated INSERT/UPDATE 없음 (함수만)", tablePriv.length === 0, tablePriv);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
