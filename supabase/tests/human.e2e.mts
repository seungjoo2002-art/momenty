/**
 * v0.7 브라우저 E2E — 실제 Supabase + 실제 Chrome (크리에이터 · 팬 두 브라우저를 동시에). LLM 호출 없음.
 *
 *   npm run build && npm run test:human-e2e -- --confirm-dev
 *
 *   Studio Fan Manager(관찰된 사실 · 이유) → 팬 상세(메모 · 공유 정보) → 크리에이터가 먼저 직접 메시지
 *   → 팬 대화방에 실시간 도착(✓ 본인 표시) → 팬 답장 → Studio에 실시간 도착 → AI/Human 표시 구분
 *   → Memory 명시적 공유/취소 → 신고 → 차단(팬 · 크리에이터) → 구독 종료 후 기록만 → 무료 팔로워는 직접 메시지 없음
 *
 * · 준비(가입 · 구독 부여 · 반응 · Memory 1개)는 API로 — 앱과 같은 권한(각자 세션). admin은 결제 서버 역할(구독 부여 · 종료)과 정리에만.
 * · Memory 준비는 record_fan_memories(서버 키 + 팬 JWT)를 직접 부른다 — 모델 호출 아님.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright-core";

process.loadEnvFile(".env.local");
if (!process.argv.includes("--confirm-dev")) {
  console.error("실제 Supabase에 테스트 계정을 만들었다가 지우는 테스트예요. --confirm-dev 를 붙여 실행하세요.");
  process.exit(1);
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SERVER_KEY = process.env.AI_SERVER_KEY ?? "";
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const SHOTS = ".tmp/ui";
const CHROME = process.env.CHROME_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome"].find(existsSync);
if (!CHROME) {
  console.error("Chrome을 찾지 못했어요. CHROME_PATH 로 지정하세요.");
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
  if (!ok && lastPage) await lastPage.screenshot({ path: `${SHOTS}/human-fail-${++shots}.png`, fullPage: true }).catch(() => {});
}
const shot = (p: Page, name: string) => p.screenshot({ path: `${SHOTS}/human-${name}.png`, fullPage: true }).catch(() => {});

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
interface Acc {
  uid: string;
  email: string;
  password: string;
  sb: SupabaseClient;
}
async function account(tag: string, nickname: string, role: "creator" | "fan"): Promise<Acc> {
  const sb = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `momenty-hx-${tag}-${stamp}@gmail.com`;
  const password = `Hx-${randomBytes(9).toString("base64url")}1a`;
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { nickname, signup_role: role, interests: ["music"], onboarded: true } } });
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
  return page;
}
async function login(page: Page, a: Acc) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("이메일").fill(a.email);
  await page.getByLabel("비밀번호").fill(a.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

const NAME = `지훈${stamp.slice(-3)}`;
const FAN = `민지${stamp.slice(-3)}`;
const FORBIDDEN = /(관심\s*높은|충성|이탈|위험|점수|랭킹|순위|소홀|취약|애착|심리)/;
const pageErrors: string[] = [];

try {
  await startServer();
  const C = await account("c", NAME, "creator");
  const F = await account("f", FAN, "fan");
  const W = await account("w", "무료팔로워", "fan");
  const { data: cr, error: cErr } = await C.sb.from("creators").insert({ profile_id: C.uid, name: NAME, handle: `hx.${stamp}`, category: "music" }).select("id").single();
  if (cErr) throw cErr;
  const cid = cr.id as string;
  await C.sb.from("creator_personas").insert({ creator_id: cid });
  // Moment 5개 · 팬이 4개에 반응
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    const { data } = await C.sb.from("moments").insert({ creator_id: cid, type: "text", content: `오늘의 기록 ${i}`, visibility: "public" }).select("id").single();
    ids.push(data!.id);
  }
  {
    const { error } = await admin.from("subscriptions").insert({ fan_id: F.uid, creator_id: cid, tier: "subscriber" });
    if (error) throw error;
    await W.sb.from("subscriptions").insert({ fan_id: W.uid, creator_id: cid, tier: "follow" });
  }
  for (const m of ids.slice(0, 4)) await F.sb.from("moment_reactions").insert({ moment_id: m, user_id: F.uid, kind: "love" });
  // 팬 Memory (크리에이터에게는 공유 전 0 visibility)
  await F.sb.from("fan_ai_settings").insert({ fan_id: F.uid, memory_enabled: true });
  const SECRET = `비공유 여행 계획 ${stamp}`;
  await F.sb.rpc("record_fan_memories", { p_server_key: SERVER_KEY, p_creator_id: cid, p_items: [{ category: "schedule", content: "10월 20일 생일" }, { category: "schedule", content: SECRET }], p_source_message_id: null });
  console.log(`준비: 크리에이터 ${NAME} · 구독 팬 ${FAN} (Moment 5개 중 4개 반응 · Memory 2개) · 무료 팔로워`);

  const cp = await newPage();
  const fp = await newPage();
  cp.on("pageerror", (e) => pageErrors.push(`creator: ${e.message}`));
  fp.on("pageerror", (e) => pageErrors.push(`fan: ${e.message}`));
  await login(cp, C);
  await login(fp, F);

  console.log("\n[Studio · Fan Manager]");
  lastPage = cp;
  await step("오늘 확인할 팬: 관찰된 사실 문장 그대로 (반응 · 첫 대화 전)", async () => {
    await cp.goto(`${BASE}/studio/fans`);
    await cp.getByText("오늘 확인할 팬").waitFor();
    await cp.getByText(FAN).first().waitFor();
    const text = await cp.locator("main").innerText();
    return [text.includes("최근 Moment 5개 중 4개에 반응했어요.") || text.includes("구독한 지 0일") || text.includes("오늘 구독을 시작했어요."), text.slice(0, 400)];
  });
  await step("추론형 · 점수형 표현 없음 · AI 대화 · 비공유 Memory 없음", async () => {
    const text = await cp.locator("main").innerText();
    return [!FORBIDDEN.test(text) && !text.includes(SECRET) && !text.includes("10월 20일 생일"), text.match(FORBIDDEN)?.[0]];
  });
  await shot(cp, "fans");
  await step("팬 상세: 있었던 일 · 공유 정보 없음 · 메모 · 직접 대화 없음", async () => {
    await cp.getByRole("link", { name: `${FAN} 팬 보기` }).click();
    await cp.waitForURL(new RegExp(`/studio/fans/${F.uid}`));
    await cp.getByText("있었던 일").waitFor();
    const t = await cp.locator("main").innerText();
    return [t.includes("최근 Moment 5개 중 4개에 반응했어요.") && t.includes("구독 후 아직 직접 대화한 적이 없어요.") && t.includes("팬이 직접 공유한 정보가 없어요") && t.includes("아직 직접 주고받은 메시지가 없어요") && !t.includes(SECRET), t.slice(0, 500)];
  });
  await step("메모 저장 → DB(크리에이터 본인만) · 새로고침 후 유지", async () => {
    await cp.getByLabel("내 메모").fill("지난 라이브에서 기타 이야기함");
    await cp.getByRole("button", { name: "메모 저장" }).click();
    await cp.getByText("저장했어요").waitFor();
    await cp.reload();
    await cp.getByLabel("내 메모").waitFor();
    const v = await cp.getByLabel("내 메모").inputValue();
    const { data: fanSees } = await F.sb.from("creator_fan_notes").select("*");
    return [v === "지난 라이브에서 기타 이야기함" && (fanSees ?? []).length === 0, { v, fanSees: fanSees?.length }];
  });

  console.log("\n[Human Chat · 실시간 · AI/Human 구분]");
  await step("팬: 대화방을 직접 메시지 모드로 열어 둠 (✓ 배너)", async () => {
    lastPage = fp;
    await fp.goto(`${BASE}/chat/${cid}?mode=human`);
    await fp.getByText(`✓ ${NAME} 본인에게 직접 보내요 · AI가 답하지 않아요`).waitFor();
  });
  await step("크리에이터가 먼저 직접 메시지 (Studio 상세)", async () => {
    lastPage = cp;
    await cp.getByLabel("직접 메시지").fill("안녕하세요, 직접 인사드려요!");
    await cp.getByRole("button", { name: "직접 보내기" }).click();
    await cp.getByText("안녕하세요, 직접 인사드려요!").waitFor();
    await cp.getByText(/✓ 직접 보냄/).first().waitFor();
  });
  await step("팬 화면에 새로고침 없이 도착 (Realtime) · ✓ 이름 · '크리에이터가 직접 보낸 메시지' · 본인 라벨", async () => {
    lastPage = fp;
    await fp.getByText("안녕하세요, 직접 인사드려요!").waitFor({ timeout: 20_000 });
    await fp.getByText("· 크리에이터가 직접 보낸 메시지").waitFor();
    const human = await fp.getByText(`✓ ${NAME}`, { exact: true }).count();
    const badge = await fp.getByText("본인", { exact: true }).count();
    return [human >= 1 && badge >= 1, { human, badge }];
  });
  await step("팬 답장 (직접) → 내 말풍선에 '✓ 이름에게 직접'", async () => {
    await fp.getByLabel("메시지").fill("저도 반가워요! 오늘 기록 잘 봤어요");
    await fp.getByRole("button", { name: "보내기" }).click();
    await fp.getByText("저도 반가워요! 오늘 기록 잘 봤어요").waitFor();
    await fp.getByText(new RegExp(`✓ ${NAME}에게 직접 ·`)).first().waitFor();
  });
  await shot(fp, "fan-human");
  await step("Studio 화면에 새로고침 없이 팬 답장 도착 (Realtime)", async () => {
    lastPage = cp;
    await cp.getByText("저도 반가워요! 오늘 기록 잘 봤어요").waitFor({ timeout: 20_000 });
  });
  await shot(cp, "studio-detail");
  await step("AI 모드로 바꾸면 'AI가 생성한 답변입니다 · 본인이 아니에요' 배너 · 크리에이터 메시지는 여전히 ✓ 본인 표시", async () => {
    lastPage = fp;
    await fp.getByRole("button", { name: `🤖 ${NAME} AI` }).click();
    await fp.getByText(`AI가 생성한 답변입니다 · ${NAME} 본인이 아니에요`).waitFor();
    const aiOnHuman = await fp.locator("text=안녕하세요, 직접 인사드려요!").locator("xpath=ancestor::div[contains(@class,'flex gap-2')][1]").getByText("AI", { exact: true }).count();
    return [aiOnHuman === 0, { aiOnHuman }];
  });
  await step("대화 목록: '✓ 이름 · …' 미리보기 (직접 메시지로 구분)", async () => {
    await fp.goto(`${BASE}/chat`);
    await fp.getByText(new RegExp(`(✓ ${NAME}|나 → ✓ ${NAME}) · `)).first().waitFor();
  });

  console.log("\n[Fan Memory → 크리에이터에게 명시적 공유]");
  await step("공유 전: Studio 상세에 공유 정보 없음", async () => {
    lastPage = cp;
    await cp.reload();
    await cp.getByText("팬이 직접 공유한 정보가 없어요", { exact: false }).waitFor();
  });
  await step("팬: '10월 20일 생일'만 날짜와 함께 공유 → '공유 중'", async () => {
    lastPage = fp;
    await fp.goto(`${BASE}/my/memory`);
    const row = fp.locator("li", { hasText: "10월 20일 생일" });
    await row.getByRole("button", { name: `${NAME}에게 공유` }).click();
    await row.getByText(`공유하면 ${NAME} 본인이 이 항목을 볼 수 있어요`, { exact: false }).waitFor();
    await row.getByLabel("공유할 날짜").fill("2000-10-20");
    await row.getByRole("button", { name: "공유하기" }).click();
    await row.getByText(`✓ ${NAME} 본인에게 공유 중`).waitFor();
  });
  await shot(fp, "memory-share");
  await step("Studio: 공유한 항목만 보임 (비공유 Memory는 안 보임)", async () => {
    lastPage = cp;
    await cp.reload();
    await cp.getByText("10월 20일 생일").waitFor();
    const t = await cp.locator("main").innerText();
    return [!t.includes(SECRET), t.includes(SECRET) ? "비공유 Memory 노출" : undefined];
  });
  await step("팬이 공유 취소 → Studio에서 사라짐", async () => {
    lastPage = fp;
    const row = fp.locator("li", { hasText: "10월 20일 생일" });
    await row.getByRole("button", { name: "공유 취소" }).click();
    await row.getByRole("button", { name: `${NAME}에게 공유` }).waitFor();
    lastPage = cp;
    await cp.reload();
    await cp.getByText("팬이 직접 공유한 정보가 없어요", { exact: false }).waitFor();
    return (await cp.getByText("10월 20일 생일").count()) === 0;
  });

  console.log("\n[신고 · 차단]");
  await step("팬이 크리에이터 메시지 신고 → '신고함' · 크리에이터는 신고 0행", async () => {
    lastPage = fp;
    await fp.goto(`${BASE}/chat/${cid}?mode=human`);
    await fp.getByText("안녕하세요, 직접 인사드려요!").waitFor();
    await fp.getByRole("button", { name: "· 신고" }).first().click();
    await fp.getByRole("button", { name: "스팸 · 광고" }).click();
    await fp.getByText("· 신고함").waitFor();
    const { data } = await C.sb.from("message_reports").select("id");
    return [(data ?? []).length === 0, data?.length];
  });
  await step("팬이 크리에이터 차단 → 입력창 대신 '차단한 크리에이터예요' · 크리에이터 전송 실패", async () => {
    await fp.getByRole("button", { name: "대화 설정" }).click();
    await fp.getByRole("button", { name: "차단하기" }).click();
    await fp.getByText("차단한 크리에이터예요.").waitFor();
    lastPage = cp;
    await cp.getByLabel("직접 메시지").fill("차단 후 메시지");
    await cp.getByRole("button", { name: "직접 보내기" }).click();
    await cp.getByText("지금은 메시지를 보낼 수 없어요.").waitFor();
  });
  await step("팬이 차단 해제 → 다시 입력 가능", async () => {
    lastPage = fp;
    await fp.getByRole("button", { name: "차단 해제" }).first().click();
    await fp.getByRole("dialog").getByRole("button", { name: "차단 해제" }).click();
    await fp.getByLabel("메시지").waitFor();
  });
  await step("크리에이터가 팬 차단 → '차단한 팬이에요' · 입력창 없음 → 해제", async () => {
    lastPage = cp;
    await cp.reload();
    await cp.getByRole("button", { name: "이 팬 차단" }).click();
    await cp.getByRole("dialog").getByRole("button", { name: "차단하기" }).click();
    await cp.getByText("차단한 팬이에요").waitFor();
    const composer = await cp.getByLabel("직접 메시지").count();
    await cp.getByRole("button", { name: "차단 해제" }).click();
    await cp.getByRole("dialog").getByRole("button", { name: "차단 해제" }).click();
    await cp.getByLabel("직접 메시지").waitFor();
    return [composer === 0, { composer }];
  });

  console.log("\n[구독 종료 · 무료 팔로워]");
  await step("구독 종료(결제 서버) → 양쪽 모두 기록은 보이고 새 메시지 입력은 없음", async () => {
    await admin.from("subscriptions").update({ tier: "follow" }).eq("fan_id", F.uid).eq("creator_id", cid);
    lastPage = cp;
    await cp.reload();
    await cp.getByText("저도 반가워요! 오늘 기록 잘 봤어요").waitFor();
    await cp.getByText("지금 구독 중인 팬에게만 보낼 수 있어요.", { exact: false }).waitFor();
    lastPage = fp;
    await fp.goto(`${BASE}/chat/${cid}`);
    await fp.getByText("안녕하세요, 직접 인사드려요!").waitFor();
    return (await fp.getByRole("button", { name: `✓ ${NAME}에게 직접` }).count()) === 0;
  });
  await step("무료 팔로워: 직접 메시지 선택지 없음", async () => {
    const wp = await newPage();
    lastPage = wp;
    await login(wp, W);
    await wp.goto(`${BASE}/chat/${cid}`);
    await wp.getByText("AI가 생성한 답변입니다", { exact: false }).waitFor();
    return (await wp.getByRole("button", { name: `✓ ${NAME}에게 직접` }).count()) === 0;
  });

  await step("페이지 오류 없음", async () => [pageErrors.length === 0, pageErrors]);
} catch (e) {
  failed++;
  console.error("테스트 준비/실행 실패:", e instanceof Error ? e.message.split("\n")[0] : e);
} finally {
  await browser.close().catch(() => {});
  for (const id of userIds) await admin.auth.admin.deleteUser(id).catch(() => {});
  stopServer();
  console.log(`\n정리: 테스트 계정 ${userIds.length}명 삭제 · 모델 호출 0회 · 스크린샷 ${SHOTS}/human-*.png`);
  console.log(`\n${passed} passed, ${failed} failed`);
  setTimeout(() => process.exit(failed ? 1 : 0), 500);
}
