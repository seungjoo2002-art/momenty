/**
 * v0.5-2 migration 실제 프로젝트 검증 — Persona · Facts · Boundaries · AI 대화 · 공유 rate limit.
 *
 *   npm run test:persona-live -- --confirm-dev
 *
 * · 모든 검사는 실제 사용자 JWT(크리에이터 · 구독자 · 팔로워 · 비로그인)로 보낸다. RLS · 컬럼 권한 · RPC가 실제로 막는지.
 * · 서버 키(AI_SERVER_KEY)는 .env.local에서 — 앱 서버와 같은 값.
 * · admin(service role)은 준비(구독자 등급 부여)와 정리에만.
 * · Confirm email이 꺼진 프로젝트에서만 실행한다.
 */
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
if (!process.argv.includes("--confirm-dev")) {
  console.error("실제 Supabase에 테스트 계정을 만들었다가 지우는 테스트예요. --confirm-dev 를 붙여 실행하세요.");
  process.exit(1);
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SERVER_KEY = process.env.AI_SERVER_KEY ?? "";
if (SERVER_KEY.length < 32) {
  console.error("AI_SERVER_KEY가 .env.local에 없어요.");
  process.exit(1);
}
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
{
  const settings = await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: KEY } }).then((r) => r.json());
  if (!settings.mailer_autoconfirm) {
    console.error("가입 확인 메일이 켜져 있어요. Confirm email을 끄고 실행하세요.");
    process.exit(1);
  }
}

type Item = { name: string; ok: boolean; detail?: string };
const results: { title: string; items: Item[] }[] = [];
let current: (typeof results)[number] = { title: "", items: [] };
const section = (t: string) => {
  current = { title: t, items: [] };
  results.push(current);
  console.log(`\n[${t}]`);
};
async function step(name: string, fn: () => Promise<boolean | [boolean, unknown]>) {
  let ok = false;
  let detail: string | undefined;
  try {
    const r = await fn();
    const [o, d] = Array.isArray(r) ? r : [r, undefined];
    ok = o;
    detail = d === undefined ? undefined : typeof d === "string" ? d : JSON.stringify(d);
  } catch (e) {
    detail = e instanceof Error ? e.message : String(e);
  }
  current.items.push({ name, ok, detail });
  console.log(`   ${ok ? "✓" : "✗"} ${name}${!ok && detail ? `  → ${detail}` : ""}`);
}
/** PostgREST 오류 메시지가 기대한 이유인지 */
const denied = (e: { message?: string; code?: string } | null, re: RegExp) => !!e && re.test(`${e.code ?? ""} ${e.message ?? ""}`);

const stamp = Date.now().toString(36);
const userIds: string[] = [];
async function newUser(tag: string): Promise<{ sb: SupabaseClient; uid: string }> {
  const sb = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signUp({ email: `momenty-pl-${tag}-${stamp}@gmail.com`, password: `Pl-${randomBytes(9).toString("base64url")}1a` });
  if (error) throw error;
  if (!data.session) throw new Error("세션 없음");
  userIds.push(data.user!.id);
  return { sb, uid: data.user!.id };
}
const anon = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

try {
  const X = await newUser("creator");
  const Y = await newUser("other");
  const S = await newUser("sub");
  const F = await newUser("follow");
  const mkCreator = async (u: { sb: SupabaseClient; uid: string }, tag: string) => {
    const { data, error } = await u.sb.from("creators").insert({ profile_id: u.uid, name: `PL ${tag}`, handle: `pl${tag}.${stamp}`, category: "art" }).select("id").single();
    if (error) throw error;
    return data.id as string;
  };
  const cx = await mkCreator(X, "x");
  const cy = await mkCreator(Y, "y");
  {
    const { error } = await admin.from("subscriptions").insert({ fan_id: S.uid, creator_id: cx, tier: "subscriber" });
    if (error) throw error;
    const { error: e2 } = await F.sb.from("subscriptions").insert({ fan_id: F.uid, creator_id: cx, tier: "follow" });
    if (e2) throw e2;
  }
  const mm = async (sb: SupabaseClient, creator: string, content: string, visibility: string, ai: boolean) => {
    const { data, error } = await sb.from("moments").insert({ creator_id: creator, type: "text", content, visibility, ai_context_enabled: ai }).select("id").single();
    if (error) throw error;
    return data.id as string;
  };
  const M = {
    pub: await mm(X.sb, cx, "[pl] 공개", "public", true),
    off: await mm(X.sb, cx, "[pl] AI 꺼짐", "public", false),
    prem: await mm(X.sb, cx, "[pl] premium", "premium", true),
    other: await mm(Y.sb, cy, "[pl] 다른 크리에이터", "public", true),
  };
  console.log("준비: 크리에이터 X · Y, 팬 S(subscriber) · F(follow)");

  section("migration 적용 상태");
  for (const t of ["creator_personas", "creator_facts", "creator_boundaries", "ai_conversations", "ai_messages"]) {
    await step(`public.${t} 존재 (크리에이터 세션으로 조회 가능)`, async () => {
      const { error } = await X.sb.from(t).select("*").limit(1);
      return [!error, error];
    });
  }
  await step("private 스키마는 Data API에 노출되지 않음", async () => {
    const { error } = await S.sb.schema("private").from("ai_settings").select("*");
    return [!!error, error?.message];
  });
  await step("예전 5인자 consume_ai_rate_limit는 없음 (2인자만)", async () => {
    const { error } = await S.sb.rpc("consume_ai_rate_limit", { p_server_key: SERVER_KEY, p_creator_id: cx, p_per_creator: 99999, p_per_user: 99999, p_window_sec: 86400 });
    return [denied(error, /PGRST202|Could not find|does not exist/), error?.message];
  });

  section("Persona · Facts · Boundaries RLS");
  const persona = { creator_id: cx, formality: "casual", reply_length: "short", laugh_kk: true, emoji_level: 1, phrases: ["오늘도 무사히"], mood: "편안한", example_messages: ["오늘 좀 걸었어 ㅋㅋ"], traits: ["warm", "playful"] };
  await step("팬이 크리에이터 Persona 생성 → RLS 거부", async () => {
    const { error } = await S.sb.from("creator_personas").insert(persona);
    return [denied(error, /42501|row-level security/), error?.message];
  });
  await step("다른 크리에이터가 생성 → RLS 거부", async () => {
    const { error } = await Y.sb.from("creator_personas").insert(persona);
    return [denied(error, /42501|row-level security/), error?.message];
  });
  await step("크리에이터 본인 생성 → 성공", async () => {
    const { error } = await X.sb.from("creator_personas").insert(persona);
    return [!error, error];
  });
  await step("팬 · 다른 크리에이터는 Persona를 읽을 수 없음 (0행)", async () => {
    const a = await S.sb.from("creator_personas").select("*");
    const b = await Y.sb.from("creator_personas").select("*").eq("creator_id", cx);
    return [a.data?.length === 0 && b.data?.length === 0, [a.data?.length, b.data?.length]];
  });
  await step("비로그인 → Persona 읽기 거부", async () => {
    const { data, error } = await anon.from("creator_personas").select("*");
    return [!!error || data?.length === 0, error?.message ?? data?.length];
  });
  await step("허용되지 않은 성향 값 → 거부", async () => {
    const { error } = await X.sb.from("creator_personas").update({ traits: ["evil"] }).eq("creator_id", cx);
    return [denied(error, /23514|check/), error?.message];
  });
  let factId = "";
  await step("본인 Fact 추가 · 팬은 읽을 수 없음", async () => {
    const { data, error } = await X.sb.from("creator_facts").insert({ creator_id: cx, category: "food", content: "좋아하는 음식은 초밥" }).select("id").single();
    factId = data?.id;
    const r = await S.sb.from("creator_facts").select("*");
    return [!error && r.data?.length === 0, error ?? r.data?.length];
  });
  await step("Fact source · created_at 지정 → 거부 (컬럼 권한)", async () => {
    const { error } = await X.sb.from("creator_facts").insert({ creator_id: cx, content: "x", source: "creator_studio" });
    return [denied(error, /42501|permission/), error?.message];
  });
  await step("last_verified_at 과거 조작 → 서버 시각으로 저장", async () => {
    await X.sb.from("creator_facts").update({ last_verified_at: "2000-01-01T00:00:00Z" }).eq("id", factId);
    const { data } = await X.sb.from("creator_facts").select("last_verified_at").eq("id", factId).single();
    return [Date.now() - new Date(data!.last_verified_at).getTime() < 5 * 60_000, data];
  });
  await step("다른 크리에이터가 Boundary 설정 → RLS 거부", async () => {
    const { error } = await Y.sb.from("creator_boundaries").insert({ creator_id: cx, topic: "sexual", allowed: true });
    return [denied(error, /42501|row-level security/), error?.message];
  });
  await step("본인 Boundary 설정 (update → 없으면 insert · 앱과 같은 방식)", async () => {
    const up = await X.sb.from("creator_boundaries").update({ allowed: true }).eq("creator_id", cx).eq("topic", "jokes").select("topic");
    const ins = up.data?.length ? { error: null } : await X.sb.from("creator_boundaries").insert({ creator_id: cx, topic: "jokes", allowed: true });
    const again = await X.sb.from("creator_boundaries").update({ allowed: true }).eq("creator_id", cx).eq("topic", "jokes").select("topic");
    return [!up.error && !ins.error && again.data?.length === 1, [up.error, ins.error, again.error]];
  });
  await step("upsert로 topic · creator_id를 다시 쓰는 요청은 컬럼 권한으로 거부 (의도된 제약)", async () => {
    const { error } = await X.sb.from("creator_boundaries").upsert({ creator_id: cx, topic: "jokes", allowed: false });
    return [denied(error, /42501|permission/), error?.message];
  });
  await step("persona_enabled: 다른 크리에이터 0행 · 본인 가능", async () => {
    const other = await Y.sb.from("creators").update({ persona_enabled: false }).eq("id", cx).select("id");
    const own = await X.sb.from("creators").update({ persona_enabled: true }).eq("id", cx).select("id");
    return [other.data?.length === 0 && own.data?.length === 1, [other.error ?? other.data?.length, own.error ?? own.data?.length]];
  });

  section("Fact 50개 제한 (실제 DB)");
  await step("비활성 Fact를 활성 50개 위로 켜는 공격 → 거부", async () => {
    const rows = Array.from({ length: 49 }, (_, i) => ({ creator_id: cx, content: `pl 활성 ${i}` }));
    const ins = await X.sb.from("creator_facts").insert(rows);
    if (ins.error) throw ins.error;
    const over = await X.sb.from("creator_facts").insert({ creator_id: cx, content: "51번째" });
    const park = await X.sb.from("creator_facts").insert({ creator_id: cx, content: "pl 비활성", active: false }).select("id").single();
    const flip = await X.sb.from("creator_facts").update({ active: true }).eq("id", park.data!.id);
    const { count } = await X.sb.from("creator_facts").select("*", { count: "exact", head: true }).eq("creator_id", cx).eq("active", true);
    await X.sb.from("creator_facts").delete().eq("creator_id", cx).like("content", "pl %");
    return [denied(over.error, /23514|too many/) && denied(flip.error, /23514|too many/) && count === 50, { over: over.error?.message, flip: flip.error?.message, count }];
  });

  section("ai_persona_context (팬 JWT + 서버 키)");
  const ctx = (sb: SupabaseClient, key: string | null, creator = cx) => sb.rpc("ai_persona_context", { p_server_key: key, p_creator_id: creator });
  await step("서버 키 없이 (구독자 JWT만) → server_key_required", async () => {
    const { error } = await ctx(S.sb, null);
    return [denied(error, /server_key_required/), error?.message];
  });
  await step("틀린 서버 키 → server_key_required", async () => {
    const { error } = await ctx(S.sb, "x".repeat(48));
    return [denied(error, /server_key_required/), error?.message];
  });
  await step("비로그인 + 서버 키 → 거부", async () => {
    const { error } = await ctx(anon, SERVER_KEY);
    return [!!error, error?.message];
  });
  await step("무료 팔로워 → subscription_required", async () => {
    const { error } = await ctx(F.sb, SERVER_KEY);
    return [denied(error, /subscription_required/), error?.message];
  });
  await step("크리에이터 본인 → own_channel", async () => {
    const { error } = await ctx(X.sb, SERVER_KEY);
    return [denied(error, /own_channel/), error?.message];
  });
  await step("Persona 미설정 크리에이터(Y) → 거부", async () => {
    const { error } = await ctx(S.sb, SERVER_KEY, cy);
    return [denied(error, /persona_not_configured|subscription_required/), error?.message];
  });
  await step("구독자 + 실제 서버 키 → Persona Context (등록한 해시와 일치)", async () => {
    const { data, error } = await ctx(S.sb, SERVER_KEY);
    return [
      !error && data.style.formality === "casual" && data.facts.length === 1 && data.facts[0].content === "좋아하는 음식은 초밥" && data.boundaries.jokes === true && data.boundaries.current_location === false,
      error ?? data,
    ];
  });
  await step("Fact에는 분류 · 내용만 (출처 · 시각 없음)", async () => {
    const { data } = await ctx(S.sb, SERVER_KEY);
    return [Object.keys(data.facts[0]).sort().join() === "category,content", data.facts[0]];
  });
  await step("Persona OFF → persona_disabled", async () => {
    await X.sb.from("creators").update({ persona_enabled: false }).eq("id", cx);
    const { error } = await ctx(S.sb, SERVER_KEY);
    await X.sb.from("creators").update({ persona_enabled: true }).eq("id", cx);
    return [denied(error, /persona_disabled/), error?.message];
  });

  section("AI 대화 저장 (record_ai_exchange)");
  const rec = (sb: SupabaseClient, key: string | null, o: Record<string, unknown> = {}) =>
    sb.rpc("record_ai_exchange", {
      p_server_key: key,
      p_creator_id: cx,
      p_fan_message: "오늘 뭐 했어?",
      p_ai_reply: "오늘 기록에는 산책이 있어요.",
      p_grounded_moment_ids: [M.pub, M.off, M.prem, M.other],
      p_context_types: ["today"],
      p_provider: "anthropic",
      p_model: "test-model",
      p_boundary: null,
      ...o,
    });
  await step("팬이 ai_messages 직접 insert(AI 위조) → 거부", async () => {
    const { error } = await S.sb.from("ai_messages").insert({ conversation_id: crypto.randomUUID(), sender: "ai", content: "fake" });
    return [denied(error, /42501|permission/), error?.message];
  });
  await step("서버 키 없이 → server_key_required", async () => {
    const { error } = await rec(S.sb, null);
    return [denied(error, /server_key_required/), error?.message];
  });
  let convId = "";
  await step("구독자 + 서버 키 → 저장 · 근거는 볼 수 있고 AI 허용된 X의 Moment만", async () => {
    const { data, error } = await rec(S.sb, SERVER_KEY);
    convId = data?.conversationId;
    const g: string[] = data?.groundedMomentIds ?? [];
    return [!error && g.length === 1 && g[0] === M.pub, error ?? g];
  });
  await step("허용되지 않은 context_type · provider · model · boundary → 거부", async () => {
    const r = await Promise.all([
      rec(S.sb, SERVER_KEY, { p_context_types: ["private_moments"] }),
      rec(S.sb, SERVER_KEY, { p_provider: "evil" }),
      rec(S.sb, SERVER_KEY, { p_model: "a b\nc" }),
      rec(S.sb, SERVER_KEY, { p_boundary: "anything" }),
    ]);
    return [r.every((x) => denied(x.error, /22023|invalid/)), r.map((x) => x.error?.message)];
  });
  await step("팬 본인은 대화 조회 · 다른 팬 · 크리에이터는 0행", async () => {
    const mine = await S.sb.from("ai_messages").select("sender").eq("conversation_id", convId);
    const other = await F.sb.from("ai_messages").select("*");
    const creator = await X.sb.from("ai_messages").select("*");
    const creatorConv = await X.sb.from("ai_conversations").select("*");
    return [mine.data?.length === 2 && other.data?.length === 0 && creator.data?.length === 0 && creatorConv.data?.length === 0, [mine.data?.length, other.data?.length, creator.data?.length]];
  });
  await step("팬이 메시지 수정 → 거부", async () => {
    const { error } = await S.sb.from("ai_messages").update({ content: "x" }).eq("conversation_id", convId);
    return [denied(error, /42501|permission/), error?.message];
  });

  section("공유 rate limit (실제 DB · 기본 20 / 60 / 600초)");
  const consume = (sb: SupabaseClient, key: string | null, creator = cx) => sb.rpc("consume_ai_rate_limit", { p_server_key: key, p_creator_id: creator });
  await step("서버 키 없이 → server_key_required", async () => {
    const { error } = await consume(S.sb, null);
    return [denied(error, /server_key_required/), error?.message];
  });
  await step("user × creator 20회 허용 → 21번째 거부 (per_creator)", async () => {
    const out = [];
    for (let i = 0; i < 21; i++) out.push((await consume(S.sb, SERVER_KEY)).data);
    return [out.slice(0, 20).every((r) => r?.allowed) && out[20]?.allowed === false && out[20]?.rule === "per_creator", out.map((r) => r?.allowed ? 1 : 0).join("")];
  });
  await step("동시 30회 요청 → 허용은 정확히 20회 (실제 Postgres 동시성)", async () => {
    const T = F; // 새 사용자 기준
    const all = await Promise.all(Array.from({ length: 30 }, () => consume(T.sb, SERVER_KEY, cy)));
    const allowed = all.filter((r) => r.data?.allowed).length;
    return [allowed === 20 && all.every((r) => !r.error), { allowed, errors: all.filter((r) => r.error).map((r) => r.error?.message) }];
  });
} catch (e) {
  section("중단");
  current.items.push({ name: "예상치 못한 오류", ok: false, detail: e instanceof Error ? e.message : String(e) });
  console.log(`   ✗ ${e instanceof Error ? e.message : e}`);
} finally {
  for (const uid of userIds) await admin.auth.admin.deleteUser(uid);
  console.log(`\n정리: 테스트 계정 ${userIds.length}명 삭제 (크리에이터 · Persona · Fact · 대화 · Moment는 cascade). rate limit 카운터는 private 스키마라 남는다 (지워진 사용자 id 기준 · 무해)`);
}

let pass = 0;
let total = 0;
console.log("\n요약");
for (const r of results) {
  const ok = r.items.filter((i) => i.ok).length;
  pass += ok;
  total += r.items.length;
  console.log(`${ok === r.items.length ? "PASS" : "FAIL"}  ${r.title} (${ok}/${r.items.length})`);
}
console.log(`\n${pass}/${total} passed`);
process.exit(pass === total && total > 0 ? 0 : 1);
