/**
 * v0.8.5 Creator AI Avatar + Studio — DB 검사 (PGlite에 전체 migration 적용)
 *
 *   npm run test:db   (rls.test.mjs · v07 · v08 다음)
 *
 * A. AI 문답 ON 가드 (기본정보 · 말투 문답 · Persona · Boundary) — API로 직접 켜도 DB가 거부
 * B. 말투 학습 데이터: 직접 쓰기 · 덮어쓰기 불가 · 재학습은 보관 후 새 행 · 초기화(확인 문구) · 원본 보존 · 자동 OFF
 * C. 기본정보 = Verified Facts (수정 가능 · 공개하지 않음 · Fact와 Style 분리)
 * D. AI 대화 열람 고지 (확인 전 대화 비공개 · 취소 · 다른 크리에이터 · Fan Memory 없음)
 * E. 구독 환영 메시지 (정확히 1회 · 중복 없음 · 무료 팔로우 없음 · 차단 · 직접 쓰기 불가)
 * F. Fans 플랜별 (enum 기준 · 개수 · 필터 · 다른 크리에이터)
 * G. 통계 (날짜별 실제 행 · 기간 제한 · 다른 크리에이터 제외 · 빈 기간)
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
async function failsWith(uid, sql, params, pattern) {
  try {
    await as(uid, sql, params);
    return false;
  } catch (e) {
    return pattern.test(String(e.message));
  }
}
const one = async (uid, sql, params) => (await as(uid, sql, params)).rows[0]?.r;
const n = async (sql, params) => Number((await db.query(sql, params)).rows[0].n);
const enabled = async (cid) => (await db.query(`select persona_enabled as r from public.creators where id = $1`, [cid])).rows[0].r;

await db.exec(SUPABASE_STUB);
for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
console.log("migrations applied (v0.1 ~ v0.8.5)");

const U = {
  creatorA: "00000000-0000-0000-0000-00000000000a",
  creatorB: "00000000-0000-0000-0000-00000000000b",
  newbie: "00000000-0000-0000-0000-00000000000c",
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
  insert into public.subscriptions (fan_id, creator_id, tier, started_at) values
    ('${U.fan1}', 'c1', 'subscriber', now() - interval '3 days'),
    ('${U.fan2}', 'c1', 'premium', now() - interval '10 days'),
    ('${U.follower}', 'c1', 'follow', now() - interval '1 day'),
    ('${U.fan1}', 'c2', 'subscriber', now() - interval '5 days');
`);

const prompts = (await db.query(`select key, required, sort from public.avatar_training_prompts order by sort`)).rows;
const required = prompts.filter((p) => p.required).map((p) => p.key);
const optional = prompts.filter((p) => !p.required).map((p) => p.key);
const answers = (keys, prefix = "내 답") => JSON.stringify(keys.map((key, i) => ({ key, reply: `${prefix} ${i} ㅋㅋ` })));
const basics = (patch = {}) =>
  JSON.stringify({
    favorite_food: { value: "떡볶이" },
    disliked_food: { value: "", undisclosed: true },
    hobby: { value: "러닝" },
    interest: { value: "카메라" },
    likes: { value: "새벽 공기" },
    dislikes: { value: "과속" },
    ...patch,
  });
const turnOn = (uid, cid) => as(uid, `update public.creators set persona_enabled = true where id = $1 returning 1`, [cid]);
const readiness = (uid) => one(uid, `select public.avatar_readiness() as r`);

/* ======================= A. AI 문답 ON 가드 ======================= */
console.log("\nA. AI 문답 ON 가드");
{
  check("질문 40개 · 필수 9개", prompts.length === 40 && required.length === 9, { total: prompts.length, required: required.length });
  await as(U.newbie, `insert into public.creators (profile_id, name, handle, category, job) values ($1, '새내기', 'newbie', 'art', '작가')`, [U.newbie]);
  const nb = (await db.query(`select id, persona_enabled from public.creators where profile_id = $1`, [U.newbie])).rows[0];
  check("새 크리에이터는 AI 문답 OFF로 시작", nb.persona_enabled === false);
  check("직업 41자 → 거부", await failsWith(U.newbie, `update public.creators set job = repeat('가', 41) where profile_id = $1`, [U.newbie], /creators_job_length/));
  check("아무것도 안 한 상태로 ON → avatar_not_ready", await failsWith(U.creatorA, `update public.creators set persona_enabled = true where id = 'c1'`, [], /avatar_not_ready/));

  // 기본정보만
  const r1 = await one(U.creatorA, `select public.save_avatar_basics('러너', $1::jsonb) as r`, [basics()]);
  check("기본정보 저장 → basics.done · style 미완", r1.basics.done === true && r1.style.done === false && r1.ready === false, r1);
  check("기본정보만 완료 → ON 거부", await failsWith(U.creatorA, `update public.creators set persona_enabled = true where id = 'c1'`, [], /avatar_not_ready/));

  // 말투 31개 (필수 포함) → 부족
  const r2 = await one(U.creatorA, `select public.save_style_answers($1::jsonb) as r`, [answers([...required, ...optional.slice(0, 22)])]);
  check("말투 31개 → style 미완 (최소 32)", r2.style.answered === 31 && r2.style.done === false, r2.style);
  check("말투 부족 → ON 거부", await failsWith(U.creatorA, `update public.creators set persona_enabled = true where id = 'c1'`, [], /avatar_not_ready/));

  // 32개지만 필수 하나 빠짐 (c2로 따로 검사)
  await one(U.creatorB, `select public.save_avatar_basics('뮤지션', $1::jsonb) as r`, [basics()]);
  const r3 = await one(U.creatorB, `select public.save_style_answers($1::jsonb) as r`, [answers([...required.slice(1), ...optional.slice(0, 24)])]);
  check("32개여도 필수 질문(위치 · 연애 등)이 빠지면 미완", r3.style.answered === 32 && r3.style.done === false && r3.style.requiredMissing.includes(required[0]), r3.style);

  const r4 = await one(U.creatorA, `select public.save_style_answers($1::jsonb) as r`, [answers([optional[22]], "추가")]);
  check("32개 + 필수 전부 → style.done (Persona · Boundary는 아직)", r4.style.done === true && r4.persona === false && r4.boundaries === false && r4.ready === false, r4);
  check("Persona 없음 → ON 거부", await failsWith(U.creatorA, `update public.creators set persona_enabled = true where id = 'c1'`, [], /avatar_not_ready/));
  await as(U.creatorA, `insert into public.creator_personas (creator_id, traits) values ('c1', '{"warm","playful"}')`);
  check("Boundary 미확인 → ON 거부", await failsWith(U.creatorA, `update public.creators set persona_enabled = true where id = 'c1'`, [], /avatar_not_ready/));
  await as(U.creatorA, `select public.confirm_avatar_boundaries()`);
  const r5 = await readiness(U.creatorA);
  check("모두 완료 → ready", r5.ready === true, r5);
  check("준비 완료 → ON 성공", (await turnOn(U.creatorA, "c1")).rows.length === 1 && (await enabled("c1")) === true);
  check("OFF 가능", (await as(U.creatorA, `update public.creators set persona_enabled = false where id = 'c1' returning 1`)).rows.length === 1 && (await enabled("c1")) === false);
  await turnOn(U.creatorA, "c1");

  check("다른 크리에이터가 c1 켜기/끄기 → 0행", (await as(U.creatorB, `update public.creators set persona_enabled = false where id = 'c1' returning 1`)).rows.length === 0);
  check("팬(크리에이터 아님)이 저장 함수 호출 → not_a_creator", await failsWith(U.fan1, `select public.save_style_answers($1::jsonb)`, [answers([required[0]])], /not_a_creator/));
  check("비로그인 → 실행 권한 없음", await failsWith(null, `select public.avatar_readiness()`, [], /permission denied/));
  check("준비 상태 계산 함수(private) 직접 호출 → permission denied", await failsWith(U.creatorA, `select private.avatar_readiness('c1')`, [], /permission denied/));
  // service role도 가드를 우회하지 못한다 (trigger)
  let svc = false;
  try {
    await db.exec("set role service_role");
    await db.query(`update public.creators set persona_enabled = true where profile_id = $1`, [U.newbie]);
  } catch (e) {
    svc = /avatar_not_ready/.test(String(e.message));
  } finally {
    await db.exec("reset role");
  }
  check("service role로도 준비 안 된 채널 ON → avatar_not_ready", svc);
}

/* ======================= B. 말투 학습 데이터 ======================= */
console.log("\nB. 말투 학습 데이터 (덮어쓰기 불가 · 보관 · 초기화)");
{
  const sample = (await db.query(`select id from public.creator_style_samples where creator_id = 'c1' and archived_at is null limit 1`)).rows[0].id;
  check("학습 답변 직접 insert → permission denied",
    await failsWith(U.creatorA, `insert into public.creator_style_samples (creator_id, source, prompt_key, fan_message, reply) values ('c1', 'onboarding', 'today_1', 'x', 'y')`, [], /permission denied/));
  check("학습 답변 직접 수정(덮어쓰기) → permission denied", await failsWith(U.creatorA, `update public.creator_style_samples set reply = '바꿈' where id = $1`, [sample], /permission denied/));
  check("학습 답변 직접 삭제 → permission denied", await failsWith(U.creatorA, `delete from public.creator_style_samples where id = $1`, [sample], /permission denied/));
  check("다른 크리에이터 · 팬은 c1 학습 답변을 읽을 수 없음 (0행)",
    (await as(U.creatorB, `select 1 from public.creator_style_samples where creator_id = 'c1'`)).rows.length === 0 &&
      (await as(U.fan1, `select 1 from public.creator_style_samples`)).rows.length === 0);
  check("없는 질문 key → 거부", await failsWith(U.creatorA, `select public.save_style_answers('[{"key":"nope","reply":"x"}]'::jsonb)`, [], /invalid prompt/));
  check("빈 답 → 거부", await failsWith(U.creatorA, `select public.save_style_answers('[{"key":"today_1","reply":"   "}]'::jsonb)`, [], /invalid reply/));
  check("501자 답 → 거부", await failsWith(U.creatorA, `select public.save_style_answers($1::jsonb)`, [JSON.stringify([{ key: "today_1", reply: "가".repeat(501) }])], /invalid reply/));
  check("한 번에 51개 → 거부", await failsWith(U.creatorA, `select public.save_style_answers($1::jsonb)`, [JSON.stringify(Array(51).fill({ key: "today_1", reply: "x" }))], /invalid items/));

  // 재학습: 이전 답은 보관 · 새 답이 활성 · ON 유지
  await as(U.creatorA, `select public.save_style_answers('[{"key":"today_1","reply":"오늘은 산책했어 ㅎㅎ"}]'::jsonb)`);
  const rows = (await db.query(`select reply, archived_at is not null as archived from public.creator_style_samples where creator_id = 'c1' and prompt_key = 'today_1' order by created_at`)).rows;
  check("같은 질문 다시 답하기 → 이전 답은 보관 · 새 답 활성 (원본 보존)", rows.length === 2 && rows[0].archived && !rows[1].archived && rows[1].reply === "오늘은 산책했어 ㅎㅎ", rows);
  check("다시 답해도 AI 문답은 켜진 채 유지 (트랜잭션 끝에 확인)", (await enabled("c1")) === true);

  // 추가 학습
  const t = await one(U.creatorA, `select public.add_style_training('오늘 뭐 먹었어?', '김밥 먹었어 ㅋㅋ') as r`);
  check("추가 학습(avatar_training) 저장", !!t && (await n(`select count(*)::int as n from public.creator_style_samples where id = $1 and source = 'avatar_training'`, [t])) === 1);
  check("creator_correction은 AI 예상 답변 필요", await failsWith(U.creatorA, `select public.add_style_training('질문', '고친 답', 'creator_correction')`, [], /invalid draft/));
  const cc = await one(U.creatorA, `select public.add_style_training('질문', '고친 답', 'creator_correction', 'AI가 예상한 답') as r`);
  check("creator_correction 저장 (출처 · 원래 AI 답 보존)", (await db.query(`select source, ai_draft from public.creator_style_samples where id = $1`, [cc])).rows[0]?.ai_draft === "AI가 예상한 답");
  check("정의 밖 출처(onboarding으로 위장) → 거부", await failsWith(U.creatorA, `select public.add_style_training('q', 'a', 'onboarding')`, [], /invalid source/));

  // 초기화 — c2로 (c1은 뒤 검사에 필요)
  await as(U.creatorB, `select public.save_style_answers($1::jsonb)`, [answers([required[0]])]);
  await as(U.creatorB, `insert into public.creator_personas (creator_id) values ('c2')`);
  await as(U.creatorB, `select public.confirm_avatar_boundaries()`);
  check("c2 준비 완료 → ON", (await turnOn(U.creatorB, "c2")).rows.length === 1);
  check("확인 문구 없이 초기화 → 거부", await failsWith(U.creatorB, `select public.reset_style_training('yes')`, [], /confirmation_required/));
  const before = await n(`select count(*)::int as n from public.creator_style_samples where creator_id = 'c2'`);
  const archived = await one(U.creatorB, `select public.reset_style_training('초기화') as r`);
  const after = await n(`select count(*)::int as n from public.creator_style_samples where creator_id = 'c2'`);
  const active = await n(`select count(*)::int as n from public.creator_style_samples where creator_id = 'c2' and archived_at is null`);
  check("초기화 → 모두 보관 (행은 남음 · 활성 0)", archived === before && after === before && active === 0, { before, after, active, archived });
  check("초기화 → AI 문답 자동 OFF · 다시 켤 수 없음", (await enabled("c2")) === false && (await failsWith(U.creatorB, `update public.creators set persona_enabled = true where id = 'c2'`, [], /avatar_not_ready/)));

  // 자동 OFF: 기본정보를 지우면 꺼진다
  await as(U.creatorB, `select public.save_style_answers($1::jsonb)`, [answers([...required, ...optional.slice(0, 23)])]);
  await turnOn(U.creatorB, "c2");
  await as(U.creatorB, `delete from public.creator_facts where creator_id = 'c2' and content like '취미:%'`);
  check("켜진 상태에서 기본정보(취미) 삭제 → 자동 OFF", (await enabled("c2")) === false);
  await as(U.creatorB, `select public.save_avatar_basics('뮤지션', '{"hobby":{"value":"기타"}}'::jsonb)`);
  await turnOn(U.creatorB, "c2");
  await as(U.creatorB, `delete from public.creator_personas where creator_id = 'c2'`);
  check("Persona 삭제 → 자동 OFF", (await enabled("c2")) === false);
  await as(U.creatorB, `insert into public.creator_personas (creator_id) values ('c2')`);
  await turnOn(U.creatorB, "c2");
  await as(U.creatorB, `update public.creators set job = '' where id = 'c2'`);
  check("직업을 비우면 → 자동 OFF", (await enabled("c2")) === false);
  await as(U.creatorB, `update public.creators set job = '뮤지션' where id = 'c2'`);
}

/* ======================= C. 기본정보 = Verified Facts ======================= */
console.log("\nC. 기본정보 (Fact) · 말투(Style) 분리");
{
  const facts = (await db.query(`select basic_key, content, undisclosed, source, category from public.creator_facts where creator_id = 'c1' and basic_key is not null order by basic_key`)).rows;
  check("기본정보 6개 → Verified Facts (source avatar_basics)", facts.length === 6 && facts.every((f) => f.source === "avatar_basics"), facts);
  check("'말하고 싶지 않아요' → 공개하지 않음 표시", facts.find((f) => f.basic_key === "disliked_food")?.undisclosed === true && facts.find((f) => f.basic_key === "disliked_food").content === "싫어하는 음식: 공개하지 않음");
  await as(U.creatorA, `select public.save_avatar_basics('러너 · 사진가', '{"favorite_food":{"value":"김치찌개"}}'::jsonb)`);
  const food = (await db.query(`select content from public.creator_facts where creator_id = 'c1' and basic_key = 'favorite_food'`)).rows;
  check("기본정보는 언제든 수정 (한 행 유지)", food.length === 1 && food[0].content === "좋아하는 음식: 김치찌개", food);
  check("직업 저장 (공개 프로필)", (await db.query(`select job from public.creators where id = 'c1'`)).rows[0].job === "러너 · 사진가");
  check("정의 밖 기본정보 항목 → 거부", await failsWith(U.creatorA, `select public.save_avatar_basics('러너', '{"address":{"value":"서울"}}'::jsonb)`, [], /invalid items/));
  check("빈 직업 → 거부", await failsWith(U.creatorA, `select public.save_avatar_basics('  ', '{}'::jsonb)`, [], /invalid job/));
  check("basic_key 직접 지정 insert → 거부 (컬럼 권한)",
    await failsWith(U.creatorA, `insert into public.creator_facts (creator_id, content, basic_key) values ('c1', '가짜', 'hobby')`, [], /permission denied/));
  check("다른 크리에이터가 c1 기본정보 수정 → 0행",
    (await as(U.creatorB, `update public.creator_facts set content = 'x' where creator_id = 'c1' returning 1`)).rows.length === 0);

  await db.exec(`insert into public.ai_creator_view_consents (fan_id, creator_id) values ('${U.fan1}', 'c1')`);
  const ctx = await one(U.fan1, `select public.ai_persona_context($1, 'c1') as r`, [KEY]);
  check("Persona Context: IDENTITY에 직업", ctx?.creator?.job === "러너 · 사진가", ctx?.creator);
  check("Persona Context: 학습 답변(STYLE) = 활성 처음 학습 32 + 추가 학습 2 (보관된 답 제외)", ctx?.styleSamples?.length === 34, ctx?.styleSamples?.length);
  check("학습 답변은 사실 목록에 들어가지 않음 (Fact · Style 분리)",
    !ctx.facts.some((f) => /ㅋㅋ|산책했어|김밥/.test(f.content)) && ctx.styleSamples.some((s) => s.reply === "김밥 먹었어 ㅋㅋ"));
  check("보관된(이전) 답은 Context에 없음", !ctx.styleSamples.some((s) => s.reply.startsWith("내 답") && s.fan === "오늘 뭐했어?"));
  check("공개하지 않은 기본정보는 표시와 함께", ctx.facts.some((f) => f.undisclosed === true && f.content.startsWith("싫어하는 음식")));
  await as(U.creatorA, `insert into public.creator_fan_notes (creator_id, fan_id, content) values ('c1', $1, '크리에이터 메모 비밀')`, [U.fan1]);
  const again = await one(U.fan1, `select public.ai_persona_context($1, 'c1') as r`, [KEY]);
  check("크리에이터 메모는 AI Context에 없음", !JSON.stringify(again).includes("크리에이터 메모 비밀"));
}

/* ======================= D. AI 대화 열람 고지 ======================= */
console.log("\nD. AI 대화 열람 고지 · 프라이버시");
{
  // fan2(premium)는 아직 고지 확인 전
  check("고지 확인 전 → ai_notice_required (AI 대화 불가)", await failsWith(U.fan2, `select public.ai_persona_context($1, 'c1')`, [KEY], /ai_notice_required/));
  check("고지 확인 전 → 기록도 불가", await failsWith(U.fan2, `select public.record_ai_exchange($1, 'c1', '안녕', '답')`, [KEY], /ai_notice_required/));
  // 확인 전 대화 (예전 대화)를 superuser로 만든다
  const conv = (await db.query(`insert into public.ai_conversations (fan_id, creator_id) values ($1, 'c1') returning id`, [U.fan2])).rows[0].id;
  await db.query(`insert into public.ai_messages (conversation_id, sender, content, created_at) values ($1, 'fan', '예전 비밀 이야기', now() - interval '2 hours')`, [conv]);
  const before = await one(U.creatorA, `select public.creator_fan_ai_messages($1) as r`, [U.fan2]);
  check("확인 전 → 크리에이터에게 대화 없음 (consented false)", before.consented === false && before.messages.length === 0, before);
  const t = await one(U.fan2, `select public.acknowledge_ai_notice('c1') as r`);
  check("팬이 고지 확인", !!t);
  check("같은 확인 다시 → 시각 그대로 (중복 없음)", (await one(U.fan2, `select public.acknowledge_ai_notice('c1') as r`)).getTime?.() === t.getTime?.());
  const r = await one(U.fan2, `select public.record_ai_exchange($1, 'c1', '확인 후 질문', '확인 후 답') as r`, [KEY]);
  check("확인 후 → AI 대화 가능", !!r?.aiMessageId);
  const after = await one(U.creatorA, `select public.creator_fan_ai_messages($1) as r`, [U.fan2]);
  check("크리에이터: 확인 이후 메시지만 (예전 대화 제외)",
    after.consented === true && after.messages.length === 2 && !after.messages.some((m) => m.content === "예전 비밀 이야기"), after.messages.map((m) => m.content));
  check("열람 결과에 Fan Memory 없음 (메시지 필드만)", Object.keys(after.messages[0]).sort().join() === "boundary,content,createdAt,id,sender" && !("memories" in after));
  check("크리에이터는 여전히 ai_messages · ai_conversations 직접 조회 0행",
    (await as(U.creatorA, `select 1 from public.ai_messages`)).rows.length === 0 && (await as(U.creatorA, `select 1 from public.ai_conversations`)).rows.length === 0);
  check("크리에이터는 Fan Memory · 고지 테이블 직접 조회 0행",
    (await as(U.creatorA, `select 1 from public.fan_memories`)).rows.length === 0 && (await as(U.creatorA, `select 1 from public.ai_creator_view_consents`)).rows.length === 0);
  check("다른 크리에이터(c2) → 내 팬 아님 fan_not_found", await failsWith(U.creatorB, `select public.creator_fan_ai_messages($1)`, [U.fan2], /fan_not_found/));
  check("팬이 호출 → not_a_creator", await failsWith(U.fan1, `select public.creator_fan_ai_messages($1)`, [U.fan2], /not_a_creator/));
  check("관계 없는 사용자(fan4) → fan_not_found", await failsWith(U.creatorA, `select public.creator_fan_ai_messages($1)`, [U.fan4], /fan_not_found/));
  check("다른 팬이 내 고지 확인 삭제 → 0행", (await as(U.fan1, `delete from public.ai_creator_view_consents where fan_id = $1 returning 1`, [U.fan2])).rows.length === 0);
  check("고지 확인 직접 insert → permission denied", await failsWith(U.fan4, `insert into public.ai_creator_view_consents (fan_id, creator_id) values ($1, 'c1')`, [U.fan4], /permission denied/));
  check("팬이 확인 취소 → 1행", (await as(U.fan2, `delete from public.ai_creator_view_consents where creator_id = 'c1' returning 1`)).rows.length === 1);
  const withdrawn = await one(U.creatorA, `select public.creator_fan_ai_messages($1) as r`, [U.fan2]);
  check("취소 후 → 크리에이터 열람 0 · AI 대화도 다시 확인 필요",
    withdrawn.consented === false && withdrawn.messages.length === 0 && (await failsWith(U.fan2, `select public.ai_persona_context($1, 'c1')`, [KEY], /ai_notice_required/)));
  check("자기 채널에 고지 확인 → own_channel", await failsWith(U.creatorA, `select public.acknowledge_ai_notice('c1')`, [], /own_channel/));
  // 차단 관계 기존 정책 유지
  await as(U.fan1, `insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [U.fan1, U.creatorA]);
  check("차단 관계 → blocked (기존 정책 그대로)", await failsWith(U.fan1, `select public.ai_persona_context($1, 'c1')`, [KEY], /blocked/));
  await as(U.fan1, `delete from public.user_blocks where blocked_id = $1`, [U.creatorA]);
}

/* ======================= E. 구독 환영 메시지 ======================= */
console.log("\nE. 구독 환영 메시지");
{
  check("환영 메시지 직접 insert → permission denied (설정은 함수로)",
    await failsWith(U.creatorA, `insert into public.creator_avatar_settings (creator_id, welcome_message) values ('c1', 'x')`, [], /permission denied/));
  check("501자 → 거부", await failsWith(U.creatorA, `select public.save_welcome_message($1)`, ["가".repeat(501)], /invalid message/));
  await as(U.creatorA, `select public.save_welcome_message('안녕! 구독해 줘서 고마워 :)')`);
  const cnt = (fan) => n(`select count(*)::int as n from public.subscription_welcomes where fan_id = $1 and creator_id = 'c1'`, [fan]);
  // 결제 서버 역할 = superuser/service role (앱은 유료 등급을 만들 수 없다)
  await db.query(`insert into public.subscriptions (fan_id, creator_id, tier) values ($1, 'c1', 'subscriber')`, [U.fan4]);
  check("유료 구독 활성화 → 환영 메시지 1개", (await cnt(U.fan4)) === 1);
  await db.query(`update public.subscriptions set tier = 'premium' where fan_id = $1 and creator_id = 'c1'`, [U.fan4]);
  check("등급 변경(subscriber → premium) → 추가 생성 없음", (await cnt(U.fan4)) === 1);
  await db.query(`delete from public.subscriptions where fan_id = $1 and creator_id = 'c1'`, [U.fan4]);
  await db.query(`insert into public.subscriptions (fan_id, creator_id, tier) values ($1, 'c1', 'subscriber')`, [U.fan4]);
  check("취소 후 다시 구독 → 중복 생성 없음 (팬 × 크리에이터 한 번)", (await cnt(U.fan4)) === 1);
  await as(U.fan5, `insert into public.subscriptions (fan_id, creator_id, tier) values ($1, 'c1', 'follow')`, [U.fan5]);
  check("무료 팔로우 → 환영 메시지 없음", (await cnt(U.fan5)) === 0);
  await db.query(`update public.subscriptions set tier = 'subscriber' where fan_id = $1 and creator_id = 'c1'`, [U.fan5]);
  check("무료 → 유료 전환 → 1개", (await cnt(U.fan5)) === 1);
  const w = (await as(U.fan5, `select message, tier from public.subscription_welcomes`)).rows;
  check("팬 본인은 자기 환영 메시지를 읽음 (설정 문구 그대로)", w.length === 1 && w[0].message === "안녕! 구독해 줘서 고마워 :)" && w[0].tier === "subscriber", w);
  check("다른 팬은 0행", (await as(U.fan1, `select 1 from public.subscription_welcomes where fan_id <> $1`, [U.fan1])).rows.length === 0);
  // v0.8.5b: 문구가 없던 때 유료였던 행에도 기본 AI · MOMENTY 안내가 생기므로 "개수" 대신 "자기 채널 것만"을 본다
  const rowsA = (await as(U.creatorA, `select creator_id from public.subscription_welcomes`)).rows;
  const rowsB = (await as(U.creatorB, `select creator_id from public.subscription_welcomes`)).rows;
  check("크리에이터는 자기 채널 것만", rowsA.length >= 2 && rowsA.every((r) => r.creator_id === "c1") && rowsB.every((r) => r.creator_id === "c2"), { a: rowsA.length, b: rowsB.length });
  check("팬이 환영 메시지 위조 insert → permission denied",
    await failsWith(U.fan1, `insert into public.subscription_welcomes (fan_id, creator_id, tier, message) values ($1, 'c1', 'premium', '크리에이터 본인이 보냄')`, [U.fan1], /permission denied/));
  // 메시지를 설정하지 않은 채널
  await db.query(`insert into public.subscriptions (fan_id, creator_id, tier) values ($1, 'c2', 'premium')`, [U.fan2]);
  // v0.8.5b 정책: 문구가 없으면 크리에이터 문구 대신 기본 AI(AI ON) 또는 MOMENTY 안내(AI OFF) — 크리에이터가 쓴 것처럼 보이는 행은 없다
  check("환영 메시지를 설정하지 않은 채널 → 크리에이터 문구 없음 (v0.8.5b: 기본 AI · MOMENTY 안내)",
    (await n(`select count(*)::int as n from public.subscription_welcomes where creator_id = 'c2' and source = 'creator'`)) === 0 &&
      (await n(`select count(*)::int as n from public.subscription_welcomes where creator_id = 'c2' and fan_id = $1`, [U.fan2])) === 1);
  // 차단 관계면 보내지 않는다
  await as(U.creatorA, `insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [U.creatorA, U.newbie]);
  await db.query(`insert into public.subscriptions (fan_id, creator_id, tier) values ($1, 'c1', 'subscriber')`, [U.newbie]);
  check("차단 관계 → 환영 메시지 없음", (await cnt(U.newbie)) === 0);
  await db.query(`delete from public.subscriptions where fan_id = $1 and creator_id = 'c1'`, [U.newbie]);
  await as(U.creatorA, `delete from public.user_blocks where blocked_id = $1`, [U.newbie]);
  check("Human Chat에는 넣지 않음 (본인이 직접 보낸 메시지로 보이지 않게)", (await n(`select count(*)::int as n from public.human_messages`)) === 0);
}

/* ======================= F. Fans 플랜별 ======================= */
console.log("\nF. Fans — 플랜별 필터 · 개수");
{
  const counts = await one(U.creatorA, `select public.fan_manager_tier_counts() as r`);
  const actual = (await db.query(`select tier::text, count(*)::int as n from public.subscriptions where creator_id = 'c1' group by tier`)).rows;
  const byTier = Object.fromEntries(counts.map((c) => [c.tier, c.count]));
  check("등급 목록은 enum 순서 그대로 (follow · subscriber · premium)", counts.map((c) => c.tier).join() === "follow,subscriber,premium", counts);
  check("등급별 개수 = 실제 구독 행", actual.every((a) => byTier[a.tier] === a.n) && Object.values(byTier).reduce((a, b) => a + b, 0) === actual.reduce((a, b) => a + b.n, 0), { counts, actual });
  const follow = await one(U.creatorA, `select public.fan_manager_by_tier('follow') as r`);
  check("무료(follow) 필터 → 무료 팔로워만", follow.items.length === byTier.follow && follow.items.every((i) => i.tier === "follow"), follow.items.map((i) => i.tier));
  const prem = await one(U.creatorA, `select public.fan_manager_by_tier('premium') as r`);
  check("premium 필터", prem.items.length === byTier.premium && prem.items.every((i) => i.tier === "premium"));
  const all = await one(U.creatorA, `select public.fan_manager_by_tier(null) as r`);
  check("전체 = 모든 등급 합", all.items.length === Object.values(byTier).reduce((a, b) => a + b, 0));
  check("항목에는 Fan Manager safe projection만 (AI 대화 · Memory 없음)", !JSON.stringify(all).includes("확인 후 질문") && !("memories" in all.items[0]));
  check("없는 등급 → 거부", await failsWith(U.creatorA, `select public.fan_manager_by_tier('vip')`, [], /invalid tier/));
  const c2 = await one(U.creatorB, `select public.fan_manager_by_tier(null) as r`);
  check("다른 크리에이터(c2)는 자기 채널 팬만", c2.items.every((i) => [U.fan1, U.fan2].includes(i.fanId)) && !c2.items.some((i) => i.fanId === U.follower));
  check("팬이 호출 → not_a_creator", await failsWith(U.fan1, `select public.fan_manager_tier_counts()`, [], /not_a_creator/));
  const small = await one(U.creatorA, `select public.fan_manager_by_tier(null, 2) as r`);
  const next = await one(U.creatorA, `select public.fan_manager_by_tier(null, 2, $1, $2) as r`, [small.nextCursor.startedAt, small.nextCursor.fanId]);
  check("커서로 이어서 (겹침 없음)", small.items.length === 2 && !next.items.some((i) => small.items.some((j) => j.fanId === i.fanId)));
  await as(U.creatorA, `insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [U.creatorA, U.follower]);
  const blocked = await one(U.creatorA, `select public.fan_manager_by_tier('follow') as r`);
  check("차단한 팬은 목록에 '차단함' 표시 유지 (기존 정책)", blocked.items.find((i) => i.fanId === U.follower)?.blocked === true);
  await as(U.creatorA, `delete from public.user_blocks where blocked_id = $1`, [U.follower]);
}

/* ======================= G. 통계 ======================= */
console.log("\nG. 통계 (실제 행 · 날짜별)");
{
  // KST 기준 날짜: 2026-09-10 · 2026-09-11 (정오)
  const at = (d, h = 12) => `${d}T${String(h).padStart(2, "0")}:00:00+09:00`;
  const m1 = (await db.query(`insert into public.moments (creator_id, type, content, visibility, created_at) values ('c1', 'text', '10일 기록 1', 'public', $1) returning id`, [at("2026-09-10")])).rows[0].id;
  await db.query(`insert into public.moments (creator_id, type, content, visibility, created_at) values ('c1', 'text', '10일 기록 2', 'public', $1)`, [at("2026-09-10", 23)]);
  await db.query(`insert into public.moments (creator_id, type, content, visibility, created_at) values ('c1', 'text', '11일 기록', 'public', $1)`, [at("2026-09-11", 1)]);
  await db.query(`insert into public.moments (creator_id, type, content, visibility, created_at) values ('c2', 'text', '다른 채널', 'public', $1)`, [at("2026-09-10")]);
  await db.query(`insert into public.moment_reactions (moment_id, user_id, kind, created_at) values ($1, $2, 'love', $4), ($1, $3, 'love', $4), ($1, $2, 'cheer', $5)`, [m1, U.fan1, U.fan2, at("2026-09-10", 13), at("2026-09-11", 9)]);
  const sub = (await db.query(`insert into public.subscriptions (fan_id, creator_id, tier, started_at) values ($1, 'c2', 'follow', $2) returning id`, [U.follower, at("2026-09-10")])).rows[0];
  await db.query(`update public.subscriptions set started_at = $2 where fan_id = $1 and creator_id = 'c1'`, [U.fan2, at("2026-09-11", 20)]);
  // AI 대화 (superuser로 시각을 정해 넣는다). 10일 기준:
  //   fan2: 14시에 열람 안내 확인 — 13시 메시지 2개(확인 전) · 15시 메시지 2개(확인 후) + AI 답 1개
  //   fan4: c1 안내는 확인하지 않음(c2에만 확인) — 15시 메시지 3개
  //   fan1: 안내 확인이 지금(D 이전) — 10일 16시 메시지 2개는 확인 전
  const convOf = async (fan) =>
    (await db.query(`insert into public.ai_conversations (fan_id, creator_id) values ($1, 'c1') on conflict (fan_id, creator_id) do update set updated_at = now() returning id`, [fan])).rows[0].id;
  const msgs = async (conv, n, when, sender = "fan") => {
    for (let i = 0; i < n; i++) await db.query(`insert into public.ai_messages (conversation_id, sender, content, created_at) values ($1, $2, $3, $4)`, [conv, sender, `통계용 ${sender} ${i}`, when]);
  };
  const c2conv = await convOf(U.fan2);
  await db.query(`insert into public.ai_creator_view_consents (fan_id, creator_id, agreed_at) values ($1, 'c1', $2)`, [U.fan2, at("2026-09-10", 14)]);
  await msgs(c2conv, 2, at("2026-09-10", 13));
  await msgs(c2conv, 2, at("2026-09-10", 15));
  await msgs(c2conv, 1, at("2026-09-10", 15), "ai");
  const c4conv = await convOf(U.fan4);
  await db.query(`insert into public.ai_creator_view_consents (fan_id, creator_id, agreed_at) values ($1, 'c2', $2)`, [U.fan4, at("2026-09-01")]);
  await msgs(c4conv, 3, at("2026-09-10", 15));
  await msgs(await convOf(U.fan1), 2, at("2026-09-10", 16));

  const r = await one(U.creatorA, `select public.creator_analytics('2026-09-10', '2026-09-12') as r`);
  const d = Object.fromEntries(r.days.map((x) => [x.date, x]));
  check("기간의 날짜마다 한 줄 (3일)", r.days.length === 3 && r.days.map((x) => x.date).join() === "2026-09-10,2026-09-11,2026-09-12", r.days.map((x) => x.date));
  check("Moment 수: KST 날짜 기준 (10일 23시 = 10일 · 11일 1시 = 11일)", d["2026-09-10"].moments === 2 && d["2026-09-11"].moments === 1, d);
  check("받은 반응: 반응 시각 기준 (10일 2 · 11일 1)", d["2026-09-10"].reactions === 2 && d["2026-09-11"].reactions === 1, d);
  check("새 팔로워/구독: 시작일 기준 (11일 1)", d["2026-09-11"].newFollowers === 1 && d["2026-09-10"].newFollowers === 0, d);
  check("AI 대화량: 안내 확인 이후 팬 메시지만 (확인 전 · AI 답 제외) → fan2의 2개 · 팬 1명", d["2026-09-10"].aiMessages === 2 && d["2026-09-10"].aiFans === 1, d["2026-09-10"]);
  check("안내를 확인하지 않은 팬(fan4 · 메시지 3개) → 통계에 없음", d["2026-09-10"].aiMessages === 2);
  check("다른 크리에이터(c2)에 한 확인은 c1 통계에 인정되지 않음", d["2026-09-10"].aiFans === 1);
  check("확인 전 메시지(fan1 · fan2 13시) → 통계에 없음", d["2026-09-10"].aiMessages === 2);
  {
    await as(U.fan2, `delete from public.ai_creator_view_consents where creator_id = 'c1'`);
    const off = (await one(U.creatorA, `select public.creator_analytics('2026-09-10', '2026-09-10') as r`)).days[0];
    check("확인 취소 → 그 팬의 AI 활동은 통계에서 모두 빠짐", off.aiMessages === 0 && off.aiFans === 0, off);
    check("확인 취소 중에는 AI 대화 자체가 거부 (새 메시지가 생기지 않음)", await failsWith(U.fan2, `select public.record_ai_exchange($1, 'c1', '취소 중', '답')`, [KEY], /ai_notice_required/));
    await db.query(`insert into public.ai_creator_view_consents (fan_id, creator_id, agreed_at) values ($1, 'c1', $2)`, [U.fan2, at("2026-09-11", 12)]);
    const again = (await one(U.creatorA, `select public.creator_analytics('2026-09-10', '2026-09-11') as r`)).days;
    check("다시 확인 → 새 확인 시각 이후만 (예전 구간은 다시 드러나지 않음)", again.every((x) => x.aiMessages === 0), again);
  }
  check("다른 채널 기록 · 구독은 세지 않음", d["2026-09-10"].moments === 2 && !!sub);
  check("빈 날은 0", d["2026-09-12"].moments === 0 && d["2026-09-12"].reactions === 0 && d["2026-09-12"].aiMessages === 0);
  check("결과에 내용 · 팬 id 없음 (숫자만)", !JSON.stringify(r).includes("통계용") && !JSON.stringify(r).includes(U.fan2));
  const empty = await one(U.creatorA, `select public.creator_analytics('2025-01-01', '2025-01-07') as r`);
  check("기록 없는 기간 → 모두 0 (가짜 숫자 없음)", empty.days.length === 7 && empty.days.every((x) => x.moments === 0 && x.reactions === 0 && x.newFollowers === 0 && x.aiMessages === 0));
  check("93일 넘는 기간 → 거부", await failsWith(U.creatorA, `select public.creator_analytics('2026-01-01', '2026-06-01')`, [], /invalid range/));
  check("시작 > 끝 → 거부", await failsWith(U.creatorA, `select public.creator_analytics('2026-09-12', '2026-09-10')`, [], /invalid range/));
  check("팬이 호출 → not_a_creator", await failsWith(U.fan1, `select public.creator_analytics('2026-09-10', '2026-09-12')`, [], /not_a_creator/));
  const r2 = await one(U.creatorB, `select public.creator_analytics('2026-09-10', '2026-09-10') as r`);
  check("c2는 자기 채널만 (Moment 1 · 반응 0)", r2.days[0].moments === 1 && r2.days[0].reactions === 0 && r2.days[0].newFollowers === 1);
}

/* ======================= H. 학습 답변 상한 ======================= */
console.log("\nH. 학습 답변 전체 상한 (보관 포함 2,000 · 크리에이터별)");
{
  const total = (cid) => n(`select count(*)::int as n from public.creator_style_samples where creator_id = $1`, [cid]);
  const c2Before = await total("c2");
  const c1Now = await total("c1");
  check("정상 추가 (현재 상한 아래)", c1Now < 2000 && !!(await one(U.creatorA, `select public.add_style_training('상한 전', '괜찮아 ㅋㅋ') as r`)));
  // 보관된 이전 답으로 1,996개까지 채운다 (superuser) — 보관도 상한에 포함되는지
  const fill = 1996 - (await total("c1"));
  await db.query(
    `insert into public.creator_style_samples (creator_id, source, prompt_key, fan_message, reply, archived_at)
     select 'c1', 'onboarding', 'today_1', '오늘 뭐했어?', '보관 ' || g, now() from generate_series(1, $1) g`,
    [fill],
  );
  check("보관 행 포함 1,996개", (await total("c1")) === 1996);
  const redo = await one(U.creatorA, `select public.save_style_answers('[{"key":"today_1","reply":"다시 답함"}]'::jsonb) as r`);
  const redoRows = (await db.query(`select count(*) filter (where archived_at is null)::int as active from public.creator_style_samples where creator_id = 'c1' and prompt_key = 'today_1'`)).rows[0];
  check("다시 답하기 → 이전 답 보관 · 새 답 1개 활성 (1,997)", !!redo && redoRows.active === 1 && (await total("c1")) === 1997, redoRows);
  const three = JSON.stringify(["greeting_1", "praise_1", "comfort_1"].map((key) => ({ key, reply: "상한까지" })));
  check("정확히 2,000까지 허용 (3개 더)", !(await failsWith(U.creatorA, `select public.save_style_answers($1::jsonb)`, [three], /./)) && (await total("c1")) === 2000);
  check("2,001번째 → style sample limit 거부", await failsWith(U.creatorA, `select public.save_style_answers('[{"key":"today_2","reply":"넘침"}]'::jsonb)`, [], /style sample limit/));
  check("추가 학습도 같은 상한", await failsWith(U.creatorA, `select public.add_style_training('q', 'a')`, [], /style sample limit|too many samples/));
  check("거부돼도 기존 답은 지워지지 않음 (2,000 그대로)", (await total("c1")) === 2000);
  check("다른 크리에이터(c2)는 영향 없음 · 답 추가 가능", (await total("c2")) === c2Before && !(await failsWith(U.creatorB, `select public.save_style_answers('[{"key":"today_2","reply":"c2 답"}]'::jsonb)`, [], /./)));
}

/* ======================= 권한 목록 ======================= */
console.log("\n권한");
{
  const grants = (await db.query(
    `select routine_name, grantee from information_schema.routine_privileges
     where routine_schema = 'public' and routine_name in ('avatar_readiness','save_avatar_basics','save_style_answers','add_style_training','reset_style_training','confirm_avatar_boundaries','save_welcome_message','acknowledge_ai_notice','creator_fan_ai_messages','fan_manager_tier_counts','fan_manager_by_tier','creator_analytics')
       and grantee in ('anon', 'PUBLIC')`)).rows;
  check("새 함수: anon · PUBLIC 실행 권한 없음", grants.length === 0, grants);
  const tables = (await db.query(
    `select table_name, privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')
       and table_name in ('avatar_training_prompts','creator_style_samples','creator_avatar_settings','subscription_welcomes')`)).rows;
  check("학습 질문 · 학습 답변 · Avatar 설정 · 환영 메시지: 앱 사용자 쓰기 권한 없음", tables.length === 0, tables);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
