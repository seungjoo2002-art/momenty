/**
 * v0.8.1 크리에이터 등록 · Discover 브라우저 E2E — 실제 Supabase + 실제 Chrome + 빌드된 앱. LLM 호출 없음.
 *
 *   npm run build && npm run test:discover-e2e -- --confirm-dev
 *
 *   Fan A 가입 → (크리에이터 0명이면) Discover 빈 화면
 *   → Creator B 가입 · 채널 등록 → Fan A Discover에 등장 (새로 고침만으로 — seed · 복사 없음)
 *   → Fan C가 그 뒤에 가입 → Fan C Discover에도 등장
 *   → B가 Moment 공개 → A가 팔로우 → A Today에 등장
 *   → B의 Safe Delay Moment: 공개 전 A Today에 없음 → 지금 공개 후 등장
 *   → A가 B 차단 → A의 Discover · Today에서 사라짐 (C에게는 그대로) → 차단 해제 → 다시 보임
 *   → B 계정 삭제(UI) → Discover · 프로필 · Today에서 사라짐 · Storage 흔적 없음
 *
 * · 모든 계정은 이 실행이 만든 1회용 (momenty-dx-…). 실제 · 보존 계정을 쓰지 않는다.
 * · admin(service role)은 id 조회 · 흔적 확인 · 끝난 뒤 정리에만. 정리는 이 실행이 만든 id만 (Storage → 계정).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright-core";
import { cleanupTestUsers, registerCleanup } from "./support/cleanup.mjs";

process.loadEnvFile(".env.local");
if (!process.argv.includes("--confirm-dev")) {
  console.error("실제 Supabase에 테스트 계정을 만들었다가 지우는 테스트예요. --confirm-dev 를 붙여 실행하세요.");
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
{
  const settings = await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: KEY } }).then((r) => r.json());
  if (!settings.mailer_autoconfirm) {
    console.error("가입 확인 메일이 켜져 있어요. Confirm email을 끄고 실행하세요 (가입 메일이 나가지 않도록).");
    process.exit(1);
  }
}
mkdirSync(SHOTS, { recursive: true });

let passed = 0;
let failed = 0;
let skipped = 0;
let lastPage: Page | null = null;
let shots = 0;
async function step(name: string, fn: () => Promise<boolean | [boolean] | [boolean, unknown] | void>) {
  let ok = false;
  let detail = "";
  try {
    const r = await fn();
    const [o, d] = Array.isArray(r) ? [r[0], r[1]] : [r ?? true, undefined];
    ok = o;
    if (d !== undefined) detail = typeof d === "string" ? d : JSON.stringify(d);
  } catch (e) {
    detail = e instanceof Error ? e.message.split("\n")[0] : String(e);
  }
  if (ok) passed++;
  else failed++;
  console.log(`   ${ok ? "✓" : "✗"} ${name}${!ok && detail ? `  → ${detail}` : ""}`);
  if (!ok && lastPage) await lastPage.screenshot({ path: `${SHOTS}/discover-fail-${++shots}.png`, fullPage: true }).catch(() => {});
}
const shot = (p: Page, name: string) => p.screenshot({ path: `${SHOTS}/discover-${name}.png`, fullPage: true }).catch(() => {});

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
const acc = (tag: string, name: string) => ({ email: `momenty-dx-${tag}-${stamp}@gmail.com`, password: `Dx-${randomBytes(9).toString("base64url")}1a`, name });
const A = acc("fana", `팬A${stamp.slice(-3)}`);
const B = { ...acc("creatorb", `크리에이터B${stamp.slice(-3)}`), handle: `dxb.${stamp}` };
const C = acc("fanc", `팬C${stamp.slice(-3)}`);

async function uidOf(email: string) {
  for (let page = 1; ; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    const u = data.users.find((x) => x.email === email);
    if (u) return u.id;
    if (data.users.length < 1000) return "";
  }
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const pageErrors: string[] = [];
const SUPA_HOST = new URL(URL_).host;
const externalRequests: string[] = [];
const fontResponses: { path: string; status: number }[] = [];
async function newPage(tag: string) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  await ctx.addInitScript("window.__name = (f) => f");
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (e) => pageErrors.push(`${tag}: ${e.message}`));
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith("data:") && !u.startsWith("blob:") && ![`localhost:${PORT}`, SUPA_HOST].includes(new URL(u).host)) externalRequests.push(u);
  });
  page.on("response", (r) => {
    if (/PretendardVariable\.subset\..*\.woff2/.test(r.url())) fontResponses.push({ path: new URL(r.url()).pathname, status: r.status() });
  });
  return page;
}
async function signUpFan(page: Page, a: typeof A) {
  await page.goto(`${BASE}/signup`);
  await page.getByLabel("닉네임").fill(a.name);
  await page.getByLabel("이메일").fill(a.email);
  await page.getByLabel("비밀번호").fill(a.password);
  await page.getByRole("button", { name: "가입하고 시작하기" }).click();
  await page.waitForURL(/\/setup\/interests$/);
  const id = await uidOf(a.email);
  if (id) userIds.push(id);
  await page.getByRole("button", { name: "아트" }).click();
  await page.getByRole("button", { name: "크리에이터 찾아보기" }).click();
  await page.waitForURL(/\/discover$/);
  return id;
}
/** Discover 목록에 이 크리에이터가 보이는지 (새로 불러온 화면 기준) */
async function discoverShows(page: Page, name: string) {
  await page.goto(`${BASE}/discover`);
  await page.getByRole("heading", { name: "Discover" }).waitFor();
  await page.waitForLoadState("networkidle");
  return (await page.getByText(name, { exact: true }).count()) > 0;
}
async function todayText(page: Page) {
  await page.goto(`${BASE}/today`);
  await page.waitForLoadState("networkidle");
  return page.locator("main").innerText();
}
async function publish(page: Page, kind: "text" | "photo", content: string, file?: Buffer) {
  await page.goto(`${BASE}/studio/record?type=${kind}`);
  if (kind === "photo") {
    await page.locator('input[type="file"]').first().setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: file! });
    await page.getByPlaceholder("한 줄 남기기").fill(content);
  } else {
    await page.getByPlaceholder("지금 떠오른 생각, 오늘의 한 문장…").fill(content);
  }
  await page.getByRole("button", { name: "다음" }).click();
  await page.waitForURL(/\/studio\/record\/preview$/);
  await page.getByRole("radio", { name: /^전체/ }).click();
  await page.getByRole("button", { name: /^(공개하기|공개 예약하기)$/ }).click({ timeout: 120_000 });
  await page.waitForURL(/\/studio(\?|$)/, { timeout: 60_000 });
}

let cid = "";
let bUid = "";
try {
  await startServer();
  const existing = (await admin.from("creators").select("id", { count: "exact", head: true })).count ?? 0;
  console.log(`준비: 이 프로젝트의 기존 크리에이터 ${existing}명 · 이 실행의 1회용 계정 A · B · C`);

  console.log("\n[Fan A 가입 · 빈 Discover]");
  const pa = await newPage("fanA");
  lastPage = pa;
  await step("Fan A 가입(UI) → 관심사 → Discover", async () => [!!(await signUpFan(pa, A))]);
  if (existing === 0) {
    await step("크리에이터 0명 → '아직 크리에이터가 없어요' (가짜 목록 없음)", async () => {
      await pa.getByText("아직 크리에이터가 없어요").waitFor();
      return (await pa.locator("main a[href^='/creators/']").count()) === 0;
    });
    await shot(pa, "empty");
  } else {
    skipped++;
    console.log(`   – 건너뜀: 이미 크리에이터 ${existing}명이 있어 빈 화면을 확인할 수 없음`);
  }

  console.log("\n[Creator B 가입 · 채널 등록]");
  const pb = await newPage("creatorB");
  lastPage = pb;
  const avatarPng = await pb.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = "#8b6cf6";
    g.fillRect(0, 0, 256, 256);
    const b: Blob = await new Promise((r) => c.toBlob((x) => r(x!), "image/png"));
    const bytes = new Uint8Array(await b.arrayBuffer());
    let s = "";
    for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s);
  });
  const png = Buffer.from(avatarPng, "base64");
  await step("Creator B 가입(UI · 크리에이터로 시작) → 채널 설정(사진 · 사용자 이름 · 소개 · 카테고리) → Studio", async () => {
    await pb.goto(`${BASE}/signup`);
    await pb.getByRole("radio", { name: /크리에이터로 시작/ }).click();
    await pb.getByLabel("활동명").fill(B.name);
    await pb.getByLabel("이메일").fill(B.email);
    await pb.getByLabel("비밀번호").fill(B.password);
    await pb.getByRole("button", { name: "가입하고 시작하기" }).click();
    await pb.waitForURL(/\/setup\/creator$/);
    bUid = await uidOf(B.email);
    if (bUid) userIds.push(bUid);
    await pb.locator('input[type="file"]').setInputFiles({ name: "me.png", mimeType: "image/png", buffer: png });
    await pb.getByRole("img", { name: B.name }).first().waitFor();
    await pb.getByLabel("사용자 이름").fill(B.handle);
    await pb.getByLabel("소개").fill("Discover E2E로 만든 채널이에요.");
    await pb.getByRole("button", { name: "아트" }).click();
    await pb.getByRole("button", { name: "Studio 시작하기" }).click();
    await pb.waitForURL(/\/studio$/);
    const { data } = await admin.from("creators").select("id, profile_id").eq("handle", B.handle).single();
    cid = data?.id ?? "";
    return [!!cid && data?.profile_id === bUid, data];
  });

  console.log("\n[Discover — 등록 시점 · 가입 시점과 관계없이 같은 목록]");
  await step("Fan A(먼저 가입) Discover에 Creator B 등장 (새로 불러오기만)", async () => [await discoverShows(pa, B.name)]);
  await shot(pa, "with-b");
  const pc = await newPage("fanC");
  await step("Fan C(B 등록 뒤 가입) Discover에도 Creator B 등장", async () => {
    lastPage = pc;
    await signUpFan(pc, C);
    return [await discoverShows(pc, B.name)];
  });
  await step("Creator B 본인 Discover에는 자기 채널이 없음 (팬으로도 쓸 수 있는 같은 계정)", async () => {
    lastPage = pb;
    return [!(await discoverShows(pb, B.name))];
  });

  console.log("\n[Moment 공개 → 팔로우 → Today]");
  const T1 = `디스커버 공개 기록 ${stamp}`;
  await step("Creator B: 사진 · 글 Moment 공개", async () => {
    lastPage = pb;
    await publish(pb, "photo", `디스커버 사진 ${stamp}`, png);
    await publish(pb, "text", T1);
  });
  await step("Fan A: Discover → B 프로필 → 팔로우 (DB follow)", async () => {
    lastPage = pa;
    await pa.goto(`${BASE}/creators/${cid}`);
    await pa.getByRole("button", { name: "팔로우" }).first().click();
    await pa.getByRole("button", { name: "팔로잉" }).first().waitFor();
    const { data } = await admin.from("subscriptions").select("tier").eq("creator_id", cid).eq("fan_id", await uidOf(A.email));
    return [data?.[0]?.tier === "follow", data];
  });
  await step("Fan A Today: B의 오늘 (TODAY · 2 MOMENTS)", async () => {
    const t = await todayText(pa);
    return [t.includes("TODAY · 2 MOMENTS") && t.includes(`${B.name}의 오늘`), t.slice(0, 120)];
  });

  console.log("\n[Safe Delay]");
  const T2 = `디스커버 지연 기록 ${stamp}`;
  await step("Creator B: Safe Delay 15분 → 글 Moment 공개 예약", async () => {
    lastPage = pb;
    const b = createClient(URL_, KEY, { auth: { persistSession: false } });
    await b.auth.signInWithPassword({ email: B.email, password: B.password });
    const { error } = await b.from("creator_safety_settings").insert({ creator_id: cid, safe_delay_mode: "fixed", safe_delay_minutes: 15 });
    if (error) return [false, error.message];
    await publish(pb, "text", T2);
    await pb.getByText(/공개 예정 · /).first().waitFor();
  });
  await step("공개 전: Fan A Today · B의 Today 화면에 지연 Moment 없음 (여전히 2개)", async () => {
    lastPage = pa;
    const t = await todayText(pa);
    await pa.goto(`${BASE}/creators/${cid}/today`);
    await pa.waitForLoadState("networkidle");
    const t2 = await pa.locator("main").innerText();
    return [t.includes("TODAY · 2 MOMENTS") && !t2.includes(T2), { today: t.slice(0, 60) }];
  });
  await step("B '지금 공개' → Fan A에게 등장 (TODAY · 3 MOMENTS)", async () => {
    lastPage = pb;
    await pb.goto(`${BASE}/studio`);
    await pb.getByRole("button", { name: "지금 공개" }).first().click();
    await pb.getByText(/공개 예정 · /).waitFor({ state: "detached" });
    lastPage = pa;
    const t = await todayText(pa);
    await pa.goto(`${BASE}/creators/${cid}/today`);
    await pa.getByText(T2).first().waitFor();
    return [t.includes("TODAY · 3 MOMENTS"), t.slice(0, 60)];
  });

  console.log("\n[차단 · 차단 해제]");
  await step("Fan A가 B 차단 (대화방 메뉴)", async () => {
    lastPage = pa;
    await pa.goto(`${BASE}/chat/${cid}`);
    await pa.getByRole("button", { name: "대화 설정" }).click();
    await pa.getByRole("button", { name: "차단하기" }).click();
    await pa.getByText("차단한 크리에이터예요.").waitFor();
  });
  await step("차단 후: A의 Discover · Today에서 B가 사라짐", async () => {
    const d = await discoverShows(pa, B.name);
    const t = await todayText(pa);
    return [!d && !t.includes(`${B.name}의 오늘`) && !t.includes("TODAY · 3 MOMENTS"), { discover: d, today: t.slice(0, 80) }];
  });
  await shot(pa, "blocked");
  await step("차단은 A만의 것: Fan C Discover에는 B가 그대로", async () => {
    lastPage = pc;
    return [await discoverShows(pc, B.name)];
  });
  await step("A가 My > 차단한 계정에서 해제 → Discover · Today에 다시 보임", async () => {
    lastPage = pa;
    await pa.goto(`${BASE}/my/blocked`);
    await pa.getByRole("button", { name: `${B.name} 차단 해제` }).click();
    await pa.getByText("차단한 계정이 없어요.").waitFor();
    const d = await discoverShows(pa, B.name);
    const t = await todayText(pa);
    return [d && t.includes("TODAY · 3 MOMENTS"), { discover: d, today: t.slice(0, 60) }];
  });

  console.log("\n[Creator B 계정 삭제]");
  await step("B: 계정 삭제(UI) → 로그인 화면", async () => {
    lastPage = pb;
    const files = await admin.storage.from("moment-media").list(cid);
    const avatars = await admin.storage.from("avatars").list(bUid);
    if (!(files.data ?? []).length || !(avatars.data ?? []).length) return [false, "삭제 전 파일이 없음 (준비 실패)"];
    await pb.goto(`${BASE}/my/account/delete`);
    await pb.getByRole("button", { name: "계속하기" }).click();
    await pb.getByLabel(/계정 삭제"라고 입력/).fill("계정 삭제");
    await pb.getByLabel("비밀번호").fill(B.password);
    await pb.getByRole("button", { name: "계정 영구 삭제" }).click();
    await pb.waitForURL(/\/login\?deleted=1/, { timeout: 60_000 });
  });
  await step("삭제 후: A Discover에서 사라짐 · 프로필 404 · Today에서 사라짐", async () => {
    lastPage = pa;
    const d = await discoverShows(pa, B.name);
    const res = await pa.goto(`${BASE}/creators/${cid}`);
    const t = await todayText(pa);
    return [!d && res?.status() === 404 && !t.includes(`${B.name}의 오늘`), { discover: d, status: res?.status() }];
  });
  await step("삭제 후 흔적: auth · 채널 · Moment · 구독 없음 · Storage(아바타 · Moment 폴더) 비어 있음", async () => {
    const u = await admin.auth.admin.getUserById(bUid);
    const [ch, m, s, f1, f2] = await Promise.all([
      admin.from("creators").select("id").eq("id", cid),
      admin.from("moments").select("id").eq("creator_id", cid),
      admin.from("subscriptions").select("id").eq("creator_id", cid),
      admin.storage.from("moment-media").list(cid),
      admin.storage.from("avatars").list(bUid),
    ]);
    const counts = { ch: ch.data?.length, m: m.data?.length, s: s.data?.length, media: f1.data?.length, avatar: f2.data?.length };
    return [!u.data.user && Object.values(counts).every((n) => n === 0), counts];
  });
  console.log("\n[Pretendard 자체 제공 · 외부 요청]");
  await step("글꼴: Pretendard woff2 조각을 이 앱(/_next/static)에서 200 · 'Pretendard Variable'이 실제로 적용됨", async () => {
    lastPage = pc;
    await pc.goto(`${BASE}/discover`);
    await pc.evaluate(() => document.fonts.ready);
    const applied = await pc.evaluate(() => document.fonts.check("16px 'Pretendard Variable'", "크리에이터") && getComputedStyle(document.body).fontFamily.includes("Pretendard Variable"));
    const woff = fontResponses.filter((f) => f.path.startsWith("/_next/static/"));
    // 실행 전체(여러 화면 · 여러 브라우저)에서 받은 서로 다른 조각 수 — 92조각 전부가 아니라 쓰인 글자 범위만
    const distinct = new Set(woff.map((f) => f.path)).size;
    return [applied && distinct > 0 && distinct < 92 && woff.every((f) => f.status === 200), { applied, distinctSubsets: distinct, responses: woff.length }];
  });
  await step("OFL 라이선스 전문 제공 (/licenses/pretendard-OFL-1.1.txt)", async () => {
    const r = await fetch(`${BASE}/licenses/pretendard-OFL-1.1.txt`);
    return [r.status === 200 && (await r.text()).includes("SIL OPEN FONT LICENSE"), r.status];
  });
  await step("외부 요청 0 (jsDelivr 등 CDN 없음 — 앱 · Supabase만)", async () => [externalRequests.length === 0, [...new Set(externalRequests)].slice(0, 5)]);
  await step("페이지 오류 없음", async () => [pageErrors.length === 0, pageErrors]);
} catch (e) {
  failed++;
  console.error("테스트 준비/실행 실패:", e instanceof Error ? e.message.split("\n")[0] : e);
} finally {
  await browser.close().catch(() => {});
  const r = await cleanupTestUsers(admin, userIds);
  stopServer();
  console.log(`\n정리: 이 실행이 만든 계정 ${r.users}명 · 파일 ${r.files}개${r.failed.length ? ` · 실패 ${r.failed.join(", ")}` : ""} · 모델 호출 0회`);
  console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}`);
  setTimeout(() => process.exit(failed ? 1 : 0), 500);
}
