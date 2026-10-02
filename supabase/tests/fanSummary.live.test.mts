/**
 * v0.9 AI 팬 요약 입력 — 실제 Supabase 검증 (LLM 호출 없음). Route와 같은 함수(collectFanSummaryInput)를
 * 크리에이터 본인 세션으로 실행해, 모델에 들어갈 입력에 무엇이 들어가고 빠지는지 확인한다.
 *
 *   npm run test:fan-summary-live -- --confirm-dev
 *
 *   · Fan Memory 원문 · 내 메모 → 입력에 없음
 *   · 안내 확인 전 AI 대화 → 없음 / 확인 이후 → 있음 / 확인 취소 → 0개 / 재확인 → 새 확인 이후만
 *   · 직접 대화(팬 · 크리에이터) → 있음 · 다른 크리에이터 → fan_not_found · 크리에이터 아님 → not_a_creator
 *
 * · 테스트 계정(momenty-av-fs…)만 만들고 지운다. admin(service role)은 결제 서버 역할(유료 등급)과
 *   "동의 전 과거 메시지" 준비(앱 경로로는 만들 수 없음) · 정리에만 쓴다.
 * · AI 대화 기록은 record_ai_exchange(서버 키 + 팬 JWT) — 모델 호출 아님.
 */
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { collectFanSummaryInput, FanSummaryAccessError } from "../../src/lib/ai/fanSummary";
import { aiFanSummaryPrompt, type SummaryInput } from "../../src/lib/fanSummary";
import { cleanupTestUsers, registerCleanup } from "./support/cleanup.mjs";
import { acknowledgeAiNotice, makeAvatarReady } from "./support/avatarLive.mjs";

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
async function step(name: string, fn: () => Promise<boolean | [boolean, unknown]>) {
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

const stamp = Date.now().toString(36);
const userIds: string[] = [];
registerCleanup(admin, userIds);
interface U {
  sb: SupabaseClient;
  uid: string;
}
async function newUser(tag: string): Promise<U> {
  const sb = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `momenty-av-fs${tag}-${stamp}@gmail.com`;
  const { data, error } = await sb.auth.signUp({ email, password: `Fs-${randomBytes(9).toString("base64url")}1a`, options: { data: { nickname: `FS ${tag}` } } });
  if (error) throw error;
  if (!data.session) throw new Error("세션 없음 (Confirm email?)");
  userIds.push(data.user!.id);
  return { sb, uid: data.user!.id };
}
const rec = (u: U, cid: string, msg: string) =>
  u.sb.rpc("record_ai_exchange", { p_server_key: SERVER_KEY, p_creator_id: cid, p_fan_message: msg, p_ai_reply: `답: ${msg}`, p_grounded_moment_ids: [], p_context_types: [], p_provider: null, p_model: null, p_boundary: null });
const text = (i: SummaryInput) => {
  const p = aiFanSummaryPrompt(i);
  return JSON.stringify(i) + p.system + p.user;
};
const SECRETS = ["NOTE_SECRET_FS", "MEMORY_SECRET_FS", "PRE_CONSENT_SECRET_FS"];

try {
  if (!SERVER_KEY) throw new Error("AI_SERVER_KEY가 .env.local에 필요해요 (record_ai_exchange 준비용)");
  const C = await newUser("c");
  const L = await newUser("l");
  const F = await newUser("f");
  const N = await newUser("n");
  const mk = async (u: U, tag: string) => {
    const { data, error } = await u.sb.from("creators").insert({ profile_id: u.uid, name: `FS ${tag}`, handle: `fs${tag}.${stamp}`, category: "art" }).select("id").single();
    if (error) throw error;
    return data.id as string;
  };
  const cid = await mk(C, "c");
  await mk(L, "l");
  await makeAvatarReady(C.sb, cid);
  {
    const { error } = await admin.from("subscriptions").insert({ fan_id: F.uid, creator_id: cid, tier: "premium" });
    if (error) throw error;
  }
  {
    const { error } = await C.sb.from("creator_fan_notes").insert({ creator_id: cid, fan_id: F.uid, content: "NOTE_SECRET_FS 내 메모" });
    if (error) throw error;
  }
  // 안내 확인 전 과거 AI 대화 (앱 경로로는 만들 수 없음 — service role로 준비)
  const conv = (await admin.from("ai_conversations").insert({ fan_id: F.uid, creator_id: cid }).select("id").single()).data!.id as string;
  const past = new Date(Date.now() - 60 * 60_000).toISOString();
  await admin.from("ai_messages").insert([
    { conversation_id: conv, sender: "fan", content: "PRE_CONSENT_SECRET_FS 안내 전", created_at: past },
    { conversation_id: conv, sender: "ai", content: "PRE_CONSENT_SECRET_FS 답", created_at: past },
  ]);
  {
    const a = await F.sb.rpc("send_message_to_creator", { p_creator_id: cid, p_content: "HUMAN_FAN_FS 안녕하세요" });
    if (a.error) throw a.error;
    const b = await C.sb.rpc("send_message_to_fan", { p_fan_id: F.uid, p_content: "HUMAN_CREATOR_FS 반가워요" });
    if (b.error) throw b.error;
  }
  console.log(`준비: 크리에이터 ${cid} · 팬 · 다른 크리에이터 · 일반 사용자`);

  console.log("\n[안내 확인 전]");
  await step("직접 대화 · 플랜 · 반응 수는 있음 · AI 대화 0개 · 메모 없음", async () => {
    const i = await collectFanSummaryInput(C.sb, F.uid);
    const t = text(i);
    return [!i.aiConsented && i.messages.every((m) => m.source === "human") && t.includes("HUMAN_FAN_FS") && t.includes("HUMAN_CREATOR_FS") && i.tier === "premium" && !SECRETS.some((s) => t.includes(s)), i];
  });

  console.log("\n[안내 확인 이후]");
  await acknowledgeAiNotice(F.sb, cid);
  {
    const { error } = await rec(F, cid, "POST_CONSENT_A 학교 끝났어");
    if (error) throw error;
  }
  // Fan Memory 저장 (팬 Memory ON) — 크리에이터 요약 입력에는 들어가면 안 된다
  await F.sb.from("fan_ai_settings").insert({ fan_id: F.uid, memory_enabled: true });
  const mem = await F.sb.rpc("record_fan_memories", { p_server_key: SERVER_KEY, p_creator_id: cid, p_items: [{ category: "interest", content: "MEMORY_SECRET_FS 필름 사진" }], p_source_message_id: null });
  await step("(준비 확인) Fan Memory 1개 저장됨", async () => {
    const { data } = await admin.from("fan_memories").select("content").eq("fan_id", F.uid);
    return [!mem.error && (data ?? []).some((m) => m.content.includes("MEMORY_SECRET_FS")), mem.error?.message ?? data];
  });
  await step("G. 확인 이후 AI 대화 사용 · F. 확인 전 대화 없음 · E. Fan Memory · 메모 없음", async () => {
    const i = await collectFanSummaryInput(C.sb, F.uid);
    const t = text(i);
    return [i.aiConsented && t.includes("POST_CONSENT_A") && !SECRETS.some((s) => t.includes(s)), { aiConsented: i.aiConsented, messages: i.messages.map((m) => m.content) }];
  });
  await step("시간순 정렬 · 출처(human / ai) 유지", async () => {
    const i = await collectFanSummaryInput(C.sb, F.uid);
    const sorted = i.messages.every((m, k) => k === 0 || i.messages[k - 1].createdAt <= m.createdAt);
    return [sorted && i.messages.some((m) => m.source === "human") && i.messages.some((m) => m.source === "ai" && m.sender === "ai"), i.messages];
  });

  console.log("\n[확인 취소 · 재확인]");
  await F.sb.from("ai_creator_view_consents").delete().eq("creator_id", cid);
  await step("취소 → AI 대화 0개 (확인 이후 것도 빠짐)", async () => {
    const i = await collectFanSummaryInput(C.sb, F.uid);
    const t = text(i);
    return [!i.aiConsented && !t.includes("POST_CONSENT_A") && i.messages.every((m) => m.source === "human"), i.messages.map((m) => m.content)];
  });
  await new Promise((r) => setTimeout(r, 1500));
  await acknowledgeAiNotice(F.sb, cid);
  {
    const { error } = await rec(F, cid, "POST_RECONSENT_B 저녁 먹었어");
    if (error) throw error;
  }
  await step("재확인 → 새 확인 이후만 (이전 구간 · 확인 전 대화 다시 노출 안 됨)", async () => {
    const i = await collectFanSummaryInput(C.sb, F.uid);
    const t = text(i);
    return [i.aiConsented && t.includes("POST_RECONSENT_B") && !t.includes("POST_CONSENT_A") && !SECRETS.some((s) => t.includes(s)), i.messages.map((m) => m.content)];
  });

  console.log("\n[권한]");
  await step("다른 크리에이터 → fan_not_found", async () => {
    try {
      await collectFanSummaryInput(L.sb, F.uid);
      return [false, "읽힘"];
    } catch (e) {
      return [e instanceof FanSummaryAccessError && e.code === "fan_not_found", e instanceof Error ? e.message : e];
    }
  });
  await step("크리에이터가 아닌 사용자 → not_a_creator", async () => {
    try {
      await collectFanSummaryInput(N.sb, F.uid);
      return [false, "읽힘"];
    } catch (e) {
      return [e instanceof FanSummaryAccessError && e.code === "not_a_creator", e instanceof Error ? e.message : e];
    }
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
