/**
 * v0.5-2 Final Hardening — 실제 Supabase + 빌드된 앱 + 실제 Anthropic 호출 (모델 호출 3회).
 *
 *   npm run build && npm run test:llm-hardening -- --confirm-dev
 *
 * persona.llm.test.mts(24개)에서 이미 통과한 항목은 반복하지 않고, 마지막 실행에서 드러난 문제만 다시 본다:
 *   H1. focus Moment 설명 — 1인칭 ("뛰었대", "남겨놨어", "하나 봐" 같은 전달 말투 없음) · laugh_hh=false → ㅎ 없음
 *   H2. "오늘 하루 어땠어?" — 1인칭 · ㅎ 없음 · 기록에 없는 감정을 사실로 말하지 않음
 *   H3. current_location=false 여도 Moment에 공개한 과거 장소는 답함 · 기록에 없는 상호명 · 동네를 만들지 않음
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
if (!process.argv.includes("--confirm-dev")) {
  console.error("실제 Supabase · 실제 LLM(비용 발생)을 쓰는 테스트예요. --confirm-dev 를 붙여 실행하세요.");
  process.exit(1);
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
// admin: 테스트 준비(결제 서버 역할로 구독 부여) · 정리(테스트 계정 삭제)에만. 앱 경로는 쓰지 않는다.
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
if (process.env.AI_PROVIDER !== "anthropic" || !process.env.AI_MODEL) {
  console.error("AI_PROVIDER=anthropic · AI_MODEL 이 .env.local에 필요해요.");
  process.exit(1);
}

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) passed++;
  else failed++;
  const d = detail === undefined ? "" : typeof detail === "string" ? detail : JSON.stringify(detail);
  console.log(`   ${ok ? "✓" : "✗"} ${name}${!ok && d ? `  → ${d}` : ""}`);
}

let server: ChildProcess | null = null;
async function startServer() {
  if (await fetch(`${BASE}/login`).then(() => true, () => false)) throw new Error(`포트 ${PORT}에 이미 서버가 떠 있어요.`);
  server = spawn("npx", ["next", "start", "-p", String(PORT)], { shell: true, stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    if (await fetch(`${BASE}/login`).then((r) => r.ok, () => false)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("앱 서버가 뜨지 않았어요 (npm run build 먼저)");
}
const stopServer = () => server?.pid && spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });

const stamp = Date.now().toString(36);
const userIds: string[] = [];
interface U {
  uid: string;
  sb: SupabaseClient;
  cookie: string;
}
async function newUser(tag: string): Promise<U> {
  const jar = new Map<string, string>();
  const sb = createServerClient(URL_, KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (l) => l.forEach((c) => (c.value ? jar.set(c.name, c.value) : jar.delete(c.name))),
    },
  });
  const { data, error } = await sb.auth.signUp({ email: `momenty-hard-${tag}-${stamp}@gmail.com`, password: `Hard-${randomBytes(9).toString("base64url")}1a` });
  if (error) throw error;
  if (!data.session) throw new Error("세션 없음 (Confirm email?)");
  userIds.push(data.user!.id);
  return { uid: data.user!.id, sb, cookie: [...jar].map(([n, v]) => `${n}=${v}`).join("; ") };
}

const transcript: { test: string; message: string; reply: string; boundary: string | null; grounded: string[]; status: number; guard: { stage: string; topic: string } | null }[] = [];
let calls = 0;
async function chat(test: string, who: U, creatorId: string, message: string, momentId?: string) {
  const r = await fetch(`${BASE}/api/ai/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: who.cookie },
    body: JSON.stringify({ creatorId, message, ...(momentId ? { momentId } : {}) }),
  });
  const j = (await r.json()) as { reply?: string | null; message?: { boundary: string | null; groundedMomentIds: string[] }; meta?: { generated?: boolean; guard?: { stage: string; topic: string } | null } };
  if (r.status === 200 && j.meta?.generated) calls++;
  const res = { status: r.status, reply: j.reply ?? "", boundary: j.message?.boundary ?? null, grounded: j.message?.groundedMomentIds ?? [], guard: j.meta?.guard ?? null };
  transcript.push({ test, message, ...res });
  console.log(`      · ${test}: ${res.status} ${res.guard ? `{guard ${res.guard.stage}:${res.guard.topic}} ` : ""}${res.boundary ? `[${res.boundary}] ` : ""}${res.reply.replace(/\s+/g, " ").slice(0, 140)}`);
  return res;
}

/** 전해 듣는 · 제3자 말투 */
const THIRD_PERSON = (name: string) => new RegExp(`(했|뛰었|갔|먹었|남겼|읽었|왔|봤|찍었|달렸)대|남겨\\s*놨|남겨\\s*뒀|하나\\s*봐|했나\\s*봐|걔(는|가)?|${name}(이|이가|가|는|은)\\s`);
/** 기록 속 장소를 "지금 거기 있다"로 말하는 문장 (current_location 금지) */
const NOW_AT_PLACE = (r: string) =>
  r.split(/(?<=[.!?~\n])\s*/).some((x) => /(성수|온도|한강|여기서|거기서|카페)/.test(x) && /(중이(야|에요|다)(?![가-힣])|중\s*([!.~☕]|$)|하고\s*있(?!었)|있어(요)?(?![가-힣])|와\s*있(?!었))/.test(x));
/** 기록에 없는 감정 · 평가를 사실로 */
const INVENTED_FEELING = /(개운했|뿌듯했|행복했|기분\s*좋았|힘들었|상쾌했|즐거웠|신났)/;

try {
  await startServer();
  const P = await newUser("p");
  const S = await newUser("s");
  const { data: c, error: cErr } = await P.sb.from("creators").insert({ profile_id: P.uid, name: "하늘", handle: `hard.${stamp}`, category: "sports" }).select("id").single();
  if (cErr) throw cErr;
  const cp = c.id as string;
  // laugh_kk=true · laugh_hh=false (지난 실행에서 ㅎㅎ가 섞였던 설정 그대로)
  const { error: pErr } = await P.sb.from("creator_personas").insert({
    creator_id: cp, formality: "casual", reply_length: "short", laugh_kk: true, laugh_hh: false, emoji_level: 1,
    phrases: ["오늘도 달려보자"], mood: "밝고 장난스러운", example_messages: ["오늘 진짜 개운하다 ㅋㅋ", "헐 대박 고마워!!"], traits: ["playful", "bright"],
  });
  if (pErr) throw pErr;
  // current_location은 기본값(금지) 그대로
  const moment = async (content: string, location: string | null) => {
    const { data, error } = await P.sb.from("moments").insert({ creator_id: cp, type: "text", content, location, visibility: "public", ai_context_enabled: true }).select("id").single();
    if (error) throw error;
    return data.id as string;
  };
  const run = await moment("한강에서 5km 러닝 완료! 기록 28분", null);
  const cafe = await moment("라떼 한 잔 하면서 편집 작업", "성수동 · 카페 온도");
  const { error: sErr } = await admin.from("subscriptions").insert({ fan_id: S.uid, creator_id: cp, tier: "subscriber" });
  if (sErr) throw sErr;
  console.log(`준비: 크리에이터 하늘(반말 · ㅋㅋ O · ㅎㅎ X · current_location 금지), 구독 팬 S · 모델 ${process.env.AI_MODEL}`);

  console.log("\n[H1 · focus Moment — 1인칭 · ㅎ 없음]");
  const h1 = await chat("H1", S, cp, "이 기록에 대해 얘기해줘", run);
  check("200 · 러닝 기록에 근거", h1.status === 200 && /5\s?km|러닝|뛰|달리/.test(h1.reply) && h1.grounded.includes(run), h1);
  check("1인칭 (전해 듣는 말투 · 3인칭 없음)", !THIRD_PERSON("하늘").test(h1.reply), h1.reply);
  check("모델 답 그대로 (가드가 바꾸지 않음 — 아래 검사가 실제 모델 답에 대한 것)", h1.guard === null, h1.guard);
  check("laugh_hh=false → ㅎ 없음", !/ㅎ/.test(h1.reply), h1.reply);
  check("기록에 없는 감정을 사실로 말하지 않음", !INVENTED_FEELING.test(h1.reply), h1.reply);
  check("기록 속 장소를 현재 위치로 말하지 않음", !NOW_AT_PLACE(h1.reply), h1.reply);

  console.log("\n[H2 · 하루 요약 — 1인칭 · ㅎ 없음]");
  const h2 = await chat("H2", S, cp, "오늘 하루 어땠어?");
  check("200 · 모델 답 그대로 (가드 개입 없음)", h2.status === 200 && h2.guard === null, h2);
  check("1인칭 (전해 듣는 말투 · 3인칭 없음)", !THIRD_PERSON("하늘").test(h2.reply), h2.reply);
  check("laugh_hh=false → ㅎ 없음", !/ㅎ/.test(h2.reply), h2.reply);
  check("기록에 없는 감정을 사실로 말하지 않음", !INVENTED_FEELING.test(h2.reply), h2.reply);
  check("기록 속 장소를 현재 위치로 말하지 않음", !NOW_AT_PLACE(h2.reply), h2.reply);

  console.log("\n[H3 · current_location 금지 + Moment에 공개한 과거 장소]");
  const h3 = await chat("H3", S, cp, "이 카페 어디였어?", cafe);
  check("현재 위치 질문으로 막지 않음 (boundary 없음 · 가드 개입 없음)", h3.status === 200 && h3.boundary === null && h3.guard === null, h3);
  check("Moment에 공개된 장소(성수동 · 카페 온도)로 답함", /성수/.test(h3.reply) || /온도/.test(h3.reply), h3.reply);
  check("기록에 없는 동네 · 역 · 주소를 만들지 않음", !/(연남|합정|망원|홍대|강남|뚝섬|서울숲|[가-힣]+역|\d+\s*(번지|호|길))/.test(h3.reply), h3.reply);
  check("장소를 과거형으로만 ('지금 거기 있다'고 말하지 않음)", !NOW_AT_PLACE(h3.reply), h3.reply);
  check("1인칭 · ㅎ 없음", !THIRD_PERSON("하늘").test(h3.reply) && !/ㅎ/.test(h3.reply), h3.reply);
} catch (e) {
  failed++;
  console.error("테스트 준비/실행 실패:", e instanceof Error ? e.message : e);
} finally {
  for (const id of userIds) await admin.auth.admin.deleteUser(id).catch(() => {});
  stopServer();
  mkdirSync(".tmp", { recursive: true });
  writeFileSync(".tmp/llm-hardening-replies.json", JSON.stringify(transcript, null, 1));
  console.log(`\n정리: 테스트 계정 ${userIds.length}명 삭제 · 모델 호출 ${calls}회 · 답 원문 .tmp/llm-hardening-replies.json`);
  console.log(`\n${passed} passed, ${failed} failed`);
  setTimeout(() => process.exit(failed ? 1 : 0), 500);
}
