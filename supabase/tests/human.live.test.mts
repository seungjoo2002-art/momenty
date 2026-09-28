/**
 * v0.7 migration 실제 프로젝트 검증 — Human Chat · Fan Manager · 메모 · 공유 · 차단 · 신고 · Realtime.
 *
 *   npm run test:human-live -- --confirm-dev
 *
 * · 모든 검사는 실제 사용자 JWT(크리에이터 · 구독자 · 팔로워 · 다른 크리에이터 · 비로그인)로. 앱과 같은 경로(RLS · RPC).
 * · admin(service role)은 준비(유료 구독 부여 · 구독 종료)와 정리에만. LLM 호출 없음
 *   (Fan Memory 준비에 record_fan_memories를 서버 키로 직접 부른다 — 모델 호출 아님).
 */
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanupTestUsers, registerCleanup } from "./support/cleanup.mjs";

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
    [ok, detail] = Array.isArray(r) ? r : [r, undefined];
  } catch (e) {
    detail = e instanceof Error ? e.message : String(e);
  }
  if (ok) passed++;
  else failed++;
  console.log(`   ${ok ? "✓" : "✗"} ${name}${!ok && detail !== undefined ? `  → ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
}
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
  const { data, error } = await sb.auth.signUp({ email: `momenty-hl-${tag}-${stamp}@gmail.com`, password: `Hl-${randomBytes(9).toString("base64url")}1a`, options: { data: { nickname: `HL ${tag}` } } });
  if (error) throw error;
  if (!data.session) throw new Error("세션 없음 (Confirm email?)");
  userIds.push(data.user!.id);
  await sb.realtime.setAuth(data.session.access_token);
  return { sb, uid: data.user!.id };
}
const anon = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const channels: { unsubscribe: () => unknown }[] = [];

try {
  const A = await newUser("creator");
  const B = await newUser("other-creator");
  const F1 = await newUser("fan1");
  const F2 = await newUser("fan2");
  const FW = await newUser("follower");
  const mk = async (u: U, tag: string) => {
    const { data, error } = await u.sb.from("creators").insert({ profile_id: u.uid, name: `HL ${tag}`, handle: `hl${tag}.${stamp}`, category: "music" }).select("id").single();
    if (error) throw error;
    return data.id as string;
  };
  const ca = await mk(A, "a");
  const cb = await mk(B, "b");
  const { error: pErr } = await A.sb.from("creator_personas").insert({ creator_id: ca });
  if (pErr) throw pErr;
  for (const [fan, tier] of [[F1, "subscriber"], [F2, "premium"]] as const) {
    const { error } = await admin.from("subscriptions").insert({ fan_id: fan.uid, creator_id: ca, tier });
    if (error) throw error;
  }
  {
    const { error } = await FW.sb.from("subscriptions").insert({ fan_id: FW.uid, creator_id: ca, tier: "follow" });
    if (error) throw error;
  }
  console.log("준비: 크리에이터 A(Persona) · B, 구독 팬 F1 · Premium F2 · 무료 팔로워 FW");

  console.log("\n[스키마 · 함수가 실제 프로젝트에 있음]");
  for (const t of ["human_conversations", "human_messages", "human_conversation_reads", "user_blocks", "creator_fan_notes", "fan_creator_shares"]) {
    await step(`테이블 ${t} (로그인 사용자 조회 가능 · RLS 적용)`, async () => {
      const { error } = await F1.sb.from(t).select("*").limit(0);
      return [!error, error?.message];
    });
  }
  await step("message_reports: 허용 컬럼만 조회 · 스냅샷 컬럼은 거부", async () => {
    const ok = await F1.sb.from("message_reports").select("id, reason, status").limit(0);
    const bad = await F1.sb.from("message_reports").select("message_snapshot").limit(0);
    return [!ok.error && denied(bad.error, /permission denied/), { ok: ok.error?.message, bad: bad.error?.message }];
  });
  await step("비로그인: 새 테이블 · 함수 모두 거부", async () => {
    const t = await anon.from("human_messages").select("id").limit(1);
    const f = await anon.rpc("send_message_to_creator", { p_creator_id: ca, p_content: "x" });
    return [!!t.error && !!f.error, { t: t.error?.message, f: f.error?.message }];
  });

  // Realtime 구독 (메시지 보내기 전에): F1 · A는 받아야 하고, F2 · B는 받으면 안 된다
  const got: Record<string, string[]> = { F1: [], A: [], F2: [], B: [] };
  const status: Record<string, string> = {};
  const listen = (who: keyof typeof got, u: U) =>
    new Promise<void>((resolve) => {
      const ch = u.sb
        .channel(`hl-${who}-${stamp}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "human_messages" }, (p) => got[who].push(String((p.new as { content: string }).content)))
        .subscribe((s, err) => {
          status[who] = `${s}${err ? ` ${err.message}` : ""}`;
          if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT") resolve();
        });
      channels.push(ch);
      setTimeout(resolve, 15_000);
    });
  await Promise.all([listen("F1", F1), listen("A", A), listen("F2", F2), listen("B", B)]);
  // SUBSCRIBED 직후 postgres_changes 등록이 끝나기까지 잠깐 걸릴 수 있다 (앱은 연결 순간 한 번 다시 읽어 메운다)
  await new Promise((r) => setTimeout(r, 2000));

  console.log("\n[Human Chat 기본 흐름]");
  let conv = "";
  let creatorMsg = "";
  let fanMsg = "";
  await step("팬(F1) → 크리에이터 전송 (대화방 자동 생성)", async () => {
    const { data, error } = await F1.sb.rpc("send_message_to_creator", { p_creator_id: ca, p_content: `안녕하세요 실시간-${stamp}` });
    conv = data?.conversationId;
    fanMsg = data?.messageId;
    return [!error && !!conv, error?.message];
  });
  await step("크리에이터 → 팬 답장 (같은 대화방 · sender=creator)", async () => {
    const { data, error } = await A.sb.rpc("send_message_to_fan", { p_fan_id: F1.uid, p_content: `반가워요 실시간-${stamp}` });
    creatorMsg = data?.messageId;
    const { data: rows } = await F1.sb.from("human_messages").select("sender_type, sender_id").eq("conversation_id", conv).order("created_at");
    return [!error && data?.conversationId === conv && rows?.length === 2 && rows[0].sender_type === "fan" && rows[1].sender_type === "creator" && rows[1].sender_id === A.uid, { error: error?.message, rows }];
  });
  await step("크리에이터가 먼저 보내기: Premium 팬(F2)에게 가능", async () => {
    const { error } = await A.sb.rpc("send_message_to_fan", { p_fan_id: F2.uid, p_content: "먼저 인사해요" });
    return [!error, error?.message];
  });
  await step("무료 팔로워: 보내기 · 받기 모두 불가", async () => {
    const a = await FW.sb.rpc("send_message_to_creator", { p_creator_id: ca, p_content: "x" });
    const b = await A.sb.rpc("send_message_to_fan", { p_fan_id: FW.uid, p_content: "x" });
    return [denied(a.error, /subscription_required/) && denied(b.error, /fan_not_subscribed/), [a.error?.message, b.error?.message]];
  });

  console.log("\n[격리 · 위조 (A~F · R)]");
  await step("A. 다른 팬(F2)은 F1 대화 0행", async () => {
    const { data } = await F2.sb.from("human_messages").select("id").eq("conversation_id", conv);
    return [(data ?? []).length === 0, data?.length];
  });
  await step("C. 다른 크리에이터(B)는 A 채널 대화 0행", async () => {
    const [c, m] = await Promise.all([B.sb.from("human_conversations").select("id"), B.sb.from("human_messages").select("id")]);
    return [(c.data ?? []).length === 0 && (m.data ?? []).length === 0];
  });
  await step("B · D · E. 테이블에 직접 insert (다른 대화 · 크리에이터 사칭 · 팬 사칭) → permission denied", async () => {
    const r1 = await F2.sb.from("human_messages").insert({ conversation_id: conv, sender_type: "fan", sender_id: F2.uid, content: "끼어들기" });
    const r2 = await F1.sb.from("human_messages").insert({ conversation_id: conv, sender_type: "creator", sender_id: A.uid, content: "사칭" });
    const r3 = await A.sb.from("human_messages").insert({ conversation_id: conv, sender_type: "fan", sender_id: F1.uid, content: "사칭" });
    return [[r1, r2, r3].every((r) => denied(r.error, /permission denied|42501/)), [r1.error?.message, r2.error?.message, r3.error?.message]];
  });
  await step("D. 팬이 send_message_to_fan → not_a_creator", async () => {
    const { error } = await F1.sb.rpc("send_message_to_fan", { p_fan_id: F2.uid, p_content: "x" });
    return [denied(error, /not_a_creator/), error?.message];
  });
  await step("F. conversation_id 인자 → 함수 없음", async () => {
    const { error } = await F2.sb.rpc("send_message_to_creator", { p_creator_id: ca, p_content: "x", p_conversation_id: conv });
    return [!!error, error?.message];
  });
  await step("R. 메시지 · 대화방 시각 수정 불가", async () => {
    const a = await F1.sb.from("human_messages").update({ content: "수정" }).eq("id", fanMsg).select("id");
    const b = await F1.sb.from("human_conversations").update({ last_creator_message_at: new Date().toISOString() }).eq("id", conv).select("id");
    return [denied(a.error, /permission denied/) && denied(b.error, /permission denied/), [a.error?.message, b.error?.message]];
  });
  await step("읽음 표시는 본인만 (크리에이터는 팬의 읽음 행을 볼 수 없음)", async () => {
    const { data: ok } = await F1.sb.rpc("mark_human_conversation_read", { p_conversation_id: conv });
    const { data: others } = await A.sb.from("human_conversation_reads").select("user_id").eq("user_id", F1.uid);
    const { data: hijack } = await F2.sb.rpc("mark_human_conversation_read", { p_conversation_id: conv });
    return [ok === true && (others ?? []).length === 0 && hijack === false];
  });

  console.log("\n[Realtime — 참여자에게만]");
  const want = [`안녕하세요 실시간-${stamp}`, `반가워요 실시간-${stamp}`];
  for (let i = 0; i < 20 && !want.every((w) => got.F1.includes(w) && got.A.includes(w)); i++) await new Promise((r) => setTimeout(r, 500));
  await step("F1 · A는 두 메시지를 실시간으로 받음", async () => [want.every((w) => got.F1.includes(w) && got.A.includes(w)), { status, F1: got.F1, A: got.A }]);
  await step("F2(다른 팬) · B(다른 크리에이터)는 F1 대화 메시지를 받지 않음 (RLS)", async () => {
    const leak = [...got.F2, ...got.B].filter((c) => c.includes(`실시간-${stamp}`));
    return [leak.length === 0, { F2: got.F2, B: got.B }];
  });

  console.log("\n[G · H · P — AI 대화 · Fan Memory · Fan Manager]");
  await F1.sb.rpc("record_ai_exchange", { p_server_key: SERVER_KEY, p_creator_id: ca, p_fan_message: `AI비밀-${stamp}`, p_ai_reply: `AI답-${stamp}`, p_grounded_moment_ids: [], p_context_types: [], p_provider: null, p_model: null, p_boundary: null });
  await F1.sb.from("fan_ai_settings").insert({ fan_id: F1.uid, memory_enabled: true });
  await F1.sb.rpc("record_fan_memories", { p_server_key: SERVER_KEY, p_creator_id: ca, p_items: [{ category: "schedule", content: `메모리비밀 오사카 ${stamp}` }, { category: "schedule", content: "10월 20일 생일" }], p_source_message_id: null });
  const { data: mems } = await F1.sb.from("fan_memories").select("id, content");
  await step("준비 확인: F1의 AI 대화 · Memory 2개 (F1 본인에게만 보임)", async () => [(mems ?? []).length === 2, mems]);
  await step("G · H. 크리에이터 A는 AI 대화 · Fan Memory · Memory 설정 0행", async () => {
    const r = await Promise.all(["ai_conversations", "ai_messages", "fan_memories", "fan_ai_settings"].map((t) => A.sb.from(t).select("*")));
    return [r.every((x) => (x.data ?? []).length === 0), r.map((x) => x.data?.length)];
  });
  await step("P. Fan Manager 목록 · 상세: AI 대화 · 비공유 Memory 원문 없음 · 점수 필드 없음", async () => {
    const { data: list, error } = await A.sb.rpc("fan_manager_list", { p_view: "all", p_limit: 50 });
    const { data: detail } = await A.sb.rpc("fan_manager_fan", { p_fan_id: F1.uid });
    const text = JSON.stringify({ list, detail });
    return [!error && list.items.length === 2 && !text.includes(`AI비밀-${stamp}`) && !text.includes(`AI답-${stamp}`) && !text.includes("메모리비밀") && !/score|rank|risk|loyal/i.test(text), { error: error?.message, n: list?.items?.length }];
  });
  await step("신호: F1은 대화했으므로 NO_HUMAN_REPLY 없음 · F2(먼저 받은 팬)도 없음 · 새 구독 신호", async () => {
    const { data } = await A.sb.rpc("fan_manager_list", { p_view: "all", p_limit: 50 });
    const by = Object.fromEntries((data.items as { fanId: string; signals: string[] }[]).map((i) => [i.fanId, i.signals]));
    return [!by[F1.uid].includes("NO_HUMAN_REPLY") && by[F1.uid].includes("NEW_SUBSCRIBER") && !by[F2.uid].includes("NO_HUMAN_REPLY"), by];
  });
  await step("팬 · 다른 크리에이터는 Fan Manager 호출 불가 / 관계없는 팬 상세 불가", async () => {
    const a = await F1.sb.rpc("fan_manager_list", { p_view: "attention" });
    const b = await B.sb.rpc("fan_manager_fan", { p_fan_id: F1.uid });
    return [denied(a.error, /not_a_creator/) && denied(b.error, /fan_not_found/), [a.error?.message, b.error?.message]];
  });

  console.log("\n[I · J — 크리에이터 메모]");
  await step("A가 F1 메모 작성 · 수정", async () => {
    const a = await A.sb.from("creator_fan_notes").insert({ creator_id: ca, fan_id: F1.uid, content: "지난 라이브에서 기타 이야기함" });
    const b = await A.sb.from("creator_fan_notes").update({ content: "지난 라이브에서 기타 이야기함 · 통기타" }).eq("creator_id", ca).eq("fan_id", F1.uid).select("content");
    return [!a.error && b.data?.[0]?.content.includes("통기타"), [a.error?.message, b.error?.message]];
  });
  await step("I. 팬은 메모 0행 · 작성 거부", async () => {
    const r = await F1.sb.from("creator_fan_notes").select("*");
    const w = await F1.sb.from("creator_fan_notes").insert({ creator_id: ca, fan_id: F1.uid, content: "x" });
    return [(r.data ?? []).length === 0 && denied(w.error, /row-level security|42501/), w.error?.message];
  });
  await step("J. 다른 크리에이터 B: 0행 · A 채널 메모 작성 거부 · 관계없는 팬 메모 거부", async () => {
    const r = await B.sb.from("creator_fan_notes").select("*");
    const w1 = await B.sb.from("creator_fan_notes").insert({ creator_id: ca, fan_id: F1.uid, content: "x" });
    const w2 = await B.sb.from("creator_fan_notes").insert({ creator_id: cb, fan_id: F1.uid, content: "x" });
    return [(r.data ?? []).length === 0 && !!w1.error && !!w2.error, [w1.error?.message, w2.error?.message]];
  });
  await step("Persona AI Context에 메모 없음", async () => {
    const { data, error } = await F1.sb.rpc("ai_persona_context", { p_server_key: SERVER_KEY, p_creator_id: ca });
    return [!error && !JSON.stringify(data).includes("기타 이야기"), error?.message];
  });

  console.log("\n[K · L · M — 명시적 공유]");
  const birthday = (mems ?? []).find((m) => m.content === "10월 20일 생일")!.id;
  await step("K. 공유 전 크리에이터 0행", async () => [((await A.sb.from("fan_creator_shares").select("*")).data ?? []).length === 0]);
  await step("M. 다른 팬 · 크리에이터가 F1 Memory 공유 처리 → memory_not_found", async () => {
    const a = await F2.sb.rpc("share_memory_with_creator", { p_memory_id: birthday });
    const b = await A.sb.rpc("share_memory_with_creator", { p_memory_id: birthday });
    return [denied(a.error, /memory_not_found/) && denied(b.error, /memory_not_found/)];
  });
  await step("F1이 생일을 공유 → 크리에이터는 그 사본 1개만 (날짜 포함)", async () => {
    const { error } = await F1.sb.rpc("share_memory_with_creator", { p_memory_id: birthday, p_event_date: "2000-10-20" });
    const { data } = await A.sb.from("fan_creator_shares").select("content, event_date");
    return [!error && data?.length === 1 && data[0].content === "10월 20일 생일" && data[0].event_date === "2000-10-20", { error: error?.message, data }];
  });
  await step("M. 크리에이터 · 다른 팬은 공유 삭제 0행", async () => {
    const a = await A.sb.from("fan_creator_shares").delete().eq("source_memory_id", birthday).select("id");
    const b = await F2.sb.from("fan_creator_shares").delete().eq("source_memory_id", birthday).select("id");
    return [(a.data ?? []).length === 0 && (b.data ?? []).length === 0];
  });
  await step("L. 팬이 공유 취소 → 크리에이터 0행", async () => {
    await F1.sb.from("fan_creator_shares").delete().eq("source_memory_id", birthday);
    return [((await A.sb.from("fan_creator_shares").select("*")).data ?? []).length === 0];
  });

  console.log("\n[N — 차단]");
  await step("팬 F1이 크리에이터 A 차단 → 양방향 전송 · Creator AI 모두 중단", async () => {
    const b = await F1.sb.from("user_blocks").insert({ blocker_id: F1.uid, blocked_id: A.uid });
    const s1 = await F1.sb.rpc("send_message_to_creator", { p_creator_id: ca, p_content: "x" });
    const s2 = await A.sb.rpc("send_message_to_fan", { p_fan_id: F1.uid, p_content: "x" });
    const ai = await F1.sb.rpc("ai_persona_context", { p_server_key: SERVER_KEY, p_creator_id: ca });
    return [!b.error && denied(s1.error, /messaging_unavailable/) && denied(s2.error, /messaging_unavailable/) && denied(ai.error, /blocked/), [b.error?.message, s1.error?.message, s2.error?.message, ai.error?.message]];
  });
  await step("차단당한 A는 차단 행을 볼 수 없음 · 기록은 계속 읽음", async () => {
    const r = await A.sb.from("user_blocks").select("*");
    const m = await A.sb.from("human_messages").select("id").eq("conversation_id", conv);
    return [(r.data ?? []).length === 0 && (m.data ?? []).length >= 2];
  });
  await step("차단 해제 → 다시 전송 가능", async () => {
    await F1.sb.from("user_blocks").delete().eq("blocked_id", A.uid);
    const { error } = await F1.sb.rpc("send_message_to_creator", { p_creator_id: ca, p_content: "다시 안녕하세요" });
    return [!error, error?.message];
  });

  console.log("\n[O — 신고]");
  await step("F1이 크리에이터 메시지 신고 → A · F2 · B는 0행, F1은 자기 신고만", async () => {
    const { error } = await F1.sb.rpc("report_human_message", { p_message_id: creatorMsg, p_reason: "harassment", p_detail: "테스트 신고" });
    const [a, f2, b, mine] = await Promise.all([
      A.sb.from("message_reports").select("id"),
      F2.sb.from("message_reports").select("id"),
      B.sb.from("message_reports").select("id"),
      F1.sb.from("message_reports").select("id, reason"),
    ]);
    return [!error && [a, f2, b].every((x) => (x.data ?? []).length === 0) && mine.data?.length === 1, { error: error?.message, mine: mine.data }];
  });
  await step("자기 메시지 · 남의 대화 메시지 신고 → 거부", async () => {
    const a = await F1.sb.rpc("report_human_message", { p_message_id: fanMsg, p_reason: "spam" });
    const b = await F2.sb.rpc("report_human_message", { p_message_id: creatorMsg, p_reason: "spam" });
    return [denied(a.error, /cannot_report_own_message/) && denied(b.error, /message_not_found/)];
  });

  console.log("\n[S · T — 구독 종료 · 인자 조작]");
  await step("S. 구독 종료(follow) → 새 메시지 불가 · 지난 기록은 양쪽 모두 읽음", async () => {
    await admin.from("subscriptions").update({ tier: "follow" }).eq("fan_id", F1.uid).eq("creator_id", ca);
    const a = await F1.sb.rpc("send_message_to_creator", { p_creator_id: ca, p_content: "x" });
    const b = await A.sb.rpc("send_message_to_fan", { p_fan_id: F1.uid, p_content: "x" });
    const [f, c] = await Promise.all([F1.sb.from("human_messages").select("id").eq("conversation_id", conv), A.sb.from("human_messages").select("id").eq("conversation_id", conv)]);
    return [denied(a.error, /subscription_required/) && denied(b.error, /fan_not_subscribed/) && (f.data ?? []).length >= 3 && (c.data ?? []).length >= 3];
  });
  await step("T. 1001자 · 정의 밖 view · 큰 limit", async () => {
    const a = await F2.sb.rpc("send_message_to_creator", { p_creator_id: ca, p_content: "가".repeat(1001) });
    const b = await A.sb.rpc("fan_manager_list", { p_view: "everything" });
    const c = await A.sb.rpc("fan_manager_list", { p_view: "all", p_limit: 100000 });
    return [denied(a.error, /invalid content/) && denied(b.error, /invalid view/) && !c.error, [a.error?.message, b.error?.message, c.error?.message]];
  });
} catch (e) {
  failed++;
  console.error("테스트 준비/실행 실패:", e instanceof Error ? e.message : e);
} finally {
  for (const ch of channels) await ch.unsubscribe();
  await cleanupTestUsers(admin, userIds);
  console.log(`\n정리: 테스트 계정 ${userIds.length}명 삭제`);
  console.log(`\n${passed} passed, ${failed} failed`);
  setTimeout(() => process.exit(failed ? 1 : 0), 500);
}
