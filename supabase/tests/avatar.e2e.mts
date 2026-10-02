/**
 * v0.8.5 브라우저 E2E — Creator AI Avatar · Studio (실제 Supabase + 실제 Chrome + 빌드된 앱). LLM 호출 없음 (서버 AI_PROVIDER=none).
 *
 *   npm run build && npm run test:avatar-e2e -- --confirm-dev
 *
 *   크리에이터 프로필(직업 · 소개) → 팬 프로필 소개 탭 · AI 문답 ON 가드(안내 → 기본정보) → 기본정보 · 말투 학습(UI 일부 + 함수)
 *   → 말투 직접 덮어쓰기 불가 → Avatar 확인(성향 · 경계) → ON → 환영 메시지(정확히 1회 · 자동 메시지 표시)
 *   → 팬 AI 대화 열람 안내 확인 → 크리에이터 Fans 플랜 탭 · 개수 · 팬 상세 정보 · 대화 2탭(한 타임라인 · AI 대화는 안내 이후만) · AI 팬 요약 UI(응답 가로채기 — LLM 없음)
 *   → 통계(실제 숫자 · 조회수 준비 중 · 빈 기간) → 320px: 팔로우/팔로잉 한 줄 · 긴 이름/소개/직업 가로 넘침 없음 → OFF
 *
 * · 준비(가입 · 구독 부여)는 API로 — admin은 결제 서버 역할(구독 부여)과 정리에만. AI 대화 기록은 record_ai_exchange(서버 키 + 팬 JWT)로 — 모델 호출 아님.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright-core";
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
  if (!ok && lastPage) await lastPage.screenshot({ path: `${SHOTS}/avatar-fail-${++shots}.png`, fullPage: true }).catch(() => {});
}
const shot = (p: Page, name: string) => p.screenshot({ path: `${SHOTS}/avatar-${name}.png`, fullPage: true }).catch(() => {});

let server: ChildProcess | null = null;
async function startServer() {
  if (await fetch(`${BASE}/login`).then(() => true, () => false)) throw new Error(`포트 ${PORT}에 이미 서버가 떠 있어요.`);
  // 모델 호출 없음: 이 서버는 LLM Provider 없이 뜬다
  server = spawn("npx", ["next", "start", "-p", String(PORT)], { shell: true, stdio: "ignore", env: { ...process.env, AI_PROVIDER: "none", AI_FAN_SUMMARY: "off" } });
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
async function account(tag: string, nickname: string, role: "creator" | "fan"): Promise<Acc> {
  const sb = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `momenty-ax-${tag}-${stamp}@gmail.com`;
  const password = `Ax-${randomBytes(9).toString("base64url")}1a`;
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { nickname, signup_role: role, interests: ["art"], onboarded: true } } });
  if (error) throw error;
  if (!data.session) throw new Error("세션 없음 (Confirm email?)");
  userIds.push(data.user!.id);
  return { uid: data.user!.id, email, password, sb };
}

const pageErrors: string[] = [];
const external: string[] = [];
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
async function newPage(width = 390, height = 844) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  await ctx.addInitScript("window.__name = (f) => f");
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.host !== `localhost:${PORT}` && !URL_.includes(u.host) && !u.protocol.startsWith("data") && !u.protocol.startsWith("blob")) external.push(u.host);
  });
  return page;
}
async function login(page: Page, a: Acc) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("이메일").fill(a.email);
  await page.getByLabel("비밀번호").fill(a.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

const NAME = `아바타${stamp.slice(-3)}`;
const JOB = "유튜버";
const BIO = "매일 작은 순간을 기록해요.\n오늘도 반가워요!";
const WELCOME = "안녕! 구독해 줘서 고마워 :)\n앞으로 여기서 내 일상이랑 이야기 많이 나눠 보자.";
const FORBIDDEN = /(충성|이탈|과금|외로운|우울|건강 상태|경제 상황|정치 성향)/;

try {
  await startServer();
  const C = await account("c", NAME, "creator");
  const F = await account("f", "구독팬", "fan");
  const W = await account("w", "무료팬", "fan");
  const Z = await account("z", "새팬", "fan");
  const L = await account("l", "긴이름", "creator");
  const { data: cr, error: cErr } = await C.sb.from("creators").insert({ profile_id: C.uid, name: NAME, handle: `ax.${stamp}`, category: "art", job: JOB, bio: BIO }).select("id, persona_enabled").single();
  if (cErr) throw cErr;
  const cid = cr.id as string;
  const longName = "가".repeat(40);
  const longJob = "나".repeat(40);
  const longBio = "긴소개문장".repeat(60);
  const { data: lr, error: lErr } = await L.sb.from("creators").insert({ profile_id: L.uid, name: longName, handle: `axl.${stamp}`, category: "art", job: longJob, bio: longBio }).select("id").single();
  if (lErr) throw lErr;
  const lid = lr.id as string;
  await C.sb.from("moments").insert({ creator_id: cid, type: "text", content: "오늘의 기록 하나", visibility: "public" });
  {
    const { error } = await W.sb.from("subscriptions").insert({ fan_id: W.uid, creator_id: cid, tier: "follow" });
    if (error) throw error;
  }
  console.log(`준비: 크리에이터 ${NAME}(직업 ${JOB}) · 구독 팬 F · 무료 팔로워 W · 새 팬 Z · 긴 프로필 크리에이터 L`);

  console.log("\n[크리에이터 프로필 · 새 채널 기본값]");
  await step("새 채널은 AI 문답 OFF", async () => [cr.persona_enabled === false, cr]);
  const fp = await newPage();
  lastPage = fp;
  await login(fp, Z);
  await step("팬 프로필 소개 탭: 활동명 · @아이디 · 직업 · 소개 · 구독 플랜 (AI Avatar 안내 없음 — 꺼져 있음)", async () => {
    await fp.goto(`${BASE}/creators/${cid}?tab=intro`);
    await fp.getByText(JOB, { exact: true }).first().waitFor();
    const body = await fp.locator("main").innerText();
    return [body.includes(`@ax.${stamp}`) && body.includes("매일 작은 순간을 기록해요.") && body.includes("구독 플랜") && body.includes("Premium") && !body.includes("공식 AI Avatar와 대화할 수 있어요"), body.slice(0, 400)];
  });

  console.log("\n[AI 문답 ON 가드]");
  const cp = await newPage();
  lastPage = cp;
  await login(cp, C);
  await step("준비 전 ON → 안내 문구와 함께 기본정보 화면으로", async () => {
    await cp.goto(`${BASE}/studio/settings/avatar`);
    await cp.getByRole("radio", { name: "ON" }).click();
    await cp.waitForURL(/\/studio\/settings\/avatar\/basics/);
    await cp.getByText("AI Avatar를 사용하려면 먼저 기본정보와 말투 학습을 완료해 주세요.").waitFor();
    return true;
  });
  await step("API로 직접 ON → DB가 거부 (avatar_not_ready)", async () => {
    const { error } = await C.sb.from("creators").update({ persona_enabled: true }).eq("id", cid);
    return [!!error && /avatar_not_ready/.test(error.message), error?.message];
  });

  console.log("\n[STEP 1 기본정보]");
  await step("기본정보 입력(말하고 싶지 않아요 포함) → 저장 → 말투 학습으로", async () => {
    await cp.getByLabel("좋아하는 음식").fill("떡볶이");
    await cp.getByLabel("취미").fill("필름 카메라");
    await cp.getByLabel("관심사").fill("여행");
    await cp.getByLabel("좋아하는 것").fill("새벽 공기");
    await cp.getByLabel("싫어하는 것").fill("약속에 늦는 것");
    await cp.locator("section").filter({ hasText: "싫어하는 음식" }).getByRole("button", { name: "말하고 싶지 않아요" }).click();
    await shot(cp, "01-basics");
    await cp.getByRole("button", { name: "저장하고 말투 알려주기" }).click();
    await cp.waitForURL(/\/studio\/settings\/avatar\/training/);
    const { data } = await C.sb.from("creator_facts").select("basic_key, content, undisclosed").eq("creator_id", cid).not("basic_key", "is", null);
    return [data?.length === 6 && data.some((f) => f.basic_key === "disliked_food" && f.undisclosed) && data.some((f) => f.content === "좋아하는 음식: 떡볶이"), data];
  });
  await step("기본정보는 다시 수정 가능 (한 행 유지)", async () => {
    const { error } = await C.sb.rpc("save_avatar_basics", { p_job: JOB, p_items: { favorite_food: { value: "초밥" } } });
    const { data } = await C.sb.from("creator_facts").select("content").eq("creator_id", cid).eq("basic_key", "favorite_food");
    return [!error && data?.length === 1 && data[0].content === "좋아하는 음식: 초밥", error ?? data];
  });

  console.log("\n[STEP 2 말투 학습]");
  await step("UI에서 3개 답 → 진행률 3 / 40", async () => {
    for (const reply of ["오 반가워 ㅋㅋ 자주 놀러 와!", "오늘은 사진 정리했어 ㅋㅋ 너는?", "헐 고마워!! 다음에도 재밌게 할게"]) {
      await cp.getByLabel("당신이라면 어떻게 답하시겠어요?").fill(reply);
      await cp.getByRole("button", { name: "저장하고 다음" }).click();
      await cp.getByLabel("당신이라면 어떻게 답하시겠어요?").and(cp.locator(":not([value])")).first().waitFor().catch(() => {});
      await cp.waitForTimeout(400);
    }
    await cp.getByText("3 / 40 문답 완료").waitFor();
    await shot(cp, "02-training");
    return true;
  });
  await step("나머지 답 저장 (앱과 같은 함수) → 최소 문답 · 필수 질문 충족", async () => {
    const { data: prompts } = await C.sb.from("avatar_training_prompts").select("key").order("sort");
    const done = new Set(((await C.sb.from("creator_style_samples").select("prompt_key").eq("creator_id", cid)).data ?? []).map((r) => r.prompt_key));
    const items = (prompts ?? []).filter((p) => !done.has(p.key)).map((p, i) => ({ key: p.key, reply: ["응응 알겠어 ㅋㅋ", "그건 비밀이야 ㅋㅋ 다른 얘기 하자", "고마워!! 너도 좋은 하루 보내", "음 그건 잘 모르겠어 ㅋㅋ"][i % 4] }));
    const { data, error } = await C.sb.rpc("save_style_answers", { p_items: items });
    return [!error && data.style.done === true, error ?? data?.style];
  });
  await step("학습 답변 직접 덮어쓰기(update) · 삭제 · 직접 insert → 모두 거부", async () => {
    const { data: one } = await C.sb.from("creator_style_samples").select("id").eq("creator_id", cid).limit(1).single();
    const up = await C.sb.from("creator_style_samples").update({ reply: "덮어쓰기" }).eq("id", one!.id).select("id");
    const del = await C.sb.from("creator_style_samples").delete().eq("id", one!.id).select("id");
    const ins = await C.sb.from("creator_style_samples").insert({ creator_id: cid, source: "onboarding", prompt_key: "today_1", fan_message: "x", reply: "y" });
    const { data: after } = await C.sb.from("creator_style_samples").select("reply").eq("id", one!.id).single();
    return [!!up.error && !!del.error && !!ins.error && after?.reply !== "덮어쓰기", [up.error?.message, del.error?.message, ins.error?.message]];
  });
  await step("말투 칸(creator_personas.formality) 직접 쓰기 → 거부", async () => {
    const { error } = await C.sb.from("creator_personas").insert({ creator_id: cid, formality: "casual" });
    return [!!error, error?.message];
  });
  await step("추가 학습(Avatar Training) 저장", async () => {
    const { error } = await C.sb.rpc("add_style_training", { p_fan_message: "라이브 언제 해?", p_reply: "곧 알려 줄게!! ㅋㅋ" });
    return [!error, error];
  });

  console.log("\n[STEP 3 Avatar 확인 → ON]");
  await step("학습한 말투 요약 · 성향 선택 · 대화 경계 확인 → AI 문답 시작", async () => {
    await cp.goto(`${BASE}/studio/settings/avatar/review`);
    await cp.getByText("주로 반말").waitFor();
    await cp.getByRole("button", { name: "따뜻한" }).click();
    await cp.getByRole("button", { name: "대화 경계를 확인했어요" }).click();
    await cp.getByText(/대화 경계 확인함/).waitFor();
    await shot(cp, "03-review");
    await cp.getByRole("button", { name: "AI 문답 시작하기" }).click();
    await cp.waitForURL(/\/studio\/settings\/avatar$/);
    await cp.getByRole("radio", { name: "ON", checked: true }).waitFor();
    const { data } = await C.sb.from("creators").select("persona_enabled").eq("id", cid).single();
    return [data?.persona_enabled === true, data];
  });

  console.log("\n[구독 환영 메시지]");
  await step("환영 메시지 저장 (미리보기에 자동 메시지 표시)", async () => {
    await cp.goto(`${BASE}/studio/settings/welcome`);
    await cp.getByLabel("구독 환영 메시지").fill(WELCOME);
    // 안내 문구에도 같은 말이 있으므로 미리보기 영역 안에서만 찾는다
    const preview = cp.locator("div").filter({ hasText: "팬에게 이렇게 보여요" }).last();
    await preview.getByText("Creator가 설정한 자동 환영 메시지").waitFor();
    await cp.getByRole("button", { name: "저장" }).click();
    await cp.getByRole("button", { name: "저장했어요" }).waitFor();
    return true;
  });
  await step("유료 구독 활성화 → 환영 메시지 정확히 1개 · 등급 변경에도 추가 없음", async () => {
    const a = await admin.from("subscriptions").insert({ fan_id: F.uid, creator_id: cid, tier: "subscriber" });
    if (a.error) throw a.error;
    await admin.from("subscriptions").update({ tier: "premium" }).eq("fan_id", F.uid).eq("creator_id", cid);
    const { data } = await admin.from("subscription_welcomes").select("message, tier").eq("fan_id", F.uid).eq("creator_id", cid);
    return [data?.length === 1 && data[0].message === WELCOME.trim(), data];
  });
  await step("무료 팔로워에게는 환영 메시지 없음", async () => {
    const { count } = await admin.from("subscription_welcomes").select("*", { count: "exact", head: true }).eq("fan_id", W.uid);
    return [count === 0, count];
  });

  console.log("\n[팬 — 환영 메시지 · AI 대화 열람 안내]");
  const fan = await newPage();
  lastPage = fan;
  await login(fan, F);
  await step("소개 탭에 '공식 AI Avatar와 대화할 수 있어요' (본인 아님 명시)", async () => {
    await fan.goto(`${BASE}/creators/${cid}?tab=intro`);
    await fan.getByText("공식 AI Avatar와 대화할 수 있어요").waitFor();
    const body = await fan.locator("main").innerText();
    return [body.includes("본인이 아니에요"), body.slice(0, 300)];
  });
  await step("대화방: 환영 메시지는 '자동 환영 메시지' 라벨 (본인 라벨 없음)", async () => {
    await fan.goto(`${BASE}/chat/${cid}`);
    await fan.getByText("Creator가 설정한 자동 환영 메시지").waitFor();
    const bubble = fan.locator("div").filter({ hasText: "Creator가 설정한 자동 환영 메시지" }).filter({ hasText: "구독해 줘서 고마워" }).last();
    const text = await bubble.innerText();
    return [!text.includes("본인") && text.includes("구독해 줘서 고마워"), text];
  });
  await step("AI 대화 전 안내 → 확인 전 입력창 숨김 · 확인하면 열림 (DB 기록)", async () => {
    await fan.getByText("안내를 확인한 이후의 AI 대화를 볼 수 있어요", { exact: false }).first().waitFor();
    const hiddenBefore = !(await fan.getByLabel("메시지").isVisible());
    await shot(fan, "04-notice");
    await fan.getByRole("button", { name: "확인하고 시작하기" }).click();
    await fan.getByLabel("메시지").waitFor({ state: "visible" });
    const { data } = await F.sb.from("ai_creator_view_consents").select("agreed_at").eq("creator_id", cid);
    return [hiddenBefore && data?.length === 1, data];
  });
  await step("AI 대화 1회 기록 (서버 키 + 팬 JWT · 모델 호출 아님)", async () => {
    const { error } = await F.sb.rpc("record_ai_exchange", { p_server_key: SERVER_KEY, p_creator_id: cid, p_fan_message: "요즘 필름 카메라 배우는 중이야", p_ai_reply: "오 멋지다 ㅋㅋ 어떤 사진 찍었어?", p_grounded_moment_ids: [], p_context_types: [], p_provider: null, p_model: null, p_boundary: null });
    return [!error, error];
  });

  console.log("\n[크리에이터 — Fans 플랜 · 대화 · 요약]");
  lastPage = cp;
  await step("Fans 탭: 전체 2 · 무료 1 · 구독 0 · Premium 1 (DB 개수와 같음)", async () => {
    await cp.goto(`${BASE}/studio/fans`);
    const tab = (label: string) => cp.getByRole("tab", { name: new RegExp(`^${label}`) });
    await tab("전체").getByText("2").waitFor();
    const t = await Promise.all(["전체", "무료", "구독", "Premium"].map(async (l) => (await tab(l).innerText()).replace(/\s+/g, " ")));
    return [t.join("|") === "전체 2|무료 1|구독 0|Premium 1", t];
  });
  await step("Premium 탭 → 구독 팬만 · 무료 탭 → 무료 팔로워만", async () => {
    await cp.getByRole("tab", { name: /^Premium/ }).click();
    await cp.getByText("구독팬").first().waitFor();
    const premium = await cp.locator("main").innerText();
    await cp.getByRole("tab", { name: /^무료/ }).click();
    await cp.getByText("무료팬").first().waitFor();
    const free = await cp.locator("main").innerText();
    return [!premium.includes("무료팬") && !free.includes("구독팬"), { premium: premium.slice(-200), free: free.slice(-200) }];
  });
  await step("팬 상세: 탭은 정보 · 대화 2개 (요약 탭 없음)", async () => {
    await cp.goto(`${BASE}/studio/fans/${F.uid}`);
    await cp.getByText("구독 플랜").waitFor();
    const tabs = await cp.getByRole("tab").allInnerTexts();
    return [tabs.map((t) => t.trim()).join("|") === "정보|대화", tabs];
  });
  await step("대화 탭: 선택 UI 없이 바로 한 타임라인 · AI 답은 🤖 AI 표시 (안내 이후) · 내 메시지 아님 안내", async () => {
    await cp.getByRole("tab", { name: "대화" }).click();
    await cp.getByText("요즘 필름 카메라 배우는 중이야").waitFor();
    await cp.getByText("오 멋지다 ㅋㅋ 어떤 사진 찍었어?").waitFor();
    const selectors = (await cp.getByRole("tab", { name: /AI Avatar 대화|직접 대화/ }).count()) + (await cp.getByRole("radio", { name: /AI Avatar 대화|직접 대화/ }).count()) + (await cp.getByRole("button", { name: /AI Avatar 대화|✓ 직접 대화/ }).count());
    const body = await cp.locator("main").innerText();
    await shot(cp, "05-fan-ai");
    return [selectors === 0 && body.includes("안내를 확인한") && body.includes("AI Avatar가 보낸 답 (내가 쓴 메시지 아님)") && body.includes(`🤖 ${NAME} AI`), { selectors, body: body.slice(-500) }];
  });
  await step("다른 크리에이터(L)는 이 팬의 AI 대화를 볼 수 없음", async () => {
    const { error } = await L.sb.rpc("creator_fan_ai_messages", { p_fan_id: F.uid });
    return [!!error && /fan_not_found/.test(error.message), error?.message];
  });
  await step("정보 탭: 구독 정보 · 있었던 일(대화 사실 · 실제 기록) · AI 팬 요약 '아직 정리된 내용이 없어요' · 추정/평가 없음", async () => {
    await cp.getByRole("tab", { name: "정보" }).click();
    await cp.getByText("아직 정리된 내용이 없어요.").waitFor();
    const body = await cp.locator("main").innerText();
    await shot(cp, "06-info");
    const order = ["구독 정보", "있었던 일", "팬이 공유한 정보", "내 메모", "AI 팬 요약", "이 팬 차단하기"].map((k) => body.indexOf(k));
    return [
      !FORBIDDEN.test(body) && order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1])) && body.includes("AI Avatar 대화 1개 메시지") && body.includes("실제 기록 그대로예요") && !body.includes("AI 요약 · 준비 중"),
      { order, body: body.slice(0, 700) },
    ];
  });
  // 서버는 AI_FAN_SUMMARY=off — 실제 LLM은 부르지 않는다
  await step("AI 팬 요약: 서버 설정이 꺼져 있으면 실패 안내 · 사실 정보는 그대로", async () => {
    await cp.getByRole("button", { name: "팬 요약 만들기" }).click();
    await cp.getByRole("alert").filter({ hasText: "지금은 AI 팬 요약을 만들 수 없어요." }).waitFor();
    const body = await cp.locator("main").innerText();
    return [body.includes("AI Avatar 대화 1개 메시지") && body.includes("구독 플랜") && body.includes("팬 요약 만들기"), body.slice(-400)];
  });
  await step("AI 팬 요약 UI: 로딩 → 성공(요약 · 마지막 정리 · 다시 정리하기) → 다시 정리 실패해도 이전 요약 유지 (응답만 가로챔 · LLM 없음)", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    await cp.route("**/api/studio/fan-summary", async (route) => {
      calls++;
      if (calls === 1) {
        await gate;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, summary: { sentences: ["10월부터 Premium을 구독하고 있어요.", "AI Avatar와 필름 카메라 이야기를 나눴어요."], generatedAt: "2026-10-02T03:20:00Z" } }) });
      }
      return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "summary_failed", message: "요약을 만들지 못했어요. 잠시 후 다시 시도해 주세요." } }) });
    });
    try {
      await cp.getByRole("button", { name: "팬 요약 만들기" }).click();
      await cp.getByText("정리하고 있어요…").waitFor();
      const loadingDisabled = await cp.getByRole("button", { name: "정리 중…" }).isDisabled();
      release();
      await cp.getByTestId("ai-fan-summary").waitFor();
      const ok = await cp.getByTestId("ai-fan-summary").innerText();
      const meta = await cp.getByText(/^마지막 정리: /).innerText();
      await cp.getByRole("button", { name: "다시 정리하기" }).click();
      await cp.getByRole("alert").filter({ hasText: "요약을 만들지 못했어요." }).waitFor();
      const kept = await cp.getByTestId("ai-fan-summary").innerText();
      await shot(cp, "07-ai-summary");
      return [loadingDisabled && ok.includes("필름 카메라") && /마지막 정리: 10월 2일 12:20/.test(meta) && kept === ok && calls === 2, { loadingDisabled, ok, meta, kept, calls }];
    } finally {
      await cp.unroute("**/api/studio/fan-summary");
    }
  });
  await step("차단 action: '이 팬 차단하기' · danger 색", async () => {
    const btn = cp.getByRole("button", { name: "이 팬 차단하기" });
    const color = await btn.evaluate((e) => getComputedStyle(e).color);
    const danger = await cp.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--color-danger)";
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    return [color === danger && color !== "", { color, danger }];
  });
  await step("크리에이터는 여전히 ai_messages · fan_memories를 직접 읽을 수 없음 (0행)", async () => {
    const a = await C.sb.from("ai_messages").select("id");
    const b = await C.sb.from("fan_memories").select("id");
    return [(a.data?.length ?? 0) === 0 && (b.data?.length ?? 0) === 0, [a.data?.length, b.data?.length]];
  });

  console.log("\n[통계]");
  await step("7일: 실제 숫자 · 조회수는 데이터 준비 중 · 차트", async () => {
    await cp.goto(`${BASE}/studio/analytics`);
    await cp.getByText("데이터 준비 중 — 아직 저장하지 않아요").waitFor();
    await cp.getByText("일별 받은 반응").waitFor();
    const { data } = await C.sb.rpc("creator_analytics", { p_from: new Date(Date.now() - 6 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }), p_to: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) });
    const moments = (data?.days ?? []).reduce((n: number, d: { moments: number }) => n + d.moments, 0);
    const ai = (data?.days ?? []).reduce((n: number, d: { aiMessages: number }) => n + d.aiMessages, 0);
    await shot(cp, "07-analytics");
    return [moments === 1 && ai === 1, data?.days?.slice(-1)];
  });
  await step("오늘 → 그날 Moment 비교 목록", async () => {
    await cp.getByRole("tab", { name: "오늘" }).click();
    await cp.getByText("그날의 Moment · 반응 비교").waitFor();
    await cp.getByText("오늘의 기록 하나").waitFor();
    return true;
  });
  await step("기록 없는 날짜 선택 → 빈 상태 (가짜 숫자 없음)", async () => {
    await cp.getByRole("tab", { name: "날짜 선택" }).click();
    await cp.locator('input[type="date"]').fill(new Date(Date.now() - 200 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }));
    await cp.getByText("이 기간에는 기록된 활동이 없어요").waitFor();
    return true;
  });

  console.log("\n[작은 화면 320px]");
  const small = await newPage(320, 640);
  lastPage = small;
  await login(small, W);
  const oneLine = async (p: Page, label: string) => {
    const b = p.getByRole("button", { name: label, exact: true }).first();
    await b.waitFor();
    const box = await b.boundingBox();
    const lines = await b.evaluate((el) => {
      const span = el.querySelector("span:last-child") ?? el;
      const r = span.getClientRects();
      return r.length;
    });
    return { h: box?.height ?? 0, lines };
  };
  await step("팔로잉 버튼 한 줄 (높이 · 줄 수)", async () => {
    await small.goto(`${BASE}/creators/${cid}`);
    const r = await oneLine(small, "팔로잉");
    await shot(small, "08-following-320");
    return [r.h <= 34 && r.lines === 1, r];
  });
  await step("팔로우 버튼 한 줄", async () => {
    await small.goto(`${BASE}/creators/${lid}`);
    const r = await oneLine(small, "팔로우");
    return [r.h <= 34 && r.lines === 1, r];
  });
  await step("긴 이름 · 직업 · 소개: 가로 넘침 없음", async () => {
    await small.goto(`${BASE}/creators/${lid}?tab=intro`);
    await small.getByText(longJob).first().waitFor();
    const w = await small.evaluate(() => document.documentElement.scrollWidth);
    await shot(small, "09-long-profile-320");
    return [w <= 320, w];
  });
  await step("소개가 빈 크리에이터 → 빈 상태 문구 (억지 소개 없음)", async () => {
    await L.sb.from("creators").update({ bio: "" }).eq("id", lid);
    await small.goto(`${BASE}/creators/${lid}?tab=intro`);
    await small.getByText("아직 소개를 적지 않았어요.").waitFor();
    return true;
  });
  await step("Studio 화면들 320px 가로 넘침 없음 (AI Avatar · 말투 학습 · Fans · 통계)", async () => {
    const sp = await newPage(320, 640);
    await login(sp, C);
    const widths: Record<string, number> = {};
    for (const path of ["/studio/settings/avatar", "/studio/settings/avatar/training", "/studio/fans", "/studio/analytics", `/studio/fans/${F.uid}`]) {
      await sp.goto(`${BASE}${path}`);
      await sp.waitForLoadState("networkidle");
      widths[path] = await sp.evaluate(() => document.documentElement.scrollWidth);
    }
    return [Object.values(widths).every((w) => w <= 320), widths];
  });

  console.log("\n[OFF]");
  lastPage = cp;
  await step("크리에이터 OFF → 팬 소개 탭에서 AI Avatar 안내 사라짐 · AI 대화 거부", async () => {
    await cp.goto(`${BASE}/studio/settings/avatar`);
    await cp.getByRole("radio", { name: "OFF" }).click();
    await cp.getByRole("radio", { name: "OFF", checked: true }).waitFor();
    await fan.goto(`${BASE}/creators/${cid}?tab=intro`);
    await fan.getByText(JOB, { exact: true }).first().waitFor();
    const body = await fan.locator("main").innerText();
    const { error } = await F.sb.rpc("ai_persona_context", { p_server_key: SERVER_KEY, p_creator_id: cid });
    return [!body.includes("공식 AI Avatar와 대화할 수 있어요") && !!error && /persona_disabled/.test(error.message), error?.message];
  });

  console.log("\n[공통]");
  await step("외부 요청 없음 (앱 · Supabase만)", async () => [external.length === 0, [...new Set(external)]]);
  await step("페이지 오류 없음", async () => [pageErrors.length === 0, pageErrors.slice(0, 3)]);
} catch (e) {
  failed++;
  console.log(`   ✗ 중단: ${e instanceof Error ? e.message : e}`);
} finally {
  await browser.close().catch(() => {});
  stopServer();
  const r = await cleanupTestUsers(admin, userIds);
  console.log(`\n정리: 이 실행이 만든 계정 ${r.users}명 · 파일 ${r.files}개 · 신고 ${r.reports}개 · 모델 호출 0회`);
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
