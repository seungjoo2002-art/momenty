/**
 * v0.8 브라우저 E2E — 실제 Supabase + 실제 Chrome + 빌드된 앱(next start). LLM 호출 없음.
 *
 *   npm run build && npm run test:safety-e2e -- --confirm-dev
 *
 *   Safe Delay 설정 → 사진(GPS EXIF · 주소 · 전화번호가 찍힌 사진, 원래 이름 "IMG_2041_home_address.jpg") 선택
 *   → SafeShare(기기 안 OCR — /ocr 에서만 로드) → HIGH 확인 → 가리기 → 공개 예약
 *   → 올라간 파일: EXIF 없음 · uuid 이름 · 글자 영역이 모자이크됨 · 원본과 다름
 *   → 팬에게 안 보임 → 크리에이터 "지금 공개" → 팬에게 보임 · 프로필 안내 문구
 *   → 차단한 계정 관리 · /admin 404 · 계정 삭제(UI) 후 DB · Storage 흔적 없음
 *   → OCR 글자가 console에 없음 · 외부 OCR/CDN 요청 없음
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanupTestUsers, registerCleanup } from "./support/cleanup.mjs";
import { chromium, type Page } from "playwright-core";
import { jpegExifInfo } from "../../src/lib/safeshare/metadata";

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
const SUPA_HOST = new URL(URL_).host;
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
async function step(name: string, fn: () => Promise<boolean | [boolean] | [boolean, unknown] | void>) {
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
  if (!ok && lastPage) await lastPage.screenshot({ path: `${SHOTS}/safety-fail-${++shots}.png`, fullPage: true }).catch(() => {});
}
const shot = (p: Page, name: string) => p.screenshot({ path: `${SHOTS}/safety-${name}.png`, fullPage: true }).catch(() => {});

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
async function account(tag: string, nickname: string, role: "creator" | "fan"): Promise<Acc> {
  const sb = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `momenty-sx-${tag}-${stamp}@gmail.com`;
  const password = `Sx-${randomBytes(9).toString("base64url")}1a`;
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { nickname, signup_role: role, interests: ["art"], onboarded: true } } });
  if (error) throw error;
  if (!data.session) throw new Error("세션 없음 (Confirm email?)");
  userIds.push(data.user!.id);
  return { uid: data.user!.id, email, password, sb };
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const consoleText: string[] = [];
const externalRequests: string[] = [];
const ocrAssets: { url: string; status: number }[] = [];
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  await ctx.addInitScript("window.__name = (f) => f");
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  page.on("console", (m) => consoleText.push(m.text()));
  page.on("request", (r) => {
    const host = new URL(r.url()).host;
    if (!["localhost:3100", SUPA_HOST].includes(host) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) externalRequests.push(r.url());
  });
  page.on("response", (r) => {
    if (r.url().includes("/ocr/")) ocrAssets.push({ url: new URL(r.url()).pathname, status: r.status() });
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

/** JPEG에 GPS가 든 EXIF(APP1)를 끼워 넣는다 (휴대폰 사진처럼) */
function withGpsExif(jpeg: Buffer): Buffer {
  const enc = (s: string) => Buffer.from(s, "latin1");
  const payload = Buffer.concat([enc("Exif\0\0"), enc("II*\0"), Buffer.from([8, 0, 0, 0, 1, 0, 0x25, 0x88, 4, 0, 1, 0, 0, 0, 26, 0, 0, 0, 0, 0, 0, 0]), enc("GPS 37.5665N 126.9780E iPhone 15 Pro")]);
  const seg = Buffer.concat([Buffer.from([0xff, 0xe1, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff]), payload]);
  return Buffer.concat([jpeg.subarray(0, 2), seg, jpeg.subarray(2)]);
}

const SECRET_ADDRESS = "서울 마포구 월드컵로 123";
const SECRET_PHONE = "010-1234-5678";
// 글자 영역 (사진 좌표) — 모자이크 확인용
const TEXT_AREA = { x: 60, y: 140, width: 1080, height: 330 };
const NAME = `세이프${stamp.slice(-3)}`;
const pageErrors: string[] = [];

try {
  await startServer();
  const C = await account("c", NAME, "creator");
  const F = await account("f", "팬SX", "fan");
  const D = await account("d", "탈퇴예정", "fan");
  const { data: cr, error: cErr } = await C.sb.from("creators").insert({ profile_id: C.uid, name: NAME, handle: `sx.${stamp}`, category: "art" }).select("id").single();
  if (cErr) throw cErr;
  const cid = cr.id as string;
  {
    const { error } = await admin.from("subscriptions").insert({ fan_id: F.uid, creator_id: cid, tier: "subscriber" });
    if (error) throw error;
  }
  // D: 아바타 파일 · 반응용 데이터 (계정 삭제 뒤 흔적 확인)
  const avatarPath = `${D.uid}/${crypto.randomUUID()}.jpg`;
  await D.sb.storage.from("avatars").upload(avatarPath, new Blob([Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==", "base64")], { type: "image/jpeg" }), { contentType: "image/jpeg" });
  await D.sb.from("subscriptions").insert({ fan_id: D.uid, creator_id: cid, tier: "follow" });
  console.log(`준비: 크리에이터 ${NAME} · 구독 팬 · 탈퇴 예정 팬(아바타 파일 있음)`);

  const cp = await newPage();
  cp.on("pageerror", (e) => pageErrors.push(`creator: ${e.message}`));
  lastPage = cp;
  await login(cp, C);

  console.log("\n[Safe Delay 설정]");
  await step("Studio 설정 → SafeShare · Safe Delay → 정한 시간 15분 저장", async () => {
    await cp.goto(`${BASE}/studio/settings`);
    await cp.getByRole("link", { name: /SafeShare · Safe Delay/ }).click();
    await cp.waitForURL(/settings\/safeshare/);
    await cp.getByRole("tab", { name: "정한 시간" }).click();
    await cp.getByRole("button", { name: "15분" }).click();
    await cp.getByText("기록한 뒤 15분 후에 공개돼요.").waitFor();
    await cp.getByRole("button", { name: "저장" }).click();
    await cp.getByText("저장했어요").waitFor();
    const { data } = await C.sb.from("creator_safety_settings").select("safe_delay_mode, safe_delay_minutes").eq("creator_id", cid).single();
    return [data?.safe_delay_mode === "fixed" && data.safe_delay_minutes === 15, data];
  });
  await shot(cp, "settings");

  console.log("\n[SafeShare — 사진 확인 · 가리기]");
  // 글자가 찍힌 사진을 브라우저에서 만든다 (진짜 JPEG) → GPS EXIF를 끼운다
  const original = await cp.evaluate(async ([addr, phone, area]) => {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 800;
    const g = c.getContext("2d")!;
    g.fillStyle = "#f4f1ea";
    g.fillRect(0, 0, 1200, 800);
    g.fillStyle = "#8fb3d9";
    g.fillRect(0, 520, 1200, 280);
    g.fillStyle = "#ffffff";
    g.fillRect(area.x, area.y, area.width, area.height);
    g.fillStyle = "#111111";
    g.font = "bold 76px 'Malgun Gothic', sans-serif";
    g.fillText(addr, 90, 260);
    g.fillText(phone, 90, 410);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.95));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s);
  }, [SECRET_ADDRESS, SECRET_PHONE, TEXT_AREA] as const);
  const fixture = withGpsExif(Buffer.from(original, "base64"));
  await step("fixture: GPS EXIF가 든 JPEG", async () => [jpegExifInfo(new Uint8Array(fixture)).gps]);

  await step("사진 선택(원래 이름 IMG_2041_home_address.jpg) → 미리보기 → SafeShare 확인 중 · 공개 버튼 잠김", async () => {
    await cp.goto(`${BASE}/studio/record?type=photo`);
    await cp.locator('input[type="file"]').first().setInputFiles({ name: "IMG_2041_home_address.jpg", mimeType: "image/jpeg", buffer: fixture });
    await cp.getByPlaceholder("한 줄 남기기").fill(`SafeShare 사진 ${stamp}`);
    await cp.getByRole("button", { name: "다음" }).click();
    await cp.waitForURL(/\/studio\/record\/preview$/);
    await cp.getByText("공유하기 전에 사진을 확인하고 있어요", { exact: false }).waitFor();
    return (await cp.getByRole("button", { name: /SafeShare 확인 중/ }).isDisabled()) === true;
  });
  await step("기기 안 OCR → HIGH: 주소 · 전화번호로 보이는 정보 · 찾은 곳 표시 · 공개 잠김", async () => {
    await cp.getByRole("region", { name: "SafeShare 확인" }).waitFor({ timeout: 120_000 });
    const text = await cp.getByRole("region", { name: "SafeShare 확인" }).innerText();
    const locked = await cp.getByText("SafeShare 확인을 마치면 공개할 수 있어요.").count();
    return [/전화번호로 보이는 정보/.test(text) && /(주소로 보이는 정보|동 · 호수)/.test(text) && locked === 1 && (await cp.getByRole("button", { name: "가리기" }).count()) === 1, text.slice(0, 200)];
  });
  await shot(cp, "review");
  await step("가리기 → 편집한 사진으로 교체 · 공개 예약 가능", async () => {
    await cp.getByRole("button", { name: "가리기" }).click();
    await cp.getByText("찾은 곳을 가린 사진으로 올려요", { exact: false }).waitFor();
    await cp.getByText("Safe Delay · 기록한 뒤 15분 후에 공개돼요.").waitFor();
    return (await cp.getByRole("button", { name: "공개 예약하기" }).isEnabled()) === true;
  });
  await step("공개 예약 → Studio: 'Safe Delay · HH:MM쯤 팬에게 공개돼요' · 타임라인 '공개 예정'", async () => {
    await cp.getByRole("radio", { name: /^전체/ }).click();
    await cp.getByRole("button", { name: "공개 예약하기" }).click();
    await cp.waitForURL(/\/studio/, { timeout: 60_000 });
    await cp.getByText(/Safe Delay · \d{2}:\d{2}쯤 팬에게 공개돼요\./).waitFor();
    await cp.getByText(/공개 예정 · \d{2}:\d{2}/).first().waitFor();
    await cp.getByRole("button", { name: "지금 공개" }).first().waitFor();
  });
  await step("크리에이터 본인은 공개 예정 사진 썸네일을 봄 (본인 폴더 signed URL)", async () => {
    const img = cp.locator("ol li img").first();
    await img.waitFor();
    await cp.waitForFunction((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0, await img.elementHandle(), { timeout: 15_000 });
  });
  await shot(cp, "studio-scheduled");

  let momentId = "";
  let mediaPath = "";
  await step("DB: visible_at = +15분(서버) · 파일 경로는 {채널}/{uuid}.jpg (원래 이름 없음)", async () => {
    const { data } = await C.sb.from("moments").select("id, media_url, created_at, visible_at").eq("creator_id", cid).eq("content", `SafeShare 사진 ${stamp}`).single();
    momentId = data!.id;
    mediaPath = data!.media_url;
    const delay = (Date.parse(data!.visible_at) - Date.parse(data!.created_at)) / 60000;
    return [Math.abs(delay - 15) < 0.1 && new RegExp(`^${cid}/[0-9a-f-]{36}\\.jpg$`).test(mediaPath) && !mediaPath.includes("IMG_2041"), { delay, mediaPath }];
  });
  await step("Storage 객체 이름 · metadata에 원래 파일 이름 없음", async () => {
    const { data } = await admin.storage.from("moment-media").list(cid);
    return [!JSON.stringify(data).includes("IMG_2041") && !JSON.stringify(data).includes("home_address"), data?.map((f) => f.name)];
  });
  await step("올라간 파일: EXIF · GPS 없음 · 원본 바이트와 다름", async () => {
    const { data, error } = await C.sb.storage.from("moment-media").download(mediaPath);
    if (error || !data) return [false, error?.message];
    const bytes = new Uint8Array(await data.arrayBuffer());
    const info = jpegExifInfo(bytes);
    return [!info.exif && !info.gps && !Buffer.from(bytes).includes(Buffer.from("37.5665")) && Buffer.compare(Buffer.from(bytes), fixture) !== 0, info];
  });
  await step("올라간 파일: 글자 영역이 모자이크됨 (가장자리 수가 원본의 20% 미만)", async () => {
    const { data: signed } = await C.sb.storage.from("moment-media").createSignedUrl(mediaPath, 120);
    const edges = await cp.evaluate(async ([uploadedUrl, originalB64, area]) => {
      const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = src; });
      const count = (img: HTMLImageElement) => {
        const c = document.createElement("canvas");
        c.width = 1200;
        c.height = Math.round((img.naturalHeight / img.naturalWidth) * 1200);
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0, c.width, c.height);
        const d = g.getImageData(area.x, area.y, area.width, area.height).data;
        let n = 0;
        for (let y = 0; y < area.height; y++) for (let x = 1; x < area.width; x++) {
          const i = (y * area.width + x) * 4;
          const a = d[i] + d[i + 1] + d[i + 2];
          const b = d[i - 4] + d[i - 3] + d[i - 2];
          if (Math.abs(a - b) > 300) n++;
        }
        return n;
      };
      return { original: count(await load(`data:image/jpeg;base64,${originalB64}`)), uploaded: count(await load(uploadedUrl)) };
    }, [signed!.signedUrl, original, TEXT_AREA] as const);
    return [edges.original > 1000 && edges.uploaded < edges.original * 0.2, edges];
  });

  console.log("\n[팬 — 공개 전 · 공개 후]");
  const fp = await newPage();
  fp.on("pageerror", (e) => pageErrors.push(`fan: ${e.message}`));
  lastPage = fp;
  await login(fp, F);
  await step("공개 전: 팬의 크리에이터 Today · Moment 상세에 없음", async () => {
    await fp.goto(`${BASE}/creators/${cid}/today`);
    await fp.waitForLoadState("networkidle");
    const t1 = await fp.locator("main").innerText();
    await fp.goto(`${BASE}/moments/${momentId}`);
    await fp.waitForLoadState("networkidle");
    const t2 = await fp.locator("main").innerText().catch(() => "");
    return [!t1.includes(`SafeShare 사진 ${stamp}`) && !t2.includes(`SafeShare 사진 ${stamp}`), { t1: t1.slice(0, 80) }];
  });
  await step("크리에이터 '지금 공개' → 공개 예정 표시 사라짐", async () => {
    lastPage = cp;
    await cp.getByRole("button", { name: "지금 공개" }).first().click();
    await cp.getByText(/공개 예정 · /).waitFor({ state: "detached" });
  });
  await step("팬: 이제 보임 (사진 · 글)", async () => {
    lastPage = fp;
    await fp.goto(`${BASE}/moments/${momentId}`);
    await fp.getByText(`SafeShare 사진 ${stamp}`).first().waitFor();
  });
  await step("프로필 소개: '실제 기록 시점과 공개 시점이 다를 수 있어요' (지연 값은 없음)", async () => {
    await fp.goto(`${BASE}/creators/${cid}`);
    await fp.getByRole("tab", { name: "소개" }).click();
    await fp.getByText("실제 기록 시점과 공개 시점이 다를 수 있어요", { exact: false }).waitFor();
    const t = await fp.locator("main").innerText();
    return [!/15분|지연 15|Safe Delay/.test(t), t.match(/15분|Safe Delay/)?.[0]];
  });

  console.log("\n[차단한 계정 · 운영 화면]");
  await step("팬이 크리에이터 차단 → My > 차단한 계정에 보임 → 차단 해제", async () => {
    await F.sb.from("user_blocks").insert({ blocker_id: F.uid, blocked_id: C.uid });
    await fp.goto(`${BASE}/my`);
    await fp.getByRole("link", { name: /차단한 계정/ }).click();
    await fp.getByText(NAME).waitFor();
    await fp.getByRole("button", { name: `${NAME} 차단 해제` }).click();
    await fp.getByText("차단한 계정이 없어요.").waitFor();
    const { data } = await F.sb.from("user_blocks").select("blocked_id");
    return [(data ?? []).length === 0];
  });
  await step("크리에이터(차단당했던 쪽)의 차단 목록은 비어 있음", async () => {
    lastPage = cp;
    await cp.goto(`${BASE}/my/blocked`);
    await cp.getByText("차단한 계정이 없어요.").waitFor();
  });
  await step("일반 사용자 /admin/reports → 404 · My에 운영 메뉴 없음", async () => {
    lastPage = fp;
    const res = await fp.goto(`${BASE}/admin/reports`);
    await fp.goto(`${BASE}/my`);
    await fp.getByText("개인정보 및 안전").waitFor();
    return [res?.status() === 404 && (await fp.getByText("신고 처리").count()) === 0, res?.status()];
  });
  await step("로그아웃 상태 /admin/reports → 로그인으로 (서버)", async () => {
    const r = await fetch(`${BASE}/admin/reports`, { redirect: "manual" });
    return [r.status >= 300 && r.status < 400 && (r.headers.get("location") ?? "").includes("/login"), r.status];
  });

  console.log("\n[계정 삭제 (UI) — disposable 계정]");
  const dp = await newPage();
  dp.on("pageerror", (e) => pageErrors.push(`delete: ${e.message}`));
  lastPage = dp;
  await login(dp, D);
  await step("My → 계정 삭제 → 안내 → 확인 문구 · 비밀번호 틀림 → 거부", async () => {
    await dp.goto(`${BASE}/my`);
    await dp.getByRole("link", { name: "계정 삭제" }).click();
    await dp.getByText("계정을 삭제하면 되돌릴 수 없어요.").waitFor();
    await dp.getByRole("button", { name: "계속하기" }).click();
    await dp.getByLabel(/계정 삭제"라고 입력/).fill("계정 삭제");
    await dp.getByLabel("비밀번호").fill("wrong-password-1");
    await dp.getByRole("button", { name: "계정 영구 삭제" }).click();
    await dp.getByText("비밀번호가 맞지 않아요.").waitFor();
    return !!(await admin.auth.admin.getUserById(D.uid)).data.user;
  });
  await step("올바른 비밀번호 → 삭제 → 로그인 화면 '계정을 삭제했어요'", async () => {
    await dp.getByLabel("비밀번호").fill(D.password);
    await dp.getByRole("button", { name: "계정 영구 삭제" }).click();
    await dp.waitForURL(/\/login\?deleted=1/, { timeout: 60_000 });
    await dp.getByText("계정을 삭제했어요.", { exact: false }).waitFor();
  });
  await step("삭제 후 흔적: auth · 프로필 · 구독 없음 · 아바타 Storage 폴더 비어 있음", async () => {
    const u = await admin.auth.admin.getUserById(D.uid);
    const [p, s, st] = await Promise.all([admin.from("profiles").select("id").eq("id", D.uid), admin.from("subscriptions").select("id").eq("fan_id", D.uid), admin.storage.from("avatars").list(D.uid)]);
    return [!u.data.user && (p.data ?? []).length === 0 && (s.data ?? []).length === 0 && (st.data ?? []).length === 0, { p: p.data?.length, s: s.data?.length, st: st.data?.length }];
  });
  await step("삭제한 브라우저로 /my → 로그인으로", async () => {
    await dp.goto(`${BASE}/my`);
    await dp.waitForURL(/\/login/);
  });

  console.log("\n[OCR 개인정보 · 배포 파일]");
  await step("OCR 파일은 모두 이 앱 /ocr 에서 200 (worker · core · kor/eng 언어)", async () => {
    const paths = new Set(ocrAssets.filter((a) => a.status === 200).map((a) => a.url));
    return [paths.has("/ocr/worker.min.js") && [...paths].some((p) => p.startsWith("/ocr/core/")) && paths.has("/ocr/lang/kor.traineddata.gz") && paths.has("/ocr/lang/eng.traineddata.gz"), [...paths]];
  });
  await step("외부 OCR · CDN 요청 없음 (사진 · 글자가 밖으로 나가지 않음)", async () => {
    // v0.8.1부터 웹폰트도 자체 제공 — 앱 · Supabase 밖으로 나가는 요청은 하나도 없어야 한다
    return [externalRequests.length === 0, externalRequests.slice(0, 5)];
  });
  await step("console에 OCR 글자 · 주소 · 전화번호 없음", async () => {
    const leaked = consoleText.filter((t) => t.includes("월드컵") || t.includes("1234-5678") || t.includes("마포구"));
    return [leaked.length === 0, leaked.slice(0, 3)];
  });
  await step("페이지 오류 없음", async () => [pageErrors.length === 0, pageErrors]);
} catch (e) {
  failed++;
  console.error("테스트 준비/실행 실패:", e instanceof Error ? e.message.split("\n")[0] : e);
} finally {
  await browser.close().catch(() => {});
  await cleanupTestUsers(admin, userIds);
  stopServer();
  console.log(`\n정리: 테스트 계정 삭제 · 모델 호출 0회 · 스크린샷 ${SHOTS}/safety-*.png`);
  console.log(`\n${passed} passed, ${failed} failed`);
  setTimeout(() => process.exit(failed ? 1 : 0), 500);
}
