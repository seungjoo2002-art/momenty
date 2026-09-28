/**
 * 실제 Supabase 프로젝트 대상 통합 테스트 (localStorage · 가짜 서버 없음)
 *
 *   npm run test:live -- --confirm-dev
 *
 * · 모든 검증 요청은 실제 로그인 세션의 JWT(creator / fan / 비구독자)로 보낸다 → RLS가 그대로 적용된다.
 * · service role(admin)은 "준비·정리"에만 쓴다: 1회용 계정 · 채널 · 유료 등급 · 어제 날짜 Moment 준비와 정리.
 * · seed · 실제 계정을 쓰지 않는다. 이 실행이 만든 계정만 끝에서(실패해도) Storage → 계정 순서로 지운다.
 */
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { cleanupTestUsers, registerCleanup } from "./support/cleanup.mjs";

process.loadEnvFile(".env.local");
if (!process.argv.includes("--confirm-dev")) {
  console.error("실제 Supabase에 테스트 데이터를 썼다가 지우는 테스트예요. --confirm-dev 를 붙여 실행하세요.");
  process.exit(1);
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = "moment-media";
const mask = (s: string) => s.replace(/^(.).*(@.*)$/, "$1***$2");

// 앱 코드(services)가 브라우저에서처럼 로그인 세션을 쓰도록
const location = { pathname: "/today", href: "http://localhost:3000/today", origin: "http://localhost:3000", hash: "", search: "" };
Object.assign(globalThis, { window: { location, addEventListener() {}, removeEventListener() {} } });

/* ---------- 결과 기록 ---------- */
type Item = { name: string; ok: boolean; detail?: string };
const results: { no: number; title: string; items: Item[] }[] = [];
let current: (typeof results)[number];
function section(no: number, title: string) {
  current = { no, title, items: [] };
  results.push(current);
  console.log(`\n${no}. ${title}`);
}
function check(name: string, ok: boolean, detail?: unknown) {
  const d = detail === undefined ? undefined : typeof detail === "string" ? detail : JSON.stringify(detail);
  current.items.push({ name, ok, detail: d });
  console.log(`   ${ok ? "✓" : "✗"} ${name}${!ok && d ? `  → ${d}` : ""}`);
}
async function step(name: string, fn: () => Promise<boolean | [boolean, unknown]>) {
  try {
    const r = await fn();
    const [ok, detail] = Array.isArray(r) ? r : [r, undefined];
    check(name, ok, detail);
  } catch (e) {
    check(name, false, e instanceof Error ? `${e.name}: ${e.message}` : e);
  }
}

/* ---------- 클라이언트 ---------- */
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const newClient = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function signIn(email: string, password: string) {
  const sb = newClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { sb, uid: data.user.id, jwtRole: JSON.parse(Buffer.from(data.session.access_token.split(".")[1], "base64url").toString()).role as string };
}

/** 1x1이 아닌 진짜 PNG (8x8 보라색) */
function png(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(t));
    return Buffer.concat([len, t, c]);
  };
  const w = 8;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.concat(Array.from({ length: w }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill([108, 77, 255]).flat())])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

/* ---------- 준비 — 이 테스트가 만드는 1회용 계정 · 채널만 (seed · 실제 계정을 쓰지 않는다) ----------
 *   C1  크리에이터 본인 채널 (팬: premium)       — 대부분의 검사 대상
 *   C3  다른 크리에이터 (팬: subscriber)          — subscriber · premium 접근 경계
 *   C2  또 다른 크리에이터 (팬: follow)           — 남의 채널 수정 · 무료 팔로우 경계
 * admin은 준비(계정 · 유료 등급 · 어제 날짜 Moment — 결제 서버 · 과거 데이터 역할)와 정리에만.
 */
const createdMomentIds: string[] = [];
const createdFiles: string[] = [];
const userIds: string[] = [];
registerCleanup(admin, userIds);
const stamp = Date.now().toString(36);
const FAN_NICK = `라이브팬${stamp.slice(-3)}`;
const CREATOR_NICK = `라이브크리에이터${stamp.slice(-3)}`;
const C1 = `lta${stamp}`;
const C2 = `ltb${stamp}`;
const C3 = `ltc${stamp}`;

async function makeUser(tag: string, nickname: string) {
  const email = `momenty-lt-${tag}-${stamp}@gmail.com`;
  const password = `Lt-${randomBytes(9).toString("base64url")}1a`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nickname }, app_metadata: { momenty_test: true } });
  if (error) throw error;
  userIds.push(data.user.id);
  return { email, password, id: data.user.id };
}
type Acc = Awaited<ReturnType<typeof makeUser>>;
let creatorAcc!: Acc;
let fanAcc!: Acc;
let outsiderAcc!: Acc;
// 준비가 중간에 실패해도 그때까지 만든 계정은 지우고 끝낸다 (아래 try/finally 밖이므로 여기서 따로)
try {
  creatorAcc = await makeUser("creator", CREATOR_NICK);
  fanAcc = await makeUser("fan", FAN_NICK);
  const otherA = await makeUser("other2", "다른크리에이터2");
  const otherB = await makeUser("other3", "다른크리에이터3");
  outsiderAcc = await makeUser("outsider", "비구독자");
  const fail = (e: { message: string } | null) => {
    if (e) throw new Error(`준비 실패: ${e.message}`);
  };
  fail((await admin.from("creators").insert([
    { id: C1, profile_id: creatorAcc.id, name: CREATOR_NICK, handle: `lt1.${stamp}`, category: "photo" },
    { id: C2, profile_id: otherA.id, name: "다른크리에이터2", handle: `lt2.${stamp}`, category: "music" },
    { id: C3, profile_id: otherB.id, name: "다른크리에이터3", handle: `lt3.${stamp}`, category: "art" },
  ])).error);
  fail((await admin.from("subscriptions").insert([
    { fan_id: fanAcc.id, creator_id: C1, tier: "premium" },
    { fan_id: fanAcc.id, creator_id: C3, tier: "subscriber" },
    { fan_id: fanAcc.id, creator_id: C2, tier: "follow" },
  ])).error);
  // 여러 행을 한 번에 넣으면 빠진 컬럼이 기본값이 아니라 null이 되므로, 날짜를 정하는 행은 따로
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  fail((await admin.from("moments").insert({ creator_id: C1, type: "text", content: "[live-test] 어제 기록", visibility: "public", created_at: yesterday })).error);
  fail((await admin.from("moments").insert([
    { creator_id: C3, type: "text", content: "[live-test] C3 구독자 기록", visibility: "subscriber" },
    { creator_id: C3, type: "text", content: "[live-test] C3 premium 기록", visibility: "premium" },
    { creator_id: C2, type: "text", content: "[live-test] C2 구독자 기록", visibility: "subscriber" },
    { creator_id: C2, type: "text", content: "[live-test] C2 공개 기록", visibility: "public" },
  ])).error);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  console.log("정리:", await cleanupTestUsers(admin, userIds));
  process.exit(1);
}
const creatorEmail = creatorAcc.email;
const creatorPassword = creatorAcc.password;
const fanEmail = fanAcc.email;
const fanPassword = fanAcc.password;
const outsiderEmail = outsiderAcc.email;
const outsiderPassword = outsiderAcc.password;
console.log(`대상: ${new URL(URL_).host.replace(/^[^.]+/, "<ref>")} · 1회용 creator ${mask(creatorEmail)} · fan ${mask(fanEmail)} · 채널 ${C1} · ${C2} · ${C3}`);

let creator!: Awaited<ReturnType<typeof signIn>>;
let fan!: Awaited<ReturnType<typeof signIn>>;
let outsider!: Awaited<ReturnType<typeof signIn>>;
const anon = newClient();

try {
  /* 1 */
  section(1, "Creator 테스트 계정 로그인");
  await step("signInWithPassword 성공", async () => {
    creator = await signIn(creatorEmail, creatorPassword);
    return [true, creator.uid];
  });
  check("JWT role = authenticated (service_role 아님)", creator?.jwtRole === "authenticated", creator?.jwtRole);

  /* 2 */
  section(2, "Fan 테스트 계정 로그인");
  await step("signInWithPassword 성공", async () => {
    fan = await signIn(fanEmail, fanPassword);
    return true;
  });
  check("JWT role = authenticated", fan?.jwtRole === "authenticated", fan?.jwtRole);
  outsider = await signIn(outsiderEmail, outsiderPassword);

  /* 3 */
  section(3, "profiles 생성 확인");
  await step("Fan: 본인 profile 조회 (가입 닉네임)", async () => {
    const { data, error } = await fan.sb.from("profiles").select("id, nickname").eq("id", fan.uid).single();
    if (error) throw error;
    return [data.nickname === FAN_NICK, data];
  });
  await step("Creator: 본인 profile 조회", async () => {
    const { data, error } = await creator.sb.from("profiles").select("nickname").eq("id", creator.uid).single();
    if (error) throw error;
    return [data.nickname === CREATOR_NICK, data];
  });
  await step("가입 trigger: 임시 계정도 profile 자동 생성", async () => {
    const { data } = await outsider.sb.from("profiles").select("id").eq("id", outsider.uid);
    return (data?.length ?? 0) === 1;
  });
  await step("Fan이 다른 사람 profile 수정 → 0행 (RLS)", async () => {
    const { data, error } = await fan.sb.from("profiles").update({ nickname: "hacked" }).eq("id", creator.uid).select("id");
    return [!error && data.length === 0, error ?? data];
  });

  /* 4 */
  section(4, "creators 연결 확인");
  await step("Creator 계정 = creators.c1 의 profile_id", async () => {
    const { data, error } = await creator.sb.from("creators").select("id, name").eq("profile_id", creator.uid);
    if (error) throw error;
    return [data.length === 1 && data[0].id === C1, data];
  });
  await step("비로그인도 크리에이터 목록 조회 (이 테스트의 채널 3개 포함)", async () => {
    const { data, error } = await anon.from("creators").select("id").in("id", [C1, C2, C3]);
    return [!error && data.length === 3, error ?? data];
  });
  await step("Fan이 c1 크리에이터 정보 수정 → 0행 (RLS)", async () => {
    const { data, error } = await fan.sb.from("creators").update({ bio: "hacked" }).eq("id", C1).select("id");
    return [!error && data.length === 0, error ?? data];
  });

  /* 5 */
  section(5, "subscription 관계 확인");
  await step("Fan: 본인 구독 6건 (c1 premium · c3 subscriber …)", async () => {
    const { data, error } = await fan.sb.from("subscriptions").select("creator_id, tier");
    if (error) throw error;
    const tier = Object.fromEntries(data.map((s) => [s.creator_id, s.tier]));
    return [data.length === 3 && tier[C1] === "premium" && tier[C3] === "subscriber" && tier[C2] === "follow", tier];
  });
  await step("Creator(c1): 자기 채널 구독자만 조회", async () => {
    const { data, error } = await creator.sb.from("subscriptions").select("creator_id, fan_id");
    if (error) throw error;
    return [data.length >= 1 && data.every((s) => s.creator_id === C1), data.map((s) => s.creator_id)];
  });
  await step("비구독자: 남의 구독 조회 → 0행", async () => {
    const { data, error } = await outsider.sb.from("subscriptions").select("*");
    return [!error && data.length === 0, error ?? data.length];
  });
  await step("Fan이 스스로 premium으로 올리기 → 거부", async () => {
    const { data, error } = await fan.sb.from("subscriptions").update({ tier: "premium" }).eq("creator_id", C3).select("tier");
    return [!!error || data.length === 0, error ? `${error.code} ${error.message}` : data];
  });
  await step("비구독자가 스스로 구독 생성 → 거부", async () => {
    const { error } = await outsider.sb.from("subscriptions").insert({ fan_id: outsider.uid, creator_id: C1, tier: "premium" });
    return [!!error, error ? `${error.code} ${error.message}` : "insert 허용됨!"];
  });

  /* 6 — 앱 서비스 코드 경로 (services/moments.ts → Supabase backend) */
  const svc = await import("../../src/lib/services/moments");
  const appAuth = await import("../../src/lib/services/auth");
  /** 앱의 로그인 서비스로 사용자 전환 (브라우저의 로그인 · 로그아웃과 같은 경로) */
  const loginAs = async (email: string, password: string) => {
    await appAuth.signOut().catch(() => {});
    svc.clearSignedUrls();
    await appAuth.signIn(email, password);
  };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  let textId = "";
  let subPhotoId = "";
  let premiumTextId = "";
  let photoPath = "";

  section(6, "Creator가 Moment 생성");
  await loginAs(creatorEmail, creatorPassword);
  await step("앱 createMoment: 텍스트 · 전체 공개", async () => {
    const m = await svc.createMoment({ creatorId: C1, type: "text", content: `[live-test] 공개 텍스트 ${Date.now()}`, visibility: "public", aiContextEnabled: true });
    textId = m.id;
    createdMomentIds.push(m.id);
    return [m.creatorId === C1 && !m.locked, { id: m.id, createdAt: m.createdAt }];
  });
  await step("createdAt = 서버 now() · 오늘(KST)", async () => {
    const m = await svc.getMoment(textId);
    const kst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(m!.createdAt));
    return [kst === today && Math.abs(Date.now() - new Date(m!.createdAt).getTime()) < 5 * 60_000, m?.createdAt];
  });
  await step("앱 createMoment: 사진 · 구독자 공개 (Storage 업로드 포함)", async () => {
    const file = new Blob([new Uint8Array(png())], { type: "image/png" });
    const m = await svc.createMoment({ creatorId: C1, type: "photo", content: "[live-test] 구독자 사진", media: { file }, visibility: "subscribers", aiContextEnabled: false });
    subPhotoId = m.id;
    createdMomentIds.push(m.id);
    const { data } = await creator.sb.from("moments").select("media_url").eq("id", m.id).single();
    photoPath = data!.media_url;
    createdFiles.push(photoPath);
    return [photoPath.startsWith(`${C1}/`) &&!!m.mediaUrl?.includes("/storage/v1/object/sign/"), { photoPath }];
  });
  await step("직접 API: Creator JWT로 premium 텍스트 insert", async () => {
    const { data, error } = await creator.sb.from("moments").insert({ creator_id: C1, type: "text", content: "[live-test] premium 원문", visibility: "premium" }).select("id").single();
    if (error) throw error;
    premiumTextId = data.id;
    createdMomentIds.push(data.id);
    return true;
  });

  /* 7 */
  section(7, "Creator가 자신의 Moment 수정");
  await step("앱 updateMoment: 본문 · 공개범위 변경", async () => {
    const m = await svc.updateMoment(textId, { content: "[live-test] 수정된 텍스트", visibility: "public" });
    return [m?.content === "[live-test] 수정된 텍스트", m?.content];
  });
  await step("updated_at 자동 갱신", async () => {
    const { data } = await creator.sb.from("moments").select("created_at, updated_at").eq("id", textId).single();
    return [new Date(data!.updated_at) > new Date(data!.created_at), data];
  });

  /* 8 */
  section(8, "Creator가 자신의 Moment 삭제");
  let deleteTargetId = "";
  await step("앱 deleteMoment", async () => {
    const m = await svc.createMoment({ creatorId: C1, type: "text", content: "[live-test] 지울 Moment", visibility: "public", aiContextEnabled: true });
    deleteTargetId = m.id;
    await svc.deleteMoment(m.id);
    const { data } = await creator.sb.from("moments").select("id").eq("id", m.id);
    return [data!.length === 0, data];
  });
  await step("삭제된 id 조회 → 없음 (앱 getMoment)", async () => (await svc.getMoment(deleteTargetId)) === undefined);
  await step("삭제된 id 다시 삭제 → 안내 오류 (crash 없음)", async () => {
    try {
      await svc.deleteMoment(deleteTargetId);
      return [false, "오류 없이 통과됨"];
    } catch (e) {
      return [e instanceof Error && e.name === "ServiceError", (e as Error).message];
    }
  });

  /* 9 */
  section(9, "Fan이 Creator의 Today/Moment 조회");
  await loginAs(fanEmail, fanPassword);
  await step("앱 getTodayMoments(c1) — Fan 세션", async () => {
    const list = await svc.getTodayMoments(C1);
    const mine = list.find((m) => m.id === textId);
    const sorted = list.every((m, i) => i === 0 || list[i - 1].createdAt <= m.createdAt);
    return [!!mine && mine.content === "[live-test] 수정된 텍스트" && sorted, { count: list.length, sorted }];
  });
  await step("앱 getMoment(Detail) — Fan 세션", async () => {
    const m = await svc.getMoment(textId);
    return [m?.content === "[live-test] 수정된 텍스트" && m.locked === false, m?.content];
  });
  await step("앱 Archive: 지난 하루 Daily 계산 (어제 Moment)", async () => {
    const d = await svc.getDailyRecords(C1);
    return [d.length >= 1 && d.every((x) => x.date < today), { days: d.length, latest: d[0]?.date }];
  });

  /* 10 */
  section(10, "subscriber Moment 접근");
  await step("Fan(c1 premium): c1 구독자 사진 원문 — moments 테이블 직접", async () => {
    const { data, error } = await fan.sb.from("moments").select("content, media_url").eq("id", subPhotoId);
    return [!error && data.length === 1 && data[0].content === "[live-test] 구독자 사진", error ?? data];
  });
  await step("Fan(c3 subscriber): c3 구독자 Moment 원문 조회", async () => {
    const { data, error } = await fan.sb.from("moment_feed").select("id, viewable, content").eq("creator_id", C3).eq("visibility", "subscriber").limit(1);
    if (error) throw error;
    if (!data.length) return [false, "c3에 subscriber Moment 없음"];
    const direct = await fan.sb.from("moments").select("content").eq("id", data[0].id);
    return [data[0].viewable && data[0].content !== null && direct.data?.length === 1, data[0]];
  });

  /* 11 */
  section(11, "premium Moment 접근 제어");
  await step("Fan(c1 premium): c1 premium 원문 조회 가능", async () => {
    const { data } = await fan.sb.from("moments").select("content").eq("id", premiumTextId);
    return [data?.length === 1 && data[0].content === "[live-test] premium 원문", data];
  });
  await step("Fan(c3 subscriber): c3 premium — moments 테이블 직접 → 0행", async () => {
    const { data: feed } = await fan.sb.from("moment_feed").select("id").eq("creator_id", C3).eq("visibility", "premium").limit(1);
    if (!feed?.length) return [false, "c3에 premium Moment 없음"];
    const { data, error } = await fan.sb.from("moments").select("content, media_url").eq("id", feed[0].id);
    return [!error && data.length === 0, error ?? data];
  });
  await step("Fan(c3 subscriber): c3 premium — feed는 행만, content/media null", async () => {
    const { data } = await fan.sb.from("moment_feed").select("viewable, content, media_url, location").eq("creator_id", C3).eq("visibility", "premium");
    return [!!data?.length && data.every((r) => !r.viewable && r.content === null && r.media_url === null && r.location === null), data?.length];
  });
  await step("앱 getMoment: 잠긴 Moment → locked, 본문 없음", async () => {
    const { data: feed } = await fan.sb.from("moment_feed").select("id").eq("creator_id", C3).eq("visibility", "premium").limit(1);
    const m = await svc.getMoment(feed![0].id);
    return [m?.locked === true && m.content === "" && !m.mediaUrl, { locked: m?.locked, content: m?.content }];
  });

  /* 12 */
  section(12, "Fan reaction 생성/삭제");
  await step("앱 toggleLove → 생성 (♥, 개수 1)", async () => {
    const on = await svc.toggleLove(textId);
    const m = await svc.getMoment(textId);
    const { data } = await fan.sb.from("moment_reactions").select("user_id, kind").eq("moment_id", textId);
    return [on && m?.likedByMe === true && m.reactions.love === 1 && data?.length === 1 && data[0].user_id === fan.uid, { love: m?.reactions.love, rows: data }];
  });
  await step("같은 반응 중복 insert → 23505", async () => {
    const { error } = await fan.sb.from("moment_reactions").insert({ moment_id: textId, user_id: fan.uid, kind: "love" });
    return [error?.code === "23505", error?.code ?? "중복 허용됨!"];
  });
  await step("남의 user_id로 반응 insert → 42501", async () => {
    const { error } = await fan.sb.from("moment_reactions").insert({ moment_id: textId, user_id: creator.uid, kind: "cheer" });
    return [error?.code === "42501", error?.code ?? "허용됨!"];
  });
  await step("Creator는 Fan의 반응 행을 볼 수 없음 (본인 것만)", async () => {
    const { data } = await creator.sb.from("moment_reactions").select("*").eq("moment_id", textId);
    return [data?.length === 0, data];
  });
  await step("다른 사용자가 Fan 반응 삭제 → 0행", async () => {
    await outsider.sb.from("moment_reactions").delete().eq("moment_id", textId).eq("user_id", fan.uid);
    const { data } = await fan.sb.from("moment_reactions").select("kind").eq("moment_id", textId);
    return [data?.length === 1, data];
  });
  await step("앱 toggleLove 다시 → 삭제 (개수 0)", async () => {
    const on = await svc.toggleLove(textId);
    const m = await svc.getMoment(textId);
    return [on === false && m?.likedByMe === false && m.reactions.love === 0, m?.reactions];
  });
  await step("비구독자가 볼 수 없는 Moment에 반응 → 42501", async () => {
    const { error } = await outsider.sb.from("moment_reactions").insert({ moment_id: premiumTextId, user_id: outsider.uid, kind: "love" });
    return [error?.code === "42501", error?.code ?? "허용됨!"];
  });

  /* 13 */
  section(13, "다른 사용자의 Moment 수정/삭제 차단");
  for (const [who, c] of [
    ["Fan", () => fan],
    ["비구독자", () => outsider],
  ] as const) {
    await step(`${who}: c1 Moment update → 0행`, async () => {
      const { data, error } = await c().sb.from("moments").update({ content: "hacked" }).eq("id", textId).select("id");
      return [!error && data.length === 0, error ?? data];
    });
    await step(`${who}: c1 Moment delete → 0행`, async () => {
      const { data, error } = await c().sb.from("moments").delete().eq("id", textId).select("id");
      return [!error && data.length === 0, error ?? data];
    });
    await step(`${who}: c1 이름으로 Moment insert → 42501`, async () => {
      const { error } = await c().sb.from("moments").insert({ creator_id: C1, type: "text", content: "fake", visibility: "public" });
      return [error?.code === "42501", error?.code ?? "허용됨!"];
    });
  }
  await step("원본은 그대로 (Creator 확인)", async () => {
    const { data } = await creator.sb.from("moments").select("content").eq("id", textId).single();
    return [data?.content === "[live-test] 수정된 텍스트", data];
  });
  await step("Creator: 다른 크리에이터(c2) Moment 수정 → 0행", async () => {
    const { data: feed } = await creator.sb.from("moment_feed").select("id").eq("creator_id", C2).limit(1);
    const { data, error } = await creator.sb.from("moments").update({ content: "hacked" }).eq("id", feed![0].id).select("id");
    return [!error && data.length === 0, error ?? data];
  });
  await step("Creator: 자기 Moment를 c2로 옮기기 → 거부", async () => {
    const { data, error } = await creator.sb.from("moments").update({ creator_id: C2 }).eq("id", textId).select("id");
    return [!!error || data.length === 0, error ? error.code : data];
  });
  await step("앱 updateMoment를 Fan 세션으로 흉내 → 권한 없음", async () => {
    const { data } = await fan.sb.from("moments").update({ visibility: "public" }).eq("id", premiumTextId).select("id");
    return [data?.length === 0, data];
  });

  /* 14 */
  section(14, "비구독자의 subscriber/premium 원문 접근 차단");
  for (const [who, sb] of [
    ["비구독자(로그인)", () => outsider.sb],
    ["비로그인(anon)", () => anon],
  ] as const) {
    await step(`${who}: subscriber 사진 — moments 직접 → 0행`, async () => {
      const { data, error } = await sb().from("moments").select("content, media_url").eq("id", subPhotoId);
      return [!error && data.length === 0, error ?? data];
    });
    await step(`${who}: premium 원문 — moments 직접 → 0행`, async () => {
      const { data, error } = await sb().from("moments").select("content").eq("id", premiumTextId);
      return [!error && data.length === 0, error ?? data];
    });
    await step(`${who}: feed에서는 행만, content · media_url null`, async () => {
      const { data, error } = await sb().from("moment_feed").select("viewable, content, media_url").in("id", [subPhotoId, premiumTextId]);
      return [!error && data.length === 2 && data.every((r) => !r.viewable && r.content === null && r.media_url === null), error ?? data];
    });
    await step(`${who}: public Moment는 원문 조회 가능`, async () => {
      const { data } = await sb().from("moments").select("content").eq("id", textId);
      return [data?.length === 1, data];
    });
  }
  await step("Fan(c5 follow): c5 subscriber Moment 원문 → 0행", async () => {
    const { data: feed } = await fan.sb.from("moment_feed").select("id, viewable, content").eq("creator_id", C2).eq("visibility", "subscriber").limit(1);
    if (!feed?.length) return [false, "c5에 subscriber Moment 없음"];
    const { data } = await fan.sb.from("moments").select("id").eq("id", feed[0].id);
    return [data?.length === 0 && !feed[0].viewable && feed[0].content === null, { feed: feed[0], direct: data }];
  });
  await step("ai_context_enabled도 잠긴 Moment에서는 false", async () => {
    const { data } = await outsider.sb.from("moment_feed").select("ai_context_enabled").eq("id", premiumTextId).single();
    return [data?.ai_context_enabled === false, data];
  });

  /* 15 */
  section(15, "Storage moment-media 업로드/조회 권한");
  await step("Creator: 자기 폴더(c1/) 업로드 성공 (6번에서 확인한 파일 존재)", async () => {
    const { data, error } = await creator.sb.storage.from(BUCKET).list(C1, { search: photoPath.split("/")[1] });
    return [!error && data.length === 1, error ?? data.map((f) => f.name)];
  });
  await step("Fan(구독자 이상): signed URL 발급 + 실제 다운로드 200 · PNG", async () => {
    const { data, error } = await fan.sb.storage.from(BUCKET).createSignedUrl(photoPath, 60);
    if (error) throw error;
    const r = await fetch(data.signedUrl);
    const buf = Buffer.from(await r.arrayBuffer());
    return [r.status === 200 && buf.subarray(1, 4).toString() === "PNG", { status: r.status, bytes: buf.length }];
  });
  await step("비구독자: signed URL 발급 거부", async () => {
    const { data, error } = await outsider.sb.storage.from(BUCKET).createSignedUrl(photoPath, 60);
    return [!!error && !data, error?.message ?? "발급됨!"];
  });
  await step("비로그인: 직접 다운로드 거부", async () => {
    const { data, error } = await anon.storage.from(BUCKET).download(photoPath);
    return [!!error && !data, error?.message ?? "다운로드됨!"];
  });
  await step("bucket은 비공개 (public URL로 접근 불가)", async () => {
    const r = await fetch(anon.storage.from(BUCKET).getPublicUrl(photoPath).data.publicUrl);
    return [r.status >= 400, r.status];
  });
  await step("Fan: c1 폴더 업로드 → 거부", async () => {
    const { error } = await fan.sb.storage.from(BUCKET).upload(`${C1}/live-test-fan-${Date.now()}.png`, png(), { contentType: "image/png" });
    return [!!error, error?.message ?? "업로드됨!"];
  });
  await step("비구독자: 자기 이름 폴더라도 크리에이터가 아니면 업로드 거부", async () => {
    const { error } = await outsider.sb.storage.from(BUCKET).upload(`${outsider.uid}/x.png`, png(), { contentType: "image/png" });
    return [!!error, error?.message ?? "업로드됨!"];
  });
  await step("Fan: Creator 파일 삭제 → 파일 그대로", async () => {
    await fan.sb.storage.from(BUCKET).remove([photoPath]);
    const { data } = await creator.sb.storage.from(BUCKET).list(C1, { search: photoPath.split("/")[1] });
    return [data?.length === 1, data?.length];
  });
  await step("Creator: 앱 deleteMoment → DB 행 + Storage 파일 함께 삭제", async () => {
    await loginAs(creatorEmail, creatorPassword);
    await svc.deleteMoment(subPhotoId);
    const { data: rows } = await creator.sb.from("moments").select("id").eq("id", subPhotoId);
    const { data: files } = await creator.sb.storage.from(BUCKET).list(C1, { search: photoPath.split("/")[1] });
    return [rows?.length === 0 && files?.length === 0, { rows: rows?.length, files: files?.length }];
  });
} finally {
  /* ---------- 정리 (이 테스트가 만든 계정 · 채널만 — Storage → 계정 → DB cascade) ---------- */
  const r = await cleanupTestUsers(admin, userIds);
  console.log(`\n정리: 테스트 Moment ${createdMomentIds.length}개 · 파일 ${r.files}개 · 1회용 계정 ${r.users}명 삭제${r.failed.length ? ` · 실패 ${r.failed.join(", ")}` : ""}`);
}

/* ---------- 요약 ---------- */
console.log("\n요약");
let allOk = true;
for (const r of results) {
  const ok = r.items.length > 0 && r.items.every((i) => i.ok);
  allOk &&= ok;
  console.log(`${String(r.no).padStart(2)}. ${r.title} — ${ok ? "PASS" : "FAIL"} (${r.items.filter((i) => i.ok).length}/${r.items.length})`);
}
process.exit(allOk && results.length === 15 ? 0 : 1);
