/**
 * Core Loop 브라우저 E2E (v0.6) — 실제 Supabase + 실제 Anthropic + 실제 Chrome.
 *
 *   npm run build && npm run test:core-loop -- --confirm-dev
 *
 *   Creator → Moment 작성(Studio 화면) → Fan Today → Moment 상세 → Creator Persona AI
 *   → Fan Memory ON(My > AI Memory) → 대화에서 기억 → 대화 저장 → 새로고침 · 재로그인 → Memory 보기 · 삭제
 *
 * · 가입은 API로(이미 ui.e2e에서 화면 가입을 검증함), 나머지는 전부 화면에서 한다.
 * · mock · localStorage · 가짜 AI 응답 없음. 모델 호출 2회.
 * · admin(service role)은 결제 서버 역할(구독 부여)과 정리에만 쓴다.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanupTestUsers, registerCleanup } from "./support/cleanup.mjs";
import { acknowledgeAiNotice, makeAvatarReady } from "./support/avatarLive.mjs";
import { chromium, type Page } from "playwright-core";

process.loadEnvFile(".env.local");
if (!process.argv.includes("--confirm-dev")) {
  console.error("실제 Supabase · 실제 LLM(비용 발생)을 쓰는 테스트예요. --confirm-dev 를 붙여 실행하세요.");
  process.exit(1);
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const SHOTS = ".tmp/ui";
const CHROME = process.env.CHROME_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome"].find(existsSync);
if (!CHROME) {
  console.error("Chrome을 찾지 못했어요. CHROME_PATH 로 지정하세요.");
  process.exit(1);
}
if (process.env.AI_PROVIDER !== "anthropic" || !process.env.AI_MODEL) {
  console.error("AI_PROVIDER=anthropic · AI_MODEL 이 .env.local에 필요해요.");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });

let passed = 0;
let failed = 0;
let lastPage: Page | null = null;
let shots = 0;
async function step(name: string, fn: () => Promise<boolean | [boolean, unknown] | void>) {
  let ok = false;
  let detail = "";
  try {
    const r = await fn();
    const [o, d] = Array.isArray(r) ? r : [r ?? true, undefined];
    ok = o;
    if (d !== undefined) detail = typeof d === "string" ? d : JSON.stringify(d);
  } catch (e) {
    detail = e instanceof Error ? e.message.split("\n")[0] : String(e);
  }
  if (ok) passed++;
  else failed++;
  console.log(`   ${ok ? "✓" : "✗"} ${name}${!ok && detail ? `  → ${detail}` : ""}`);
  if (!ok && lastPage) await lastPage.screenshot({ path: `${SHOTS}/core-fail-${++shots}.png`, fullPage: true }).catch(() => {});
  return ok;
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
registerCleanup(admin, userIds);
interface Acc {
  uid: string;
  email: string;
  password: string;
  sb: SupabaseClient;
}
async function account(tag: string, role: "creator" | "fan"): Promise<Acc> {
  const sb = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `momenty-loop-${tag}-${stamp}@gmail.com`;
  const password = `Loop-${randomBytes(9).toString("base64url")}1a`;
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { nickname: `루프 ${tag}`, signup_role: role, interests: ["sports"], onboarded: true } } });
  if (error) throw error;
  if (!data.session) throw new Error("세션 없음 (Confirm email?)");
  userIds.push(data.user!.id);
  return { uid: data.user!.id, email, password, sb };
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  await ctx.addInitScript("window.__name = (f) => f");
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  lastPage = page;
  return page;
}
async function login(page: Page, a: Acc) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("이메일").fill(a.email);
  await page.getByLabel("비밀번호").fill(a.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
async function waitReply(page: Page, name: string) {
  await page.getByText(`${name} AI가 답하는 중`).waitFor();
  await page.getByText(`${name} AI가 답하는 중`).waitFor({ state: "detached", timeout: 90_000 });
}

const CREATOR_NAME = `루프${stamp.slice(-3)}`;
const MOMENT_TEXT = `한강에서 5km 러닝 완료! 기록 28분 ${stamp.slice(-4)}`;
let calls = 0;
const pageErrors: string[] = [];

try {
  await startServer();
  const C = await account("c", "creator");
  const F = await account("f", "fan");
  const { data: cr, error: cErr } = await C.sb.from("creators").insert({ profile_id: C.uid, name: CREATOR_NAME, handle: `loop.${stamp}`, category: "sports" }).select("id").single();
  if (cErr) throw cErr;
  const cid = cr.id as string;
  // v0.8.5: 말투는 학습 답변으로 (반말 · 짧게 · ㅋㅋ O · ㅎㅎ X)
  await makeAvatarReady(C.sb, cid, { traits: ["bright"], defaultReply: (_m: string, i: number) => ["응 알겠어 ㅋㅋ", "오 진짜? 대박 ㅋㅋ", "헐 고마워!!", "그건 좀 비밀 ㅋㅋ 다른 얘기 하자", "나도 그래 ㅋㅋ 너는 어때?"][i % 5] });
  const { error: sErr } = await admin.from("subscriptions").insert({ fan_id: F.uid, creator_id: cid, tier: "subscriber" });
  if (sErr) throw sErr;
  await acknowledgeAiNotice(F.sb, cid);
  console.log(`준비: 크리에이터 ${CREATOR_NAME}(Persona 설정) · 구독 팬 F · 모델 ${process.env.AI_MODEL}`);

  /* ---------- Creator: Moment 작성 ---------- */
  console.log("\n[Creator · Studio에서 Moment 작성]");
  const cp = await newPage();
  cp.on("pageerror", (e) => pageErrors.push(`creator: ${e.message}`));
  let momentId = "";
  await step("크리에이터 로그인 → Studio", async () => {
    await login(cp, C);
    await cp.goto(`${BASE}/studio`);
    await cp.waitForURL(/\/studio$/);
  });
  await step("글 Moment 작성 → 미리보기 → 전체 공개", async () => {
    await cp.goto(`${BASE}/studio/record?type=text`);
    await cp.getByPlaceholder("지금 떠오른 생각, 오늘의 한 문장…").fill(MOMENT_TEXT);
    await cp.getByRole("button", { name: "다음" }).click();
    await cp.waitForURL(/\/studio\/record\/preview$/);
    await cp.getByRole("radio", { name: /^전체/ }).click();
    await cp.getByRole("button", { name: "공개하기" }).click();
    await cp.waitForURL(/\/studio(\?posted=1)?$/, { timeout: 60_000 });
    const { data } = await C.sb.from("moments").select("id, ai_context_enabled").eq("creator_id", cid).eq("content", MOMENT_TEXT).single();
    momentId = data?.id ?? "";
    return [!!momentId && data?.ai_context_enabled === true, data];
  });

  /* ---------- Fan: Today → 상세 → Creator AI ---------- */
  console.log("\n[Fan · Today → Moment 상세 → Creator AI]");
  const fp = await newPage();
  fp.on("pageerror", (e) => pageErrors.push(`fan: ${e.message}`));
  const chatBodies: string[] = [];
  fp.on("request", (r) => {
    if (r.url().endsWith("/api/ai/chat")) chatBodies.push(r.postData() ?? "");
  });
  await step("팬 로그인 → Today에 크리에이터의 오늘 (TODAY · 1 MOMENTS)", async () => {
    await login(fp, F);
    await fp.goto(`${BASE}/today`);
    await fp.getByText(/TODAY · 1 MOMENTS/i).waitFor();
    await fp.getByText(`${CREATOR_NAME}의 오늘`).waitFor();
  });
  await step("Today 카드 → 크리에이터 Today 타임라인 → Moment 눌러 상세", async () => {
    await fp.getByText(`${CREATOR_NAME}의 오늘`).click();
    await fp.waitForURL(new RegExp(`/creators/${cid}/today`));
    await fp.getByText(MOMENT_TEXT).first().click();
    await fp.waitForURL(new RegExp(`/moments/${momentId}`));
  });
  await shotSafe(fp, "moment-detail");
  await step("Moment 상세 → 'Creator AI와 이야기하기' → 대화방 (AI 표시)", async () => {
    await fp.getByText(MOMENT_TEXT).first().waitFor();
    await fp.getByRole("link", { name: /이 순간에 대해 Creator AI와 이야기하기/ }).click();
    await fp.waitForURL(new RegExp(`/chat/${cid}`));
    await fp.getByText("AI가 생성한 답변입니다").waitFor();
    await fp.getByText(`${CREATOR_NAME} 본인이 아니에요`).first().waitFor();
    await fp.getByText("이 순간에 대해 이야기하는 중").waitFor();
  });
  await step("Memory OFF(기본) 상태로 대화 → Moment 기반 답 · '기억했어요' 없음", async () => {
    await fp.getByLabel("메시지").fill("이 기록 얘기해줘!");
    await fp.getByRole("button", { name: "보내기" }).click();
    await waitReply(fp, CREATOR_NAME);
    calls++;
    // 답이 온 직후에도 보낸 메시지 · 답이 사라지지 않는다 (다시 읽는 동안 빈 대화 화면이 나오면 안 됨)
    const emptyRightAfter = await fp.getByText("기록에 없는 일은 지어내지 않아요.").count();
    await fp.getByText("이 기록 얘기해줘!").waitFor({ timeout: 5_000 });
    await fp.getByText(/Moment 기반/).first().waitFor({ timeout: 15_000 });
    const aiName = await fp.getByText(`🤖 ${CREATOR_NAME} AI`).count();
    const remembered = await fp.getByText("· 기억했어요").count();
    const body = JSON.parse(chatBodies[0] ?? "{}");
    return [emptyRightAfter === 0 && aiName >= 2 && remembered === 0 && body.momentId === momentId && !JSON.stringify(body).includes("5km"), { emptyRightAfter, aiName, remembered, body }];
  });

  /* ---------- Fan: AI Memory 켜기 ---------- */
  console.log("\n[Fan · My > AI Memory 켜기]");
  await step("My → AI Memory (기본 OFF · 설명 문구)", async () => {
    await fp.goto(`${BASE}/my`);
    await fp.getByRole("link", { name: /AI Memory/ }).click();
    await fp.waitForURL(/\/my\/memory$/);
    await fp.getByText("Creator AI가 대화에서 기억하도록 허용한 정보입니다.").waitFor();
    const sw = fp.getByRole("switch", { name: "AI Memory" });
    return (await sw.getAttribute("aria-checked")) === "false" && (await fp.getByText("아직 기억한 내용이 없어요.").count()) === 1;
  });
  await shotSafe(fp, "memory-off");
  await step("ON으로 바꾸면 DB(fan_ai_settings)에 저장", async () => {
    await fp.getByRole("switch", { name: "AI Memory" }).click();
    await fp.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute("aria-checked") === "true");
    for (let i = 0; i < 20; i++) {
      const { data } = await F.sb.from("fan_ai_settings").select("memory_enabled").eq("fan_id", F.uid).maybeSingle();
      if (data?.memory_enabled === true) return true;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  });

  /* ---------- Fan: 대화에서 기억 ---------- */
  console.log("\n[Fan · 대화 → Fan Memory]");
  await step("자기 얘기를 하면 답 아래 '기억했어요' 표시", async () => {
    await fp.goto(`${BASE}/chat/${cid}`);
    await fp.getByText("이 기록 얘기해줘!").waitFor();
    await fp.getByLabel("메시지").fill("나 다음 주에 부산 여행 가! 앞으로 수진이라고 불러줘");
    await fp.getByRole("button", { name: "보내기" }).click();
    await waitReply(fp, CREATOR_NAME);
    calls++;
    await fp.getByText("· 기억했어요").waitFor({ timeout: 10_000 });
  });
  await shotSafe(fp, "chat-remembered");
  await step("'기억했어요' → AI Memory 화면에 크리에이터별로 표시 (분류 칩 포함)", async () => {
    await fp.getByText("· 기억했어요").click();
    await fp.waitForURL(/\/my\/memory$/);
    await fp.getByText(`${CREATOR_NAME} AI`).first().waitFor();
    await fp.getByText(/부산/).first().waitFor();
    const chips = await fp.getByText(/^(일정|호칭|관심사|좋아하는 것|기타)$/).count();
    return [chips >= 1, { chips }];
  });
  await shotSafe(fp, "memory-on");

  /* ---------- 새로고침 · 재로그인 ---------- */
  console.log("\n[새로고침 · 재로그인]");
  await step("새로고침 → Memory · ON 상태 유지", async () => {
    await fp.reload();
    await fp.getByText(/부산/).first().waitFor();
    return (await fp.getByRole("switch", { name: "AI Memory" }).getAttribute("aria-checked")) === "true";
  });
  await step("로그아웃 → 다시 로그인 → 대화 · Memory 그대로", async () => {
    await fp.goto(`${BASE}/my`);
    await fp.getByRole("button", { name: "로그아웃" }).click();
    await fp.waitForURL(/\/login/);
    await login(fp, F);
    await fp.goto(`${BASE}/chat/${cid}`);
    await fp.getByText("이 기록 얘기해줘!").waitFor();
    await fp.getByText("나 다음 주에 부산 여행 가! 앞으로 수진이라고 불러줘").waitFor();
    const ai = await fp.getByText(`🤖 ${CREATOR_NAME} AI`).count();
    await fp.goto(`${BASE}/my/memory`);
    await fp.getByText(/부산/).first().waitFor();
    return [ai >= 3, { ai }];
  });

  /* ---------- 권한 ---------- */
  console.log("\n[권한 — 실제 RLS]");
  await step("크리에이터 세션: 팬 Memory · 대화 원문 0행 · 설정 0행", async () => {
    const [m, msg, s] = await Promise.all([C.sb.from("fan_memories").select("id"), C.sb.from("ai_messages").select("id"), C.sb.from("fan_ai_settings").select("fan_id")]);
    return [(m.data ?? []).length === 0 && (msg.data ?? []).length === 0 && (s.data ?? []).length === 0, { m: m.data?.length, msg: msg.data?.length, s: s.data?.length }];
  });

  /* ---------- 삭제 ---------- */
  console.log("\n[Fan · Memory 삭제]");
  await step("개별 삭제 → 화면 · DB에서 사라짐", async () => {
    const { data: before } = await F.sb.from("fan_memories").select("id, content");
    const target = (before ?? [])[0];
    await fp.getByRole("button", { name: `"${target.content}" 지우기` }).click();
    await fp.getByText(target.content, { exact: true }).waitFor({ state: "detached" });
    const { data: after } = await F.sb.from("fan_memories").select("id");
    return [(after ?? []).length === (before ?? []).length - 1, { before: before?.length, after: after?.length }];
  });
  await step("전체 삭제(확인 후) → 비어 있음 · DB 0행 · 설정은 ON 그대로", async () => {
    const { data: left } = await F.sb.from("fan_memories").select("id");
    if ((left ?? []).length > 0) {
      await fp.getByRole("button", { name: "기억 전체 지우기" }).click();
      await fp.getByRole("button", { name: "지우기", exact: true }).click();
    }
    await fp.getByText("아직 기억한 내용이 없어요.").waitFor();
    const { data: after } = await F.sb.from("fan_memories").select("id");
    const { data: s } = await F.sb.from("fan_ai_settings").select("memory_enabled").eq("fan_id", F.uid).single();
    return (after ?? []).length === 0 && s?.memory_enabled === true;
  });
  await step("대화는 Memory 삭제와 별개로 남아 있음", async () => {
    await fp.goto(`${BASE}/chat/${cid}`);
    await fp.getByText("나 다음 주에 부산 여행 가! 앞으로 수진이라고 불러줘").waitFor();
  });

  await step("페이지 오류 없음", async () => [pageErrors.length === 0, pageErrors]);
} catch (e) {
  failed++;
  console.error("테스트 준비/실행 실패:", e instanceof Error ? e.message.split("\n")[0] : e);
} finally {
  await browser.close().catch(() => {});
  await cleanupTestUsers(admin, userIds);
  stopServer();
  console.log(`\n정리: 테스트 계정 ${userIds.length}명 삭제 · 모델 호출 ${calls}회 · 스크린샷 ${SHOTS}/`);
  console.log(`\n${passed} passed, ${failed} failed`);
  setTimeout(() => process.exit(failed ? 1 : 0), 500);
}

async function shotSafe(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/core-${name}.png`, fullPage: true }).catch(() => {});
}
