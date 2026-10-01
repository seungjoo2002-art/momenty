/**
 * v0.8.5 실제 Supabase 검증 (API · LLM 없음) — 적용된 migration을 실제 사용자 JWT로 공격 · 검사한다.
 *
 *   npm run test:avatar-live -- --confirm-dev
 *
 *   A 스키마 존재 · RLS · 공격 (크리에이터 간 · 팬 · 학습 답변 우회 · 준비 전 ON · 다른 채널 통계)
 *   D 환영 메시지 (팔로우 없음 · 유료 전환 1회 · 같은 등급/유료→유료/재구독 · 동시 요청 · 차단)
 *   E Fans 플랜 개수 = DB · 필터 · 다른 크리에이터 팬 접근 거부
 *   F AI 대화 열람 동의 (확인 전 비공개 · 이후만 · 취소 · 재확인 · Fan Memory 비공개)
 *   G 통계 (Moment · 반응 · 새 관계 · 동의 이후 AI 메시지 5/3 · 취소 · 재확인 2 · 다른 크리에이터 동의 무관)
 *
 * · 테스트 계정(momenty-av-…)만 만들고 지운다. admin(service role)은 결제 서버 역할(유료 등급)과
 *   "동의 전 과거 메시지" 준비(앱 경로로는 만들 수 없는 과거 데이터) · 대조용 읽기 · 정리에만 쓴다.
 * · AI 대화 기록은 record_ai_exchange(서버 키 + 팬 JWT) — 모델 호출 아님.
 */
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanupTestUsers, registerCleanup } from "./support/cleanup.mjs";
import { makeAvatarReady } from "./support/avatarLive.mjs";

process.loadEnvFile(".env.local");
if (!process.argv.includes("--confirm-dev")) {
  console.error("실제 Supabase에 테스트 계정을 만들었다가 지우는 테스트예요. --confirm-dev 를 붙여 실행하세요.");
  process.exit(1);
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SERVER_KEY = process.env.AI_SERVER_KEY ?? "";
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

let passed = 0;
let failed = 0;
async function step(name: string, fn: () => Promise<boolean | [boolean] | [boolean, unknown]>) {
  let ok = false;
  let detail: unknown;
  try {
    const r = await fn();
    [ok, detail] = Array.isArray(r) ? [r[0], r[1]] : [r, undefined];
  } catch (e) {
    detail = e instanceof Error ? e.message : String(e);
  }
  if (ok) passed++;
  else failed++;
  console.log(`   ${ok ? "✓" : "✗"} ${name}${!ok && detail !== undefined ? `  → ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
}
const section = (t: string) => console.log(`\n[${t}]`);
const denied = (e: { message?: string; code?: string } | null, re: RegExp) => !!e && re.test(`${e.code ?? ""} ${e.message ?? ""}`);

const stamp = Date.now().toString(36);
const userIds: string[] = [];
registerCleanup(admin, userIds);
interface U {
  sb: SupabaseClient;
  uid: string;
}
async function newUser(tag: string): Promise<U> {
  const sb = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `momenty-av-${tag}-${stamp}@gmail.com`;
  const { data, error } = await sb.auth.signUp({ email, password: `Av-${randomBytes(9).toString("base64url")}1a`, options: { data: { nickname: `AV ${tag}` } } });
  if (error) throw error;
  if (!data.session) throw new Error("세션 없음 (Confirm email?)");
  userIds.push(data.user!.id);
  return { sb, uid: data.user!.id };
}
const kstToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
const rec = (u: U, cid: string, msg: string) =>
  u.sb.rpc("record_ai_exchange", { p_server_key: SERVER_KEY, p_creator_id: cid, p_fan_message: msg, p_ai_reply: `답: ${msg}`, p_grounded_moment_ids: [], p_context_types: [], p_provider: null, p_model: null, p_boundary: null });
const todayAi = async (u: U) => {
  const { data, error } = await u.sb.rpc("creator_analytics", { p_from: kstToday(), p_to: kstToday() });
  if (error) throw error;
  return data.days[0] as { moments: number; reactions: number; newFollowers: number; aiMessages: number; aiFans: number };
};

try {
  if (!SERVER_KEY) throw new Error("AI_SERVER_KEY가 .env.local에 필요해요 (record_ai_exchange 준비용)");
  const A = await newUser("ca");
  const B = await newUser("cb");
  const F1 = await newUser("f1");
  const F2 = await newUser("f2");
  const F3 = await newUser("f3");
  const N = await newUser("n");
  const FB = await newUser("fb");
  const mk = async (u: U, tag: string, job: string) => {
    const { data, error } = await u.sb.from("creators").insert({ profile_id: u.uid, name: `AV ${tag}`, handle: `av${tag}.${stamp}`, category: "art", job, bio: `${tag} 소개` }).select("id, persona_enabled, job").single();
    if (error) throw error;
    return data as { id: string; persona_enabled: boolean; job: string };
  };
  const ca = await mk(A, "a", "유튜버");
  const cb = await mk(B, "b", "작가");
  console.log(`준비: 크리에이터 A(${ca.id}) · B(${cb.id}) · 팬 F1 F2 F3 N FB`);

  section("A · 스키마 적용 상태 (실제 DB)");
  for (const t of ["avatar_training_prompts", "creator_style_samples", "creator_avatar_settings", "ai_creator_view_consents", "subscription_welcomes"]) {
    await step(`public.${t} 존재`, async () => {
      const { error } = await admin.from(t).select("*", { head: true, count: "exact" });
      return [!error, error?.message];
    });
  }
  await step("학습 질문 40개 · 필수 9개 (migration seed)", async () => {
    const { data } = await admin.from("avatar_training_prompts").select("key, required");
    return [data?.length === 40 && data.filter((p) => p.required).length === 9, data?.length];
  });
  await step("creator_facts.basic_key · undisclosed 컬럼", async () => {
    const { error } = await admin.from("creator_facts").select("basic_key, undisclosed").limit(1);
    return [!error, error?.message];
  });
  await step("새 크리에이터 AI 문답 기본 OFF (persona_enabled default false)", async () => [!ca.persona_enabled && !cb.persona_enabled, [ca.persona_enabled, cb.persona_enabled]]);
  await step("직업 41자 → 거부 (creators_job_length 제약)", async () => {
    const { error } = await A.sb.from("creators").update({ job: "가".repeat(41) }).eq("id", ca.id);
    return [denied(error, /creators_job_length|23514/), error?.message];
  });
  await step("새 함수 12개 존재 (인증 사용자 실행)", async () => {
    const calls = await Promise.all([
      A.sb.rpc("avatar_readiness"),
      A.sb.rpc("fan_manager_tier_counts"),
      A.sb.rpc("fan_manager_by_tier", { p_tier: null }),
      A.sb.rpc("creator_analytics", { p_from: kstToday(), p_to: kstToday() }),
    ]);
    return [calls.every((c) => !c.error), calls.map((c) => c.error?.message)];
  });
  await step("비로그인(anon) → 새 함수 실행 불가", async () => {
    const anon = createClient(URL_, KEY, { auth: { persistSession: false } });
    const r = await Promise.all([anon.rpc("avatar_readiness"), anon.rpc("creator_analytics", { p_from: kstToday(), p_to: kstToday() }), anon.rpc("acknowledge_ai_notice", { p_creator_id: ca.id })]);
    return [r.every((x) => !!x.error), r.map((x) => x.error?.code)];
  });
  await step("private 함수는 Data API로 호출 불가", async () => {
    const { error } = await A.sb.schema("private").rpc("avatar_readiness", { p_creator_id: ca.id });
    return [!!error, error?.message];
  });

  section("A · 준비 전 AI ON 우회 · 학습 데이터 우회");
  await step("준비 전 API로 직접 ON → avatar_not_ready", async () => {
    const { error } = await A.sb.from("creators").update({ persona_enabled: true }).eq("id", ca.id);
    return [denied(error, /avatar_not_ready/), error?.message];
  });
  await step("service role로도 준비 전 ON → avatar_not_ready (DB trigger)", async () => {
    const { error } = await admin.from("creators").update({ persona_enabled: true }).eq("id", ca.id);
    return [denied(error, /avatar_not_ready/), error?.message];
  });
  await makeAvatarReady(A.sb, ca.id);
  await makeAvatarReady(B.sb, cb.id);
  await step("준비 완료 → ON 확인 · OFF · 다시 ON", async () => {
    const off = await A.sb.from("creators").update({ persona_enabled: false }).eq("id", ca.id).select("persona_enabled");
    const on = await A.sb.from("creators").update({ persona_enabled: true }).eq("id", ca.id).select("persona_enabled");
    return [!off.error && off.data?.[0]?.persona_enabled === false && !on.error && on.data?.[0]?.persona_enabled === true, [off.error, on.error]];
  });
  const sample = (await A.sb.from("creator_style_samples").select("id, reply").eq("creator_id", ca.id).limit(1).single()).data!;
  await step("학습 답변 직접 UPDATE / DELETE / INSERT → 모두 거부 · 값 그대로", async () => {
    const u = await A.sb.from("creator_style_samples").update({ reply: "덮어쓰기" }).eq("id", sample.id);
    const d = await A.sb.from("creator_style_samples").delete().eq("id", sample.id);
    const i = await A.sb.from("creator_style_samples").insert({ creator_id: ca.id, source: "onboarding", prompt_key: "today_1", fan_message: "x", reply: "y" });
    const after = (await admin.from("creator_style_samples").select("reply").eq("id", sample.id).single()).data;
    return [!!u.error && !!d.error && !!i.error && after?.reply === sample.reply, [u.error?.code, d.error?.code, i.error?.code]];
  });
  await step("말투 칸(creator_personas.formality) 직접 수정 → 거부", async () => {
    const { error } = await A.sb.from("creator_personas").update({ formality: "casual" }).eq("creator_id", ca.id);
    return [denied(error, /42501|permission/), error?.message];
  });
  await step("basic_key 직접 insert → 거부 (기본정보는 함수로만)", async () => {
    const { error } = await A.sb.from("creator_facts").insert({ creator_id: ca.id, content: "가짜", basic_key: "hobby" });
    return [denied(error, /42501|permission/), error?.message];
  });
  await step("기본정보 수정 → 실제 DB 반영 (한 행)", async () => {
    const { error } = await A.sb.rpc("save_avatar_basics", { p_job: "유튜버 · 작가", p_items: { hobby: { value: "필름 카메라" } } });
    const rows = (await admin.from("creator_facts").select("content").eq("creator_id", ca.id).eq("basic_key", "hobby")).data;
    const job = (await admin.from("creators").select("job").eq("id", ca.id).single()).data?.job;
    return [!error && rows?.length === 1 && rows[0].content === "취미: 필름 카메라" && job === "유튜버 · 작가", [error?.message, rows, job]];
  });
  await step("추가 학습 저장 (avatar_training)", async () => {
    const { error } = await A.sb.rpc("add_style_training", { p_fan_message: "라이브 언제야?", p_reply: "곧 알려 줄게 ㅋㅋ" });
    return [!error, error?.message];
  });
  await step("다시 답하기 → 이전 답 보관 · ON 유지", async () => {
    await A.sb.rpc("save_style_answers", { p_items: [{ key: "today_1", reply: "오늘은 편집했어 ㅋㅋ" }] });
    const rows = (await admin.from("creator_style_samples").select("archived_at").eq("creator_id", ca.id).eq("prompt_key", "today_1")).data ?? [];
    const on = (await admin.from("creators").select("persona_enabled").eq("id", ca.id).single()).data?.persona_enabled;
    return [rows.length === 2 && rows.filter((r) => !r.archived_at).length === 1 && on === true, [rows, on]];
  });

  section("A · 크리에이터 간 · 팬 접근");
  await step("B → A 학습 답변 조회 0행 · 팬 → 0행", async () => {
    const b = await B.sb.from("creator_style_samples").select("id").eq("creator_id", ca.id);
    const f = await F1.sb.from("creator_style_samples").select("id");
    return [(b.data ?? []).length === 0 && (f.data ?? []).length === 0, [b.data?.length, f.data?.length]];
  });
  await step("B → A Avatar 설정 조회 0행 · 팬 → 0행", async () => {
    await A.sb.rpc("save_welcome_message", { p_message: "A의 환영 메시지" });
    const b = await B.sb.from("creator_avatar_settings").select("*").eq("creator_id", ca.id);
    const f = await F1.sb.from("creator_avatar_settings").select("*");
    return [(b.data ?? []).length === 0 && (f.data ?? []).length === 0, [b.data?.length, f.data?.length]];
  });
  await step("B의 저장 함수는 B 채널에만 (A 환영 메시지 그대로)", async () => {
    await B.sb.rpc("save_welcome_message", { p_message: "B 메시지" });
    const a = (await admin.from("creator_avatar_settings").select("welcome_message").eq("creator_id", ca.id).single()).data;
    return [a?.welcome_message === "A의 환영 메시지", a];
  });
  await step("B → A 기본정보(Facts) 수정 0행", async () => {
    const { data } = await B.sb.from("creator_facts").update({ content: "해킹" }).eq("creator_id", ca.id).select("id");
    return [(data ?? []).length === 0, data?.length];
  });
  await step("B → A 켜기/끄기 0행", async () => {
    const { data } = await B.sb.from("creators").update({ persona_enabled: false }).eq("id", ca.id).select("id");
    return [(data ?? []).length === 0, data?.length];
  });
  await step("팬 → 크리에이터 함수 (통계 · 플랜) → not_a_creator", async () => {
    const r = await Promise.all([F1.sb.rpc("creator_analytics", { p_from: kstToday(), p_to: kstToday() }), F1.sb.rpc("fan_manager_tier_counts"), F1.sb.rpc("save_style_answers", { p_items: [{ key: "today_1", reply: "x" }] })]);
    return [r.every((x) => denied(x.error, /not_a_creator/)), r.map((x) => x.error?.message)];
  });

  section("D · 구독 환영 메시지");
  await A.sb.rpc("save_welcome_message", { p_message: "안녕! 구독해 줘서 고마워 :)\n앞으로 이야기 많이 나눠 보자." });
  const welcomes = async (fan: U, cid = ca.id) => (await admin.from("subscription_welcomes").select("message, tier").eq("fan_id", fan.uid).eq("creator_id", cid)).data ?? [];
  await step("팬이 무료 팔로우 → 환영 메시지 없음", async () => {
    const { error } = await F3.sb.from("subscriptions").insert({ fan_id: F3.uid, creator_id: ca.id, tier: "follow" });
    return [!error && (await welcomes(F3)).length === 0, error?.message];
  });
  await step("무료 → 유료(결제 서버 역할) → 정확히 1개 · 설정 문구 그대로", async () => {
    await admin.from("subscriptions").update({ tier: "subscriber" }).eq("fan_id", F3.uid).eq("creator_id", ca.id);
    const w = await welcomes(F3);
    return [w.length === 1 && w[0].message === "안녕! 구독해 줘서 고마워 :)\n앞으로 이야기 많이 나눠 보자.", w];
  });
  await step("같은 등급으로 다시 update · 유료→유료(premium) · 다시 읽기 → 여전히 1개", async () => {
    await admin.from("subscriptions").update({ tier: "subscriber" }).eq("fan_id", F3.uid).eq("creator_id", ca.id);
    await admin.from("subscriptions").update({ tier: "premium" }).eq("fan_id", F3.uid).eq("creator_id", ca.id);
    await admin.from("subscriptions").update({ tier: "premium" }).eq("fan_id", F3.uid).eq("creator_id", ca.id);
    return [(await welcomes(F3)).length === 1, (await welcomes(F3)).length];
  });
  await step("취소 후 다시 유료 구독 → 추가 생성 없음", async () => {
    await admin.from("subscriptions").delete().eq("fan_id", F3.uid).eq("creator_id", ca.id);
    await admin.from("subscriptions").insert({ fan_id: F3.uid, creator_id: ca.id, tier: "subscriber" });
    return [(await welcomes(F3)).length === 1, (await welcomes(F3)).length];
  });
  await step("동시 요청 8개(follow↔유료 전환 경합) → 여전히 최대 1개", async () => {
    await F2.sb.from("subscriptions").insert({ fan_id: F2.uid, creator_id: ca.id, tier: "follow" });
    await Promise.all(Array.from({ length: 8 }, (_, i) => admin.from("subscriptions").update({ tier: i % 2 ? "premium" : "subscriber" }).eq("fan_id", F2.uid).eq("creator_id", ca.id)));
    const w = await welcomes(F2);
    return [w.length === 1, w.length];
  });
  await step("차단 관계(크리에이터가 팬 차단) → 유료 전환해도 생성 안 됨", async () => {
    await A.sb.from("user_blocks").insert({ blocker_id: A.uid, blocked_id: N.uid });
    await admin.from("subscriptions").insert({ fan_id: N.uid, creator_id: ca.id, tier: "subscriber" });
    const w = await welcomes(N);
    await A.sb.from("user_blocks").delete().eq("blocked_id", N.uid);
    return [w.length === 0, w.length];
  });
  await step("팬은 자기 것만 · 다른 팬 0행 · 직접 insert 거부 · Human Chat에 없음", async () => {
    const own = await F3.sb.from("subscription_welcomes").select("message");
    const other = await F1.sb.from("subscription_welcomes").select("id").eq("fan_id", F3.uid);
    const ins = await F1.sb.from("subscription_welcomes").insert({ fan_id: F1.uid, creator_id: ca.id, tier: "premium", message: "위조" });
    const hm = (await admin.from("human_conversations").select("id").eq("creator_id", ca.id)).data ?? [];
    return [(own.data ?? []).length === 1 && (other.data ?? []).length === 0 && !!ins.error && hm.length === 0, [own.data?.length, other.data?.length, ins.error?.code, hm.length]];
  });
  await step("B는 A 채널 환영 메시지를 볼 수 없음", async () => {
    const { data } = await B.sb.from("subscription_welcomes").select("id").eq("creator_id", ca.id);
    return [(data ?? []).length === 0, data?.length];
  });

  section("E · Fans 플랜 · 개수 · 격리");
  await admin.from("subscriptions").insert({ fan_id: F1.uid, creator_id: ca.id, tier: "subscriber" });
  await admin.from("subscriptions").insert({ fan_id: FB.uid, creator_id: cb.id, tier: "premium" });
  await step("등급별 개수 = 실제 DB (enum 순서 · 없는 등급 0)", async () => {
    const { data, error } = await A.sb.rpc("fan_manager_tier_counts");
    const rows = (await admin.from("subscriptions").select("tier").eq("creator_id", ca.id)).data ?? [];
    const actual: Record<string, number> = {};
    for (const r of rows) actual[r.tier] = (actual[r.tier] ?? 0) + 1;
    const ok = !error && (data as { tier: string; count: number }[]).every((c) => c.count === (actual[c.tier] ?? 0)) && (data as { tier: string }[]).map((c) => c.tier).join() === "follow,subscriber,premium";
    return [ok, { data, actual }];
  });
  await step("필터: 각 등급 목록 = 그 등급 팬만 · 전체 = 합", async () => {
    const all = (await A.sb.rpc("fan_manager_by_tier", { p_tier: null })).data.items as { tier: string; fanId: string }[];
    const per = await Promise.all(["follow", "subscriber", "premium"].map(async (t) => ((await A.sb.rpc("fan_manager_by_tier", { p_tier: t })).data.items as { tier: string }[])));
    const total = (await admin.from("subscriptions").select("fan_id").eq("creator_id", ca.id)).data?.length;
    return [all.length === total && per.every((l, i) => l.every((x) => x.tier === ["follow", "subscriber", "premium"][i])) && per.reduce((n, l) => n + l.length, 0) === total, { all: all.length, total, per: per.map((l) => l.length) }];
  });
  await step("없는 등급 → 거부", async () => {
    const { error } = await A.sb.rpc("fan_manager_by_tier", { p_tier: "vip" });
    return [denied(error, /invalid tier/), error?.message];
  });
  await step("A가 B의 팬(FB) 상세 · AI 대화 조회 → fan_not_found", async () => {
    const a = await A.sb.rpc("fan_manager_fan", { p_fan_id: FB.uid });
    const b = await A.sb.rpc("creator_fan_ai_messages", { p_fan_id: FB.uid });
    return [denied(a.error, /fan_not_found/) && denied(b.error, /fan_not_found/), [a.error?.message, b.error?.message]];
  });
  await step("B 목록 · 개수에 A 팬 없음", async () => {
    const items = (await B.sb.rpc("fan_manager_by_tier", { p_tier: null })).data.items as { fanId: string }[];
    return [items.length === 1 && items[0].fanId === FB.uid, items.map((i) => i.fanId)];
  });

  section("F · AI 대화 열람 동의");
  // 앱 경로로는 동의 전 메시지를 만들 수 없다 (AI 대화가 거부됨) — 과거 대화(예: v0.8.5 이전)를 service role로 준비
  const conv = (await admin.from("ai_conversations").insert({ fan_id: F1.uid, creator_id: ca.id }).select("id").single()).data!.id as string;
  const past = Date.now() - 60 * 60_000;
  for (let i = 0; i < 5; i++) {
    const at = new Date(past + i * 1000).toISOString();
    await admin.from("ai_messages").insert([{ conversation_id: conv, sender: "fan", content: `동의 전 비밀 ${i}`, created_at: at }, { conversation_id: conv, sender: "ai", content: `동의 전 답 ${i}`, created_at: at }]);
  }
  await step("확인 전: 팬 AI 대화 → ai_notice_required (메시지 저장 안 됨)", async () => {
    const { error } = await rec(F1, ca.id, "확인 전 시도");
    return [denied(error, /ai_notice_required/), error?.message];
  });
  await step("확인 전: 크리에이터 열람 consented false · 0개", async () => {
    const { data, error } = await A.sb.rpc("creator_fan_ai_messages", { p_fan_id: F1.uid });
    return [!error && data.consented === false && data.messages.length === 0, error ?? data];
  });
  await step("확인 전: 통계 AI 0", async () => {
    const d = await todayAi(A);
    return [d.aiMessages === 0 && d.aiFans === 0, d];
  });
  await F1.sb.rpc("acknowledge_ai_notice", { p_creator_id: ca.id });
  for (const m of ["확인 후 1", "확인 후 2", "확인 후 3"]) {
    const { error } = await rec(F1, ca.id, m);
    if (error) throw error;
  }
  await step("확인 후: 크리에이터는 확인 이후 6개(팬 3 · AI 3)만 · 이전 5쌍은 숨김", async () => {
    const { data } = await A.sb.rpc("creator_fan_ai_messages", { p_fan_id: F1.uid });
    const texts = (data.messages as { content: string }[]).map((m) => m.content);
    return [data.consented === true && texts.length === 6 && !texts.some((t) => t.startsWith("동의 전")), texts];
  });
  await step("통계 = 확인 이후 팬 메시지 3 · 팬 1 (동의 전 5 제외)", async () => {
    const d = await todayAi(A);
    return [d.aiMessages === 3 && d.aiFans === 1, d];
  });
  await step("다른 크리에이터(B)에 한 확인은 A에 인정 안 됨", async () => {
    await admin.from("subscriptions").insert({ fan_id: F2.uid, creator_id: cb.id, tier: "subscriber" });
    await F2.sb.rpc("acknowledge_ai_notice", { p_creator_id: cb.id });
    const c2 = (await admin.from("ai_conversations").insert({ fan_id: F2.uid, creator_id: ca.id }).select("id").single()).data!.id;
    await admin.from("ai_messages").insert({ conversation_id: c2, sender: "fan", content: "B에만 동의한 팬", created_at: new Date().toISOString() });
    const view = await A.sb.rpc("creator_fan_ai_messages", { p_fan_id: F2.uid });
    const d = await todayAi(A);
    const r = await rec(F2, ca.id, "A에게 시도");
    return [view.data?.consented === false && d.aiMessages === 3 && denied(r.error, /ai_notice_required/), [view.data?.consented, d, r.error?.message]];
  });
  await step("Fan Memory 원문은 크리에이터에게 없음 (직접 조회 0 · 열람 결과에 없음)", async () => {
    await F1.sb.from("fan_ai_settings").insert({ fan_id: F1.uid, memory_enabled: true });
    await F1.sb.rpc("record_fan_memories", { p_server_key: SERVER_KEY, p_creator_id: ca.id, p_items: [{ category: "interest", content: "기억 비밀 필름 사진" }], p_source_message_id: null });
    const mem = await A.sb.from("fan_memories").select("id");
    const raw = await A.sb.from("ai_messages").select("id");
    const conv2 = await A.sb.from("ai_conversations").select("id");
    const view = await A.sb.rpc("creator_fan_ai_messages", { p_fan_id: F1.uid });
    const fm = await A.sb.rpc("fan_manager_fan", { p_fan_id: F1.uid });
    const stored = (await admin.from("fan_memories").select("id").eq("fan_id", F1.uid)).data?.length;
    return [
      (mem.data ?? []).length === 0 && (raw.data ?? []).length === 0 && (conv2.data ?? []).length === 0 && stored === 1 && !JSON.stringify(view.data).includes("기억 비밀") && !JSON.stringify(fm.data).includes("기억 비밀"),
      { mem: mem.data?.length, raw: raw.data?.length, stored },
    ];
  });
  await step("다른 크리에이터(B) → F1 AI 대화 fan_not_found", async () => {
    const { error } = await B.sb.rpc("creator_fan_ai_messages", { p_fan_id: F1.uid });
    return [denied(error, /fan_not_found/), error?.message];
  });
  await step("확인 취소 → 크리에이터 열람 0 · 통계 0 · 팬 AI 대화 ai_notice_required", async () => {
    await F1.sb.from("ai_creator_view_consents").delete().eq("creator_id", ca.id);
    const view = await A.sb.rpc("creator_fan_ai_messages", { p_fan_id: F1.uid });
    const d = await todayAi(A);
    const r = await rec(F1, ca.id, "취소 중 시도");
    return [view.data.consented === false && view.data.messages.length === 0 && d.aiMessages === 0 && denied(r.error, /ai_notice_required/), [view.data, d, r.error?.message]];
  });
  await new Promise((r) => setTimeout(r, 1500));
  await F1.sb.rpc("acknowledge_ai_notice", { p_creator_id: ca.id });
  for (const m of ["재확인 1", "재확인 2"]) {
    const { error } = await rec(F1, ca.id, m);
    if (error) throw error;
  }
  await step("재확인 → 새 확인 이후 2쌍만 열람 (이전 구간 다시 노출 안 됨)", async () => {
    const { data } = await A.sb.rpc("creator_fan_ai_messages", { p_fan_id: F1.uid });
    const texts = (data.messages as { content: string }[]).map((m) => m.content);
    return [texts.length === 4 && texts.every((t) => t.includes("재확인")), texts];
  });
  await step("재확인 → 통계 = 새 2개 (확인 후 3 · 동의 전 5 제외)", async () => {
    const d = await todayAi(A);
    return [d.aiMessages === 2 && d.aiFans === 1, d];
  });

  section("G · 통계 (실제 데이터 대조)");
  const m1 = (await A.sb.from("moments").insert({ creator_id: ca.id, type: "text", content: "통계 기록 1", visibility: "public" }).select("id").single()).data!.id;
  const m2 = (await A.sb.from("moments").insert({ creator_id: ca.id, type: "text", content: "통계 기록 2", visibility: "public" }).select("id").single()).data!.id;
  for (const [u, m, k] of [[F1, m1, "love"], [F1, m1, "cheer"], [F3, m2, "love"]] as const) {
    const { error } = await u.sb.from("moment_reactions").insert({ moment_id: m, user_id: u.uid, kind: k });
    if (error) throw error;
  }
  await step("오늘: Moment 2 · 반응 3 · 새 관계 = 오늘 시작한 A 구독 수 (DB 대조)", async () => {
    const d = await todayAi(A);
    const subs = (await admin.from("subscriptions").select("started_at").eq("creator_id", ca.id)).data ?? [];
    const todaySubs = subs.filter((s) => new Date(s.started_at).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) === kstToday()).length;
    return [d.moments === 2 && d.reactions === 3 && d.newFollowers === todaySubs, { d, todaySubs }];
  });
  await step("Moment별 반응 (moment_feed) = 2 · 1", async () => {
    const { data } = await A.sb.from("moment_feed").select("id, love_count, cheer_count, touched_count, smile_count").in("id", [m1, m2]);
    const tot = Object.fromEntries((data ?? []).map((r) => [r.id, r.love_count + r.cheer_count + r.touched_count + r.smile_count]));
    return [tot[m1] === 2 && tot[m2] === 1, tot];
  });
  await step("B 통계에는 A 데이터 없음 (B 오늘 Moment 0 · AI 0)", async () => {
    const d = await todayAi(B);
    return [d.moments === 0 && d.aiMessages === 0 && d.reactions === 0, d];
  });
  await step("과거 날짜 선택 → 0 (가짜 숫자 없음) · 93일 넘는 기간 거부", async () => {
    const { data } = await A.sb.rpc("creator_analytics", { p_from: "2025-01-01", p_to: "2025-01-03" });
    const big = await A.sb.rpc("creator_analytics", { p_from: "2025-01-01", p_to: "2025-06-01" });
    return [(data.days as { moments: number; reactions: number; aiMessages: number; newFollowers: number }[]).every((x) => !x.moments && !x.reactions && !x.aiMessages && !x.newFollowers) && denied(big.error, /invalid range/), data.days];
  });
  await step("통계 결과에 내용 · 팬 id 없음", async () => {
    const { data } = await A.sb.rpc("creator_analytics", { p_from: kstToday(), p_to: kstToday() });
    const s = JSON.stringify(data);
    return [!s.includes("재확인") && !s.includes(F1.uid), s.slice(0, 200)];
  });
} catch (e) {
  failed++;
  console.error("테스트 준비/실행 실패:", e instanceof Error ? e.message : e);
} finally {
  const r = await cleanupTestUsers(admin, userIds);
  console.log(`\n정리: 계정 ${r.users}명 · 파일 ${r.files}개 · 신고 ${r.reports}개 · 실패 ${r.failed.length}`);
  console.log(`\n${passed} passed, ${failed} failed`);
  setTimeout(() => process.exit(failed ? 1 : 0), 500);
}
