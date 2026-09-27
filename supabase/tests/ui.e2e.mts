/**
 * 브라우저 E2E — 실제 Chrome으로 앱 화면을 눌러 신규 Creator A · Fan B의 v0.4 흐름을 확인한다.
 *
 *   npm run build && npm run test:ui -- --confirm-dev
 *
 * · 빌드된 앱을 `next start`로 띄우고(포트 3100), 설치된 Chrome을 headless로 쓴다 (playwright-core).
 * · 가입 · 로그인 · 프로필 사진 · 기록(글/사진/영상/음성 녹음) · 미리보기 · 공개 · 수정 · 삭제 · 팔로우 · 반응 · 로그아웃을 화면에서 한다.
 * · 음성은 Chrome의 가짜 마이크(--use-fake-device-for-media-stream)로 앱의 MediaRecorder 녹음 경로를 그대로 탄다.
 * · 영상 · 사진 파일은 브라우저가 만든 진짜 WebM/PNG다.
 * · service role(admin)은 테스트가 만든 id 조회와 끝난 뒤 정리에만 쓴다.
 * · Confirm email이 꺼진 프로젝트에서만 실행한다 (가입 메일이 나가지 않도록).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright-core";

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
const CHROME =
  process.env.CHROME_PATH ??
  ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome"].find(existsSync);

{
  const settings = await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: KEY } }).then((r) => r.json());
  if (!settings.mailer_autoconfirm) {
    console.error("가입 확인 메일이 켜져 있어요. Authentication → Email → Confirm email 을 끄고 실행하세요 (가입 메일이 나가지 않도록).");
    process.exit(1);
  }
}
if (!CHROME) {
  console.error("Chrome을 찾지 못했어요. CHROME_PATH 로 지정하세요.");
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });

/* ---------- 결과 ---------- */
type Item = { name: string; ok: boolean; detail?: string };
const results: { title: string; items: Item[] }[] = [];
let current: (typeof results)[number] = { title: "", items: [] };
function section(title: string) {
  current = { title, items: [] };
  results.push(current);
  console.log(`\n[${title}]`);
}
let lastPage: Page | null = null;
let failShots = 0;
async function step(name: string, fn: () => Promise<boolean | [boolean, unknown] | void>) {
  let ok = false;
  let detail: string | undefined;
  try {
    const r = await fn();
    const [o, d] = Array.isArray(r) ? r : [r ?? true, undefined];
    ok = o;
    detail = d === undefined ? undefined : typeof d === "string" ? d : JSON.stringify(d);
  } catch (e) {
    detail = e instanceof Error ? e.message.split("\n")[0] : String(e);
  }
  current.items.push({ name, ok, detail });
  console.log(`   ${ok ? "✓" : "✗"} ${name}${!ok && detail ? `  → ${detail}` : ""}`);
  if (!ok && lastPage) await lastPage.screenshot({ path: `${SHOTS}/fail-${++failShots}.png` }).catch(() => {});
  return ok;
}

/* ---------- 앱 서버 ---------- */
let server: ChildProcess | null = null;
async function startServer() {
  // 이전 실행에서 남은 서버가 예전 빌드를 내보내지 않도록 — 포트가 이미 쓰이고 있으면 멈춘다
  const busy = await fetch(`${BASE}/login`).then(() => true, () => false);
  if (busy) throw new Error(`포트 ${PORT}에 이미 서버가 떠 있어요. 끄고 다시 실행하세요.`);
  server = spawn("npx", ["next", "start", "-p", String(PORT)], { shell: true, stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/login`);
      if (r.ok) return;
    } catch {
      /* 아직 */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("앱 서버가 뜨지 않았어요 (npm run build 먼저)");
}
function stopServer() {
  if (!server?.pid) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill("SIGTERM");
}

/* ---------- 계정 ---------- */
const stamp = Date.now().toString(36);
const A = { email: `momenty-ui-creator-${stamp}@gmail.com`, password: `Ui-${randomBytes(9).toString("base64url")}1a`, name: `UI 크리에이터 ${stamp.slice(-4)}`, handle: `ui.${stamp}` };
const B = { email: `momenty-ui-fan-${stamp}@gmail.com`, password: `Ui-${randomBytes(9).toString("base64url")}1a`, name: "UI 팬" };
const userIds: string[] = [];
let creatorId = "";

async function uidOf(email: string) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return data.users.find((u) => u.email === email)?.id ?? "";
}

/** 브라우저가 만든 진짜 미디어 (canvas → WebM 영상, oscillator → WebM 음성) */
async function makeMedia(page: Page) {
  return page.evaluate(async () => {
    const toB64 = async (b: Blob) => {
      const bytes = new Uint8Array(await b.arrayBuffer());
      let s = "";
      for (const x of bytes) s += String.fromCharCode(x);
      return btoa(s);
    };
    const record = (stream: MediaStream, type: string, ms: number) =>
      new Promise<Blob>((resolve) => {
        const r = new MediaRecorder(stream, { mimeType: type });
        const chunks: Blob[] = [];
        r.ondataavailable = (e) => chunks.push(e.data);
        r.onstop = () => resolve(new Blob(chunks, { type: type.split(";")[0] }));
        r.start(200);
        setTimeout(() => r.stop(), ms);
      });
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d")!;
    let f = 0;
    const timer = setInterval(() => {
      ctx.fillStyle = `hsl(${(f += 12) % 360} 70% 55%)`;
      ctx.fillRect(0, 0, 320, 240);
      ctx.fillStyle = "#fff";
      ctx.font = "40px sans-serif";
      ctx.fillText(`MOMENTY ${f}`, 20, 130);
    }, 50);
    const video = await record(canvas.captureStream(20), "video/webm;codecs=vp8", 2200);
    clearInterval(timer);
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    const dest = ac.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    const audio = await record(dest.stream, "audio/webm;codecs=opus", 1800);
    osc.stop();
    canvas.toDataURL("image/png");
    const png = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
    return { video: await toB64(video), audio: await toB64(audio), png: await toB64(png) };
  });
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const newPage = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ko-KR", timezoneId: "Asia/Seoul", permissions: ["microphone"] });
  // tsx(esbuild)가 page.evaluate에 넘긴 함수 안에 넣는 __name 헬퍼를 브라우저에도 둔다
  await ctx.addInitScript("window.__name = (f) => f");
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  lastPage = page;
  return page;
};
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }).catch(() => {});

async function publishFromPreview(page: Page, visibility: "전체" | "구독자") {
  await page.waitForURL(/\/studio\/record\/preview$/);
  await page.getByRole("radio", { name: new RegExp(`^${visibility}`) }).click();
  await page.getByRole("button", { name: "공개하기" }).click();
  await page.waitForURL(/\/studio(\?posted=1)?$/, { timeout: 60_000 });
}

try {
  await startServer();
  const page = await newPage();
  await page.goto(`${BASE}/login`);
  const media = await makeMedia(page);
  const buf = (b64: string) => Buffer.from(b64, "base64");

  section("Route protection · 로그아웃 상태");
  for (const path of ["/today", "/studio", "/studio/record", "/my", "/archive", "/chat"]) {
    await step(`${path} 직접 입력 → Login으로`, async () => {
      await page.goto(`${BASE}${path}`);
      await page.waitForURL(/\/login\?next=/);
      return [decodeURIComponent(new URL(page.url()).searchParams.get("next") ?? "") === path, page.url()];
    });
  }
  await step("Discover · 크리에이터 화면은 로그인 없이 볼 수 있음", async () => {
    await page.goto(`${BASE}/discover`);
    await page.getByRole("heading", { name: "Discover" }).waitFor();
    return !page.url().includes("/login");
  });

  /* ================= Creator A ================= */
  section("Creator A · 가입 → 프로필 → Studio");
  await step("Signup: 크리에이터로 시작 → /setup/creator", async () => {
    await page.goto(`${BASE}/signup`);
    await page.getByRole("radio", { name: /크리에이터로 시작/ }).click();
    await page.getByLabel("활동명").fill(A.name);
    await page.getByLabel("이메일").fill(A.email);
    await page.getByLabel("비밀번호").fill(A.password);
    await page.getByRole("button", { name: "가입하고 시작하기" }).click();
    await page.waitForURL(/\/setup\/creator$/);
    const id = await uidOf(A.email);
    if (id) userIds.push(id);
    return !!id;
  });
  await step("가입 오류 처리: 짧은 비밀번호 → 안내 문구", async () => {
    const p2 = await newPage();
    await p2.goto(`${BASE}/signup`);
    await p2.getByLabel("닉네임").fill("x");
    await p2.getByLabel("이메일").fill(`momenty-ui-bad-${stamp}@gmail.com`);
    await p2.getByLabel("비밀번호").fill("short");
    await p2.getByRole("button", { name: "가입하고 시작하기" }).click();
    const alert = await p2.locator('p[role="alert"]').textContent();
    await p2.context().close();
    return [!!alert?.includes("8자 이상"), alert];
  });
  await step("프로필 사진 미리보기 · 사용자 이름 · 소개 · 카테고리 → Studio 시작하기 → /studio", async () => {
    await page.locator('input[type="file"]').setInputFiles({ name: "me.png", mimeType: "image/png", buffer: buf(media.png) });
    await page.getByRole("img", { name: A.name }).first().waitFor();
    await page.getByLabel("사용자 이름").fill(A.handle);
    await page.getByLabel("소개").fill("UI 테스트로 만든 크리에이터예요.");
    await page.getByRole("button", { name: "아트" }).click();
    await shot(page, "01-creator-setup");
    await page.getByRole("button", { name: "Studio 시작하기" }).click();
    await page.waitForURL(/\/studio$/);
    const { data } = await admin.from("creators").select("id, avatar_url").eq("handle", A.handle).single();
    creatorId = data?.id ?? "";
    return [!!creatorId && !!data?.avatar_url?.includes("/avatars/"), data];
  });
  await step("신규 크리에이터 Studio: 빈 Timeline 안내 (mock 없음)", async () => {
    await page.getByText("오늘은 아직 남긴 순간이 없어요").waitFor();
    await shot(page, "02-studio-empty");
    return true;
  });

  section("Creator A · 기록 → 미리보기 → 공개");
  await step("Text: 작성 → 미리보기 → 전체 공개", async () => {
    await page.goto(`${BASE}/studio/record?type=text`);
    await page.getByPlaceholder("지금 떠오른 생각, 오늘의 한 문장…").fill("UI로 남긴 첫 번째 순간");
    await page.getByRole("button", { name: "다음" }).click();
    await page.getByText("팬의 Today에는 이렇게 보여요").waitFor();
    await shot(page, "03-preview-text");
    await publishFromPreview(page, "전체");
    return true;
  });
  await step("Photo: 앨범 선택 → 미리보기 → 전체 공개 (Storage 업로드)", async () => {
    await page.goto(`${BASE}/studio/record?type=photo`);
    await page.locator('input[type="file"]').first().setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: buf(media.png) });
    await page.getByPlaceholder("한 줄 남기기").fill("UI 사진");
    await page.getByRole("button", { name: "다음" }).click();
    await publishFromPreview(page, "전체");
    return true;
  });
  await step("Video: 파일 선택 → 미리보기(포스터 추출) → 전체 공개", async () => {
    await page.goto(`${BASE}/studio/record?type=video`);
    await page.locator('input[type="file"]').first().setInputFiles({ name: "clip.webm", mimeType: "video/webm", buffer: buf(media.video) });
    // 길이 · 첫 장면(포스터) 추출이 끝나면 캡션 입력이 나타난다
    await page.getByPlaceholder("한 줄 남기기").waitFor({ timeout: 60_000 });
    await page.getByPlaceholder("한 줄 남기기").fill("UI 영상");
    await page.getByRole("button", { name: "다음" }).click();
    await page.waitForURL(/preview$/);
    await shot(page, "04-preview-video");
    await publishFromPreview(page, "전체");
    return true;
  });
  await step("Voice: MediaRecorder 녹음 → 들어보기 → 구독자 공개", async () => {
    await page.goto(`${BASE}/studio/record?type=voice`);
    await page.getByRole("button", { name: "녹음 시작" }).click();
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "녹음 멈추기" }).click();
    await page.getByRole("button", { name: "재생" }).waitFor();
    await shot(page, "05-voice-recorded");
    await page.getByRole("button", { name: "다음" }).click();
    await publishFromPreview(page, "구독자");
    return true;
  });
  await step("Voice 파일 업로드 fallback: 음성 파일 올리기 → 공개", async () => {
    await page.goto(`${BASE}/studio/record?type=voice`);
    await page.locator('input[type="file"][accept^="audio"]').last().setInputFiles({ name: "voice.webm", mimeType: "audio/webm", buffer: buf(media.audio) });
    await page.getByRole("button", { name: "재생" }).waitFor();
    await page.getByRole("button", { name: "다음" }).click();
    await publishFromPreview(page, "전체");
    return true;
  });
  await step("DB: 5개 · 모두 Creator A 폴더의 실제 파일 · created_at 서버 시각", async () => {
    const { data } = await admin.from("moments").select("type, media_url, poster_url, duration_sec, visibility, created_at").eq("creator_id", creatorId).order("created_at");
    const files = (data ?? []).flatMap((m) => [m.media_url, m.poster_url]).filter(Boolean) as string[];
    const recent = (data ?? []).every((m) => Date.now() - new Date(m.created_at).getTime() < 15 * 60_000);
    return [
      data?.length === 5 && files.every((f) => f.startsWith(`${creatorId}/`)) && recent && !!data.find((m) => m.type === "video")?.poster_url,
      data?.map((m) => ({ type: m.type, v: m.visibility, poster: !!m.poster_url, dur: m.duration_sec })),
    ];
  });

  section("Creator A · Today · 수정 · 삭제 · 재로그인");
  await step("Creator Today (팬 화면): TODAY · 5 MOMENTS, 시간순 Timeline", async () => {
    await page.goto(`${BASE}/creators/${creatorId}/today`);
    await page.getByText("TODAY · 5 MOMENTS").waitFor();
    await shot(page, "06-creator-today");
    return true;
  });
  await step("Studio Timeline에서 수정 → 저장", async () => {
    await page.goto(`${BASE}/studio`);
    await page.getByRole("button", { name: /Moment 수정/ }).first().click();
    await page.getByRole("dialog").locator("textarea").fill("UI로 남긴 첫 번째 순간 (수정)");
    await page.getByRole("dialog").getByRole("button", { name: "저장" }).click();
    await page.getByText("UI로 남긴 첫 번째 순간 (수정)").waitFor();
    return true;
  });
  await step("Studio Timeline에서 삭제 (음성 파일 Moment) → DB · 파일 함께 삭제", async () => {
    const { data: before } = await admin.from("moments").select("id, media_url").eq("creator_id", creatorId).order("created_at");
    const target = before!.at(-1)!;
    await page.getByRole("button", { name: /Moment 삭제/ }).last().click();
    await page.getByRole("dialog").getByRole("button", { name: "삭제" }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.getByText(`${before!.length - 1}개의 순간`).waitFor();
    const { data: row } = await admin.from("moments").select("id").eq("id", target.id);
    const { data: files } = await admin.storage.from("moment-media").list(creatorId, { search: target.media_url.split("/")[1] });
    return [row?.length === 0 && files?.length === 0, { row: row?.length, files: files?.length }];
  });
  await step("로그아웃 → Login → 다시 로그인 → Studio에 데이터 유지", async () => {
    await page.goto(`${BASE}/studio/settings`);
    await page.getByRole("button", { name: "로그아웃" }).click();
    await page.waitForURL(/\/login/);
    await page.getByLabel("이메일").fill(A.email);
    await page.getByLabel("비밀번호").fill(A.password);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL(/\/studio$/);
    await page.getByText("4개의 순간").waitFor();
    return true;
  });
  await step("새로고침 후에도 세션 복원 (Studio 유지)", async () => {
    await page.reload();
    await page.getByText("4개의 순간").waitFor();
    return !page.url().includes("/login");
  });
  await step("로그인 오류 처리: 틀린 비밀번호 → 안내", async () => {
    const p2 = await newPage();
    await p2.goto(`${BASE}/login`);
    await p2.getByLabel("이메일").fill(A.email);
    await p2.getByLabel("비밀번호").fill("Wrong-password-1");
    await p2.getByRole("button", { name: "로그인" }).click();
    const alert = await p2.locator('p[role="alert"]').textContent();
    await p2.context().close();
    return [!!alert?.includes("맞지 않아요"), alert];
  });
  await page.context().close();

  /* ================= Fan B ================= */
  const fan = await newPage();
  section("Fan B · 가입 → 관심사 → Discover → Follow → Today");
  await step("Signup: 팬으로 시작 → /setup/interests", async () => {
    await fan.goto(`${BASE}/signup`);
    await fan.getByLabel("닉네임").fill(B.name);
    await fan.getByLabel("이메일").fill(B.email);
    await fan.getByLabel("비밀번호").fill(B.password);
    await fan.getByRole("button", { name: "가입하고 시작하기" }).click();
    await fan.waitForURL(/\/setup\/interests$/);
    const id = await uidOf(B.email);
    if (id) userIds.push(id);
    return !!id;
  });
  await step("관심 카테고리(아트) → Discover", async () => {
    await fan.getByRole("button", { name: "아트" }).click();
    await fan.getByRole("button", { name: "크리에이터 찾아보기" }).click();
    await fan.waitForURL(/\/discover$/);
    return true;
  });
  await step("신규 팬 Today: 팔로우 0 → 크리에이터 찾기 안내 (mock 없음)", async () => {
    await fan.goto(`${BASE}/today`);
    await fan.getByText("좋아하는 크리에이터를 찾아보세요").waitFor();
    await shot(fan, "07-fan-today-empty");
    return true;
  });
  await step("Discover에서 Creator A 발견 → 프로필", async () => {
    await fan.goto(`${BASE}/discover`);
    await fan.getByPlaceholder("이름, 사용자 이름, 관심사로 찾기").fill(A.handle);
    await fan.getByRole("link", { name: new RegExp(A.name) }).first().click();
    await fan.waitForURL(new RegExp(`/creators/${creatorId}$`));
    return true;
  });
  await step("Follow → 팔로잉 (DB 저장)", async () => {
    await fan.getByRole("button", { name: "팔로우" }).first().click();
    await fan.getByRole("button", { name: "팔로잉" }).first().waitFor();
    const { data } = await admin.from("subscriptions").select("tier").eq("creator_id", creatorId);
    return [data?.length === 1 && data[0].tier === "follow", data];
  });
  await step("Today에 Creator A 반영: TODAY · 4 MOMENTS", async () => {
    await fan.goto(`${BASE}/today`);
    await fan.getByText("TODAY · 4 MOMENTS").waitFor();
    await shot(fan, "08-fan-today");
    return true;
  });
  await step("Creator Today: 공개 원문은 보이고, 구독자 음성은 잠김", async () => {
    await fan.goto(`${BASE}/creators/${creatorId}/today`);
    await fan.getByText("UI로 남긴 첫 번째 순간 (수정)").waitFor();
    await fan.getByText("구독자 전용 Moment").first().waitFor();
    await shot(fan, "09-fan-creator-today");
    return true;
  });
  let photoId = "";
  let videoId = "";
  {
    const { data } = await admin.from("moments").select("id, type").eq("creator_id", creatorId);
    photoId = data?.find((m) => m.type === "photo")?.id ?? "";
    videoId = data?.find((m) => m.type === "video")?.id ?? "";
  }
  await step("Photo 상세: 좋아요 → 저장 (aria-pressed · DB)", async () => {
    await fan.goto(`${BASE}/moments/${photoId}`);
    await fan.getByRole("button", { name: "좋아요" }).click();
    await fan.locator('button[aria-label="좋아요"][aria-pressed="true"]').waitFor();
    const { count } = await admin.from("moment_reactions").select("*", { count: "exact", head: true }).eq("moment_id", photoId);
    return [count === 1, count];
  });
  await step("반응 시트: 응원해요 → 저장", async () => {
    await fan.getByRole("button", { name: "반응 남기기" }).click();
    await fan.getByRole("button", { name: /응원해요/ }).click();
    await fan.locator('button[aria-pressed="true"]', { hasText: "응원해요" }).waitFor();
    const { count } = await admin.from("moment_reactions").select("*", { count: "exact", head: true }).eq("moment_id", photoId);
    return [count === 2, count];
  });
  await step("Video 상세: 실제 재생 (signed URL · duration > 0 · 재생 진행)", async () => {
    await fan.goto(`${BASE}/moments/${videoId}`);
    const v = fan.locator("video");
    await v.waitFor();
    const r = await v.evaluate(async (el: HTMLVideoElement) => {
      el.muted = true;
      await new Promise((res) => (el.readyState >= 1 ? res(null) : el.addEventListener("loadedmetadata", () => res(null), { once: true })));
      await el.play();
      await new Promise((res) => setTimeout(res, 800));
      return { src: el.currentSrc.includes("/object/sign/moment-media/"), time: el.currentTime, poster: !!el.poster };
    });
    await shot(fan, "10-video-detail");
    return [r.src && r.time > 0 && r.poster, r];
  });
  await step("로그아웃 → 로그인 → 팔로우 · 반응 유지", async () => {
    await fan.goto(`${BASE}/my`);
    await fan.getByRole("button", { name: "로그아웃" }).click();
    await fan.waitForURL(/\/login/);
    await fan.getByLabel("이메일").fill(B.email);
    await fan.getByLabel("비밀번호").fill(B.password);
    await fan.getByRole("button", { name: "로그인" }).click();
    await fan.waitForURL(/\/today$/);
    await fan.goto(`${BASE}/creators/${creatorId}`);
    await fan.getByRole("button", { name: "팔로잉" }).first().waitFor();
    await fan.goto(`${BASE}/moments/${photoId}`);
    await fan.locator('button[aria-label="좋아요"][aria-pressed="true"]').waitFor();
    return true;
  });

  section("Security · 화면");
  await step("Fan B가 /studio 직접 입력 → 크리에이터 전용 안내 (Studio 화면 · 데이터 없음)", async () => {
    const studioRequests: string[] = [];
    fan.on("request", (r) => r.url().includes("/rest/v1/subscriptions") && r.url().includes(`creator_id=eq.${creatorId}`) && studioRequests.push(r.url()));
    await fan.goto(`${BASE}/studio`);
    await fan.getByText("크리에이터만 들어올 수 있어요").waitFor();
    await shot(fan, "11-fan-studio-blocked");
    const leaked = await fan.getByText("지금, 어떤 순간인가요?").count();
    return [leaked === 0 && studioRequests.length === 0, { leaked, studioRequests }];
  });
  await step("Fan B가 /studio/record 직접 입력 → 같은 안내", async () => {
    await fan.goto(`${BASE}/studio/record?type=text`);
    await fan.getByText("크리에이터만 들어올 수 있어요").waitFor();
    return true;
  });
} catch (e) {
  section("중단");
  current.items.push({ name: "예상치 못한 오류", ok: false, detail: e instanceof Error ? e.message : String(e) });
  console.log(`   ✗ ${e instanceof Error ? e.message : e}`);
} finally {
  await browser.close().catch(() => {});
  stopServer();
  /* 정리 — 테스트가 만든 계정 · 파일만 */
  let files = 0;
  if (creatorId) {
    const { data } = await admin.storage.from("moment-media").list(creatorId, { limit: 1000 });
    const paths = (data ?? []).map((f) => `${creatorId}/${f.name}`);
    files += paths.length;
    if (paths.length) await admin.storage.from("moment-media").remove(paths);
  }
  for (const uid of userIds) {
    const { data } = await admin.storage.from("avatars").list(uid, { limit: 1000 });
    const paths = (data ?? []).map((f) => `${uid}/${f.name}`);
    files += paths.length;
    if (paths.length) await admin.storage.from("avatars").remove(paths);
    await admin.auth.admin.deleteUser(uid);
  }
  const bad = await uidOf(`momenty-ui-bad-${stamp}@gmail.com`);
  if (bad) await admin.auth.admin.deleteUser(bad);
  console.log(`\n정리: 테스트 계정 ${userIds.length}명 · 파일 ${files}개 삭제 · 스크린샷 ${SHOTS}/`);
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
